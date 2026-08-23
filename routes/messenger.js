import express from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAdmin } from "../middleware/auth.js";
import Admin from "../models/Admin.js";
import Customer from "../customerSchema.js";
import Worker from "../workerSchema.js";
import Message from "../models/Message.js";
import { emitToUser, emitToAdmin, isUserConnected, isAdminConnected } from "../utils/socketManager.js";

const router = express.Router();
router.use(requireAdmin);

const normalizeType = (value) => {
  const type = String(value || "").trim().toLowerCase();
  if (type === "superadmin") return "super_admin";
  return type;
};

const makeKey = (aType, aId, bType, bId) =>
  [
    `${normalizeType(aType)}:${String(aId)}`,
    `${normalizeType(bType)}:${String(bId)}`,
  ]
    .sort()
    .join("|");

async function findContact(type, id) {
  const normalized = normalizeType(type);
  if (!id) return null;

  if (normalized === "worker") {
    const doc = await Worker.findOne({ _id: id, isDeleted: { $ne: true } })
      .select("fullName firstName lastName email phoneNumber profilePicture status availability")
      .lean();
    if (!doc) return null;
    return {
      id: String(doc._id),
      type: "worker",
      name: doc.fullName || `${doc.firstName || ""} ${doc.lastName || ""}`.trim() || "Worker",
      email: doc.email || "",
      phone: doc.phoneNumber || "",
      avatar: doc.profilePicture || null,
      status: doc.status,
      isOnline: isUserConnected(String(doc._id)),
    };
  }

  if (normalized === "customer") {
    const doc = await Customer.findOne({ _id: id, isDeleted: { $ne: true } })
      .select("fullName email phone profilePicture status isActive")
      .lean();
    if (!doc) return null;
    return {
      id: String(doc._id),
      type: "customer",
      name: doc.fullName || "Customer",
      email: doc.email || "",
      phone: doc.phone || "",
      avatar: doc.profilePicture || null,
      status: doc.status,
      isOnline: isUserConnected(String(doc._id)),
    };
  }

  if (normalized === "admin" || normalized === "super_admin") {
    if (normalized === "super_admin") {
      return {
        id: String(id),
        type: "super_admin",
        name: "Super Admin",
        email: "",
        phone: "",
        avatar: null,
        status: "active",
        isOnline: isAdminConnected(String(id)),
      };
    }
    const doc = await Admin.findOne({ _id: id })
      .select("name email phone role isActive")
      .lean();
    if (!doc) return null;
    return {
      id: String(doc._id),
      type: "admin",
      name: doc.name || "Admin",
      email: doc.email || "",
      phone: doc.phone || "",
      avatar: null,
      status: doc.isActive === false ? "inactive" : "active",
      isOnline: isAdminConnected(String(doc._id)),
    };
  }

  return null;
}

function actorFromRequest(req) {
  const role = normalizeType(req.admin?.role || "admin");
  return {
    id: String(req.admin?.id),
    type: role === "super_admin" ? "super_admin" : "admin",
  };
}

router.get("/contacts", asyncHandler(async (req, res) => {
  const search = String(req.query.search || "").trim();
  const regex = search ? new RegExp(search.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&"), "i") : null;

  const [workers, customers, admins] = await Promise.all([
    Worker.find({
      isDeleted: { $ne: true },
      ...(regex ? { $or: [{ fullName: regex }, { email: regex }, { phoneNumber: regex }] } : {}),
    })
      .select("fullName firstName lastName email phoneNumber profilePicture status availability")
      .sort({ fullName: 1 })
      .limit(200)
      .lean(),
    Customer.find({
      isDeleted: { $ne: true },
      ...(regex ? { $or: [{ fullName: regex }, { email: regex }, { phone: regex }] } : {}),
    })
      .select("fullName email phone profilePicture status isActive")
      .sort({ fullName: 1 })
      .limit(200)
      .lean(),
    Admin.find({ isActive: { $ne: false } })
      .select("name email phone role isActive")
      .sort({ name: 1 })
      .limit(100)
      .lean(),
  ]);

  const data = [
    ...workers.map((doc) => ({
      id: String(doc._id), type: "worker",
      name: doc.fullName || `${doc.firstName || ""} ${doc.lastName || ""}`.trim() || "Worker",
      email: doc.email || "", phone: doc.phoneNumber || "", avatar: doc.profilePicture || null,
      status: doc.status, isOnline: isUserConnected(String(doc._id)),
    })),
    ...customers.map((doc) => ({
      id: String(doc._id), type: "customer", name: doc.fullName || "Customer",
      email: doc.email || "", phone: doc.phone || "", avatar: doc.profilePicture || null,
      status: doc.status, isOnline: isUserConnected(String(doc._id)),
    })),
    ...admins
      .filter((doc) => String(doc._id) !== String(req.admin.id))
      .map((doc) => ({
        id: String(doc._id), type: doc.role === "super_admin" ? "super_admin" : "admin",
        name: doc.name || "Admin", email: doc.email || "", phone: doc.phone || "",
        avatar: null, status: doc.isActive === false ? "inactive" : "active",
        isOnline: isAdminConnected(String(doc._id)),
      })),
  ];

  return res.json({ success: true, data });
}));

router.get("/conversations", asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const messages = await Message.find({
    $or: [
      { senderId: actor.id, senderType: actor.type },
      { recipientId: actor.id, recipientType: actor.type },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(1000)
    .lean();

  const map = new Map();
  for (const message of messages) {
    if (map.has(message.conversationKey)) continue;
    const isSender = message.senderId === actor.id && message.senderType === actor.type;
    const peer = isSender
      ? { type: message.recipientType, id: message.recipientId }
      : { type: message.senderType, id: message.senderId };
    const contact = await findContact(peer.type, peer.id);
    map.set(message.conversationKey, {
      conversationKey: message.conversationKey,
      contact: contact || { id: peer.id, type: peer.type, name: "Unknown user", isOnline: false },
      lastMessage: {
        id: String(message._id), body: message.body, createdAt: message.createdAt,
        mine: isSender,
      },
      unreadCount: 0,
    });
  }

  const rows = [...map.values()];
  for (const row of rows) {
    row.unreadCount = await Message.countDocuments({
      conversationKey: row.conversationKey,
      recipientId: actor.id,
      recipientType: actor.type,
      readAt: null,
    });
  }

  return res.json({ success: true, data: rows });
}));

router.get("/:type/:id", asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const targetType = normalizeType(req.params.type);
  const targetId = String(req.params.id);
  const contact = await findContact(targetType, targetId);
  if (!contact) return res.status(404).json({ success: false, message: "Contact not found." });

  const conversationKey = makeKey(actor.type, actor.id, targetType, targetId);
  const messages = await Message.find({ conversationKey }).sort({ createdAt: 1 }).limit(1000).lean();

  await Message.updateMany(
    { conversationKey, recipientId: actor.id, recipientType: actor.type, readAt: null },
    { $set: { readAt: new Date() } },
  );

  return res.json({ success: true, data: { conversationKey, contact, messages } });
}));

router.post("/send", asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const { recipientType, recipientId, body, bookingId = null } = req.body || {};
  const targetType = normalizeType(recipientType);
  const targetId = String(recipientId || "").trim();
  const text = String(body || "").trim();

  if (!targetId || !text) {
    return res.status(400).json({ success: false, message: "recipientId and message body are required." });
  }
  if (!["admin", "super_admin", "customer", "worker"].includes(targetType)) {
    return res.status(400).json({ success: false, message: "Invalid recipient type." });
  }
  if (targetType !== "super_admin" && !mongoose.Types.ObjectId.isValid(targetId)) {
    return res.status(400).json({ success: false, message: "Invalid recipient ID." });
  }
  if (bookingId && !mongoose.Types.ObjectId.isValid(String(bookingId))) {
    return res.status(400).json({ success: false, message: "Invalid booking ID." });
  }

  const contact = await findContact(targetType, targetId);
  if (!contact) return res.status(404).json({ success: false, message: "Recipient not found." });

  const message = await Message.create({
    conversationKey: makeKey(actor.type, actor.id, targetType, targetId),
    senderId: actor.id,
    senderType: actor.type,
    recipientId: targetId,
    recipientType: targetType,
    body: text,
    bookingId: bookingId || null,
  });

  const payload = {
    id: String(message._id),
    conversationKey: message.conversationKey,
    senderId: message.senderId,
    senderType: message.senderType,
    recipientId: message.recipientId,
    recipientType: message.recipientType,
    body: message.body,
    bookingId: message.bookingId,
    createdAt: message.createdAt,
    readAt: message.readAt,
  };

  if (targetType === "admin" || targetType === "super_admin") {
    emitToAdmin("messenger-message", payload);
  } else {
    emitToUser(targetId, "messenger-message", payload);
  }
  emitToAdmin("messenger-refresh", { timestamp: new Date().toISOString() });

  return res.status(201).json({ success: true, data: payload });
}));

router.patch("/read/:type/:id", asyncHandler(async (req, res) => {
  const actor = actorFromRequest(req);
  const targetType = normalizeType(req.params.type);
  const targetId = String(req.params.id);
  const conversationKey = makeKey(actor.type, actor.id, targetType, targetId);
  await Message.updateMany(
    { conversationKey, recipientId: actor.id, recipientType: actor.type, readAt: null },
    { $set: { readAt: new Date() } },
  );
  return res.json({ success: true });
}));

export default router;
