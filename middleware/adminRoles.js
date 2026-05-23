/** Admin panel permission levels (stored on Admin document, also in JWT as adminRole). */
export const ADMIN_PANEL_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
};

export const ADMIN_PANEL_ROLE_VALUES = Object.values(ADMIN_PANEL_ROLES);

export const isSuperAdmin = (adminRole) => adminRole === ADMIN_PANEL_ROLES.SUPER_ADMIN;
