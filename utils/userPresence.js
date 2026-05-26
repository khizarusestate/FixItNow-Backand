import mongoose from "mongoose";
import Customer from "../customerSchema.js";
import Worker from "../workerSchema.js";
import { emitToAdmin } from "./socketManager.js";
import logger from "./logger.js";

export async function setUserPresenceOnline(userId, role) {
  if (!userId || !role || !["customer", "worker"].includes(role)) return;
  if (!mongoose.Types.ObjectId.isValid(String(userId))) return;

  try {
    const Model = role === "worker" ? Worker : Customer;
    const doc = await Model.findOne({
      _id: userId,
      isDeleted: { $ne: true },
    });
    if (!doc) return;

    doc.lastActive = new Date();
    if (!doc.isDisabled && doc.status !== "rejected") {
      if (role === "worker" && ["not_approved", "pending"].includes(doc.status)) {
        /* keep approval status */
      } else if (doc.status !== "pending-verification") {
        doc.status = "active";
      }
    }
    await doc.save();
    emitToAdmin("refresh", {
      type: role === "worker" ? "workers" : "customers",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn("setUserPresenceOnline failed", {
      userId: String(userId),
      role,
      error: err.message,
    });
  }
}

export async function setUserPresenceOffline(userId, role) {
  if (!userId || !role || !["customer", "worker"].includes(role)) return;
  if (!mongoose.Types.ObjectId.isValid(String(userId))) return;

  try {
    const Model = role === "worker" ? Worker : Customer;
    const doc = await Model.findOne({
      _id: userId,
      isDeleted: { $ne: true },
    });
    if (!doc) return;

    doc.lastActive = new Date();
    if (role === "worker") {
      if (!doc.isDisabled && doc.status === "active") {
        doc.status = "inactive";
      }
    } else if (doc.isActive !== false && doc.status === "active") {
      doc.status = "inactive";
    }
    await doc.save();
    emitToAdmin("refresh", {
      type: role === "worker" ? "workers" : "customers",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn("setUserPresenceOffline failed", {
      userId: String(userId),
      role,
      error: err.message,
    });
  }
}
