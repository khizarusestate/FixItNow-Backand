import mongoose from "mongoose";
import Booking from "../bookingSchema.js";
import { emitToUser } from "./socketManager.js";

const ACTIVE_STATUSES = new Set(["worker-assigned", "on-the-way", "in-progress"]);

async function authorizeCall(socket, bookingId, targetUserId) {
  if (!socket.userId || !socket.userRole || !mongoose.Types.ObjectId.isValid(bookingId)) return null;
  if (!mongoose.Types.ObjectId.isValid(targetUserId)) return null;

  const booking = await Booking.findOne({
    _id: bookingId,
    isDeleted: false,
    status: { $in: [...ACTIVE_STATUSES] },
    ...(socket.userRole === "worker"
      ? { workerId: socket.userId, customerId: targetUserId }
      : { customerId: socket.userId, workerId: targetUserId }),
  })
    .select("_id customerId workerId status")
    .lean();

  return booking || null;
}

export function registerVoiceCallSocketHandlers(socket) {
  socket.on("voice-call-start", async (data = {}) => {
    try {
      const booking = await authorizeCall(socket, data.bookingId, data.targetUserId);
      if (!booking) return socket.emit("voice-call-error", { message: "Voice calls are unavailable for this booking." });
      emitToUser(String(data.targetUserId), "voice-call-incoming", {
        bookingId: String(booking._id),
        callId: String(data.callId || ""),
        callerId: String(socket.userId),
        callerRole: socket.userRole,
        callerName: String(data.participantName || (socket.userRole === "worker" ? "Worker" : "Customer")),
        targetUserId: String(data.targetUserId),
      });
    } catch {
      socket.emit("voice-call-error", { message: "Could not start the voice call." });
    }
  });

  socket.on("voice-call-signal", async (data = {}) => {
    try {
      const booking = await authorizeCall(socket, data.bookingId, data.targetUserId);
      if (!booking || !data.callId || !data.signal?.type) return;
      emitToUser(String(data.targetUserId), "voice-call-signal", {
        bookingId: String(booking._id),
        callId: String(data.callId),
        callerId: String(socket.userId),
        targetUserId: String(data.targetUserId),
        signal: data.signal,
      });
    } catch {
      socket.emit("voice-call-error", { message: "Voice connection negotiation failed." });
    }
  });

  socket.on("voice-call-end", async (data = {}) => {
    try {
      const booking = await authorizeCall(socket, data.bookingId, data.targetUserId);
      if (!booking || !data.callId) return;
      emitToUser(String(data.targetUserId), "voice-call-ended", {
        bookingId: String(booking._id),
        callId: String(data.callId),
      });
    } catch {
      // Ending a call is best-effort and must never crash the socket.
    }
  });
}
