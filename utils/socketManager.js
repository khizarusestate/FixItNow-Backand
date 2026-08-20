import logger from "./logger.js";
import mongoose from "mongoose";
import Booking from "../bookingSchema.js";
import WorkerLiveLocation from "../models/WorkerLiveLocation.js";

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
        if (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0)) return;
        if (heading != null && (!Number.isFinite(heading) || heading < 0 || heading > 360)) return;
        if (speed != null && (!Number.isFinite(speed) || speed < 0)) return;

        const booking = await Booking.findOne({
          _id: bookingId,
          workerId: socket.userId,
          status: { $in: ["assigned", "worker-assigned", "in-progress"] },
          isDeleted: false,
        })
          .select("_id workerId customerId status")
          .lean();

        if (!booking?.customerId) return;

        const throttleKey = `${socket.userId}:${bookingId}`;
        const now = Date.now();
        const previous = lastLocationEmit.get(throttleKey) || 0;
        if (now - previous < 1500) return;
        lastLocationEmit.set(throttleKey, now);

        const updatedAt = new Date();
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
          status: booking.status,
          updatedAt: updatedAt.toISOString(),
        });
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
