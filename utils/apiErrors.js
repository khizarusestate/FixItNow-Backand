/**
 * Central API error codes and responses for consistent client handling.
 */

export const ERROR_CODES = {
  // Auth
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  INVALID_TOKEN: "INVALID_TOKEN",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",

  // Generic
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",

  // Booking — customer
  BOOKING_NOT_FOUND: "BOOKING_NOT_FOUND",
  BOOKING_ALREADY_REJECTED: "BOOKING_ALREADY_REJECTED",
  BOOKING_ALREADY_CANCELLED: "BOOKING_ALREADY_CANCELLED",
  BOOKING_ALREADY_COMPLETED: "BOOKING_ALREADY_COMPLETED",
  BOOKING_ALREADY_APPROVED: "BOOKING_ALREADY_APPROVED",
  BOOKING_WORKER_ASSIGNED: "BOOKING_WORKER_ASSIGNED",
  BOOKING_IN_PROGRESS: "BOOKING_IN_PROGRESS",
  BOOKING_NOT_CANCELLABLE: "BOOKING_NOT_CANCELLABLE",
  BOOKING_NOT_COMPLETABLE: "BOOKING_NOT_COMPLETABLE",
  BOOKING_INVALID_TRANSITION: "BOOKING_INVALID_TRANSITION",

  // Booking — worker
  BOOKING_ALREADY_CLAIMED: "BOOKING_ALREADY_CLAIMED",
  BOOKING_NOT_AVAILABLE: "BOOKING_NOT_AVAILABLE",
  WORKER_NOT_APPROVED: "WORKER_NOT_APPROVED",
  WORKER_UNAVAILABLE: "WORKER_UNAVAILABLE",
  WORKER_MAX_JOBS: "WORKER_MAX_JOBS",

  // User accounts
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  DUPLICATE_EMAIL: "DUPLICATE_EMAIL",
};

export class AppError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function throwAppError(code, message, status = 400, details = {}) {
  throw new AppError(code, message, status, details);
}

/**
 * Send a structured JSON error (always includes `code` for the client).
 */
export function sendApiError(res, code, options = {}) {
  const {
    message,
    status = 400,
    details = {},
    refreshRecommended = false,
  } = options;

  const body = {
    success: false,
    code,
    message: message || defaultMessageForCode(code),
    ...(Object.keys(details).length > 0 || refreshRecommended
      ? {
          details: {
            ...details,
            ...(refreshRecommended ? { refreshRecommended: true } : {}),
          },
        }
      : {}),
  };

  return res.status(status).json(body);
}

function defaultMessageForCode(code) {
  const map = {
    [ERROR_CODES.NOT_FOUND]: "The requested resource was not found.",
    [ERROR_CODES.FORBIDDEN]: "You do not have permission to perform this action.",
    [ERROR_CODES.CONFLICT]: "This action conflicts with the current state.",
  };
  return map[code] || "Something went wrong. Please try again.";
}

const STATUS_LABELS = {
  pending: "pending review",
  approved: "approved",
  rejected: "rejected by the admin",
  cancelled: "cancelled",
  assigned: "assigned to a worker",
  "in-progress": "in progress",
  completed: "completed",
  "pending-confirmation": "awaiting confirmation",
};

export function humanizeBookingStatus(status) {
  return STATUS_LABELS[status] || status;
}
