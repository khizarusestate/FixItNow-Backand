import express from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import Booking from "../bookingSchema.js";
import Message from "../models/Message.js";
import { emitToUser } from "../utils/socketManager.js";

const router = express.Router();

const CHAT_STATUSES = ["worker-assigned", "on-the-way", "in-progress", "completed"];
const SEND_STATUSES = ["worker-assigned", "on-the-way", "in-progress"];

async function getAuthorizedBooking(req, bookingId) {
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
  if (role === "customer") {
    return {
      id: booking.workerId,
      role: "worker",
      name: "Worker",
    };
  }
  return {
    id: booking.customerId,
    role: "customer",
    name: booking.customerName || "Customer",
  };
}

// GET /api/messages/conversations
router.get(
  "/conversations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const role = req.user?.role;
    if (role !== "customer" && role !== "worker") {
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
      .lean();

    if (!bookings.length) {
      return res.json({ success: true, data: [] });
    }

    const bookingIds = bookings.map((booking) => booking._id);
    const unread = await Message.aggregate([
      {
        $match: {
          bookingId: { $in: bookingIds },
          recipientId: new mongoose.Types.ObjectId(req.user.id),
          readAt: null,
        },
      },
      { $group: { _id: "$bookingId", count: { $sum: 1 } } },
    ]);
    const unreadMap = new Map(unread.map((item) => [String(item._id), item.count]));

    const latest = await Message.aggregate([
      { $match: { bookingId: { $in: bookingIds } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$bookingId",
          text: { $first: "$text" },
          createdAt: { $first: "$createdAt" },
          senderId: { $first: "$senderId" },
        },
      },
    ]);
    const latestMap = new Map(latest.map((item) => [String(item._id), item]));

    return res.json({
      success: true,
      data: bookings.map((booking) => {
        const participant = otherParticipant(booking, role);
        const last = latestMap.get(String(booking._id));
        return {
          bookingId: String(booking._id),
          serviceTitle: booking.serviceTitle,
          status: booking.status,
          participant,
          lastMessage: last
            ? { text: last.text, createdAt: last.createdAt, senderId: String(last.senderId) }
            : null,
          unreadCount: unreadMap.get(String(booking._id)) || 0,
        };
      }),
    });
  }),
);

// GET /api/messages/bookings/:bookingId
router.get(
  "/bookings/:bookingId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const booking = await getAuthorizedBooking(req, req.params.bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Messaging is unavailable for this booking.",
      });
    }

    const messages = await Message.find({ bookingId: booking._id })
      .sort({ createdAt: 1 })
      .lean();

    return res.json({
      success: true,
      data: {
        booking: {
          id: String(booking._id),
          serviceTitle: booking.serviceTitle,
          status: booking.status,
          participant: otherParticipant(booking, req.user.role),
        },
        messages,
      },
    });
  }),
);

// POST /api/messages/bookings/:bookingId
router.post(
  "/bookings/:bookingId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      return res.status(400).json({ success: false, message: "Message cannot be empty." });
    }
    if (text.length > 2000) {
      return res.status(400).json({ success: false, message: "Message is too long." });
    }

    const booking = await getAuthorizedBooking(req, req.params.bookingId);
    if (!booking || !SEND_STATUSES.includes(booking.status)) {
      return res.status(403).json({
        success: false,
        message: "Messaging is only available after the worker is assigned.",
      });
    }

    const recipient = otherParticipant(booking, req.user.role);
    const message = await Message.create({
      bookingId: booking._id,
      senderId: req.user.id,
      senderRole: req.user.role,
      recipientId: recipient.id,
      recipientRole: recipient.role,
      text,
    });

    const payload = {
      ...message.toObject(),
      bookingId: String(booking._id),
      senderId: String(message.senderId),
      recipientId: String(message.recipientId),
    };

    emitToUser(recipient.id, "message-new", payload);

    return res.status(201).json({ success: true, data: payload });
  }),
);

// PATCH /api/messages/bookings/:bookingId/read
router.patch(
  "/bookings/:bookingId/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const booking = await getAuthorizedBooking(req, req.params.bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Conversation not found." });
    }

    await Message.updateMany(
      {
        bookingId: booking._id,
        recipientId: req.user.id,
        readAt: null,
      },
      { $set: { readAt: new Date() } },
    );

    return res.json({ success: true, message: "Messages marked as read." });
  }),
);

export default router;
