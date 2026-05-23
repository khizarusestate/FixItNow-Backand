import mongoose from 'mongoose';
import { HTTP_STATUS } from './constants.js';

// ─── Response Helpers ────────────────────────────────────────────────────────────

export const successResponse = (res, data = null, message = 'Success', statusCode = HTTP_STATUS.OK) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
};

export const createdResponse = (res, data = null, message = 'Resource created successfully') => {
  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message,
    data
  });
};

export const errorResponse = (res, message = 'An error occurred', statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR, errors = null) => {
  const response = {
    success: false,
    message
  };
  
  if (errors) {
    response.errors = errors;
  }
  
  return res.status(statusCode).json(response);
};

export const notFoundResponse = (res, message = 'Resource not found') => {
  return res.status(HTTP_STATUS.NOT_FOUND).json({
    success: false,
    message
  });
};

export const unauthorizedResponse = (res, message = 'Unauthorized access') => {
  return res.status(HTTP_STATUS.UNAUTHORIZED).json({
    success: false,
    message
  });
};

export const forbiddenResponse = (res, message = 'Access forbidden') => {
  return res.status(HTTP_STATUS.FORBIDDEN).json({
    success: false,
    message
  });
};

export const conflictResponse = (res, message = 'Resource already exists') => {
  return res.status(HTTP_STATUS.CONFLICT).json({
    success: false,
    message
  });
};

export const badRequestResponse = (res, message = 'Invalid request', errors = null) => {
  return errorResponse(res, message, HTTP_STATUS.BAD_REQUEST, errors);
};

// ─── ObjectId Validation Helper ───────────────────────────────────────────────────

export const isValidObjectId = (id) => {
  if (!id || typeof id !== 'string') {
    return false;
  }
  return mongoose.Types.ObjectId.isValid(id);
};

export const validateObjectId = (id, fieldName = 'ID') => {
  if (!isValidObjectId(id)) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return id;
};

// ─── Email Normalization ───────────────────────────────────────────────────────────

export const normalizeEmail = (email) => {
  if (!email || typeof email !== 'string') {
    return '';
  }
  return email.toLowerCase().trim();
};

export const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') {
    return false;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
};

// ─── Phone Normalization ───────────────────────────────────────────────────────────

export const normalizePhone = (phone) => {
  if (!phone || typeof phone !== 'string') {
    return '';
  }
  return phone.trim();
};

// ─── CNIC Normalization ────────────────────────────────────────────────────────────

export const normalizeCNIC = (cnic) => {
  if (!cnic || typeof cnic !== 'string') {
    return '';
  }
  return cnic.replace(/-/g, '').trim();
};

export const isValidCNIC = (cnic) => {
  const cleaned = normalizeCNIC(cnic);
  return /^\d{13}$/.test(cleaned);
};

// ─── Pagination Helper ────────────────────────────────────────────────────────────

export const getPaginationParams = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 50));
  const skip = (page - 1) * limit;
  
  const sortBy = query.sortBy || 'createdAt';
  const order = query.order === 'asc' ? 1 : -1;
  const sort = { [sortBy]: order };
  
  return { page, limit, skip, sort };
};

export const buildPaginationResponse = (page, limit, total) => {
  return {
    page,
    limit,
    total,
    pages: Math.ceil(total / limit)
  };
};

// ─── Filter Helper ────────────────────────────────────────────────────────────────

export const buildFilter = (allowedFields, query) => {
  const filter = {};
  
  for (const field of allowedFields) {
    if (query[field] !== undefined && query[field] !== '') {
      filter[field] = query[field];
    }
  }
  
  return filter;
};

// ─── Sanitize User Data for Response ───────────────────────────────────────────────

export const sanitizeUser = (user, excludeFields = ['password', 'pin']) => {
  if (!user) return null;
  
  const userData = user.toObject ? user.toObject() : { ...user };
  
  for (const field of excludeFields) {
    delete userData[field];
  }
  
  return userData;
};

// ─── Async Handler with Better Error Handling ────────────────────────────────────

export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      // Log the error
      if (process.env.NODE_ENV === 'production') {
        console.error('Async handler error:', error.message);
      } else {
        console.error('Async handler error:', error);
      }
      
      // Pass to error handler middleware
      next(error);
    });
  };
};

// ─── Validation Helper ───────────────────────────────────────────────────────────

export const validateRequired = (fields, data) => {
  const missing = [];
  
  for (const field of fields) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      missing.push(field);
    }
  }
  
  return missing;
};

export const validateLength = (value, min, max, fieldName) => {
  if (value === undefined || value === null) {
    return null; // Skip validation if field is not provided
  }
  
  const strValue = String(value);
  if (strValue.length < min) {
    return `${fieldName} must be at least ${min} characters`;
  }
  
  if (strValue.length > max) {
    return `${fieldName} must not exceed ${max} characters`;
  }
  
  return null;
};

// ─── Safe JSON Parse ─────────────────────────────────────────────────────────────

export const safeJSONParse = (str, defaultValue = null) => {
  try {
    return JSON.parse(str);
  } catch (error) {
    return defaultValue;
  }
};

// ─── Generate Random String ──────────────────────────────────────────────────────

export const generateRandomString = (length = 32) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// ─── Mask Sensitive Data ───────────────────────────────────────────────────────

export const maskEmail = (email) => {
  if (!email || typeof email !== 'string') {
    return '';
  }
  const [username, domain] = email.split('@');
  if (!username || !domain) {
    return email;
  }
  const maskedUsername = username.length > 2 
    ? username.substring(0, 2) + '*'.repeat(username.length - 2)
    : username;
  return `${maskedUsername}@${domain}`;
};

export const maskPhone = (phone) => {
  if (!phone || typeof phone !== 'string') {
    return '';
  }
  if (phone.length <= 4) {
    return phone;
  }
  return phone.substring(0, phone.length - 4) + '****';
};

export const maskCNIC = (cnic) => {
  if (!cnic || typeof cnic !== 'string') {
    return '';
  }
  const cleaned = normalizeCNIC(cnic);
  if (cleaned.length !== 13) {
    return cnic;
  }
  return cleaned.substring(0, 5) + '-*******-' + cleaned.substring(12);
};
