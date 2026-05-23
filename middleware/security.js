import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import xssClean from "xss-clean";
import timeout from "connect-timeout";
import logger from "../utils/logger.js";
import { RATE_LIMITS } from "../utils/constants.js";

// ─── Rate Limiting ────────────────────────────────────────────────────────────

export const authRateLimit = rateLimit({
  windowMs: RATE_LIMITS.AUTH_WINDOW_MS,
  max: RATE_LIMITS.AUTH_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message:
      "Too many authentication attempts. Please try again after 15 minutes.",
  },
  handler: (req, res, next, options) => {
    logger.warn("Rate limit exceeded", { ip: req.ip, path: req.path });
    res.status(options.statusCode).json(options.message);
  },
});

const isNonProduction =
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

export const apiRateLimit = rateLimit({
  windowMs: RATE_LIMITS.API_WINDOW_MS,
  max: RATE_LIMITS.API_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please slow down.",
  },
  // Dev: React Strict Mode + Vite HMR can legitimately double-fetch; the SPA
  // also batches many public reads on first paint — avoid blocking local work.
  skip: () => isNonProduction,
});

export const strictRateLimit = rateLimit({
  windowMs: RATE_LIMITS.STRICT_WINDOW_MS,
  max: RATE_LIMITS.STRICT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many attempts. Please try again after 1 hour.",
  },
  handler: (req, res, next, options) => {
    logger.warn("Strict rate limit exceeded", { ip: req.ip, path: req.path });
    res.status(options.statusCode).json(options.message);
  },
});

// ─── Input Sanitization ────────────────────────────────────────────────────────

export const sanitizeMongo = mongoSanitize({
  replaceWith: "_",
  onSanitize: ({ req, key }) => {
    logger.warn("MongoDB sanitization triggered", { ip: req.ip, key });
  },
});

export const sanitizeXSS = xssClean();

// ─── Request Timeout ──────────────────────────────────────────────────────────

export const requestTimeout = timeout("30s");

export const handleTimeout = (req, res, next) => {
  if (req.timedout) {
    logger.error("Request timeout", {
      ip: req.ip,
      path: req.path,
      method: req.method,
    });
    return res.status(503).json({
      success: false,
      message: "Request timed out. Please try again.",
    });
  }
  next();
};

// ─── Security Headers Enhancement ─────────────────────────────────────────────

// Custom security headers
export const securityHeaders = (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=()",
  );
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
  }
  next();
};

// Validate content type for POST/PUT/PATCH requests
export const validateContentType = (req, res, next) => {
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    if (
      !req.is("json") &&
      !req.is("multipart/form-data") &&
      !req.is("application/x-www-form-urlencoded")
    ) {
      return res.status(415).json({
        success: false,
        message: "Unsupported Media Type. Use JSON or form data.",
      });
    }
  }
  next();
};

// Prevent parameter pollution
export const preventParameterPollution = (req, res, next) => {
  // Remove duplicate query parameters
  const cleanQuery = {};
  for (const key in req.query) {
    cleanQuery[key] = req.query[key];
  }
  req.query = cleanQuery;
  next();
};
