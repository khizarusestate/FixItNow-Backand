/**
 * FILE: backend/services/notificationService.js
 * 
 * Centralized notification service using notificationManager
 * Handles all notification types for admin/worker/customer
 */

import NotificationManager from '../utils/notificationManager.js';

let notificationManager = null;

export function initNotificationService(io, fcm, db) {
  notificationManager = new NotificationManager(io, fcm, db);
  console.log('✅ Notification Service Initialized');
}

/**
 * ADMIN NOTIFICATIONS
 */
export async function notifyAdminNewBooking(booking) {
  if (!notificationManager) return;
  
  return await notificationManager.sendNotification('admin', {
    title: 'New Booking Request 🔔',
    message: `New ${booking.serviceTitle} booking from ${booking.customerName}. Price: ₨${booking.price}`,
    type: 'new_booking',
    entityId: booking._id,
  });
}

export async function notifyAdminNewWorker(worker) {
  if (!notificationManager) return;
  
  return await notificationManager.sendNotification('admin', {
    title: 'New Worker Registration 👷',
    message: `${worker.fullName} registered as ${worker.primaryServiceCategory} professional`,
    type: 'new_worker',
    entityId: worker._id,
  });
}

export async function notifyAdminNewCustomer(customer) {
  if (!notificationManager) return;
  
  return await notificationManager.sendNotification('admin', {
    title: 'New Customer Signup 👤',
    message: `${customer.name || 'New customer'} created an account`,
    type: 'new_customer',
    entityId: customer._id,
  });
}

export async function notifyAdminClaimPending(booking, worker) {
  if (!notificationManager) return;
  
  return await notificationManager.sendNotification('admin', {
    title: 'Worker Claim Pending Review ⏳',
    message: `${worker.fullName} submitted claim for ${booking.serviceTitle}. Fee: ₨${booking.paymentDetails?.commissionAmount || 0}`,
    type: 'claim_pending',
    entityId: booking._id,
  });
}

export async function notifyAdminNewReview(review, booking) {
  if (!notificationManager) return;
  
  return await notificationManager.sendNotification('admin', {
    title: 'New Review Posted ⭐',
    message: `${review.customerName} rated ${booking.serviceTitle} ${review.rating} stars`,
    type: 'new_review',
    entityId: review._id,
  });
}

export async function notifyAdminNewAdvertisement(ad) {
  if (!notificationManager) return;
  
  return await notificationManager.sendNotification('admin', {
    title: 'New Advertisement 📢',
    message: `New ad posted: ${ad.title}. Review for approval.`,
    type: 'new_advertisement',
    entityId: ad._id,
  });
}

/**
 * WORKER NOTIFICATIONS
 */
export async function notifyWorkerNewJob(worker, booking) {
  if (!notificationManager) return;
  
  const workerIds = Array.isArray(worker) ? worker.map(w => w._id) : [worker._id];
  
  for (const workerId of workerIds) {
    await notificationManager.sendNotification(workerId, {
      title: 'New Job Available 🎯',
      message: `${booking.serviceTitle} • ₨${booking.price} • ${booking.location}`,
      type: 'new_job',
      entityId: booking._id,
    });
  }
}

export async function notifyWorkerClaimApproved(workerId, booking) {
  if (!notificationManager) return;
  
  return await notificationManager.sendNotification(workerId, {
    title: 'Claim Approved ✅',
    message: `Your claim for ${booking.serviceTitle} was approved! Job assigned.`,
    type: 'claim_approved',
    entityId: booking._id,
  });
}

export async function notifyWorkerClaimRejected(workerId, booking, reason) {
  if (!notificationManager) return;
  
  return await notificationManager.sendNotification(workerId, {
    title: 'Claim Rejected ❌',
    message: `Your claim for ${booking.serviceTitle} was rejected. ${reason || 'Please try again.'}`,
    type: 'claim_rejected',
    entityId: booking._id,
  });
}

/**
 * CUSTOMER NOTIFICATIONS
 */
export async function notifyCustomerBookingReceived(customerId, booking) {
  if (!notificationManager) return;
  
  return await notificationManager.sendNotification(customerId, {
    title: 'Booking Received ✓',
    message: `Your ${booking.serviceTitle} request has been received. Wait for a worker to claim.`,
    type: 'booking_received',
    entityId: booking._id,
  });
}

export async function notifyCustomerWorkerAssigned(customerId, booking, worker) {
  if (!notificationManager) return;
  
  return await notificationManager.sendNotification(customerId, {
    title: 'Worker Assigned 👷',
    message: `${worker.fullName} has been assigned to your ${booking.serviceTitle} job.`,
    type: 'worker_assigned',
    entityId: booking._id,
  });
}

export async function notifyCustomerJobCompleted(customerId, booking) {
  if (!notificationManager) return;
  
  return await notificationManager.sendNotification(customerId, {
    title: 'Job Completed ✓✓',
    message: `Your ${booking.serviceTitle} job is completed. Rate your experience!`,
    type: 'job_completed',
    entityId: booking._id,
  });
}

export async function processRetryQueue() {
  if (notificationManager) {
    await notificationManager.processRetryQueue();
  }
}

export async function getNotificationStatus() {
  if (!notificationManager) return { status: 'not_initialized' };
  
  return {
    status: 'ready',
    queuedRetries: notificationManager.retryQueue.length,
  };
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
};
