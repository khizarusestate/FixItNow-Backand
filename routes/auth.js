import express from "express";
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
import { validateFile } from "../utils/fileValidation.js";
import { profilePictureUpload } from "../utils/profilePictureMulter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

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
    isVerified: customer.isVerified,
    status: customer.status,
    createdAt: customer.createdAt,
    joinDate: customer.joinDate,
  };
}

function formatWorkerData(worker) {
  return {
    id: worker._id,
    _id: worker._id,
    fullName: worker.fullName,
    emailAddress: worker.emailAddress,
    phoneNumber: worker.phoneNumber,
    cnicNumber: worker.cnicNumber,
    serviceCategory: worker.primaryServiceCategory,
    primaryServiceCategory: worker.primaryServiceCategory,
    serviceCategories: worker.serviceCategories,
    ...formatLocationResponse(worker),
    profilePicture: worker.profilePicture,
    availability: worker.availability,
    status: worker.status,
    isVerified: worker.isVerified,
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

const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

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
    });
    if (existingCustomer) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists as a customer.",
      });
    }

    // Check if email exists in workers (one email = one account rule)
    const existingWorker = await Worker.findOne({
      emailAddress: email.toLowerCase().trim(),
    });
    if (existingWorker) {
      return res.status(409).json({
        success: false,
        message:
          "This email is already registered as a worker. Please use a different email.",
      });
    }

    const emailVerificationCode = generateVerificationCode();
    const verificationExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const customer = await Customer.create({
      fullName,
      email,
      password,
      phone,
      location: location || "",
      status: "pending-verification",
      isVerified: false,
      emailVerificationCode,
      emailVerificationExpiresAt: verificationExpiresAt,
    });

    // Send verification email (non-blocking)
    emailService
      .sendVerificationCode(customer, emailVerificationCode, "customer")
      .catch((err) => {
        logger.warn("Verification email failed to send", {
          email: customer.email,
          error: err.message,
        });
      });

    // Notify admin of new customer
    emitNotification(
      "customers",
      "created",
      `New customer joined: ${customer.fullName}`,
    );
    emitRefresh("customers");

    return res.status(201).json({
      success: true,
      message:
        "Account created successfully. Check your email for the verification code before logging in.",
      data: formatCustomerData(customer),
    });
  }),
);

// ─── POST /api/auth/customer/login ────────────────────────────────────────────
/** Remember me = 3-day refresh; otherwise long-lived until logout/revoke. */
const refreshTokenExpiryDays = (rememberMe) =>
  rememberMe === true || rememberMe === "true" ? 3 : 365;

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

    if (!customer.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated. Please contact support.",
      });
    }

    if (!customer.isVerified || customer.status === "pending-verification") {
      return res.status(403).json({
        success: false,
        code: "EMAIL_NOT_VERIFIED",
        message:
          "Please verify your email before logging in. Check your inbox for the 6-digit code.",
        email: customer.email,
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
    if (customer.status !== "rejected" && customer.status !== "pending-verification") {
      customer.status = "active";
    }
    await customer.save();
    emitRefresh("customers");

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
  "/verify-email",
  asyncHandler(async (req, res) => {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: "Email and verification code are required.",
      });
    }

    const found = await findUserByEmail(email);
    if (!found) {
      return res
        .status(404)
        .json({ success: false, message: "Account not found." });
    }

    const { user, role } = found;
    if (user.isVerified) {
      return res.json({ success: true, message: "Email already verified." });
    }

    if (!user.emailVerificationCode || !user.emailVerificationExpiresAt) {
      return res.status(400).json({
        success: false,
        message: "No verification code was issued. Please request a new one.",
      });
    }

    if (user.emailVerificationCode !== String(code).trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid verification code." });
    }

    if (user.emailVerificationExpiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        message: "Verification code has expired. Please request a new code.",
      });
    }

    user.isVerified = true;
    user.emailVerificationCode = null;
    user.emailVerificationExpiresAt = null;

    if (role === "customer") {
      user.status = "active";
    }

    await user.save();

    return res.json({
      success: true,
      message: "Email verified successfully. You can now login.",
    });
  }),
);

router.post(
  "/resend-verification",
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
    if (user.isVerified) {
      return res.json({ success: true, message: "Email is already verified." });
    }

    const emailVerificationCode = generateVerificationCode();
    const verificationExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    user.emailVerificationCode = emailVerificationCode;
    user.emailVerificationExpiresAt = verificationExpiresAt;
    await user.save();

    emailService
      .sendVerificationCode(user, emailVerificationCode, role)
      .catch((err) => {
        logger.warn("Resend verification email failed", {
          email: getEmailForUser(user, role),
          error: err.message,
        });
      });

    return res.json({
      success: true,
      message: "Verification code resent. Check your email.",
    });
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
    const passwordResetCode = generateVerificationCode();
    const passwordResetExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    user.passwordResetCode = passwordResetCode;
    user.passwordResetExpiresAt = passwordResetExpiresAt;
    await user.save();

    emailService
      .sendPasswordResetCode(user, passwordResetCode, role)
      .catch((err) => {
        logger.warn("Password reset code email failed", {
          email: getEmailForUser(user, role),
          error: err.message,
        });
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
    if (!user.isVerified) {
      user.isVerified = true;
    }
    if (role === "customer" && user.status === "pending-verification") {
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

      if (userRole === "worker" && mongoose.Types.ObjectId.isValid(userId)) {
        const worker = await Worker.findById(String(userId));
        if (worker && !worker.isDeleted && worker.status === "active") {
          worker.status = "inactive";
          await worker.save();
          emitRefresh("workers");
        }
      }

      if (userRole === "customer" && mongoose.Types.ObjectId.isValid(userId)) {
        const customer = await Customer.findById(String(userId));
        if (customer && !customer.isDeleted && customer.status === "active") {
          customer.status = "inactive";
          await customer.save();
          emitRefresh("customers");
        }
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

// ─── POST /api/auth/worker/register ───────────────────────────────────────────
router.post(
  "/worker/register",
  asyncHandler(async (req, res) => {
    const {
      fullName,
      emailAddress,
      password,
      phoneNumber,
      cnicNumber,
      primaryServiceCategory,
      serviceCategories,
      serviceArea,
      location,
    } = req.body;

    const effectiveLocation = (location || serviceArea || "").trim();

    // Backward compatibility: accept serviceCategory if primaryServiceCategory is not provided
    const effectivePrimaryCategory =
      primaryServiceCategory || req.body.serviceCategory;

    if (
      !fullName ||
      !emailAddress ||
      !password ||
      !phoneNumber ||
      !cnicNumber ||
      !effectivePrimaryCategory ||
      !effectiveLocation
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Full name, email, password, phone, CNIC, service category, and location are required.",
      });
    }

    // Validate service category is not empty
    if (
      !effectivePrimaryCategory ||
      effectivePrimaryCategory.trim().length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Service category is required and cannot be empty.",
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

    // Flexible CNIC validation: accept with or without dashes
    const cnicClean = cnicNumber.replace(/-/g, "");
    if (!/^\d{13}$/.test(cnicClean)) {
      return res.status(400).json({
        success: false,
        message: "CNIC must be 13 digits (e.g. 35201-1234567-8).",
      });
    }

    const cnicStored = normalizeCnic(cnicNumber);
    const existingWorker = await Worker.findOne({
      isDeleted: false,
      $or: [
        { emailAddress: emailAddress.toLowerCase().trim() },
        { cnicNumber: cnicStored },
      ],
    });
    if (existingWorker) {
      return res.status(409).json({
        success: false,
        message: "A worker with this email or CNIC already exists.",
      });
    }

    // Check if email exists in customers (one email = one account rule)
    const existingCustomer = await Customer.findOne({
      email: emailAddress.toLowerCase().trim(),
      isDeleted: false,
    });
    if (existingCustomer) {
      return res.status(409).json({
        success: false,
        message:
          "This email is already registered as a customer. Please use a different email to join as a worker.",
      });
    }

    // Clean service categories: remove empty strings, duplicates, and ensure primary is not in the list
    const cleanServiceCategories = Array.isArray(serviceCategories)
      ? [
          ...new Set(
            serviceCategories
              .filter(Boolean)
              .filter((cat) => cat !== effectivePrimaryCategory),
          ),
        ]
      : [];

    const { latitude, longitude, placeId } = parseLocationBody(req.body);
    const emailVerificationCode = generateVerificationCode();
    const verificationExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const worker = await Worker.create({
      fullName,
      emailAddress,
      password,
      phoneNumber,
      cnicNumber: cnicStored,
      primaryServiceCategory: effectivePrimaryCategory,
      serviceCategories: [],
      location: effectiveLocation,
      serviceArea: effectiveLocation,
      address: effectiveLocation,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      placeId: placeId || "",
      yearsOfExperience: 0,
      aboutExperience: "",
      experience: "",
      availability: true,
      status: "not_approved",
      isVerified: false,
      emailVerificationCode,
      emailVerificationExpiresAt: verificationExpiresAt,
    });

    // Send confirmation email (non-blocking)
    emailService.sendWorkerApprovalPending(worker).catch((err) => {
      logger.warn("Worker confirmation email failed to send", {
        email: worker.emailAddress,
      });
    });

    // Send email verification code for worker account
    emailService
      .sendVerificationCode(worker, emailVerificationCode, "worker")
      .catch((err) => {
        logger.warn("Worker verification email failed to send", {
          email: worker.emailAddress,
          error: err.message,
        });
      });

    // Notify admin of new worker registration
    emitNotification(
      "workers",
      "created",
      `New worker applied: ${worker.fullName} (${worker.primaryServiceCategory})`,
    );
    emitRefresh("workers");

    return res.status(201).json({
      success: true,
      message: "Application submitted. Your account is pending admin approval.",
      data: {
        id: worker._id,
        _id: worker._id,
        fullName: worker.fullName,
        emailAddress: worker.emailAddress,
        phoneNumber: worker.phoneNumber,
        cnicNumber: worker.cnicNumber,
        serviceCategory: worker.primaryServiceCategory,
        primaryServiceCategory: worker.primaryServiceCategory,
        serviceCategories: worker.serviceCategories,
        address: worker.address,
        status: worker.status,
        joinDate: worker.joinDate,
        createdAt: worker.createdAt,
      },
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
    if (!(await worker.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password.",
        code: "INVALID_PASSWORD",
      });
    }

    if (!worker.isVerified && worker.status !== "active") {
      return res.status(403).json({
        success: false,
        message:
          "Please verify your email before logging in. Check your inbox for the 6-digit code.",
      });
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
    if (primaryServiceCategory !== undefined)
      updateFields.primaryServiceCategory = primaryServiceCategory;
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

    // Delete all customer data completely
    await Booking.deleteMany({ customerId });
    await Review.deleteMany({ customerId });
    await Notification.deleteMany({ userId: customerId, userRole: "customer" });

    // Delete the customer account
    await Customer.findByIdAndDelete(customerId);

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

    // Revoke all refresh tokens for this worker
    try {
      const { revokeAllUserRefreshTokens } = await import("../utils/jwt.js");
      await revokeAllUserRefreshTokens(workerId, "worker");
    } catch (err) {
      logger.warn("Failed to revoke refresh tokens on account deletion", {
        error: err.message,
      });
    }

    // Delete all worker data completely
    await Booking.deleteMany({ workerId });
    await Review.deleteMany({ workerId });
    await Notification.deleteMany({ userId: workerId, userRole: "worker" });

    // Delete the worker account
    await Worker.findByIdAndDelete(workerId);

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

export default router;
