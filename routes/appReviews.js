import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin } from '../middleware/auth.js';
import { verifyToken } from '../utils/jwt.js';
import AppReview from '../appReviewSchema.js';
import Customer from '../customerSchema.js';
import Worker from '../workerSchema.js';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';
import { emitToAdmin, emitToUser } from '../utils/socketManager.js';
import { createNotification, notifyAllAdmins } from '../utils/createNotification.js';

const router = express.Router();

// ─── Helper: Check if user profile is complete ───────────────────────────────
async function checkProfileComplete(userId, userType) {
  if (userType === 'customer') {
    const customer = await Customer.findById(userId).lean();
    if (!customer) return { complete: false, message: 'Customer not found.' };
    if (!customer.fullName || !customer.email || !customer.phone) {
      return { complete: false, message: 'Please complete your profile before submitting a review.' };
    }
    return { complete: true, user: customer };
  }
  if (userType === 'worker') {
    const worker = await Worker.findById(userId).lean();
    if (!worker) return { complete: false, message: 'Worker not found.' };
    if (!worker.fullName || !worker.emailAddress || !worker.phoneNumber) {
      return { complete: false, message: 'Please complete your profile before submitting a review.' };
    }
    return { complete: true, user: worker };
  }
  return { complete: false, message: 'Invalid user type.' };
}

// ─── POST /api/app-reviews ───────────────────────────────────────────────────
// Submit a new app review — works for logged-in users AND guests
router.post('/', asyncHandler(async (req, res) => {
  const { rating, comment, guestName, guestEmail, guestPhone } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5 stars.' });
  }

  if (!comment || comment.trim().length === 0) {
    return res.status(400).json({ success: false, message: 'Comment is required.' });
  }

  if (comment.length > 500) {
    return res.status(400).json({ success: false, message: 'Comment must be 500 characters or less.' });
  }

  // Try to read auth token — optional for this endpoint
  let reviewData = {};

  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (token) {
    try {
      const decoded = verifyToken(token);
      if (decoded?.id && decoded?.role) {
        const profileCheck = await checkProfileComplete(decoded.id, decoded.role);
        if (profileCheck.complete) {
          const u = profileCheck.user;
          reviewData = {
            name: u.fullName,
            email: u.email || u.emailAddress,
            phone: u.phone || u.phoneNumber || '',
            submitterId: decoded.id,
            submitterType: decoded.role,
            submitterProfilePicture: u.profilePicture || null,
          };
        }
      }
    } catch {
      // Token invalid/expired — treat as guest
    }
  }

  // Guest path: require name + email in body
  if (!reviewData.name) {
    const name = (guestName || '').trim();
    const email = (guestEmail || '').trim().toLowerCase();
    if (!name || name.length < 2) {
      return res.status(400).json({ success: false, message: 'Please provide your name.' });
    }
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
    }
    reviewData = {
      name,
      email,
      phone: (guestPhone || '').trim(),
      submitterId: null,
      submitterType: 'guest',
      submitterProfilePicture: null,
    };
  }

  const review = await AppReview.create({
    ...reviewData,
    rating,
    comment: comment.trim(),
    status: 'pending',
  });

  logger.info('App review submitted', {
    reviewId: review._id,
    submitterId: reviewData.submitterId,
    submitterType: reviewData.submitterType,
    rating,
  });

  emitToAdmin('notification', {
    type: 'reviews',
    action: 'submitted',
    message: `New app review submitted by ${reviewData.name}`,
    timestamp: new Date().toISOString(),
  });

  emitToAdmin('refresh', { type: 'reviews', timestamp: new Date().toISOString() });
  notifyAllAdmins({
    title: 'New review submitted',
    message: `New app review submitted by ${reviewData.name}.`,
    type: 'info',
    relatedEntityId: review._id,
    link: '#reviews',
  }).catch(() => {});

  return res.status(201).json({
    success: true,
    message: 'Review submitted successfully! It will be reviewed by our team.',
    data: {
      id: review._id,
      name: review.name,
      rating: review.rating,
      comment: review.comment,
      status: review.status,
      createdAt: review.createdAt,
    },
  });
}));

// ─── GET /api/app-reviews/my ───────────────────────────────────────────────────
// Get current user's submitted reviews
router.get('/my', requireAuth, asyncHandler(async (req, res) => {
  const reviews = await AppReview.find({
    submitterId: req.user.id,
    submitterType: req.user.role
  })
    .sort({ createdAt: -1 })
    .lean();

  return res.json({
    success: true,
    data: reviews.map(review => ({
      id: review._id,
      name: review.name,
      email: review.email,
      phone: review.phone,
      rating: review.rating,
      comment: review.comment,
      status: review.status,
      adminNote: review.adminNote,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt
    }))
  });
}));

// ─── GET /api/app-reviews/active ──────────────────────────────────────────────
// Public endpoint: get approved reviews for display
router.get('/active', asyncHandler(async (req, res) => {
  const reviews = await AppReview.find({ status: 'approved' })
    .sort({ createdAt: -1 })
    .select('name rating comment submitterProfilePicture createdAt')
    .lean();

  return res.json({
    success: true,
    data: reviews.map(review => ({
      id: review._id,
      name: review.name,
      rating: review.rating,
      comment: review.comment,
      submitterProfilePicture: review.submitterProfilePicture,
      createdAt: review.createdAt
    }))
  });
}));

// ─── GET /api/app-reviews ─────────────────────────────────────────────────────
// Admin: list reviews (paginated + optional search)
router.get('/', requireAdmin, asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '12'), 10) || 12));
  const skip = (page - 1) * limit;
  const sortParam = String(req.query.sort || '-createdAt');

  const query = {};
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    query.status = status;
  }
  if (search && String(search).trim()) {
    const q = String(search).trim();
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [
      { name: rx },
      { email: rx },
      { phone: rx },
      { comment: rx }
    ];
  }

  let sort = { createdAt: -1 };
  if (sortParam === 'rating' || sortParam === '-rating') {
    sort = { rating: sortParam.startsWith('-') ? -1 : 1, createdAt: -1 };
  } else if (sortParam === 'createdAt' || sortParam === '-createdAt') {
    sort = { createdAt: sortParam.startsWith('-') ? -1 : 1 };
  }

  const [reviews, total] = await Promise.all([
    AppReview.find(query).sort(sort).skip(skip).limit(limit).lean(),
    AppReview.countDocuments(query)
  ]);

  const mapReview = (review) => ({
    id: review._id,
    name: review.name,
    email: review.email,
    phone: review.phone,
    rating: review.rating,
    comment: review.comment,
    status: review.status,
    submitterId: review.submitterId,
    submitterType: review.submitterType,
    submitterProfilePicture: review.submitterProfilePicture,
    adminNote: review.adminNote,
    reviewedAt: review.reviewedAt,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt
  });

  return res.json({
    success: true,
    count: total,
    data: reviews.map(mapReview),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  });
}));

// ─── PATCH /api/app-reviews/:id/status ────────────────────────────────────────
// Admin: approve or reject a review
router.patch('/:id/status', requireAdmin, asyncHandler(async (req, res) => {
  const { status, adminNote } = req.body;

  if (!status || !['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Status must be approved or rejected.' });
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid review ID.' });
  }

  const review = await AppReview.findById(req.params.id);
  if (!review) {
    return res.status(404).json({ success: false, message: 'Review not found.' });
  }

  review.status = status;
  review.adminNote = adminNote ? adminNote.trim() : '';
  review.reviewedAt = new Date();
  review.reviewedBy = req.admin.id;
  await review.save();

  logger.info('App review reviewed', {
    reviewId: review._id,
    status,
    reviewedBy: req.admin.id
  });

  // Notify submitter about approval/rejection (separate from account notifications)
  const statusMessage = `Your review has been ${status === 'approved' ? 'approved' : 'rejected'}.${adminNote ? ` Note: ${adminNote}` : ''}`;

  emitToUser(String(review.submitterId), 'app-review-status-update', {
    reviewId: review._id,
    status: review.status,
    adminNote: review.adminNote,
    message: statusMessage,
  });

  if (review.submitterId && review.submitterType) {
    await createNotification({
      userId: review.submitterId,
      userRole: review.submitterType,
      title: status === 'approved' ? 'Review approved' : 'Review rejected',
      message: statusMessage,
      type: status === 'approved' ? 'success' : 'warning',
      relatedEntityId: review._id,
      link: '#reviews',
    });
  }

  return res.json({
    success: true,
    message: `Review ${status === 'approved' ? 'approved' : 'rejected'} successfully.`,
    data: {
      id: review._id,
      status: review.status,
      adminNote: review.adminNote,
      reviewedAt: review.reviewedAt
    }
  });
}));

// ─── DELETE /api/app-reviews/:id ──────────────────────────────────────────────
// Admin: delete a review
router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid review ID.' });
  }

  const review = await AppReview.findByIdAndDelete(req.params.id);
  if (!review) {
    return res.status(404).json({ success: false, message: 'Review not found.' });
  }

  logger.info('App review deleted', { reviewId: req.params.id, deletedBy: req.admin.id });

  return res.json({ success: true, message: 'Review deleted successfully.' });
}));

// ─── GET /api/app-reviews/stats ───────────────────────────────────────────────
// Admin: review statistics
router.get('/stats', requireAdmin, asyncHandler(async (req, res) => {
  const [total, pending, approved, rejected] = await Promise.all([
    AppReview.countDocuments(),
    AppReview.countDocuments({ status: 'pending' }),
    AppReview.countDocuments({ status: 'approved' }),
    AppReview.countDocuments({ status: 'rejected' })
  ]);

  // Calculate average rating for approved reviews
  const approvedReviews = await AppReview.find({ status: 'approved' }).select('rating').lean();
  const avgRating = approvedReviews.length > 0 
    ? approvedReviews.reduce((sum, r) => sum + r.rating, 0) / approvedReviews.length 
    : 0;

  return res.json({
    success: true,
    data: { 
      total, 
      pending, 
      approved, 
      rejected,
      averageRating: Math.round(avgRating * 100) / 100
    }
  });
}));

export default router;
