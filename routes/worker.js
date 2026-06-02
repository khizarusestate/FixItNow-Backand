import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireWorker, requireAdmin } from '../middleware/auth.js';
import Worker from '../workerSchema.js';
import Booking from '../bookingSchema.js';
import mongoose from 'mongoose';
import Customer from '../customerSchema.js';
import { getSocketIO, emitToUser, emitToAdmin, emitToWorkers } from '../utils/socketManager.js';
import logger from '../utils/logger.js';
import { rankBookingsForWorker, sanitizeBookingForWorker, sanitizeAssignedBooking } from '../utils/jobMatching.js';
import { sendApiError, ERROR_CODES } from '../utils/apiErrors.js';
import { BOOKING_ACTION, rejectBookingAction } from '../utils/bookingActions.js';
import { applyLocationUpdate, formatLocationResponse, getLocationLabel } from '../utils/locationFields.js';
import { validateFile, generateSecureFilename } from '../utils/fileValidation.js';
import { normalizeCnic } from '../utils/cnic.js';
import { resolveWorkerServiceFields } from '../utils/workerServiceFields.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure multer for profile picture uploads
const uploadsDir = path.join(__dirname, '../uploads/profile-pictures');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const secureName = generateSecureFilename(file.originalname, req.worker?.id);
    cb(null, 'worker-' + secureName);
  }
});

const fileFilter = (req, file, cb) => {
  try {
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedMimes.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, JPG, PNG, and WebP images are allowed'), false);
    }
    cb(null, true);
  } catch (error) {
    cb(new Error('File validation failed'), false);
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter
});

const emitAdminRefresh = (type) => {
  emitToAdmin('refresh', { type, timestamp: new Date().toISOString() });
};

const toWorkerProfilePayload = (worker) => {
  const loc = formatLocationResponse(worker);
  return {
    id: worker._id,
    _id: worker._id,
    fullName: worker.fullName,
    emailAddress: worker.emailAddress,
    phoneNumber: worker.phoneNumber,
    serviceCategory: worker.primaryServiceCategory,
    primaryServiceCategory: worker.primaryServiceCategory,
    primaryServiceName: worker.primaryServiceName || '',
    primaryServiceId: worker.primaryServiceId || null,
    serviceCategories: worker.serviceCategories,
    cnicNumber: worker.cnicNumber,
    ...loc,
    profilePicture: worker.profilePicture,
    devicePushEnabled: worker.devicePushEnabled !== false,
    status: worker.status,
    availability: worker.availability,
    joinDate: worker.joinDate,
    createdAt: worker.createdAt,
    updatedAt: worker.updatedAt,
    rating: worker.rating ?? 0,
    totalReviews: worker.totalReviews ?? 0,
    completedJobs: worker.completedJobs ?? 0,
    type: 'worker',
  };
};

// ─── GET /api/worker/jobs ──────────────────────────────────────────────────────
// Get jobs assigned to logged-in worker (all statuses)
router.get('/jobs', requireWorker, asyncHandler(async (req, res) => {
  const bookings = await Booking.find({ workerId: req.worker.id, isDeleted: false })
    .sort({ assignedAt: -1, createdAt: -1 })
    .lean();

  return res.json({
    success: true,
    data: bookings.map(sanitizeAssignedBooking)
  });
}));

// ─── GET /api/worker/available-jobs ────────────────────────────────────────────
// Get unassigned bookings ranked by relevance to this worker.
// Open bookings are visible to approved workers via /api/worker-jobs/available.
router.get('/available-jobs', requireWorker, asyncHandler(async (req, res) => {
  const worker = await Worker.findOne({ _id: req.worker.id, isDeleted: false })
    .select('primaryServiceCategory serviceCategories location serviceArea address latitude longitude status availability')
    .lean();

  if (!worker) {
    return res.status(404).json({ success: false, message: 'Worker not found.' });
  }

  if (worker.status !== 'approved' && worker.status !== 'active' && worker.status !== 'inactive') {
    return res.status(403).json({ success: false, message: 'Your account must be approved by admin to view jobs.' });
  }

  // Only return bookings that have been approved by admin and not deleted
  const bookings = await Booking.find({
    workerId: null,
    status: 'approved',
    isDeleted: false
  })
    .sort({ createdAt: -1 })
    .lean();

  const ranked = rankBookingsForWorker(worker, bookings);

  return res.json({
    success: true,
    data: ranked.map(sanitizeBookingForWorker)
  });
}));

// ─── POST /api/worker/jobs/:id/accept ──────────────────────────────────────────
// Worker accepts an available job (self-assignment).
// Booking must be admin-approved (status: 'approved') before a worker can claim it.
// Prevents double-booking by checking worker's active job count.
router.post('/jobs/:id/accept', requireWorker, asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid booking ID.' });
  }

  const worker = await Worker.findOne({ _id: req.worker.id, isDeleted: false });
  if (!worker) {
    return res.status(404).json({ success: false, message: 'Worker not found.' });
  }

  if (worker.status !== 'approved' && worker.status !== 'active' && worker.status !== 'inactive') {
    return res.status(403).json({ success: false, message: 'Your account must be approved by admin to claim jobs.' });
  }

  if (!worker.availability) {
    return res.status(403).json({ success: false, message: 'You are currently unavailable. Please set your availability to accept jobs.' });
  }

  // Prevent double-booking: check if worker has active jobs
  const activeJobsCount = await Booking.countDocuments({
    workerId: req.worker.id,
    status: { $in: ['assigned', 'in-progress'] },
    isDeleted: false
  });

  if (activeJobsCount >= 3) {
    return res.status(400).json({ success: false, message: 'You have reached the maximum number of active jobs (3). Complete current jobs before accepting new ones.' });
  }

  const booking = await Booking.findOne({
    _id: req.params.id,
    isDeleted: false,
  });

  if (!booking) {
    return sendApiError(res, ERROR_CODES.BOOKING_NOT_FOUND, {
      message: 'This job could not be found. It may have been removed.',
      status: 404,
      refreshRecommended: true,
    });
  }

  if (
    rejectBookingAction(res, booking, BOOKING_ACTION.WORKER_ACCEPT, {
      existingWorkerId: booking.workerId,
    })
  ) {
    return;
  }

  // Assign booking to worker
  booking.workerId = req.worker.id;
  booking.status = 'assigned';
  booking.assignedAt = new Date();
  booking.timeline.push({
    status: 'assigned',
    timestamp: new Date(),
    note: `Accepted by worker: ${worker.fullName}`
  });
  await booking.save();

  // Update worker stats and lifecycle
  await Worker.findByIdAndUpdate(req.worker.id, {
    $inc: { totalJobs: 1, assignedJobs: 1 },
    status: 'active',
    lastActive: new Date()
  });

  // 🔥 REAL-TIME: Notify worker about job assignment
  emitToUser(req.worker.id, 'job-accepted', {
    bookingId: booking._id,
    serviceTitle: booking.serviceTitle,
    message: `You have successfully accepted ${booking.serviceTitle}`
  });

  // Notify admin
  getSocketIO().to('admin-room').emit('booking-status-update', {
    bookingId: booking._id,
    serviceTitle: booking.serviceTitle,
    status: 'assigned',
    workerId: req.worker.id,
    workerName: worker.fullName,
    timestamp: new Date().toISOString()
  });

  // Notify customer
  emitToUser(String(booking.customerId), 'job-assigned', {
    bookingId: booking._id,
    serviceTitle: booking.serviceTitle,
    worker: {
      id: worker._id,
      fullName: worker.fullName,
      phoneNumber: worker.phoneNumber,
      serviceCategory: worker.primaryServiceCategory,
      primaryServiceCategory: worker.primaryServiceCategory
    },
    message: `A worker has been assigned to your ${booking.serviceTitle} request.`
  });

  emitAdminRefresh('bookings');
  emitAdminRefresh('workers');

  return res.json({
    success: true,
    message: 'Job accepted successfully.',
    data: sanitizeAssignedBooking(booking)
  });
}));

// ─── GET /api/worker/profile ───────────────────────────────────────────────────
// Get current worker's profile
router.get('/profile', requireWorker, asyncHandler(async (req, res) => {
  const worker = await Worker.findOne({ _id: req.worker.id, isDeleted: false })
    .select('-password');

  if (!worker) {
    return res.status(404).json({ success: false, message: 'Worker not found.' });
  }

  return res.json({ success: true, data: toWorkerProfilePayload(worker) });
}));

// ─── PUT /api/worker/profile ──────────────────────────────────────────────────
// Update current worker's profile
router.put('/profile', requireWorker, asyncHandler(async (req, res) => {
  const { fullName, emailAddress, phoneNumber, cnicNumber, primaryServiceCategory, serviceCategories, availability, profilePicture } = req.body;

  // Get current worker data for auto-fill
  const currentWorker = await Worker.findById(req.worker.id).select('fullName phoneNumber availability');
  if (!currentWorker) {
    return res.status(404).json({ success: false, message: 'Worker not found.' });
  }

  const updateFields = {};
  if (fullName !== undefined) updateFields.fullName = fullName;
  if (emailAddress !== undefined) {
    const email = emailAddress.toLowerCase().trim();
    const existingWorker = await Worker.findOne({ emailAddress: email, _id: { $ne: req.worker.id }, isDeleted: false });
    if (existingWorker) {
      return res.status(409).json({ success: false, message: 'Worker with this email already exists.' });
    }
    const existingCustomer = await Customer.findOne({ email, isDeleted: false });
    if (existingCustomer) {
      return res.status(409).json({ success: false, message: 'This email is already registered as a customer.' });
    }
    updateFields.emailAddress = email;
  }
  if (phoneNumber !== undefined) updateFields.phoneNumber = phoneNumber;
  if (cnicNumber !== undefined) {
    const normalized = normalizeCnic(cnicNumber);
    if (!normalized) {
      return res.status(400).json({ success: false, message: 'CNIC must be 13 digits.' });
    }
    const existingCnic = await Worker.findOne({
      cnicNumber: normalized,
      _id: { $ne: req.worker.id },
      isDeleted: false,
    });
    if (existingCnic) {
      return res.status(409).json({ success: false, message: 'CNIC already registered.' });
    }
    updateFields.cnicNumber = normalized;
  }
  if (primaryServiceCategory !== undefined || req.body.primaryServiceId !== undefined || req.body.primaryServiceName !== undefined) {
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
  if (serviceCategories !== undefined) updateFields.serviceCategories = serviceCategories;
  applyLocationUpdate(updateFields, req.body);
  if (profilePicture !== undefined) {
    if (
      typeof profilePicture === "string" &&
      profilePicture.startsWith("data:image")
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Profile photos must be uploaded via POST /worker/profile-picture (file too large for JSON).",
      });
    }
    updateFields.profilePicture = profilePicture;
  }

  const worker = await Worker.findByIdAndUpdate(
    req.worker.id,
    updateFields,
    { new: true, runValidators: true }
  ).select('-password');

  if (!worker) {
    return res.status(404).json({ success: false, message: 'Worker not found.' });
  }

  const payload = toWorkerProfilePayload(worker);
  emitAdminRefresh('workers');
  emitToUser(String(worker._id), 'profile-updated', payload);

  return res.json({ success: true, message: 'Profile updated successfully.', data: payload });
}));

// ─── PATCH /api/worker/availability ─────────────────────────────────────────────
// Toggle worker availability
router.patch('/availability', requireWorker, asyncHandler(async (req, res) => {
  const { availability } = req.body;

  if (typeof availability !== 'boolean') {
    return res.status(400).json({ success: false, message: 'Availability must be a boolean value.' });
  }

  const worker = await Worker.findOne({ _id: req.worker.id, isDeleted: false });
  if (!worker) {
    return res.status(404).json({ success: false, message: 'Worker not found.' });
  }

  // If setting to unavailable, check if worker has active jobs
  if (availability === false) {
    const activeJobsCount = await Booking.countDocuments({
      workerId: req.worker.id,
      status: { $in: ['assigned', 'in-progress'] },
      isDeleted: false
    });

    if (activeJobsCount > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `You have ${activeJobsCount} active job(s). Complete them before setting yourself unavailable.` 
      });
    }
  }

  worker.availability = availability;
  await worker.save();

  const payload = toWorkerProfilePayload(worker);
  emitAdminRefresh('workers');
  emitToUser(String(worker._id), 'availability-updated', { 
    availability: worker.availability,
    message: availability ? 'You are now available for new jobs.' : 'You are now unavailable for new jobs.'
  });

  logger.info('Worker availability updated', { workerId: worker._id, availability });

  return res.json({
    success: true,
    message: `Availability ${availability ? 'enabled' : 'disabled'} successfully.`,
    data: payload
  });
}));

// ─── PATCH /api/worker/jobs/:id/status ──────────────────────────────────────────
// Worker updates booking status (assigned → in-progress)
// Workers CANNOT mark jobs as completed - only customers can complete with rating
// Updates worker lifecycle counters based on status changes
router.patch('/jobs/:id/status', requireWorker, asyncHandler(async (req, res) => {
  const { status } = req.body;
  // Worker can only: start (assigned→in-progress)
  const validStatuses = ['in-progress'];

  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: `Status must be one of: ${validStatuses.join(', ')}. Workers cannot mark jobs as completed.` });
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid booking ID.' });
  }

  const booking = await Booking.findOne({
    _id: req.params.id,
    workerId: req.worker.id,
    isDeleted: false
  });

  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found or not assigned to you.' });
  }

  // Role-based status transitions: Worker can only move to in-progress
  // Only customer can mark job as completed with rating
  if (status === 'in-progress' && !['assigned'].includes(booking.status)) {
    return res.status(400).json({ success: false, message: 'Booking must be assigned before starting work.' });
  }

  // Update booking with timeline
  booking.status = status;
  booking.timeline.push({
    status,
    timestamp: new Date(),
    note: `Worker updated status to: ${status}`
  });
  await booking.save();

  // Update worker lifecycle counters and last active
  const workerUpdate = {
    $inc: { assignedJobs: -1, activeJobs: 1 },
    lastActive: new Date()
  };
  await Worker.findByIdAndUpdate(req.worker.id, workerUpdate);

  // 🔥 REAL-TIME: Notify admin about status update
  getSocketIO().to('admin-room').emit('booking-status-update', {
    bookingId: booking._id,
    serviceTitle: booking.serviceTitle,
    status,
    workerId: req.worker.id,
    timestamp: new Date().toISOString()
  });

  // 🔥 REAL-TIME: Notify customer about status update
  emitToUser(String(booking.customerId), 'job-status-update', {
    bookingId: booking._id,
    serviceTitle: booking.serviceTitle,
    status,
    message: `Your ${booking.serviceTitle} service is now ${status}.`
  });

  // 🔥 REAL-TIME: Notify worker about job started
  emitToUser(String(req.worker.id), 'job-started', {
    bookingId: booking._id,
    serviceTitle: booking.serviceTitle,
    message: `You have started working on ${booking.serviceTitle}`
  });
  getSocketIO().to('admin-room').emit('booking-status-update', {
    bookingId: booking._id,
    serviceTitle: booking.serviceTitle,
    status,
    workerId: req.worker.id,
    timestamp: new Date().toISOString()
  });

  return res.json({
    success: true,
    message: `Booking marked as ${status}.`,
    data: { id: booking._id, status: booking.status }
  });
}));

// ─── GET /api/worker/list (public) ────────────────────────────────────────────
// Get list of active workers
router.get('/list', asyncHandler(async (req, res) => {
  const { category, page = 1, limit = 50, sortBy = 'rating', order = 'desc' } = req.query;
  const query = { status: 'approved', isDeleted: false };
  if (category) query.primaryServiceCategory = category;

  const skip = (Number(page) - 1) * Number(limit);
  const sort = { [sortBy]: order === 'asc' ? 1 : -1 };

  const [workers, total] = await Promise.all([
    Worker.find(query)
      .select('fullName phoneNumber emailAddress primaryServiceCategory serviceCategories serviceArea address availability profilePicture joinDate')
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Worker.countDocuments(query)
  ]);

  return res.json({
    success: true,
    data: workers,
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) }
  });
}));

// ─── GET /api/worker/dashboard ────────────────────────────────────────────────
// Protected route for worker dashboard data
router.get('/dashboard', requireWorker, asyncHandler(async (req, res) => {
  const worker = await Worker.findOne({ _id: req.worker.id, isDeleted: false })
    .select('-password');

  if (!worker) {
    return res.status(404).json({ success: false, message: 'Worker not found.' });
  }

  // Get booking statistics
  const [assignedBookings, activeBookings, completedBookings, totalEarnings] = await Promise.all([
    Booking.countDocuments({ workerId: req.worker.id, status: 'assigned', isDeleted: false }),
    Booking.countDocuments({ workerId: req.worker.id, status: 'in-progress', isDeleted: false }),
    Booking.countDocuments({ workerId: req.worker.id, status: 'completed', isDeleted: false }),
    Worker.findById(req.worker.id).select('totalEarnings')
  ]);

  // Get recent bookings
  const recentBookings = await Booking.find({ workerId: req.worker.id, isDeleted: false })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('serviceTitle status price createdAt assignedAt completedAt')
    .lean();

  return res.json({
    success: true,
    data: {
      worker: toWorkerProfilePayload(worker),
      stats: {
        totalJobs: worker.totalJobs || 0,
        assignedJobs: worker.assignedJobs || 0,
        activeJobs: worker.activeJobs || 0,
        completedJobs: worker.completedJobs || 0,
        rating: worker.rating || 0,
        totalReviews: worker.totalReviews || 0,
        totalEarnings: totalEarnings?.totalEarnings || 0,
        availability: worker.availability,
        status: worker.status
      },
      bookingStats: {
        assigned: assignedBookings,
        active: activeBookings,
        completed: completedBookings
      },
      recentBookings
    }
  });
}));

// ─── POST /api/worker/profile-picture ───────────────────────────────────────────
// Upload worker profile picture
router.post('/profile-picture', requireWorker, upload.single('profilePicture'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  // Perform comprehensive file validation
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

  const worker = await Worker.findOne({ _id: req.worker.id, isDeleted: false });
  if (!worker) {
    return res.status(404).json({ success: false, message: 'Worker not found.' });
  }

  // Delete old profile picture if exists
  if (worker.profilePicture) {
    const oldPicturePath = path.join(__dirname, '..', worker.profilePicture);
    if (fs.existsSync(oldPicturePath)) {
      fs.unlinkSync(oldPicturePath);
    }
  }

  // Update worker with new profile picture path
  const profilePicturePath = '/uploads/profile-pictures/' + req.file.filename;
  worker.profilePicture = profilePicturePath;
  await worker.save();

  const payload = toWorkerProfilePayload(worker);
  emitAdminRefresh('workers');
  emitToUser(String(worker._id), 'profile-updated', payload);

  logger.info('Worker profile picture uploaded', { workerId: worker._id, filePath: profilePicturePath });

  return res.json({
    success: true,
    message: 'Profile picture uploaded successfully.',
    data: payload
  });
}));

// ─── DELETE /api/worker/profile-picture ──────────────────────────────────────────
// Remove worker profile picture
router.delete('/profile-picture', requireWorker, asyncHandler(async (req, res) => {
  const worker = await Worker.findOne({ _id: req.worker.id, isDeleted: false });
  if (!worker) {
    return res.status(404).json({ success: false, message: 'Worker not found.' });
  }

  // Delete profile picture file if exists
  if (worker.profilePicture) {
    const picturePath = path.join(__dirname, '..', worker.profilePicture);
    if (fs.existsSync(picturePath)) {
      fs.unlinkSync(picturePath);
    }
  }

  // Remove profile picture from worker record
  worker.profilePicture = null;
  await worker.save();

  const payload = toWorkerProfilePayload(worker);
  emitAdminRefresh('workers');
  emitToUser(String(worker._id), 'profile-updated', payload);

  logger.info('Worker profile picture removed', { workerId: worker._id });

  return res.json({
    success: true,
    message: 'Profile picture removed successfully.',
    data: payload
  });
}));

export default router;
