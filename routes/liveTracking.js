import express from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireCustomer } from "../middleware/auth.js";
import Booking from "../bookingSchema.js";
import WorkerLiveLocation from "../models/WorkerLiveLocation.js";

const router = express.Router();
const LOCATION_STALE_AFTER_MS = 30_000;

function validCoordinate(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
}

function isFresh(timestamp) {
  if (!timestamp) return false;
  const age = Date.now() - new Date(timestamp).getTime();
  return Number.isFinite(age) && age >= 0 && age <= LOCATION_STALE_AFTER_MS;
}

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
      .select("latitude longitude location address status workerId currentLatitude currentLongitude lastLocationUpdate")
      .lean();

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    const active = ["assigned", "worker-assigned", "on-the-way", "in-progress"].includes(booking.status);
    const destination =
      validCoordinate(booking.latitude, -90, 90) && validCoordinate(booking.longitude, -180, 180)
        ? { latitude: Number(booking.latitude), longitude: Number(booking.longitude) }
        : null;

    if (!active || !booking.workerId) {
      return res.json({ success: true, data: { active: false, status: booking.status, destination, worker: null } });
    }

    const live = await WorkerLiveLocation.findOne({ bookingId: booking._id, workerId: booking.workerId })
      .select("latitude longitude accuracy heading speed updatedAt")
      .lean();

    const liveFresh = live && isFresh(live.updatedAt);
    const bookingFresh = isFresh(booking.lastLocationUpdate);

    const worker = liveFresh && validCoordinate(live.latitude, -90, 90) && validCoordinate(live.longitude, -180, 180)
      ? {
          latitude: live.latitude,
          longitude: live.longitude,
          accuracy: live.accuracy,
          heading: live.heading,
          speed: live.speed,
          updatedAt: live.updatedAt,
        }
      : bookingFresh && validCoordinate(booking.currentLatitude, -90, 90) && validCoordinate(booking.currentLongitude, -180, 180)
        ? {
            latitude: booking.currentLatitude,
            longitude: booking.currentLongitude,
            accuracy: null,
            heading: null,
            speed: null,
            updatedAt: booking.lastLocationUpdate,
          }
        : null;

    return res.json({ success: true, data: { active: true, status: booking.status, destination, worker } });
  }),
);

export default router;
