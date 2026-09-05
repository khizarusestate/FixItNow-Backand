import { verifyToken, validateTokenStructure } from '../utils/jwt.js';
import { getAccessTokenFromRequest } from '../utils/authCookies.js';
import logger from '../utils/logger.js';
import { asyncHandler } from './errorHandler.js';
import Admin from '../models/Admin.js';
import Customer from '../customerSchema.js';
import Worker from '../workerSchema.js';
import { isEnvSuperAdminToken, ENV_SUPER_ADMIN_ID } from '../services/envSuperAdmin.js';

const makeAuthMiddleware = (role, reqKey) => async (req, res, next) => {
  const token = getAccessTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Authorization required.', code: 'AUTH_REQUIRED' });
  }

  try {
    const decoded = verifyToken(token);
    if (!validateTokenStructure(decoded)) {
      logger.warn('Invalid token structure in auth middleware', { role, ip: req.ip });
      return res.status(401).json({ success: false, message: 'Invalid authentication token.', code: 'INVALID_TOKEN' });
    }

    if (decoded.role !== role) {
      logger.warn('Role mismatch in auth middleware', { expected: role, actual: decoded.role, ip: req.ip });
      return res.status(403).json({
        success: false,
        message: `${role.charAt(0).toUpperCase() + role.slice(1)} access required.`,
        code: 'ROLE_MISMATCH',
      });
    }

    if (role === 'worker') {
      const worker = await Worker.findOne({
        _id: decoded.id,
        isDeleted: { $ne: true },
      })
        .select('isDisabled status approvalStatus emailVerified')
        .lean();

      if (!worker) {
        return res.status(401).json({
          success: false,
          message: 'Worker account not found.',
          code: 'ACCOUNT_NOT_FOUND',
        });
      }

      if (worker.isDisabled || worker.status === 'suspended') {
        return res.status(403).json({
          success: false,
          message: 'Your worker account has been disabled or suspended by an administrator. Please contact support.',
          code: 'ACCOUNT_DISABLED',
        });
      }

      if (worker.approvalStatus === 'rejected' || worker.status === 'rejected') {
        return res.status(403).json({
          success: false,
          message: 'Your worker account has been rejected.',
          code: 'ACCOUNT_REJECTED',
        });
      }

      if (worker.approvalStatus !== 'approved' || worker.status !== 'active') {
        return res.status(403).json({
          success: false,
          message: 'Your worker account is pending admin approval. Please wait for verification.',
          code: 'PENDING_APPROVAL',
        });
      }
    }

    if (role === 'customer') {
      const customer = await Customer.findOne({
        _id: decoded.id,
        isDeleted: { $ne: true },
      })
        .select('isActive status isVerified')
        .lean();

      if (!customer) {
        return res.status(401).json({
          success: false,
          message: 'Customer account not found.',
          code: 'ACCOUNT_NOT_FOUND',
        });
      }

      if (customer.isActive === false || customer.status === 'inactive') {
        return res.status(403).json({
          success: false,
          message: 'Your customer account has been deactivated. Please contact support.',
          code: 'ACCOUNT_DISABLED',
        });
      }

      if (customer.status === 'rejected') {
        return res.status(403).json({
          success: false,
          message: 'Your customer account has been rejected.',
          code: 'ACCOUNT_REJECTED',
        });
      }
    }

    req[reqKey] = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired.', code: 'TOKEN_EXPIRED' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token.', code: 'INVALID_TOKEN' });
    }
    logger.error('Auth middleware error', { role, error: error.message, ip: req.ip });
    return res.status(401).json({ success: false, message: 'Authentication failed.', code: 'AUTH_FAILED' });
  }
};

export const requireAdmin = asyncHandler(async (req, res, next) => {
  const token = getAccessTokenFromRequest(req);
  if (!token) return res.status(401).json({ success: false, message: 'Authorization required.' });

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (error) {
    if (error.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: 'Token expired.', code: 'TOKEN_EXPIRED' });
    return res.status(401).json({ success: false, message: 'Authentication failed.', code: 'AUTH_FAILED' });
  }

  if (!validateTokenStructure(decoded) || (decoded.role !== 'admin' && decoded.role !== 'super_admin')) {
    return res.status(403).json({ success: false, message: 'Admin access required.', code: 'ADMIN_REQUIRED' });
  }

  if (isEnvSuperAdminToken(decoded)) {
    req.admin = { ...decoded, id: ENV_SUPER_ADMIN_ID, email: decoded.email };
    return next();
  }

  const adminDoc = await Admin.findById(decoded.id).select('role isActive email');
  if (!adminDoc) return res.status(401).json({ success: false, message: 'Admin account not found.', code: 'ADMIN_NOT_FOUND' });

  if (adminDoc.role === 'super_admin') {
    req.admin = { id: String(adminDoc._id), role: adminDoc.role, email: adminDoc.email };
    return next();
  }

  if (!Admin.isAccountActive(adminDoc)) {
    return res.status(403).json({ success: false, message: 'Your admin account is Inactive. Please contact the super admin.', code: 'ADMIN_DEACTIVATED' });
  }

  req.admin = { ...decoded, id: String(decoded.id), role: decoded.role || adminDoc.role, email: decoded.email || adminDoc.email };
  next();
});

export const requireSuperAdmin = asyncHandler(async (req, res, next) => {
  const token = getAccessTokenFromRequest(req);
  if (!token) return res.status(401).json({ success: false, message: 'Authorization required.' });

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (error) {
    if (error.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: 'Token expired.' });
    return res.status(401).json({ success: false, message: 'Authentication failed.' });
  }

  if (!validateTokenStructure(decoded) || (decoded.role !== 'admin' && decoded.role !== 'super_admin')) {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }

  if (isEnvSuperAdminToken(decoded)) {
    req.admin = { ...decoded, id: ENV_SUPER_ADMIN_ID, email: decoded.email };
    return next();
  }

  const adminDoc = await Admin.findById(decoded.id).select('role isActive email');
  if (!adminDoc) return res.status(401).json({ success: false, message: 'Admin account not found.', code: 'ADMIN_NOT_FOUND' });

  if (adminDoc.role !== 'super_admin') {
    return res.status(403).json({ success: false, message: 'Super admin access required.', code: 'SUPER_ADMIN_REQUIRED' });
  }

  req.admin = { ...decoded, id: String(adminDoc._id), role: adminDoc.role, email: adminDoc.email };
  next();
});

export const requireCustomer = makeAuthMiddleware('customer', 'customer');
export const requireWorker = makeAuthMiddleware('worker', 'worker');

// Generic authenticated routes must still validate the live database account.
// A valid JWT alone must never keep a suspended, rejected, disabled, or deleted
// account authorized until the token expires.
export const requireAuth = asyncHandler(async (req, res, next) => {
  try {
    const token = getAccessTokenFromRequest(req);
    if (!token) return res.status(401).json({ success: false, message: 'No token provided.', code: 'AUTH_REQUIRED' });

    const decoded = verifyToken(token);
    if (!validateTokenStructure(decoded)) {
      logger.warn('Invalid token structure in generic auth middleware', { ip: req.ip });
      return res.status(401).json({ success: false, message: 'Invalid authentication token.', code: 'INVALID_TOKEN' });
    }

    if (decoded.role === 'worker') {
      const worker = await Worker.findOne({ _id: decoded.id, isDeleted: { $ne: true } })
        .select('isDisabled status approvalStatus emailVerified')
        .lean();

      if (!worker) return res.status(401).json({ success: false, message: 'Worker account not found.', code: 'ACCOUNT_NOT_FOUND' });
      if (worker.isDisabled || worker.status === 'suspended') {
        return res.status(403).json({ success: false, message: 'Your worker account has been disabled or suspended by an administrator. Please contact support.', code: 'ACCOUNT_DISABLED' });
      }
      if (worker.approvalStatus === 'rejected' || worker.status === 'rejected') {
        return res.status(403).json({ success: false, message: 'Your worker account has been rejected.', code: 'ACCOUNT_REJECTED' });
      }
      if (worker.emailVerified !== true || worker.approvalStatus !== 'approved' || worker.status !== 'active') {
        return res.status(403).json({ success: false, message: 'Your worker account is not active or approved.', code: 'PENDING_APPROVAL' });
      }
    } else if (decoded.role === 'customer') {
      const customer = await Customer.findOne({ _id: decoded.id, isDeleted: { $ne: true } })
        .select('isActive status')
        .lean();

      if (!customer) return res.status(401).json({ success: false, message: 'Customer account not found.', code: 'ACCOUNT_NOT_FOUND' });
      if (customer.isActive === false || customer.status === 'inactive') {
        return res.status(403).json({ success: false, message: 'Your customer account has been deactivated. Please contact support.', code: 'ACCOUNT_DISABLED' });
      }
      if (customer.status === 'rejected') {
        return res.status(403).json({ success: false, message: 'Your customer account has been rejected.', code: 'ACCOUNT_REJECTED' });
      }
    } else if (decoded.role === 'admin' || decoded.role === 'super_admin') {
      if (!isEnvSuperAdminToken(decoded)) {
        const adminDoc = await Admin.findById(decoded.id).select('role isActive email');
        if (!adminDoc) return res.status(401).json({ success: false, message: 'Admin account not found.', code: 'ADMIN_NOT_FOUND' });
        if (adminDoc.role !== decoded.role) {
          return res.status(403).json({ success: false, message: 'Admin role is no longer valid.', code: 'ROLE_MISMATCH' });
        }
        if (adminDoc.role !== 'super_admin' && !Admin.isAccountActive(adminDoc)) {
          return res.status(403).json({ success: false, message: 'Your admin account is Inactive. Please contact the super admin.', code: 'ADMIN_DEACTIVATED' });
        }
      }
    } else {
      return res.status(403).json({ success: false, message: 'Unsupported account role.', code: 'ROLE_MISMATCH' });
    }

    req.user = decoded;
    req[decoded.role] = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: 'Token expired.', code: 'TOKEN_EXPIRED' });
    if (error.name === 'JsonWebTokenError') return res.status(401).json({ success: false, message: 'Invalid token.', code: 'INVALID_TOKEN' });
    logger.error('Generic auth middleware error', { error: error.message, ip: req.ip });
    return res.status(401).json({ success: false, message: 'Authentication failed.', code: 'AUTH_FAILED' });
  }
});

export const optionalAuth = asyncHandler(async (req, res, next) => {
  try {
    const token = getAccessTokenFromRequest(req);
    if (token) {
      const decoded = verifyToken(token);
      if (validateTokenStructure(decoded)) {
        req.user = decoded;
        req[decoded.role] = decoded;
      }
    }
    next();
  } catch {
    next();
  }
});
