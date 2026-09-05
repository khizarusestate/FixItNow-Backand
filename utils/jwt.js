import jwt from "jsonwebtoken";
import crypto from "crypto";
import RefreshToken from "../models/RefreshToken.js";
import Worker from "../workerSchema.js";
import env from "./env.js";
import logger from "./logger.js";
import { JWT_CONFIG } from "./constants.js";

const JWT_SECRET = env.JWT_SECRET;

if (JWT_SECRET.length < 32) {
  if (env.NODE_ENV === "production") {
    logger.error("JWT_SECRET is too short. Must be at least 32 characters for production security.");
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  } else {
    logger.warn("JWT_SECRET is too short for production security. Using a weak secret in development.");
  }
}

export const createAccessToken = (payload) => {
  if (!payload || typeof payload !== "object") throw new Error("Invalid payload for access token");
  if (!payload.id || !payload.role) throw new Error("Payload must contain id and role");
  const tokenPayload = {
    id: payload.id,
    role: payload.role,
    email: payload.email || null,
    iat: Math.floor(Date.now() / 1000),
  };
  return jwt.sign(tokenPayload, JWT_SECRET, {
    expiresIn: `${env.ACCESS_TOKEN_EXPIRY_MINUTES}m`,
    jwtid: crypto.randomUUID(),
    algorithm: "HS256",
  });
};

export const createToken = (payload) => {
  if (!payload || typeof payload !== "object") throw new Error("Invalid payload for token");
  if (env.USE_REFRESH_TOKENS) return createAccessToken(payload);
  const tokenPayload = {
    id: payload.id,
    role: payload.role,
    email: payload.email || null,
    iat: Math.floor(Date.now() / 1000),
  };
  return jwt.sign(tokenPayload, JWT_SECRET, {
    expiresIn: `${JWT_CONFIG.LEGACY_TOKEN_DAYS}d`,
    jwtid: crypto.randomUUID(),
    algorithm: "HS256",
  });
};

export const createRefreshToken = async (userId, userRole, req = null, expiryDays = null) => {
  if (!userId || !userRole) throw new Error("userId and userRole are required for refresh token");
  const token = RefreshToken.generateToken();
  const expiresAt = new Date();
  const days = typeof expiryDays === "number" && expiryDays > 0 ? expiryDays : env.REFRESH_TOKEN_EXPIRY_DAYS;
  expiresAt.setDate(expiresAt.getDate() + days);
  await RefreshToken.create({
    token,
    userId,
    userRole,
    expiresAt,
    ipAddress: req?.ip || "",
    userAgent: req?.headers["user-agent"] || "",
  });
  return token;
};

export const verifyRefreshToken = async (token) => {
  if (!token || typeof token !== "string") throw new Error("Invalid refresh token format");
  const record = await RefreshToken.findOne({ token, isRevoked: false });
  if (!record) throw new Error("Invalid or revoked refresh token");
  if (record.expiresAt < new Date()) throw new Error("Refresh token expired");

  // A refresh token must not restore access after a worker is suspended,
  // disabled, rejected, deleted, or otherwise no longer approved/active.
  if (record.userRole === "worker") {
    const worker = await Worker.findById(record.userId).select(
      "isDeleted isDisabled emailVerified status approvalStatus",
    );
    const canRefresh = Boolean(
      worker &&
        worker.isDeleted !== true &&
        worker.isDisabled !== true &&
        worker.emailVerified === true &&
        worker.status === "active" &&
        worker.approvalStatus === "approved",
    );

    if (!canRefresh) {
      await RefreshToken.updateOne(
        { _id: record._id, isRevoked: false },
        { isRevoked: true, revokedAt: new Date() },
      );
      throw new Error("Worker account is no longer eligible for token refresh");
    }
  }

  return record;
};

export const revokeRefreshToken = async (token) => {
  if (!token) throw new Error("Token is required for revocation");
  const result = await RefreshToken.updateOne(
    { token },
    { isRevoked: true, revokedAt: new Date() },
  );
  if (result.matchedCount === 0) logger.warn("Attempted to revoke non-existent refresh token");
};

export const revokeAllUserRefreshTokens = async (userId, userRole) => {
  if (!userId || !userRole) throw new Error("userId and userRole are required");
  const result = await RefreshToken.updateMany(
    { userId, userRole, isRevoked: false },
    { isRevoked: true, revokedAt: new Date() },
  );
  logger.info(`Revoked ${result.modifiedCount} refresh tokens for user`, { userId, userRole });
};

export const verifyToken = (token) => {
  if (!token || typeof token !== "string") throw new Error("Invalid token format");
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    if (!decoded.id || !decoded.role) throw new Error("Invalid token structure");
    return decoded;
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      const normalized = new Error("Token expired");
      normalized.name = "TokenExpiredError";
      throw normalized;
    }
    if (error.name === "JsonWebTokenError") {
      const normalized = new Error("Invalid token");
      normalized.name = "JsonWebTokenError";
      throw normalized;
    }
    if (error.name === "NotBeforeError") {
      const normalized = new Error("Token not yet valid");
      normalized.name = "NotBeforeError";
      throw normalized;
    }
    throw error;
  }
};

export const decodeToken = (token) => {
  if (!token || typeof token !== "string") return null;
  try {
    return jwt.decode(token);
  } catch (error) {
    logger.warn("Failed to decode token", { error: error.message });
    return null;
  }
};

export const isTokenExpired = (token) => {
  if (!token || typeof token !== "string") return true;
  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.exp) return true;
    return decoded.exp < Math.floor(Date.now() / 1000);
  } catch {
    return true;
  }
};

export const validateTokenStructure = (decoded) => {
  if (!decoded || typeof decoded !== "object") return false;
  const requiredFields = ["id", "role", "iat", "exp"];
  for (const field of requiredFields) if (!decoded[field]) return false;
  return true;
};

export const getTokenExpiration = (token) => {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) return null;
  return new Date(decoded.exp * 1000);
};

export const getTimeUntilExpiration = (token) => {
  const expiration = getTokenExpiration(token);
  if (!expiration) return 0;
  return Math.max(0, expiration.getTime() - Date.now());
};
