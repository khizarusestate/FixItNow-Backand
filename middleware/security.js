import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import xssClean from "xss-clean";
import timeout from "connect-timeout";
import logger from "../utils/logger.js";
import { RATE_LIMITS } from "../utils/constants.js";
import { ADMIN_PANEL_ROLES } from "./adminRoles.js";
import { readEnvSuperAdminConfig } from "../services/envSuperAdmin.js";

function isSuperAdminLoginRequest(req) {
  if (req.method !== "POST") return false;
  if (req.body?.loginAs !== ADMIN_PANEL_ROLES.SUPER_ADMIN) return false;

  const { email: envEmail } = readEnvSuperAdminConfig();
  const email = String(req.body?.email || "").toLowerCase().trim();

  const isSuperAdmin = Boolean(envEmail && email === envEmail);

  if (isSuperAdmin) {
    logger.debug("Super admin request detected", {
      email,
      loginAs: req.body?.loginAs,
      hasEnvEmail: Boolean(envEmail),
    });
  }

  return isSuperAdmin;
}

// Mounted at /api/auth, so req.path is /refresh for POST /api/auth/refresh.
function isRefreshTokenRequest(req) {
  return req.method === "POST" && req.path === "/refresh";
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────

export const authRateLimit = rateLimit({
  windowMs: RATE_LIMITS.AUTH_WINDOW_MS,
  max: RATE_LIMITS.AUTH_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  // Token refresh is authenticated session maintenance, not a login attempt.
  // Counting it against the login limiter can lock a healthy worker/customer
  // out for 15 minutes when the client refreshes after an access-token expiry.
  skip: (req) => isSuperAdminLoginRequest(req) || isRefreshTokenRequest(req),
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
  skip: () => isNonProduction,
});

// ─── AI Rate Limiting ─────────────────────────────────────────────────────────

export const aiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many AI requests. Please try again later.",
  },
  handler: (req, res, next, options) => {
    logger.warn("AI rate limit exceeded", {
      ip: req.ip,
      path: req.path,
    });

    res.status(options.statusCode).json(options.message);
  },
});

export const strictRateLimit = rateLimit({
  windowMs: RATE_LIMITS.STRICT_WINDOW_MS,
  max: RATE_LIMITS.STRICT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const isSuperAdmin = isSuperAdminLoginRequest(req);

    if (isSuperAdmin) {
      logger.debug("Super admin login request - rate limit skipped", {
        email: req.body?.email,
        ip: req.ip,
      });
    }

    return isSuperAdmin;
  },
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

export const securityHeaders = (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=()",
  );

  const cspPolicy = `
    default-src 'self';
    script-src 'self' 'unsafe-inline' 'unsafe-eval'
      https://accounts.google.com
      https://apis.google.com
      https://ssl.gstatic.com
      https://*.gstatic.com
      https://vercel.live
      https://*.vercel.live
      https://cdn.vercel-insights.com;
    style-src 'self' 'unsafe-inline'
      https://fonts.googleapis.com
      https://accounts.google.com;
    img-src 'self' data: https: blob:;
    font-src 'self' data:
      https://fonts.gstatic.com
      https://*.gstatic.com;
    connect-src 'self' https: wss:
      https://*.vercel.live
      https://vercel.live
      https://cdn.vercel-insights.com;
    frame-src https://accounts.google.com https://*.google.com;
    frame-ancestors 'none';
    base-uri 'self';
  `
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ");

  res.setHeader("Content-Security-Policy", cspPolicy);
  next();
};

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

export const preventParameterPollution = (req, res, next) => {
  const cleanQuery = {};

  for (const key in req.query) {
    cleanQuery[key] = req.query[key];
  }

  req.query = cleanQuery;
  next();
};
