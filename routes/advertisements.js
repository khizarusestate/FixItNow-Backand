import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { requireWorker, requireCustomer, requireAdmin, optionalAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateFile, generateSecureFilename } from '../utils/fileValidation.js';
import Advertisement from '../models/Advertisement.js';

const router = Router();

const adImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'advertisements');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, generateSecureFilename(file.originalname, req.worker?.id || req.customer?.id));
  },
});

const adImageUpload = multer({
  storage: adImageStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, or WEBP images are allowed.'));
    }
    cb(null, true);
  },
});

// ─── POST /api/advertisements (create - worker or guest)
router.post(
  '/',
  optionalAuth,
  adImageUpload.array('images', 5),
  asyncHandler(async (req, res) => {
    const {
      title,
      description,
      service,
      category,
      budget,
      location,
      latitude,
      longitude,
      phoneNumber,
      email,
    } = req.body;

    if (!title || !description || !service) {
      (req.files || []).forEach((f) => {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      });
      return res.status(400).json({
        success: false,
        message: 'Title, description, and service are required.',
      });
    }

    const images = [];
    for (const file of req.files || []) {
      try {
        await validateFile(file.path, file.originalname, file.mimetype);
        images.push(`/uploads/advertisements/${file.filename}`);
      } catch (validationError) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(400).json({
          success: false,
          message: `Image validation failed: ${validationError.message}`,
        });
      }
    }

    const advertisement = new Advertisement({
      workerId: req.worker?.id || null,
      customerId: req.customer?.id || null,
      title,
      description,
      service,
      category,
      budget,
      location,
      latitude,
      longitude,
      phoneNumber: phoneNumber || req.worker?.phoneNumber || req.customer?.phone || '',
      email: email || req.worker?.email || req.customer?.email || '',
      images,
      isGuest: !req.worker && !req.customer,
    });

    await advertisement.save();

    res.json({
      success: true,
      message: 'Advertisement created successfully.',
      data: advertisement,
    });
  })
);

// ─── GET /api/advertisements (admin: full moderation list, all statuses)
router.get(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 500;
    const skip = (page - 1) * limit;

    const query = { isDeleted: false };

    if (req.query.status && req.query.status !== 'all') {
      query.status = req.query.status;
    }
    if (req.query.service) {
      query.service = { $regex: req.query.service, $options: 'i' };
    }

    const advertisements = await Advertisement.find(query)
      .populate('workerId', 'fullName phoneNumber profilePicture')
      .populate('customerId', 'fullName phone profilePicture')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Advertisement.countDocuments(query);

    res.json({
      success: true,
      data: advertisements,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  })
);

// ─── GET /api/advertisements/stats (admin: counts by status)
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

    res.json({
      success: true,
      data: { total, pending, approved, rejected },
    });
  })
);

// ─── PATCH /api/advertisements/:id/status (admin: approve/reject)
router.patch(
  '/:id/status',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { status, adminNote } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be 'approved' or 'rejected'.",
      });
    }

    const advertisement = await Advertisement.findOne({
      _id: req.params.id,
      isDeleted: false,
    });

    if (!advertisement) {
      return res.status(404).json({
        success: false,
        message: 'Advertisement not found.',
      });
    }

    advertisement.status = status;
    advertisement.adminNote = adminNote || '';
    advertisement.reviewedBy = req.admin.id;
    advertisement.reviewedAt = new Date();
    await advertisement.save();

    res.json({
      success: true,
      message: `Advertisement ${status}.`,
      data: advertisement,
    });
  })
);

// ─── GET /api/advertisements/active (list approved active only)
router.get(
  '/active',
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = {
      isDeleted: false,
      status: 'approved',
      expiresAt: { $gt: new Date() },
    };

    if (req.query.service) {
      query.service = { $regex: req.query.service, $options: 'i' };
    }

    const advertisements = await Advertisement.find(query)
      .populate('workerId', 'fullName phoneNumber profilePicture')
      .populate('customerId', 'fullName phone profilePicture')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Advertisement.countDocuments(query);

    res.json({
      success: true,
      data: advertisements,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  })
);

// ─── GET /api/advertisements/my (list own advertisements)
router.get(
  '/my',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const userId = req.worker?.id || req.customer?.id;
    const userType = req.worker ? 'worker' : req.customer ? 'customer' : null;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    try {
      const query = {
        isDeleted: false,
      };

      if (userType === 'worker') {
        query.workerId = userId;
      } else if (userType === 'customer') {
        query.customerId = userId;
      }

      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const advertisements = await Advertisement.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await Advertisement.countDocuments(query);

      res.json({
        success: true,
        data: advertisements,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error('[advertisements /my] Error fetching user advertisements:', {
        userId,
        userType,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  })
);

// ─── GET /api/advertisements/:id (view single)
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    // Validate ID format before querying
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(404).json({
        success: false,
        message: 'Advertisement not found.',
      });
    }

    const advertisement = await Advertisement.findOne({
      _id: req.params.id,
      isDeleted: false,
    }).populate('workerId', 'fullName phoneNumber profilePicture').populate('customerId', 'fullName phone profilePicture');

    if (!advertisement) {
      return res.status(404).json({
        success: false,
        message: 'Advertisement not found.',
      });
    }

    // Increment views
    advertisement.views = (advertisement.views || 0) + 1;
    await advertisement.save();

    res.json({
      success: true,
      data: advertisement,
    });
  })
);

// ─── DELETE /api/advertisements/:id (delete own)
router.delete(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const advertisement = await Advertisement.findById(req.params.id);

    if (!advertisement) {
      return res.status(404).json({
        success: false,
        message: 'Advertisement not found.',
      });
    }

    // Must be the owning worker, the owning customer, or an admin
    const isOwningWorker =
      req.worker && advertisement.workerId?.toString() === req.worker.id?.toString();
    const isOwningCustomer =
      req.customer && advertisement.customerId?.toString() === req.customer.id?.toString();
    const isAdmin = Boolean(req.admin);

    if (!isOwningWorker && !isOwningCustomer && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this advertisement.',
      });
    }

    advertisement.isDeleted = true;
    await advertisement.save();

    res.json({
      success: true,
      message: 'Advertisement deleted.',
    });
  })
);

// ─── POST /api/advertisements/:id/interested (worker interested)
router.post(
  '/:id/interested',
  requireWorker,
  asyncHandler(async (req, res) => {
    const advertisement = await Advertisement.findById(req.params.id);

    if (!advertisement) {
      return res.status(404).json({
        success: false,
        message: 'Advertisement not found.',
      });
    }

    const alreadyInterested = advertisement.interested?.some(
      (i) => i.workerId?.toString() === req.worker.id?.toString()
    );

    if (alreadyInterested) {
      return res.status(400).json({
        success: false,
        message: 'You are already interested in this advertisement.',
      });
    }

    advertisement.interested = advertisement.interested || [];
    advertisement.interested.push({
      workerId: req.worker.id,
      interestedAt: new Date(),
    });

    await advertisement.save();

    res.json({
      success: true,
      message: 'Marked as interested.',
    });
  })
);

export default router;
