import express from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import PushSubscription from "../pushSubscriptionSchema.js";
import Customer from "../customerSchema.js";
import Worker from "../workerSchema.js";
import Admin from "../models/Admin.js";
import { ENV_SUPER_ADMIN_ID } from "../services/envSuperAdmin.js";
import { getVapidPublicKey } from "../utils/webPush.js";

function isEnvSuperAdminUser(user) {
  return user?.role === "admin" && String(user?.id) === ENV_SUPER_ADMIN_ID;
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
    const Model =
      req.user.role === "admin"
        ? Admin
        : req.user.role === "worker"
          ? Worker
          : Customer;
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

    const Model =
      req.user.role === "admin"
        ? Admin
        : req.user.role === "worker"
          ? Worker
          : Customer;
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
        userRole: req.user.role,
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

    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        userId: req.user.id,
        userRole: req.user.role,
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
    const query = { userId: req.user.id, userRole: req.user.role };
    if (endpoint) query.endpoint = endpoint;
    await PushSubscription.deleteMany(query);
    return res.json({ success: true, message: "Push subscription removed." });
  }),
);

export default router;
