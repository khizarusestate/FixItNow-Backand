import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireCustomer, requireAdmin, optionalAuth } from '../middleware/auth.js';
import Review from '../reviewSchema.js';
import Booking from '../bookingSchema.js';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';
import { notifyAdminNewReview } from '../services/notificationService.js';

const router = express.Router();

// ─── POST /api/reviews ─────────────────────────────────────────────────────────
// Create a review for a completed booking (customer only)
router.post('/', requireCustomer, asyncHandler(async (req, res) => {
  const { bookingId, rating, comment } = req.body;

  if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
    return res.status(400).json({ success: false, message: 'Valid booking ID is required.' });
  }

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
  }

  const booking = await Booking.findOne({
    _id: bookingId,
    customerId: req.customer.id,
    status: 'completed',
    isDeleted: false
  });

  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found or not completed.' });
  }

  if (!booking.workerId) {
    return res.status(400).json({ success: false, message: 'No worker assigned to this booking.' });
  }

  // Check if review already exists
  const existing = await Review.findOne({ bookingId });
  if (existing) {
    return res.status(409).json({ success: false, message: 'You have already reviewed this booking.' });
  }

  const review = await Review.create({
    bookingId,
    customerId: req.customer.id,
    workerId: booking.workerId,
    rating,
    comment: comment || ''
  });

  // NOTE: worker.rating/totalReviews are NOT recalculated here. They're already
  // maintained incrementally by finalizeBookingCompletion() (utils/bookingCompletion.js)
  // at booking-completion time, from booking.customerRating. This Review document is
  // a separate, optional detailed record (with a comment) — recalculating the
  // aggregate here too would double-count the same booking's rating.

  logger.info('Review created', { reviewId: review._id, bookingId, workerId: booking.workerId, rating });

  // Send notification to admin
  notifyAdminNewReview(review, booking).catch(() => {});

  return res.status(201).json({
    success: true,
    message: 'Review submitted successfully.',
    data: review
  });
}));

// ─── GET /api/reviews/worker/:workerId ──────────────────────────────────────────
// Get all reviews for a worker (public)
router.get('/worker/:workerId', asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.workerId)) {
    return res.status(400).json({ success: false, message: 'Invalid worker ID.' });
  }

  const { page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [reviews, total] = await Promise.all([
    Review.find({ workerId: req.params.workerId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('customerId', 'fullName')
      .lean(),
    Review.countDocuments({ workerId: req.params.workerId })
  ]);

  const avgAgg = await Review.aggregate([
    { $match: { workerId: new mongoose.Types.ObjectId(req.params.workerId) } },
    { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } }
  ]);

  return res.json({
    success: true,
    data: reviews,
    stats: {
      averageRating: avgAgg[0]?.avgRating ? Math.round(avgAgg[0].avgRating * 100) / 100 : 0,
      totalReviews: avgAgg[0]?.count || 0
    },
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) }
  });
}));

// ─── GET /api/reviews/my ────────────────────────────────────────────────────────
// Get reviews written by current customer
router.get('/my', requireCustomer, asyncHandler(async (req, res) => {
  const reviews = await Review.find({ customerId: req.customer.id })
    .sort({ createdAt: -1 })
    .populate('workerId', 'fullName primaryServiceCategory')
    .lean();

  return res.json({ success: true, data: reviews });
}));

// ─── DELETE /api/reviews/:id ────────────────────────────────────────────────────
// Delete a review (customer can delete their own)
router.delete('/:id', requireCustomer, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid review ID.' });
  }

  const review = await Review.findById(req.params.id);
  if (!review) {
    return res.status(404).json({ success: false, message: 'Review not found.' });
  }

  // Check authorization: customer can delete own review
  if (String(review.customerId) !== String(req.customer.id)) {
    return res.status(403).json({
      success: false,
      message: 'You can only delete your own reviews.'
    });
  }

  const deleted = await Review.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Review not found.' });
  }

  // NOTE: worker.rating/totalReviews aggregate fields are not touched here — see
  // the note in POST / above. They're owned by finalizeBookingCompletion().

  return res.json({ success: true, message: 'Review deleted successfully.' });
}));

export default router;
