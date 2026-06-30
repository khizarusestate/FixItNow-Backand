import express from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireCustomer, requireWorker } from "../middleware/auth.js";
import Customer from "../customerSchema.js";
import Worker from "../workerSchema.js";
import Admin from "../models/Admin.js";
import Booking from "../bookingSchema.js";
import Review from "../reviewSchema.js";
import Notification from "../notificationSchema.js";
import {
  createToken,
  createAccessToken,
  createRefreshToken,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
} from "../utils/jwt.js";
import env from "../utils/env.js";
import logger from "../utils/logger.js";
import { emitToUser, emitToAdmin } from "../utils/socketManager.js";
import emailService from "../services/emailService.js";
import { createNotification, notifyAllAdmins } from "../utils/createNotification.js";
import { notifyAdminNewWorker, notifyAdminNewCustomer } from "../services/notificationService.js";
import { normalizeCnic } from "../utils/cnic.js";
import {
  applyLocationUpdate,
  formatLocationResponse,
  getLocationLabel,
  parseLocationBody,
} from "../utils/locationFields.js";
import { getRefreshTokenFromRequest, clearAuthCookies } from "../utils/authCookies.js";
import { attachAuthToResponse } from "../utils/attachAuthResponse.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { validateFile, generateSecureFilename } from "../utils/fileValidation.js";
import { profilePictureUpload } from "../utils/profilePictureMulter.js";
import { CUSTOMER_STATUS, WORKER_STATUS } from "../utils/constants.js";
import {
  verifyGoogleIdToken,
  isGoogleAuthEnabled,
} from "../services/googleAuth.js";
import { resolveWorkerServiceFields } from "../utils/workerServiceFields.js";
import { addEmailJob } from "../utils/emailQueue.js";
import { getCache, setCache } from "../utils/cache.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const verificationPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), "uploads", "worker-verification");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `verify-${generateSecureFilename(file.originalname, "worker")}`);
  },
});

const verificationPhotoUpload = multer({
  storage: verificationPhotoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Verification photo must be JPEG, PNG, or WebP."), false);
    }
    cb(null, true);
  },
});

/** Build customer profile payload with unified location */
function formatCustomerData(customer) {
  const loc = formatLocationResponse(customer);
  return {
    id: customer._id,
    fullName: customer.fullName,
    email: customer.email,
    phone: customer.phone,
    ...loc,
    profilePicture: customer.profilePicture,
    devicePushEnabled: customer.devicePushEnabled !== false,
    isActive: customer.isActive !== false,
    status: customer.status,
    createdAt: customer.createdAt,
    joinDate: customer.joinDate,
  };
}

function formatWorkerData(worker) {
  const needsProfessionalProfile = worker.signupStep !== "complete";
  return {
    id: worker._id,
    _id: worker._id,
    firstName: worker.firstName || "",
    lastName: worker.lastName || "",
    fullName: worker.fullName,
    signupStep: worker.signupStep,
    emailVerified: Boolean(worker.emailVerified),
    needsProfessionalProfile,
    emailAddress: worker.emailAddress,
    phoneNumber: worker.phoneNumber,
    cnicNumber: worker.cnicNumber,
    serviceCategory: worker.primaryServiceCategory,
    primaryServiceCategory: worker.primaryServiceCategory,
    primaryServiceName: worker.primaryServiceName || "",
    primaryServiceId: worker.primaryServiceId || null,
    serviceCategories: worker.serviceCategories,
    ...formatLocationResponse(worker),
    profilePicture: worker.profilePicture,
    devicePushEnabled: worker.devicePushEnabled !== false,
    availability: worker.availability,
    status: worker.status,
    joinDate: worker.joinDate,
    createdAt: worker.createdAt,
    updatedAt: worker.updatedAt,
    rating: worker.rating ?? 0,
    totalReviews: worker.totalReviews ?? 0,
    completedJobs: worker.completedJobs ?? 0,
  };
}

// Helper to emit notifications to admin
const emitNotification = (type, action, message) => {
  emitToAdmin("notification", {
    type,
    action,
    message,
    timestamp: new Date().toISOString(),
  });
};

const emitRefresh = (type) => {
  emitToAdmin("refresh", { type, timestamp: new Date().toISOString() });
};

const generateResetCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const generateVerificationCode = generateResetCode;
const VERIFY_EMAIL_COOLDOWN_SEC = 60;

function readGoogleCredential(body = {}) {
  const raw = body.credential ?? body.idToken ?? body.token;
  if (typeof raw !== "string") return "";
  return raw.trim();
}

async function sendVerificationEmailWithRetry(customer, code) {
  const jobId = await addEmailJob({
    type: "email_verification",
    to: customer.email,
    name: customer.fullName,
    code,
  });
  if (jobId) return { success: true, queued: true };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await emailService.sendEmailVerificationCode(customer, code);
    if (result.success || result.skipped) return result;
    if (attempt === 0) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return { success: false };
}

async function assertVerificationEmailCooldown(email) {
  const key = `fixitnow:email:verify:cooldown:${email.toLowerCase().trim()}`;
  const existing = await getCache(key);
  if (existing) {
    return {
      blocked: true,
      message: "Please wait a minute before requesting another code.",
    };
  }
  await setCache(key, { sentAt: Date.now() }, VERIFY_EMAIL_COOLDOWN_SEC);
  return { blocked: false };
}

async function issueVerificationForCustomer(customer) {
  const verificationCode = generateVerificationCode();
  const verificationExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
  customer.emailVerificationCode = verificationCode;
  customer.emailVerificationExpiresAt = verificationExpiresAt;
  customer.isVerified = false;
  customer.status = "pending-verification";
  await customer.save();
  const emailResult = await sendVerificationEmailWithRetry(
    customer,
    verificationCode,
  );
  return { emailResult };
}

const findUserByEmail = async (email) => {
  const normalized = email.toLowerCase().trim();
  let user = await Customer.findOne({ email: normalized, isDeleted: false });
  if (user) return { user, role: "customer" };
  user = await Worker.findOne({ emailAddress: normalized, isDeleted: false });
  if (user) return { user, role: "worker" };
  return null;
};

const getEmailForUser = (user, role) => {
  return role === "worker" ? user.emailAddress : user.email;
};

// ─── POST /api/auth/customer/register ─────────────────────────────────────────
router.post(
  "/customer/register",
  asyncHandler(async (req, res) => {
    const { fullName, email, password, phone, location } = req.body;

    if (!fullName || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message: "Full name, email, phone, and password are required.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters.",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address.",
      });
    }

    // Check if email exists in customers
    const existingCustomer = await Customer.findOne({
      email: email.toLowerCase().trim(),
      isDeleted: false,
    });
    
    // NEW: Check if email already used by a worker
    const existingWorker = await Worker.findOne({
      emailAddress: email.toLowerCase().trim(),
      isDeleted: false,
    });
    
    if (existingWorker) {
      return res.status(409).json({
        success: false,
        message: "This email is already registered as a worker account. You cannot create multiple account types with the same email.",
      });
    }
    
    if (existingCustomer) {
      const pendingVerification =
        existingCustomer.isVerified === false ||
        existingCustomer.status === "pending-verification";
      if (pendingVerification) {
        const cooldown = await assertVerificationEmailCooldown(
          existingCustomer.email,
        );
        if (cooldown.blocked) {
          return res.status(429).json({
            success: false,
            code: "EMAIL_COOLDOWN",
            message: cooldown.message,
            requiresVerification: true,
            email: existingCustomer.email,
          });
        }
        const { emailResult } = await issueVerificationForCustomer(
          existingCustomer,
        );
        return res.status(200).json({
          success: true,
          code: "PENDING_VERIFICATION",
          requiresVerification: true,
          email: existingCustomer.email,
          message: emailResult.success
            ? "A new verification code was sent to your email. Enter it below to activate your account."
            : "Your account is pending verification. Use Resend code on the next screen.",
        });
      }
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists as a customer.",
      });
    }

    const verificationCode = generateVerificationCode();
    const verificationExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const customer = await Customer.create({
      fullName,
      email,
      password,
      phone,
      location: location || "",
      isVerified: false,
      status: "pending-verification",
      emailVerificationCode: verificationCode,
      emailVerificationExpiresAt: verificationExpiresAt,
    });

    const emailResult = await sendVerificationEmailWithRetry(
      customer,
      verificationCode,
    );

    // Notify admin of new customer
    emitNotification(
      "customers",
      "created",
      `New customer joined: ${customer.fullName}`,
    );
    emitRefresh("customers");
      notifyAdminNewCustomer(customer).catch(() => {});

    return res.status(201).json({
      success: true,
      message: emailResult.success
        ? "Account created. Check your email for the 6-digit verification code."
        : "Account created. We could not send the verification email — use Resend code on the next screen.",
      requiresVerification: true,
      email: customer.email,
      data: formatCustomerData(customer),
    });
  }),
);

// ─── POST /api/auth/verify-email ───────────────────────────────────────────────
router.post(
  "/verify-email",
  asyncHandler(async (req, res) => {
    const { email, code, role } = req.body;
    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: "Email and verification code are required.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (String(role || "").toLowerCase() === "worker") {
      const worker = await Worker.findOne({
        emailAddress: normalizedEmail,
        isDeleted: false,
      });
      if (!worker) {
        return res.status(404).json({
          success: false,
          message: "No worker account found for this email.",
        });
      }
      if (worker.emailVerified) {
        return res.json({
          success: true,
          message: "Email already verified. Complete your professional details.",
        });
      }
      if (
        !worker.emailVerificationCode ||
        worker.emailVerificationCode !== String(code).trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid verification code.",
        });
      }
      if (
        worker.emailVerificationExpiresAt &&
        worker.emailVerificationExpiresAt < new Date()
      ) {
        return res.status(400).json({
          success: false,
          message: "Verification code expired. Request a new code.",
          code: "CODE_EXPIRED",
        });
      }
      worker.emailVerified = true;
      worker.signupStep = "basic_complete";
      worker.emailVerificationCode = null;
      worker.emailVerificationExpiresAt = null;
      await worker.save();
      return res.json({
        success: true,
        message: "Email verified. Complete your professional details.",
        data: { signupStep: worker.signupStep },
      });
    }

    const customer = await Customer.findOne({
      email: normalizedEmail,
      isDeleted: false,
    });
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "No account found for this email.",
      });
    }

    if (customer.isVerified && customer.status !== "pending-verification") {
      return res.json({
        success: true,
        message: "Email is already verified. You can log in.",
      });
    }

    if (
      !customer.emailVerificationCode ||
      customer.emailVerificationCode !== String(code).trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code.",
      });
    }

    if (
      customer.emailVerificationExpiresAt &&
      customer.emailVerificationExpiresAt < new Date()
    ) {
      return res.status(400).json({
        success: false,
        message: "Verification code expired. Request a new code.",
        code: "CODE_EXPIRED",
      });
    }

    customer.isVerified = true;
    customer.status = "active";
    customer.emailVerificationCode = null;
    customer.emailVerificationExpiresAt = null;
    await customer.save();

    // Notify admin about new verified customer
    notifyAllAdmins({
      title: "New customer verified",
      message: `${customer.fullName} verified their email and is now active.`,
      type: "success",
      relatedEntityId: customer._id,
    }).catch(() => {});
    notifyAdminNewCustomer(customer).catch(() => {});

    // Generate tokens for auto-login
    const payload = { id: customer._id, role: 'customer', email: customer.email };
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '7d' });
    const refreshToken = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET || 'refresh-secret', { expiresIn: '30d' });

    return res.json({
      success: true,
      message: "Account Verification Successful. Logging In...",
      data: {
        accessToken,
        refreshToken,
        customer: {
          id: customer._id,
          email: customer.email,
          fullName: customer.fullName,
          role: 'customer',
          needsProfileCompletion: !customer.phoneNumber || !customer.location,
        },
      },
    });
  }),
);

// ─── POST /api/auth/resend-verification ────────────────────────────────────────
router.post(
  "/resend-verification",
  asyncHandler(async (req, res) => {
    const { email, role } = req.body;
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (String(role || "").toLowerCase() === "worker") {
      const worker = await Worker.findOne({
        emailAddress: normalizedEmail,
        isDeleted: false,
      });
      if (!worker) {
        return res.status(404).json({
          success: false,
          message: "No worker account found for this email.",
        });
      }
      if (worker.emailVerified) {
        return res.json({
          success: true,
          message: "Email already verified. Complete your professional details.",
        });
      }
      const verificationCode = generateVerificationCode();
      worker.emailVerificationCode = verificationCode;
      worker.emailVerificationExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await worker.save();
      const emailResult = await emailService.sendEmailVerificationCode(
        { email: worker.emailAddress, fullName: worker.fullName },
        verificationCode,
      );
      if (!emailResult.success && !emailResult.skipped) {
        return res.status(503).json({
          success: false,
          message: "Could not send verification email. Try again shortly.",
        });
      }
      return res.json({
        success: true,
        message: "Verification code sent. Check your inbox.",
      });
    }

    const customer = await Customer.findOne({
      email: normalizedEmail,
      isDeleted: false,
    });
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "No account found for this email.",
      });
    }

    if (customer.isVerified && customer.status !== "pending-verification") {
      return res.json({
        success: true,
        message: "Email is already verified. You can log in.",
      });
    }

    const cooldown = await assertVerificationEmailCooldown(customer.email);
    if (cooldown.blocked) {
      return res.status(429).json({
        success: false,
        message: cooldown.message,
        code: "EMAIL_COOLDOWN",
      });
    }

    const verificationCode = generateVerificationCode();
    customer.emailVerificationCode = verificationCode;
    customer.emailVerificationExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await customer.save();

    const emailResult = await sendVerificationEmailWithRetry(
      customer,
      verificationCode,
    );
    if (!emailResult.success && !emailResult.skipped) {
      return res.status(503).json({
        success: false,
        message:
          "Could not send verification email. Please try again in a moment.",
      });
    }

    return res.json({
      success: true,
      message: "Verification code sent. Check your inbox.",
    });
  }),
);

// ─── POST /api/auth/customer/login ────────────────────────────────────────────
/** Remember me = long-lived refresh; otherwise 3-day refresh. */
const refreshTokenExpiryDays = (rememberMe) =>
  rememberMe === true || rememberMe === "true" ? 365 : 3;

const refreshTokenDaysFromRecord = (record) => {
  const ms = new Date(record.expiresAt).getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
};

router.post(
  "/customer/login",
  asyncHandler(async (req, res) => {
    const { email, password, rememberMe } = req.body;

    // Input validation and sanitization
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Email and password are required." });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || email.length > 254) {
      return res
        .status(400)
        .json({ success: false, message: "Valid email address is required." });
    }

    // Password validation
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long.",
      });
    }

    const customer = await Customer.findOne({
      email: email.toLowerCase().trim(),
      isDeleted: false,
    });
    if (!customer) {
      return res.status(401).json({
        success: false,
        message: "No account found for this email. Please sign up first.",
        code: "ACCOUNT_NOT_FOUND",
      });
    }
    if (!customer.password) {
      return res.status(400).json({
        success: false,
        message: "This account uses Google sign-in. Please tap Continue with Google.",
        code: "USE_GOOGLE_SIGNIN",
      });
    }
    if (!(await customer.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password.",
        code: "INVALID_PASSWORD",
      });
    }

    if (
      customer.isVerified === false ||
      customer.status === "pending-verification"
    ) {
      return res.status(403).json({
        success: false,
        code: "EMAIL_NOT_VERIFIED",
        message:
          "Please verify your email before logging in. Check your inbox for the 6-digit code.",
        email: customer.email,
      });
    }

    if (!customer.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated. Please contact support.",
      });
    }

    if (customer.status === "rejected") {
      return res.status(403).json({
        success: false,
        message: "Your account has been rejected. Please contact support.",
      });
    }

    const tokenPayload = {
      id: customer._id,
      role: "customer",
      email: customer.email,
    };
    const token = createToken(tokenPayload);

    customer.lastActive = new Date();
    if (customer.status !== "rejected") {
      customer.status = "active";
    }
    await customer.save();
    emitRefresh("customers");

    createNotification({
      userId: customer._id,
      userRole: "customer",
      title: "Logged in",
      message: `You're logged in FixItNow on ${new Date().toLocaleString()}.`,
      type: "info",
      deliverPush: false,
    }).catch(() => {});

    let refreshToken;
    if (env.USE_REFRESH_TOKENS) {
      refreshToken = await createRefreshToken(
        customer._id,
        "customer",
        req,
        refreshTokenExpiryDays(rememberMe),
      );
    }

    return res.json(
      attachAuthToResponse(res, {
        accessToken: token,
        refreshToken,
        body: {
          success: true,
          message: "Login successful.",
          customer: formatCustomerData(customer),
        },
      }),
    );
  }),
);

router.post(
  "/password/forgot",
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Email is required." });
    }

    const found = await findUserByEmail(email);
    if (!found) {
      return res
        .status(404)
        .json({ success: false, message: "Account not found." });
    }

    const { user, role } = found;
    const passwordResetCode = generateResetCode();
    const passwordResetExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    user.passwordResetCode = passwordResetCode;
    user.passwordResetExpiresAt = passwordResetExpiresAt;
    await user.save();

    logger.warn("Password reset email is disabled; code generated but not sent", {
      email: getEmailForUser(user, role),
    });

    return res.json({
      success: true,
      message: "Password reset code sent. Check your email.",
    });
  }),
);

router.post(
  "/password/reset",
  asyncHandler(async (req, res) => {
    const { email, code, password } = req.body;
    if (!email || !code || !password) {
      return res.status(400).json({
        success: false,
        message: "Email, code, and new password are required.",
      });
    }
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters.",
      });
    }

    const found = await findUserByEmail(email);
    if (!found) {
      return res
        .status(404)
        .json({ success: false, message: "Account not found." });
    }

    const { user, role } = found;
    if (!user.passwordResetCode || !user.passwordResetExpiresAt) {
      return res.status(400).json({
        success: false,
        message:
          "No password reset request found. Please request a reset code.",
      });
    }

    if (user.passwordResetCode !== String(code).trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid password reset code." });
    }

    if (user.passwordResetExpiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        message: "Password reset code has expired. Please request a new code.",
      });
    }

    user.password = password;
    user.passwordResetCode = null;
    user.passwordResetExpiresAt = null;
    if (role === "customer" && user.status !== "rejected") {
      user.status = "active";
    }
    await user.save();

    return res.json({
      success: true,
      message:
        "Password reset successfully. You can now login with your new password.",
    });
  }),
);

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const refreshToken = getRefreshTokenFromRequest(req);

    if (!refreshToken) {
      return res
        .status(400)
        .json({ success: false, message: "Refresh token is required." });
    }

    try {
      const {
        verifyRefreshToken,
        createAccessToken,
        createRefreshToken,
        revokeRefreshToken,
      } = await import("../utils/jwt.js");
      const record = await verifyRefreshToken(refreshToken);

      let user;
      if (record.userRole === "customer") {
        user = await Customer.findById(record.userId);
      } else if (record.userRole === "worker") {
        user = await Worker.findById(record.userId);
      } else if (record.userRole === "admin") {
        const {
          ENV_SUPER_ADMIN_ID,
          isEnvSuperAdminConfigured,
          getEnvSuperAdminProfile,
        } = await import("../services/envSuperAdmin.js");
        const { ADMIN_PANEL_ROLES } = await import("../middleware/adminRoles.js");

        if (String(record.userId) === ENV_SUPER_ADMIN_ID) {
          if (!isEnvSuperAdminConfigured()) {
            await revokeRefreshToken(refreshToken);
            return res.status(503).json({
              success: false,
              message: "Super admin is not configured on the server.",
            });
          }
          const profile = getEnvSuperAdminProfile();
          const payload = {
            id: ENV_SUPER_ADMIN_ID,
            role: "admin",
            email: profile.email,
            adminRole: ADMIN_PANEL_ROLES.SUPER_ADMIN,
          };
          const newAccessToken = createAccessToken(payload);
          const newRefreshToken = await createRefreshToken(
            ENV_SUPER_ADMIN_ID,
            record.userRole,
            req,
            refreshTokenDaysFromRecord(record),
          );
          await revokeRefreshToken(refreshToken);
          return res.json(
            attachAuthToResponse(res, {
              accessToken: newAccessToken,
              refreshToken: newRefreshToken,
              body: {
                success: true,
                message: "Token refreshed successfully.",
              },
            }),
          );
        }

        const Admin = (await import("../models/Admin.js")).default;
        user = await Admin.findById(record.userId);
        if (!user) {
          return res
            .status(401)
            .json({ success: false, message: "Account not found." });
        }
        if (user.isActive === false) {
          await revokeRefreshToken(refreshToken);
          return res.status(403).json({
            success: false,
            message: "Account has been deactivated.",
          });
        }
        const payload = {
          id: user._id,
          role: "admin",
          email: user.email,
          adminRole: user.role || "admin",
        };
        const newAccessToken = createAccessToken(payload);
        const newRefreshToken = await createRefreshToken(
          user._id,
          record.userRole,
          req,
          refreshTokenDaysFromRecord(record),
        );
        await revokeRefreshToken(refreshToken);
        return res.json(
          attachAuthToResponse(res, {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            body: {
              success: true,
              message: "Token refreshed successfully.",
            },
          }),
        );
      }

      if (!user) {
        return res
          .status(401)
          .json({ success: false, message: "Account not found." });
      }

      // Check if user is still active
      if (user.isActive === false) {
        await revokeRefreshToken(refreshToken);
        return res
          .status(403)
          .json({ success: false, message: "Account has been deactivated." });
      }

      if (user.status === "rejected") {
        await revokeRefreshToken(refreshToken);
        return res
          .status(403)
          .json({ success: false, message: "Account has been rejected." });
      }

      const payload = {
        id: user._id,
        role: record.userRole,
        email:
          record.userRole === "customer"
            ? user.email
            : record.userRole === "worker"
              ? user.emailAddress
              : user.email,
      };

      const newAccessToken = createAccessToken(payload);

      // Token rotation: issue new refresh token and revoke old one
      const newRefreshToken = await createRefreshToken(
        user._id,
        record.userRole,
        req,
        refreshTokenDaysFromRecord(record),
      );
      await revokeRefreshToken(refreshToken);

      logger.info("Token rotated successfully", {
        userId: user._id,
        userRole: record.userRole,
        ip: req.ip,
      });

      return res.json(
        attachAuthToResponse(res, {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          body: {
            success: true,
            message: "Token refreshed successfully.",
          },
        }),
      );
    } catch (err) {
      logger.warn("Refresh token failed", { error: err.message, ip: req.ip });
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired refresh token." });
    }
  }),
);

// ─── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const { refreshToken, userId, userRole } = req.body;

    // Revoke specific refresh token if provided
    if (refreshToken) {
      try {
        const { revokeRefreshToken } = await import("../utils/jwt.js");
        await revokeRefreshToken(refreshToken);
        logger.info("Refresh token revoked on logout", { ip: req.ip });
      } catch (err) {
        logger.warn("Logout refresh token revocation failed", {
          error: err.message,
        });
      }
    }

    // Revoke all refresh tokens for user if userId and userRole provided (more secure)
    if (userId && userRole) {
      try {
        const { revokeAllUserRefreshTokens } = await import("../utils/jwt.js");
        await revokeAllUserRefreshTokens(userId, userRole);
        logger.info("All refresh tokens revoked for user on logout", {
          userId,
          userRole,
          ip: req.ip,
        });
      } catch (err) {
        logger.warn("Logout all tokens revocation failed", {
          error: err.message,
        });
      }
    }

    clearAuthCookies(res);
    return res.json({ success: true, message: "Logged out successfully." });
  }),
);

// ─── PUT /api/auth/customer/profile ───────────────────────────────────────────
router.put(
  "/customer/profile",
  requireCustomer,
  asyncHandler(async (req, res) => {
    const { fullName, email, phone, profilePicture } = req.body;

    const updateFields = {};
    if (fullName !== undefined) updateFields.fullName = fullName;
    if (email !== undefined) updateFields.email = email;
    if (phone !== undefined) updateFields.phone = phone;
    applyLocationUpdate(updateFields, req.body);
    if (profilePicture !== undefined) {
      if (
        typeof profilePicture === "string" &&
        profilePicture.startsWith("data:image")
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Profile photos must be uploaded via POST /auth/customer/profile-picture (file too large for JSON).",
        });
      }
      updateFields.profilePicture = profilePicture;
    }

    const customer = await Customer.findByIdAndUpdate(
      req.customer.id,
      updateFields,
      { new: true, runValidators: true },
    ).select("-password -bookings");

    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found." });
    }

    // Notify admin of profile update
    emitRefresh("customers");

    return res.json({
      success: true,
      message: "Profile updated successfully.",
      data: formatCustomerData(customer),
    });
  }),
);

// ─── POST /api/auth/customer/profile-picture ───────────────────────────────────
router.post(
  "/customer/profile-picture",
  requireCustomer,
  profilePictureUpload.single("profilePicture"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded." });
    }

    try {
      await validateFile(req.file.path, req.file.originalname, req.file.mimetype);
    } catch (validationError) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: `File validation failed: ${validationError.message}`,
      });
    }

    const customer = await Customer.findById(req.customer.id);
    if (!customer) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res
        .status(404)
        .json({ success: false, message: "Customer not found." });
    }

    if (customer.profilePicture) {
      const oldPath = path.join(__dirname, "..", customer.profilePicture);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    customer.profilePicture = `/uploads/profile-pictures/${req.file.filename}`;
    await customer.save();

    emitRefresh("customers");
    const data = formatCustomerData(customer);

    return res.json({
      success: true,
      message: "Profile picture uploaded successfully.",
      data,
    });
  }),
);

// ─── POST /api/auth/worker/register (step 1 — basic info) ─────────────────────
router.post(
  "/worker/register",
  asyncHandler(async (req, res) => {
    const {
      firstName,
      lastName,
      emailAddress,
      password,
      phoneNumber,
      fullName: legacyFullName,
    } = req.body;
    const first = String(firstName || "").trim();
    const last = String(lastName || "").trim();
    const fullName =
      [first, last].filter(Boolean).join(" ") ||
      String(legacyFullName || "").trim();

    const phone = String(phoneNumber || "").trim();

    if (!fullName || !emailAddress || !password || !phone) {
      return res.status(400).json({
        success: false,
        message: "Full name, email, phone number, and password are required.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters.",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address.",
      });
    }

    const email = emailAddress.toLowerCase().trim();
    const existingWorker = await Worker.findOne({
      emailAddress: email,
      isDeleted: false,
    });
    if (existingWorker) {
      return res.status(409).json({
        success: false,
        message: "A worker with this email already exists.",
      });
    }

    const existingCustomer = await Customer.findOne({
      email,
      isDeleted: false,
    });
    if (existingCustomer) {
      return res.status(409).json({
        success: false,
        message:
          "This email is registered as a customer. Use a different email for worker signup.",
      });
    }

    const verificationCode = generateVerificationCode();
    const worker = await Worker.create({
      firstName: first,
      lastName: last,
      fullName,
      emailAddress: email,
      password,
      phoneNumber: phone,
      cnicNumber: "",
      primaryServiceCategory: "",
      signupStep: "awaiting_email",
      emailVerified: false,
      emailVerificationCode: verificationCode,
      emailVerificationExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      status: "not_approved",
    });

    const emailResult = await emailService.sendEmailVerificationCode(
      { email, fullName },
      verificationCode,
    );
    if (!emailResult.success && !emailResult.skipped) {
      return res.status(503).json({
        success: false,
        message: "Could not send verification email. Try again shortly.",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Check your email for a verification code, then complete your professional details.",
      data: {
        emailAddress: worker.emailAddress,
        signupStep: worker.signupStep,
      },
    });
  }),
);

// ─── POST /api/auth/worker/register/professional (step 2) ─────────────────────
router.post(
  "/worker/register/professional",
  verificationPhotoUpload.single("verificationPhoto"),
  asyncHandler(async (req, res) => {
    const {
      emailAddress,
      password,
      phoneNumber,
      cnicNumber,
      primaryServiceId,
      primaryServiceName,
      primaryServiceCategory,
    } = req.body;

    if (!emailAddress) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const worker = await Worker.findOne({
      emailAddress: emailAddress.toLowerCase().trim(),
      isDeleted: false,
    });
    if (!worker) {
      return res.status(404).json({
        success: false,
        message: "Worker account not found.",
      });
    }

    if (worker.authProvider === "local") {
      if (!worker.emailVerified) {
        return res.status(403).json({
          success: false,
          message: "Verify your email before completing professional details.",
          code: "EMAIL_NOT_VERIFIED",
        });
      }
      if (password && !(await worker.comparePassword(password))) {
        return res.status(401).json({
          success: false,
          message: "Incorrect password.",
        });
      }
    }

    if (!cnicNumber) {
      return res.status(400).json({
        success: false,
        message: "CNIC is required.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Passport-size verification photo is required.",
      });
    }

    // Check phone: from worker record or from request body
    const finalPhoneNumber = (worker.phoneNumber?.trim() || String(phoneNumber || "").trim());
    if (!finalPhoneNumber) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required. Please provide your phone number.",
      });
    }

    const cnicClean = String(cnicNumber).replace(/-/g, "");
    if (!/^\d{13}$/.test(cnicClean)) {
      return res.status(400).json({
        success: false,
        message: "CNIC must be 13 digits.",
      });
    }

    const serviceFields = await resolveWorkerServiceFields({
      primaryServiceId,
      primaryServiceName,
      primaryServiceCategory,
      serviceCategory: req.body.serviceCategory,
    });
    if (!serviceFields.primaryServiceCategory) {
      return res.status(400).json({
        success: false,
        message: "Trade / service is required.",
      });
    }

    const cnicStored = normalizeCnic(cnicNumber);
    const duplicateCnic = await Worker.findOne({
      cnicNumber: cnicStored,
      _id: { $ne: worker._id },
      isDeleted: false,
    });
    if (duplicateCnic) {
      return res.status(409).json({
        success: false,
        message: "This CNIC is already registered.",
      });
    }

    worker.cnicNumber = cnicStored;
    worker.primaryServiceCategory = serviceFields.primaryServiceCategory;
    worker.primaryServiceName = serviceFields.primaryServiceName || "";
    worker.primaryServiceId = serviceFields.primaryServiceId || null;
    worker.signupStep = "complete";
    
    // Save phone number if provided in request (OAuth workers provide it here)
    if (phoneNumber && String(phoneNumber).trim() && !worker.phoneNumber?.trim()) {
      worker.phoneNumber = String(phoneNumber).trim();
    }

    // Handle location update
    applyLocationUpdate(worker, req.body);
    
    // Handle verification photo upload
    if (req.file) {
      worker.verificationPhoto = `/uploads/worker-verification/${req.file.filename}`;
    }
    
    await worker.save();

    emitNotification(
      "workers",
      "created",
      `Worker profile complete: ${worker.fullName} (${worker.primaryServiceCategory})`,
    );
    notifyAllAdmins({
      title: "New worker application",
      message: `${worker.fullName} submitted professional details for review.`,
      type: "info",
      relatedEntityId: worker._id,
    }).catch(() => {});

    // Send notification via notification service
    notifyAdminNewWorker(worker).catch(() => {});

    return res.json({
      success: true,
      message:
        "Professional details saved. Admin will review and approve your account.",
      data: formatWorkerData(worker),
    });
  }),
);

// ─── POST /api/auth/worker/login ──────────────────────────────────────────────
router.post(
  "/worker/login",
  asyncHandler(async (req, res) => {
    const { emailAddress, password, rememberMe } = req.body;

    // Input validation and sanitization
    if (!emailAddress || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Email and password are required." });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailAddress) || emailAddress.length > 254) {
      return res
        .status(400)
        .json({ success: false, message: "Valid email address is required." });
    }

    // Password validation
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long.",
      });
    }

    const worker = await Worker.findOne({
      emailAddress: emailAddress.toLowerCase().trim(),
      isDeleted: false,
    });
    if (!worker) {
      return res.status(401).json({
        success: false,
        message: "No account found for this email. Please sign up first.",
        code: "ACCOUNT_NOT_FOUND",
      });
    }
    if (!worker.password) {
      return res.status(400).json({
        success: false,
        message: "This account uses Google sign-in. Please tap Continue with Google.",
        code: "USE_GOOGLE_SIGNIN",
      });
    }
    if (!(await worker.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password.",
        code: "INVALID_PASSWORD",
      });
    }

    if (worker.authProvider === "local" && !worker.emailVerified) {
      return res.status(403).json({
        success: false,
        message: "Verify your email before signing in.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    if (worker.signupStep !== "complete") {
      const tokenPayload = {
        id: worker._id,
        role: "worker",
        email: worker.emailAddress,
      };
      const token = createToken(tokenPayload);
      let refreshToken;
      if (env.USE_REFRESH_TOKENS) {
        refreshToken = await createRefreshToken(
          worker._id,
          "worker",
          req,
          refreshTokenExpiryDays(rememberMe),
        );
      }
      return res.json(
        attachAuthToResponse(res, {
          accessToken: token,
          refreshToken,
          body: {
            success: true,
            message: "Complete your professional details to finish signup.",
            worker: formatWorkerData(worker),
            needsProfessionalProfile: true,
          },
        }),
      );
    }

    if (worker.status === "not_approved") {
      return res.status(403).json({
        success: false,
        message:
          "Your account is pending admin approval. Please wait for verification.",
      });
    }
    if (worker.status === "rejected") {
      return res.status(403).json({
        success: false,
        message: "Your account has been rejected. Please contact support.",
      });
    }
    if (worker.isDisabled) {
      return res.status(403).json({
        success: false,
        message:
          "Your account has been disabled by an administrator. Please contact support.",
      });
    }

    const tokenPayload = {
      id: worker._id,
      role: "worker",
      email: worker.emailAddress,
    };
    const token = createToken(tokenPayload);

    worker.lastActive = new Date();
    if (!["not_approved", "rejected"].includes(worker.status)) {
      worker.status = "active";
    }
    await worker.save();
    emitRefresh("workers");

    createNotification({
      userId: worker._id,
      userRole: "worker",
      title: "Logged in",
      message: `You're logged in FixItNow on ${new Date().toLocaleString()}.`,
      type: "info",
      deliverPush: false,
    }).catch(() => {});

    let refreshToken;
    if (env.USE_REFRESH_TOKENS) {
      refreshToken = await createRefreshToken(
        worker._id,
        "worker",
        req,
        refreshTokenExpiryDays(rememberMe),
      );
    }

    return res.json(
      attachAuthToResponse(res, {
        accessToken: token,
        refreshToken,
        body: {
          success: true,
          message: "Login successful.",
          worker: formatWorkerData(worker),
        },
      }),
    );
  }),
);

// ─── PUT /api/auth/worker/profile ───────────────────────────────────────────────
router.put(
  "/worker/profile",
  requireWorker,
  asyncHandler(async (req, res) => {
    const {
      fullName,
      emailAddress,
      phoneNumber,
      primaryServiceCategory,
      profilePicture,
      availability,
    } = req.body;

    const updateFields = {};
    if (fullName !== undefined) updateFields.fullName = fullName;
    if (emailAddress !== undefined) {
      const email = emailAddress.toLowerCase().trim();
      const existingWorker = await Worker.findOne({
        emailAddress: email,
        _id: { $ne: req.worker.id },
      });
      if (existingWorker) {
        return res.status(409).json({
          success: false,
          message: "Worker with this email already exists.",
        });
      }
      const existingCustomer = await Customer.findOne({ email });
      if (existingCustomer) {
        return res.status(409).json({
          success: false,
          message: "This email is already registered as a customer.",
        });
      }
      updateFields.emailAddress = email;
    }
    if (phoneNumber !== undefined) updateFields.phoneNumber = phoneNumber;
    if (
      req.body.primaryServiceId !== undefined ||
      req.body.primaryServiceName !== undefined ||
      primaryServiceCategory !== undefined
    ) {
      const serviceFields = await resolveWorkerServiceFields(req.body);
      if (serviceFields.primaryServiceCategory) {
        updateFields.primaryServiceCategory = serviceFields.primaryServiceCategory;
      }
      if (serviceFields.primaryServiceName !== undefined) {
        updateFields.primaryServiceName = serviceFields.primaryServiceName;
      }
      if (serviceFields.primaryServiceId !== undefined) {
        updateFields.primaryServiceId = serviceFields.primaryServiceId;
      }
    }
    applyLocationUpdate(updateFields, req.body);
    if (profilePicture !== undefined)
      updateFields.profilePicture = profilePicture;
    if (availability !== undefined) updateFields.availability = availability;

    const worker = await Worker.findByIdAndUpdate(req.worker.id, updateFields, {
      new: true,
      runValidators: true,
    }).select("-password -jobs");

    if (!worker) {
      return res
        .status(404)
        .json({ success: false, message: "Worker not found." });
    }

    const payload = { ...formatWorkerData(worker), type: "worker" };

    // Notify admin of profile update
    emitRefresh("workers");
    emitToUser(String(worker._id), "profile-updated", payload);

    return res.json({
      success: true,
      message: "Profile updated successfully.",
      data: payload,
    });
  }),
);

// ─── DELETE /api/auth/customer/delete-account ───────────────────────────────────
router.delete(
  "/customer/delete-account",
  requireCustomer,
  asyncHandler(async (req, res) => {
    const customerId = req.customer.id;

    // Get customer details for notification
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found." });
    }

    // Revoke all refresh tokens for this customer
    try {
      const { revokeAllUserRefreshTokens } = await import("../utils/jwt.js");
      await revokeAllUserRefreshTokens(customerId, "customer");
    } catch (err) {
      logger.warn("Failed to revoke refresh tokens on account deletion", {
        error: err.message,
      });
    }

    const deletedAt = new Date();
    await Booking.updateMany(
      { customerId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt } },
    );
    await Customer.findByIdAndUpdate(customerId, {
      isDeleted: true,
      deletedAt,
      isActive: false,
      status: CUSTOMER_STATUS.INACTIVE,
    });

    // Notify admin
    emitNotification(
      "customers",
      "deleted",
      `Customer account deleted: ${customer.fullName}`,
    );
    emitRefresh("customers");

    return res.json({
      success: true,
      message: "Account and all related data deleted successfully.",
    });
  }),
);

// ─── DELETE /api/auth/worker/delete-account ─────────────────────────────────────
router.delete(
  "/worker/delete-account",
  requireWorker,
  asyncHandler(async (req, res) => {
    const workerId = req.worker.id;

    // Get worker details for notification
    const worker = await Worker.findById(workerId);
    if (!worker) {
      return res
        .status(404)
        .json({ success: false, message: "Worker not found." });
    }
    if (worker.isDeleted) {
      return res.status(400).json({
        success: false,
        message: "Account is already deleted.",
        code: "ACCOUNT_ALREADY_DELETED",
      });
    }
    if (worker.isDisabled) {
      return res.status(400).json({
        success: false,
        message: "Account is disabled. Please contact support.",
        code: "ACCOUNT_DISABLED",
      });
    }

    // Revoke all refresh tokens for this worker
    try {
      const { revokeAllUserRefreshTokens } = await import("../utils/jwt.js");
      await revokeAllUserRefreshTokens(workerId, "worker");
    } catch (err) {
      logger.warn("Failed to revoke refresh tokens on account deletion", {
        error: err.message,
      });
    }

    const deletedAt = new Date();
    await Booking.updateMany(
      { workerId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt } },
    );
    await Worker.findByIdAndUpdate(workerId, {
      isDeleted: true,
      deletedAt,
      status: WORKER_STATUS.INACTIVE,
      isDisabled: true,
    });

    // Notify admin
    emitNotification(
      "workers",
      "deleted",
      `Worker account deleted: ${worker.fullName}`,
    );
    emitRefresh("workers");

    return res.json({
      success: true,
      message: "Account and all related data deleted successfully.",
    });
  }),
);

// ─── POST /api/auth/google/customer ───────────────────────────────────────────
router.post(
  "/google/customer",
  asyncHandler(async (req, res) => {
    if (!isGoogleAuthEnabled()) {
      return res.status(503).json({
        success: false,
        message: "Google sign-in is not configured on the server.",
        code: "GOOGLE_NOT_CONFIGURED",
      });
    }

    const { rememberMe } = req.body;
    const credential = readGoogleCredential(req.body);
    if (!credential) {
      return res.status(400).json({
        success: false,
        message: "Google credential is required.",
        code: "GOOGLE_CREDENTIAL_REQUIRED",
      });
    }

    let payload;
    try {
      payload = await verifyGoogleIdToken(credential);
    } catch (err) {
      const status = err.code === "GOOGLE_NOT_CONFIGURED" ? 503 : 401;
      return res.status(status).json({
        success: false,
        message: err.message || "Google sign-in failed.",
        code: err.code || "GOOGLE_AUTH_FAILED",
      });
    }
    const email = String(payload.email).toLowerCase().trim();
    const googleId = String(payload.sub);
    const fullName =
      String(payload.name || "").trim() ||
      email.split("@")[0] ||
      "Customer";

    const existingWorker = await Worker.findOne({
      emailAddress: email,
      isDeleted: false,
    });
    if (existingWorker) {
      return res.status(409).json({
        success: false,
        message:
          "This email is registered as a worker. Use worker sign-in or a different email.",
      });
    }

    let customer = await Customer.findOne({
      $or: [{ googleId }, { email }],
      isDeleted: false,
    });

    if (customer && customer.email !== email && customer.googleId !== googleId) {
      return res.status(409).json({
        success: false,
        message: "This Google account cannot be linked. Contact support.",
      });
    }

    if (!customer) {
      customer = await Customer.create({
        fullName,
        email,
        googleId,
        authProvider: "google",
        phone: "",
        isVerified: true,
        status: "active",
      });
      emitNotification("customers", "created", `New customer joined: ${customer.fullName}`);
      emitRefresh("customers");
      notifyAllAdmins({
        title: "New customer",
        message: `${customer.fullName} signed up with Google.`,
        type: "info",
        relatedEntityId: customer._id,
      }).catch(() => {});
    } else {
      if (!customer.googleId) {
        customer.googleId = googleId;
        customer.authProvider = "google";
      }
      if (!customer.fullName?.trim()) customer.fullName = fullName;
      customer.isVerified = true;
      customer.lastActive = new Date();
      if (customer.status !== "rejected") customer.status = "active";
      await customer.save();
    }

    if (!customer.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated. Please contact support.",
      });
    }

    const tokenPayload = {
      id: customer._id,
      role: "customer",
      email: customer.email,
    };
    const token = createToken(tokenPayload);

    let refreshToken;
    if (env.USE_REFRESH_TOKENS) {
      refreshToken = await createRefreshToken(
        customer._id,
        "customer",
        req,
        refreshTokenExpiryDays(rememberMe),
      );
    }

    return res.json(
      attachAuthToResponse(res, {
        accessToken: token,
        refreshToken,
        body: {
          success: true,
          message: "Signed in with Google.",
          customer: formatCustomerData(customer),
        },
      }),
    );
  }),
);

// ─── POST /api/auth/google/worker ─────────────────────────────────────────────
router.post(
  "/google/worker",
  asyncHandler(async (req, res) => {
    if (!isGoogleAuthEnabled()) {
      return res.status(503).json({
        success: false,
        message: "Google sign-in is not configured on the server.",
        code: "GOOGLE_NOT_CONFIGURED",
      });
    }

    const { rememberMe } = req.body;
    const credential = readGoogleCredential(req.body);
    if (!credential) {
      return res.status(400).json({
        success: false,
        message: "Google credential is required.",
        code: "GOOGLE_CREDENTIAL_REQUIRED",
      });
    }

    let payload;
    try {
      payload = await verifyGoogleIdToken(credential);
    } catch (err) {
      const status = err.code === "GOOGLE_NOT_CONFIGURED" ? 503 : 401;
      return res.status(status).json({
        success: false,
        message: err.message || "Google sign-in failed.",
        code: err.code || "GOOGLE_AUTH_FAILED",
      });
    }
    const email = String(payload.email).toLowerCase().trim();
    const googleId = String(payload.sub);
    const fullName =
      String(payload.name || "").trim() ||
      email.split("@")[0] ||
      "Worker";
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const firstName =
      String(payload.given_name || "").trim() || nameParts[0] || "";
    const lastName =
      String(payload.family_name || "").trim() ||
      nameParts.slice(1).join(" ") ||
      "";

    const existingCustomer = await Customer.findOne({
      email,
      isDeleted: false,
    });
    if (existingCustomer) {
      return res.status(409).json({
        success: false,
        message:
          "This email is registered as a customer. Use customer sign-in or a different email.",
      });
    }

    let worker = await Worker.findOne({
      $or: [{ googleId }, { emailAddress: email }],
      isDeleted: false,
    });

    if (worker && worker.emailAddress !== email && worker.googleId !== googleId) {
      return res.status(409).json({
        success: false,
        message: "This Google account cannot be linked. Contact support.",
      });
    }

    if (!worker) {
      worker = await Worker.create({
        firstName,
        lastName,
        fullName,
        emailAddress: email,
        googleId,
        authProvider: "google",
        phoneNumber: "",
        cnicNumber: "",
        primaryServiceCategory: "",
        emailVerified: true,
        signupStep: "basic_complete",
        status: "not_approved",
      });
      emitNotification("workers", "created", `New worker joined: ${worker.fullName}`);
      emitRefresh("workers");
      notifyAllAdmins({
        title: "New worker",
        message: `${worker.fullName} signed up with Google.`,
        type: "info",
        relatedEntityId: worker._id,
      }).catch(() => {});
    } else {
      if (!worker.googleId) {
        worker.googleId = googleId;
        worker.authProvider = "google";
      }
      if (!worker.fullName?.trim()) worker.fullName = fullName;
      worker.emailVerified = true;
      if (worker.signupStep === "awaiting_email") {
        worker.signupStep = "basic_complete";
      }
      worker.lastActive = new Date();
      await worker.save();
    }

    if (worker.isDisabled) {
      return res.status(403).json({
        success: false,
        message: "Your worker account has been disabled.",
      });
    }
    if (worker.status === "rejected") {
      return res.status(403).json({
        success: false,
        message: "Your worker application was rejected.",
      });
    }

    const tokenPayload = {
      id: worker._id,
      role: "worker",
      email: worker.emailAddress,
    };
    const token = createToken(tokenPayload);

    let refreshToken;
    if (env.USE_REFRESH_TOKENS) {
      refreshToken = await createRefreshToken(
        worker._id,
        "worker",
        req,
        refreshTokenExpiryDays(rememberMe),
      );
    }

    return res.json(
      attachAuthToResponse(res, {
        accessToken: token,
        refreshToken,
        body: {
          success: true,
          message: "Signed in with Google.",
          worker: formatWorkerData(worker),
          needsProfessionalProfile: worker.signupStep !== "complete",
        },
      }),
    );
  }),
);

export default router;
