import logger from '../utils/logger.js';
import env from '../utils/env.js';

const isProd = env.NODE_ENV === 'production';

// Error handling middleware

export const errorHandler = (err, req, res, next) => {
  // Log error with appropriate detail level
  const logData = {
    message: err.message,
    path: req.path,
    method: req.method,
    ip: req.ip
  };
  
  // Only include stack trace in development
  if (!isProd) {
    logData.stack = err.stack;
  }
  
  logger.error('Error occurred', logData);

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(409).json({
      success: false,
      message: `${field} already exists`
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }

  // Structured application errors (AppError)
  if (err.code) {
    return res.status(err.status || 400).json({
      success: false,
      code: err.code,
      message: err.message || 'Request failed.',
      ...(err.details && Object.keys(err.details).length > 0
        ? { details: err.details }
        : {}),
    });
  }

  // Default error - don't expose stack traces in production
  const statusCode = err.status || 500;
  const message = isProd && statusCode === 500 
    ? 'Internal server error' 
    : (err.message || 'Internal server error');

  res.status(statusCode).json({
    success: false,
    message
  });
};

// Async error wrapper
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// 404 handler
export const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
};
