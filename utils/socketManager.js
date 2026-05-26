import logger from "./logger.js";

let io = null;
let userSockets = new Map();
let adminSockets = new Map();

export function initializeSocketIO(socketIOInstance) {
  io = socketIOInstance;
  logger.info("Socket manager initialized");
}

export function addAdminSocket(adminId, socketId) {
  const normalizedAdminId = String(adminId);
  const existing = adminSockets.get(normalizedAdminId) || new Set();
  existing.add(socketId);
  adminSockets.set(normalizedAdminId, existing);
  return existing.size === 1;
}

export function removeAdminSocket(adminId, socketId) {
  const normalizedAdminId = String(adminId);
  const sockets = adminSockets.get(normalizedAdminId);
  if (!sockets) return false;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    adminSockets.delete(normalizedAdminId);
    return true;
  }
  adminSockets.set(normalizedAdminId, sockets);
  return false;
}

export function isAdminConnected(adminId) {
  return adminSockets.has(String(adminId));
}

export function getSocketIO() {
  if (!io) {
    throw new Error(
      "Socket.IO not initialized. Call initializeSocketIO first.",
    );
  }
  return io;
}

export function getUserSocket(userId) {
  // Always normalize to string for consistent lookups
  return userSockets.get(String(userId));
}

export function isUserConnected(userId) {
  return userSockets.has(String(userId));
}

export function setUserSocket(userId, socketId) {
  // Always normalize to string for consistent storage
  userSockets.set(String(userId), socketId);
}

export function removeUserSocket(userId) {
  // Always normalize to string for consistent removal
  userSockets.delete(String(userId));
}

export function emitToUser(userId, event, data) {
  // Always normalize to string for consistent lookups
  const normalizedUserId = String(userId);
  const socketId = userSockets.get(normalizedUserId);
  if (socketId && io) {
    io.to(socketId).emit(event, data);
    logger.debug("Socket emit to user", {
      userId: normalizedUserId,
      event,
      socketId,
    });
    return true;
  }
  logger.debug("Socket emit failed - user not connected", {
    userId: normalizedUserId,
    event,
  });
  return false;
}

export function emitToAdmin(event, data) {
  if (io) {
    io.to("admin-room").emit(event, data);
    logger.debug("Socket emit to admin room", { event });
    return true;
  }
  return false;
}

/** Personal room for one admin account (all their tabs). */
export function emitToAdminUser(adminId, event, data) {
  if (io && adminId) {
    io.to(`admin:${String(adminId)}`).emit(event, data);
    logger.debug("Socket emit to admin user", {
      adminId: String(adminId),
      event,
    });
    return true;
  }
  return false;
}

/** Only connected super_admin panels. */
export function emitToSuperAdmins(event, data) {
  if (io) {
    io.to("super-admin-room").emit(event, data);
    logger.debug("Socket emit to super-admin room", { event });
    return true;
  }
  return false;
}

export function emitToWorkers(event, data) {
  if (io) {
    io.to("workers-room").emit(event, data);
    logger.debug("Socket emit to workers room", { event });
    return true;
  }
  return false;
}
