import express from 'express';
import authRoutes from './auth.js';
import adminRoutes from './admin.js';
import bookingRoutes from './booking.js';
import workerRoutes from './worker.js';
import servicesRoutes from './services.js';
import publicServicesRoutes from './publicServices.js';
import rankingRoutes from './ranking.js';
import workerJobsRoutes from './workerJobs.js';
import reviewRoutes from './reviews.js';
import notificationRoutes from './notifications.js';
import advertisementRoutes from './advertisements.js';
import appReviewRoutes from './appReviews.js';
import geocodeRoutes from './geocode.js';
import auditLogsRoutes from './auditLogs.js';
import pushRoutes from './push.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/admin/audit-logs', auditLogsRoutes);
router.use('/bookings', bookingRoutes);
router.use('/worker', workerRoutes);
router.use('/services', servicesRoutes);
router.use('/public/services', publicServicesRoutes);
router.use('/ranking', rankingRoutes);
router.use('/worker-jobs', workerJobsRoutes);
router.use('/reviews', reviewRoutes);
router.use('/notifications', notificationRoutes);
router.use('/advertisements', advertisementRoutes);
router.use('/app-reviews', appReviewRoutes);
router.use('/geocode', geocodeRoutes);
router.use('/push', pushRoutes);

export default router;
