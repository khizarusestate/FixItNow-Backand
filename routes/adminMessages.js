import express from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import Message from "../models/Message.js";
import Conversation from "../models/Conversation.js";
import Customer from "../customerSchema.js";
import Worker from "../workerSchema.js";
import Admin from "../adminSchema.js";
import { decryptStoredMessage, encryptMessage } from "../utils/messageCrypto.js";
import { emitToUser, isUserConnected } from "../utils/socketManager.js";
import Notification from "../notificationSchema.js";
import { sendWebPushToUser } from "../utils/webPush.js";

const router = express.Router();
const MAX_PAGE_SIZE = 50;

function isAdmin(req) {
  return req.user?.role === "admin";
}

function publicMessage(message) {
  const item = typeof message.toObject === "function" ? message.toObject() : { ...message };
  item.text = decryptStoredMessage(item.text, item.encryptionVersion);
  return item;
}

async function ensureUsableUser(userId, role) {
  if (role === "customer") {
    const account = await Customer.findOne({ _id: userId, isDeleted: { $ne: true } }).select("_id isActive status").lean();
    return account && account.isActive !== false && account.status !== "rejected";
  }
  if (role === "worker") {
    const account = await Worker.findOne({ _id: userId, isDeleted: { $ne: true } }).select("_id isDisabled status approvalStatus").lean();
    return account && !account.isDisabled && account.status !== "rejected" && account.approvalStatus !== "rejected";
  }
  if (role === "admin") {
    return Boolean(await Admin.findOne({ _id: userId }).select("_id").lean());
  }
  return false;
}

async function findOrCreateSupportConversation(userId, role, adminId) {
  const participants = [
    { userId: new mongoose.Types.ObjectId(userId), role },
    { userId: new mongoose.Types.ObjectId(adminId), role: "admin" },
  ];

  let conversation = await Conversation.findOne({
    type: "support",
    bookingId: null,
    participants: {
      $all: [
        { $elemMatch: { userId: participants[0].userId, role } },
        { $elemMatch: { userId: participants[1].userId, role: "admin" } },
      ],
    },
  });

  if (!conversation) {
    conversation = await Conversation.create({ type: "support", participants });
  }
  return conversation;
}

async function populateParticipantInfo(conversation, viewerRole) {
  const participant = conversation.participants.find((item) => item.role !== viewerRole) || conversation.participants[0];
  let name = participant.role === "admin" ? "FixItNow Admin" : participant.role === "customer" ? "Customer" : "Worker";
  if (participant.role === "customer") {
    const user = await Customer.findById(participant.userId).select("name fullName firstName lastName").lean();
    name = user?.name || user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || name;
  } else if (participant.role === "worker") {
    const user = await Worker.findById(participant.userId).select("name fullName firstName lastName").lean();
    name = user?.name || user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || name;
  }
  return { id: String(participant.userId), role: participant.role, name };
}

router.get(
  "/support",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ success: false, message: "Admin access required." });
    if (!(await ensureUsableUser(req.user.id, "admin"))) return res.status(403).json({ success: false, message: "Admin account is unavailable." });

    const conversations = await Conversation.find({ type: "support", "participants.role": "admin" }).sort({ updatedAt: -1 }).lean();
    const rows = await Promise.all(
      conversations.map(async (conversation) => {
        const participant = await populateParticipantInfo(conversation, "admin");
        const unreadCount = await Message.countDocuments({ conversationId: conversation._id, recipientId: req.user.id, readAt: null });
        return {
          conversationId: String(conversation._id),
          participant,
          lastMessage: conversation.lastMessage
            ? { text: decryptStoredMessage(conversation.lastMessage), createdAt: conversation.lastMessageAt }
            : null,
          unreadCount,
          updatedAt: conversation.updatedAt,
        };
      }),
    );

    return res.json({ success: true, data: rows });
  }),
);

router.get(
  "/support/:conversationId",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ success: false, message: "Admin access required." });
    if (!mongoose.Types.ObjectId.isValid(req.params.conversationId)) return res.status(404).json({ success: false, message: "Conversation not found." });

    const conversation = await Conversation.findOne({ _id: req.params.conversationId, type: "support", "participants": { $elemMatch: { userId: req.user.id, role: "admin" } } }).lean();
    if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });

    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || MAX_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const rows = await Message.find({ conversationId: conversation._id }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
    rows.reverse();

    return res.json({
      success: true,
      data: {
        conversation: { id: String(conversation._id), type: conversation.type, participant: await populateParticipantInfo(conversation, "admin") },
        messages: rows.map(publicMessage),
      },
    });
  }),
);

router.post(
  "/support/:conversationId",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ success: false, message: "Admin access required." });
    if (!mongoose.Types.ObjectId.isValid(req.params.conversationId)) return res.status(404).json({ success: false, message: "Conversation not found." });

    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ success: false, message: "Message cannot be empty." });
    if (text.length > 2000) return res.status(400).json({ success: false, message: "Message is too long." });

    const conversation = await Conversation.findOne({ _id: req.params.conversationId, type: "support", participants: { $elemMatch: { userId: req.user.id, role: "admin" } } }).lean();
    if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });

    const recipient = conversation.participants.find((item) => item.role !== "admin");
    if (!recipient || !(await ensureUsableUser(recipient.userId, recipient.role))) return res.status(403).json({ success: false, message: "Recipient account is unavailable." });

    const message = await Message.create({
      conversationId: conversation._id,
      senderId: req.user.id,
      senderRole: "admin",
      recipientId: recipient.userId,
      recipientRole: recipient.role,
      text: encryptMessage(text),
      encryptionVersion: 1,
    });

    await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessage: encryptMessage(text), lastMessageAt: message.createdAt } });

    const payload = { ...publicMessage(message), conversationId: String(conversation._id) };
    const notification = await Notification.create({
      userId: recipient.userId,
      userRole: recipient.role,
      senderId: req.user.id,
      relatedEntityId: conversation._id,
      link: "#messages",
      title: "New message from FixItNow Admin",
      message: text.length > 100 ? `${text.slice(0, 100)}…` : text,
      type: "message",
    });
    emitToUser(recipient.userId, "message-new", payload);
    emitToUser(recipient.userId, "notification-new", {
      id: String(notification._id), title: notification.title, message: notification.message, type: notification.type,
      relatedEntityId: String(conversation._id), conversationId: String(conversation._id), link: notification.link,
    });

    if (!isUserConnected(recipient.userId)) {
      void sendWebPushToUser(recipient.userId, recipient.role, {
        title: "New message from FixItNow Admin",
        message: notification.message,
        type: "message",
        tag: `support-${conversation._id}`,
        url: "/",
      }).catch(() => {});
    }

    return res.status(201).json({ success: true, data: payload });
  }),
);

router.patch(
  "/support/:conversationId/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ success: false, message: "Admin access required." });
    if (!mongoose.Types.ObjectId.isValid(req.params.conversationId)) return res.status(404).json({ success: false, message: "Conversation not found." });
    const conversation = await Conversation.findOne({ _id: req.params.conversationId, type: "support", participants: { $elemMatch: { userId: req.user.id, role: "admin" } } }).lean();
    if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found." });
    await Message.updateMany({ conversationId: conversation._id, recipientId: req.user.id, readAt: null }, { $set: { readAt: new Date() } });
    await Notification.updateMany({ userId: req.user.id, relatedEntityId: conversation._id, type: "message", isRead: false }, { $set: { isRead: true } });
    return res.json({ success: true, message: "Messages marked as read." });
  }),
);

export default router;
