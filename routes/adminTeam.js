import express from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireSuperAdmin } from "../middleware/auth.js";
import Admin from "../models/Admin.js";
import { ADMIN_PANEL_ROLES } from "../middleware/adminRoles.js";
import AuditLog from "../models/AuditLog.js";
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  VALIDATION,
} from "../utils/constants.js";
import { isValidEmail, normalizeEmail } from "../utils/helpers.js";
import logger from "../utils/logger.js";
import {
  forceLogoutAdmin,
  notifyAdminTeamUpdated,
} from "../services/adminSession.js";
import { isAdminConnected } from "../utils/socketManager.js";

const router = express.Router();

const sanitizeAdmin = (doc) => Admin.sanitize(doc);

const logAudit = async (req, action, targetId, details = {}) => {
  try {
    await AuditLog.create({
      adminId: req.admin?.id,
      adminEmail: req.admin?.email || "unknown",
      action,
      targetType: AUDIT_TARGET_TYPES.ADMIN,
      targetId,
      details,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || "",
    });
  } catch (err) {
    logger.error("Audit log failed", { error: err.message, action });
  }
};

// ─── GET /api/admin/team ───────────────────────────────────────────────────────
router.get(
  "/",
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const admins = await Admin.find({ role: ADMIN_PANEL_ROLES.ADMIN })
      .select("-pin")
      .sort({ createdAt: -1 })
      .lean();
    const sanitized = admins.map((admin) => {
      const sanitizedAdmin = sanitizeAdmin(admin);
      const presenceStatus = !sanitizedAdmin.isActive
        ? "deactivated"
        : isAdminConnected(sanitizedAdmin.id)
          ? "active"
          : "inactive";
      return {
        ...sanitizedAdmin,
        presenceStatus,
      };
    });
    const stats = {
      total: sanitized.length,
      active: sanitized.filter((a) => a.presenceStatus === "active").length,
      inactive: sanitized.filter((a) => a.presenceStatus === "inactive").length,
      teamAdmins: sanitized.length,
      superAdmins: 0,
    };
    return res.json({
      success: true,
      data: sanitized,
      teamAdmins: sanitized,
      stats,
    });
  }),
);

// ─── POST /api/admin/team ──────────────────────────────────────────────────────
router.post(
  "/",
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { name, email, phone, pin, role = "admin" } = req.body;

    if (!name?.trim() || !email || !phone?.trim() || !pin) {
      return res.status(400).json({
        success: false,
        message: "Name, email, phone, and PIN are required.",
      });
    }

    if (!isValidEmail(email)) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Please enter a valid email address.",
        });
    }

    if (String(pin).length !== VALIDATION.PIN_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `PIN must be exactly ${VALIDATION.PIN_LENGTH} digits.`,
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const existing = await Admin.findOne({ email: normalizedEmail });
    if (existing) {
      return res
        .status(409)
        .json({
          success: false,
          message: "An admin with this email already exists.",
        });
    }

    if (role && role !== ADMIN_PANEL_ROLES.ADMIN) {
      return res.status(400).json({
        success: false,
        message:
          "Only regular Admin accounts can be created here. Super Admin is configured via server environment.",
      });
    }

    const newAdmin = await Admin.create({
      name: name.trim(),
      email: normalizedEmail,
      phone: String(phone).trim(),
      pin: String(pin),
      role: ADMIN_PANEL_ROLES.ADMIN,
      isActive: true,
      createdBy: req.admin.id,
    });

    await logAudit(req, AUDIT_ACTIONS.ADMIN_CREATE, newAdmin._id, {
      email: newAdmin.email,
      role: newAdmin.role,
    });

    notifyAdminTeamUpdated("created", newAdmin);

    return res.status(201).json({
      success: true,
      message: "Admin account created successfully.",
      data: sanitizeAdmin(newAdmin),
    });
  }),
);

// ─── PATCH /api/admin/team/:id ─────────────────────────────────────────────────
router.patch(
  "/:id",
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid admin ID." });
    }

    const target = await Admin.findById(req.params.id).select("+pin");
    if (!target) {
      return res
        .status(404)
        .json({ success: false, message: "Admin not found." });
    }

    const { name, email, phone, pin, role } = req.body;
    const updates = {};

    if (name !== undefined) updates.name = String(name).trim();
    if (phone !== undefined) updates.phone = String(phone).trim();

    if (email !== undefined) {
      if (!isValidEmail(email)) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Please enter a valid email address.",
          });
      }
      const normalizedEmail = normalizeEmail(email);
      const duplicate = await Admin.findOne({
        email: normalizedEmail,
        _id: { $ne: target._id },
      });
      if (duplicate) {
        return res
          .status(409)
          .json({ success: false, message: "Email is already in use." });
      }
      updates.email = normalizedEmail;
    }

    if (pin !== undefined) {
      if (String(pin).length !== VALIDATION.PIN_LENGTH) {
        return res.status(400).json({
          success: false,
          message: `PIN must be exactly ${VALIDATION.PIN_LENGTH} digits.`,
        });
      }
      target.pin = String(pin);
    }

    if (role !== undefined) {
      if (role !== ADMIN_PANEL_ROLES.ADMIN) {
        return res.status(400).json({
          success: false,
          message: "Super Admin role cannot be assigned from the panel.",
        });
      }
      if (target.role === ADMIN_PANEL_ROLES.SUPER_ADMIN) {
        return res.status(400).json({
          success: false,
          message: "The super admin account cannot be modified here.",
        });
      }
      updates.role = ADMIN_PANEL_ROLES.ADMIN;
    }

    Object.assign(target, updates);
    await target.save();

    await logAudit(req, AUDIT_ACTIONS.ADMIN_UPDATE, target._id, {
      email: target.email,
      changes: Object.keys(updates),
    });

    const refreshed = await Admin.findById(target._id).select("-pin");
    notifyAdminTeamUpdated("updated", refreshed);
    return res.json({
      success: true,
      message: "Admin updated successfully.",
      data: sanitizeAdmin(refreshed),
    });
  }),
);

// ─── PATCH /api/admin/team/:id/status ──────────────────────────────────────────
router.patch(
  "/:id/status",
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid admin ID." });
    }

    const { isActive } = req.body;
    if (typeof isActive !== "boolean") {
      return res
        .status(400)
        .json({ success: false, message: "isActive must be true or false." });
    }

    const target = await Admin.findById(req.params.id);
    if (!target) {
      return res
        .status(404)
        .json({ success: false, message: "Admin not found." });
    }

    if (target.role === ADMIN_PANEL_ROLES.SUPER_ADMIN) {
      return res.status(400).json({
        success: false,
        message:
          "The super admin account cannot be deactivated from the panel.",
      });
    }

    if (target._id.toString() === req.admin.id && !isActive) {
      return res.status(400).json({
        success: false,
        message: "You cannot deactivate your own account.",
      });
    }

    target.isActive = isActive;
    await target.save();

    await logAudit(
      req,
      isActive ? AUDIT_ACTIONS.ADMIN_ENABLE : AUDIT_ACTIONS.ADMIN_DISABLE,
      target._id,
      { email: target.email },
    );

    if (!isActive) {
      await forceLogoutAdmin(
        target._id,
        "Your admin account was deactivated by the super admin.",
      );
    }

    notifyAdminTeamUpdated(isActive ? "activated" : "deactivated", target);

    return res.json({
      success: true,
      message: isActive
        ? "Admin activated successfully."
        : "Admin deactivated successfully.",
      data: sanitizeAdmin(target),
    });
  }),
);

// ─── DELETE /api/admin/team/:id ────────────────────────────────────────────────
router.delete(
  "/:id",
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid admin ID." });
    }

    const target = await Admin.findById(req.params.id);
    if (!target) {
      return res
        .status(404)
        .json({ success: false, message: "Admin not found." });
    }

    if (target.role === ADMIN_PANEL_ROLES.SUPER_ADMIN) {
      return res.status(400).json({
        success: false,
        message: "The super admin account cannot be deleted.",
      });
    }

    if (target._id.toString() === req.admin.id) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account.",
      });
    }

    await forceLogoutAdmin(
      target._id,
      "Your admin account was removed by the super admin.",
    );

    await Admin.findByIdAndDelete(target._id);

    await logAudit(req, AUDIT_ACTIONS.ADMIN_DELETE, target._id, {
      email: target.email,
      name: target.name,
    });

    notifyAdminTeamUpdated("deleted", target);

    return res.json({
      success: true,
      message: "Admin account deleted permanently.",
    });
  }),
);

export default router;
