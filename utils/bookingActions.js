import {
  ERROR_CODES,
  sendApiError,
  humanizeBookingStatus,
} from "./apiErrors.js";

export const BOOKING_ACTION = {
  CUSTOMER_CANCEL: "customer_cancel",
  CUSTOMER_COMPLETE: "customer_complete",
  WORKER_MARK_DONE: "worker_mark_done",
  WORKER_CLAIM: "worker_claim",
  WORKER_ACCEPT: "worker_accept",
  WORKER_UPDATE_STATUS: "worker_update_status",
  ADMIN_SET_STATUS: "admin_set_status",
};

const ADMIN_TRANSITIONS = {
  pending: ["worker-assigned", "claim-pending", "cancelled", "rejected"],
  "claim-pending": ["worker-assigned", "pending", "cancelled"],
  "worker-assigned": ["completed", "cancelled"],
  completed: [],
  rejected: [],
  cancelled: [],
};

/**
 * Resolve a state-aware error for a booking action, or null if allowed.
 * @returns {{ code, message, status, refreshRecommended, details? } | null}
 */
function blockPayload(fields) {
  return { refreshRecommended: true, ...fields };
}

export function getBookingActionBlock(booking, action, context = {}) {
  if (!booking) {
    return blockPayload({
      code: ERROR_CODES.BOOKING_NOT_FOUND,
      message: "This booking could not be found. It may have been removed.",
      status: 404,
    });
  }

  const status = booking.status;
  const serviceTitle = booking.serviceTitle
    ? `"${booking.serviceTitle}"`
    : "this booking";

  switch (action) {
    case BOOKING_ACTION.CUSTOMER_CANCEL:
      return getCustomerCancelBlock(status, serviceTitle);
    case BOOKING_ACTION.CUSTOMER_COMPLETE:
      return getCustomerCompleteBlock(booking, serviceTitle);
    case BOOKING_ACTION.WORKER_MARK_DONE:
      return getWorkerMarkDoneBlock(booking, serviceTitle);
    case BOOKING_ACTION.WORKER_CLAIM:
    case BOOKING_ACTION.WORKER_ACCEPT:
      return getWorkerClaimBlock(status, serviceTitle, context);
    case BOOKING_ACTION.ADMIN_SET_STATUS:
      return getAdminStatusBlock(status, context.targetStatus);
    default:
      return null;
  }
}

function getCustomerCancelBlock(status, serviceTitle) {
  if (status === "pending") return null;

  const blocks = {
    rejected: blockPayload({
      code: ERROR_CODES.BOOKING_ALREADY_REJECTED,
      message: `The booking ${serviceTitle} was already rejected by the admin. It cannot be cancelled.`,
      status: 409,
    }),
    cancelled: blockPayload({
      code: ERROR_CODES.BOOKING_ALREADY_CANCELLED,
      message: `This booking ${serviceTitle} is already cancelled.`,
      status: 409,
    }),
    completed: blockPayload({
      code: ERROR_CODES.BOOKING_ALREADY_COMPLETED,
      message: `This booking ${serviceTitle} is already completed.`,
      status: 409,
    }),
    approved: blockPayload({
      code: ERROR_CODES.BOOKING_ALREADY_APPROVED,
      message: `The booking ${serviceTitle} has already been approved by the admin. Please refresh your page — it may no longer be cancellable.`,
      status: 409,
    }),
    assigned: blockPayload({
      code: ERROR_CODES.BOOKING_WORKER_ASSIGNED,
      message: `A worker has already been assigned to ${serviceTitle}. You cannot cancel it from here. Contact support if you need help.`,
      status: 409,
    }),
    "in-progress": blockPayload({
      code: ERROR_CODES.BOOKING_IN_PROGRESS,
      message: `Work on ${serviceTitle} is already in progress. Cancellation is not available.`,
      status: 409,
    }),
    "pending-confirmation": blockPayload({
      code: ERROR_CODES.BOOKING_NOT_CANCELLABLE,
      message: `${serviceTitle} is awaiting confirmation and cannot be cancelled online.`,
      status: 409,
    }),
  };

  return (
    blocks[status] ||
    blockPayload({
      code: ERROR_CODES.BOOKING_NOT_CANCELLABLE,
      message: `Cannot cancel ${serviceTitle} while it is ${humanizeBookingStatus(status)}. Please refresh your bookings list.`,
      status: 400,
    })
  );
}

function getCustomerCompleteBlock(booking, serviceTitle) {
  const status = booking.status;
  if (booking.customerMarkedDone) {
    return blockPayload({
      code: ERROR_CODES.BOOKING_ALREADY_COMPLETED,
      message: `You already marked ${serviceTitle} as done. Waiting for the worker to confirm.`,
      status: 409,
    });
  }
  if (status === "worker-assigned") {
    return null;
  }

  const blocks = {
    pending: blockPayload({
      code: ERROR_CODES.BOOKING_NOT_COMPLETABLE,
      message: `${serviceTitle} is not assigned yet. You can mark it done only after a worker is assigned.`,
      status: 400,
    }),
    rejected: blockPayload({
      code: ERROR_CODES.BOOKING_ALREADY_REJECTED,
      message: `${serviceTitle} was rejected by the admin and cannot be marked as done.`,
      status: 409,
    }),
    cancelled: blockPayload({
      code: ERROR_CODES.BOOKING_ALREADY_CANCELLED,
      message: `${serviceTitle} was cancelled and cannot be marked as done.`,
      status: 409,
    }),
    completed: blockPayload({
      code: ERROR_CODES.BOOKING_ALREADY_COMPLETED,
      message: `${serviceTitle} is already marked as completed.`,
      status: 409,
    }),
  };

  return (
    blocks[status] ||
    blockPayload({
      code: ERROR_CODES.BOOKING_NOT_COMPLETABLE,
      message: `Cannot mark ${serviceTitle} as done while it is ${humanizeBookingStatus(status)}. Please refresh your bookings.`,
      status: 400,
    })
  );
}

function getWorkerMarkDoneBlock(booking, serviceTitle) {
  const status = booking.status;
  if (!booking.workerId) {
    return blockPayload({
      code: ERROR_CODES.BOOKING_NOT_COMPLETABLE,
      message: `You are not assigned to ${serviceTitle}.`,
      status: 400,
    });
  }
  if (booking.workerMarkedDone) {
    return blockPayload({
      code: ERROR_CODES.BOOKING_ALREADY_COMPLETED,
      message: `You already marked ${serviceTitle} as done on your side.`,
      status: 409,
    });
  }
  if (status === "worker-assigned") {
    return null;
  }

  const blocks = {
    pending: blockPayload({
      code: ERROR_CODES.BOOKING_NOT_COMPLETABLE,
      message: `${serviceTitle} is not assigned to you yet.`,
      status: 400,
    }),
    completed: blockPayload({
      code: ERROR_CODES.BOOKING_ALREADY_COMPLETED,
      message: `${serviceTitle} is already fully completed.`,
      status: 409,
    }),
    rejected: blockPayload({
      code: ERROR_CODES.BOOKING_ALREADY_REJECTED,
      message: `${serviceTitle} was rejected.`,
      status: 409,
    }),
    cancelled: blockPayload({
      code: ERROR_CODES.BOOKING_ALREADY_CANCELLED,
      message: `${serviceTitle} was cancelled.`,
      status: 409,
    }),
  };

  return (
    blocks[status] ||
    blockPayload({
      code: ERROR_CODES.BOOKING_NOT_COMPLETABLE,
      message: `Cannot mark ${serviceTitle} as done while it is ${humanizeBookingStatus(status)}.`,
      status: 400,
    })
  );
}

function getWorkerClaimBlock(status, serviceTitle, context) {
  if (context.existingWorkerId) {
    return blockPayload({
      code: ERROR_CODES.BOOKING_ALREADY_CLAIMED,
      message: `${serviceTitle} has already been claimed by another worker.`,
      status: 409,
    });
  }

  if (status === "pending") return null;

  const blocks = {
    "worker-assigned": blockPayload({
      code: ERROR_CODES.BOOKING_ALREADY_CLAIMED,
      message: `${serviceTitle} has already been assigned to a worker.`,
      status: 409,
    }),
    rejected: blockPayload({
      code: ERROR_CODES.BOOKING_NOT_AVAILABLE,
      message: `${serviceTitle} was rejected by the admin and is no longer available.`,
      status: 410,
    }),
    cancelled: blockPayload({
      code: ERROR_CODES.BOOKING_NOT_AVAILABLE,
      message: `${serviceTitle} was cancelled and is no longer available.`,
      status: 410,
    }),
    completed: blockPayload({
      code: ERROR_CODES.BOOKING_ALREADY_COMPLETED,
      message: `${serviceTitle} is already completed.`,
      status: 410,
    }),
  };

  return (
    blocks[status] ||
    blockPayload({
      code: ERROR_CODES.BOOKING_NOT_AVAILABLE,
      message: `${serviceTitle} is not available to claim (status: ${humanizeBookingStatus(status)}).`,
      status: 400,
    })
  );
}

function getAdminStatusBlock(currentStatus, targetStatus) {
  if (!targetStatus) return null;
  const allowed = ADMIN_TRANSITIONS[currentStatus] || [];
  if (allowed.includes(targetStatus)) return null;

  const terminal = ["rejected", "cancelled", "completed"].includes(currentStatus);
  const message = terminal
    ? `This booking is already ${humanizeBookingStatus(currentStatus)} and cannot be changed to "${targetStatus}".`
    : `Cannot change booking from ${humanizeBookingStatus(currentStatus)} to "${targetStatus}". Allowed next steps: ${allowed.join(", ") || "none"}.`;

  return blockPayload({
    code: ERROR_CODES.BOOKING_INVALID_TRANSITION,
    message,
    status: 409,
    details: { currentStatus, targetStatus, allowedTransitions: allowed },
  });
}

/**
 * If action is blocked, sends error response and returns true.
 */
export function rejectBookingAction(res, booking, action, context = {}) {
  const block = getBookingActionBlock(booking, action, context);
  if (!block) return false;

  return sendApiError(res, block.code, {
    message: block.message,
    status: block.status,
    refreshRecommended: block.refreshRecommended !== false,
    details: {
      currentStatus: booking?.status,
      ...block.details,
    },
  });
}

export function customerStatusNotification(status, serviceTitle) {
  const title = serviceTitle ? `"${serviceTitle}"` : "Your booking";
  const map = {
    "worker-assigned": `A worker has been assigned to ${title}.`,
    rejected: `${title} was rejected by the admin. Please submit a new request if you still need the service.`,
    cancelled: `${title} has been cancelled.`,
    completed: `${title} has been marked as completed.`,
  };
  return map[status] || `${title} status was updated to ${humanizeBookingStatus(status)}.`;
}

export { ADMIN_TRANSITIONS };
