import express from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import PushSubscription from "../pushSubscriptionSchema.js";
import { getVapidPublicKey } from "../utils/webPush.js";

const router = express.Router();

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
