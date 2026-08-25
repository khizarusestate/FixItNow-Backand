import Notification from "../notificationSchema.js";
import { emitToAdmin, emitToAdminUser, emitToUser } from "./socketManager.js";
import { sendWebPushToUser } from "./webPush.js";
import NotificationPreference from "../models/NotificationPreference.js";
import { ENV_SUPER_ADMIN_ID, isEnvSuperAdminConfigured } from "../services/envSuperAdmin.js";
import logger from "./logger.js";

const NOTIFICATION_TYPE_PREFERENCE_KEYS = {
  new_booking: "newBooking", new_worker: "newWorker", new_customer: "newCustomer", new_advertisement: "newAdvertisement", new_review: "newReview", claim_pending: "claimPending", booking: "claimPending", support_chat: "supportChat", new_job: "newJob", claim_approved: "claimApproved", claim_rejected: "claimRejected", customer_completed: "customerCompleted", booking_received: "bookingReceived", worker_assigned: "workerAssigned", worker_on_the_way: "workerOnTheWay", worker_completed: "workerCompleted", job_completed: "jobCompleted", success: "jobCompleted",
};

const ADMIN_REFRESH_TYPES = {
  new_booking: "bookings", claim_pending: "bookings", booking: "bookings", new_worker: "workers", new_customer: "customers", new_review: "reviews", new_advertisement: "advertisements",
};

async function getNotificationDeliveryPreferences(userId, userRole, type) {
  try {
    const prefs = await NotificationPreference.findOne({ userId }).lean();
    const preferenceKey = NOTIFICATION_TYPE_PREFERENCE_KEYS[type];
    const typeEnabled = preferenceKey ? prefs?.notificationTypes?.[preferenceKey] !== false : true;
    let devicePushEnabled = true;
    if (userRole === "customer") {
      const Customer = (await import("../customerSchema.js")).default;
      const user = await Customer.findById(userId).select("devicePushEnabled").lean();
      devicePushEnabled = user?.devicePushEnabled !== false;
    } else if (userRole === "worker") {
      const Worker = (await import("../workerSchema.js")).default;
      const user = await Worker.findById(userId).select("devicePushEnabled").lean();
      devicePushEnabled = user?.devicePushEnabled !== false;
    } else if (userRole === "admin") {
      if (isEnvSuperAdminConfigured() && String(userId) === String(ENV_SUPER_ADMIN_ID)) devicePushEnabled = true;
      else {
        const Admin = (await import("../models/Admin.js")).default;
        const user = await Admin.findById(userId).select("devicePushEnabled").lean();
        devicePushEnabled = user?.devicePushEnabled !== false;
      }
    }
    return { inAppEnabled: prefs?.inAppEnabled !== false, pushEnabled: prefs?.pushEnabled !== false && devicePushEnabled, typeEnabled };
  } catch (err) {
    logger.warn("Notification preference lookup failed", { userId, userRole, type, error: err?.message });
    return { inAppEnabled: true, pushEnabled: true, typeEnabled: true };
  }
}

export async function createNotification({ userId, userRole, title, message, type = "info", senderId = null, relatedEntityId = null, link = "", deliverPush = true, pushOptions = null }) {
  if (!userId || !userRole || !title || !message) return null;
  try {
    const preferences = await getNotificationDeliveryPreferences(userId, userRole, type);
    if (!preferences.typeEnabled) return null;
    if (!preferences.inAppEnabled && !preferences.pushEnabled) return null;
    const doc = await Notification.create({ userId, userRole, senderId, relatedEntityId, link, title, message, type, isRead: false });
    const payload = { id: doc._id, title: doc.title, message: doc.message, type: doc.type, isRead: false, createdAt: doc.createdAt, senderId: doc.senderId, relatedEntityId: doc.relatedEntityId, link: doc.link };
    if (preferences.inAppEnabled) {
      if (userRole === "admin") {
        emitToAdminUser(String(userId), "notification-new", payload);
        const refreshType = ADMIN_REFRESH_TYPES[type];
        if (refreshType) emitToAdmin("refresh", { type: refreshType, timestamp: new Date().toISOString() });
      } else emitToUser(String(userId), "notification-new", payload);
    }
    if (deliverPush && preferences.pushEnabled) {
      sendWebPushToUser(userId, userRole, { title: payload.title, message: payload.message, url: payload.link || "/", tag: String(payload.id), type: payload.type }, pushOptions).catch((err) => logger.warn("Web push dispatch failed", { error: err?.message }));
    }
    return doc;
  } catch (err) {
    logger.warn("createNotification failed", { userId, userRole, error: err.message });
    return null;
  }
}

export async function notifyAllAdmins({ title, message, type = "info", senderId = null, relatedEntityId = null, link = "" }) {
  try {
    const Admin = (await import("../models/Admin.js")).default;
    const admins = await Admin.find({ isActive: true, role: { $in: ["admin", "super_admin"] } }).select("_id").lean();
    const targetIds = admins.map((a) => String(a._id));
    if (isEnvSuperAdminConfigured()) targetIds.push(ENV_SUPER_ADMIN_ID);
    await Promise.all([...new Set(targetIds)].map((userId) => createNotification({ userId, userRole: "admin", title, message, type, senderId, relatedEntityId, link })));
  } catch (err) { logger.warn("notifyAllAdmins failed", { error: err.message }); }
}
