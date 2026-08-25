import logger from "./logger.js";
import mongoose from "mongoose";
import Booking from "../bookingSchema.js";
import WorkerLiveLocation from "../models/WorkerLiveLocation.js";

const ARRIVAL_RADIUS_METERS = 100;
const MAX_RELIABLE_ACCURACY_METERS = 100;
const LOCATION_RETENTION_MS = 60 * 60 * 1000;

function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let io = null;
let userSockets = new Map(); // userId -> Set<socketId>
let adminSockets = new Map();
const lastLocationEmit = new Map();

export function initializeSocketIO(socketIOInstance) {
  io = socketIOInstance;
  logger.info("Socket manager initialized");

  socketIOInstance.on("connection", (socket) => {
    socket.on("worker-location-update", async (payload = {}) => {
      try {
        if (socket.userRole !== "worker" || !socket.userId) return;

        const bookingId = String(payload.bookingId || "");
        if (!mongoose.Types.ObjectId.isValid(bookingId)) return;

        const latitude = Number(payload.latitude);
        const longitude = Number(payload.longitude);
        const accuracy = payload.accuracy == null ? null : Number(payload.accuracy);
        const heading = payload.heading == null ? null : Number(payload.heading);
        const speed = payload.speed == null ? null : Number(payload.speed);

        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return;
        if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return;
        if (latitude === 0 && longitude === 0) return;
        if (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0)) return;
        if (heading != null && (!Number.isFinite(heading) || heading < 0 || heading > 360)) return;
        if (speed != null && (!Number.isFinite(speed) || speed < 0)) return;

        const booking = await Booking.findOne({
          _id: bookingId,
          workerId: socket.userId,
          status: { $in: ["assigned", "worker-assigned", "on-the-way", "in-progress"] },
          isDeleted: false,
        })
          .select("_id workerId customerId status latitude longitude serviceTitle")
          .lean();

        if (!booking?.customerId) return;

        const throttleKey = `${socket.userId}:${bookingId}`;
        const now = Date.now();
        const previous = lastLocationEmit.get(throttleKey) || 0;
        if (now - previous < 1500) return;
        lastLocationEmit.set(throttleKey, now);

        const updatedAt = new Date();
        let nextStatus = booking.status;
        let statusChanged = false;
        const destinationReady =
          Number.isFinite(Number(booking.latitude)) &&
          Number.isFinite(Number(booking.longitude));

        if (nextStatus === "assigned" || nextStatus === "worker-assigned") {
          nextStatus = "on-the-way";
          statusChanged = true;
        }

        if (
          nextStatus === "on-the-way" &&
          destinationReady &&
          (accuracy == null || accuracy <= MAX_RELIABLE_ACCURACY_METERS)
        ) {
          const distance = distanceMeters(
            latitude,
            longitude,
            Number(booking.latitude),
            Number(booking.longitude),
          );
          if (distance <= ARRIVAL_RADIUS_METERS) {
            nextStatus = "in-progress";
            statusChanged = true;
          }
        }

        if (statusChanged) {
          const statusUpdate = { status: nextStatus };
          if (nextStatus === "on-the-way") statusUpdate.onTheWayAt = updatedAt;
          if (nextStatus === "in-progress") statusUpdate.startedAt = updatedAt;
          await Booking.updateOne(
            { _id: booking._id, workerId: socket.userId, status: booking.status },
            {
              $set: statusUpdate,
              $push: {
                timeline: {
                  status: nextStatus,
                  timestamp: updatedAt,
                  note:
                    nextStatus === "on-the-way"
                      ? "Worker started travelling to the customer."
                      : "Worker reached the customer location and the job is now in progress.",
                },
              },
            },
          );
        }

        // Keep the canonical booking location in sync as well as the dedicated
        // live-location record. This makes refresh/reload and booking-list APIs
        // consistent with the realtime map.
        await Booking.updateOne(
          { _id: booking._id, workerId: socket.userId, isDeleted: false },
          {
            $set: {
              currentLatitude: latitude,
              currentLongitude: longitude,
              lastLocationUpdate: updatedAt,
            },
          },
        );

        await WorkerLiveLocation.findOneAndUpdate(
          { bookingId: booking._id },
          {
            $set: {
              workerId: booking.workerId,
              customerId: booking.customerId,
              latitude,
              longitude,
              accuracy,
              heading,
              speed,
              updatedAt,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );

        emitToUser(booking.customerId, "worker-location-update", {
          bookingId: String(booking._id),
          latitude,
          longitude,
          accuracy,
          heading,
          speed,
          status: nextStatus,
          updatedAt: updatedAt.toISOString(),
        });

        if (statusChanged) {
          emitToUser(booking.customerId, "booking-status-update", {
            bookingId: String(booking._id),
            serviceTitle: booking.serviceTitle,
            status: nextStatus,
            message:
              nextStatus === "on-the-way"
                ? "Your worker is on the way."
                : "Your worker has arrived and the service is now in progress.",
          });
          emitToAdmin("refresh", {
            type: "bookings",
            timestamp: updatedAt.toISOString(),
          });
        }
      } catch (error) {
        logger.warn("Worker live-location update failed", {
          error: error?.message,
          socketId: socket.id,
        });
      }
    });

    socket.on("disconnect", () => {
      if (socket.userId) {
        for (const key of lastLocationEmit.keys()) {
          if (key.startsWith(`${socket.userId}:`)) lastLocationEmit.delete(key);
        }
      }
    });
  });
}

export function addAdminSocket(adminId, socketId) {
  const normalizedAdminId = String(adminId);
  const existing = adminSockets.get(normalizedAdminId) || new Set();
  existing.add(socketId);
  adminSockets.set(normalizedAdminId, existing);
  return existing.size === 1;
}

export function removeAdminSocket(adminId, socketId) {
  const normalizedAdminId = String(adminId);
  const sockets = adminSockets.get(normalizedAdminId);
  if (!sockets) return false;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    adminSockets.delete(normalizedAdminId);
    return true;
  }
  adminSockets.set(normalizedAdminId, sockets);
  return false;
}

export function isAdminConnected(adminId) {
  return adminSockets.has(String(adminId));
}

export function getSocketIO() {
  if (!io) {
    throw new Error("Socket.IO not initialized. Call initializeSocketIO first.");
  }
  return io;
}

export function getUserSocket(userId) {
  const sockets = userSockets.get(String(userId));
  if (!sockets || sockets.size === 0) return undefined;
  return sockets.values().next().value;
}

export function isUserConnected(userId) {
  const sockets = userSockets.get(String(userId));
  return Boolean(sockets && sockets.size > 0);
}

export function setUserSocket(userId, socketId) {
  const normalizedUserId = String(userId);
  const existing = userSockets.get(normalizedUserId) || new Set();
  const becameOnline = existing.size === 0;
  existing.add(socketId);
  userSockets.set(normalizedUserId, existing);
  return becameOnline;
}

export function removeUserSocket(userId, socketId) {
  const normalizedUserId = String(userId);
  const sockets = userSockets.get(normalizedUserId);
  if (!sockets) return false;
  if (socketId) sockets.delete(socketId);
  if (sockets.size === 0) {
    userSockets.delete(normalizedUserId);
    return true;
  }
  userSockets.set(normalizedUserId, sockets);
  return false;
}

export function emitToUser(userId, event, data) {
  const normalizedUserId = String(userId);
  if (io && isUserConnected(normalizedUserId)) {
    io.to(`user:${normalizedUserId}`).emit(event, data);
    logger.debug("Socket emit to user", { userId: normalizedUserId, event });
    return true;
  }
  logger.debug("Socket emit failed - user not connected", {
    userId: normalizedUserId,
    event,
  });
  return false;
}

export function emitToAdmin(event, data) {
  if (io) {
    io.to("admin-room").emit(event, data);
    logger.debug("Socket emit to admin room", { event });
    return true;
  }
  return false;
}

export function emitToAdminUser(adminId, event, data) {
  if (io && adminId) {
    io.to(`admin:${String(adminId)}`).emit(event, data);
    logger.debug("Socket emit to admin user", { adminId: String(adminId), event });
    return true;
  }
  return false;
}

export function emitToSuperAdmins(event, data) {
  if (io) {
    io.to("super-admin-room").emit(event, data);
    logger.debug("Socket emit to super-admin room", { event });
    return true;
  }
  return false;
}

export function emitToWorkers(event, data) {
  if (io) {
    io.to("workers-room").emit(event, data);
    logger.debug("Socket emit to workers room", { event });
    return true;
  }
  return false;
}
