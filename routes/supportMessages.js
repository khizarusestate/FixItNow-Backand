import express from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import Customer from "../customerSchema.js";
import Worker from "../workerSchema.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import { emitToAdmin, emitToUser } from "../utils/socketManager.js";
import { decryptStoredMessage, encryptMessage } from "../utils/messageCrypto.js";

const router = express.Router();
const MAX_PAGE_SIZE = 50;
const USER_ROLES = ["customer", "worker"];

function publicMessage(message) {
  const item = typeof message.toObject === "function" ? message.toObject() : { ...message };
  item.text = decryptStoredMessage(item.text, item.encryptionVersion);
  return item;
}

function objectId(id) {
  return new mongoose.Types.ObjectId(id);
}

async function getUserProfile(role, id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  if (role === "customer") {
    return Customer.findOne({ _id: id, isDeleted: { $ne: true } }).select("_id fullName email phone").lean();
  }
  if (role === "worker") {
    return Worker.findOne({ _id: id, isDeleted: { $ne: true } }).select("_id fullName email phoneNumber").lean();
  }
  return null;
}

async function ensureUserConversation(req) {
  const role = req.user?.role;
  if (!USER_ROLES.includes(role)) return null;
  let conversation = await Conversation.findOne({
    type: "support",
    participants: { $elemMatch: { userId: objectId(req.user.id), role } },
  });
  if (conversation) return conversation;
  const profile = await getUserProfile(role, req.user.id);
  if (!profile) return null;
  return Conversation.create({
    type: "support",
    participants: [{ userId: profile._id, role, name: profile.fullName || profile.email || role }],
  });
}

function userConversationView(conversation, role) {
  const participant = conversation.participants.find((item) => item.role === role);
  return {
    id: String(conversation._id),
    type: conversation.type,
    participant: participant ? { id: String(participant.userId), role: participant.role, name: participant.name } : null,
    lastMessageAt: conversation.lastMessageAt,
    lastMessagePreview: conversation.lastMessagePreview,
  };
}

function adminConversationView(conversation) {
  const user = conversation.participants.find((item) => USER_ROLES.includes(item.role));
  const admin = conversation.participants.find((item) => item.role === "admin");
  return {
    id: String(conversation._id),
    type: conversation.type,
    user: user ? { id: String(user.userId), role: user.role, name: user.name } : null,
    admin: admin ? { id: String(admin.userId), name: admin.name } : null,
    lastMessageAt: conversation.lastMessageAt,
    lastMessagePreview: conversation.lastMessagePreview,
  };
}

// ── Customer/worker support ──────────────────────────────────────────────────
router.get("/conversations", requireAuth, asyncHandler(async (req, res) => {
  if (!USER_ROLES.includes(req.user?.role)) return res.status(403).json({ success: false, message: "User access required." });
  const conversation = await ensureUserConversation(req);
  if (!conversation) return res.status(404).json({ success: false, message: "User account not found." });
  return res.json({ success: true, data: [userConversationView(conversation, req.user.role)] });
}));

router.get("/conversations/:conversationId", requireAuth, asyncHandler(async (req, res) => {
  if (!USER_ROLES.includes(req.user?.role) || !mongoose.Types.ObjectId.isValid(req.params.conversationId)) {
    return res.status(404).json({ success: false, message: "Conversation not found." });
  }
  const conversation = await Conversation.findOne({
    _id: req.params.conversationId,
    type: "support",
    participants: { $elemMatch: { userId: objectId(req.user.id), role: req.user.role } },
  }).lean();
  if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || MAX_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const query = { conversationId: conversation._id };
  if (req.query.before && mongoose.Types.ObjectId.isValid(req.query.before)) query._id = { $lt: req.query.before };
  const rows = await Message.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
  rows.reverse();
  return res.json({ success: true, data: { conversation: userConversationView(conversation, req.user.role), messages: rows.map(publicMessage), hasMore: rows.length === limit, nextBefore: rows.length ? String(rows[0]._id) : null } });
}));

router.post("/conversations", requireAuth, asyncHandler(async (req, res) => {
  if (!USER_ROLES.includes(req.user?.role)) return res.status(403).json({ success: false, message: "User access required." });
  const conversation = await ensureUserConversation(req);
  if (!conversation) return res.status(404).json({ success: false, message: "User account not found." });
  return res.status(201).json({ success: true, data: userConversationView(conversation, req.user.role) });
}));

router.post("/conversations/:conversationId/messages", requireAuth, asyncHandler(async (req, res) => {
  if (!USER_ROLES.includes(req.user?.role) || !mongoose.Types.ObjectId.isValid(req.params.conversationId)) return res.status(403).json({ success: false, message: "User access required." });
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ success: false, message: "Message cannot be empty." });
  if (text.length > 2000) return res.status(400).json({ success: false, message: "Message is too long." });
  const conversation = await Conversation.findOne({ _id: req.params.conversationId, type: "support", participants: { $elemMatch: { userId: objectId(req.user.id), role: req.user.role } } });
  if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });
  const message = await Message.create({ conversationId: conversation._id, senderId: req.user.id, senderRole: req.user.role, recipientRole: "admin", text: encryptMessage(text), encryptionVersion: 1 });
  conversation.lastMessageAt = message.createdAt;
  conversation.lastMessagePreview = text.length > 100 ? `${text.slice(0, 100)}…` : text;
  await conversation.save();
  const payload = { ...publicMessage(message), conversationId: String(conversation._id) };
  emitToAdmin("support-message-new", payload);
  emitToAdmin("notification-new", { type: "support-message", conversationId: String(conversation._id), title: `New ${req.user.role} support message`, message: conversation.lastMessagePreview });
  return res.status(201).json({ success: true, data: payload });
}));

router.patch("/conversations/:conversationId/read", requireAuth, asyncHandler(async (req, res) => {
  if (!USER_ROLES.includes(req.user?.role)) return res.status(403).json({ success: false, message: "User access required." });
  const conversation = await Conversation.findOne({ _id: req.params.conversationId, type: "support", participants: { $elemMatch: { userId: objectId(req.user.id), role: req.user.role } } });
  if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });
  await Message.updateMany({ conversationId: conversation._id, recipientId: objectId(req.user.id), readAt: null }, { $set: { readAt: new Date() } });
  return res.json({ success: true, message: "Messages marked as read." });
}));

// ── Admin support inbox ──────────────────────────────────────────────────────
router.get("/admin/conversations", requireAdmin, asyncHandler(async (_req, res) => {
  const conversations = await Conversation.find({ type: "support" }).sort({ lastMessageAt: -1, updatedAt: -1 }).lean();
  const ids = conversations.map((item) => item._id);
  const unread = ids.length ? await Message.aggregate([
    { $match: { conversationId: { $in: ids }, senderRole: { $in: USER_ROLES }, readAt: null } },
    { $group: { _id: "$conversationId", count: { $sum: 1 } } },
  ]) : [];
  const unreadMap = new Map(unread.map((item) => [String(item._id), item.count]));
  return res.json({ success: true, data: conversations.map((conversation) => ({ ...adminConversationView(conversation), unreadCount: unreadMap.get(String(conversation._id)) || 0 })) });
}));

router.get("/admin/users", requireAdmin, asyncHandler(async (req, res) => {
  const q = String(req.query.q || "").trim();
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = q ? new RegExp(safe, "i") : null;
  const customerQuery = { isDeleted: { $ne: true }, ...(regex ? { $or: [{ fullName: regex }, { email: regex }, { phone: regex }] } : {}) };
  const workerQuery = { isDeleted: { $ne: true }, ...(regex ? { $or: [{ fullName: regex }, { email: regex }, { phoneNumber: regex }] } : {}) };
  const [customers, workers] = await Promise.all([
    Customer.find(customerQuery).select("_id fullName email phone").sort({ fullName: 1 }).limit(50).lean(),
    Worker.find(workerQuery).select("_id fullName email phoneNumber").sort({ fullName: 1 }).limit(50).lean(),
  ]);
  return res.json({ success: true, data: [
    ...customers.map((item) => ({ id: String(item._id), role: "customer", name: item.fullName || item.email || "Customer", email: item.email || "", phone: item.phone || "" })),
    ...workers.map((item) => ({ id: String(item._id), role: "worker", name: item.fullName || item.email || "Worker", email: item.email || "", phone: item.phoneNumber || "" })),
  ] });
}));

router.get("/admin/conversations/:conversationId", requireAdmin, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.conversationId)) return res.status(404).json({ success: false, message: "Conversation not found." });
  const conversation = await Conversation.findOne({ _id: req.params.conversationId, type: "support" }).lean();
  if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || MAX_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const rows = await Message.find({ conversationId: conversation._id }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
  rows.reverse();
  return res.json({ success: true, data: { conversation: adminConversationView(conversation), messages: rows.map(publicMessage) } });
}));

router.post("/admin/conversations", requireAdmin, asyncHandler(async (req, res) => {
  const role = req.body?.role;
  const targetId = req.body?.userId;
  if (!USER_ROLES.includes(role) || !mongoose.Types.ObjectId.isValid(targetId)) return res.status(400).json({ success: false, message: "Valid customer or worker is required." });
  const profile = await getUserProfile(role, targetId);
  if (!profile) return res.status(404).json({ success: false, message: "User not found." });
  let conversation = await Conversation.findOne({ type: "support", participants: { $elemMatch: { userId: profile._id, role } } });
  if (!conversation) conversation = await Conversation.create({ type: "support", participants: [{ userId: profile._id, role, name: profile.fullName || profile.email || role }] });
  return res.status(201).json({ success: true, data: adminConversationView(conversation) });
}));

router.post("/admin/conversations/:conversationId/messages", requireAdmin, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.conversationId)) return res.status(404).json({ success: false, message: "Conversation not found." });
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ success: false, message: "Message cannot be empty." });
  if (text.length > 2000) return res.status(400).json({ success: false, message: "Message is too long." });
  const conversation = await Conversation.findOne({ _id: req.params.conversationId, type: "support" });
  if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });
  const recipient = conversation.participants.find((item) => USER_ROLES.includes(item.role));
  if (!recipient) return res.status(400).json({ success: false, message: "Conversation has no user participant." });
  const profile = await getUserProfile(recipient.role, recipient.userId);
  if (!profile) return res.status(404).json({ success: false, message: "User account not found." });
  const adminName = req.admin?.name || req.admin?.email || "Admin";
  if (!conversation.participants.some((item) => String(item.userId) === String(req.admin.id) && item.role === "admin")) {
    conversation.participants.push({ userId: objectId(req.admin.id), role: "admin", name: adminName });
  }
  const message = await Message.create({ conversationId: conversation._id, senderId: req.admin.id, senderRole: "admin", recipientId: recipient.userId, recipientRole: recipient.role, text: encryptMessage(text), encryptionVersion: 1 });
  conversation.lastMessageAt = message.createdAt;
  conversation.lastMessagePreview = text.length > 100 ? `${text.slice(0, 100)}…` : text;
  await conversation.save();
  const payload = { ...publicMessage(message), conversationId: String(conversation._id) };
  emitToUser(recipient.userId, "support-message-new", payload);
  return res.status(201).json({ success: true, data: payload });
}));

router.patch("/admin/conversations/:conversationId/read", requireAdmin, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.conversationId)) return res.status(404).json({ success: false, message: "Conversation not found." });
  await Message.updateMany({ conversationId: req.params.conversationId, senderRole: { $in: USER_ROLES }, readAt: null }, { $set: { readAt: new Date() } });
  return res.json({ success: true, message: "Support messages marked as read." });
}));

export default router;
