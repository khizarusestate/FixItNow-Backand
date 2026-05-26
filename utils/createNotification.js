import Notification from "../notificationSchema.js";
import { emitToAdminUser, emitToUser } from "./socketManager.js";
import { sendWebPushToUser } from "./webPush.js";
import {
  ENV_SUPER_ADMIN_ID,
  isEnvSuperAdminConfigured,
} from "../services/envSuperAdmin.js";
import logger from "./logger.js";

/**
 * Persist in-app notification and push to connected client via socket.
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

    if (userRole === "admin") {
      emitToAdminUser(String(userId), "notification-new", payload);
    } else {
      emitToUser(String(userId), "notification-new", payload);
    }

    if (deliverPush) {
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
    const admins = await Admin.find({ isActive: true, role: "admin" })
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
