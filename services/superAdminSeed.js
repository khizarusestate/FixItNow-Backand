/**
 * @deprecated Super admin credentials are env-only (see services/envSuperAdmin.js).
 * Kept for CLI scripts that import resetToSuperAdminOnly.
 */
import { cleanupLegacyMongoSuperAdmins } from './envSuperAdmin.js';

export async function ensureSuperAdminFromEnv() {
  await cleanupLegacyMongoSuperAdmins();
  return null;
}

export async function resetToSuperAdminOnly() {
  return cleanupLegacyMongoSuperAdmins();
}
