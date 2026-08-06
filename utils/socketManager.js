import logger from "./logger.js";

let io = null;
let userSockets = new Map(); // userId -> Set<socketId>
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

/** Returns one connected socket id for this user, if any (arbitrary tab if several). */
export function getUserSocket(userId) {
  const sockets = userSockets.get(String(userId));
  if (!sockets || sockets.size === 0) return undefined;
  return sockets.values().next().value;
}

export function isUserConnected(userId) {
  const sockets = userSockets.get(String(userId));
  return Boolean(sockets && sockets.size > 0);
}

/** Returns true if this is the user's first connected tab/device (0 -> 1). */
export function setUserSocket(userId, socketId) {
  const normalizedUserId = String(userId);
  const existing = userSockets.get(normalizedUserId) || new Set();
  const becameOnline = existing.size === 0;
  existing.add(socketId);
  userSockets.set(normalizedUserId, existing);
  return becameOnline;
}

/** Returns true if this was the user's last connected tab/device (1 -> 0). */
export function removeUserSocket(userId, socketId) {
  const normalizedUserId = String(userId);
  const sockets = userSockets.get(normalizedUserId);
  if (!sockets) return false;
  if (socketId) sockets.delete(socketId);
  if (sockets.size === 0) {
    userSockets.delete(normalizedUserId);
    return true;
  }
  userSockets.set(normalizedUserId, sockets);
  return false;
}

export function emitToUser(userId, event, data) {
  // Broadcasts to every tab/device this user has open (Socket.IO room),
  // not just whichever one connected last.
  const normalizedUserId = String(userId);
  if (io && isUserConnected(normalizedUserId)) {
    io.to(`user:${normalizedUserId}`).emit(event, data);
    logger.debug("Socket emit to user", {
      userId: normalizedUserId,
      event,
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
