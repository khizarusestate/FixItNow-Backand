import Notification from "../notificationSchema.js";
import { emitToAdminUser, emitToUser } from "./socketManager.js";
import { sendWebPushToUser } from "./webPush.js";
import NotificationPreference from "../models/NotificationPreference.js";
import {
  ENV_SUPER_ADMIN_ID,
  isEnvSuperAdminConfigured,
} from "../services/envSuperAdmin.js";
import logger from "./logger.js";

const NOTIFICATION_TYPE_PREFERENCE_KEYS = {
  new_booking: "newBooking",
  new_worker: "newWorker",
  new_customer: "newCustomer",
  claim_pending: "claimPending",
  new_review: "newReview",
  new_advertisement: "newAdvertisement",
  new_job: "newJob",
  claim_approved: "claimApproved",
  claim_rejected: "claimRejected",
  booking_received: "bookingReceived",
  worker_assigned: "workerAssigned",
  job_completed: "jobCompleted",
};

async function getNotificationDeliveryPreferences(userId, type) {
  try {
    const prefs = await NotificationPreference.findOne({ userId }).lean();
    if (!prefs) {
      return { inAppEnabled: true, pushEnabled: true, typeEnabled: true };
    }

    const preferenceKey = NOTIFICATION_TYPE_PREFERENCE_KEYS[type];
    const typeEnabled = preferenceKey
      ? prefs.notificationTypes?.[preferenceKey] !== false
      : true;

    return {
      inAppEnabled: prefs.inAppEnabled !== false,
      pushEnabled: prefs.pushEnabled !== false,
      typeEnabled,
    };
  } catch (err) {
    logger.warn("Notification preference lookup failed", {
      userId,
      type,
      error: err?.message,
    });
    return { inAppEnabled: true, pushEnabled: true, typeEnabled: true };
  }
}

/**
 * Persist a notification and deliver it through the channels enabled by the user.
 * inAppEnabled controls socket/live delivery; pushEnabled controls web push.
 */
export async function createNotification({
  userId,
  userRole,
  title,
  message,
  type = "info",
  senderId = null,
  relatedEntityId = null,
  link = "",
  deliverPush = true,
  pushOptions = null,
}) {
  if (!userId || !userRole || !title || !message) return null;

  try {
    const preferences = await getNotificationDeliveryPreferences(userId, type);

    if (!preferences.typeEnabled) return null;
    if (!preferences.inAppEnabled && (!deliverPush || !preferences.pushEnabled)) {
      return null;
    }

    const doc = await Notification.create({
      userId,
      userRole,
      senderId,
      relatedEntityId,
      link,
      title,
      message,
      type,
      isRead: false,
    });

    const payload = {
      id: doc._id,
      title: doc.title,
      message: doc.message,
      type: doc.type,
      isRead: false,
      createdAt: doc.createdAt,
      senderId: doc.senderId,
      relatedEntityId: doc.relatedEntityId,
      link: doc.link,
    };

    if (preferences.inAppEnabled) {
      if (userRole === "admin") {
        emitToAdminUser(String(userId), "notification-new", payload);
      } else {
        emitToUser(String(userId), "notification-new", payload);
      }
    }

    if (deliverPush && preferences.pushEnabled) {
      sendWebPushToUser(
        userId,
        userRole,
        {
          title: payload.title,
          message: payload.message,
          url: payload.link || "/",
          tag: String(payload.id),
          type: payload.type,
        },
        pushOptions,
      ).catch((err) => {
        logger.warn("Web push dispatch failed", { error: err?.message });
      });
    }

    return doc;
  } catch (err) {
    logger.warn("createNotification failed", {
      userId,
      userRole,
      error: err.message,
    });
    return null;
  }
}

export async function notifyAllAdmins({
  title,
  message,
  type = "info",
  senderId = null,
  relatedEntityId = null,
  link = "",
}) {
  try {
    const Admin = (await import("../models/Admin.js")).default;
    const admins = await Admin.find({
      isActive: true,
      role: { $in: ["admin", "super_admin"] },
    })
      .select("_id")
      .lean();
    const targetIds = admins.map((a) => String(a._id));
    if (isEnvSuperAdminConfigured()) {
      targetIds.push(ENV_SUPER_ADMIN_ID);
    }
    const uniqueIds = [...new Set(targetIds)];
    await Promise.all(
      uniqueIds.map((userId) =>
        createNotification({
          userId,
          userRole: "admin",
          title,
          message,
          type,
          senderId,
          relatedEntityId,
          link,
        }),
      ),
    );
  } catch (err) {
    logger.warn("notifyAllAdmins failed", { error: err.message });
  }
}
