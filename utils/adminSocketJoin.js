import Admin from '../models/Admin.js';
import { verifyToken } from './jwt.js';
import { getAccessTokenFromRequest } from './authCookies.js';
import {
  addAdminSocket,
  emitToAdmin,
  emitToSuperAdmins,
} from './socketManager.js';
import logger from './logger.js';

export function resolveAdminSocketToken(socket, tokenArg) {
  if (typeof tokenArg === 'string' && tokenArg.trim()) {
    return tokenArg.trim();
  }
  const authToken = socket.handshake?.auth?.token;
  if (typeof authToken === 'string' && authToken.trim()) {
    return authToken.trim();
  }
  return getAccessTokenFromRequest({
    headers: { cookie: socket.handshake?.headers?.cookie || '' },
  });
}

/** Join socket to admin rooms; returns true when the admin session is live. */
export async function joinAdminSocketSession(socket, tokenArg) {
  const token = resolveAdminSocketToken(socket, tokenArg);
  if (!token) {
    socket.emit('admin-join-error', { message: 'Admin token required', code: 'NO_TOKEN' });
    return false;
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    logger.warn('Admin socket join failed: invalid token', { error: err.message });
    socket.emit('admin-join-error', { message: 'Invalid token', code: 'INVALID_TOKEN' });
    return false;
  }

  if (decoded.role !== 'admin') {
    socket.emit('admin-join-error', { message: 'Admin access required', code: 'NOT_ADMIN' });
    return false;
  }

  const { isEnvSuperAdminToken, ENV_SUPER_ADMIN_ID } = await import('../services/envSuperAdmin.js');

  if (isEnvSuperAdminToken(decoded)) {
    const adminId = ENV_SUPER_ADMIN_ID;
    const becameOnline = addAdminSocket(adminId, socket.id);

    socket.join('admin-room');
    socket.join(`admin:${adminId}`);
    socket.join('super-admin-room');
    socket.isAdmin = true;
    socket.adminId = adminId;
    socket.adminPanelRole = 'super_admin';

    if (becameOnline) {
      const payload = {
        adminId,
        status: 'online',
        role: 'super_admin',
        timestamp: new Date().toISOString(),
      };
      emitToAdmin('admin-status-updated', payload);
      emitToSuperAdmins('admin-status-updated', payload);
      emitToAdmin('admin-team-updated', { action: 'connected', adminId, timestamp: payload.timestamp });
    }

    socket.emit('admin-joined', { adminId, role: 'super_admin' });
    logger.info('Super admin joined socket (env)', { adminId });
    return true;
  }

  const adminDoc = await Admin.findById(decoded.id).select('isActive role');
  if (!adminDoc) {
    socket.emit('admin-join-error', { message: 'Admin account not found', code: 'ADMIN_NOT_FOUND' });
    return false;
  }

  if (!Admin.isAccountActive(adminDoc)) {
    socket.emit('admin-join-error', {
      message: 'Admin account deactivated',
      code: 'ADMIN_DEACTIVATED',
    });
    return false;
  }

  const adminId = String(decoded.id);
  const becameOnline = addAdminSocket(adminId, socket.id);
  const panelRole = adminDoc.role || decoded.role || 'admin';

  socket.join('admin-room');
  socket.join(`admin:${adminId}`);
  socket.isAdmin = true;
  socket.adminId = adminId;
  socket.adminPanelRole = panelRole;

  if (panelRole === 'super_admin') {
    socket.join('super-admin-room');
  }

  if (becameOnline) {
    const payload = {
      adminId,
      status: 'online',
      role: panelRole,
      timestamp: new Date().toISOString(),
    };
    emitToAdmin('admin-status-updated', payload);
    emitToSuperAdmins('admin-status-updated', payload);
    emitToAdmin('admin-team-updated', {
      action: 'connected',
      adminId,
      timestamp: payload.timestamp,
    });
  }

  socket.emit('admin-joined', { adminId, role: panelRole });
  logger.info('Admin joined socket', { adminId, panelRole });
  return true;
}

export function emitAdminPresenceOffline(socket) {
  if (!socket.isAdmin || !socket.adminId) return;

  const payload = {
    adminId: socket.adminId,
    status: 'offline',
    role: socket.adminPanelRole || 'admin',
    timestamp: new Date().toISOString(),
  };

  emitToAdmin('admin-status-updated', payload);
  emitToSuperAdmins('admin-status-updated', payload);
  emitToAdmin('admin-team-updated', {
    action: 'disconnected',
    adminId: socket.adminId,
    timestamp: payload.timestamp,
  });
}
