import winston from 'winston';
import env from './env.js';

const { combine, timestamp, json, errors, printf, colorize, splat } = winston.format;

const isDev = env.NODE_ENV === 'development';
const isProd = env.NODE_ENV === 'production';

// Sanitize sensitive data from logs
const sanitizeLogData = (data) => {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sensitiveKeys = ['password', 'pin', 'token', 'accessToken', 'refreshToken', 'secret', 'authorization'];
  const sanitized = { ...data };

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeLogData(sanitized[key]);
    }
  }

  return sanitized;
};

// Custom format that sanitizes sensitive data
const sanitizeFormat = winston.format((info) => {
  if (info.message) {
    info.message = String(info.message);
  }
  if (typeof info === 'object') {
    const sanitized = sanitizeLogData(info);
    Object.assign(info, sanitized);
  }
  return info;
});

const consoleFormat = printf(({ level, message, timestamp: ts, ...metadata }) => {
  let msg = `${ts} [${level}]: ${message}`;
  if (Object.keys(metadata).length > 0) {
    const sanitizedMetadata = sanitizeLogData(metadata);
    msg += ` ${JSON.stringify(sanitizedMetadata)}`;
  }
  return msg;
});

// Production-safe error format (no stack traces in production)
const errorFormat = errors({ stack: !isProd });

const logger = winston.createLogger({
  level: env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'fixitnow-api', environment: env.NODE_ENV },
  transports: [
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: combine(
        timestamp(),
        sanitizeFormat(),
        errorFormat,
        json()
      ),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: combine(
        timestamp(),
        sanitizeFormat(),
        json()
      ),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ],
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: 'logs/exceptions.log',
      format: combine(
        timestamp(),
        sanitizeFormat(),
        errorFormat,
        json()
      ),
      maxsize: 5242880, // 5MB
      maxFiles: 3
    })
  ],
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: 'logs/rejections.log',
      format: combine(
        timestamp(),
        sanitizeFormat(),
        json()
      ),
      maxsize: 5242880, // 5MB
      maxFiles: 3
    })
  ]
});

// Console transport for development
if (isDev) {
  logger.add(new winston.transports.Console({
    format: combine(
      colorize(),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      splat(),
      consoleFormat
    )
  }));
}

// Production console transport (no color, structured logs)
if (isProd) {
  logger.add(new winston.transports.Console({
    format: combine(
      timestamp(),
      sanitizeFormat(),
      json()
    )
  }));
}

export default logger;
