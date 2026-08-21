import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import { validateAdminLogin } from '../middleware/validation.js';
import Admin from '../models/Admin.js';
import { ADMIN_PANEL_ROLES } from '../middleware/adminRoles.js';
import {
  ENV_SUPER_ADMIN_ID,
  validateEnvSuperAdminCredentials,
  isEnvSuperAdminConfigured,
  isEnvSuperAdminToken,
  getEnvSuperAdminProfile,
} from '../services/envSuperAdmin.js';
import Customer from '../customerSchema.js';
import Worker from '../workerSchema.js';
import Booking from '../bookingSchema.js';
import Review from '../reviewSchema.js';
import Notification from '../notificationSchema.js';
import PlatformSettings from '../models/PlatformSettings.js';
import Service from '../models/Service.js';
import ServiceRequest from '../models/ServiceRequest.js';
import { createToken, createRefreshToken } from '../utils/jwt.js';
import env from '../utils/env.js';
import mongoose from 'mongoose';
import { getSocketIO, emitToUser, emitToAdmin, isUserConnected, isAdminConnected } from '../utils/socketManager.js';
import { buildAdminTeamMember, resolveAdminStatus } from '../utils/adminStatus.js';
import { sendApiError, ERROR_CODES } from '../utils/apiErrors.js';
import {
  BOOKING_ACTION,
  rejectBookingAction,
  customerStatusNotification,
} from '../utils/bookingActions.js';
import AuditLog from '../models/AuditLog.js';
import logger from '../utils/logger.js';
import { normalizeEmail, isValidEmail, validateObjectId } from '../utils/helpers.js';
import { VALIDATION, AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '../utils/constants.js';
import { applyLocationUpdate, formatLocationResponse, getLocationLabel } from '../utils/locationFields.js';
import adminTeamRoutes from './adminTeam.js';
import emailService from '../services/emailService.js';
import { createNotification, notifyAllAdmins } from '../utils/createNotification.js';
import { notifyWorkersOfHighPriorityJob } from '../utils/workerJobNotifications.js';
import { notifyWorkerClaimApproved, notifyWorkerClaimRejected, notifyCustomerWorkerAssigned } from '../services/notificationService.js';
import { cacheGetOrSet, cacheDelByPrefix } from '../utils/cache.js';
import { pickBestWorkerForBooking, rankWorkersForBooking } from '../utils/workerRanking.js';
import { attachAuthToResponse } from '../utils/attachAuthResponse.js';
import { clearAuthCookies } from '../utils/authCookies.js';
import { validateFile, generateSecureFilename } from '../utils/fileValidation.js';
import {
  buildCustomerListQuery,
  resolveWorkerListStatusFilter,
  normalizeCustomerStatusInput,
  normalizeWorkerStatusInput,
} from '../utils/userStatus.js';
import { CUSTOMER_STATUS, WORKER_STATUS } from '../utils/constants.js';
import { resolveWorkerServiceFields, applyWorkerServices } from '../utils/workerServiceFields.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const adminProfilesDir = path.join(__dirname, '../uploads/admin-profiles');
if (!fs.existsSync(adminProfilesDir)) {
  fs.mkdirSync(adminProfilesDir, { recursive: true });
}

const adminProfileUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, adminProfilesDir);
    },
    filename: (req, file, cb) => {
      const secureName = generateSecureFilename(file.originalname, req.admin?.id);
      cb(null, `admin-${secureName}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, JPG, PNG, and WebP images are allowed'), false);
    }
    cb(null, true);
  },
});

const router = express.Router();

router.use('/team', adminTeamRoutes);

const sanitizeWorker = (worker) => {
  const data = typeof worker.toObject === 'function' ? worker.toObject() : { ...worker };
  return {
    id: data._id,
    _id: data._id,
    fullName: data.fullName,
    phoneNumber: data.phoneNumber,
    cnicNumber: data.cnicNumber,
    email: data.email,
    emailAddress: data.email, // Alias for backward compatibility
    serviceCategory: data.primaryServiceCategory,
    primaryServiceCategory: data.primaryServiceCategory,
    serviceCategories: data.serviceCategories,
    ...formatLocationResponse(data),
    profilePicture: data.profilePicture,
    verificationPhoto: data.verificationPhoto || null,
    cnicFrontPhoto: data.cnicFrontPhoto || null,
    cnicBackPhoto: data.cnicBackPhoto || null,
    firstName: data.firstName || '',
    lastName: data.lastName || '',
    signupStep: data.signupStep || '',
    availability: data.availability ?? true,
    status: data.status,
    approvalStatus: data.approvalStatus,
    rejectionReason: data.rejectionReason || '',
    approvedAt: data.approvedAt || null,
    isDisabled: data.isDisabled ?? false,
    joinDate: data.joinDate,
    lastActive: data.lastActive,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    type: 'worker',
    isOnline: isUserConnected(String(data._id)),
  };
};

const sanitizeCustomer = (customer) => {
  const data = typeof customer.toObject === 'function' ? customer.toObject() : { ...customer };
  return {
    ...data,
    ...formatLocationResponse(data),
    isOnline: isUserConnected(String(data._id)),
  };
};

const emitWorkerProfileUpdate = (worker) => {
  emitToUser(worker._id.toString(), 'profile-updated', sanitizeWorker(worker));
};

// ─── Socket.IO Emit Helper ─────────────────────────────────────────────────────
const emitUpdate = (event, data) => {
  logger.debug(`Emitting ${event}`, data);
  emitToAdmin(event, data);
};
const emitRefresh = (type) => {
  logger.debug(`Emitting refresh for ${type}`);
  emitToAdmin('refresh', { type, timestamp: new Date().toISOString() });
};
const emitNotification = (type, action = 'updated', message = '') => {
  logger.debug(`Emitting notification: ${type} - ${action}`);
  emitToAdmin('notification', {
    type,
    action,
    message,
    timestamp: new Date().toISOString()
  });
};

// ─── Audit Logging Helper ────────────────────────────────────────────────────
const logAudit = async (req, action, targetType, targetId = null, details = {}) => {
  try {
    await AuditLog.create({
      adminId: req.admin?.id,
      adminEmail: req.admin?.email || 'unknown',
      action,
      targetType,
      targetId,
      details,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || ''
    });
  } catch (err) {
    logger.error('Audit log failed', { error: err.message, action, targetType });
  }
};

