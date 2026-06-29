import { BOOKING_STATUS } from "./constants.js";

/** Legacy DB values mapped to the simplified flow. */
const LEGACY_TO_CANONICAL = {
  pending: BOOKING_STATUS.PENDING,
  approved: BOOKING_STATUS.PENDING,
  "pending-confirmation": BOOKING_STATUS.PENDING,
  assigned: BOOKING_STATUS.WORKER_ASSIGNED,
};

export function canonicalBookingStatus(status) {
  if (!status) return BOOKING_STATUS.PENDING;
  return LEGACY_TO_CANONICAL[status] || status;
}

export function isOpenForWorkers(status) {
  const s = canonicalBookingStatus(status);
  return s === BOOKING_STATUS.PENDING;
}

export function workerCanSeeFullCustomerDetails(status) {
  const s = canonicalBookingStatus(status);
  return [
    BOOKING_STATUS.WORKER_ASSIGNED,
    BOOKING_STATUS.IN_PROGRESS,
    BOOKING_STATUS.COMPLETED,
    "assigned",
  ].includes(s);
}
