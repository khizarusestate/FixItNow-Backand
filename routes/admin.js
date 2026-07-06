import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin } from '../middleware/auth.js';
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
    emailAddress: data.emailAddress,
    serviceCategory: data.primaryServiceCategory,
    primaryServiceCategory: data.primaryServiceCategory,
    serviceCategories: data.serviceCategories,
    ...formatLocationResponse(data),
    profilePicture: data.profilePicture,
    verificationPhoto: data.verificationPhoto || null,
    firstName: data.firstName || '',
    lastName: data.lastName || '',
    signupStep: data.signupStep || '',
    availability: data.availability ?? true,
    status: data.status,
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

// ─── GET /api/admin/me ──────────────────────────────────────────────────────────
router.get('/me', requireAdmin, asyncHandler(async (req, res) => {
  if (isEnvSuperAdminToken(req.admin)) {
    const profile = getEnvSuperAdminProfile();
    return res.json({
      success: true,
      data: {
        ...profile,
        status: resolveAdminStatus(
          profile,
          isAdminConnected(ENV_SUPER_ADMIN_ID),
        ),
      },
    });
  }
  const admin = await Admin.findById(req.admin.id).select('-pin');
  if (!admin) {
    return res.status(404).json({ success: false, message: 'Admin not found.' });
  }
  return res.json({
    success: true,
    data: buildAdminTeamMember(admin, isAdminConnected(String(admin._id))),
  });
}));

// ─── POST /api/admin/login ─────────────────────────────────────────────────────
router.post('/login', validateAdminLogin, asyncHandler(async (req, res) => {
  const { email, pin, loginAs } = req.body;

  // Super admin: credentials from env only (not MongoDB)
  if (loginAs === ADMIN_PANEL_ROLES.SUPER_ADMIN) {
    if (!isEnvSuperAdminConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Super admin is not configured. Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PIN (8 digits) on the server.',
        code: 'SUPER_ADMIN_NOT_CONFIGURED',
      });
    }

    const check = validateEnvSuperAdminCredentials(email, pin);
    if (!check.ok) {
      if (check.code === 'INVALID_PIN') {
        logger.warn('Failed super admin login — invalid PIN', { ip: req.ip });
        return res.status(401).json({
          success: false,
          message: 'Incorrect PIN.',
          code: 'INVALID_PIN',
        });
      }
      logger.warn('Failed super admin login — unknown email', { email: email.toLowerCase().trim(), ip: req.ip });
      return res.status(401).json({
        success: false,
        message: 'No admin account found for this email.',
        code: 'ADMIN_NOT_FOUND',
      });
    }

    const profile = getEnvSuperAdminProfile();
    const tokenPayload = {
      id: ENV_SUPER_ADMIN_ID,
      role: 'super_admin',
      email: profile.email,
    };
    const token = createToken(tokenPayload);

    let refreshToken;
    if (env.USE_REFRESH_TOKENS) {
      refreshToken = await createRefreshToken(ENV_SUPER_ADMIN_ID, 'admin', req);
    }

    logger.info('Super admin login successful (env)', { email: profile.email, ip: req.ip });

    return res.json(
      attachAuthToResponse(res, {
        accessToken: token,
        refreshToken,
        body: {
          success: true,
          message: 'Login successful.',
          admin: {
            id: ENV_SUPER_ADMIN_ID,
            name: profile.name,
            email: profile.email,
            phone: profile.phone,
            role: ADMIN_PANEL_ROLES.SUPER_ADMIN,
            isActive: true,
            devicePushEnabled: true,
          },
        },
      }),
    );
  }

  // Regular admin: MongoDB (team accounts only — super admin is env-only)
  const admin = await Admin.findOne({ email: email.toLowerCase().trim() }).select('+pin +failedLoginAttempts +lockUntil devicePushEnabled role');
  if (!admin) {
    logger.warn('Failed admin login — unknown email', { email: email.toLowerCase().trim(), loginAs, ip: req.ip });
    return res.status(401).json({
      success: false,
      message: 'No admin account found for this email.',
      code: 'ADMIN_NOT_FOUND',
    });
  }

  const panelRole = admin.role || ADMIN_PANEL_ROLES.ADMIN;

  // Legacy Mongo super_admin rows must use env super admin login
  if (panelRole === ADMIN_PANEL_ROLES.SUPER_ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Super Admin must use the Super Admin login option.',
      code: 'WRONG_LOGIN_PORTAL',
    });
  }

  // Backfill missing role on older team admin records
  if (!admin.role) {
    admin.role = ADMIN_PANEL_ROLES.ADMIN;
    await admin.save();
  }

  if (admin.isLocked()) {
    const mins = Math.ceil((admin.lockUntil - Date.now()) / 60000);
    return res.status(423).json({
      success: false,
      message: `Account locked. Try again in ${mins} minute(s).`,
      code: 'ADMIN_LOCKED',
    });
  }

  const pinValid = await admin.comparePin(pin);
  if (!pinValid) {
    await admin.recordFailedLogin();
    logger.warn('Failed admin login — invalid PIN', { email: admin.email, loginAs, ip: req.ip });
    return res.status(401).json({
      success: false,
      message: 'Incorrect PIN.',
      code: 'INVALID_PIN',
    });
  }

  // Super admin in database can always login, regardless of isActive
  if (!Admin.isAccountActive(admin)) {
    logger.warn('Admin login blocked: deactivated', {
      adminId: String(admin._id),
      role: admin.role,
      isActive: admin.isActive,
      email: admin.email,
      updatedAt: admin.updatedAt,
      ip: req.ip,
    });
    return res.status(403).json({
      success: false,
      message: 'Your admin account is Inactive. Please contact the super admin.',
      code: 'ADMIN_DEACTIVATED',
    });
  }

  if (loginAs !== ADMIN_PANEL_ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Use the Admin login option for team accounts.',
      code: 'WRONG_LOGIN_PORTAL',
    });
  }

  await admin.recordSuccessfulLogin(req.ip);
  const tokenPayload = {
    id: admin._id,
    role: 'admin',
    email: admin.email,
  };
  const token = createToken(tokenPayload);

  let refreshToken;
  if (env.USE_REFRESH_TOKENS) {
    refreshToken = await createRefreshToken(admin._id, 'admin', req);
  }

  logger.info('Admin login successful', { email: admin.email, ip: req.ip });

  return res.json(
    attachAuthToResponse(res, {
      accessToken: token,
      refreshToken,
      body: {
        success: true,
        message: 'Login successful.',
        admin: {
          id: admin._id,
          name: admin.name,
          email: admin.email,
          phone: admin.phone,
          role: ADMIN_PANEL_ROLES.ADMIN,
          isActive: admin.isActive ?? true,
          devicePushEnabled: admin.devicePushEnabled !== false,
        },
      },
    }),
  );
}));

// ─── GET /api/admin/summary ────────────────────────────────────────────────────
router.get('/summary', requireAdmin, asyncHandler(async (req, res) => {
  const adminId = String(req.admin?.id || 'global');
  const { value } = await cacheGetOrSet(`fixitnow:admin:summary:${adminId}`, 30, async () => {
  const [totalBookings, pendingBookings, approvedBookings, totalWorkers, pendingWorkers, totalCustomers, totalServices, completedBookings] = await Promise.all([
    Booking.countDocuments({ isDeleted: false }),
    Booking.countDocuments({ status: 'claim-pending', isDeleted: false }),
    Booking.countDocuments({ status: { $in: ['pending', 'claim-pending'] }, isDeleted: false }),
    Worker.countDocuments({ isDeleted: false }),
    Worker.countDocuments({ status: 'not_approved', isDeleted: false }),
    Customer.countDocuments({ isDeleted: false }),
    Service.countDocuments(),
    Booking.countDocuments({ status: 'completed', isDeleted: false })
  ]);

  // Calculate revenue from completed bookings
  const revenueAgg = await Booking.aggregate([
    { $match: { status: 'completed', isDeleted: false, 'paymentDetails.platformCommission': { $exists: true } } },
    { $group: { _id: null, totalRevenue: { $sum: '$paymentDetails.platformCommission' } } }
  ]);
  const revenue = revenueAgg[0]?.totalRevenue || 0;

  return {
      totalBookings,
      pendingBookings,
      approvedBookings,
      completedBookings,
      totalWorkers,
      pendingWorkers,
      totalCustomers,
      services: totalServices,
      revenue,
      recentBookings: []
    };
  });

  return res.json({
    success: true,
    data: value,
  });
}));

// ─── GET /api/admin/bookings ───────────────────────────────────────────────────
router.get('/bookings', requireAdmin, asyncHandler(async (req, res) => {
  const {
    status,
    page = 1,
    limit = 50,
    sortBy = 'createdAt',
    order = 'desc',
    search,
    startDate,
    endDate,
    paymentFilter,
  } = req.query;

  const query = { isDeleted: false };

  const payAfterClause = {
    $or: [
      { "paymentDetails.payAfterWork": true },
      { "paymentDetails.paymentMethod": "pay-after-work" },
    ],
  };

  if (paymentFilter === "pay-after-received") {
    query.$and = [
      ...(query.$and || []),
      payAfterClause,
      { "paymentDetails.paymentReceived": true },
    ];
  } else if (paymentFilter === "pay-after-pending") {
    query.$and = [
      ...(query.$and || []),
      payAfterClause,
      { workerMarkedDone: true },
      {
        $or: [
          { "paymentDetails.paymentReceived": false },
          { "paymentDetails.paymentReceived": { $exists: false } },
        ],
      },
    ];
  }

  if (status) {
    if (status === 'worker-assigned') {
      query.status = { $in: ['worker-assigned', 'assigned', 'in-progress'] };
    } else if (status === 'pending') {
      query.status = { $in: ['pending', 'claim-pending'] };
    } else if (status === 'cancelled') {
      query.status = { $in: ['cancelled', 'rejected'] };
    } else {
      query.status = status;
    }
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
    const regex = new RegExp(String(search).trim(), 'i');
    query.$or = [
      { customerName: regex },
      { email: regex },
      { serviceTitle: regex },
      { location: regex },
      { category: regex },
      { phone: regex },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const sort = { [sortBy]: order === 'asc' ? 1 : -1 };

  const baseMatch = { isDeleted: false };

  const [bookings, total, statusAgg] = await Promise.all([
    Booking.find(query)
      .populate('customerId', 'fullName email phone profilePicture')
      .populate('workerId', 'fullName phoneNumber emailAddress primaryServiceCategory serviceCategories serviceArea location profilePicture availability status lastActive totalJobs completedJobs totalEarnings')
      .populate('claimWorkerId', 'fullName phoneNumber emailAddress primaryServiceCategory serviceCategories serviceArea location profilePicture availability status lastActive totalJobs completedJobs totalEarnings')
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Booking.countDocuments(query),
    Booking.aggregate([
      { $match: baseMatch },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const counts = statusAgg.reduce((acc, row) => {
    acc[row._id] = row.count;
    return acc;
  }, {});

  const stats = {
    open: (counts.open || 0) + (counts.pending || 0) + (counts.approved || 0),
    claimPending: counts['claim-pending'] || 0,
    workerAssigned:
      (counts['worker-assigned'] || 0) +
      (counts.assigned || 0) +
      (counts['in-progress'] || 0),
    completed: counts.completed || 0,
    cancelled: (counts.cancelled || 0) + (counts.rejected || 0),
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  };

  return res.json({
    success: true,
    data: bookings,
    stats,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit)),
      totalPages: Math.ceil(total / Number(limit)),
    },
  });
}));

// ─── PATCH /api/admin/bookings/:id/payment-received ─────────────────────────────
router.patch(
  '/bookings/:id/payment-received',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { paymentReceived } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID.' });
    }

    const booking = await Booking.findOne({ _id: req.params.id, isDeleted: false });
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    const pd = booking.paymentDetails || {};
    const isPayAfter =
      Boolean(pd.payAfterWork) ||
      String(pd.paymentMethod || '').toLowerCase() === 'pay-after-work';

    if (!isPayAfter) {
      return res.status(400).json({
        success: false,
        message: 'Payment confirmation applies only to pay-after-work bookings.',
      });
    }

    if (!booking.workerMarkedDone) {
      return res.status(400).json({
        success: false,
        message: 'Worker must mark the job as done before confirming payment.',
      });
    }

    const received = paymentReceived === true || paymentReceived === 'true';
    booking.paymentDetails.paymentReceived = received;
    booking.paymentDetails.paymentReceivedAt = received ? new Date() : null;
    booking.paymentDetails.paymentReceivedBy = received ? req.admin.id : null;
    booking.timeline.push({
      status: booking.status,
      timestamp: new Date(),
      note: received
        ? 'Admin confirmed payment received from customer.'
        : 'Admin cleared payment received flag.',
    });
    await booking.save();

    emitRefresh('bookings');

    return res.json({
      success: true,
      message: received ? 'Payment marked as received.' : 'Payment received flag cleared.',
      data: {
        id: booking._id,
        paymentDetails: booking.paymentDetails,
      },
    });
  }),
);

// ─── PATCH /api/admin/bookings/:id/claim-review ───────────────────────────────
router.patch(
  '/bookings/:id/claim-review',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { action, reason } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'action must be approve or reject.',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID.' });
    }

    const booking = await Booking.findOne({
      _id: req.params.id,
      isDeleted: false,
      status: 'claim-pending',
    });
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'No pending claim found for this booking.',
      });
    }

    const worker = booking.claimWorkerId
      ? await Worker.findById(booking.claimWorkerId).lean()
      : null;

    if (action === 'reject') {
      const rejectedWorkerId = booking.claimWorkerId;
      booking.status = 'pending';
      booking.workerId = null;
      booking.claimWorkerId = null;
      booking.paymentDetails = {
        ...(booking.paymentDetails?.toObject?.() || booking.paymentDetails || {}),
        commissionReceipt: '',
        commissionTransactionId: '',
        commissionAmount: 0,
        commissionRejectedAt: new Date(),
        commissionRejectReason: String(reason || '').trim().slice(0, 500),
      };
      booking.timeline.push({
        status: 'pending',
        timestamp: new Date(),
        note: `Commission claim rejected. ${reason || ''}`.trim(),
      });
      await booking.save();

      if (rejectedWorkerId) {
        createNotification({
          userId: rejectedWorkerId,
          userRole: 'worker',
          title: 'Claim rejected',
          message: `Your claim for ${booking.serviceTitle} was rejected. The job is open again.`,
          type: 'warning',
        }).catch(() => {});
        
        // Send notification via notification service
        notifyWorkerClaimRejected(rejectedWorkerId, booking, reason).catch(() => {});
        
        emitToUser(String(rejectedWorkerId), 'booking-status-update', {
          bookingId: booking._id,
          status: booking.status,
          serviceTitle: booking.serviceTitle,
          message: `Your claim for ${booking.serviceTitle} was rejected.`,
        });
      }

      emitRefresh('bookings');
      return res.json({
        success: true,
        message: 'Claim rejected. Booking is open again.',
        data: { id: booking._id, status: booking.status },
      });
    }

    const commissionAmount =
      booking.paymentDetails?.commissionAmount ||
      Math.round((booking.price || 0) * 0.2);

    booking.status = 'worker-assigned';
    booking.workerId = booking.claimWorkerId;
    booking.claimWorkerId = null;
    booking.assignedAt = new Date();
    booking.startedAt = new Date();
    booking.paymentDetails = {
      ...(booking.paymentDetails?.toObject?.() || booking.paymentDetails || {}),
      commissionVerifiedAt: new Date(),
      commissionVerifiedBy: req.admin.id,
      serviceFee: commissionAmount,
      platformCommission: commissionAmount,
      workerEarnings: Math.max(0, (booking.price || 0) - commissionAmount),
    };
    booking.timeline.push({
      status: 'worker-assigned',
      timestamp: new Date(),
      note: `Commission verified. Worker assigned: ${worker?.fullName || booking.claimWorkerId}`,
    });
    await booking.save();

    if (booking.workerId) {
      await Worker.findByIdAndUpdate(booking.workerId, {
        status: 'active',
        $inc: { totalJobs: 1, assignedJobs: 1 },
        lastActive: new Date(),
      });
      createNotification({
        userId: booking.workerId,
        userRole: 'worker',
        title: 'Claim approved',
        message: `You are assigned to ${booking.serviceTitle}. Full customer details are now visible.`,
        type: 'success',
      }).catch(() => {});
      
      // Send notification via notification service
      notifyWorkerClaimApproved(booking.workerId, booking).catch(() => {});
      
      emitToUser(String(booking.workerId), 'job-assigned', {
        bookingId: booking._id,
        serviceTitle: booking.serviceTitle,
        status: booking.status,
      });
      emitToUser(String(booking.workerId), 'booking-status-update', {
        bookingId: booking._id,
        status: booking.status,
        serviceTitle: booking.serviceTitle,
        message: `Your claim for ${booking.serviceTitle} was approved.`,
      });
    }

    if (booking.customerId) {
      createNotification({
        userId: booking.customerId,
        userRole: 'customer',
        title: 'Worker assigned',
        message: `A worker has been assigned to ${booking.serviceTitle}.`,
        type: 'success',
      }).catch(() => {});
      
      // Send notification via notification service
      notifyCustomerWorkerAssigned(booking.customerId, booking, worker).catch(() => {});
    }

    emitRefresh('bookings');
    cacheDelByPrefix('fixitnow:admin:summary').catch(() => {});

    return res.json({
      success: true,
      message: 'Commission approved. Worker assigned.',
      data: { id: booking._id, status: booking.status, workerId: booking.workerId },
    });
  }),
);

// ─── PATCH /api/admin/bookings/:id/status ─────────────────────────────────────
router.patch('/bookings/:id/status', requireAdmin, asyncHandler(async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'claim-pending', 'worker-assigned', 'completed', 'rejected', 'cancelled'];

  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: `Status must be one of: ${validStatuses.join(', ')}.` });
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid booking ID.' });
  }

  const booking = await Booking.findOne({ _id: req.params.id, isDeleted: false });
  if (!booking) {
    return sendApiError(res, ERROR_CODES.BOOKING_NOT_FOUND, {
      message: 'Booking not found.',
      status: 404,
    });
  }

  if (
    rejectBookingAction(res, booking, BOOKING_ACTION.ADMIN_SET_STATUS, {
      targetStatus: status,
    })
  ) {
    return;
  }

  const previousStatus = booking.status;

  // Update booking status
  booking.status = status;
  booking.timeline.push({
    status,
    timestamp: new Date(),
    note: `Admin updated status to: ${status}`
  });
  await booking.save();

  emitRefresh('bookings');
  cacheDelByPrefix('fixitnow:admin:summary').catch(() => {});

  if (status === 'completed') {
    emitNotification('bookings', 'completed', `Booking ${booking._id?.slice(-8)?.toUpperCase()} has been completed`);
  }

  if (booking.customerId && previousStatus !== status) {
    emitToUser(String(booking.customerId), 'booking-status-update', {
      bookingId: booking._id,
      status: booking.status,
      previousStatus,
      serviceTitle: booking.serviceTitle,
      message: customerStatusNotification(status, booking.serviceTitle),
    });
  }

  if (
    status === 'pending' &&
    !['pending', 'claim-pending', 'worker-assigned', 'completed', 'rejected', 'cancelled'].includes(previousStatus)
  ) {
    notifyWorkersOfHighPriorityJob(
      booking.toObject?.() ? booking.toObject() : booking,
    ).catch(() => {});
  }

  if (status === 'rejected' && booking.customerId) {
    createNotification({
      userId: booking.customerId,
      userRole: 'customer',
      title: 'Booking rejected',
      message: `Your booking for ${booking.serviceTitle} was not approved.`,
      type: 'warning',
    }).catch(() => {});
  }

  if (status === 'completed' && booking.customerId) {
    createNotification({
      userId: booking.customerId,
      userRole: 'customer',
      title: 'Booking completed',
      message: `${booking.serviceTitle} has been marked completed.`,
      type: 'success',
    }).catch(() => {});
    if (booking.workerId) {
      createNotification({
        userId: booking.workerId,
        userRole: 'worker',
        title: 'Job completed',
        message: `${booking.serviceTitle} is marked completed.`,
        type: 'success',
      }).catch(() => {});
    }
  }

  await logAudit(req, 'booking_update', 'booking', booking._id, {
    previousStatus,
    status,
    serviceTitle: booking.serviceTitle,
  });

  const adminMessages = {
    rejected: 'Booking rejected. The customer has been notified.',
    approved: 'Booking approved. The customer has been notified.',
    cancelled: 'Booking cancelled.',
    completed: 'Booking marked as completed.',
    'in-progress': 'Booking marked as in progress.',
  };

  return res.json({
    success: true,
    message: adminMessages[status] || 'Booking status updated.',
    data: { id: booking._id, status: booking.status },
  });
}));

// ─── POST /api/admin/bookings/:id/approve-claim ────────────────────────────────
// Admin approves worker's claim submission and receipt
// Transitions: claim-pending → worker-assigned
// Notifies: Worker gets full booking info and can start work
router.post('/bookings/:id/approve-claim', requireAdmin, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid booking ID.' });
  }

  const booking = await Booking.findOne({ _id: req.params.id, isDeleted: false })
    .populate('claimWorkerId', 'fullName email');

  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found.' });
  }

  if (booking.status !== 'claim-pending') {
    return res.status(400).json({
      success: false,
      message: `Cannot approve claim for booking in ${booking.status} status.`
    });
  }

  if (!booking.claimWorkerId) {
    return res.status(400).json({
      success: false,
      message: 'No worker claim found for this booking.'
    });
  }

  // Update booking status
  booking.status = 'worker-assigned';
  booking.workerId = booking.claimWorkerId;
  booking.approvedAt = new Date();
  booking.approvedBy = req.admin.id;
  await booking.save();

  // Notify worker (via socket)
  emitToUser(String(booking.workerId), 'booking-approved', {
    bookingId: String(booking._id),
    message: 'Your claim has been approved! Full details are now visible.',
    booking: {
      id: booking._id,
      status: booking.status,
      title: booking.serviceTitle,
      date: booking.date
    }
  });

  // Notify customer
  emitToUser(String(booking.customerId), 'worker-assigned', {
    bookingId: String(booking._id),
    message: 'A worker has been assigned to your booking',
    workerName: booking.claimWorkerId.fullName
  });

  // Log audit
  await logAudit(req, 'booking_claim_approved', 'booking', booking._id, {
    workerId: booking.workerId,
    workerName: booking.claimWorkerId.fullName,
    bookingTitle: booking.serviceTitle
  });

  return res.json({
    success: true,
    message: 'Claim approved. Worker can now view full details.',
    data: {
      bookingId: booking._id,
      status: booking.status,
      worker: {
        id: booking.workerId,
        name: booking.claimWorkerId.fullName,
        email: booking.claimWorkerId.email
      }
    }
  });
}));

// ─── GET /api/admin/bookings/:id/available-workers ────────────────────────────
// Get available workers for a booking (filtered by service category)
router.get('/bookings/:id/available-workers', requireAdmin, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid booking ID.' });
  }

  const booking = await Booking.findOne({ _id: req.params.id, isDeleted: false });
  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found.' });
  }

  // Build query to find matching workers
  // Match by service category (case-insensitive partial match)
  const serviceQuery = booking.serviceCategory || booking.serviceTitle;
  
  const workers = await Worker.find({
    status: { $in: ['approved', 'active'] },
    $or: [
      { primaryServiceCategory: { $regex: serviceQuery, $options: 'i' } },
      { primaryServiceCategory: { $regex: new RegExp(serviceQuery.split(' ').join('|'), 'i') } }
    ]
  }).select('fullName emailAddress phoneNumber primaryServiceCategory yearsOfExperience totalJobs rating');

  res.json({
    success: true,
    data: {
      booking: {
        id: booking._id,
        serviceTitle: booking.serviceTitle,
        serviceCategory: booking.serviceCategory
      },
      workers: workers.map(w => ({
        _id: w._id,
        fullName: w.fullName,
        email: w.emailAddress,
        phoneNumber: w.phoneNumber,
        serviceCategory: w.primaryServiceCategory,
        yearsOfExperience: w.yearsOfExperience,
        totalJobs: w.totalJobs,
        rating: w.rating
      })),
      matchCriteria: serviceQuery
    }
  });
}));

// ─── PATCH /api/admin/bookings/:id/assign ──────────────────────────────────────
router.patch('/bookings/:id/assign', requireAdmin, asyncHandler(async (req, res) => {
  const { workerId } = req.body;

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid booking ID.' });
  }

  if (!workerId || !mongoose.Types.ObjectId.isValid(workerId)) {
    return res.status(400).json({ success: false, message: 'Valid worker ID is required.' });
  }

  // Get both worker and booking to validate service matching
  const [worker, booking] = await Promise.all([
    Worker.findById(workerId),
    Booking.findOne({ _id: req.params.id, isDeleted: false })
  ]);

  if (!worker) {
    return res.status(404).json({ success: false, message: 'Worker not found.' });
  }
  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found.' });
  }
  if (worker.status !== 'approved' && worker.status !== 'active' && worker.status !== 'inactive') {
    return res.status(400).json({ success: false, message: 'Worker is not approved/active.' });
  }

  // ✅ Validate service category match (optional warning, not blocking)
  const bookingService = booking.serviceCategory || booking.serviceTitle;
  const workerService = worker.primaryServiceCategory;
  
  const isServiceMatch = !bookingService || 
    !workerService || 
    bookingService.toLowerCase().includes(workerService.toLowerCase()) ||
    workerService.toLowerCase().includes(bookingService.toLowerCase());

  // Update booking with assignment details
  const updatedBooking = await Booking.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { 
      workerId, 
      status: 'assigned',
      assignedAt: new Date(),
      $push: {
        timeline: {
          status: 'assigned',
          timestamp: new Date(),
          note: `Assigned to worker: ${worker.fullName}`
        }
      }
    },
    { new: true, runValidators: true }
  ).populate('customerId', 'fullName email');

  if (!updatedBooking) {
    return res.status(404).json({ success: false, message: 'Booking not found.' });
  }

  // Update worker stats
  await Worker.findByIdAndUpdate(workerId, {
    $inc: { totalJobs: 1, assignedJobs: 1 },
    status: 'active',
    lastActive: new Date()
  });

  // Notify worker about new job
  const notifiedWorker = emitToUser(workerId, 'new-job', {
    booking: {
      id: updatedBooking._id,
      serviceTitle: updatedBooking.serviceTitle,
      category: updatedBooking.category,
      customerName: updatedBooking.customerName,
      phone: updatedBooking.phone,
      location: updatedBooking.location,
      notes: updatedBooking.notes,
      status: updatedBooking.status,
      assignedAt: updatedBooking.assignedAt,
      createdAt: updatedBooking.createdAt
    },
    message: `New job assigned: ${updatedBooking.serviceTitle}`
  });

  // Notify customer about worker assignment
  const notifiedCustomer = emitToUser(booking.customerId, 'job-assigned', {
    bookingId: booking._id,
    serviceTitle: booking.serviceTitle,
    worker: {
      id: worker._id,
      fullName: worker.fullName,
      phoneNumber: worker.phoneNumber,
      serviceCategory: worker.primaryServiceCategory
    },
    message: `A worker has been assigned to your ${booking.serviceTitle} request.`
  });

  emitRefresh('bookings');
  emitRefresh('workers');
  emitNotification('bookings', 'assigned', `Booking assigned to ${worker.fullName}: ${booking.serviceTitle}`);

  if (updatedBooking.customerId) {
    const customer = await Customer.findById(updatedBooking.customerId).select('fullName email').lean();
    if (customer) {
    }
  }

  await logAudit(req, 'booking_assign', 'booking', booking._id, {
    workerId: worker._id,
    workerName: worker.fullName,
    serviceTitle: booking.serviceTitle
  });

  if (updatedBooking.customerId) {
    createNotification({
      userId: updatedBooking.customerId,
      userRole: 'customer',
      title: 'Worker assigned',
      message: `${worker.fullName} was assigned to ${updatedBooking.serviceTitle}.`,
      type: 'info',
    }).catch(() => {});
  }
  createNotification({
    userId: worker._id,
    userRole: 'worker',
    title: 'New job assigned',
    message: `You were assigned: ${updatedBooking.serviceTitle}.`,
    type: 'urgent',
    pushOptions: { urgency: 'high' },
  }).catch(() => {});

  return res.json({
    success: true,
    message: 'Worker assigned successfully.',
    data: {
      booking: {
        id: updatedBooking._id,
        customerName: updatedBooking.customerName,
        serviceTitle: updatedBooking.serviceTitle,
        status: updatedBooking.status,
        assignedAt: updatedBooking.assignedAt,
        price: updatedBooking.price,
        workerId: updatedBooking.workerId,
        category: updatedBooking.category || updatedBooking.serviceCategory,
        phone: updatedBooking.phone,
        location: updatedBooking.location,
        notes: updatedBooking.notes,
        customerId: updatedBooking.customerId,
        createdAt: updatedBooking.createdAt
      },
      worker: {
        id: worker._id,
        fullName: worker.fullName,
        phoneNumber: worker.phoneNumber,
        serviceCategory: worker.primaryServiceCategory,
        emailAddress: worker.emailAddress,
        status: worker.status,
        rating: worker.rating?.toFixed(1) || '0.0',
        totalReviews: worker.totalReviews || 0
      }
    }
  });
}));

// ─── GET /api/admin/users ──────────────────────────────────────────────────────
router.get('/users', requireAdmin, asyncHandler(async (req, res) => {
  const { role = 'customer' } = req.query;

  if (role === 'worker') {
    const workers = await Worker.find({ isDeleted: false }).sort({ createdAt: -1 }).select('-password').lean();
    return res.json({ success: true, data: workers.map(sanitizeWorker) });
  }

  const customers = await Customer.find({ isDeleted: false }).sort({ createdAt: -1 }).select('-password -bookings').lean();
  return res.json({ success: true, data: customers.map(sanitizeCustomer) });
}));

// ─── PATCH /api/admin/users/:id ───────────────────────────────────────────────
router.patch('/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { role = 'customer' } = req.query;
  const { status, isActive } = req.body;

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid user ID.' });
  }

  const updateFields = {};
  if (status !== undefined) {
    updateFields.status =
      role === 'worker'
        ? normalizeWorkerStatusInput(status)
        : normalizeCustomerStatusInput(status);
  }
  if (isActive !== undefined && role !== 'worker') updateFields.isActive = isActive;

  const Model = role === 'worker' ? Worker : Customer;
  const user = await Model.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    updateFields,
    { new: true, runValidators: true },
  ).select('-password');

  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }

  emitRefresh(role === 'worker' ? 'workers' : 'customers');

  if (role === 'customer' && isActive === false) {
    emitToUser(String(user._id), 'account-deleted', {
      message: 'Your customer account has been disabled by an administrator.',
    });
    createNotification({
      userId: user._id,
      userRole: 'customer',
      title: 'Account disabled',
      message: 'Your customer account was disabled by an administrator.',
      type: 'warning',
    }).catch(() => {});
  }

  return res.json({ success: true, message: 'User updated successfully.', data: user });
}));

// ─── DELETE /api/admin/users/:id ──────────────────────────────────────────────
router.delete('/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { role = 'customer' } = req.query;
  const userId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ success: false, message: 'Invalid user ID.' });
  }

  const Model = role === 'worker' ? Worker : Customer;
  
  // First, get the user details for audit and notifications
  const user = await Model.findById(userId).select('-password');
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }

  if (user.isDeleted) {
    return res.status(400).json({ success: false, message: 'Account is already deleted.' });
  }

  if (role === 'customer' && user.status !== CUSTOMER_STATUS.INACTIVE && user.isActive !== false) {
    return res.status(400).json({
      success: false,
      message: 'Customer must be logged out (inactive) before the account can be deleted.',
    });
  }

  if (role === 'worker' && user.status !== WORKER_STATUS.INACTIVE) {
    return res.status(400).json({
      success: false,
      message: 'Worker must be logged out (inactive) before the account can be deleted.',
    });
  }

  emitToUser(String(userId), 'account-deleted', {
    message: 'Your account has been deleted by the admin. Please sign up again to use the app.',
    deletedAt: new Date().toISOString(),
  });
  createNotification({
    userId,
    userRole: role,
    title: 'Account deleted',
    message: 'Your account was deleted by an administrator.',
    type: 'warning',
  }).catch(() => {});

  const deletedAt = new Date();
  if (role === 'customer') {
    await Booking.updateMany(
      { customerId: userId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt } },
    );
    await Customer.findByIdAndUpdate(userId, {
      isDeleted: true,
      deletedAt,
      isActive: false,
      status: CUSTOMER_STATUS.INACTIVE,
    });
  } else {
    await Worker.findByIdAndUpdate(userId, {
      isDeleted: true,
      deletedAt,
      status: WORKER_STATUS.INACTIVE,
    });
  }

  emitRefresh(role === 'worker' ? 'workers' : 'customers');
  emitRefresh('bookings');

  await logAudit(req, role === 'worker' ? 'worker_delete' : 'customer_delete', role, userId, {
    fullName: user.fullName || user.name,
    email: user.emailAddress || user.email,
  });

  return res.json({ success: true, message: 'Account deleted successfully.' });
}));

// ─── GET /api/admin/workers ────────────────────────────────────────────────────
router.get('/workers', requireAdmin, asyncHandler(async (req, res) => {
  const {
    status,
    page = 1,
    limit = 50,
    sortBy = 'createdAt',
    order = 'desc',
    search,
    startDate,
    endDate,
  } = req.query;

  const query = { isDeleted: false };

  const resolvedStatus = resolveWorkerListStatusFilter(status);
  if (resolvedStatus) {
    query.status = resolvedStatus;
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
    const regex = new RegExp(String(search).trim(), 'i');
    query.$or = [
      { fullName: regex },
      { emailAddress: regex },
      { phoneNumber: regex },
      { primaryServiceCategory: regex },
      { serviceCategories: regex },
      { serviceArea: regex },
      { location: regex },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
  const baseMatch = { isDeleted: false };

  const [workers, total, statusAgg] = await Promise.all([
    Worker.find(query).sort(sort).skip(skip).limit(Number(limit)).select('-password').lean(),
    Worker.countDocuments(query),
    Worker.aggregate([
      { $match: baseMatch },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const counts = statusAgg.reduce((acc, row) => {
    acc[row._id] = row.count;
    return acc;
  }, {});

  const stats = {
    pending: counts.not_approved || 0,
    approved: counts.approved || 0,
    active: counts.active || 0,
    rejected: counts.rejected || 0,
    inactive: counts.inactive || 0,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  };

  return res.json({
    success: true,
    data: workers.map(sanitizeWorker),
    stats,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit)),
      totalPages: Math.ceil(total / Number(limit)),
    },
  });
}));

router.get('/workers/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid worker ID.' });
  }

  const worker = await Worker.findOne({ _id: req.params.id, isDeleted: false }).select('-password').lean();
  if (!worker) {
    return res.status(404).json({ success: false, message: 'Worker not found.' });
  }

  return res.json({ success: true, data: sanitizeWorker(worker) });
}));

// ─── POST /api/admin/workers/:id/approve-account ───────────────────────────────
// Admin approves a worker's signup application
router.post('/workers/:id/approve-account', requireAdmin, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid worker ID.' });
  }

  const worker = await Worker.findOne({ _id: req.params.id, isDeleted: false });
  if (!worker) {
    return res.status(404).json({ success: false, message: 'Worker not found.' });
  }

  // Check if waiting for approval
  if (worker.approvalStatus !== 'pending_approval') {
    return res.status(400).json({
      success: false,
      message: `Cannot approve worker with status: ${worker.approvalStatus}. This worker is not pending approval.`,
    });
  }

  // Approve the worker
  worker.approvalStatus = 'approved';
  worker.status = 'active';
  worker.approvedAt = new Date();
  worker.approvedBy = req.admin.id;
  worker.availability = true;
  await worker.save();

  // Notify worker
  emitToUser(String(worker._id), 'worker-account-approved', {
    message: 'Congratulations! Your worker account has been approved. You can now login and start accepting jobs.',
    approvedAt: new Date().toISOString(),
    type: 'account-approved',
  });

  // Send approval email
  emailService.sendWorkerApproval(worker).catch(() => {});

  // Create notification
  createNotification({
    userId: worker._id,
    userRole: 'worker',
    title: 'Account approved!',
    message: 'Your worker account is approved. You can log in and start accepting jobs.',
    type: 'success',
    deliverPush: true,
  }).catch(() => {});

  // Notify admins
  emitNotification(
    'workers',
    'approved',
    `Worker ${worker.fullName} account approved by ${req.admin.fullName || 'admin'}`,
  );

  emitRefresh('workers');

  // Audit log
  await logAudit(req, 'worker_account_approved', 'worker', worker._id, {
    fullName: worker.fullName,
    email: worker.email,
    services: worker.primaryServiceCategory,
  });

  return res.json({
    success: true,
    message: 'Worker account approved successfully.',
    data: {
      workerId: worker._id,
      fullName: worker.fullName,
      email: worker.email,
      approvalStatus: worker.approvalStatus,
      approvedAt: worker.approvedAt,
    },
  });
}));

// ─── POST /api/admin/workers/:id/reject-account ───────────────────────────────
// Admin rejects a worker's signup application
router.post('/workers/:id/reject-account', requireAdmin, asyncHandler(async (req, res) => {
  const { reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid worker ID.' });
  }

  if (!reason || String(reason).trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Rejection reason is required.',
    });
  }

  const worker = await Worker.findOne({ _id: req.params.id, isDeleted: false });
  if (!worker) {
    return res.status(404).json({ success: false, message: 'Worker not found.' });
  }

  // Check if waiting for approval
  if (worker.approvalStatus !== 'pending_approval') {
    return res.status(400).json({
      success: false,
      message: `Cannot reject worker with status: ${worker.approvalStatus}. This worker is not pending approval.`,
    });
  }

  // Reject the worker
  const rejectionReason = String(reason).trim();
  worker.approvalStatus = 'rejected';
  worker.status = 'inactive';
  worker.rejectionReason = rejectionReason;
  worker.approvedBy = req.admin.id;
  await worker.save();

  // Notify worker of rejection
  emitToUser(String(worker._id), 'worker-account-rejected', {
    message: `Your worker account application has been rejected. Reason: ${rejectionReason}`,
    reason: rejectionReason,
    type: 'account-rejected',
  });

  // Send rejection email
  emailService.sendWorkerRejection(worker, rejectionReason).catch(() => {});

  // Create notification
  createNotification({
    userId: worker._id,
    userRole: 'worker',
    title: 'Account rejected',
    message: `Your application was not approved. Reason: ${rejectionReason}`,
    type: 'warning',
    deliverPush: true,
  }).catch(() => {});

  // Notify admins
  emitNotification(
    'workers',
    'rejected',
    `Worker ${worker.fullName} account rejected by ${req.admin.fullName || 'admin'}`,
  );

  emitRefresh('workers');

  // Audit log
  await logAudit(req, 'worker_account_rejected', 'worker', worker._id, {
    fullName: worker.fullName,
    email: worker.email,
    rejectionReason: rejectionReason,
  });

  return res.json({
    success: true,
    message: 'Worker account rejected successfully.',
    data: {
      workerId: worker._id,
      fullName: worker.fullName,
      email: worker.email,
      approvalStatus: worker.approvalStatus,
      rejectionReason: worker.rejectionReason,
    },
  });
}));

// ─── PATCH /api/admin/workers/:id/status ──────────────────────────────────────
router.patch('/workers/:id/status', requireAdmin, asyncHandler(async (req, res) => {
  const { status, isDisabled } = req.body;
  const validStatuses = ['not_approved', 'approved', 'rejected', 'active', 'inactive'];

  if (!status && isDisabled === undefined) {
    return res.status(400).json({ success: false, message: 'Provide status and/or isDisabled.' });
  }

  const normalizedStatus = status ? normalizeWorkerStatusInput(status) : null;
  if (normalizedStatus && !validStatuses.includes(normalizedStatus)) {
    return res.status(400).json({ success: false, message: `Status must be one of: ${validStatuses.join(', ')}.` });
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid worker ID.' });
  }

  const updateFields = {};
  if (normalizedStatus) {
    updateFields.status =
      normalizedStatus === 'approved' ? WORKER_STATUS.ACTIVE : normalizedStatus;
  }
  if (isDisabled !== undefined) updateFields.isDisabled = Boolean(isDisabled);
  const worker = await Worker.findByIdAndUpdate(req.params.id, updateFields, { new: true }).select('-password');
  if (!worker) {
    return res.status(404).json({ success: false, message: 'Worker not found.' });
  }

  emitRefresh('workers');

  await logAudit(req, normalizedStatus === 'approved' ? 'worker_approve' : (normalizedStatus === 'rejected' ? 'worker_reject' : 'worker_status_change'), 'worker', worker._id, {
    status: normalizedStatus,
    fullName: worker.fullName
  });

  // Notify worker if approved/rejected (separate from advertisement notifications)
  if (normalizedStatus === 'approved') {
    emitToUser(String(worker._id), 'worker-account-approved', {
      message: 'Congratulations! Your worker account has been approved. You can now login and start accepting jobs.',
      approvedAt: new Date().toISOString()
    });
    emailService.sendWorkerApproval(worker).catch(() => {});
    createNotification({
      userId: worker._id,
      userRole: 'worker',
      title: 'Account approved',
      message: 'Your worker account is approved. You can log in and accept jobs.',
      type: 'success',
    }).catch(() => {});
  } else if (normalizedStatus === 'rejected') {
    emitToUser(String(worker._id), 'worker-account-rejected', {
      message: 'Your worker account application has been rejected. Please contact support for more information.',
      rejectedAt: new Date().toISOString()
    });
    createNotification({
      userId: worker._id,
      userRole: 'worker',
      title: 'Application rejected',
      message: 'Your worker application was rejected. Contact support for help.',
      type: 'warning',
    }).catch(() => {});
  } else if (isDisabled === true) {
    emitToUser(String(worker._id), 'account-deleted', {
      message: 'Your worker account has been disabled by an administrator.',
    });
    emailService.sendAccountDisabled(worker).catch(() => {});
    createNotification({
      userId: worker._id,
      userRole: 'worker',
      title: 'Account disabled',
      message: 'Your worker account was disabled by an administrator.',
      type: 'warning',
    }).catch(() => {});
  }
  emitWorkerProfileUpdate(worker);
  
  const msg = isDisabled === true
    ? 'Worker disabled successfully.'
    : isDisabled === false
      ? 'Worker enabled successfully.'
      : `Worker ${status} successfully.`;
  return res.json({ success: true, message: msg, data: sanitizeWorker(worker) });
}));

// ─── POST /api/admin/workers ───────────────────────────────────────────────────
router.post('/workers', requireAdmin, asyncHandler(async (req, res) => {
  const {
    fullName,
    emailAddress,
    phoneNumber,
    primaryServiceCategory,
    serviceArea,
    password,
    cnicNumber,
    profilePicture,
    availability
  } = req.body;

  if (!fullName || !emailAddress || !phoneNumber || !primaryServiceCategory || !password) {
    return res.status(400).json({ success: false, message: 'Full name, email, phone, service category, and password are required.' });
  }

  // Check if worker already exists
  const existingWorker = await Worker.findOne({ emailAddress });
  if (existingWorker) {
    return res.status(409).json({ success: false, message: 'Worker with this email already exists.' });
  }

  const locLabel = (req.body.location || serviceArea || '').trim();
  const worker = await Worker.create({
    fullName,
    emailAddress,
    phoneNumber,
    primaryServiceCategory,
    location: locLabel,
    serviceArea: locLabel,
    latitude: req.body.latitude != null ? Number(req.body.latitude) : null,
    longitude: req.body.longitude != null ? Number(req.body.longitude) : null,
    placeId: req.body.placeId || '',
    yearsOfExperience: 0,
    password,
    cnicNumber: cnicNumber || '',
    aboutExperience: '',
    experience: '',
    profilePicture: profilePicture || null,
    availability: availability !== undefined ? availability : true,
    hourlyRate: 0,
    status: 'approved',
  });

  emitRefresh('workers');
  emitNotification('workers', 'created', `New worker joined: ${worker.fullName}`);
  emitWorkerProfileUpdate(worker);
  return res.status(201).json({ success: true, message: 'Worker created successfully.', data: sanitizeWorker(worker) });
}));

// ─── PUT /api/admin/workers/:id ────────────────────────────────────────────────
router.put('/workers/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid worker ID.' });
  }

  const {
    fullName,
    emailAddress,
    phoneNumber,
    primaryServiceCategory,
    serviceArea,
    status,
    cnicNumber,
    profilePicture,
    availability,
    password
  } = req.body;
  const updateFields = {};

  if (fullName !== undefined) updateFields.fullName = fullName;
  if (emailAddress !== undefined) updateFields.emailAddress = emailAddress;
  if (phoneNumber !== undefined) updateFields.phoneNumber = phoneNumber;
  if (primaryServiceCategory !== undefined) updateFields.primaryServiceCategory = primaryServiceCategory;
  applyLocationUpdate(updateFields, req.body);
  if (status !== undefined) updateFields.status = status;
  if (cnicNumber !== undefined) updateFields.cnicNumber = cnicNumber;
  if (profilePicture !== undefined) updateFields.profilePicture = profilePicture;
  if (availability !== undefined) updateFields.availability = availability;
  if (password) updateFields.password = password;

  const worker = await Worker.findById(req.params.id);
  if (!worker) {
    return res.status(404).json({ success: false, message: 'Worker not found.' });
  }

  Object.assign(worker, updateFields);
  await worker.save();

  emitRefresh('workers');
  emitWorkerProfileUpdate(worker);
  // No notification for updates (only for new workers)
  return res.json({ success: true, message: 'Worker updated successfully.', data: sanitizeWorker(worker) });
}));

// ─── DELETE /api/admin/workers/:id ─────────────────────────────────────────────
// PERMANENT DELETE: Removes worker account completely from database
router.delete('/workers/:id', requireAdmin, asyncHandler(async (req, res) => {
  const workerId = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(workerId)) {
    return res.status(400).json({ success: false, message: 'Invalid worker ID.' });
  }

  const existing = await Worker.findById(workerId);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Worker not found.' });
  }

  // Store info before deletion for audit log
  const workerInfo = {
    fullName: existing.fullName,
    email: existing.email,
    workerId: existing._id
  };

  // Step 1: Revoke all tokens
  try {
    const { revokeAllUserRefreshTokens } = await import("../utils/jwt.js");
    await revokeAllUserRefreshTokens(workerId, "worker");
  } catch (err) {
    logger.warn('Failed to revoke tokens before deletion', { error: err.message });
  }

  // Step 2: Delete all related bookings (hard delete)
  await Booking.deleteMany({ workerId });

  // Step 3: Delete all related reviews where worker is reviewed
  await Review.deleteMany({ workerId });

  // Step 4: HARD DELETE - Remove worker account completely from database
  const deletedWorker = await Worker.findByIdAndDelete(workerId);

  if (!deletedWorker) {
    return res.status(404).json({ success: false, message: 'Failed to delete worker.' });
  }

  // Notify worker before they lose access
  emitToUser(String(workerId), 'account-deleted', {
    message: 'Your account has been permanently deleted by administrator',
    type: 'account-deleted',
    timestamp: new Date().toISOString()
  });

  // Refresh admin view
  emitRefresh('workers');

  // Send deletion email
  if (workerInfo.email) {
    emailService.sendAccountDeleted({ 
      email: workerInfo.email, 
      fullName: workerInfo.fullName,
      deletedBy: 'admin'
    }).catch(() => {});
  }

  // Audit log
  await logAudit(req, 'worker_permanent_delete', 'worker', workerId, {
    fullName: workerInfo.fullName,
    email: workerInfo.email,
    permanentDelete: true
  });

  return res.json({ 
    success: true, 
    message: 'Worker account permanently deleted from database.' 
  });
}));

// ─── DELETE /api/admin/customers/:id ──────────────────────────────────────────
// PERMANENT DELETE: Removes customer account completely from database
router.delete('/customers/:id', requireAdmin, asyncHandler(async (req, res) => {
  const customerId = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    return res.status(400).json({ success: false, message: 'Invalid customer ID.' });
  }

  const existing = await Customer.findById(customerId);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Customer not found.' });
  }

  // Store info before deletion for audit log
  const customerInfo = {
    fullName: existing.fullName,
    email: existing.email,
    customerId: existing._id
  };

  // Step 1: Revoke all tokens
  try {
    const { revokeAllUserRefreshTokens } = await import("../utils/jwt.js");
    await revokeAllUserRefreshTokens(customerId, "customer");
  } catch (err) {
    logger.warn('Failed to revoke tokens before deletion', { error: err.message });
  }

  // Step 2: Delete all related bookings (hard delete)
  await Booking.deleteMany({ customerId });

  // Step 3: Delete all related reviews submitted by customer
  await Review.deleteMany({ customerId });

  // Step 4: HARD DELETE - Remove customer account completely from database
  const deletedCustomer = await Customer.findByIdAndDelete(customerId);

  if (!deletedCustomer) {
    return res.status(404).json({ success: false, message: 'Failed to delete customer.' });
  }

  // Notify customer before they lose access
  emitToUser(String(customerId), 'account-deleted', {
    message: 'Your account has been permanently deleted by administrator',
    type: 'account-deleted',
    timestamp: new Date().toISOString()
  });

  // Refresh admin view
  emitRefresh('customers');

  // Send deletion email
  if (customerInfo.email) {
    emailService.sendAccountDeleted({ 
      email: customerInfo.email, 
      fullName: customerInfo.fullName,
      deletedBy: 'admin'
    }).catch(() => {});
  }

  // Audit log
  await logAudit(req, 'customer_permanent_delete', 'customer', customerId, {
    fullName: customerInfo.fullName,
    email: customerInfo.email,
    permanentDelete: true
  });

  return res.json({ 
    success: true, 
    message: 'Customer account permanently deleted from database.' 
  });
}));

// ─── PATCH /api/admin/bookings/:id/auto-assign ─────────────────────────────────
router.patch('/bookings/:id/auto-assign', requireAdmin, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid booking ID.' });
  }

  const booking = await Booking.findOne({ _id: req.params.id, isDeleted: false });
  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found.' });
  }

  if (!['approved', 'pending'].includes(booking.status)) {
    return res.status(400).json({
      success: false,
      message: 'Auto-assign is only available for approved (or pending) bookings without a worker.',
    });
  }

  if (booking.workerId) {
    return res.status(400).json({ success: false, message: 'Booking already has a worker assigned.' });
  }

  const best = await pickBestWorkerForBooking(booking);
  if (!best) {
    return res.status(404).json({
      success: false,
      message: 'No available workers found for this service category.',
    });
  }

  req.body = { workerId: best._id };
  req.params.id = booking._id.toString();

  const worker = await Worker.findById(best._id);
  if (!worker) {
    return res.status(404).json({ success: false, message: 'Worker not found.' });
  }

  const updatedBooking = await Booking.findOneAndUpdate(
    { _id: booking._id, isDeleted: false },
    {
      workerId: best._id,
      status: 'assigned',
      assignedAt: new Date(),
      $push: {
        timeline: {
          status: 'assigned',
          timestamp: new Date(),
          note: `Auto-assigned to ${worker.fullName} (score ${best.rankingScore})`,
        },
      },
    },
    { new: true, runValidators: true },
  ).populate('customerId', 'fullName email');

  await Worker.findByIdAndUpdate(best._id, {
    $inc: { totalJobs: 1, assignedJobs: 1 },
    status: 'active',
    lastActive: new Date(),
  });

  emitToUser(String(best._id), 'new-job', {
    booking: {
      id: updatedBooking._id,
      serviceTitle: updatedBooking.serviceTitle,
      customerName: updatedBooking.customerName,
      status: updatedBooking.status,
    },
    message: `New job assigned: ${updatedBooking.serviceTitle}`,
  });

  if (updatedBooking.customerId) {
    const customer = await Customer.findById(updatedBooking.customerId).select('fullName email').lean();
    if (customer) {
      createNotification({
        userId: updatedBooking.customerId,
        userRole: 'customer',
        title: 'Worker assigned',
        message: `${worker.fullName} was auto-assigned to your booking.`,
        type: 'info',
      }).catch(() => {});
    }
  }
  createNotification({
    userId: worker._id,
    userRole: 'worker',
    title: 'New job assigned',
    message: `Auto-assigned: ${updatedBooking.serviceTitle}.`,
    type: 'urgent',
    pushOptions: { urgency: 'high' },
  }).catch(() => {});

  emitRefresh('bookings');
  emitRefresh('workers');
  emitNotification('bookings', 'assigned', `Auto-assigned ${worker.fullName} to ${booking.serviceTitle}`);

  await logAudit(req, 'booking_assign', 'booking', booking._id, {
    workerId: worker._id,
    workerName: worker.fullName,
    auto: true,
    rankingScore: best.rankingScore,
  });

  return res.json({
    success: true,
    message: `Auto-assigned to ${worker.fullName}.`,
    data: {
      booking: { id: updatedBooking._id, status: updatedBooking.status },
      worker: { id: worker._id, fullName: worker.fullName, rankingScore: best.rankingScore },
    },
  });
}));

// ─── GET /api/admin/customers ──────────────────────────────────────────────────
router.get('/customers', requireAdmin, asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 50,
    sortBy = 'createdAt',
    order = 'desc',
    search,
    status,
    startDate,
    endDate,
  } = req.query;

  const query = { isDeleted: false };
  buildCustomerListQuery(query, status);

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
    const regex = new RegExp(String(search).trim(), 'i');
    query.$or = [
      { fullName: regex },
      { email: regex },
      { phone: regex },
      { location: regex },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
  const baseMatch = { isDeleted: false };

  const [customers, total, activeCount, inactiveCount, pendingCount, totalAll] = await Promise.all([
    Customer.find(query).sort(sort).skip(skip).limit(Number(limit)).select('-password').lean(),
    Customer.countDocuments(query),
    Customer.countDocuments({
      ...baseMatch,
      isActive: true,
      status: { $nin: [CUSTOMER_STATUS.REJECTED] },
    }),
    Customer.countDocuments({
      ...baseMatch,
      $or: [{ isActive: false }, { status: CUSTOMER_STATUS.INACTIVE }],
    }),
    Customer.countDocuments({ ...baseMatch, status: CUSTOMER_STATUS.NOT_APPROVED }),
    Customer.countDocuments(baseMatch),
  ]);

  return res.json({
    success: true,
    data: customers.map(sanitizeCustomer),
    stats: {
      active: activeCount,
      inactive: inactiveCount,
      pending: pendingCount,
      total: totalAll,
    },
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit)),
      totalPages: Math.ceil(total / Number(limit)),
    },
  });
}));

// ─── GET /api/admin/customers/:id ──────────────────────────────────────────────
router.get('/customers/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid customer ID.' });
  }

  const customer = await Customer.findOne({ _id: req.params.id, isDeleted: false }).select('-password').lean();
  if (!customer) {
    return res.status(404).json({ success: false, message: 'Customer not found.' });
  }

  // Get customer's bookings
  const bookings = await Booking.find({ customerId: customer._id, isDeleted: false })
    .sort({ createdAt: -1 })
    .select('serviceTitle status createdAt')
    .lean();

  return res.json({
    success: true,
    data: {
      ...customer,
      bookings: bookings || []
    }
  });
}));

// ─── PATCH /api/admin/customers/:id/status ────────────────────────────────────
router.patch('/customers/:id/status', requireAdmin, asyncHandler(async (req, res) => {
  const { status, isActive } = req.body;

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid customer ID.' });
  }

  const updateFields = {};
  if (status) updateFields.status = normalizeCustomerStatusInput(status);
  if (isActive !== undefined) updateFields.isActive = isActive;

  const customer = await Customer.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    updateFields,
    { new: true, runValidators: true },
  ).select('-password');
  if (!customer) {
    return res.status(404).json({ success: false, message: 'Customer not found.' });
  }

  emitRefresh('customers');

  if (isActive === false) {
    emitToUser(String(customer._id), 'account-deleted', {
      message: 'Your account has been disabled by an administrator.',
    });
  }

  await logAudit(req, 'customer_status_change', 'customer', customer._id, {
    status,
    isActive,
    fullName: customer.fullName
  });

  return res.json({ success: true, message: 'Customer updated.', data: customer });
}));

// ─── PUT /api/admin/customers/:id ──────────────────────────────────────────────
router.put('/customers/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid customer ID.' });
  }

  const { fullName, email, phone, status, isActive } = req.body;
  const updateFields = {};
  
  if (fullName) updateFields.fullName = fullName;
  if (email) updateFields.email = email;
  if (phone) updateFields.phone = phone;
  applyLocationUpdate(updateFields, req.body);
  if (status) updateFields.status = normalizeCustomerStatusInput(status);
  if (isActive !== undefined) updateFields.isActive = isActive;

  const customer = await Customer.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    updateFields,
    { new: true, runValidators: true },
  ).select('-password');

  if (!customer) {
    return res.status(404).json({ success: false, message: 'Customer not found.' });
  }

  emitRefresh('customers');

  await logAudit(req, 'customer_update', 'customer', customer._id, {
    fullName: customer.fullName,
    changes: Object.keys(updateFields)
  });

  return res.json({ success: true, message: 'Customer details updated.', data: customer });
}));

// ─── GET /api/admin/services ───────────────────────────────────────────────────
router.get('/services', requireAdmin, asyncHandler(async (req, res) => {
  // Get pagination params
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));
  const sortBy = req.query.sortBy || 'createdAt';
  const order = req.query.order === 'asc' ? 1 : -1;
  const search = req.query.search?.trim() || '';

  // Build query
  const query = {};
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } }
    ];
  }

  // Get total count
  const total = await Service.countDocuments(query);
  const totalPages = Math.ceil(total / limit);

  // Get paginated services
  const services = await Service.find(query)
    .sort({ [sortBy]: order })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  const DEFAULT_SERVICE_CATEGORIES = [
    'Home Maintenance',
    'Electrical Services',
    'Plumbing & Water',
    'Cleaning & Hygiene',
    'Appliance Repair',
  ];
  const categories = [
    ...new Set([
      ...DEFAULT_SERVICE_CATEGORIES,
      ...services.map((s) => s.category).filter(Boolean),
    ]),
  ].sort();

  const stats = {
    total,
    active: await Service.countDocuments({ ...query, isActive: true }),
    inactive: await Service.countDocuments({ ...query, isActive: false })
  };

  return res.json({
    success: true,
    data: {
      services: services.map(s => ({
        id: s._id,
        name: s.name,
        description: s.description,
        category: s.category,
        icon: s.icon,
        image: s.image,
        price: s.price,
        estimatedDuration: s.estimatedDuration,
        requirements: s.requirements,
        isActive: s.isActive,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt
      })),
      stats,
      categories
    },
    pagination: {
      page,
      limit,
      total,
      totalPages,
      pages: totalPages
    }
  });
}));
// ─── GET /api/admin/services/:id ─────────────────────────────────────────────────
router.get('/services/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid service ID.' });
  }
  const service = await Service.findById(req.params.id).lean();
  if (!service) {
    return res.status(404).json({ success: false, message: 'Service not found.' });
  }
  return res.json({ success: true, data: service });
}));

// ─── POST /api/admin/services ──────────────────────────────────────────────────
router.post('/services', requireAdmin, asyncHandler(async (req, res) => {
  const { name, description, category, price, icon, isActive, estimatedDuration, requirements } = req.body;

  if (!name || !description || !category) {
    return res.status(400).json({ success: false, message: 'Name, description, and category are required.' });
  }

  const service = await Service.create({
    name,
    description,
    category,
    icon: icon || 'Wrench',
    price: price || 0,
    isActive: isActive !== undefined ? isActive : true,
    estimatedDuration: estimatedDuration || null,
    requirements: requirements || []
  });

  emitRefresh('services');
  emitNotification('services', 'created', `New service added: ${service.name}`);
  return res.status(201).json({ success: true, message: 'Service created successfully.', data: service });
}));

// ─── PATCH /api/admin/services/:id ────────────────────────────────────────────
router.patch('/services/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid service ID.' });
  }

  const { name, description, category, price, icon, isActive, estimatedDuration, requirements } = req.body;
  const updateFields = {};

  if (name !== undefined) updateFields.name = name;
  if (description !== undefined) updateFields.description = description;
  if (category !== undefined) updateFields.category = category;
  if (price !== undefined) updateFields.price = price;
  if (icon !== undefined) updateFields.icon = icon;
  if (isActive !== undefined) updateFields.isActive = isActive;
  if (estimatedDuration !== undefined) updateFields.estimatedDuration = estimatedDuration;
  if (requirements !== undefined) updateFields.requirements = requirements;

  const service = await Service.findByIdAndUpdate(req.params.id, updateFields, { new: true, runValidators: true });
  if (!service) {
    return res.status(404).json({ success: false, message: 'Service not found.' });
  }

  emitRefresh('services');
  // No notification for updates (only for new services)
  return res.json({ success: true, message: 'Service updated successfully.', data: service });
}));

// ─── DELETE /api/admin/services/:id ──────────────────────────────────────────
router.delete('/services/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid service ID.' });
  }

  const service = await Service.findByIdAndDelete(req.params.id);
  if (!service) {
    return res.status(404).json({ success: false, message: 'Service not found.' });
  }

  emitRefresh('services');

  await logAudit(req, 'service_delete', 'service', service._id, {
    name: service.name,
    category: service.category
  });

  return res.json({ success: true, message: 'Service deleted successfully.' });
}));

// ─── POST /api/admin/worker-job-complete ───────────────────────────────────────
// DEPRECATED: Job completion should only be done by customer with rating
// This endpoint is removed to prevent duplicate completion logic
// Use PATCH /api/admin/bookings/:id/status to update status if needed
router.post('/worker-job-complete', requireAdmin, asyncHandler(async (req, res) => {
  return res.status(410).json({ 
    success: false, 
    message: 'This endpoint is deprecated. Job completion should only be done by the customer with rating.' 
  });
}));

// ─── GET /api/admin/revenue-data ─────────────────────────────────────────────────
// Get real revenue data from database
router.get('/revenue-data', requireAdmin, asyncHandler(async (req, res) => {
  try {
    // Get all completed bookings
    const completedBookings = await Booking.find({ 
      status: 'completed',
      isDeleted: false,
      paymentDetails: { $exists: true }
    });

    // Calculate total revenue (platform commission, fallback to serviceFee)
    const totalRevenue = completedBookings.reduce((sum, booking) => {
      return sum + (booking.paymentDetails?.platformCommission || booking.paymentDetails?.serviceFee || 0);
    }, 0);

    // Calculate monthly revenue
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const monthlyBookings = completedBookings.filter(booking => {
      const bookingDate = new Date(booking.completedAt);
      return bookingDate.getMonth() === currentMonth && bookingDate.getFullYear() === currentYear;
    });
    const monthlyRevenue = monthlyBookings.reduce((sum, booking) => {
      return sum + (booking.paymentDetails?.platformCommission || booking.paymentDetails?.serviceFee || 0);
    }, 0);

    // Calculate weekly revenue
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weeklyBookings = completedBookings.filter(booking => {
      return new Date(booking.completedAt) >= oneWeekAgo;
    });
    const weeklyRevenue = weeklyBookings.reduce((sum, booking) => {
      return sum + (booking.paymentDetails?.platformCommission || booking.paymentDetails?.serviceFee || 0);
    }, 0);

    // Calculate daily revenue
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dailyBookings = completedBookings.filter(booking => {
      return new Date(booking.completedAt) >= oneDayAgo;
    });
    const dailyRevenue = dailyBookings.reduce((sum, booking) => {
      return sum + (booking.paymentDetails?.platformCommission || booking.paymentDetails?.serviceFee || 0);
    }, 0);

    // Calculate revenue by service
    const revenueByService = {};
    completedBookings.forEach(booking => {
      const service = booking.serviceTitle || booking.serviceCategory || 'Unknown';
      const commission = booking.paymentDetails?.platformCommission || booking.paymentDetails?.serviceFee || 0;
      revenueByService[service] = (revenueByService[service] || 0) + commission;
    });

    // Get recent transactions
    const recentTransactions = completedBookings
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
      .slice(0, 10)
      .map(booking => ({
        id: booking._id,
        customer: booking.customerName || booking.name || 'Unknown',
        service: booking.serviceTitle || booking.serviceCategory || 'Unknown',
        worker: booking.workerName || 'Unknown',
        amount: booking.paymentDetails?.servicePrice || booking.paymentDetails?.totalAmount || 0,
        date: booking.completedAt,
        status: 'completed',
        commission: booking.paymentDetails?.platformCommission || booking.paymentDetails?.serviceFee || 0
      }));

    return res.json({
      success: true,
      data: {
        totalRevenue,
        monthlyRevenue,
        weeklyRevenue,
        dailyRevenue,
        revenueByService,
        recentTransactions,
        totalBookings: completedBookings.length,
        monthlyBookings: monthlyBookings.length,
        weeklyBookings: weeklyBookings.length,
        dailyBookings: dailyBookings.length
      }
    });
  } catch (error) {
    logger.error('Revenue calculation error', { error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, message: 'Failed to calculate revenue data.' });
  }
}));

// ─── POST /api/admin/test-notification ─────────────────────────────────────────
// Test endpoint to verify socket notifications are working (only available in development)
router.post('/test-notification', requireAdmin, asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }

  const { type = 'bookings', action = 'created', message = '' } = req.body;
  
  emitNotification(type, action, message);
  emitRefresh(type);
  
  return res.json({ 
    success: true, 
    message: `Test notification sent for ${type} - ${action}`,
    data: { type, action, message }
  });
}));


// ─── PUT /api/admin/profile ─────────────────────────────────────────────────────
// Update admin profile
router.put('/profile', requireAdmin, asyncHandler(async (req, res) => {
  if (isEnvSuperAdminToken(req.admin)) {
    return res.status(400).json({
      success: false,
      message: 'Super admin profile is managed via server environment variables (SUPER_ADMIN_*).',
      code: 'ENV_SUPER_ADMIN_READONLY',
    });
  }

  const {
    name,
    email,
    phone,
    location,
    latitude,
    longitude,
    placeId,
    currentPassword,
    newPassword
  } = req.body;
  
  const admin = await Admin.findById(req.admin.id);
  if (!admin) {
    return res.status(404).json({ success: false, message: 'Admin not found.' });
  }

  // Update basic profile info
  if (name) admin.name = name;
  if (email) admin.email = email;
  if (phone) admin.phone = phone;

  if (admin.role !== 'super_admin') {
    const normalizedLocation = String(location || admin.location || '').trim();
    if (!normalizedLocation) {
      return res.status(400).json({
        success: false,
        message: 'Location is required to complete your profile.',
        code: 'ADMIN_LOCATION_REQUIRED',
      });
    }
    admin.location = normalizedLocation;
    if (latitude !== undefined) admin.latitude = latitude;
    if (longitude !== undefined) admin.longitude = longitude;
    if (placeId !== undefined) admin.placeId = placeId;
  }

  // Handle PIN change (Admin uses PIN, not password)
  if (newPassword) {
    if (!currentPassword) {
      return res.status(400).json({ success: false, message: 'Current PIN is required to change PIN.' });
    }

    const isCurrentPinValid = await admin.comparePin(currentPassword);
    if (!isCurrentPinValid) {
      return res.status(400).json({ success: false, message: 'Current PIN is incorrect.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New PIN must be at least 6 characters long.' });
    }

    admin.pin = newPassword;
  }

  await admin.save();

  await logAudit(req, 'profile_update', 'admin', admin._id, { name, email, phone });

  // Return updated admin data without pin
  const updatedAdmin = await Admin.findById(admin._id).select('-pin');

  return res.json({
    success: true,
    message: 'Profile updated successfully.',
    data: {
      id: updatedAdmin._id,
      _id: updatedAdmin._id,
      name: updatedAdmin.name || updatedAdmin.fullName || 'Admin User',
      fullName: updatedAdmin.fullName || updatedAdmin.name || 'Admin User',
      email: updatedAdmin.email,
      phone: updatedAdmin.phone || '+92 300 0000000',
      location: updatedAdmin.location || '',
      latitude: updatedAdmin.latitude ?? null,
      longitude: updatedAdmin.longitude ?? null,
      placeId: updatedAdmin.placeId || '',
      role: updatedAdmin.role || 'admin',
      isActive: updatedAdmin.isActive ?? true,
      createdAt: updatedAdmin.createdAt,
      updatedAt: updatedAdmin.updatedAt,
      lastLogin: updatedAdmin.lastLogin || new Date(),
      profilePicture: updatedAdmin.profilePicture || ''
    }
  });
}));

// ─── POST /api/admin/profile-picture ──────────────────────────────────────────────
router.post(
  '/profile-picture',
  requireAdmin,
  adminProfileUpload.single('profilePicture'),
  asyncHandler(async (req, res) => {
    if (isEnvSuperAdminToken(req.admin)) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Super admin profile is managed via server environment variables.',
        code: 'ENV_SUPER_ADMIN_READONLY',
      });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No profile picture uploaded.' });
    }

    try {
      await validateFile(req.file.path, req.file.originalname, req.file.mimetype);
    } catch (validationError) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        success: false,
        message: `File validation failed: ${validationError.message}`,
      });
    }

    const admin = await Admin.findById(req.admin.id);
    if (!admin) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'Admin not found.' });
    }

    if (admin.profilePicture) {
      const oldPath = path.join(__dirname, '..', admin.profilePicture);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const profilePicture = `/uploads/admin-profiles/${req.file.filename}`;
    admin.profilePicture = profilePicture;
    await admin.save();

    return res.json({
      success: true,
      message: 'Profile picture uploaded successfully.',
      data: { profilePicture },
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════
// DEPRECATED — use PATCH /api/admin/bookings/:id/claim-review instead
// ═══════════════════════════════════════════════════════════════════════════

router.post(
  '/worker-jobs/:jobId/approve',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    return res.status(410).json({
      success: false,
      message: 'Deprecated. Use PATCH /api/admin/bookings/:id/claim-review with action approve.',
    });
  }),
);

router.post(
  '/worker-jobs/:jobId/reject',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    return res.status(410).json({
      success: false,
      message: 'Deprecated. Use PATCH /api/admin/bookings/:id/claim-review with action reject.',
    });
  }),
);

// ─── MAINTENANCE MODE (Super Admin Only) ───────────────────────────────────

router.get('/maintenance-mode', requireAdmin, asyncHandler(async (req, res) => {
  try {
    let settings = await PlatformSettings.findOne().select('maintenanceMode');
    if (!settings) {
      settings = await PlatformSettings.create({});
    }
    return res.json({
      success: true,
      data: {
        enabled: settings.maintenanceMode?.enabled || false,
        message: settings.maintenanceMode?.message || '',
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}));

router.patch('/maintenance-mode', requireAdmin, asyncHandler(async (req, res) => {
  const { enabled, message } = req.body;
  
  // Check if super admin (only super admin can enable maintenance)
  const isSuperAdmin = req.admin?.role === 'super_admin';
  if (!isSuperAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Only super admin can enable maintenance mode.',
    });
  }

  try {
    let settings = await PlatformSettings.findOne();
    if (!settings) {
      settings = new PlatformSettings();
    }

    settings.maintenanceMode = {
      enabled: Boolean(enabled),
      message: message || 'App is in maintenance. Please try again later.',
      enabledAt: enabled ? new Date() : undefined,
      enabledBy: enabled ? req.admin.id : undefined,
    };
    settings.lastModified = {
      timestamp: new Date(),
      by: 'super_admin',
    };

    await settings.save();

    // Log the change
    logger.info(`Maintenance mode ${enabled ? 'enabled' : 'disabled'}`, {
      adminId: req.admin.id,
      message: settings.maintenanceMode.message,
    });

    return res.json({
      success: true,
      message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}.`,
      data: {
        enabled: settings.maintenanceMode.enabled,
        message: settings.maintenanceMode.message,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}));

export default router;
