import mongoose from "mongoose";
import Customer from "../customerSchema.js";
import Worker from "../workerSchema.js";
import { emitToAdmin } from "./socketManager.js";
import { CUSTOMER_STATUS, WORKER_STATUS } from "./constants.js";
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

    if (role === "worker") {
      if (doc.isDisabled || doc.status === WORKER_STATUS.REJECTED) {
        await doc.save();
        return;
      }
      if (doc.status !== WORKER_STATUS.NOT_APPROVED) {
        doc.status = WORKER_STATUS.ACTIVE;
      }
    } else {
      if (!doc.isActive || doc.status === CUSTOMER_STATUS.REJECTED) {
        await doc.save();
        return;
      }
      doc.status = CUSTOMER_STATUS.ACTIVE;
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
      if (!doc.isDisabled && doc.status === WORKER_STATUS.ACTIVE) {
        doc.status = WORKER_STATUS.INACTIVE;
      }
    } else if (doc.isActive !== false && doc.status === CUSTOMER_STATUS.ACTIVE) {
      doc.status = CUSTOMER_STATUS.INACTIVE;
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
