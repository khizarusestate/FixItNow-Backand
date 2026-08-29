import express from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireCustomer } from "../middleware/auth.js";
import Booking from "../bookingSchema.js";
import WorkerLiveLocation from "../models/WorkerLiveLocation.js";

const router = express.Router();
const LOCATION_STALE_AFTER_MS = 30_000;
const GEOCODE_TIMEOUT_MS = 4_000;

function validCoordinate(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
}

function validPoint(latitude, longitude) {
  return validCoordinate(latitude, -90, 90)
    && validCoordinate(longitude, -180, 180)
    && !(Number(latitude) === 0 && Number(longitude) === 0);
}

function isFresh(timestamp) {
  if (!timestamp) return false;
  const age = Date.now() - new Date(timestamp).getTime();
  return Number.isFinite(age) && age >= 0 && age <= LOCATION_STALE_AFTER_MS;
}

async function geocodeLegacyBooking(booking) {
  const query = String(booking.location || booking.address || "").trim();
  if (!query) return null;

  const base = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
  const url = new URL(`${base}/search`);
  url.searchParams.set("format", "json");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "pk");
  url.searchParams.set("accept-language", "en");
  url.searchParams.set("addressdetails", "1");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": process.env.NOMINATIM_USER_AGENT || "FixItNow/1.0",
        Accept: "application/json",
      },
    });
    if (!response.ok) return null;
    const rows = await response.json();
    const item = Array.isArray(rows) ? rows[0] : null;
    if (!item || !validPoint(item.lat, item.lon)) return null;

    const latitude = Number(item.lat);
    const longitude = Number(item.lon);
    await Booking.updateOne(
      { _id: booking._id },
      {
        $set: {
          latitude,
          longitude,
          ...(item.place_id ? { placeId: String(item.place_id) } : {}),
        },
      },
    );
    return { latitude, longitude };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
    let destination = validPoint(booking.latitude, booking.longitude)
      ? { latitude: Number(booking.latitude), longitude: Number(booking.longitude) }
      : null;

    // Older bookings may contain only a text address. Recover a coordinate once
    // so they can use the same live-tracking flow as newly created bookings.
    if (active && !destination) {
      destination = await geocodeLegacyBooking(booking);
    }

    if (!active || !booking.workerId) {
      return res.json({ success: true, data: { active: false, status: booking.status, destination, worker: null } });
    }

    const live = await WorkerLiveLocation.findOne({ bookingId: booking._id, workerId: booking.workerId })
      .select("latitude longitude accuracy heading speed updatedAt")
      .lean();

    const liveFresh = live && isFresh(live.updatedAt);
    const bookingFresh = isFresh(booking.lastLocationUpdate);

    const worker = liveFresh && validPoint(live.latitude, live.longitude)
      ? {
          latitude: live.latitude,
          longitude: live.longitude,
          accuracy: live.accuracy,
          heading: live.heading,
          speed: live.speed,
          updatedAt: live.updatedAt,
        }
      : bookingFresh && validPoint(booking.currentLatitude, booking.currentLongitude)
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
