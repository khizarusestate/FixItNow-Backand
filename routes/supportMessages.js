import express from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import Message from "../models/Message.js";
import Conversation from "../models/Conversation.js";
import Admin from "../models/Admin.js";
import Customer from "../customerSchema.js";
import Worker from "../workerSchema.js";
import { decryptStoredMessage, encryptMessage } from "../utils/messageCrypto.js";
import { emitToUser, isUserConnected } from "../utils/socketManager.js";
import Notification from "../notificationSchema.js";
import { sendWebPushToUser } from "../utils/webPush.js";

const router = express.Router();
const USER_ROLES = ["customer", "worker", "admin"];

function publicMessage(message) {
  const item = typeof message.toObject === "function" ? message.toObject() : { ...message };
  item.text = decryptStoredMessage(item.text, item.encryptionVersion);
  return item;
}

async function usableUser(userId, role) {
  if (role === "admin") return true;
  if (role === "customer") {
    const u = await Customer.findOne({ _id: userId, isDeleted: { $ne: true } }).select("_id isActive status").lean();
    return u && u.isActive !== false && u.status !== "rejected";
  }
  if (role === "worker") {
    const u = await Worker.findOne({ _id: userId, isDeleted: { $ne: true } }).select("_id isDisabled status approvalStatus").lean();
    return u && !u.isDisabled && u.status !== "rejected" && u.approvalStatus !== "rejected";
  }
  return false;
}

async function findOrCreate(userId, role, adminId) {
  let conversation = await Conversation.findOne({ type: "support", bookingId: null, participants: { $all: [
    { $elemMatch: { userId: new mongoose.Types.ObjectId(userId), role } },
    { $elemMatch: { userId: new mongoose.Types.ObjectId(adminId), role: "admin" } },
  ] } });
  if (!conversation) conversation = await Conversation.create({ type: "support", participants: [{ userId, role }, { userId: adminId, role: "admin" }] });
  return conversation;
}

async function nameOf(participant) {
  if (participant.role === "admin") {
    const admin = await Admin.findById(participant.userId).select("name").lean();
    return admin?.name || "FixItNow Admin";
  }
  const Model = participant.role === "customer" ? Customer : Worker;
  const u = await Model.findById(participant.userId).select("name fullName firstName lastName").lean();
  return u?.name || u?.fullName || [u?.firstName, u?.lastName].filter(Boolean).join(" ") || (participant.role === "customer" ? "Customer" : "Worker");
}

router.post("/open", requireAuth, asyncHandler(async (req, res) => {
  const role = req.user?.role;
  if (!["customer", "worker"].includes(role)) return res.status(403).json({ success: false, message: "User access required." });
  if (!(await usableUser(req.user.id, role))) return res.status(403).json({ success: false, message: "Your account is not permitted to use messaging." });

  const requestedAdminId = req.body?.adminId;
  const adminQuery = requestedAdminId && mongoose.Types.ObjectId.isValid(requestedAdminId) ? { _id: requestedAdminId, isActive: { $ne: false } } : { isActive: { $ne: false } };
  const admin = await Admin.findOne(adminQuery).sort({ role: -1, lastLogin: -1 }).select("_id name").lean();
  if (!admin) return res.status(503).json({ success: false, message: "No active support administrator is available." });

  const conversation = await findOrCreate(req.user.id, role, admin._id);
  return res.json({ success: true, data: { conversationId: String(conversation._id), participant: { id: String(admin._id), role: "admin", name: admin.name || "FixItNow Admin" } } });
}));

router.get("/mine", requireAuth, asyncHandler(async (req, res) => {
  const role = req.user?.role;
  if (!USER_ROLES.includes(role)) return res.status(403).json({ success: false, message: "User access required." });
  const conversations = await Conversation.find({ type: "support", participants: { $elemMatch: { userId: req.user.id, role } } }).sort({ updatedAt: -1 }).lean();
  const rows = await Promise.all(conversations.map(async (c) => {
    const other = c.participants.find((p) => String(p.userId) !== String(req.user.id));
    const unreadCount = await Message.countDocuments({ conversationId: c._id, recipientId: req.user.id, readAt: null });
    return { conversationId: String(c._id), participant: other ? { id: String(other.userId), role: other.role, name: await nameOf(other) } : null, lastMessage: c.lastMessage ? { text: decryptStoredMessage(c.lastMessage), createdAt: c.lastMessageAt } : null, unreadCount };
  }));
  return res.json({ success: true, data: rows });
}));

router.get("/:conversationId", requireAuth, asyncHandler(async (req, res) => {
  const role = req.user?.role;
  if (!USER_ROLES.includes(role)) return res.status(403).json({ success: false, message: "User access required." });
  if (!mongoose.Types.ObjectId.isValid(req.params.conversationId)) return res.status(404).json({ success: false, message: "Conversation not found." });
  const conversation = await Conversation.findOne({ _id: req.params.conversationId, type: "support", participants: { $elemMatch: { userId: req.user.id, role } } }).lean();
  if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });
  const rows = await Message.find({ conversationId: conversation._id }).sort({ createdAt: 1, _id: 1 }).limit(100).lean();
  const other = conversation.participants.find((p) => String(p.userId) !== String(req.user.id));
  return res.json({ success: true, data: { conversation: { id: String(conversation._id), type: "support", participant: other ? { id: String(other.userId), role: other.role, name: await nameOf(other) } : null }, messages: rows.map(publicMessage) } });
}));

router.post("/:conversationId", requireAuth, asyncHandler(async (req, res) => {
  const role = req.user?.role;
  if (!USER_ROLES.includes(role)) return res.status(403).json({ success: false, message: "User access required." });
  if (!mongoose.Types.ObjectId.isValid(req.params.conversationId)) return res.status(404).json({ success: false, message: "Conversation not found." });
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ success: false, message: "Message cannot be empty." });
  if (text.length > 2000) return res.status(400).json({ success: false, message: "Message is too long." });
  const conversation = await Conversation.findOne({ _id: req.params.conversationId, type: "support", participants: { $elemMatch: { userId: req.user.id, role } } }).lean();
  if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });
  const recipient = conversation.participants.find((p) => String(p.userId) !== String(req.user.id));
  if (!recipient || !(await usableUser(recipient.userId, recipient.role))) return res.status(403).json({ success: false, message: "Recipient account is unavailable." });
  const message = await Message.create({ conversationId: conversation._id, senderId: req.user.id, senderRole: role, recipientId: recipient.userId, recipientRole: recipient.role, text: encryptMessage(text), encryptionVersion: 1 });
  await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessage: message.text, lastMessageAt: message.createdAt } });
  const payload = { ...publicMessage(message), conversationId: String(conversation._id) };
  const notification = await Notification.create({ userId: recipient.userId, userRole: recipient.role, senderId: req.user.id, relatedEntityId: conversation._id, link: "#messages", title: role === "admin" ? "New message from FixItNow Admin" : "New message from FixItNow Support", message: text.length > 100 ? `${text.slice(0, 100)}…` : text, type: "message" });
  emitToUser(recipient.userId, "message-new", payload);
  emitToUser(recipient.userId, "notification-new", { id: String(notification._id), title: notification.title, message: notification.message, type: notification.type, relatedEntityId: String(conversation._id), conversationId: String(conversation._id), link: notification.link });
  if (!isUserConnected(recipient.userId)) void sendWebPushToUser(recipient.userId, recipient.role, { title: notification.title, message: notification.message, type: "message", tag: `support-${conversation._id}`, url: "/" }).catch(() => {});
  return res.status(201).json({ success: true, data: payload });
}));

router.patch("/:conversationId/read", requireAuth, asyncHandler(async (req, res) => {
  const role = req.user?.role;
  if (!USER_ROLES.includes(role)) return res.status(403).json({ success: false, message: "User access required." });
  const conversation = await Conversation.findOne({ _id: req.params.conversationId, type: "support", participants: { $elemMatch: { userId: req.user.id, role } } }).lean();
  if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });
  await Message.updateMany({ conversationId: conversation._id, recipientId: req.user.id, readAt: null }, { $set: { readAt: new Date() } });
  await Notification.updateMany({ userId: req.user.id, relatedEntityId: conversation._id, type: "message", isRead: false }, { $set: { isRead: true } });
  return res.json({ success: true, message: "Messages marked as read." });
}));

export default router;
