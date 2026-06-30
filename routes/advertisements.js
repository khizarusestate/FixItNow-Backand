import { Router } from 'express';
import { requireWorker, requireCustomer, optionalAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import Advertisement from '../models/Advertisement.js';

const router = Router();

// ─── POST /api/advertisements (create - worker or guest)
router.post(
  '/',
  optionalAuth,
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
      return res.status(400).json({
        success: false,
        message: 'Title, description, and service are required.',
      });
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
      email: email || req.worker?.emailAddress || req.customer?.email || '',
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

// ─── GET /api/advertisements (list all active)
router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = {
      isDeleted: false,
      status: { $in: ['approved', 'pending'] },
      expiresAt: { $gt: new Date() },
    };

    if (req.query.service) {
      query.service = { $regex: req.query.service, $options: 'i' };
    }

    const advertisements = await Advertisement.find(query)
      .populate('workerId', 'name phoneNumber profilePicture')
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

// ─── GET /api/advertisements/:id (view single)
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const advertisement = await Advertisement.findOne({
      _id: req.params.id,
      isDeleted: false,
    }).populate('workerId', 'name phoneNumber profilePicture');

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

    // Check ownership
    if (req.worker && advertisement.workerId?.toString() !== req.worker.id?.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this advertisement.',
      });
    }

    if (req.customer && advertisement.customerId?.toString() !== req.customer.id?.toString()) {
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
