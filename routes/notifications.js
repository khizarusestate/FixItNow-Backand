import express from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import Notification from "../notificationSchema.js";
import Booking from "../bookingSchema.js";
import mongoose from "mongoose";

const router = express.Router();

// ─── GET /api/notifications/badge-summary ─────────────────────────────────────
router.get(
  "/badge-summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    const sinceRaw = req.query.since;
    const since =
      sinceRaw && !Number.isNaN(new Date(sinceRaw).getTime())
        ? new Date(sinceRaw)
        : null;

    const query = {
      userId: req.user.id,
      userRole: req.user.role,
      isRead: false,
    };

    if (since) {
      query.createdAt = { $gt: since };
    }

    const unreadCount = await Notification.countDocuments(query);
    return res.json({
      success: true,
      data: {
        jobs: unreadCount,
        unread: unreadCount,
      },
    });
  }),
);

// ─── GET /api/notifications ────────────────────────────────────────────────────
// Get notifications for the authenticated user
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, unreadOnly = "false" } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const query = { userId: req.user.id, userRole: req.user.role };
    if (unreadOnly === "true") query.isRead = false;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({
        userId: req.user.id,
        userRole: req.user.role,
        isRead: false,
      }),
    ]);

    return res.json({
      success: true,
      data: notifications,
      unreadCount,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  }),
);

// ─── PATCH /api/notifications/read-all ─────────────────────────────────────────
// Mark all notifications as read (must be registered before /:id/read)
router.patch(
  "/read-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    await Notification.updateMany(
      { userId: req.user.id, userRole: req.user.role, isRead: false },
      { isRead: true },
    );

    return res.json({
      success: true,
      message: "All notifications marked as read.",
    });
  }),
);

// ─── PATCH /api/notifications/:id/read ───────────────────────────────────────────
// Mark a notification as read
router.patch(
  "/:id/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid notification ID." });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id, userRole: req.user.role },
      { isRead: true },
      { new: true },
    );

    if (!notification) {
      return res
        .status(404)
        .json({ success: false, message: "Notification not found." });
    }

    return res.json({
      success: true,
      message: "Notification marked as read.",
      data: notification,
    });
  }),
);

// ─── DELETE /api/notifications/:id ─────────────────────────────────────────────
// Delete a notification
router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid notification ID." });
    }

    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id,
      userRole: req.user.role,
    });

    if (!notification) {
      return res
        .status(404)
        .json({ success: false, message: "Notification not found." });
    }

    return res.json({ success: true, message: "Notification deleted." });
  }),
);

export default router;
