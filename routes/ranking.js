import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin } from '../middleware/auth.js';
import Booking from '../bookingSchema.js';
import mongoose from 'mongoose';
import { rankWorkersForBooking } from '../utils/workerRanking.js';

const router = express.Router();

router.get('/booking/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: 'Invalid booking ID.' });
  }

  const booking = await Booking.findOne({ _id: id, isDeleted: false });
  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found.' });
  }

  const rankedWorkers = await rankWorkersForBooking(booking);

  return res.json({
    success: true,
    data: {
      booking: {
        id: booking._id,
        serviceTitle: booking.serviceTitle,
        serviceCategory: booking.serviceCategory || booking.category,
      },
      workers: rankedWorkers,
    },
  });
}));

export default router;
