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
import Advertisement from "../models/Advertisement.js";
import PushSubscription from "../pushSubscriptionSchema.js";
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
import { uploadsSubdir } from "../utils/uploadPaths.js";
import { profilePictureUpload } from "../utils/profilePictureMulter.js";
import { CUSTOMER_STATUS, WORKER_STATUS } from "../utils/constants.js";
import { resolveWorkerServiceFields, resolveWorkerServicesArray, applyWorkerServices } from "../utils/workerServiceFields.js";
import { addEmailJob } from "../utils/emailQueue.js";
import { getCache, setCache } from "../utils/cache.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const verificationPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = uploadsSubdir("worker-verification");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const prefixes = {
      verificationPhoto: "verify",
      cnicFrontPhoto: "cnic-front",
      cnicBackPhoto: "cnic-back",
    };
    cb(
      null,
      `${prefixes[file.fieldname] || "worker-doc"}-${generateSecureFilename(file.originalname, "worker")}`,
    );
  },
});

const verificationPhotoUpload = multer({
  storage: verificationPhotoStorage,
  limits: { fileSize: 2 * 1024 * 1024, files: 3 },
  fileFilter: (req, file, cb) => {
    if (!["verificationPhoto", "cnicFrontPhoto", "cnicBackPhoto"].includes(file.fieldname)) {
      return cb(new Error("Unexpected worker document field."), false);
    }
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Worker verification documents must be images."), false);
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
    devicePushEnabled: Boolean(customer.devicePushEnabled),
    isActive: customer.isActive !== false,
    status: customer.status,
    createdAt: customer.createdAt,
    joinDate: customer.joinDate,
  };
}

function formatWorkerData(worker) {
  return {
    id: worker._id,
    _id: worker._id,
    firstName: worker.firstName || "",
    lastName: worker.lastName || "",
    fullName: worker.fullName,
    signupStep: worker.signupStep,
    emailVerified: Boolean(worker.emailVerified),
    email: worker.email,
    phoneNumber: worker.phoneNumber,
    cnicNumber: worker.cnicNumber,
    cnicFrontPhoto: worker.cnicFrontPhoto || null,
    cnicBackPhoto: worker.cnicBackPhoto || null,
    verificationPhoto: worker.verificationPhoto || null,
    serviceCategory: worker.primaryServiceCategory,
    primaryServiceCategory: worker.primaryServiceCategory,
    primaryServiceName: worker.primaryServiceName || "",
    primaryServiceId: worker.primaryServiceId || null,
    serviceCategories: worker.serviceCategories,
    services: worker.services || [],
    ...formatLocationResponse(worker),
    profilePicture: worker.profilePicture,
    devicePushEnabled: Boolean(worker.devicePushEnabled),
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
  user = await Worker.findOne({ email: normalized, isDeleted: false });
  if (user) return { user, role: "worker" };
  return null;
};

const getEmailForUser = (user, role) => {
  return user.email;
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
      email: email.toLowerCase().trim(),
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
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: "Email and verification code are required.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

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
    notifyAdminNewCustomer(customer).catch(() => {});

    const tokenPayload = {
      id: customer._id,
      role: "customer",
      email: customer.email,
    };
    const accessToken = createToken(tokenPayload);
    let refreshToken;
    if (env.USE_REFRESH_TOKENS) {
      refreshToken = await createRefreshToken(
        customer._id,
        "customer",
        req,
        30,
      );
    }

    const customerPayload = {
      ...formatCustomerData(customer),
      type: "customer",
      needsProfileCompletion:
        !String(customer.phone || "").trim() ||
        !String(getLocationLabel(customer) || "").trim(),
    };

    return res.json(
      attachAuthToResponse(res, {
        accessToken,
        refreshToken,
        body: {
          success: true,
          autoLogin: true,
          message: "Account Verification Successful. Logging In...",
          customer: customerPayload,
        },
      }),
    );
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
        email: normalizedEmail,
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
        { email: worker.email, fullName: worker.fullName },
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
    const accessToken = createAccessToken(tokenPayload);
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
        accessToken,
        refreshToken,
        body: {
          success: true,
          message: "Login successful.",
          customer: {
            ...formatCustomerData(customer),
            type: "customer",
          },
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
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const found = await findUserByEmail(normalizedEmail);
    if (!found) {
      return res.status(404).json({
        success: false,
        message: "No account found for this email.",
      });
    }

    const { user, role } = found;
    const code = generateResetCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    user.passwordResetCode = code;
    user.passwordResetExpiresAt = expires;
    await user.save();

    const emailResult = await emailService.sendPasswordResetCode(
      { email: user.email, fullName: user.fullName },
      code,
    );
    if (!emailResult.success && !emailResult.skipped) {
      return res.status(503).json({
        success: false,
        message: "Could not send reset code. Please try again shortly.",
      });
    }

    return res.json({
      success: true,
      message: "If the email exists, a password reset code has been sent.",
    });
  }),
);

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post(