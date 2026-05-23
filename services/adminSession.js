import Admin from '../models/Admin.js';
import RefreshToken from '../models/RefreshToken.js';
import { emitToAdminUser, emitToSuperAdmins } from '../utils/socketManager.js';
import logger from '../utils/logger.js';

/** Revoke all refresh tokens and notify connected clients to logout immediately. */
export async function forceLogoutAdmin(adminId, reason = 'Your session has ended.') {
  const id = String(adminId);
  await RefreshToken.updateMany(
    { userId: adminId, userRole: 'admin', isRevoked: false },
    { isRevoked: true, revokedAt: new Date() },
  );

  emitToAdminUser(id, 'admin-force-logout', {
    adminId: id,
    reason,
    timestamp: new Date().toISOString(),
  });

  logger.info('Admin force logout', { adminId: id, reason });
}

/** Notify all super admins that the team list changed. */
export function notifyAdminTeamUpdated(action, admin = null) {
  emitToSuperAdmins('admin-team-updated', {
    action,
    admin: admin ? Admin.sanitize(admin) : null,
    timestamp: new Date().toISOString(),
  });
}
