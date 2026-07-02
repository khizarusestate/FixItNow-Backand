import { verifyToken, validateTokenStructure } from '../utils/jwt.js';
import { getAccessTokenFromRequest } from '../utils/authCookies.js';
import logger from '../utils/logger.js';
import { asyncHandler } from './errorHandler.js';
import Admin from '../models/Admin.js';
import Customer from '../customerSchema.js';
import Worker from '../workerSchema.js';
import { isEnvSuperAdminToken, ENV_SUPER_ADMIN_ID } from '../services/envSuperAdmin.js';
import { ADMIN_PANEL_ROLES } from './adminRoles.js';

// Generic auth middleware factory
// IMPORTANT: session state (token presence/validity) is NOT used for blocking beyond auth itself.
// Account-level checks (disabled/deleted/rejected/pending) are enforced via DB for customer/worker.
const makeAuthMiddleware = (role, reqKey) => async (req, res, next) => {
  const token = getAccessTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ success: false, message: `Authorization required.` });
  }

  try {
    const decoded = verifyToken(token);
    
    // Validate token structure
    if (!validateTokenStructure(decoded)) {
      logger.warn('Invalid token structure in auth middleware', { role, ip: req.ip });
      return res.status(401).json({ success: false, message: 'Invalid authentication token.', code: 'INVALID_TOKEN' });
    }
    
    if (decoded.role !== role) {
      logger.warn('Role mismatch in auth middleware', { expected: role, actual: decoded.role, ip: req.ip });
      return res.status(403).json({ success: false, message: `${role.charAt(0).toUpperCase() + role.slice(1)} access required.` });
    }

    // Account-state enforcement (permission layer)
    // Only "disabled" (and equivalent existing DB flags) should block access.
    if (role === 'worker') {
      const worker = await Worker.findOne({
        _id: decoded.id,
        isDeleted: { $ne: true },
      })
        .select('isDisabled status')
        .lean();
      if (!worker) {
        return res.status(401).json({ success: false, message: 'Account not found.' });
      }
      if (worker.status === 'rejected') {
        return res.status(403).json({ success: false, message: 'Your account has been rejected.' });
      }
      if (worker.status === 'not_approved') {
        return res.status(403).json({
          success: false,
          message: 'Your account is pending admin approval. Please wait for verification.',
        });
      }
      if (worker.isDisabled) {
        return res.status(403).json({
          success: false,
          message: 'Your account has been disabled by an administrator. Please contact support.',
          code: 'ACCOUNT_DISABLED',
        });
      }
    }

    if (role === 'customer') {
      const customer = await Customer.findOne({
        _id: decoded.id,
        isDeleted: { $ne: true },
      })
        .select('isActive status')
        .lean();
      if (!customer) {
        return res.status(401).json({ success: false, message: 'Account not found.' });
      }
      if (customer.isActive === false) {
        return res.status(403).json({
          success: false,
          message: 'Your account has been deactivated. Please contact support.',
          code: 'ACCOUNT_DISABLED',
        });
      }
      if (customer.status === 'rejected') {
        return res.status(403).json({ success: false, message: 'Your account has been rejected.' });
      }
    }
    
    req[reqKey] = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      logger.warn('Token expired in auth middleware', { role, ip: req.ip });
      return res.status(401).json({ success: false, message: 'Token expired.' });
    }
    if (error.name === 'JsonWebTokenError') {
      logger.warn('Invalid token in auth middleware', { role, ip: req.ip });
      return res.status(401).json({ success: false, message: 'Invalid token.' });
    }
    logger.error('Auth middleware error', { role, error: error.message, ip: req.ip });
    return res.status(401).json({ success: false, message: 'Authentication failed.' });
  }
};

export const requireAdmin = asyncHandler(async (req, res, next) => {
  const token = getAccessTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authorization required.' });
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (error) {
    if (error.message === 'Token expired') {
      return res.status(401).json({ success: false, message: 'Token expired.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ success: false, message: 'Authentication failed.' });
  }

  if (!validateTokenStructure(decoded) || decoded.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }

  if (isEnvSuperAdminToken(decoded)) {
    req.admin = {
      ...decoded,
      id: ENV_SUPER_ADMIN_ID,
      email: decoded.email,
    };
    return next();
  }

  const adminDoc = await Admin.findById(decoded.id).select('role isActive email');
  if (!adminDoc) {
    return res.status(401).json({ success: false, message: 'Admin account not found.', code: 'ADMIN_NOT_FOUND' });
  }

  // Super admin can always access, regardless of isActive status
  // If super admin is deactivated, they'll be reactivated on server startup
  if (adminDoc.role === 'super_admin') {
    req.admin = {
      id: String(adminDoc._id),
      role: adminDoc.role,
      email: adminDoc.email,
    };
    return next();
  }

  // For regular admins, check if they're active (undefined/null => active, same as schema default)
  if (!Admin.isAccountActive(adminDoc)) {
    return res.status(403).json({
      success: false,
      message: 'Your admin account is Inactive. Please contact the super admin.',
      code: 'ADMIN_DEACTIVATED',
    });
  }

  req.admin = {
    ...decoded,
    id: String(decoded.id),
    role: decoded.role || adminDoc.role,
    email: decoded.email || adminDoc.email,
  };
  next();
});

/** Only super_admin can manage other admins. */
export const requireSuperAdmin = asyncHandler(async (req, res, next) => {
  const token = getAccessTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authorization required.' });
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (error) {
    if (error.message === 'Token expired') {
      return res.status(401).json({ success: false, message: 'Token expired.' });
    }
    return res.status(401).json({ success: false, message: 'Authentication failed.' });
  }

  if (!validateTokenStructure(decoded) || decoded.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }

  if (isEnvSuperAdminToken(decoded)) {
    req.admin = {
      ...decoded,
      id: ENV_SUPER_ADMIN_ID,
      email: decoded.email,
    };
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Super admin access required.',
    code: 'SUPER_ADMIN_REQUIRED',
  });
});
export const requireCustomer = makeAuthMiddleware('customer', 'customer');
export const requireWorker = makeAuthMiddleware('worker', 'worker');

// Generic authentication for any role
export const requireAuth = asyncHandler(async (req, res, next) => {
  try {
    const token = getAccessTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided.' });
    }

    const decoded = verifyToken(token);
    validateTokenStructure(decoded);

    req.user = decoded;
    req[decoded.role] = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired.' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token.' });
    }
    return res.status(401).json({ success: false, message: 'Authentication failed.' });
  }
});

// Optional authentication (doesn't fail if no token)
export const optionalAuth = asyncHandler(async (req, res, next) => {
  try {
    const token = getAccessTokenFromRequest(req);

    if (token) {
      const decoded = verifyToken(token);
      validateTokenStructure(decoded);
      req.user = decoded;
      req[decoded.role] = decoded;
    }
    next();
  } catch (error) {
    // Don't fail on error, just proceed without user
    next();
  }
});
