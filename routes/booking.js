import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireCustomer, requireWorker, optionalAuth } from '../middleware/auth.js';
import Booking from '../bookingSchema.js';
import Customer from '../customerSchema.js';
import Worker from '../workerSchema.js';
import mongoose from 'mongoose';
import { getSocketIO, emitToAdmin, emitToUser } from '../utils/socketManager.js';
import logger from '../utils/logger.js';
import { sendApiError, ERROR_CODES } from '../utils/apiErrors.js';
import {
  BOOKING_ACTION,
  rejectBookingAction,
} from '../utils/bookingActions.js';
import { finalizeBookingCompletion } from '../utils/bookingCompletion.js';
import { body, validationResult } from 'express-validator';
import { validateFile, generateSecureFilename } from '../utils/fileValidation.js';
import emailService from '../services/emailService.js';
import { createNotification, notifyAllAdmins } from '../utils/createNotification.js';
import {
  parsePayAfterWork,
  validatePaymentSelection,
  paymentReceiptRequired,
  buildPayToSummaryServer,
} from '../utils/paymentMethods.js';

const router = express.Router();

// Configure multer for payment receipt uploads
const paymentReceiptStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'payment-receipts');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const secureName = generateSecureFilename(file.originalname, req.customer?.id);
    cb(null, 'receipt-' + secureName);
  }
});

const paymentReceiptUpload = multer({
  storage: paymentReceiptStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    try {
      const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
      if (!allowedMimes.includes(file.mimetype)) {
        return cb(new Error('Only image files (JPEG, PNG, GIF, WebP) and PDF are allowed for payment receipts'), false);
      }
      cb(null, true);
    } catch (error) {
      cb(new Error('File validation failed'), false);
    }
  }
});

// Helper to emit notifications to admin
const emitNotification = (type, action, message) => {
  emitToAdmin('notification', { 
    type, 
    action, 
    message,
    timestamp: new Date().toISOString() 
  });
};

const emitRefresh = (type) => {
  emitToAdmin('refresh', { type, timestamp: new Date().toISOString() });
};

// ─── POST /api/bookings ────────────────────────
// Create a new booking (customer only)
router.post('/',
  optionalAuth,
  (req, res, next) => {
    paymentReceiptUpload.single('paymentReceipt')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        // Multer error (file size, type, etc.)
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: 'File size too large. Maximum 5MB allowed.'
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload error'
        });
      } else if (err) {
        // Other errors
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload error'
        });
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    try {
      const { serviceTitle, serviceId, category, address, location, phone, email, notes, name, latitude, longitude, placeId, paymentMethod, payToSummary, payAfterWork } = req.body;
      const bookingLocation = (location || address || '').trim();
      const paymentReceiptPath = req.file ? req.file.path : null;
      const paymentReceiptFilename = req.file ? path.basename(req.file.path) : null;
      const payLater = parsePayAfterWork(payAfterWork);

      const paymentCheck = validatePaymentSelection({
        payAfterWork: payLater,
        paymentMethod,
      });
      if (!paymentCheck.ok) {
        if (paymentReceiptPath && fs.existsSync(paymentReceiptPath)) {
          fs.unlinkSync(paymentReceiptPath);
        }
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
        !paymentReceiptPath
      ) {
        return res.status(400).json({
          success: false,
          message: 'Payment receipt is required for EasyPaisa and JazzCash.',
        });
      }

      // Perform comprehensive file validation
      if (req.file) {
        try {
          await validateFile(req.file.path, req.file.originalname, req.file.mimetype);
        } catch (validationError) {
          // Delete invalid file
          if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({
            success: false,
            message: `File validation failed: ${validationError.message}`
          });
        }
      }

      // Validate required fields
      if (!serviceTitle || serviceTitle.length < 3) {
        return res.status(400).json({
          success: false,
          message: 'Service title must be at least 3 characters long'
        });
      }

      if (!serviceId) {
        return res.status(400).json({
          success: false,
          message: 'Service ID is required'
        });
      }

      if (!phone || phone.length < 10) {
        return res.status(400).json({
          success: false,
          message: 'Valid phone number is required (minimum 10 digits)'
        });
      }

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Valid email address is required'
        });
      }

      if (!bookingLocation) {
        return res.status(400).json({
          success: false,
          message: 'Location is required'
        });
      }

      const pm = paymentCheck.method;

      let customer = null;
      let isGuest = true;

      if (req.user?.role === 'customer' && req.user?.id) {
        customer = await Customer.findOne({
          _id: req.user.id,
          isDeleted: false,
        });
        if (customer) {
          isGuest = false;
        }
      }

      if (isGuest) {
        if (!name || String(name).trim().length < 2) {
          return res.status(400).json({
            success: false,
            message: 'Your full name is required.',
          });
        }
      }

      // Fetch service details
      let servicePrice = 0;
      let serviceCategory = category || '';

      try {
        const Service = mongoose.model('Service');
        const service = await Service.findById(serviceId);
        if (!service) {
          return res.status(404).json({
            success: false,
            message: 'Service not found'
          });
        }
        
        servicePrice = service.price || 0;
        serviceCategory = service.category || category || '';
        
        if (servicePrice <= 0) {
          logger.warn('Service has zero or invalid price', { serviceId, servicePrice });
          return res.status(400).json({
            success: false,
            message: 'Service price is not configured. Please contact admin.'
          });
        }
      } catch (error) {
        logger.error('Error fetching service details', { serviceId, error: error.message });
        return res.status(500).json({
          success: false,
          message: 'Error fetching service details'
        });
      }

      const canonicalCategory = String(serviceCategory || category || '').trim();

      const booking = await Booking.create({
        customerId: customer?._id || null,
        isGuest,
        customerName: name || customer?.fullName,
        phone: phone || customer?.phone,
        email: email || customer?.email,
        serviceTitle,
        category: canonicalCategory,
        serviceCategory: canonicalCategory,
        serviceId: serviceId || null,
        price: servicePrice,
        address: bookingLocation,
        location: bookingLocation,
        latitude: latitude != null && latitude !== '' ? Number(latitude) : null,
        longitude: longitude != null && longitude !== '' ? Number(longitude) : null,
        placeId: placeId || '',
        notes: notes || '',
        status: 'pending',
        paymentDetails: {
          serviceFee: 0,
          workerEarnings: 0,
          totalAmount: servicePrice,
          platformCommission: 0,
          processedAt: new Date(),
          paymentReceipt: paymentReceiptFilename || '',
          paymentMethod: pm,
          payAfterWork: payLater,
          payToSummary: String(
            payToSummary || buildPayToSummaryServer(pm),
          )
            .trim()
            .slice(0, 500),
        }
      });

      if (customer) {
        await Customer.findByIdAndUpdate(customer._id, {
          $inc: { totalBookings: 1, pendingBookings: 1 },
          lastBooking: new Date(),
        });

        emailService.sendBookingReceived(customer, booking).catch(() => {});

        createNotification({
          userId: customer._id,
          userRole: 'customer',
          title: 'Booking submitted',
          message: `We received your request for ${booking.serviceTitle}. Pending admin review.`,
          type: 'info',
        }).catch(() => {});
      } else {
        emailService
          .sendBookingReceived(
            { fullName: booking.customerName, email: booking.email },
            booking,
          )
          .catch(() => {});
      }

      emitNotification('bookings', 'created', `New booking: ${booking.serviceTitle} by ${booking.customerName}`);
      emitRefresh('bookings');

      notifyAllAdmins({
        title: 'New booking',
        message: `${booking.customerName} booked ${booking.serviceTitle}.`,
        type: 'booking',
      }).catch(() => {});

      // Emit new booking event only to workers
      const io = getSocketIO();
      io.to('workers-room').emit('new-booking', {
        id: booking._id,
        serviceTitle: booking.serviceTitle,
        category: booking.category,
        address: booking.address,
        price: booking.price,
        createdAt: booking.createdAt
      });

      return res.status(201).json({
        success: true,
        message: 'Booking created successfully',
        data: booking
      });
    } catch (error) {
      logger.error('Booking creation error:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Booking failed. Please try again.'
      });
    }
  })
);

// ─── GET /api/bookings/my ──────────────────────────────────────────────────────
// Get current customer's bookings (with worker details when assigned)
router.get('/my', requireCustomer, asyncHandler(async (req, res) => {
  const bookings = await Booking.find({ customerId: req.customer.id, isDeleted: false })
    .populate('workerId', 'fullName phoneNumber emailAddress primaryServiceCategory')
    .sort({ createdAt: -1 })
    .lean();

  return res.json({
    success: true,
    data: bookings.map(b => ({
      id: b._id,
      serviceTitle: b.serviceTitle,
      category: b.category,
      address: b.address,
      location: b.location || b.address,
      notes: b.notes,
      status: b.status,
      price: b.price,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      paymentDetails: b.paymentDetails
        ? {
            paymentMethod: b.paymentDetails.paymentMethod,
            payToSummary: b.paymentDetails.payToSummary,
            paymentReceipt: b.paymentDetails.paymentReceipt,
            totalAmount: b.paymentDetails.totalAmount,
          }
        : null,
      customerRating: b.customerRating,
      customerMarkedDone: Boolean(b.customerMarkedDone),
      customerMarkedDoneAt: b.customerMarkedDoneAt,
      workerMarkedDone: Boolean(b.workerMarkedDone),
      workerMarkedDoneAt: b.workerMarkedDoneAt,
      worker: b.workerId ? {
        id: b.workerId._id,
        fullName: b.workerId.fullName,
        phoneNumber: b.workerId.phoneNumber,
        emailAddress: b.workerId.emailAddress,
        primaryServiceCategory: b.workerId.primaryServiceCategory
      } : null
    }))
  });
}));

// ─── DELETE /api/bookings/:id ──────────────────────────────────────────────────
// Cancel a booking (customer only, only if pending)
router.delete('/:id', requireCustomer, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, {
      message: 'Invalid booking ID.',
      status: 400,
    });
  }

  const booking = await Booking.findOne({
    _id: req.params.id,
    customerId: req.customer.id,
    isDeleted: false
  });

  if (!booking) {
    return sendApiError(res, ERROR_CODES.BOOKING_NOT_FOUND, {
      message: 'This booking could not be found. It may have been removed.',
      status: 404,
      refreshRecommended: true,
    });
  }

  if (rejectBookingAction(res, booking, BOOKING_ACTION.CUSTOMER_CANCEL)) {
    return;
  }

  // Soft delete the booking
  await Booking.findByIdAndUpdate(req.params.id, {
    isDeleted: true,
    deletedAt: new Date(),
    status: 'cancelled'
  });

  // Get current customer stats to prevent negative values
  const customer = await Customer.findById(req.customer.id);
  if (customer) {
    const updateFields = {};
    if (customer.totalBookings > 0) {
      updateFields.totalBookings = -1;
    }
    if (customer.pendingBookings > 0) {
      updateFields.pendingBookings = -1;
    }
    
    if (Object.keys(updateFields).length > 0) {
      await Customer.findByIdAndUpdate(req.customer.id, {
        $inc: updateFields
      });
    }
  }

  createNotification({
    userId: req.customer.id,
    userRole: 'customer',
    title: 'Booking cancelled',
    message: `Your booking for ${booking.serviceTitle} was cancelled.`,
    type: 'warning',
  }).catch(() => {});

  return res.json({ success: true, message: 'Booking cancelled successfully.' });
}));

// ─── POST /api/bookings/:id/complete ───────────────────────────────────────────
// Customer marks done + rating (orange tick). Finalizes when worker also marked done.
router.post('/:id/complete', requireCustomer, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, {
      message: 'Invalid booking ID.',
      status: 400,
    });
  }

  const { rating } = req.body;
  if (!rating || rating < 1 || rating > 5) {
    return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, {
      message: 'Please select a rating between 1 and 5 stars before marking this job as done.',
      status: 400,
    });
  }

  const booking = await Booking.findOne({
    _id: req.params.id,
    customerId: req.customer.id,
    isDeleted: false
  }).populate('workerId', 'fullName totalEarnings completedJobs rating totalReviews');

  if (!booking) {
    return sendApiError(res, ERROR_CODES.BOOKING_NOT_FOUND, {
      message: 'This booking could not be found. Please refresh your bookings list.',
      status: 404,
      refreshRecommended: true,
    });
  }

  if (rejectBookingAction(res, booking, BOOKING_ACTION.CUSTOMER_COMPLETE)) {
    return;
  }

  const worker = booking.workerId;
  if (!worker) {
    return sendApiError(res, ERROR_CODES.BOOKING_NOT_COMPLETABLE, {
      message: 'No worker is assigned to this booking yet. You can mark it done after a worker is assigned.',
      status: 400,
      refreshRecommended: true,
      details: { currentStatus: booking.status },
    });
  }

  booking.customerMarkedDone = true;
  booking.customerMarkedDoneAt = new Date();
  booking.customerRating = rating;
  booking.timeline.push({
    status: booking.status,
    timestamp: new Date(),
    note: `Customer marked job as done with ${rating} stars (awaiting worker confirmation).`,
  });

  let serviceFee = 0;
  let workerEarnings = 0;
  let newRating = worker.rating || 0;
  let finalized = false;

  if (booking.workerMarkedDone) {
    const result = await finalizeBookingCompletion(
      booking,
      worker,
      req.customer.id,
    );
    serviceFee = result.serviceFee;
    workerEarnings = result.workerEarnings;
    newRating = result.newRating;
    finalized = true;
  } else {
    if (booking.status === 'assigned') {
      booking.status = 'in-progress';
    }
    await booking.save();
  }

  emitRefresh('bookings');

  if (finalized) {
    emitNotification(
      'bookings',
      'completed',
      `Job completed: ${booking.serviceTitle} by ${worker.fullName}. Rating: ${rating} stars. Commission: ₨${serviceFee}`,
    );
    emitRefresh('revenue');
    emitToUser(worker._id.toString(), 'job-completed', {
      bookingId: booking._id,
      serviceTitle: booking.serviceTitle,
      workerEarnings,
      rating,
      newRating: Number(newRating).toFixed(1),
      message: `Job "${booking.serviceTitle}" is fully completed. Customer rated ${rating} stars.`,
    });
    emitToUser(String(req.customer.id), 'booking-status-update', {
      bookingId: booking._id,
      serviceTitle: booking.serviceTitle,
      status: 'completed',
      rating,
      customerMarkedDone: true,
      workerMarkedDone: true,
      message: `Your ${booking.serviceTitle} service is fully completed.`,
    });
  } else {
    emitNotification(
      'bookings',
      'updated',
      `Customer marked ${booking.serviceTitle} as done (${rating}★). Waiting for worker.`,
    );
    emitToUser(worker._id.toString(), 'booking-status-update', {
      bookingId: booking._id,
      serviceTitle: booking.serviceTitle,
      status: booking.status,
      customerMarkedDone: true,
      workerMarkedDone: false,
      rating,
      message: `Customer marked "${booking.serviceTitle}" as done. Please confirm from your dashboard.`,
    });
    emitToUser(String(req.customer.id), 'booking-status-update', {
      bookingId: booking._id,
      serviceTitle: booking.serviceTitle,
      status: booking.status,
      customerMarkedDone: true,
      workerMarkedDone: false,
      rating,
      message: `Thanks! We notified the worker to confirm completion of ${booking.serviceTitle}.`,
    });
  }

  return res.json({
    success: true,
    message: finalized
      ? 'Booking completed successfully!'
      : 'Marked as done on your side. Waiting for the worker to confirm.',
    data: {
      bookingId: booking._id,
      status: booking.status,
      customerMarkedDone: true,
      workerMarkedDone: Boolean(booking.workerMarkedDone),
      finalized,
      workerEarnings: finalized ? workerEarnings : undefined,
      serviceFee: finalized ? serviceFee : undefined,
      rating,
      newWorkerRating: finalized ? Number(newRating).toFixed(1) : undefined,
    },
  });
}));

export default router;
