// Centralized constants and enums for FixItNow Backend

// ─── User Roles ──────────────────────────────────────────────────────────────────
export const ROLES = {
  ADMIN: 'admin',
  CUSTOMER: 'customer',
  WORKER: 'worker'
}

/** Roles inside the admin panel (Admin collection), not JWT auth role. */
export const ADMIN_PANEL_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
}

export const ROLE_VALUES = Object.values(ROLES);

// ─── Worker Statuses ─────────────────────────────────────────────────────────────
export const WORKER_STATUS = {
  NOT_APPROVED: 'not_approved',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
}

export const WORKER_STATUS_VALUES = Object.values(WORKER_STATUS);

// ─── Booking Statuses ────────────────────────────────────────────────────────────
export const BOOKING_STATUS = {
  PENDING: 'pending',
  CLAIM_PENDING: 'claim-pending',
  WORKER_ASSIGNED: 'worker-assigned',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
}

export const BOOKING_STATUS_VALUES = Object.values(BOOKING_STATUS);

// ─── Customer Statuses ────────────────────────────────────────────────────────────
export const CUSTOMER_STATUS = {
  NOT_APPROVED: 'not_approved',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ACTIVE: 'active',
  INACTIVE: 'inactive'
}

export const CUSTOMER_STATUS_VALUES = Object.values(CUSTOMER_STATUS);

// ─── Payment Methods ─────────────────────────────────────────────────────────────
export const PAYMENT_METHODS = {
  EASYPAISA: 'easypaisa',
  JAZZCASH: 'jazzcash',
  HAND_TO_HAND: 'hand-to-hand',
  PAY_AFTER_WORK: 'pay-after-work',
}

export const PAYMENT_METHOD_VALUES = Object.values(PAYMENT_METHODS);

// ─── Socket.IO Events ────────────────────────────────────────────────────────────
export const SOCKET_EVENTS = {
  // Room joins
  JOIN_ADMIN: 'join-admin',
  JOIN_USER: 'join-user',
  
  // Admin events
  ADMIN_NOTIFICATION: 'notification',
  ADMIN_REFRESH: 'refresh',
  
  // Worker events
  NEW_JOB: 'new-job',
  JOB_ASSIGNED: 'job-assigned',
  PROFILE_UPDATED: 'profile-updated',
  ACCOUNT_APPROVED: 'account-approved',
  ACCOUNT_REJECTED: 'account-rejected',
  ACCOUNT_DELETED: 'account-deleted',
  
  // Customer events
  BOOKING_STATUS_UPDATE: 'booking-status-update',
  
  // Error event
  ERROR: 'error'
}

// ─── Socket Rooms ────────────────────────────────────────────────────────────────
export const SOCKET_ROOMS = {
  ADMIN_ROOM: 'admin-room',
  WORKERS_ROOM: 'workers-room'
}

// ─── Validation Rules ──────────────────────────────────────────────────────────────
export const VALIDATION = {
  PASSWORD_MIN_LENGTH: 6,
  PASSWORD_MAX_LENGTH: 128,
  PIN_LENGTH: 8,
  EMAIL_MAX_LENGTH: 254,
  PHONE_MAX_LENGTH: 20,
  CNIC_LENGTH: 13,
  NAME_MIN_LENGTH: 2,
  NAME_MAX_LENGTH: 100,
  ADDRESS_MAX_LENGTH: 500,
  NOTES_MAX_LENGTH: 1000,
  EXPERIENCE_MAX_LENGTH: 1000
}

// ─── JWT Configuration ────────────────────────────────────────────────────────────
export const JWT_CONFIG = {
  DEFAULT_ACCESS_TOKEN_MINUTES: 15,
  DEFAULT_REFRESH_TOKEN_DAYS: 7,
  LEGACY_TOKEN_DAYS: 7
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────────
export const RATE_LIMITS = {
  AUTH_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  AUTH_MAX_REQUESTS: 50,
  API_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  // Read-heavy SPA (home loads several public endpoints); keep headroom for prod.
  API_MAX_REQUESTS: 2000,
  STRICT_WINDOW_MS: 60 * 60 * 1000, // 1 hour
  STRICT_MAX_REQUESTS: 5
}

// ─── File Upload Limits ─────────────────────────────────────────────────────────
export const FILE_UPLOAD = {
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  ALLOWED_MIME_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
}

// ─── HTTP Status Codes ───────────────────────────────────────────────────────────
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
}

// ─── Pagination Defaults ─────────────────────────────────────────────────────────
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 50,
  MAX_LIMIT: 100
}

// ─── Audit Actions ────────────────────────────────────────────────────────────────
export const AUDIT_ACTIONS = {
  // Admin actions
  ADMIN_LOGIN: 'admin_login',
  ADMIN_CREATE: 'admin_create',
  ADMIN_UPDATE: 'admin_update',
  ADMIN_DISABLE: 'admin_disable',
  ADMIN_ENABLE: 'admin_enable',
  ADMIN_DELETE: 'admin_delete',
  WORKER_APPROVE: 'worker_approve',
  WORKER_REJECT: 'worker_reject',
  WORKER_STATUS_CHANGE: 'worker_status_change',
  WORKER_DELETE: 'worker_delete',
  CUSTOMER_STATUS_CHANGE: 'customer_status_change',
  CUSTOMER_DELETE: 'customer_delete',
  CUSTOMER_UPDATE: 'customer_update',
  BOOKING_ASSIGN: 'booking_assign',
  BOOKING_STATUS_CHANGE: 'booking_status_change',
  
  // User actions
  CUSTOMER_REGISTER: 'customer_register',
  CUSTOMER_LOGIN: 'customer_login',
  CUSTOMER_DELETE_ACCOUNT: 'customer_delete_account',
  WORKER_REGISTER: 'worker_register',
  WORKER_LOGIN: 'worker_login',
  WORKER_DELETE_ACCOUNT: 'worker_delete_account'
}

// ─── Audit Target Types ───────────────────────────────────────────────────────────
export const AUDIT_TARGET_TYPES = {
  ADMIN: 'admin',
  CUSTOMER: 'customer',
  WORKER: 'worker',
  BOOKING: 'booking',
  SERVICE: 'service',
  REVIEW: 'review'
}
