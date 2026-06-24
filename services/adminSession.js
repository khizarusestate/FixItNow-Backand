import Admin from '../models/Admin.js';
import RefreshToken from '../models/RefreshToken.js';
import { emitToAdminUser, emitToAdmin, emitToSuperAdmins } from '../utils/socketManager.js';
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

/** Notify admin panels that the team list changed. */
export function notifyAdminTeamUpdated(action, admin = null) {
  const payload = {
    action,
    admin: admin ? Admin.sanitize(admin) : null,
    timestamp: new Date().toISOString(),
  };
  emitToAdmin('admin-team-updated', payload);
  emitToSuperAdmins('admin-team-updated', payload);
}
