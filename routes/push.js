import express from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import PushSubscription from "../pushSubscriptionSchema.js";
import Customer from "../customerSchema.js";
import Worker from "../workerSchema.js";
import Admin from "../models/Admin.js";
import { ENV_SUPER_ADMIN_ID, isEnvSuperAdminToken } from "../services/envSuperAdmin.js";
import { getVapidPublicKey } from "../utils/webPush.js";

function isEnvSuperAdminUser(user) {
  return isEnvSuperAdminToken(user);
}

// PushSubscription stores the canonical delivery role. The notification system
// uses "admin" for both normal admins and super admins, so normalize JWT roles
// before reading/writing subscriptions and device preferences.
function getPushRole(user) {
  return user?.role === "super_admin" ? "admin" : user?.role;
}

const router = express.Router();

router.get(
  "/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (isEnvSuperAdminUser(req.user)) {
      return res.json({
        success: true,
        data: { devicePushEnabled: true },
      });
    }

    const role = getPushRole(req.user);
    const Model = role === "admin" ? Admin : role === "worker" ? Worker : Customer;
    const doc = await Model.findById(req.user.id).select("devicePushEnabled");
    if (!doc) {
      return res.status(404).json({ success: false, message: "Account not found." });
    }
    return res.json({
      success: true,
      data: { devicePushEnabled: doc.devicePushEnabled !== false },
    });
  }),
);

router.patch(
  "/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { devicePushEnabled } = req.body || {};
    if (typeof devicePushEnabled !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "devicePushEnabled must be a boolean.",
      });
    }

    if (isEnvSuperAdminUser(req.user)) {
      if (!devicePushEnabled) {
        await PushSubscription.deleteMany({
          userId: ENV_SUPER_ADMIN_ID,
          userRole: "admin",
        });
      }
      return res.json({
        success: true,
        message: devicePushEnabled
          ? "Device notifications enabled."
          : "Device notifications disabled.",
        data: { devicePushEnabled },
      });
    }

    const role = getPushRole(req.user);
    const Model = role === "admin" ? Admin : role === "worker" ? Worker : Customer;
    const doc = await Model.findByIdAndUpdate(
      req.user.id,
      { devicePushEnabled },
      { new: true },
    ).select("devicePushEnabled");

    if (!doc) {
      return res.status(404).json({ success: false, message: "Account not found." });
    }

    if (!devicePushEnabled) {
      await PushSubscription.deleteMany({
        userId: req.user.id,
        userRole: role,
      });
    }

    return res.json({
      success: true,
      message: devicePushEnabled
        ? "Device notifications enabled."
        : "Device notifications disabled.",
      data: { devicePushEnabled: doc.devicePushEnabled !== false },
    });
  }),
);

router.get(
  "/vapid-public-key",
  asyncHandler(async (_req, res) => {
    const publicKey = getVapidPublicKey();
    return res.json({
      success: true,
      data: { publicKey, enabled: Boolean(publicKey) },
    });
  }),
);

router.post(
  "/subscribe",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { subscription } = req.body || {};
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({
        success: false,
        message: "Invalid push subscription payload.",
      });
    }

    const role = getPushRole(req.user);
    if (!["admin", "worker", "customer"].includes(role)) {
      return res.status(403).json({ success: false, message: "Push notifications are not available for this account." });
    }

    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        userId: req.user.id,
        userRole: role,
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
        userAgent: String(req.headers["user-agent"] || "").slice(0, 500),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return res.json({ success: true, message: "Push subscription saved." });
  }),
);

router.delete(
  "/subscribe",
  requireAuth,
  asyncHandler(async (req, res) => {
    const endpoint = req.body?.endpoint;
    const role = getPushRole(req.user);
    const query = { userId: req.user.id, userRole: role };
    if (endpoint) query.endpoint = endpoint;
    await PushSubscription.deleteMany(query);
    return res.json({ success: true, message: "Push subscription removed." });
  }),
);

export default router;
