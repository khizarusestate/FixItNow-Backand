import mongoose from "mongoose";
import Booking from "../bookingSchema.js";
import Worker from "../workerSchema.js";
import Customer from "../customerSchema.js";
import logger from "./logger.js";

/**
 * Apply earnings, rating, and completed status when both parties marked done.
 */
export async function finalizeBookingCompletion(booking, worker, customerId) {
  const serviceFee = Math.round(booking.price * 0.2);
  const workerEarnings = booking.price - serviceFee;
  const rating = booking.customerRating;

  const currentTotalRating = (worker.rating || 0) * (worker.totalReviews || 0);
  const newTotalReviews = (worker.totalReviews || 0) + 1;
  const newRating =
    rating != null
      ? (currentTotalRating + rating) / newTotalReviews
      : worker.rating || 0;

  booking.status = "completed";
  booking.completedAt = new Date();
  const prevPayment =
    booking.paymentDetails?.toObject?.() ||
    booking.paymentDetails ||
    {};
  booking.paymentDetails = {
    ...prevPayment,
    totalAmount: booking.price,
    serviceFee,
    workerEarnings,
    platformCommission: serviceFee,
    processedAt: new Date(),
  };
  booking.timeline.push({
    status: "completed",
    timestamp: new Date(),
    note: `Job fully completed. Customer rating: ${rating ?? "n/a"} stars. Worker: ${worker.fullName}. Commission: ₨${serviceFee}. Worker earnings: ₨${workerEarnings}`,
  });

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await booking.save({ session });
      await Worker.findByIdAndUpdate(
        worker._id,
        {
          status: "active",
          $inc: {
            completedJobs: 1,
            totalEarnings: workerEarnings,
            totalReviews: rating != null ? 1 : 0,
            activeJobs: -1,
          },
          ...(rating != null ? { rating: newRating } : {}),
          lastActive: new Date(),
        },
        { session },
      );
      if (customerId) {
        await Customer.findByIdAndUpdate(
          customerId,
          { $inc: { completedBookings: 1, pendingBookings: -1 } },
          { session },
        );
      }
    });
  } catch (transactionError) {
    logger.warn("Transaction failed, falling back to non-transactional finalize", {
      error: transactionError.message,
    });
    await booking.save();
    await Worker.findByIdAndUpdate(worker._id, {
      status: "active",
      $inc: {
        completedJobs: 1,
        totalEarnings: workerEarnings,
        totalReviews: rating != null ? 1 : 0,
        activeJobs: -1,
      },
      ...(rating != null ? { rating: newRating } : {}),
      lastActive: new Date(),
    });
    if (customerId) {
      await Customer.findByIdAndUpdate(customerId, {
        $inc: { completedBookings: 1, pendingBookings: -1 },
      });
    }
  } finally {
    await session.endSession();
  }

  return { serviceFee, workerEarnings, newRating };
}

export function isBookingFullyDone(booking) {
  return Boolean(booking?.customerMarkedDone && booking?.workerMarkedDone);
}
