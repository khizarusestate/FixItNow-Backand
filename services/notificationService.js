import { createNotification, notifyAllAdmins } from '../utils/createNotification.js';

export function initNotificationService() { console.log('✅ Notification Service Initialized'); }

export function notifyAdminNewBooking(booking) { return notifyAllAdmins({ title: 'New Booking Request 🔔', message: `New ${booking.serviceTitle} booking from ${booking.customerName || 'Customer'}. Price: ₨${booking.price}`, type: 'new_booking', relatedEntityId: booking._id }); }
export function notifyAdminNewWorker(worker) { return notifyAllAdmins({ title: 'New Worker Registration 👷', message: `${worker.fullName} registered as ${worker.primaryServiceCategory || 'worker'}.`, type: 'new_worker', relatedEntityId: worker._id }); }
export function notifyAdminNewCustomer(customer) { return notifyAllAdmins({ title: 'New Customer Signup 👤', message: `${customer.fullName || customer.name || 'New customer'} created an account.`, type: 'new_customer', relatedEntityId: customer._id }); }
export function notifyAdminClaimPending(booking, worker) { return notifyAllAdmins({ title: 'Worker Claim Pending Review ⏳', message: `${worker.fullName} submitted a claim for ${booking.serviceTitle}.`, type: 'claim_pending', relatedEntityId: booking._id }); }
export function notifyAdminNewReview(review, booking) { return notifyAllAdmins({ title: 'New Review Posted ⭐', message: `A customer rated ${booking.serviceTitle} ${review.rating} stars.`, type: 'new_review', relatedEntityId: review._id }); }
export function notifyAdminNewAdvertisement(ad) { return notifyAllAdmins({ title: 'New Advertisement 📢', message: `New advertisement posted: ${ad.title || 'Advertisement'}.`, type: 'new_advertisement', relatedEntityId: ad._id }); }
export function notifyAdminSupportChat(conversationId, role = 'user', preview = '') { return notifyAllAdmins({ title: 'New Support Message 💬', message: `New support message from ${role}. ${preview}`.trim(), type: 'support_chat', relatedEntityId: conversationId }); }

export async function notifyWorkerNewJob(workers, booking) {
  const list = Array.isArray(workers) ? workers : [workers];
  return Promise.all(list.filter(Boolean).map((worker) => createNotification({ userId: worker._id, userRole: 'worker', title: 'New Job Available 🎯', message: `${booking.serviceTitle} • ₨${booking.price} • ${booking.location || booking.address || ''}`, type: 'new_job', relatedEntityId: booking._id })));
}
export function notifyWorkerClaimApproved(workerId, booking) { return createNotification({ userId: workerId, userRole: 'worker', title: 'Claim Approved ✅', message: `Your claim for ${booking.serviceTitle} was approved. The job is assigned to you.`, type: 'claim_approved', relatedEntityId: booking._id }); }
export function notifyWorkerClaimRejected(workerId, booking, reason) { return createNotification({ userId: workerId, userRole: 'worker', title: 'Claim Rejected ❌', message: `Your claim for ${booking.serviceTitle} was rejected. ${reason || 'Please try another job.'}`, type: 'claim_rejected', relatedEntityId: booking._id }); }
export function notifyWorkerCustomerCompleted(workerId, booking) { return createNotification({ userId: workerId, userRole: 'worker', title: 'Customer Marked Job Done ✓', message: `The customer marked ${booking.serviceTitle} as done. Open the job to complete your side.`, type: 'customer_completed', relatedEntityId: booking._id }); }

export function notifyCustomerBookingReceived(customerId, booking) { return createNotification({ userId: customerId, userRole: 'customer', title: 'Booking Received ✓', message: `We received your ${booking.serviceTitle} request. Workers can claim it now.`, type: 'booking_received', relatedEntityId: booking._id }); }
export function notifyCustomerWorkerAssigned(customerId, booking, worker) { return createNotification({ userId: customerId, userRole: 'customer', title: 'Worker Assigned 👷', message: `${worker.fullName} has been assigned to your ${booking.serviceTitle} job.`, type: 'worker_assigned', relatedEntityId: booking._id }); }
export function notifyCustomerWorkerOnTheWay(customerId, booking) { return createNotification({ userId: customerId, userRole: 'customer', title: 'Worker On The Way 🚗', message: `Your worker is on the way to your ${booking.serviceTitle} job.`, type: 'worker_on_the_way', relatedEntityId: booking._id }); }
export function notifyCustomerJobCompleted(customerId, booking) { return createNotification({ userId: customerId, userRole: 'customer', title: 'Job Completed ✓✓', message: `Your ${booking.serviceTitle} job is completed.`, type: 'worker_completed', relatedEntityId: booking._id }); }

export async function processRetryQueue() { return null; }
export async function getNotificationStatus() { return { status: 'ready', queuedRetries: 0 }; }

export default { initNotificationService, notifyAdminNewBooking, notifyAdminNewWorker, notifyAdminNewCustomer, notifyAdminClaimPending, notifyAdminNewReview, notifyAdminNewAdvertisement, notifyAdminSupportChat, notifyWorkerNewJob, notifyWorkerClaimApproved, notifyWorkerClaimRejected, notifyWorkerCustomerCompleted, notifyCustomerBookingReceived, notifyCustomerWorkerAssigned, notifyCustomerWorkerOnTheWay, notifyCustomerJobCompleted, processRetryQueue, getNotificationStatus };
