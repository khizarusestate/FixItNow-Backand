import mongoose from "mongoose";
import Booking from "../bookingSchema.js";
import Conversation from "../models/Conversation.js";
import { emitToUser, isUserConnected } from "./socketManager.js";
import { sendWebPushToUser } from "./webPush.js";

const ACTIVE_STATUSES = new Set(["worker-assigned", "on-the-way", "in-progress"]);
const USER_ROLES = new Set(["customer", "worker"]);

async function authorizeSupportCall(socket, conversationId, targetUserId) {
  if (!socket.isAdmin || !mongoose.Types.ObjectId.isValid(conversationId) || !mongoose.Types.ObjectId.isValid(targetUserId)) return null;
  return Conversation.findOne({
    _id: conversationId,
    type: "support",
    participants: {
      $elemMatch: {
        userId: new mongoose.Types.ObjectId(targetUserId),
        role: { $in: [...USER_ROLES] },
      },
    },
  }).select("_id").lean();
}

async function authorizeCall(socket, bookingId, targetUserId) {
  if (!socket.userId || !socket.userRole || !mongoose.Types.ObjectId.isValid(bookingId)) return null;
  if (!mongoose.Types.ObjectId.isValid(targetUserId)) return null;

  if (socket.isAdmin) {
    return authorizeSupportCall(socket, bookingId, targetUserId);
  }

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
      if (!booking) {
        return socket.emit("voice-call-error", { message: "Voice calls are unavailable for this conversation or booking." });
      }

      const targetUserId = String(data.targetUserId);
      const callId = String(data.callId || "");
      if (!callId) return socket.emit("voice-call-error", { message: "Invalid voice call." });

      const callerName = String(
        data.participantName || (socket.isAdmin ? "Admin" : socket.userRole === "worker" ? "Worker" : "Customer"),
      );

      emitToUser(targetUserId, "voice-call-incoming", {
        bookingId: String(booking._id),
        callId,
        callerId: String(socket.userId || socket.adminId || "admin"),
        callerRole: socket.isAdmin ? "admin" : socket.userRole,
        callerName,
        targetUserId,
      });

      if (!socket.isAdmin && !isUserConnected(targetUserId)) {
        void sendWebPushToUser(
          targetUserId,
          socket.userRole === "worker" ? "customer" : "worker",
          {
            title: "Incoming voice call",
            message: `${callerName} is calling you on FixItNow.`,
            type: "urgent",
            tag: `voice-call-${callId}`,
            url: "/",
          },
        ).catch(() => {});
      }
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
        callerId: String(socket.userId || socket.adminId || "admin"),
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
      // Ending a call is best-effort.
    }
  });
}
