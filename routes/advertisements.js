import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { requireWorker, requireCustomer, requireAdmin, optionalAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateFile, generateSecureFilename } from '../utils/fileValidation.js';
import { uploadsSubdir } from '../utils/uploadPaths.js';
import Advertisement from '../models/Advertisement.js';

const router = Router();

const DURATION_PRICING = Object.freeze({
  '24 hours': { price: 200, ms: 24 * 60 * 60 * 1000 },
  '3 days': { price: 400, ms: 3 * 24 * 60 * 60 * 1000 },
  '1 week': { price: 600, ms: 7 * 24 * 60 * 60 * 1000 },
  '2 weeks': { price: 1000, ms: 14 * 24 * 60 * 60 * 1000 },
  '1 month': { price: 1800, ms: 30 * 24 * 60 * 60 * 1000 },
});

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

const PAYMENT_METHODS = new Set(['jazzcash', 'bank-transfer', 'pay-after-work']);

const adStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = uploadsSubdir('advertisements');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const userId = req.worker?.id || req.customer?.id || null;
    cb(null, generateSecureFilename(file.originalname, userId));
  },
});

const adUpload = multer({
  storage: adStorage,
  limits: { fileSize: 30 * 1024 * 1024, files: 4 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'paymentReceipt') {
      if (!IMAGE_MIME_TYPES.has(file.mimetype)) {
        return cb(new Error('Payment receipt must be a JPG, PNG, GIF, or WEBP image.'));
      }
      return cb(null, true);
    }

    if (file.fieldname !== 'adFiles') {
      return cb(new Error('Unexpected upload field.'));
    }

    if (!IMAGE_MIME_TYPES.has(file.mimetype) && !VIDEO_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('Unsupported advertisement media type.'));
    }

    cb(null, true);
  },
});

const uploadFields = adUpload.fields([
  { name: 'adFiles', maxCount: 3 },
  { name: 'paymentReceipt', maxCount: 1 },
]);

const cleanupUploadedFiles = (files = []) => {
  for (const file of files) {
    try {
      if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    } catch (error) {
      console.error('[advertisements] Failed to clean uploaded file:', error.message);
    }
  }
};

const flattenUploadedFiles = (files) => Object.values(files || {}).flat();

const getSubmitter = (req) => {
  if (req.worker) {
    return {
      id: req.worker.id,
      type: 'worker',
      name: req.worker.fullName || '',
      email: req.worker.email || '',
      phone: req.worker.phoneNumber || '',
      profilePicture: req.worker.profilePicture || null,
    };
  }
  if (req.customer) {
    return {
      id: req.customer.id,
      type: 'customer',
      name: req.customer.fullName || '',
      email: req.customer.email || '',
      phone: req.customer.phone || '',
      profilePicture: req.customer.profilePicture || null,
    };
  }
  return { id: null, type: 'guest', name: '', email: '', phone: '', profilePicture: null };
};

const normalizeAd = (ad) => {
  const raw = ad.toObject ? ad.toObject() : ad;
  return {
    ...raw,
    id: raw._id,
    name: raw.name || raw.workerId?.fullName || raw.customerId?.fullName || 'Advertiser',
    email: raw.email || raw.workerId?.email || raw.customerId?.email || '',
    phone: raw.phone || raw.phoneNumber || raw.workerId?.phoneNumber || raw.customerId?.phone || '',
    purpose: raw.purpose || raw.description || raw.title || '',
    adType: raw.adType || (raw.images?.length ? 'image' : 'image'),
    adFileUrls: raw.adFileUrls?.length ? raw.adFileUrls : raw.images || [],
    price: raw.price ?? raw.budget ?? 0,
  };
};

// ─── POST /api/advertisements — guest, customer, or worker
router.post(
  '/',
  optionalAuth,
  uploadFields,
  asyncHandler(async (req, res) => {
    const uploaded = flattenUploadedFiles(req.files);
    const adFiles = req.files?.adFiles || [];
    const receipt = req.files?.paymentReceipt?.[0] || null;

    try {
      const { purpose, duration, adType, paymentMethod, paymentReference = '' } = req.body;
      const submitter = getSubmitter(req);
      const isGuest = submitter.type === 'guest';
      const pricing = DURATION_PRICING[duration];

      if (!purpose?.trim() || purpose.trim().length > 500) {
        throw new Error('Advertisement purpose is required and must be 500 characters or fewer.');
      }
      if (!pricing) throw new Error('Invalid advertisement duration.');
      if (!['image', 'video'].includes(adType)) throw new Error('Invalid advertisement type.');
      if (!adFiles.length || adFiles.length > 3) throw new Error('Upload between 1 and 3 advertisement files.');
      if (!PAYMENT_METHODS.has(paymentMethod)) throw new Error('Invalid payment method.');
      if (paymentReference.trim().length > 100) throw new Error('Payment reference must be 100 characters or fewer.');

      if (isGuest) {
        const name = String(req.body.name || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();
        const phone = String(req.body.phone || '').trim();
        if (name.length < 2 || name.length > 100) throw new Error('A valid full name is required.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
          throw new Error('A valid email address is required.');
        }
        if (phone.length > 30) throw new Error('Phone number is too long.');
        submitter.name = name;
        submitter.email = email;
        submitter.phone = phone;
      }

      const payAfterWork = paymentMethod === 'pay-after-work';
      if (!payAfterWork && !receipt) {
        throw new Error('Payment receipt is required for upfront payment.');
      }
      if (receipt && receipt.size > 5 * 1024 * 1024) {
        throw new Error('Payment receipt must be 5MB or smaller.');
      }

      const expectedMedia = adType === 'image' ? IMAGE_MIME_TYPES : VIDEO_MIME_TYPES;
      for (const file of adFiles) {
        if (!expectedMedia.has(file.mimetype)) {
          throw new Error(`All advertisement files must be ${adType} files.`);
        }
        await validateFile(file.path, file.originalname, file.mimetype);
      }
      if (receipt) await validateFile(receipt.path, receipt.originalname, receipt.mimetype);

      const adFileUrls = adFiles.map((file) => `/uploads/advertisements/${file.filename}`);
      const paymentReceiptUrl = receipt
        ? `/uploads/advertisements/${receipt.filename}`
        : '';

      const advertisement = new Advertisement({
        name: submitter.name,
        email: submitter.email,
        phone: submitter.phone,
        purpose: purpose.trim(),
        duration,
        price: pricing.price,
        adType,
        adFileUrls,
        paymentMethod,
        payAfterWork,
        paymentReference: paymentReference.trim(),
        paymentReceiptUrl,
        paymentStatus: payAfterWork ? 'approved' : 'pending',
        paymentSubmittedAt: payAfterWork ? null : new Date(),
        submitterId: submitter.id,
        submitterType: submitter.type,
        submitterProfilePicture: submitter.profilePicture,

        // Legacy-compatible mirrors for existing admin/consumer code.
        workerId: submitter.type === 'worker' ? submitter.id : null,
        customerId: submitter.type === 'customer' ? submitter.id : null,
        title: purpose.trim().slice(0, 100),
        description: purpose.trim(),
        service: 'advertisement',
        budget: pricing.price,
        images: adFileUrls,
        phoneNumber: submitter.phone,
        isGuest,
        status: 'pending',
        expiresAt: null,
      });

      await advertisement.save();

      res.status(201).json({
        success: true,
        message: 'Advertisement submitted successfully and is awaiting review.',
        data: normalizeAd(advertisement),
      });
    } catch (error) {
      cleanupUploadedFiles(uploaded);
      const status = error?.name === 'ValidationError' ? 400 : 400;
      return res.status(status).json({ success: false, message: error.message || 'Advertisement submission failed.' });
    }
  }),
);

// ─── GET /api/advertisements — admin moderation list
router.get(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const query = { isDeleted: false };

    if (req.query.status && req.query.status !== 'all') query.status = req.query.status;

    const [advertisements, total] = await Promise.all([
      Advertisement.find(query)
        .populate('workerId', 'fullName phoneNumber email profilePicture')
        .populate('customerId', 'fullName phone email profilePicture')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Advertisement.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: advertisements.map(normalizeAd),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  }),
);

// ─── GET /api/advertisements/stats — admin counts
router.get(
  '/stats',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const [total, pending, approved, rejected] = await Promise.all([
      Advertisement.countDocuments({ isDeleted: false }),
      Advertisement.countDocuments({ isDeleted: false, status: 'pending' }),
      Advertisement.countDocuments({ isDeleted: false, status: 'approved' }),
      Advertisement.countDocuments({ isDeleted: false, status: 'rejected' }),
    ]);
    res.json({ success: true, data: { total, pending, approved, rejected } });
  }),
);

// ─── PATCH /api/advertisements/:id/status — admin review
router.patch(
  '/:id/status',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { status, adminNote = '' } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be approved or rejected.' });
    }
    if (typeof adminNote !== 'string' || adminNote.length > 500) {
      return res.status(400).json({ success: false, message: 'Admin note must be 500 characters or fewer.' });
    }

    const advertisement = await Advertisement.findOne({ _id: req.params.id, isDeleted: false });
    if (!advertisement) return res.status(404).json({ success: false, message: 'Advertisement not found.' });

    if (advertisement.status !== 'pending') {
      return res.status(409).json({ success: false, message: `Advertisement is already ${advertisement.status}.` });
    }

    const now = new Date();
    advertisement.status = status;
    advertisement.adminNote = adminNote.trim();
    advertisement.reviewedBy = req.admin.id;
    advertisement.reviewedAt = now;
    advertisement.paymentStatus = status === 'approved' ? 'approved' : 'rejected';
    advertisement.paymentReviewedBy = req.admin.id;
    advertisement.paymentReviewedAt = now;

    if (status === 'approved') {
      const duration = DURATION_PRICING[advertisement.duration];
      advertisement.expiresAt = duration ? new Date(now.getTime() + duration.ms) : null;
    } else {
      advertisement.expiresAt = null;
    }

    await advertisement.save();

    res.json({
      success: true,
      message: `Advertisement ${status}.`,
      data: normalizeAd(advertisement),
    });
  }),
);

// ─── GET /api/advertisements/active — public approved, non-expired ads
router.get(
  '/active',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;
    const query = {
      isDeleted: false,
      status: 'approved',
      expiresAt: { $gt: new Date() },
    };

    const [advertisements, total] = await Promise.all([
      Advertisement.find(query)
        .populate('workerId', 'fullName phoneNumber email profilePicture')
        .populate('customerId', 'fullName phone email profilePicture')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Advertisement.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: advertisements.map(normalizeAd),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  }),
);

// ─── GET /api/advertisements/my — authenticated user's own ads
router.get(
  '/my',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const userId = req.worker?.id || req.customer?.id;
    const userType = req.worker ? 'worker' : req.customer ? 'customer' : null;
    if (!userId) return res.status(401).json({ success: false, message: 'Authentication required.' });

    const query = { isDeleted: false };
    if (userType === 'worker') query.workerId = userId;
    if (userType === 'customer') query.customerId = userId;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [advertisements, total] = await Promise.all([
      Advertisement.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Advertisement.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: advertisements.map(normalizeAd),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  }),
);

// ─── GET /api/advertisements/:id — public single ad
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Advertisement not found.' });
    }

    const advertisement = await Advertisement.findOne({ _id: req.params.id, isDeleted: false })
      .populate('workerId', 'fullName phoneNumber email profilePicture')
      .populate('customerId', 'fullName phone email profilePicture');

    if (!advertisement) return res.status(404).json({ success: false, message: 'Advertisement not found.' });

    if (advertisement.status !== 'approved' && !advertisement.isGuest) {
      // Do not expose non-public ad details through the public endpoint.
      return res.status(404).json({ success: false, message: 'Advertisement not found.' });
    }

    advertisement.views = (advertisement.views || 0) + 1;
    await advertisement.save();
    res.json({ success: true, data: normalizeAd(advertisement) });
  }),
);

// ─── DELETE /api/advertisements/:id — owner or admin soft delete
router.delete(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Advertisement not found.' });
    }

    const advertisement = await Advertisement.findById(req.params.id);
    if (!advertisement || advertisement.isDeleted) {
      return res.status(404).json({ success: false, message: 'Advertisement not found.' });
    }

    const isOwningWorker = req.worker && advertisement.workerId?.toString() === req.worker.id?.toString();
    const isOwningCustomer = req.customer && advertisement.customerId?.toString() === req.customer.id?.toString();
    const isAdmin = Boolean(req.admin);

    if (!isOwningWorker && !isOwningCustomer && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this advertisement.' });
    }

    advertisement.isDeleted = true;
    await advertisement.save();
    res.json({ success: true, message: 'Advertisement deleted.' });
  }),
);

// ─── POST /api/advertisements/:id/interested — worker interest
router.post(
  '/:id/interested',
  requireWorker,
  asyncHandler(async (req, res) => {
    const advertisement = await Advertisement.findOne({ _id: req.params.id, isDeleted: false, status: 'approved' });
    if (!advertisement) return res.status(404).json({ success: false, message: 'Advertisement not found.' });
    if (advertisement.expiresAt && advertisement.expiresAt <= new Date()) {
      return res.status(410).json({ success: false, message: 'Advertisement has expired.' });
    }

    const alreadyInterested = advertisement.interested?.some(
      (item) => item.workerId?.toString() === req.worker.id?.toString(),
    );
    if (alreadyInterested) return res.status(409).json({ success: false, message: 'You are already interested in this advertisement.' });

    advertisement.interested.push({ workerId: req.worker.id, interestedAt: new Date() });
    await advertisement.save();
    res.json({ success: true, message: 'Marked as interested.' });
  }),
);

export default router;
