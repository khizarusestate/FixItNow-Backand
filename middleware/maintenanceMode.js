/**
 * Maintenance mode — customer-facing site uses a visual overlay only.
 * Admin panel routes and authenticated admin tokens are never blocked.
 */

import PlatformSettings from "../models/PlatformSettings.js";
import { getAccessTokenFromRequest } from "../utils/authCookies.js";
import { verifyToken } from "../utils/jwt.js";

function requestPath(req) {
  return String(req.originalUrl || req.url || "").split("?")[0];
}

function isAdminApiPath(path) {
  return path.includes("/api/admin");
}

function isPublicMaintenanceStatusPath(path) {
  return path.includes("/api/public/maintenance-status");
}

function isAuthenticatedAdmin(req) {
  const token = getAccessTokenFromRequest(req);
  if (!token) return false;
  try {
    const decoded = verifyToken(token);
    return decoded?.role === "admin";
  } catch {
    return false;
  }
}

export const checkMaintenanceMode = async (req, res, next) => {
  try {
    const path = requestPath(req);

    if (isAdminApiPath(path) || isPublicMaintenanceStatusPath(path)) {
      return next();
    }

    if (isAuthenticatedAdmin(req)) {
      return next();
    }

    // Customer/worker APIs stay available; the FixItNow frontend shows a blur overlay.
    next();
  } catch (error) {
    console.error("Error checking maintenance mode:", error);
    next();
  }
};

/** Read maintenance settings for public status endpoint. */
export async function getMaintenanceStatus() {
  const settings = await PlatformSettings.findOne().select("maintenanceMode").lean();
  return {
    enabled: Boolean(settings?.maintenanceMode?.enabled),
    message:
      settings?.maintenanceMode?.message ||
      "App is in maintenance. Please try again later.",
  };
}

export default checkMaintenanceMode;
