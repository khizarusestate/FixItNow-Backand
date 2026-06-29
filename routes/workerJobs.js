import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireWorker } from "../middleware/auth.js";
import Booking from "../bookingSchema.js";
import Worker from "../workerSchema.js";
import mongoose from "mongoose";
import { emitToAdmin, emitToUser } from "../utils/socketManager.js";
import logger from "../utils/logger.js";
import {
  rankBookingsForWorker,
  formatAvailableJobForWorker,
  parseLocation,
} from "../utils/jobMatching.js";
import { getLocationLabel } from "../utils/locationFields.js";
import { sendApiError, ERROR_CODES } from "../utils/apiErrors.js";
import {
  BOOKING_ACTION,
  rejectBookingAction,
} from "../utils/bookingActions.js";
import { finalizeBookingCompletion } from "../utils/bookingCompletion.js";
import { createNotification, notifyAllAdmins } from "../utils/createNotification.js";
import {
  calculateCommissionAmount,
  calculateWorkerEarnings,
} from "../utils/bookingCommission.js";
import { BOOKING_STATUS } from "../utils/constants.js";
import { generateSecureFilename, validateFile } from "../utils/fileValidation.js";

const OPEN_STATUSES = [BOOKING_STATUS.PENDING];

function jobAreaOnly(booking) {
  const label = getLocationLabel(booking);
  const { area, city } = parseLocation(label);
  return area || city || label || "";
}

function mapMyJobForWorker(booking, customer) {
  const isClaimPending = booking.status === BOOKING_STATUS.CLAIM_PENDING;
  const area = jobAreaOnly(booking);
  return {
    id: booking._id,
    serviceTitle: booking.serviceTitle,
    customerName:
      booking.customerName?.trim() ||
      customer?.fullName?.trim() ||
      (booking.isGuest ? "Guest" : ""),
    isGuest: Boolean(booking.isGuest),
    phone: isClaimPending
      ? ""
      : booking.phone || customer?.phone || "",
    address: isClaimPending ? "" : booking.address,
    location: isClaimPending ? area : booking.location || booking.address,
    area: isClaimPending ? area : undefined,
    price: booking.price,
    status: booking.status,
    assignedAt: booking.assignedAt,
    createdAt: booking.createdAt,
    customerMarkedDone: Boolean(booking.customerMarkedDone),
    workerMarkedDone: Boolean(booking.workerMarkedDone),
    customerRating: booking.customerRating,
    claimPending: isClaimPending,
    limitedInfo: isClaimPending,
  };
}

const commissionReceiptStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), "uploads", "payment-receipts");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const secureName = generateSecureFilename(
      file.originalname,
      req.worker?.id,
    );
    cb(null, `commission-${secureName}`);
  },
});

const commissionReceiptUpload = multer({
  storage: commissionReceiptStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "application/pdf",
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(
        new Error("Receipt must be JPEG, PNG, WebP, or PDF."),
        false,
      );
    }
    cb(null, true);
  },
});

const router = express.Router();

// ─── GET /api/worker-jobs/available ─────────────────────────────────────────────
// Get available jobs for current worker
router.get(
  "/available",
  requireWorker,
  asyncHandler(async (req, res) => {
    const worker = await Worker.findOne({
      _id: req.worker.id,
      isDeleted: false,
    })
      .select(
        "primaryServiceCategory serviceCategories location serviceArea address latitude longitude status availability",
      )
      .lean();

    if (!worker) {
      return res
        .status(404)
        .json({ success: false, message: "Worker not found." });
    }

    if (
      worker.status !== "approved" &&
      worker.status !== "active" &&
      worker.status !== "inactive"
    ) {
      return res.status(403).json({
        success: false,
        message: "Your account must be approved by admin to view jobs.",
      });
    }

    if (worker.availability === false) {
      return res.json({ success: true, data: [] });
    }

    // Build service categories to match against
    const workerServiceCategories = [
      worker.primaryServiceCategory,
      ...(worker.serviceCategories || [])
    ].filter(Boolean);

    // If worker has no categories, return no jobs
    if (workerServiceCategories.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: 'Please select a service category to view jobs.'
      });
    }

    // Find bookings by category (case-insensitive)
    const categoryQuery = {
      $or: [
        {
          serviceCategory: {
            $in: workerServiceCategories.map(cat =>
              new RegExp(`^${cat}$`, 'i')
            )
          }
        },
        {
          category: {
            $in: workerServiceCategories.map(cat =>
              new RegExp(`^${cat}$`, 'i')
            )
          }
        }
      ]
    };

    const bookings = await Booking.find({
      ...categoryQuery,
      status: { $in: OPEN_STATUSES },
      workerId: null,
      claimWorkerId: null,
      isDeleted: false,
    })
      .populate("customerId", "fullName email phone")
      .lean();

    const maxRadiusKm = Number(req.query.maxRadiusKm) || undefined;
    const ranked = rankBookingsForWorker(worker, bookings, { maxRadiusKm });

    return res.json({
      success: true,
      data: ranked.map((booking) =>
        formatAvailableJobForWorker(booking, booking.customerId),
      ),
    });
  }),
);

// ─── GET /api/worker-jobs/debug-all ─────────────────────────────────────────────
// Debug endpoint to see all approved bookings (only available in development)
router.get(
  "/debug-all",
  requireWorker,
  asyncHandler(async (req, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const allApprovedBookings = await Booking.find({
      status: { $in: OPEN_STATUSES },
      workerId: null,
      isDeleted: false,
    })
      .populate("customerId", "fullName email phone")
      .sort({ createdAt: -1 })
      .lean();

    logger.info("Debug: All approved bookings", {
      total: allApprovedBookings.length,
      bookings: allApprovedBookings.map((b) => ({
        id: b._id,
        serviceTitle: b.serviceTitle,
        serviceCategory: b.serviceCategory,
        category: b.category,
        status: b.status,
        workerId: b.workerId,
      })),
    });

    return res.json({
      success: true,
      data: {
        totalBookings: allApprovedBookings.length,
        bookings: allApprovedBookings.map((b) => ({
          id: b._id,
          serviceTitle: b.serviceTitle,
          serviceCategory: b.serviceCategory,
          category: b.category,
          status: b.status,
          workerId: b.workerId,
          customerName: b.customerName,
          createdAt: b.createdAt,
        })),
      },
    });
  }),
);

// ─── POST /api/worker-jobs/claim ─────────────────────────────────────────────────
// Submit commission payment proof; admin must approve before assignment
router.post(
  "/claim",
  requireWorker,
  (req, res, next) => {
    commissionReceiptUpload.single("commissionReceipt")(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message || "Receipt upload failed.",
        });
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const bookingId = req.body.bookingId;
    const transactionId = String(req.body.transactionId || "").trim();

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid booking ID." });
    }

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: "Transaction ID is required.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Commission payment receipt is required.",
      });
    }

    try {
      await validateFile(
        req.file.path,
        req.file.originalname,
        req.file.mimetype,
      );
    } catch (validationError) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: validationError.message,
      });
    }

    const receiptFilename = path.basename(req.file.path);

    const [booking, worker] = await Promise.all([
      Booking.findOne({ _id: bookingId, isDeleted: false }),
      Worker.findOne({ _id: req.worker.id, isDeleted: false }),
    ]);

    if (!booking) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return sendApiError(res, ERROR_CODES.BOOKING_NOT_FOUND, {
        message:
          "This booking could not be found. It may have been taken or removed.",
        status: 404,
        refreshRecommended: true,
      });
    }

    if (
      rejectBookingAction(res, booking, BOOKING_ACTION.WORKER_CLAIM, {
        existingWorkerId: booking.workerId || booking.claimWorkerId,
      })
    ) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return;
    }

    const commissionAmount = calculateCommissionAmount(booking.price);
    const workerEarnings = calculateWorkerEarnings(booking.price);

    // Check if worker has location set
    if (!worker.location || !worker.location.trim()) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Please set your location in profile before claiming jobs',
      });
    }

    const updated = await Booking.findOneAndUpdate(
      {
        _id: bookingId,
        isDeleted: false,
        workerId: null,
        claimWorkerId: null,
        status: { $in: OPEN_STATUSES },
      },
      {
        claimWorkerId: req.worker.id,
        status: BOOKING_STATUS.CLAIM_PENDING,
        paymentDetails: {
          ...(booking.paymentDetails?.toObject?.() || booking.paymentDetails || {}),
          totalAmount: booking.price,
          commissionAmount,
          commissionReceipt: receiptFilename,
          commissionTransactionId: transactionId,
          commissionPaymentMethod: String(req.body.paymentMethod || "").trim(),
          commissionSubmittedAt: new Date(),
          serviceFee: commissionAmount,
          workerEarnings,
        },
        $push: {
          timeline: {
            status: BOOKING_STATUS.CLAIM_PENDING,
            timestamp: new Date(),
            note: `Job claimed by worker ${worker.fullName}. Pending admin approval. Service fee (15%): ₨${commissionAmount}. Worker earnings: ₨${workerEarnings}`,
          },
        },
      },
      { new: true },
    );

    if (!updated) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return sendApiError(res, ERROR_CODES.BOOKING_ALREADY_CLAIMED, {
        message:
          "This booking is no longer available to claim. It may have been taken or removed.",
        status: 409,
        refreshRecommended: true,
      });
    }

    emitToAdmin("notification", {
      type: "bookings",
      action: "claim-pending",
      message: `Commission claim: ${booking.serviceTitle} by ${worker.fullName}`,
      timestamp: new Date().toISOString(),
    });
    emitToAdmin("refresh", {
      type: "bookings",
      timestamp: new Date().toISOString(),
    });
    notifyAllAdmins({
      title: "Commission claim",
      message: `${worker.fullName} submitted a claim for ${booking.serviceTitle}.`,
      type: "booking",
      relatedEntityId: updated._id,
    }).catch(() => {});

    return res.json({
      success: true,
      message:
        "Your claim has been submitted successfully. The admin will review your payment proof and assign the job to you once approved.",
      data: {
        bookingId: updated._id,
        status: BOOKING_STATUS.CLAIM_PENDING,
        commissionAmount,
        workerEarnings,
      },
    });
  }),
);

// ─── POST /api/worker-jobs/confirm-bank ───────────────────────────────────────────
// DEPRECATED: This endpoint references non-existent bankAccount field in worker schema
// Use /api/worker-jobs/claim endpoint instead
router.post(
  "/confirm-bank",
  requireWorker,
  asyncHandler(async (req, res) => {
    return res.status(410).json({
      success: false,
      message:
        "This endpoint is deprecated. Please use /api/worker-jobs/claim to accept jobs.",
    });
  }),
);

// ─── GET /api/worker-jobs/my-jobs ─────────────────────────────────────────────
// Get bookings assigned to this worker
router.get(
  "/my-jobs",
  requireWorker,
  asyncHandler(async (req, res) => {
    const bookings = await Booking.find({
      isDeleted: false,
      $or: [
        {
          workerId: req.worker.id,
          status: {
            $in: [
              BOOKING_STATUS.WORKER_ASSIGNED,
              "assigned",
              "in-progress",
              "completed",
            ],
          },
        },
        {
          claimWorkerId: req.worker.id,
          status: BOOKING_STATUS.CLAIM_PENDING,
        },
      ],
    })
      .populate("customerId", "fullName email phone")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      data: bookings.map((booking) =>
        mapMyJobForWorker(booking, booking.customerId),
      ),
    });
  }),
);

// ─── POST /api/worker-jobs/:id/mark-done ─────────────────────────────────────────
// Worker marks done (blue tick). Finalizes when customer already marked done + rated.
router.post(
  "/:id/mark-done",
  requireWorker,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID.",
      });
    }

    const booking = await Booking.findOne({
      _id: req.params.id,
      workerId: req.worker.id,
      isDeleted: false,
    }).populate("customerId", "fullName email");

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found or not assigned to you.",
      });
    }

    if (rejectBookingAction(res, booking, BOOKING_ACTION.WORKER_MARK_DONE)) {
      return;
    }

    const worker = await Worker.findById(req.worker.id);
    if (!worker) {
      return res.status(404).json({ success: false, message: "Worker not found." });
    }

    booking.workerMarkedDone = true;
    booking.workerMarkedDoneAt = new Date();
    booking.timeline.push({
      status: booking.status,
      timestamp: new Date(),
      note: `Worker marked job as done (awaiting customer confirmation if needed).`,
    });

    let finalized = false;
    let serviceFee = 0;
    let workerEarnings = 0;
    let newRating = worker.rating || 0;

    if (booking.isGuest) {
      const result = await finalizeBookingCompletion(
        booking,
        worker,
        booking.customerId?._id || booking.customerId || null,
      );
      serviceFee = result.serviceFee;
      workerEarnings = result.workerEarnings;
      newRating = result.newRating;
      finalized = true;
    } else if (booking.customerMarkedDone && booking.customerRating) {
      const result = await finalizeBookingCompletion(
        booking,
        worker,
        booking.customerId?._id || booking.customerId,
      );
      serviceFee = result.serviceFee;
      workerEarnings = result.workerEarnings;
      newRating = result.newRating;
      finalized = true;
    } else if (booking.customerMarkedDone && !booking.customerRating) {
      await booking.save();
      return res.status(400).json({
        success: false,
        message:
          "Customer marked done but has not submitted a rating yet. Ask them to rate the job in My Bookings.",
      });
    } else {
      if (booking.status === "assigned") {
        booking.status = "in-progress";
      }
      await booking.save();
    }

    emitToAdmin("refresh", {
      type: "bookings",
      timestamp: new Date().toISOString(),
    });

    const customerId =
      booking.customerId?._id?.toString() || String(booking.customerId || "");

    if (finalized) {
      const customerMsg = `Your ${booking.serviceTitle} booking is fully completed.`;
      const workerMsg = `Job "${booking.serviceTitle}" is fully completed.`;

      emitToUser(customerId, "booking-status-update", {
        bookingId: booking._id,
        serviceTitle: booking.serviceTitle,
        status: "completed",
        customerMarkedDone: true,
        workerMarkedDone: true,
        message: customerMsg,
      });
      emitToUser(req.worker.id, "job-completed", {
        bookingId: booking._id,
        serviceTitle: booking.serviceTitle,
        workerEarnings,
        message: workerMsg,
      });

      if (customerId) {
        await createNotification({
          userId: customerId,
          userRole: "customer",
          title: "Booking completed",
          message: customerMsg,
          type: "success",
          relatedEntityId: booking._id,
          link: "#booking",
        });
      }
      await createNotification({
        userId: req.worker.id,
        userRole: "worker",
        title: "Job completed",
        message: workerMsg,
        type: "success",
        relatedEntityId: booking._id,
        link: "",
      });
    } else {
      if (customerId) {
        emitToUser(customerId, "booking-status-update", {
          bookingId: booking._id,
          serviceTitle: booking.serviceTitle,
          status: booking.status,
          workerMarkedDone: true,
          customerMarkedDone: false,
          message: `The worker marked "${booking.serviceTitle}" as done. Please rate and confirm in My Bookings.`,
        });
      }
    }

    return res.json({
      success: true,
      message: finalized
        ? "Job fully completed."
        : booking.isGuest
          ? "Job marked as done."
          : "Marked as done on your side. Waiting for the customer to rate and confirm.",
      data: {
        bookingId: booking._id,
        status: booking.status,
        customerMarkedDone: Boolean(booking.customerMarkedDone),
        workerMarkedDone: true,
        finalized,
        workerEarnings: finalized ? workerEarnings : undefined,
      },
    });
  }),
);

export default router;
