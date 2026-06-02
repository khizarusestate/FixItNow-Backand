import { body, validationResult } from 'express-validator';
import mongoSanitize from 'express-mongo-sanitize';
import xssClean from 'xss-clean';

// Middleware to validate and sanitize all incoming request data
export const validateAndSanitize = (req, res, next) => {
  try {
    // Sanitize request body
    if (req.body) {
      req.body = mongoSanitize(req.body);
      req.body = xssClean(req.body);
    }

    // Sanitize query parameters
    if (req.query) {
      req.query = mongoSanitize(req.query);
      req.query = xssClean(req.query);
    }

    // Sanitize URL parameters
    if (req.params) {
      req.params = mongoSanitize(req.params);
      req.params = xssClean(req.params);
    }

    // Run validation if validation rules are provided
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    next();
  } catch (error) {
    console.error('Input validation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during validation'
    });
  }
};

// Common validation rules for different data types
export const userValidationRules = {
  email: {
    isEmail: {
      errorMessage: 'Please provide a valid email address'
    },
    normalizeEmail: true,
    notEmpty: {
      errorMessage: 'Email address is required'
    }
  },
  password: {
    isLength: {
      options: { min: 6 },
      errorMessage: 'Password must be at least 6 characters long'
    },
    notEmpty: {
      errorMessage: 'Password is required'
    }
  },
  name: {
    isLength: {
      options: { min: 2, max: 50 },
      errorMessage: 'Name must be between 2 and 50 characters'
    },
    notEmpty: {
      errorMessage: 'Name is required'
    }
  },
  phone: {
    isLength: {
      options: { min: 10, max: 15 },
      errorMessage: 'Phone number must be between 10 and 15 digits'
    },
    matches: {
      options: { regex: /^[0-9]+$/ },
      errorMessage: 'Phone number can only contain digits'
    },
    notEmpty: {
      errorMessage: 'Phone number is required'
    }
  },
  serviceTitle: {
    isLength: {
      options: { min: 3, max: 100 },
      errorMessage: 'Service title must be between 3 and 100 characters'
    },
    notEmpty: {
      errorMessage: 'Service title is required'
    }
  },
  address: {
    isLength: {
      options: { min: 10, max: 200 },
      errorMessage: 'Address must be between 10 and 200 characters'
    },
    notEmpty: {
      errorMessage: 'Address is required'
    }
  }
};

export const bookingValidationRules = {
  serviceTitle: userValidationRules.serviceTitle,
  address: userValidationRules.address,
  phone: userValidationRules.phone,
  email: userValidationRules.email,
  name: userValidationRules.name
};

export const workerValidationRules = {
  emailAddress: userValidationRules.email,
  password: userValidationRules.password,
  fullName: userValidationRules.name,
  phoneNumber: userValidationRules.phone,
  serviceCategory: {
    notEmpty: {
      errorMessage: 'Service category is required'
    }
  },
  cnicNumber: {
    isLength: {
      options: { min: 13, max: 15 },
      errorMessage: 'CNIC number must be between 13 and 15 characters'
    },
    matches: {
      options: { regex: /^[0-9]{5}-[0-9]{7}-[0-9]$/ },
      errorMessage: 'Please provide a valid CNIC number (format: 12345-1234567-1)'
    },
    notEmpty: {
      errorMessage: 'CNIC number is required'
    }
  }
};
