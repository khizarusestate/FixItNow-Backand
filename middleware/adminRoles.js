/** Admin panel permission levels (stored on Admin document, also in JWT as adminRole). */
export const ADMIN_PANEL_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
};

export const ADMIN_PANEL_ROLE_VALUES = Object.values(ADMIN_PANEL_ROLES);

export const isSuperAdmin = (adminRole) => adminRole === ADMIN_PANEL_ROLES.SUPER_ADMIN;

export function readSuperAdminEnvEmail() {
  return (process.env.SUPER_ADMIN_EMAIL || '').toLowerCase().trim();
}

/** True when this email is the env-configured super admin (Super Admin login portal). */
export function isEnvSuperAdminEmail(email) {
  const envEmail = readSuperAdminEnvEmail();
  const normalized = String(email || '').toLowerCase().trim();
  return Boolean(envEmail && normalized && normalized === envEmail);
}

/** Super admin panel role in DB, or env email on Super Admin login. */
export function shouldTreatAsSuperAdmin({ role, email, loginAs } = {}) {
  if (isSuperAdmin(role)) return true;
  if (loginAs === ADMIN_PANEL_ROLES.SUPER_ADMIN && isEnvSuperAdminEmail(email)) {
    return true;
  }
  return false;
}
