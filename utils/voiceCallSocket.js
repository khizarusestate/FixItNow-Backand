import mongoose from "mongoose";
import Booking from "../bookingSchema.js";
import Conversation from "../models/Conversation.js";
import { emitToAdminUser, emitToUser, isAdminConnected, isUserConnected } from "./socketManager.js";
import { sendWebPushToUser } from "./webPush.js";

const ACTIVE_STATUSES = new Set(["worker-assigned", "on-the-way", "in-progress"]);
const USER_ROLES = new Set(["customer", "worker"]);

async function authorizeSupportCall(socket, conversationId, targetUserId) {
  if (!socket.isAdmin || !mongoose.Types.ObjectId.isValid(conversationId) || !mongoose.Types.ObjectId.isValid(targetUserId)) return null;
  return Conversation.findOne({
    _id: conversationId,
    type: "support",
    participants: { $elemMatch: { userId: new mongoose.Types.ObjectId(targetUserId), role: { $in: [...USER_ROLES] } } },
  }).select("_id").lean();
}

async function authorizeSupportUserSignal(socket, conversationId) {
  if (socket.isAdmin || !socket.userId || !mongoose.Types.ObjectId.isValid(conversationId)) return null;
  return Conversation.findOne({
    _id: conversationId,
    type: "support",
    participants: { $elemMatch: { userId: new mongoose.Types.ObjectId(socket.userId), role: socket.userRole } },
  }).select("_id").lean();
}

async function authorizeBookingCall(socket, bookingId, targetUserId) {
  if (!socket.userId || !socket.userRole || !mongoose.Types.ObjectId.isValid(bookingId) || !mongoose.Types.ObjectId.isValid(targetUserId)) return null;
  return Booking.findOne({
    _id: bookingId,
    isDeleted: false,
    status: { $in: [...ACTIVE_STATUSES] },
    ...(socket.userRole === "worker"
      ? { workerId: socket.userId, customerId: targetUserId }
      : { customerId: socket.userId, workerId: targetUserId }),
  }).select("_id customerId workerId status").lean();
}

export function registerVoiceCallSocketHandlers(socket) {
  socket.on("voice-call-start", async (data = {}) => {
    try {
      if (!socket.isAdmin) {
        const booking = await authorizeBookingCall(socket, data.bookingId, data.targetUserId);
        if (!booking) return socket.emit("voice-call-error", { message: "Voice calls are unavailable for this booking." });
        const callId = String(data.callId || "");
        if (!callId) return socket.emit("voice-call-error", { message: "Invalid voice call." });
        const targetUserId = String(data.targetUserId);
        const callerName = String(data.participantName || (socket.userRole === "worker" ? "Worker" : "Customer"));
        emitToUser(targetUserId, "voice-call-incoming", { bookingId: String(booking._id), callId, callerId: String(socket.userId), callerRole: socket.userRole, callerName, targetUserId });
        if (!isUserConnected(targetUserId)) {
          void sendWebPushToUser(targetUserId, socket.userRole === "worker" ? "customer" : "worker", {
            title: "Incoming voice call",
            message: `${callerName} is calling you on FixItNow.`,
            type: "urgent",
            tag: `voice-call-${callId}`,
            url: "/",
          }).catch(() => {});
        }
        return;
      }

      const conversation = await authorizeSupportCall(socket, data.bookingId, data.targetUserId);
      if (!conversation) return socket.emit("voice-call-error", { message: "Voice calls are unavailable for this support conversation." });
      const callId = String(data.callId || "");
      if (!callId) return socket.emit("voice-call-error", { message: "Invalid voice call." });
      const targetUserId = String(data.targetUserId);
      emitToUser(targetUserId, "voice-call-incoming", {
        bookingId: String(conversation._id),
        callId,
        callerId: String(socket.adminId),
        callerRole: "admin",
        callerName: String(data.participantName || "Admin"),
        targetUserId,
      });
    } catch {
      socket.emit("voice-call-error", { message: "Could not start the voice call." });
    }
  });

  socket.on("voice-call-signal", async (data = {}) => {
    try {
      if (socket.isAdmin) {
        const conversation = await authorizeSupportCall(socket, data.bookingId, data.targetUserId);
        if (!conversation || !data.callId || !data.signal?.type) return;
        emitToUser(String(data.targetUserId), "voice-call-signal", {
          bookingId: String(conversation._id),
          callId: String(data.callId),
          callerId: String(socket.adminId),
          targetUserId: String(data.targetUserId),
          signal: data.signal,
        });
        return;
      }

      const booking = await authorizeBookingCall(socket, data.bookingId, data.targetUserId);
      if (booking && data.callId && data.signal?.type) {
        emitToUser(String(data.targetUserId), "voice-call-signal", {
          bookingId: String(booking._id),
          callId: String(data.callId),
          callerId: String(socket.userId),
          targetUserId: String(data.targetUserId),
          signal: data.signal,
        });
        return;
      }

      const conversation = await authorizeSupportUserSignal(socket, data.bookingId);
      if (!conversation || !data.callId || !data.signal?.type || !isAdminConnected(data.targetUserId)) return;
      emitToAdminUser(String(data.targetUserId), "voice-call-signal", {
        bookingId: String(conversation._id),
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
      if (socket.isAdmin) {
        const conversation = await authorizeSupportCall(socket, data.bookingId, data.targetUserId);
        if (!conversation || !data.callId) return;
        emitToUser(String(data.targetUserId), "voice-call-ended", { bookingId: String(conversation._id), callId: String(data.callId) });
        return;
      }

      const booking = await authorizeBookingCall(socket, data.bookingId, data.targetUserId);
      if (booking && data.callId) {
        emitToUser(String(data.targetUserId), "voice-call-ended", { bookingId: String(booking._id), callId: String(data.callId) });
        return;
      }

      const conversation = await authorizeSupportUserSignal(socket, data.bookingId);
      if (!conversation || !data.callId || !isAdminConnected(data.targetUserId)) return;
      emitToAdminUser(String(data.targetUserId), "voice-call-ended", { bookingId: String(conversation._id), callId: String(data.callId) });
    } catch {
      // Ending a call is best-effort.
    }
  });
}
