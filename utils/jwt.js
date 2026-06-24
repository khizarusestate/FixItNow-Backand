import jwt from "jsonwebtoken";
import crypto from "crypto";
import RefreshToken from "../models/RefreshToken.js";
import env from "./env.js";
import logger from "./logger.js";
import { JWT_CONFIG } from "./constants.js";

const JWT_SECRET = env.JWT_SECRET;

// Validate JWT_SECRET on startup
if (JWT_SECRET.length < 32) {
  if (env.NODE_ENV === "production") {
    logger.error(
      "JWT_SECRET is too short. Must be at least 32 characters for production security.",
    );
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  } else {
    logger.warn(
      "JWT_SECRET is too short for production security. Using a weak secret in development.",
    );
  }
}

// ─── Access Token (short-lived) ───────────────────────────────────────────────

export const createAccessToken = (payload) => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload for access token");
  }

  // Ensure required fields are present
  if (!payload.id || !payload.role) {
    throw new Error("Payload must contain id and role");
  }

  const tokenPayload = {
    id: payload.id,
    role: payload.role,
    email: payload.email || null,
    iat: Math.floor(Date.now() / 1000),
  };
  if (payload.adminRole) {
    tokenPayload.adminRole = payload.adminRole;
  }

  return jwt.sign(tokenPayload, JWT_SECRET, {
    expiresIn: `${env.ACCESS_TOKEN_EXPIRY_MINUTES}m`,
    jwtid: crypto.randomUUID(),
    algorithm: "HS256",
  });
};

// ─── Legacy Token (backward compatible, 7 days) ─────────────────────────────────

export const createToken = (payload) => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload for token");
  }

  // If refresh tokens are enabled, return a short-lived access token
  // Otherwise return the legacy long-lived token for backward compatibility
  if (env.USE_REFRESH_TOKENS) {
    return createAccessToken(payload);
  }

  const tokenPayload = {
    id: payload.id,
    role: payload.role,
    email: payload.email || null,
    iat: Math.floor(Date.now() / 1000),
  };
  if (payload.adminRole) {
    tokenPayload.adminRole = payload.adminRole;
  }

  return jwt.sign(tokenPayload, JWT_SECRET, {
    expiresIn: `${JWT_CONFIG.LEGACY_TOKEN_DAYS}d`,
    jwtid: crypto.randomUUID(),
    algorithm: "HS256",
  });
};

// ─── Refresh Token (long-lived, stored in DB) ──────────────────────────────────

export const createRefreshToken = async (
  userId,
  userRole,
  req = null,
  expiryDays = null,
) => {
  if (!userId || !userRole) {
    throw new Error("userId and userRole are required for refresh token");
  }

  const token = RefreshToken.generateToken();
  const expiresAt = new Date();
  const days =
    typeof expiryDays === "number" && expiryDays > 0
      ? expiryDays
      : env.REFRESH_TOKEN_EXPIRY_DAYS;
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
  if (!token || typeof token !== "string") {
    throw new Error("Invalid refresh token format");
  }

  const record = await RefreshToken.findOne({ token, isRevoked: false });
  if (!record) {
    throw new Error("Invalid or revoked refresh token");
  }
  if (record.expiresAt < new Date()) {
    throw new Error("Refresh token expired");
  }
  return record;
};

export const revokeRefreshToken = async (token) => {
  if (!token) {
    throw new Error("Token is required for revocation");
  }

  const result = await RefreshToken.updateOne(
    { token },
    { isRevoked: true, revokedAt: new Date() },
  );

  if (result.matchedCount === 0) {
    logger.warn("Attempted to revoke non-existent refresh token");
  }
};

export const revokeAllUserRefreshTokens = async (userId, userRole) => {
  if (!userId || !userRole) {
    throw new Error("userId and userRole are required");
  }

  const result = await RefreshToken.updateMany(
    { userId, userRole, isRevoked: false },
    { isRevoked: true, revokedAt: new Date() },
  );

  logger.info(`Revoked ${result.modifiedCount} refresh tokens for user`, {
    userId,
    userRole,
  });
};

// ─── Verification ─────────────────────────────────────────────────────────────

export const verifyToken = (token) => {
  if (!token || typeof token !== "string") {
    throw new Error("Invalid token format");
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    });

    // Validate decoded token structure
    if (!decoded.id || !decoded.role) {
      throw new Error("Invalid token structure");
    }

    return decoded;
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new Error("Token expired");
    } else if (error.name === "JsonWebTokenError") {
      throw new Error("Invalid token");
    } else if (error.name === "NotBeforeError") {
      throw new Error("Token not yet valid");
    }
    throw error;
  }
};

export const decodeToken = (token) => {
  if (!token || typeof token !== "string") {
    return null;
  }

  try {
    return jwt.decode(token);
  } catch (error) {
    logger.warn("Failed to decode token", { error: error.message });
    return null;
  }
};

export const isTokenExpired = (token) => {
  if (!token || typeof token !== "string") {
    return true;
  }

  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.exp) {
      return true;
    }
    return decoded.exp < Math.floor(Date.now() / 1000);
  } catch (error) {
    return true;
  }
};

// ─── Token Validation Helper ───────────────────────────────────────────────────

export const validateTokenStructure = (decoded) => {
  if (!decoded || typeof decoded !== "object") {
    return false;
  }

  const requiredFields = ["id", "role", "iat", "exp"];
  for (const field of requiredFields) {
    if (!decoded[field]) {
      return false;
    }
  }

  return true;
};

// ─── Get Token Expiration Time ─────────────────────────────────────────────────

export const getTokenExpiration = (token) => {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) {
    return null;
  }
  return new Date(decoded.exp * 1000);
};

// ─── Get Time Until Token Expiration ───────────────────────────────────────────

export const getTimeUntilExpiration = (token) => {
  const expiration = getTokenExpiration(token);
  if (!expiration) {
    return 0;
  }
  return Math.max(0, expiration.getTime() - Date.now());
};
