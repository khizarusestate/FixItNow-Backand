import express from "express";
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
} from "../utils/jobMatching.js";
import { sendApiError, ERROR_CODES } from "../utils/apiErrors.js";
import {
  BOOKING_ACTION,
  rejectBookingAction,
} from "../utils/bookingActions.js";
import { finalizeBookingCompletion } from "../utils/bookingCompletion.js";
import { createNotification } from "../utils/createNotification.js";

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

    const bookings = await Booking.find({
      status: "approved",
      workerId: null,
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
      status: "approved",
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
// Claim a job and assign directly to worker
router.post(
  "/claim",
  requireWorker,
  asyncHandler(async (req, res) => {
    const { bookingId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid booking ID." });
    }

    const [booking, worker] = await Promise.all([
      Booking.findOne({ _id: bookingId, isDeleted: false }),
      Worker.findOne({ _id: req.worker.id, isDeleted: false }),
    ]);

    if (!booking) {
      return sendApiError(res, ERROR_CODES.BOOKING_NOT_FOUND, {
        message: "This booking could not be found. It may have been taken or removed.",
        status: 404,
        refreshRecommended: true,
      });
    }

    if (
      rejectBookingAction(res, booking, BOOKING_ACTION.WORKER_CLAIM, {
        existingWorkerId: booking.workerId,
      })
    ) {
      return;
    }

    // Calculate service fee (15%)
    const serviceFee = Math.round(booking.price * 0.15);
    const workerEarnings = booking.price - serviceFee;

    // Update booking to assigned status
    await Booking.findOneAndUpdate(
      { _id: bookingId, isDeleted: false },
      {
        workerId: req.worker.id,
        status: "assigned",
        assignedAt: new Date(),
        paymentDetails: {
          totalAmount: booking.price,
          serviceFee,
          workerEarnings,
        },
        $push: {
          timeline: {
            status: "assigned",
            timestamp: new Date(),
            note: `Job claimed and assigned to worker ${worker.fullName}. Service fee (15%): ₨${serviceFee}. Worker earnings: ₨${workerEarnings}`,
          },
        },
      },
    );

    // Update worker stats and status
    await Worker.findByIdAndUpdate(req.worker.id, {
      status: "active",
      $inc: { totalJobs: 1, assignedJobs: 1 },
      lastActive: new Date(),
    });

    // Notify admin
    emitToAdmin("notification", {
      type: "bookings",
      action: "assigned",
      message: `Job assigned: ${booking.serviceTitle} to ${worker.fullName}`,
      timestamp: new Date().toISOString(),
    });

    emitToAdmin("refresh", {
      type: "bookings",
      timestamp: new Date().toISOString(),
    });

    return res.json({
      success: true,
      message: "Job claimed and assigned successfully!",
      data: {
        bookingId: booking._id,
        status: "assigned",
        workerId: worker._id,
        assignedAt: new Date(),
        workerRating: worker.rating?.toFixed(1) || "0.0",
        workerTotalReviews: worker.totalReviews || 0,
        serviceFee,
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
      workerId: req.worker.id,
      isDeleted: false,
      status: {
        $in: ["assigned", "in-progress", "completed", "pending-confirmation"],
      },
    })
      .populate("customerId", "fullName email phone")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      data: bookings.map((booking) => ({
        id: booking._id,
        serviceTitle: booking.serviceTitle,
        phone:
          booking.phone ||
          booking.customerId?.phone ||
          "",
        address: booking.address,
        price: booking.price,
        status: booking.status,
        assignedAt: booking.assignedAt,
        createdAt: booking.createdAt,
        customerMarkedDone: Boolean(booking.customerMarkedDone),
        workerMarkedDone: Boolean(booking.workerMarkedDone),
        customerRating: booking.customerRating,
      })),
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

    if (booking.customerMarkedDone && booking.customerRating) {
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
