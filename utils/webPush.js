import webpush from "web-push";
import PushSubscription from "../pushSubscriptionSchema.js";
import Customer from "../customerSchema.js";
import Worker from "../workerSchema.js";
import logger from "./logger.js";
import env from "./env.js";

let configured = false;

function ensureConfigured() {
  if (configured) return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return false;
  }
  webpush.setVapidDetails(
    env.VAPID_SUBJECT || "mailto:support@fixitnow.app",
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
  configured = true;
  return true;
}

export function getVapidPublicKey() {
  return env.VAPID_PUBLIC_KEY || "";
}

async function isDevicePushEnabledForUser(userId, userRole) {
  if (!userId || !["customer", "worker"].includes(userRole)) return false;
  const Model = userRole === "worker" ? Worker : Customer;
  const doc = await Model.findById(userId).select("devicePushEnabled").lean();
  if (!doc) return false;
  return doc.devicePushEnabled !== false;
}

export async function sendWebPushToUser(userId, userRole, payload) {
  if (!ensureConfigured()) return { sent: 0, skipped: true };

  const pushAllowed = await isDevicePushEnabledForUser(userId, userRole);
  if (!pushAllowed) return { sent: 0, skipped: true };

  const subs = await PushSubscription.find({
    userId,
    userRole,
  }).lean();

  if (!subs.length) return { sent: 0, skipped: false };

  const body = JSON.stringify(payload);
  let sent = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          body,
        );
        sent += 1;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: sub._id });
        } else {
          logger.warn("Web push send failed", {
            userId: String(userId),
            statusCode: err.statusCode,
            message: err.message,
          });
        }
      }
    }),
  );

  return { sent, skipped: false };
}
