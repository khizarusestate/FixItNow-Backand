/**
 * BOOKING VISIBILITY RULES
 * Controls what booking information is visible to workers at each status
 * Ensures customer privacy until worker is officially assigned
 */

import { BOOKING_STATUS } from './constants.js';

/**
 * Determines if booking should show full customer info
 * @param {string} status - Current booking status
 * @returns {boolean} - true if full info should be visible
 */
export function shouldShowFullBookingInfo(status) {
  // Full info visible only after admin approval
  return [
    BOOKING_STATUS.WORKER_ASSIGNED,
    BOOKING_STATUS.IN_PROGRESS,
    BOOKING_STATUS.COMPLETED,
  ].includes(status);
}

/**
 * Filters booking data based on visibility rules
 * @param {Object} booking - Full booking document
 * @param {string} status - Booking status
 * @returns {Object} - Filtered booking with visible fields only
 */
export function getVisibleBookingInfo(booking, status) {
  if (!booking) return null;

  const showFull = shouldShowFullBookingInfo(status);

  // Fields always visible
  const base = {
    _id: booking._id,
    serviceTitle: booking.serviceTitle || '',
    serviceCategory: booking.serviceCategory || '',
    date: booking.date,
    time: booking.time || '',
    budget: booking.budget,
    status: booking.status,
    createdAt: booking.createdAt,
    customerName: booking.customerName,
    customerId: booking.customerId,
  };

  if (showFull) {
    // Full info after worker-assigned
    return {
      ...base,
      phone: booking.phone,
      email: booking.email,
      address: booking.address,
      location: booking.location,
      latitude: booking.latitude,
      longitude: booking.longitude,
      description: booking.description,
      isHidden: false,
    };
  }

  // Limited info before assignment
  return {
    ...base,
    // Basic location only (city + area if available)
    city: booking.location?.city || 'N/A',
    area: booking.location?.area || 'N/A',
    // Hide sensitive fields
    phone: undefined,
    email: undefined,
    address: undefined,
    latitude: undefined,
    longitude: undefined,
    description: booking.description, // Description can be shown (helps workers understand job)
    isHidden: true,
  };
}

/**
 * For admin panel - shows all info with visibility flag
 * @param {Object} booking - Full booking document
 * @returns {Object} - Booking with visibility metadata
 */
export function getBookingWithVisibilityFlag(booking) {
  if (!booking) return null;

  return {
    ...booking.toObject ? booking.toObject() : booking,
    _visibility: {
      isHiddenFromWorker: !shouldShowFullBookingInfo(booking.status),
      showFullInfo: shouldShowFullBookingInfo(booking.status),
      visibleFields: shouldShowFullBookingInfo(booking.status)
        ? 'ALL'
        : 'title, date, service, city/area, description, budget',
    },
  };
}
