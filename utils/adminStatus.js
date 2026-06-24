import Admin from '../models/Admin.js';

/** Admin panel display statuses (super admin team view). */
export const ADMIN_STATUS = Object.freeze({
  ONLINE: 'online',
  OFFLINE: 'offline',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
});

export const ADMIN_STATUS_LABELS = Object.freeze({
  [ADMIN_STATUS.ONLINE]: 'Online',
  [ADMIN_STATUS.OFFLINE]: 'Offline',
  [ADMIN_STATUS.ACTIVE]: 'Active',
  [ADMIN_STATUS.INACTIVE]: 'Inactive',
});

/**
 * Resolve a single display status for an admin.
 * - inactive: account disabled by super admin (!Active)
 * - online: active account, currently logged in
 * - offline: active account, logged out before
 * - active: active account, never logged in (default)
 */
export function resolveAdminStatus(admin, isConnected = false) {
  if (!Admin.isAccountActive(admin)) {
    return ADMIN_STATUS.INACTIVE;
  }
  if (isConnected) {
    return ADMIN_STATUS.ONLINE;
  }
  if (admin.lastLogin) {
    return ADMIN_STATUS.OFFLINE;
  }
  return ADMIN_STATUS.ACTIVE;
}

export function formatAdminLastLoginText(lastLogin) {
  if (!lastLogin) return null;

  const now = new Date();
  const loginAt = new Date(lastLogin);
  const diffMs = now - loginAt;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return loginAt.toLocaleDateString();
}

export function buildAdminTeamMember(admin, isConnected = false) {
  const sanitized = Admin.sanitize(admin);
  const status = resolveAdminStatus(admin, isConnected);

  return {
    ...sanitized,
    status,
    isActive: Admin.isAccountActive(admin),
    lastLoginText:
      status === ADMIN_STATUS.OFFLINE
        ? formatAdminLastLoginText(admin.lastLogin)
        : null,
  };
}

export function buildAdminTeamStats(members) {
  return {
    total: members.length,
    online: members.filter((member) => member.status === ADMIN_STATUS.ONLINE).length,
    offline: members.filter((member) => member.status === ADMIN_STATUS.OFFLINE).length,
    active: members.filter((member) => member.status === ADMIN_STATUS.ACTIVE).length,
    inactive: members.filter((member) => member.status === ADMIN_STATUS.INACTIVE).length,
  };
}
