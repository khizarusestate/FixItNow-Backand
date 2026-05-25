import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireAdmin, optionalAuth } from "../middleware/auth.js";
import Advertisement from "../advertisementSchema.js";
import Customer from "../customerSchema.js";
import Worker from "../workerSchema.js";
import mongoose from "mongoose";
import logger from "../utils/logger.js";
import { emitToAdmin, emitToUser } from "../utils/socketManager.js";
import { notifyAllAdmins } from "../utils/createNotification.js";
import {
  parsePayAfterWork,
  validatePaymentSelection,
  paymentReceiptRequired,
  buildPayToSummaryServer,
} from "../utils/paymentMethods.js";
import {
  validateFile,
  generateSecureFilename,
} from "../utils/fileValidation.js";

function collectUploadedFiles(files) {
  if (!files) return [];
  if (Array.isArray(files)) return files;
  return Object.values(files).flat();
}

function unlinkUploadedFiles(files) {
  collectUploadedFiles(files).forEach((file) => {
    if (file?.path) fs.unlink(file.path, () => {});
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists
const adsUploadDir = path.join(__dirname, "..", "uploads", "advertisements");
if (!fs.existsSync(adsUploadDir)) {
  fs.mkdirSync(adsUploadDir, { recursive: true });
}

// Multer storage for ad files and payment receipts
const adStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, adsUploadDir);
  },
  filename: (req, file, cb) => {
    const secureName = generateSecureFilename(file.originalname, req.user?.id);
    const prefix = file.fieldname === "paymentReceipt" ? "receipt_" : "ad_";
    cb(null, `${prefix}${secureName}`);
  },
});

// File filter: ad files and payment receipts
const adFileFilter = (req, file, cb) => {
  try {
    const imageVideoMimes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/webm",
      "video/quicktime",
    ];
    const receiptMimes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
    ];

    if (file.fieldname === "adFiles") {
      if (!imageVideoMimes.includes(file.mimetype)) {
        return cb(
          new Error(
            "Only image (JPG, PNG, GIF, WebP) and video (MP4, WebM, MOV) files are allowed for advertisement files.",
          ),
          false,
        );
      }
    } else if (file.fieldname === "paymentReceipt") {
      if (!receiptMimes.includes(file.mimetype)) {
        return cb(
          new Error(
            "Only image (JPG, PNG, GIF, WebP) or PDF files are allowed for payment receipts.",
          ),
          false,
        );
      }
    } else {
      return cb(new Error("Unexpected file field"), false);
    }

    cb(null, true);
  } catch (error) {
    cb(new Error("File validation failed"), false);
  }
};

const uploadAd = multer({
  storage: adStorage,
  limits: { fileSize: 30 * 1024 * 1024, files: 4 }, // 30MB max per file, max 4 files total
  fileFilter: adFileFilter,
});

const router = express.Router();

// ─── Helper: Check if user profile is complete ───────────────────────────────
async function checkProfileComplete(userId, userType) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return { complete: false, message: "Invalid user session. Please login again." };
  }
  if (userType === "customer") {
    const customer = await Customer.findById(userId).lean();
    if (!customer) return { complete: false, message: "Customer not found." };
    if (!customer.fullName || !customer.email || !customer.phone) {
      return {
        complete: false,
        message:
          "Please complete your profile before submitting an advertisement.",
      };
    }
    return { complete: true, user: customer };
  }
  if (userType === "worker") {
    const worker = await Worker.findById(userId).lean();
    if (!worker) return { complete: false, message: "Worker not found." };
    const required = [
      "fullName",
      "emailAddress",
      "phoneNumber",
      "primaryServiceCategory",
    ];
    const hasLocation = (
      worker.location ||
      worker.serviceArea ||
      worker.address ||
      ""
    ).trim();
    if (!hasLocation) {
      return {
        complete: false,
        message:
          "Please complete your profile (location) before submitting an advertisement.",
      };
    }
    for (const field of required) {
      if (!worker[field]) {
        return {
          complete: false,
          message:
            "Please complete your profile before submitting an advertisement.",
        };
      }
    }
    // Payment info is no longer required for ads (moved to WorkerPayment collection)
    // Workers can submit ads without payment info
    return { complete: true, user: worker };
  }
  return { complete: false, message: "Invalid user type." };
}

// ─── POST /api/advertisements ────────────────────────────────────────────────
// Submit a new advertisement (customer or worker)
router.post(
  "/",
  optionalAuth,
  (req, res, next) => {
    uploadAd.fields([
      { name: "adFiles", maxCount: 3 },
      { name: "paymentReceipt", maxCount: 1 },
    ])(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            message: "File size too large. Maximum 30MB allowed.",
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message || "File upload error",
        });
      }
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message || "File upload error",
        });
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const {
      purpose,
      adType,
      duration,
      paymentMethod,
      paymentReference,
      payAfterWork,
      name: guestName,
      email: guestEmail,
      phone: guestPhone,
    } = req.body;
    const user = req.user;
    const adFiles = req.files?.adFiles || [];
    const paymentReceiptFile = req.files?.paymentReceipt?.[0] || null;
    const payLater = parsePayAfterWork(payAfterWork);

    if (!purpose || !adType || !duration || adFiles.length === 0) {
      unlinkUploadedFiles(req.files);
      return res.status(400).json({
        success: false,
        message:
          "Purpose, ad type, duration, and at least one ad file are required.",
      });
    }

    const paymentCheck = validatePaymentSelection({
      payAfterWork: payLater,
      paymentMethod,
    });
    if (!paymentCheck.ok) {
      unlinkUploadedFiles(req.files);
      return res.status(400).json({
        success: false,
        message: paymentCheck.message,
      });
    }

    if (
      paymentReceiptRequired({
        payAfterWork: payLater,
        paymentMethod: paymentCheck.method,
      }) &&
      !paymentReceiptFile
    ) {
      unlinkUploadedFiles(req.files);
      return res.status(400).json({
        success: false,
        message: "Payment receipt is required for EasyPaisa and JazzCash.",
      });
    }

    if (!["image", "video"].includes(adType)) {
      unlinkUploadedFiles(req.files);
      return res
        .status(400)
        .json({ success: false, message: "Ad type must be image or video." });
    }

    if (
      !["24 hours", "3 days", "1 week", "2 weeks", "1 month"].includes(duration)
    ) {
      unlinkUploadedFiles(req.files);
      return res.status(400).json({
        success: false,
        message:
          "Duration must be one of: 24 hours, 3 days, 1 week, 2 weeks, 1 month.",
      });
    }

    if (adFiles.length > 3) {
      [...adFiles, paymentReceiptFile].forEach((file) => {
        if (file?.path) fs.unlink(file.path, () => {});
      });
      return res.status(400).json({
        success: false,
        message: "Maximum 3 advertisement files are allowed.",
      });
    }

    let submitterId = null;
    let submitterType = "guest";
    let profileName = "";
    let profileEmail = "";
    let profilePhone = "";
    let submitterProfilePicture = null;

    if (user && (user.role === "customer" || user.role === "worker")) {
      const profileCheck = await checkProfileComplete(user.id, user.role);
      if (!profileCheck.complete) {
        [...adFiles, paymentReceiptFile].forEach((file) => {
          if (file?.path) fs.unlink(file.path, () => {});
        });
        return res
          .status(403)
          .json({ success: false, message: profileCheck.message });
      }
      const profileUser = profileCheck.user;
      submitterId = user.id;
      submitterType = user.role;
      profileName = profileUser.fullName;
      profileEmail = profileUser.email || profileUser.emailAddress;
      profilePhone = profileUser.phone || profileUser.phoneNumber || "";
      submitterProfilePicture = profileUser.profilePicture || null;
    } else {
      profileName = String(guestName || "").trim();
      profileEmail = String(guestEmail || "")
        .trim()
        .toLowerCase();
      profilePhone = String(guestPhone || "").trim();
      if (!profileName || profileName.length < 2) {
        [...adFiles, paymentReceiptFile].forEach((file) => {
          if (file?.path) fs.unlink(file.path, () => {});
        });
        return res.status(400).json({
          success: false,
          message: "Your name is required.",
        });
      }
      if (!profileEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileEmail)) {
        [...adFiles, paymentReceiptFile].forEach((file) => {
          if (file?.path) fs.unlink(file.path, () => {});
        });
        return res.status(400).json({
          success: false,
          message: "A valid email address is required.",
        });
      }
    }

    const pm = paymentCheck.method;

    // Perform comprehensive file validation on all uploaded files
    const filesToValidate = [...adFiles];
    if (paymentReceiptFile) filesToValidate.push(paymentReceiptFile);
    for (const file of filesToValidate) {
      try {
        await validateFile(file.path, file.originalname, file.mimetype);
      } catch (validationError) {
        unlinkUploadedFiles(req.files);
        return res.status(400).json({
          success: false,
          message: `File validation failed for ${file.originalname}: ${validationError.message}`,
        });
      }
    }

    const fileUrls = adFiles.map(
      (file) => `/uploads/advertisements/${path.basename(file.path)}`,
    );
    const paymentReceiptUrl = paymentReceiptFile
      ? `/uploads/advertisements/${path.basename(paymentReceiptFile.path)}`
      : "";

    const advertisement = await Advertisement.create({
      name: profileName,
      email: profileEmail,
      phone: profilePhone,
      purpose: purpose.trim(),
      duration,
      adType,
      adFileUrls: fileUrls,
      paymentMethod: pm,
      payAfterWork: payLater,
      paymentReference: String(paymentReference || "").trim(),
      paymentReceiptUrl,
      paymentStatus: "pending",
      paymentSubmittedAt: new Date(),
      submitterId,
      submitterType,
      submitterProfilePicture,
      status: "pending",
    });

    logger.info("Advertisement submitted", {
      adId: advertisement._id,
      submitterId,
      submitterType,
      duration,
      fileCount: fileUrls.length,
      paymentMethod: advertisement.paymentMethod,
    });

    try {
      await notifyAllAdmins({
        title: "New advertisement submitted",
        message: `New advertisement submitted by ${profileName}`,
        type: "info",
        relatedEntityId: advertisement._id,
      });
      emitToAdmin("refresh", {
        type: "advertisements",
        timestamp: new Date().toISOString(),
      });
    } catch (notifyErr) {
      logger.warn("Advertisement notify failed (submission still saved)", {
        error: notifyErr?.message,
      });
    }

    return res.status(201).json({
      success: true,
      message:
        "Advertisement submitted successfully! It will be reviewed by our team.",
      data: {
        id: advertisement._id,
        name: advertisement.name,
        email: advertisement.email,
        phone: advertisement.phone,
        purpose: advertisement.purpose,
        duration: advertisement.duration,
        adType: advertisement.adType,
        adFileUrls: advertisement.adFileUrls,
        paymentMethod: advertisement.paymentMethod,
        paymentReceiptUrl: advertisement.paymentReceiptUrl,
        paymentStatus: advertisement.paymentStatus,
        status: advertisement.status,
        createdAt: advertisement.createdAt,
      },
    });
  }),
);

// ─── GET /api/advertisements/my ────────────────────────────────────────────────
// Get current user's submitted advertisements
router.get(
  "/my",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ads = await Advertisement.find({
      submitterId: req.user.id,
      submitterType: req.user.role,
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      data: ads.map((ad) => ({
        id: ad._id,
        name: ad.name,
        email: ad.email,
        phone: ad.phone,
        purpose: ad.purpose,
        duration: ad.duration,
        adType: ad.adType,
        adFileUrls: ad.adFileUrls,
        status: ad.status,
        adminNote: ad.adminNote,
        createdAt: ad.createdAt,
        updatedAt: ad.updatedAt,
      })),
    });
  }),
);

// ─── GET /api/advertisements/active ───────────────────────────────────────────
// Public endpoint: get approved advertisements for display
router.get(
  "/active",
  asyncHandler(async (req, res) => {
    const ads = await Advertisement.find({ status: "approved" })
      .sort({ createdAt: -1 })
      .select(
        "name phone purpose duration adType adFileUrls submitterProfilePicture createdAt",
      )
      .lean();

    return res.json({
      success: true,
      data: ads.map((ad) => ({
        id: ad._id,
        name: ad.name,
        phone: ad.phone,
        purpose: ad.purpose,
        duration: ad.duration,
        adType: ad.adType,
        adFileUrls: ad.adFileUrls,
        submitterProfilePicture: ad.submitterProfilePicture,
        createdAt: ad.createdAt,
      })),
    });
  }),
);

// ─── GET /api/advertisements ─────────────────────────────────────────────────
// Admin: list all advertisements
router.get(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const query = {};
    if (status && ["pending", "approved", "rejected"].includes(status)) {
      query.status = status;
    }

    const ads = await Advertisement.find(query).sort({ createdAt: -1 }).lean();

    return res.json({
      success: true,
      count: ads.length,
      data: ads.map((ad) => ({
        id: ad._id,
        name: ad.name,
        email: ad.email,
        phone: ad.phone,
        purpose: ad.purpose,
        duration: ad.duration,
        adType: ad.adType,
        adFileUrls: ad.adFileUrls,
        status: ad.status,
        paymentStatus: ad.paymentStatus,
        paymentMethod: ad.paymentMethod,
        paymentReference: ad.paymentReference,
        paymentReceiptUrl: ad.paymentReceiptUrl,
        submitterId: ad.submitterId,
        submitterType: ad.submitterType,
        submitterProfilePicture: ad.submitterProfilePicture,
        adminNote: ad.adminNote,
        reviewedAt: ad.reviewedAt,
        paymentReviewedAt: ad.paymentReviewedAt,
        paymentReviewedBy: ad.paymentReviewedBy,
        createdAt: ad.createdAt,
        updatedAt: ad.updatedAt,
      })),
    });
  }),
);

// ─── PATCH /api/advertisements/:id/status ────────────────────────────────────
// Admin: approve or reject an advertisement
router.patch(
  "/:id/status",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { status, adminNote } = req.body;

    if (!status || !["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be approved or rejected.",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid advertisement ID." });
    }

    const advertisement = await Advertisement.findById(req.params.id);
    if (!advertisement) {
      return res
        .status(404)
        .json({ success: false, message: "Advertisement not found." });
    }

    advertisement.status = status;
    advertisement.adminNote = adminNote ? adminNote.trim() : "";
    advertisement.reviewedAt = new Date();
    advertisement.reviewedBy = req.admin.id;
    advertisement.paymentReviewedAt = new Date();
    advertisement.paymentReviewedBy = req.admin.id;
    advertisement.paymentStatus =
      status === "approved" ? "approved" : "rejected";
    await advertisement.save();

    logger.info("Advertisement reviewed", {
      adId: advertisement._id,
      status,
      reviewedBy: req.admin.id,
      paymentStatus: advertisement.paymentStatus,
    });

    // Notify submitter about approval/rejection (separate from account notifications)
    emitToUser(
      String(advertisement.submitterId),
      "advertisement-status-update",
      {
        adId: advertisement._id,
        status: advertisement.status,
        adminNote: advertisement.adminNote,
        message: `Your advertisement has been ${status === "approved" ? "approved" : "rejected"}. ${adminNote ? `Reason: ${adminNote}` : ""}`,
      },
    );

    return res.json({
      success: true,
      message: `Advertisement ${status === "approved" ? "approved" : "rejected"} successfully.`,
      data: {
        id: advertisement._id,
        status: advertisement.status,
        adminNote: advertisement.adminNote,
        reviewedAt: advertisement.reviewedAt,
      },
    });
  }),
);

// ─── DELETE /api/advertisements/:id ──────────────────────────────────────────
// Admin: delete an advertisement (and its file)
router.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid advertisement ID." });
    }

    const advertisement = await Advertisement.findById(req.params.id);
    if (!advertisement) {
      return res
        .status(404)
        .json({ success: false, message: "Advertisement not found." });
    }

    // Delete the uploaded files
    if (advertisement.adFileUrls && advertisement.adFileUrls.length > 0) {
      advertisement.adFileUrls.forEach((fileUrl) => {
        const filePath = path.join(
          __dirname,
          "..",
          fileUrl.replace("/uploads/", "uploads/"),
        );
        if (fs.existsSync(filePath)) {
          fs.unlink(filePath, () => {});
        }
      });
    }

    await Advertisement.findByIdAndDelete(req.params.id);

    logger.info("Advertisement deleted", {
      adId: req.params.id,
      deletedBy: req.admin.id,
    });

    return res.json({
      success: true,
      message: "Advertisement deleted successfully.",
    });
  }),
);

// ─── GET /api/advertisements/stats ───────────────────────────────────────────
// Admin: advertisement statistics
router.get(
  "/stats",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const [total, pending, approved, rejected] = await Promise.all([
      Advertisement.countDocuments(),
      Advertisement.countDocuments({ status: "pending" }),
      Advertisement.countDocuments({ status: "approved" }),
      Advertisement.countDocuments({ status: "rejected" }),
    ]);

    return res.json({
      success: true,
      data: { total, pending, approved, rejected },
    });
  }),
);

export default router;
