import fs from "node:fs";
import crypto from "node:crypto";

const read = (p) => fs.readFileSync(p, "utf8");
const write = (p, s) => fs.writeFileSync(p, s, "utf8");
const replaceOnce = (s, a, b, label) => {
  if (!s.includes(a)) throw new Error(`Patch anchor not found: ${label}`);
  return s.replace(a, b);
};

const messages = `import express from "express";
import mongoose from "mongoose";
import crypto from "node:crypto";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import Booking from "../bookingSchema.js";
import Customer from "../customerSchema.js";
import Worker from "../workerSchema.js";
import Message from "../models/Message.js";
import Notification from "../notificationSchema.js";
import { emitToUser } from "../utils/socketManager.js";

const router = express.Router();
const CHAT_STATUSES = ["assigned", "worker-assigned", "on-the-way", "in-progress", "completed"];
const SEND_STATUSES = ["assigned", "worker-assigned", "on-the-way", "in-progress"];
const PAGE_SIZE = 50;

function encryptionKey() {
  const secret = process.env.MESSAGE_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error("MESSAGE_ENCRYPTION_KEY or JWT_SECRET must be configured.");
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

function encryptText(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return {
    text: ciphertext.toString("base64"),
    textIv: iv.toString("base64"),
    textAuthTag: cipher.getAuthTag().toString("base64"),
    textEncrypted: true,
  };
}

function decryptText(message) {
  if (!message?.textEncrypted || !message?.textIv || !message?.textAuthTag) return message?.text || "";
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(message.textIv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(message.textAuthTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(message.text, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "[Encrypted message unavailable]";
  }
}

function publicMessage(message) {
  const item = { ...message };
  item.text = decryptText(message);
  delete item.textIv;
  delete item.textAuthTag;
  delete item.textEncrypted;
  return item;
}

async function activeActor(req) {
  const role = req.user?.role;
  if (role === "customer") {
    const customer = await Customer.findOne({ _id: req.user.id, isDeleted: { $ne: true } })
      .select("isActive status")
      .lean();
    return customer && customer.isActive !== false && customer.status !== "rejected";
  }
  if (role === "worker") {
    const worker = await Worker.findOne({ _id: req.user.id, isDeleted: { $ne: true } })
      .select("isDisabled status approvalStatus")
      .lean();
    return worker && !worker.isDisabled && worker.status !== "rejected" && worker.approvalStatus !== "rejected";
  }
  return false;
}

async function getAuthorizedBooking(req, bookingId) {
  if (!(await activeActor(req))) return null;
  if (!mongoose.Types.ObjectId.isValid(bookingId)) return null;
  const role = req.user?.role;
  if (role !== "customer" && role !== "worker") return null;
  const query = {
    _id: bookingId,
    isDeleted: false,
    status: { $in: CHAT_STATUSES },
  };
  if (role === "customer") {
    query.customerId = req.user.id;
    query.workerId = { $ne: null };
  } else {
    query.workerId = req.user.id;
    query.customerId = { $ne: null };
  }
  return Booking.findOne(query)
    .select("_id customerId workerId customerName serviceTitle status")
    .lean();
}

function otherParticipant(booking, role) {
  if (role === "customer") return { id: String(booking.workerId), role: "worker", name: "Worker" };
  return { id: String(booking.customerId), role: "customer", name: booking.customerName || "Customer" };
}

router.get("/conversations", requireAuth, asyncHandler(async (req, res) => {
  const role = req.user?.role;
  if (!["customer", "worker"].includes(role) || !(await activeActor(req))) {
    return res.status(403).json({ success: false, message: "User access required." });
  }
  const bookingQuery = {
    isDeleted: false,
    status: { $in: CHAT_STATUSES },
    ...(role === "customer"
      ? { customerId: req.user.id, workerId: { $ne: null } }
      : { workerId: req.user.id, customerId: { $ne: null } }),
  };
  const bookings = await Booking.find(bookingQuery)
    .sort({ updatedAt: -1 })
    .select("_id customerId workerId customerName serviceTitle status updatedAt")
    .limit(100)
    .lean();
  if (!bookings.length) return res.json({ success: true, data: [] });
  const bookingIds = bookings.map((b) => b._id);
  const unread = await Message.aggregate([
    { $match: { bookingId: { $in: bookingIds }, recipientId: new mongoose.Types.ObjectId(req.user.id), readAt: null } },
    { $group: { _id: "$bookingId", count: { $sum: 1 } } },
  ]);
  const unreadMap = new Map(unread.map((x) => [String(x._id), x.count]));
  const latest = await Message.aggregate([
    { $match: { bookingId: { $in: bookingIds } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$bookingId", text: { $first: "$text" }, textIv: { $first: "$textIv" }, textAuthTag: { $first: "$textAuthTag" }, textEncrypted: { $first: "$textEncrypted" }, createdAt: { $first: "$createdAt" }, senderId: { $first: "$senderId" } } },
  ]);
  const latestMap = new Map(latest.map((x) => [String(x._id), x]));
  return res.json({
    success: true,
    data: bookings.map((booking) => {
      const last = latestMap.get(String(booking._id));
      return {
        bookingId: String(booking._id),
        serviceTitle: booking.serviceTitle,
        status: booking.status,
        participant: otherParticipant(booking, role),
        lastMessage: last ? { text: decryptText(last), createdAt: last.createdAt, senderId: String(last.senderId) } : null,
        unreadCount: unreadMap.get(String(booking._id)) || 0,
      };
    }),
  });
}));

router.get("/bookings/:bookingId", requireAuth, asyncHandler(async (req, res) => {
  const booking = await getAuthorizedBooking(req, req.params.bookingId);
  if (!booking) return res.status(404).json({ success: false, message: "Messaging is unavailable for this booking." });
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), PAGE_SIZE) : PAGE_SIZE;
  const before = req.query.before ? new Date(String(req.query.before)) : null;
  const filter = { bookingId: booking._id };
  if (before && !Number.isNaN(before.getTime())) filter.createdAt = { $lt: before };
  const rows = await Message.find(filter).sort({ createdAt: -1 }).limit(limit + 1).lean();
  const hasMore = rows.length > limit;
  const messages = rows.slice(0, limit).reverse().map(publicMessage);
  return res.json({
    success: true,
    data: {
      booking: { id: String(booking._id), serviceTitle: booking.serviceTitle, status: booking.status, participant: otherParticipant(booking, req.user.role) },
      messages,
      pagination: { limit, hasMore, nextBefore: hasMore && messages[0]?.createdAt ? messages[0].createdAt : null },
    },
  });
}));

router.post("/bookings/:bookingId", requireAuth, asyncHandler(async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ success: false, message: "Message cannot be empty." });
  if (text.length > 2000) return res.status(400).json({ success: false, message: "Message is too long." });
  const booking = await getAuthorizedBooking(req, req.params.bookingId);
  if (!booking || !SEND_STATUSES.includes(booking.status)) {
    return res.status(403).json({ success: false, message: "Messaging is only available after the worker is assigned." });
  }
  const recipient = otherParticipant(booking, req.user.role);
  const encrypted = encryptText(text);
  const message = await Message.create({
    bookingId: booking._id,
    senderId: req.user.id,
    senderRole: req.user.role,
    recipientId: recipient.id,
    recipientRole: recipient.role,
    ...encrypted,
  });
  const payload = { ...publicMessage(message.toObject()), bookingId: String(booking._id), senderId: String(message.senderId), recipientId: String(message.recipientId) };

  let notification = null;
  try {
    notification = await Notification.create({
      userId: recipient.id,
      userRole: recipient.role,
      senderId: req.user.id,
      relatedEntityId: booking._id,
      link: "#booking",
      title: "New message",
      message: "You received a new message.",
      type: "message",
    });
  } catch (error) {
    // The message is already durable; notification failure must not make the chat send fail.
  }

  emitToUser(recipient.id, "message-new", payload);
  emitToUser(recipient.id, "notification-new", {
    id: notification ? String(notification._id) : `message-${message._id}`,
    title: "New message",
    message: "You received a new message.",
    type: "message",
    relatedEntityId: String(booking._id),
    bookingId: String(booking._id),
    link: "#booking",
  });
  return res.status(201).json({ success: true, data: payload });
}));

router.patch("/bookings/:bookingId/read", requireAuth, asyncHandler(async (req, res) => {
  const booking = await getAuthorizedBooking(req, req.params.bookingId);
  if (!booking) return res.status(404).json({ success: false, message: "Conversation not found." });
  await Message.updateMany({ bookingId: booking._id, recipientId: req.user.id, readAt: null }, { $set: { readAt: new Date() } });
  await Notification.updateMany({ userId: req.user.id, userRole: req.user.role, relatedEntityId: booking._id, type: "message", isRead: false }, { $set: { isRead: true } });
  return res.json({ success: true, message: "Messages marked as read." });
}));

export default router;
`;

write("routes/messages.js", messages);

const model = `import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  senderRole: { type: String, enum: ["customer", "worker"], required: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, required: true },
  recipientRole: { type: String, enum: ["customer", "worker"], required: true },
  // Text is encrypted AES-256-GCM at rest. API responses expose only decrypted text.
  text: { type: String, required: true },
  textIv: { type: String, default: null },
  textAuthTag: { type: String, default: null },
  textEncrypted: { type: Boolean, default: false },
  readAt: { type: Date, default: null },
}, { timestamps: true });

messageSchema.index({ bookingId: 1, createdAt: 1 });
messageSchema.index({ recipientId: 1, readAt: 1, createdAt: -1 });

export default mongoose.model("Message", messageSchema);
`;
write("models/Message.js", model);

let index = read("index.js");
const callHandler = `

  const getAuthorizedCallBooking = async (bookingId) => {
    if (!socket.userId || !["customer", "worker"].includes(socket.userRole)) return null;
    if (!mongoose.Types.ObjectId.isValid(bookingId)) return null;
    const booking = await Booking.findOne({
      _id: bookingId,
      isDeleted: false,
      status: { $in: ["assigned", "worker-assigned", "on-the-way", "in-progress"] },
      ...(socket.userRole === "customer" ? { customerId: socket.userId, workerId: { $ne: null } } : { workerId: socket.userId, customerId: { $ne: null } }),
    }).select("_id customerId workerId serviceTitle status customerName").lean();
    if (!booking) return null;
    return booking;
  };

  socket.on("voice-call-start", async (payload = {}) => {
    try {
      const booking = await getAuthorizedCallBooking(String(payload.bookingId || ""));
      if (!booking) return socket.emit("voice-call-error", { message: "Voice calling is unavailable for this booking." });
      const targetUserId = socket.userRole === "customer" ? String(booking.workerId) : String(booking.customerId);
      if (!payload.targetUserId || String(payload.targetUserId) !== targetUserId) return socket.emit("voice-call-error", { message: "Invalid call recipient." });
      const callId = String(payload.callId || "");
      if (!/^[A-Za-z0-9_-]{12,100}$/.test(callId)) return socket.emit("voice-call-error", { message: "Invalid call session." });
      emitToUser(targetUserId, "voice-call-incoming", {
        callId,
        bookingId: String(booking._id),
        callerId: String(socket.userId),
        callerRole: socket.userRole,
        callerName: socket.userRole === "customer" ? "Customer" : "Worker",
        serviceTitle: booking.serviceTitle || "Booking",
      });
    } catch (error) {
      logger.warn("Voice call start rejected", { error: error?.message, socketId: socket.id });
      socket.emit("voice-call-error", { message: "Could not start the call." });
    }
  });

  socket.on("voice-call-signal", async (payload = {}) => {
    try {
      const booking = await getAuthorizedCallBooking(String(payload.bookingId || ""));
      if (!booking) return socket.emit("voice-call-error", { message: "Voice calling is unavailable for this booking." });
      const targetUserId = socket.userRole === "customer" ? String(booking.workerId) : String(booking.customerId);
      if (!payload.targetUserId || String(payload.targetUserId) !== targetUserId) return socket.emit("voice-call-error", { message: "Invalid call recipient." });
      if (!payload.callId || !payload.signal || typeof payload.signal !== "object") return;
      emitToUser(targetUserId, "voice-call-signal", {
        callId: String(payload.callId),
        bookingId: String(booking._id),
        senderId: String(socket.userId),
        signal: payload.signal,
      });
    } catch (error) {
      logger.debug("Voice call signal rejected", { error: error?.message, socketId: socket.id });
    }
  });

  socket.on("voice-call-end", async (payload = {}) => {
    try {
      const booking = await getAuthorizedCallBooking(String(payload.bookingId || ""));
      if (!booking) return;
      const targetUserId = socket.userRole === "customer" ? String(booking.workerId) : String(booking.customerId);
      if (payload.targetUserId && String(payload.targetUserId) !== targetUserId) return;
      emitToUser(targetUserId, "voice-call-ended", { callId: String(payload.callId || ""), bookingId: String(booking._id), senderId: String(socket.userId) });
    } catch (error) {
      logger.debug("Voice call end rejected", { error: error?.message, socketId: socket.id });
    }
  });
`;
index = replaceOnce(index, '  socket.on("disconnect", () => {', callHandler + '\n  socket.on("disconnect", () => {', "socket call handlers");
write("index.js", index);

console.log("Booking messenger backend upgrade applied.");
`;
