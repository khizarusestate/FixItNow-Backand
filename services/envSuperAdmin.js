import env from '../utils/env.js';
import { ADMIN_PANEL_ROLES } from '../middleware/adminRoles.js';
import { VALIDATION } from '../utils/constants.js';
import Admin from '../models/Admin.js';
import logger from '../utils/logger.js';

/** Stable JWT / refresh-token user id — not stored in MongoDB. */
export const ENV_SUPER_ADMIN_ID = '000000000000000000000001';

export function readEnvSuperAdminConfig() {
  return {
    email: (env.SUPER_ADMIN_EMAIL || '').toLowerCase().trim(),
    name: env.SUPER_ADMIN_NAME || 'Super Admin',
    phone: env.SUPER_ADMIN_PHONE || '',
    pin: String(env.SUPER_ADMIN_PIN || ''),
  };
}

export function isEnvSuperAdminConfigured() {
  const { email, pin } = readEnvSuperAdminConfig();
  return Boolean(email && pin.length === VALIDATION.PIN_LENGTH);
}

export function validateEnvSuperAdminCredentials(email, pin) {
  if (!isEnvSuperAdminConfigured()) {
    return { ok: false, code: 'SUPER_ADMIN_NOT_CONFIGURED' };
  }
  const config = readEnvSuperAdminConfig();
  const normalizedEmail = String(email || '').toLowerCase().trim();
  if (normalizedEmail !== config.email) {
    return { ok: false, code: 'ADMIN_NOT_FOUND' };
  }
  if (String(pin) !== config.pin) {
    return { ok: false, code: 'INVALID_PIN' };
  }
  return { ok: true, config };
}

export function isEnvSuperAdminToken(decoded) {
  if (!decoded || decoded.role !== 'admin') return false;
  return (
    String(decoded.id) === ENV_SUPER_ADMIN_ID &&
    decoded.adminRole === ADMIN_PANEL_ROLES.SUPER_ADMIN
  );
}

export function getEnvSuperAdminProfile() {
  const config = readEnvSuperAdminConfig();
  const now = new Date().toISOString();
  return {
    id: ENV_SUPER_ADMIN_ID,
    _id: ENV_SUPER_ADMIN_ID,
    name: config.name,
    fullName: config.name,
    email: config.email,
    phone: config.phone || '',
    address: '',
    role: ADMIN_PANEL_ROLES.SUPER_ADMIN,
    isActive: true,
    devicePushEnabled: true,
    profilePicture: '',
    createdAt: now,
    updatedAt: now,
    lastLogin: now,
  };
}

/** Super admin lives in env only — remove legacy Mongo super_admin rows. */
export async function cleanupLegacyMongoSuperAdmins() {
  const result = await Admin.deleteMany({ role: ADMIN_PANEL_ROLES.SUPER_ADMIN });
  if (result.deletedCount > 0) {
    logger.info('Removed legacy super admin document(s) from MongoDB (credentials are env-only)', {
      count: result.deletedCount,
    });
  }
}
