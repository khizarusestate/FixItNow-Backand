/**
 * FILE: backend/services/notificationService.js
 *
 * Centralized notification service for admin/worker/customer notifications.
 *
 * NOTE (fixed): this used to route through utils/notificationManager.js,
 * which emitted to a Socket.IO room ("user-${userId}") that no client ever
 * actually joined — every notification sent through it was silently lost,
 * while the code logged a false "sent successfully". It now delegates to
 * utils/createNotification.js, which persists to the Notification collection
 * and emits via the correctly-tracked per-user socket map (see
 * utils/socketManager.js), with a real web-push fallback.
 */

import { createNotification, notifyAllAdmins } from '../utils/createNotification.js';
import NotificationPreference from '../models/NotificationPreference.js';

/**
 * Kept for backward compatibility with index.js's bootstrap — the new
 * delivery path doesn't need an io/fcm/db handle (createNotification uses
 * socketManager.js's own io reference), so this is now a no-op.
 */
export function initNotificationService() {
  console.log('✅ Notification Service Initialized');
}

/**
 * Check if user has this notification type enabled in their preferences.
 */
async function shouldSendNotification(userId, notificationType) {
  try {
    const prefs = await NotificationPreference.findOne({ userId });

    if (!prefs) return true; // Default to send if no preferences exist yet

    // Check if general notifications are enabled
    if (!prefs.inAppEnabled && !prefs.pushEnabled) return false;

    // Check if specific notification type is enabled
    const typeEnabled = prefs.notificationTypes?.[notificationType];
    if (typeEnabled === false) return false;

    return true;
  } catch (error) {
    console.warn(`Error checking notification preference: ${error.message}`);
    return true; // Default to send on error
  }
}

/**
 * ADMIN NOTIFICATIONS
 */
export async function notifyAdminNewBooking(booking) {
  return notifyAllAdmins({
    title: 'New Booking Request 🔔',
    message: `New ${booking.serviceTitle} booking from ${booking.customerName || 'Customer'}. Price: ₨${booking.price}`,
    type: 'new_booking',
    relatedEntityId: booking._id,
  });
}

export async function notifyAdminNewWorker(worker) {
  return notifyAllAdmins({
    title: 'New Worker Registration 👷',
    message: `${worker.fullName} registered as ${worker.primaryServiceCategory} professional`,
    type: 'new_worker',
    relatedEntityId: worker._id,
  });
}

export async function notifyAdminNewCustomer(customer) {
  return notifyAllAdmins({
    title: 'New Customer Signup 👤',
    message: `${customer.name || 'New customer'} created an account`,
    type: 'new_customer',
    relatedEntityId: customer._id,
  });
}

export async function notifyAdminClaimPending(booking, worker) {
  return notifyAllAdmins({
    title: 'Worker Claim Pending Review ⏳',
    message: `${worker.fullName} submitted claim for ${booking.serviceTitle}. Fee: ₨${booking.paymentDetails?.commissionAmount || 0}`,
    type: 'claim_pending',
    relatedEntityId: booking._id,
  });
}

export async function notifyAdminNewReview(review, booking) {
  return notifyAllAdmins({
    title: 'New Review Posted ⭐',
    message: `${review.customerName} rated ${booking.serviceTitle} ${review.rating} stars`,
    type: 'new_review',
    relatedEntityId: review._id,
  });
}

export async function notifyAdminNewAdvertisement(ad) {
  return notifyAllAdmins({
    title: 'New Advertisement 📢',
    message: `New ad posted: ${ad.title}. Review for approval.`,
    type: 'new_advertisement',
    relatedEntityId: ad._id,
  });
}

/**
 * WORKER NOTIFICATIONS
 */
export async function notifyWorkerNewJob(worker, booking) {
  const workerIds = Array.isArray(worker) ? worker.map((w) => w._id) : [worker._id];

  await Promise.all(
    workerIds.map(async (workerId) => {
      const shouldSend = await shouldSendNotification(workerId, 'newJob');
      if (!shouldSend) return;

      await createNotification({
        userId: workerId,
        userRole: 'worker',
        title: 'New Job Available 🎯',
        message: `${booking.serviceTitle} • ₨${booking.price} • ${booking.location}`,
        type: 'new_job',
        relatedEntityId: booking._id,
      });
    }),
  );
}

export async function notifyWorkerClaimApproved(workerId, booking) {
  const shouldSend = await shouldSendNotification(workerId, 'claimApproved');
  if (!shouldSend) return null;

  return createNotification({
    userId: workerId,
    userRole: 'worker',
    title: 'Claim Approved ✅',
    message: `Your claim for ${booking.serviceTitle} was approved! Job assigned.`,
    type: 'claim_approved',
    relatedEntityId: booking._id,
  });
}

export async function notifyWorkerClaimRejected(workerId, booking, reason) {
  const shouldSend = await shouldSendNotification(workerId, 'claimRejected');
  if (!shouldSend) return null;

  return createNotification({
    userId: workerId,
    userRole: 'worker',
    title: 'Claim Rejected ❌',
    message: `Your claim for ${booking.serviceTitle} was rejected. ${reason || 'Please try again.'}`,
    type: 'claim_rejected',
    relatedEntityId: booking._id,
  });
}

/**
 * CUSTOMER NOTIFICATIONS
 */
export async function notifyCustomerBookingReceived(customerId, booking) {
  const shouldSend = await shouldSendNotification(customerId, 'bookingReceived');
  if (!shouldSend) return null;

  return createNotification({
    userId: customerId,
    userRole: 'customer',
    title: 'Booking Received ✓',
    message: `Your ${booking.serviceTitle} request has been received. Wait for a worker to claim.`,
    type: 'booking_received',
    relatedEntityId: booking._id,
  });
}

export async function notifyCustomerWorkerAssigned(customerId, booking, worker) {
  const shouldSend = await shouldSendNotification(customerId, 'workerAssigned');
  if (!shouldSend) return null;

  return createNotification({
    userId: customerId,
    userRole: 'customer',
    title: 'Worker Assigned 👷',
    message: `${worker.fullName} has been assigned to your ${booking.serviceTitle} job.`,
    type: 'worker_assigned',
    relatedEntityId: booking._id,
  });
}

export async function notifyCustomerJobCompleted(customerId, booking) {
  const shouldSend = await shouldSendNotification(customerId, 'jobCompleted');
  if (!shouldSend) return null;

  return createNotification({
    userId: customerId,
    userRole: 'customer',
    title: 'Job Completed ✓✓',
    message: `Your ${booking.serviceTitle} job is completed. Rate your experience!`,
    type: 'job_completed',
    relatedEntityId: booking._id,
  });
}

/**
 * No-ops kept for backward compatibility — the old retry-queue existed to
 * work around the broken room-based delivery. createNotification persists
 * to the DB synchronously and doesn't need a retry queue.
 */
export async function processRetryQueue() {
  return null;
}

export async function getNotificationStatus() {
  return { status: 'ready', queuedRetries: 0 };
}

export default {
  initNotificationService,
  notifyAdminNewBooking,
  notifyAdminNewWorker,
  notifyAdminNewCustomer,
  notifyAdminClaimPending,
  notifyAdminNewReview,
  notifyAdminNewAdvertisement,
  notifyWorkerNewJob,
  notifyWorkerClaimApproved,
  notifyWorkerClaimRejected,
  notifyCustomerBookingReceived,
  notifyCustomerWorkerAssigned,
  notifyCustomerJobCompleted,
  processRetryQueue,
  getNotificationStatus,
  shouldSendNotification,
};
