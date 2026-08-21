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
import {
  notifyAdminNewBooking,
  notifyCustomerBookingReceived,
  notifyCustomerJobCompleted
} from '../services/notificationService.js';
import { notifyWorkersOfHighPriorityJob } from '../utils/workerJobNotifications.js';
import { uploadsSubdir } from '../utils/uploadPaths.js';

const router = express.Router();

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * LIVE LOCATION CONFIGURATION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Worker location is only tracked while travelling to the customer.
 *
 * ARRIVAL_RADIUS_METERS:
 * When worker comes within this distance of customer's booking coordinates,
 * the booking automatically changes:
 *
 *     on-the-way → in-progress
 *
 * No manual "Arrived" button is required.
 */
const ARRIVAL_RADIUS_METERS = 50;

/**
 * Calculate distance between two GPS coordinates using the Haversine formula.
 *
 * Returns distance in meters.
 */
const calculateDistanceMeters = (
  latitude1,
  longitude1,
  latitude2,
  longitude2,
) => {
  const lat1 = Number(latitude1);
  const lon1 = Number(longitude1);
  const lat2 = Number(latitude2);
  const lon2 = Number(longitude2);

  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return null;
  }

  const earthRadiusMeters = 6371000;

  const toRadians = (degrees) => (degrees * Math.PI) / 180;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
};

/**
 * Validate GPS coordinate values.
 */
const isValidCoordinate = (latitude, longitude) => {
  const lat = Number(latitude);
  const lon = Number(longitude);

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
};

/**
 * Safely convert a booking document into the location payload that can be
 * sent to the customer.
 */
const getLiveLocationPayload = (booking) => ({
  bookingId: String(booking._id),
  status: booking.status,
  latitude: booking.currentLatitude ?? null,
  longitude: booking.currentLongitude ?? null,
  lastLocationUpdate: booking.lastLocationUpdate
    ? new Date(booking.lastLocationUpdate).toISOString()
    : null,
});

/**
 * Send a live-location update to the customer.
 */
const emitWorkerLocationUpdate = (booking) => {
  if (!booking?.customerId) return;

  emitToUser(String(booking.customerId), 'worker-location-update', {
    ...getLiveLocationPayload(booking),
    workerId: booking.workerId ? String(booking.workerId) : null,
  });
};

/**
 * Send a booking status update to both customer and worker.
 */
const emitBookingStatusUpdate = (booking, extra = {}) => {
  const payload = {
    bookingId: String(booking._id),
    serviceTitle: booking.serviceTitle,
    status: booking.status,
    ...extra,
  };

  if (booking.customerId) {
    emitToUser(String(booking.customerId), 'booking-status-update', payload);
  }

  if (booking.workerId) {
    emitToUser(String(booking.workerId), 'booking-status-update', payload);
  }
};

// ─── MULTER CONFIGURATION FOR PAYMENT RECEIPT ────────────────────────
const uploadDir = uploadsSubdir('payment-receipts');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName =
      `receipt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` +
      `${path.extname(file.originalname)}`;

    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedImageMimes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/tiff',
    'image/avif',
  ];

  const allowedImageExts = [
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.webp',
    '.bmp',
    '.tif',
    '.tiff',
    '.avif',
  ];

  const ext = path.extname(file.originalname).toLowerCase();

  if (
    allowedImageMimes.includes(file.mimetype) &&
    allowedImageExts.includes(ext)
  ) {
    return cb(null, true);
  }

  if (file.mimetype === 'application/pdf' && ext === '.pdf') {
    return cb(null, true);
  }

  cb(
    new Error(
      'Unsupported receipt format. Supported images: JPG, JPEG, PNG, GIF, WebP, BMP, TIFF, AVIF, or PDF.'
    ),
    false,
  );
};

const paymentReceiptUpload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
  fileFilter,
});

// Helper to emit notifications to admin
const notifyAdmin = (type, action, message) => {
  emitToAdmin('notification', {
    type,
    action,
    message,
    timestamp: new Date().toISOString(),
  });
};

const refreshAdmin = (type) => {
  emitToAdmin('refresh', {
    type,
    timestamp: new Date().toISOString(),
  });
};

// ─── GET /api/bookings ────────────────────────
// Get bookings list (redirects to /my for authenticated users)
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  try {
    // If user is authenticated, redirect to their bookings
    if (req.userId) {
      // Check if customer or worker
      const customer = await Customer.findById(req.userId);
      const worker = await Worker.findById(req.userId);

      if (customer) {
        // Customer: return their bookings
        const bookings = await Booking.find({
          customerId: req.userId,
        })
          .sort({ createdAt: -1 })
          .limit(50);

        return res.json({
          success: true,
          data: bookings,
          userType: 'customer',
        });
      } else if (worker) {
        // Worker: return available jobs
        const bookings = await Booking.find({
          status: {
            $in: ['pending', 'claim-pending'],
          },
          serviceCategory: {
            $in: worker.serviceCategories || [],
          },
        })
          .sort({ createdAt: -1 })
          .limit(50);

        return res.json({
          success: true,
          data: bookings,
          userType: 'worker',
        });
      }
    }

    // Unauthenticated: return empty list
    res.json({
      success: true,
      data: [],
      message: 'Login to view bookings',
    });
  } catch (error) {
    logger.error('GET /bookings error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings',
    });
  }
}));

// ─── POST /api/bookings ────────────────────────
// Create a new booking (customer only)
// Global error handler for multer and middleware
const multerErrorHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum 5MB allowed.',
      });
    }

    return res.status(400).json({
      success: false,
      message: err.message || 'File upload error',
    });
  }

  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Upload failed',
    });
  }

  next();
};

router.post(
  '/',
  optionalAuth,
  (req, res, next) => {
    paymentReceiptUpload.single('paymentReceipt')(
      req,
      res,
      (err) => {
        multerErrorHandler(err, req, res, next);
      },
    );
  },
  asyncHandler(async (req, res) => {
    try {
      if (
        req.file &&
        req.file.mimetype.startsWith('image/') &&
        req.file.size > 2 * 1024 * 1024
      ) {
        if (req.file.path && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }

        return res.status(400).json({
          success: false,
          message: 'Payment receipt images must be 2MB or smaller.',
        });
      }

      const {
        serviceTitle,
        serviceId,
        category,
        address,
        location,
        phone,
        email,
        notes,
        name,
        latitude,
        longitude,
        placeId,
      } = req.body;

      const bookingLocation = (
        location ||
        address ||
        ''
      ).trim();

      // Validate required fields
      if (!serviceTitle || serviceTitle.length < 3) {
        return res.status(400).json({
          success: false,
          message: 'Service title must be at least 3 characters long',
        });
      }

      if (!serviceId) {
        return res.status(400).json({
          success: false,
          message: 'Service ID is required',
        });
      }

      if (!phone || phone.length < 10) {
        return res.status(400).json({
          success: false,
          message: 'Valid phone number is required (minimum 10 digits)',
        });
      }

      if (
        !email ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Valid email address is required',
        });
      }

      if (!bookingLocation) {
        return res.status(400).json({
          success: false,
          message: 'Location is required',
        });
      }

      let customer = null;
      let isGuest = true;

      if (
        req.user?.role === 'customer' &&
        req.user?.id
      ) {
        customer = await Customer.findOne({
          _id: req.user.id,
          isDeleted: false,
        });

        if (customer) {
          isGuest = false;
        }
      }

      if (isGuest) {
        if (
          !name ||
          String(name).trim().length < 2
        ) {
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
            message: 'Service not found',
          });
        }

        servicePrice = service.price || 0;
        serviceCategory =
          service.category ||
          category ||
          '';

        if (servicePrice <= 0) {
          logger.warn(
            'Service has zero or invalid price',
            {
              serviceId,
              servicePrice,
            },
          );

          return res.status(400).json({
            success: false,
            message:
              'Service price is not configured. Please contact admin.',
          });
        }
      } catch (error) {
        logger.error(
          'Error fetching service details',
          {
            serviceId,
            error: error.message,
          },
        );

        return res.status(500).json({
          success: false,
          message:
            'Error fetching service details',
        });
      }

      const canonicalCategory = String(
        serviceCategory ||
          category ||
          '',
      ).trim();

      const booking = await Booking.create({
        customerId:
          customer?._id || null,

        isGuest,

        customerName:
          name || customer?.fullName,

        phone:
          phone || customer?.phone,

        email:
          email || customer?.email,

        serviceTitle,

        category:
          canonicalCategory,

        serviceCategory:
          canonicalCategory,

        serviceId:
          serviceId || null,

        price:
          servicePrice,

        address:
          bookingLocation,

        location:
          bookingLocation,

        latitude:
          latitude != null &&
          latitude !== ''
            ? Number(latitude)
            : null,

        longitude:
          longitude != null &&
          longitude !== ''
            ? Number(longitude)
            : null,

        placeId:
          placeId || '',

        notes:
          notes || '',

        status:
          BOOKING_STATUS.PENDING,

        // Live tracking starts empty.
        // These fields will be populated when the assigned worker
        // starts sending GPS coordinates.
        currentLatitude: null,
        currentLongitude: null,
        lastLocationUpdate: null,
        onTheWayAt: null,

        paymentDetails: {
          totalAmount:
            servicePrice,
        },

        timeline: [
          {
            status:
              BOOKING_STATUS.PENDING,

            timestamp:
              new Date(),

            note:
              'Booking created and visible to workers',
          },
        ],
      });

      if (customer) {
        await Customer.findByIdAndUpdate(
          customer._id,
          {
            $inc: {
              totalBookings: 1,
            },
            lastBooking:
              new Date(),
          },
        );

        createNotification({
          userId: customer._id,
          userRole: 'customer',
          title: 'Booking submitted',
          message:
            `We received your request for ${booking.serviceTitle}. Workers can claim it now.`,
          type: 'info',
        }).catch(() => {});
      }

      notifyAdmin(
        'bookings',
        'created',
        `New booking: ${booking.serviceTitle} by ${booking.customerName}`,
      );

      refreshAdmin('bookings');

      // Send notifications via notification service
      notifyAdminNewBooking(
        booking,
      ).catch(() => {});

      if (customer) {
        notifyCustomerBookingReceived(
          customer._id,
          booking,
        ).catch(() => {});
      }

      notifyWorkersOfHighPriorityJob(
        booking.toObject?.()
          ? booking.toObject()
          : booking,
      ).catch(() => {});

      return res.status(201).json({
        success: true,
        message:
          'Booking created successfully',
        data: booking,
      });
    } catch (error) {
      logger.error(
        'Booking creation error:',
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          'Booking failed. Please try again.',
      });
    }
  }),
);

// ─── GET /api/bookings/my ──────────────────────────────────────────────────────
// Get current customer's bookings (with worker details when assigned)
router.get(
  '/my',
  requireCustomer,
  asyncHandler(async (req, res) => {
    const bookings =
      await Booking.find({
        customerId:
          req.customer.id,
        isDeleted: false,
      })
        .populate(
          'workerId',
          'fullName phoneNumber email primaryServiceCategory',
        )
        .sort({
          createdAt: -1,
        })
        .lean();

    return res.json({
      success: true,

      data: bookings.map((b) => ({
        id: b._id,

        serviceTitle:
          b.serviceTitle,

        category:
          b.category,

        address:
          b.address,

        location:
          b.location ||
          b.address,

        notes:
          b.notes,

        status:
          b.status,

        price:
          b.price,

        createdAt:
          b.createdAt,

        updatedAt:
          b.updatedAt,

        /*
         * Customer's fixed destination coordinates.
         */
        latitude:
          b.latitude ?? null,

        longitude:
          b.longitude ?? null,

        placeId:
          b.placeId || '',

        /*
         * Worker's current live coordinates.
         *
         * Only useful while booking is on-the-way.
         */
        currentLatitude:
          b.status === 'on-the-way'
            ? b.currentLatitude ?? null
            : null,

        currentLongitude:
          b.status === 'on-the-way'
            ? b.currentLongitude ?? null
            : null,

        lastLocationUpdate:
          b.status === 'on-the-way' &&
          b.lastLocationUpdate
            ? b.lastLocationUpdate
            : null,

        onTheWayAt:
          b.onTheWayAt || null,

        paymentDetails:
          b.paymentDetails
            ? {
                totalAmount:
                  b.paymentDetails.totalAmount,
              }
            : null,

        customerRating:
          b.customerRating,

        customerMarkedDone:
          Boolean(
            b.customerMarkedDone,
          ),

        customerMarkedDoneAt:
          b.customerMarkedDoneAt,

        workerMarkedDone:
          Boolean(
            b.workerMarkedDone,
          ),

        workerMarkedDoneAt:
          b.workerMarkedDoneAt,

        worker: b.workerId
          ? {
              id:
                b.workerId._id,

              fullName:
                b.workerId.fullName,

              phoneNumber:
                b.workerId.phoneNumber,

              emailAddress:
                b.workerId.email,

              primaryServiceCategory:
                b.workerId.primaryServiceCategory,
            }
          : null,
      })),
    });
  }),
);

// ─── GET /api/bookings/my/claimed ──────────────────────────────────────────────
// Get current worker's claimed and assigned bookings
//
// Shows:
//   - Full info for worker-assigned
//   - Full info for on-the-way
//   - Full info for in-progress
//   - Full info for completed
//
// Hides:
//   - Sensitive info for claim-pending
router.get(
  '/my/claimed',
  requireWorker,
  asyncHandler(async (req, res) => {
    const { status } =
      req.query;

    // Build query for worker's bookings
    const query = {
      $or: [
        {
          workerId:
            req.worker.id,
        },
        {
          claimWorkerId:
            req.worker.id,
        },
      ],

      isDeleted: false,
    };

    // Optional status filter
    if (
      status &&
      [
        'pending',
        'claim-pending',
        'worker-assigned',
        'on-the-way',
        'in-progress',
        'completed',
      ].includes(status)
    ) {
      query.status = status;
    }

    const bookings =
      await Booking.find(query)
        .populate(
          'customerId',
          'fullName phone email',
        )
        .sort({
          createdAt: -1,
        })
        .lean();

    // Import visibility helper
    const {
      getVisibleBookingInfo,
    } = await import(
      '../utils/bookingVisibility.js'
    );

    return res.json({
      success: true,

      data: bookings.map((b) => {
        // Get filtered info based on status
        const visibleInfo =
          getVisibleBookingInfo(
            b,
            b.status,
          );

        return {
          id: b._id,

          serviceTitle:
            b.serviceTitle,

          serviceCategory:
            b.serviceCategory,

          status:
            b.status,

          date:
            b.date,

          time:
            b.time,

          budget:
            b.budget,

          createdAt:
            b.createdAt,

          // Customer destination
          latitude:
            visibleInfo.latitude,

          longitude:
            visibleInfo.longitude,

          // Live worker location
          currentLatitude:
            ['on-the-way'].includes(
              b.status,
            )
              ? b.currentLatitude ??
                null
              : null,

          currentLongitude:
            ['on-the-way'].includes(
              b.status,
            )
              ? b.currentLongitude ??
                null
              : null,

          lastLocationUpdate:
            b.status === 'on-the-way' &&
            b.lastLocationUpdate
              ? b.lastLocationUpdate
              : null,

          onTheWayAt:
            b.onTheWayAt ||
            null,

          // Visibility
          phone:
            visibleInfo.phone,

          email:
            visibleInfo.email,

          address:
            visibleInfo.address,

          city:
            visibleInfo.city,

          area:
            visibleInfo.area,

          // Always show description
          description:
            b.description,

          // Customer info
          customerName:
            b.customerName,

          customerId:
            b.customerId?._id,

          // Timing
          claimedAt:
            b.claimedAt,

          approvedAt:
            b.approvedAt,

          startedAt:
            b.startedAt,

          // Work status
          workerMarkedDone:
            Boolean(
              b.workerMarkedDone,
            ),

          workerMarkedDoneAt:
            b.workerMarkedDoneAt,

          customerMarkedDone:
            Boolean(
              b.customerMarkedDone,
            ),

          customerMarkedDoneAt:
            b.customerMarkedDoneAt,

          // Payment
          paymentDetails:
            b.paymentDetails
              ? {
                  totalAmount:
                    b.paymentDetails
                      .totalAmount,

                  serviceFee:
                    b.paymentDetails
                      .serviceFee,

                  workerEarnings:
                    b.paymentDetails
                      .workerEarnings,
                }
              : null,

          // UI hints
          isHidden:
            visibleInfo.isHidden,

          showFullInfo:
            !visibleInfo.isHidden,

          canMarkDone:
            [
              'worker-assigned',
              'on-the-way',
              'in-progress',
            ].includes(
              b.status,
            ),

          /*
           * No manual "Go to Work" requirement.
           *
           * The frontend should start watchPosition when the
           * booking reaches worker-assigned.
           */
          canStartWork:
            false,

          /*
           * Frontend can use this to decide whether it should
           * continue sending GPS updates.
           */
          shouldTrackLocation:
            b.status ===
            'worker-assigned' ||
            b.status ===
            'on-the-way',
        };
      }),
    });
  }),
);

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/bookings/:id/location
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Worker sends their current GPS position here.
 *
 * Expected body:
 *
 * {
 *   "latitude": 32.1617,
 *   "longitude": 74.1883
 * }
 *
 * The worker does NOT manually change the booking status.
 *
 * First valid location:
 *
 *     worker-assigned → on-the-way
 *
 * Once worker is within ARRIVAL_RADIUS_METERS:
 *
 *     on-the-way → in-progress
 *
 * After in-progress:
 *
 *     GPS updates are rejected because tracking should stop.
 */
router.post(
  '/:id/location',
  requireWorker,
  asyncHandler(async (req, res) => {
    if (
      !mongoose.Types.ObjectId.isValid(
        req.params.id,
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid booking ID.',
      });
    }

    const {
      latitude,
      longitude,
    } = req.body;

    if (
      !isValidCoordinate(
        latitude,
        longitude,
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Valid latitude and longitude are required.',
      });
    }

    const booking =
      await Booking.findOne({
        _id:
          req.params.id,

        isDeleted:
          false,
      });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message:
          'Booking not found.',
      });
    }

    // Only the assigned worker can send location.
    if (
      String(booking.workerId) !==
      String(req.worker.id)
    ) {
      return res.status(403).json({
        success: false,
        message:
          'You can only update your location for an assigned booking.',
      });
    }

    /*
     * Tracking is only valid before work begins.
     *
     * Once the worker reaches the customer and the booking
     * becomes in-progress, location tracking ends.
     */
    if (
      ![
        'worker-assigned',
        'on-the-way',
      ].includes(
        booking.status,
      )
    ) {
      return res.json({
        success: true,
        trackingActive: false,
        status: booking.status,
        message:
          'Live tracking is not active for this booking.',
        data:
          getLiveLocationPayload(
            booking,
          ),
      });
    }

    const workerLatitude =
      Number(latitude);

    const workerLongitude =
      Number(longitude);

    const now =
      new Date();

    /*
     * Save latest worker position.
     */
    booking.currentLatitude =
      workerLatitude;

    booking.currentLongitude =
      workerLongitude;

    booking.lastLocationUpdate =
      now;

    let statusChanged =
      false;

    /*
     * First GPS update automatically starts the journey.
     *
     * No worker button is required.
     */
    if (
      booking.status ===
      'worker-assigned'
    ) {
      booking.status =
        'on-the-way';

      booking.onTheWayAt =
        now;

      booking.timeline.push({
        status:
          'on-the-way',

        timestamp:
          now,

        note:
          'Worker location tracking started automatically.',
      });

      statusChanged =
        true;
    }

    /*
     * Check distance from worker to customer's
     * fixed booking destination.
     */
    const distanceMeters =
      calculateDistanceMeters(
        workerLatitude,
        workerLongitude,
        booking.latitude,
        booking.longitude,
      );

    /*
     * Automatically arrive at destination.
     *
     * We only perform this transition if the booking has
     * valid customer coordinates.
     */
    if (
      booking.status ===
        'on-the-way' &&
      distanceMeters !== null &&
      distanceMeters <=
        ARRIVAL_RADIUS_METERS
    ) {
      booking.status =
        'in-progress';

      booking.startedAt =
        now;

      booking.timeline.push({
        status:
          'in-progress',

        timestamp:
          now,

        note:
          `Worker arrived within ${Math.round(distanceMeters)}m of the customer.`,
      });

      statusChanged =
        true;
    }

    await booking.save();

    /*
     * Always send latest worker location while tracking.
     */
    if (
      booking.status ===
      'on-the-way'
    ) {
      emitWorkerLocationUpdate(
        booking,
      );
    }

    /*
     * If arrival was detected, notify customer and worker.
     */
    if (
      booking.status ===
      'in-progress' &&
      statusChanged
    ) {
      emitBookingStatusUpdate(
        booking,
        {
          message:
            'Worker has arrived and the job is now in progress.',
          startedAt:
            booking.startedAt,
          distanceMeters:
            distanceMeters !== null
              ? Math.round(
                  distanceMeters,
                )
              : null,
        },
      );
    } else if (
      statusChanged &&
      booking.status ===
        'on-the-way'
    ) {
      emitBookingStatusUpdate(
        booking,
        {
          message:
            'Worker is on the way to your location.',
          onTheWayAt:
            booking.onTheWayAt,
        },
      );
    }

    return res.json({
      success: true,

      trackingActive:
        booking.status ===
        'on-the-way',

      status:
        booking.status,

      data: {
        ...getLiveLocationPayload(
          booking,
        ),

        distanceMeters:
          distanceMeters !== null
            ? Math.round(
                distanceMeters,
              )
            : null,

        arrivalRadiusMeters:
          ARRIVAL_RADIUS_METERS,
      },
    });
  }),
);

// ─── DELETE /api/bookings/:id ──────────────────────────────────────────────────
// Cancel a booking (customer only, only if pending)
router.delete(
  '/:id',
  requireCustomer,
  asyncHandler(async (req, res) => {
    if (
      !mongoose.Types.ObjectId.isValid(
        req.params.id,
      )
    ) {
      return sendApiError(
        res,
        ERROR_CODES.VALIDATION_FAILED,
        {
          message:
            'Invalid booking ID.',
          status: 400,
        },
      );
    }

    const booking =
      await Booking.findOne({
        _id:
          req.params.id,

        customerId:
          req.customer.id,

        isDeleted:
          false,
      });

    if (!booking) {
      return sendApiError(
        res,
        ERROR_CODES.BOOKING_NOT_FOUND,
        {
          message:
            'This booking could not be found. It may have been removed.',
          status: 404,
          refreshRecommended:
            true,
        },
      );
    }

    if (
      rejectBookingAction(
        res,
        booking,
        BOOKING_ACTION.CUSTOMER_CANCEL,
      )
    ) {
      return;
    }

    const previousStatus =
      booking.status;

    booking.status =
      'cancelled';

    booking.timeline.push({
      status:
        'cancelled',

      timestamp:
        new Date(),

      note:
        'Cancelled by customer',
    });

    await booking.save();

    const customer =
      await Customer.findById(
        req.customer.id,
      );

    if (customer) {
      const updateFields =
        {};

      if (
        customer.totalBookings >
        0
      ) {
        updateFields.totalBookings =
          -1;
      }

      if (
        customer.pendingBookings >
          0 &&
        previousStatus ===
          'pending'
      ) {
        updateFields.pendingBookings =
          -1;
      }

      if (
        Object.keys(
          updateFields,
        ).length > 0
      ) {
        await Customer.findByIdAndUpdate(
          req.customer.id,
          {
            $inc:
              updateFields,
          },
        );
      }
    }

    refreshAdmin(
      'bookings',
    );

    cacheDelByPrefix(
      'fixitnow:admin:summary',
    ).catch(() => {});

    cacheDelByPrefix(
      'fixitnow:public:services',
    ).catch(() => {});

    notifyAdmin(
      'bookings',
      'cancelled',
      `Booking cancelled: ${booking.serviceTitle} by ${booking.customerName}`,
    );

    notifyAllAdmins({
      title:
        'Booking cancelled',

      message:
        `${booking.customerName} cancelled ${booking.serviceTitle}.`,

      type:
        'warning',

      relatedEntityId:
        booking._id,
    }).catch(() => {});

    const cancelPayload =
      {
        bookingId:
          booking._id,

        status:
          'cancelled',

        previousStatus,

        serviceTitle:
          booking.serviceTitle,

        message:
          `Your booking for ${booking.serviceTitle} was cancelled.`,
      };

    emitToUser(
      String(req.customer.id),
      'booking-status-update',
      cancelPayload,
    );

    if (booking.workerId) {
      emitToUser(
        String(booking.workerId),
        'booking-status-update',
        {
          ...cancelPayload,

          message:
            `${booking.serviceTitle} was cancelled by the customer.`,
        },
      );

      createNotification({
        userId:
          booking.workerId,

        userRole:
          'worker',

        title:
          'Booking cancelled',

        message:
          `${booking.serviceTitle} was cancelled by the customer.`,

        type:
          'warning',

        relatedEntityId:
          booking._id,
      }).catch(() => {});
    }

    createNotification({
      userId:
        req.customer.id,

      userRole:
        'customer',

      title:
        'Booking cancelled',

      message:
        `Your booking for ${booking.serviceTitle} was cancelled.`,

      type:
        'warning',

      relatedEntityId:
        booking._id,
    }).catch(() => {});

    return res.json({
      success:
        true,

      message:
        'Booking cancelled successfully.',

      data: {
        id:
          booking._id,

        status:
          'cancelled',

        serviceTitle:
          booking.serviceTitle,
      },
    });
  }),
);
export default router;
