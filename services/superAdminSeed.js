import Admin from '../models/Admin.js';
import { ADMIN_PANEL_ROLES } from '../middleware/adminRoles.js';
import logger from '../utils/logger.js';

function readSuperAdminEnv() {
  return {
    email: (process.env.SUPER_ADMIN_EMAIL || '').toLowerCase().trim(),
    name: process.env.SUPER_ADMIN_NAME || 'Super Admin',
    phone: process.env.SUPER_ADMIN_PHONE || '',
    pin: String(process.env.SUPER_ADMIN_PIN || ''),
  };
}

/**
 * Ensures exactly one super admin exists (credentials from .env only).
 * Regular admins are created via the panel, not .env.
 */
export async function ensureSuperAdminFromEnv() {
  const { email, name, phone, pin } = readSuperAdminEnv();

  if (!email) {
    logger.info('SUPER_ADMIN_EMAIL not set — skipping super admin bootstrap');
    return null;
  }

  if (!pin || String(pin).length !== 8) {
    logger.warn('SUPER_ADMIN_PIN must be 8 digits — skipping super admin bootstrap');
    return null;
  }

  let superAdmin = await Admin.findOne({ role: ADMIN_PANEL_ROLES.SUPER_ADMIN }).select('+pin');

  if (superAdmin) {
    if (superAdmin.email !== email) {
      logger.warn('Super admin already exists with a different email — not overwriting', {
        existing: superAdmin.email,
        envEmail: email,
      });
    }
    return superAdmin;
  }

  await Admin.deleteMany({ role: ADMIN_PANEL_ROLES.SUPER_ADMIN });

  superAdmin = await Admin.create({
    name,
    phone,
    email,
    pin,
    role: ADMIN_PANEL_ROLES.SUPER_ADMIN,
    isActive: true,
  });

  logger.info('Super admin created from environment', { email });
  return superAdmin;
}

/** Wipes all admins and creates only the env super admin (CLI / reset script). */
export async function resetToSuperAdminOnly() {
  const deleted = await Admin.deleteMany({});
  logger.info(`Removed ${deleted.deletedCount} admin account(s)`);
  return ensureSuperAdminFromEnv();
}
