import express from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireCustomer } from "../middleware/auth.js";
import Booking from "../bookingSchema.js";
import WorkerLiveLocation from "../models/WorkerLiveLocation.js";

const router = express.Router();

function validCoordinate(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
}

// Customer can read live location only for their own active booking.
router.get(
  "/customer/:bookingId",
  requireCustomer,
  asyncHandler(async (req, res) => {
    const { bookingId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({ success: false, message: "Invalid booking ID." });
    }

    const booking = await Booking.findOne({
      _id: bookingId,
      customerId: req.customer.id,
      isDeleted: false,
    })
      .select("latitude longitude location address status workerId")
      .lean();

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    const active = ["worker-assigned", "in-progress"].includes(booking.status);
    if (!active || !booking.workerId) {
      return res.json({
        success: true,
        data: {
          active: false,
          status: booking.status,
          destination: validCoordinate(booking.latitude, -90, 90) &&
            validCoordinate(booking.longitude, -180, 180)
            ? { latitude: Number(booking.latitude), longitude: Number(booking.longitude) }
            : null,
          worker: null,
        },
      });
    }

    const live = await WorkerLiveLocation.findOne({
      bookingId: booking._id,
      workerId: booking.workerId,
    })
      .select("latitude longitude accuracy heading speed updatedAt")
      .lean();

    return res.json({
      success: true,
      data: {
        active: true,
        status: booking.status,
        destination:
          validCoordinate(booking.latitude, -90, 90) && validCoordinate(booking.longitude, -180, 180)
            ? { latitude: Number(booking.latitude), longitude: Number(booking.longitude) }
            : null,
        worker: live
          ? {
              latitude: live.latitude,
              longitude: live.longitude,
              accuracy: live.accuracy,
              heading: live.heading,
              speed: live.speed,
              updatedAt: live.updatedAt,
            }
          : null,
      },
    });
  }),
);

export default router;
