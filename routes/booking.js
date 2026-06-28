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
import { cacheDelByPrefix } from '../utils/cache.js';
import logger from '../utils/logger.js';
import { sendApiError, ERROR_CODES } from '../utils/apiErrors.js';
import {
  BOOKING_ACTION,
  rejectBookingAction,
} from '../utils/bookingActions.js';
import { finalizeBookingCompletion } from '../utils/bookingCompletion.js';
import { createNotification, notifyAllAdmins } from '../utils/createNotification.js';
import { BOOKING_STATUS } from '../utils/constants.js';
import { notifyAdminNewBooking, notifyCustomerBookingReceived, notifyCustomerJobCompleted } from '../services/notificationService.js';
import { notifyWorkersOfHighPriorityJob } from '../utils/workerJobNotifications.js';

const router = express.Router();

// ─── MULTER CONFIGURATION FOR PAYMENT RECEIPT ────────────────────────
const uploadDir = 'uploads/payment-receipts';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `receipt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
  const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.pdf'];
  
  if (allowedMimes.includes(file.mimetype) && allowedExts.includes(path.extname(file.originalname).toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error('Only image (JPG, PNG, GIF) or PDF files are allowed'), false);
  }
};

const paymentReceiptUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter
});

// Helper to emit notifications to admin
const notifyAdmin = (type, action, message) => {
  emitToAdmin('notification', { 
    type, 
    action, 
    message,
    timestamp: new Date().toISOString() 
  });
};

const refreshAdmin = (type) => {
  emitToAdmin('refresh', { type, timestamp: new Date().toISOString() });
};

// ─── POST /api/bookings ────────────────────────
// Create a new booking (customer only)
// Global error handler for multer and middleware
const multerErrorHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
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
    return res.status(400).json({
      success: false,
      message: err.message || 'Upload failed'
    });
  }
  next();
};

router.post('/',
  optionalAuth,
  (req, res, next) => {
    paymentReceiptUpload.single('paymentReceipt')(req, res, (err) => {
      multerErrorHandler(err, req, res, next);
    });
  },
  asyncHandler(async (req, res) => {
    try {
      const { serviceTitle, serviceId, category, address, location, phone, email, notes, name, latitude, longitude, placeId } = req.body;
      const bookingLocation = (location || address || '').trim();

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
        status: BOOKING_STATUS.OPEN,
        paymentDetails: {
          totalAmount: servicePrice,
        },
        timeline: [
          {
            status: BOOKING_STATUS.OPEN,
            timestamp: new Date(),
            note: 'Booking created and visible to workers',
          },
        ],
      });

      if (customer) {
        await Customer.findByIdAndUpdate(customer._id, {
          $inc: { totalBookings: 1, pendingBookings: 1 },
          lastBooking: new Date(),
        });

        createNotification({
          userId: customer._id,
          userRole: 'customer',
          title: 'Booking submitted',
          message: `We received your request for ${booking.serviceTitle}. Workers can claim it now.`,
          type: 'info',
        }).catch(() => {});
      }

      notifyAdmin('bookings', 'created', `New booking: ${booking.serviceTitle} by ${booking.customerName}`);
      refreshAdmin('bookings');

      notifyAllAdmins({
        title: 'New booking',
        message: `${booking.customerName} booked ${booking.serviceTitle}.`,
        type: 'booking',
      }).catch(() => {});

      // Send notifications via notification service
      notifyAdminNewBooking(booking).catch(() => {});
      if (customer) {
        notifyCustomerBookingReceived(customer._id, booking).catch(() => {});
      }

      notifyWorkersOfHighPriorityJob(
        booking.toObject?.() ? booking.toObject() : booking,
      ).catch(() => {});

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
        ? { totalAmount: b.paymentDetails.totalAmount }
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

  const previousStatus = booking.status;

  booking.status = 'cancelled';
  booking.timeline.push({
    status: 'cancelled',
    timestamp: new Date(),
    note: 'Cancelled by customer',
  });
  await booking.save();

  const customer = await Customer.findById(req.customer.id);
  if (customer) {
    const updateFields = {};
    if (customer.totalBookings > 0) updateFields.totalBookings = -1;
    if (customer.pendingBookings > 0 && previousStatus === 'pending') {
      updateFields.pendingBookings = -1;
    }
    if (Object.keys(updateFields).length > 0) {
      await Customer.findByIdAndUpdate(req.customer.id, { $inc: updateFields });
    }
  }

  refreshAdmin('bookings');
  cacheDelByPrefix('fixitnow:admin:summary').catch(() => {});
  cacheDelByPrefix('fixitnow:public:services').catch(() => {});
  notifyAdmin(
    'bookings',
    'cancelled',
    `Booking cancelled: ${booking.serviceTitle} by ${booking.customerName}`,
  );

  notifyAllAdmins({
    title: 'Booking cancelled',
    message: `${booking.customerName} cancelled ${booking.serviceTitle}.`,
    type: 'warning',
    relatedEntityId: booking._id,
  }).catch(() => {});

  const cancelPayload = {
    bookingId: booking._id,
    status: 'cancelled',
    previousStatus,
    serviceTitle: booking.serviceTitle,
    message: `Your booking for ${booking.serviceTitle} was cancelled.`,
  };

  emitToUser(String(req.customer.id), 'booking-status-update', cancelPayload);

  if (booking.workerId) {
    emitToUser(String(booking.workerId), 'booking-status-update', {
      ...cancelPayload,
      message: `${booking.serviceTitle} was cancelled by the customer.`,
    });
    createNotification({
      userId: booking.workerId,
      userRole: 'worker',
      title: 'Booking cancelled',
      message: `${booking.serviceTitle} was cancelled by the customer.`,
      type: 'warning',
      relatedEntityId: booking._id,
    }).catch(() => {});
  }

  createNotification({
    userId: req.customer.id,
    userRole: 'customer',
    title: 'Booking cancelled',
    message: `Your booking for ${booking.serviceTitle} was cancelled.`,
    type: 'warning',
    relatedEntityId: booking._id,
  }).catch(() => {});

  return res.json({
    success: true,
    message: 'Booking cancelled successfully.',
    data: {
      id: booking._id,
      status: 'cancelled',
      serviceTitle: booking.serviceTitle,
    },
  });
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

  refreshAdmin('bookings');

  if (finalized) {
    notifyAdmin(
      'bookings',
      'completed',
      `Job completed: ${booking.serviceTitle} by ${worker.fullName}. Rating: ${rating} stars. Commission: ₨${serviceFee}`,
    );
    refreshAdmin('revenue');
    
    // Send completion notifications via notification service
    notifyCustomerJobCompleted(req.customer.id, booking).catch(() => {});
    
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
    notifyAdmin(
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
    createNotification({
      userId: worker._id,
      userRole: 'worker',
      title: 'Customer marked job done',
      message: `Please confirm completion for ${booking.serviceTitle}.`,
      type: 'urgent',
      relatedEntityId: booking._id,
      pushOptions: { urgency: 'high' },
    }).catch(() => {});
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
