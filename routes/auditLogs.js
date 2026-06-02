import express from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireSuperAdmin } from "../middleware/auth.js";
import AuditLog from "../models/AuditLog.js";

const router = express.Router();

router.get(
  "/",
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const {
      page = 1,
      limit = 30,
      action,
      targetType,
      search,
      startDate,
      endDate,
    } = req.query;

    const query = {};
    if (action && String(action).trim()) query.action = String(action).trim();
    if (targetType && String(targetType).trim()) {
      query.targetType = String(targetType).trim();
    }
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }
    if (search && String(search).trim()) {
      const regex = new RegExp(String(search).trim(), "i");
      query.$or = [{ adminEmail: regex }, { action: regex }];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    const actions = await AuditLog.distinct("action");

    return res.json({
      success: true,
      data: logs.map((log) => ({
        id: log._id,
        adminId: log.adminId,
        adminEmail: log.adminEmail,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        details: log.details,
        ipAddress: log.ipAddress,
        createdAt: log.createdAt,
      })),
      actions,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  }),
);

export default router;
