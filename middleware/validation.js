// Validation middleware
import { normalizeEmail, isValidEmail, normalizeCNIC, isValidCNIC, validateLength, validateRequired } from '../utils/helpers.js';
import { VALIDATION } from '../utils/constants.js';

export const validateRegistration = (req, res, next) => {
  const { fullName, email, password, phone } = req.body;
  
  const missing = validateRequired(['fullName', 'email', 'password', 'phone'], req.body);
  if (missing.length > 0) {
    return res.status(400).json({ success: false, message: `${missing.join(', ')} are required.` });
  }
  
  const nameError = validateLength(fullName, VALIDATION.NAME_MIN_LENGTH, VALIDATION.NAME_MAX_LENGTH, 'Full name');
  if (nameError) {
    return res.status(400).json({ success: false, message: nameError });
  }
  
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }
  
  const passwordError = validateLength(password, VALIDATION.PASSWORD_MIN_LENGTH, VALIDATION.PASSWORD_MAX_LENGTH, 'Password');
  if (passwordError) {
    return res.status(400).json({ success: false, message: passwordError });
  }
  
  const phoneError = validateLength(phone, 10, VALIDATION.PHONE_MAX_LENGTH, 'Phone number');
  if (phoneError) {
    return res.status(400).json({ success: false, message: phoneError });
  }
  
  // Normalize email
  req.body.email = normalizeEmail(email);
  
  next();
};

export const validateLogin = (req, res, next) => {
  const { email, password } = req.body;
  
  const missing = validateRequired(['email', 'password'], req.body);
  if (missing.length > 0) {
    return res.status(400).json({ success: false, message: `${missing.join(', ')} are required.` });
  }
  
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }
  
  const passwordError = validateLength(password, VALIDATION.PASSWORD_MIN_LENGTH, VALIDATION.PASSWORD_MAX_LENGTH, 'Password');
  if (passwordError) {
    return res.status(400).json({ success: false, message: passwordError });
  }
  
  // Normalize email
  req.body.email = normalizeEmail(email);
  
  next();
};

export const validateBooking = (req, res, next) => {
  const { serviceTitle, address, phone } = req.body;
  
  const missing = validateRequired(['serviceTitle', 'address', 'phone'], req.body);
  if (missing.length > 0) {
    return res.status(400).json({ success: false, message: `${missing.join(', ')} are required.` });
  }
  
  const titleError = validateLength(serviceTitle, 3, 200, 'Service title');
  if (titleError) {
    return res.status(400).json({ success: false, message: titleError });
  }
  
  const addressError = validateLength(address, 10, VALIDATION.ADDRESS_MAX_LENGTH, 'Address');
  if (addressError) {
    return res.status(400).json({ success: false, message: addressError });
  }
  
  const phoneError = validateLength(phone, 10, VALIDATION.PHONE_MAX_LENGTH, 'Phone number');
  if (phoneError) {
    return res.status(400).json({ success: false, message: phoneError });
  }
  
  next();
};

export const validateWorkerApplication = (req, res, next) => {
  const { fullName, phoneNumber, emailAddress, serviceCategory, cnicNumber, serviceArea } = req.body;
  
  const missing = validateRequired(['fullName', 'phoneNumber', 'emailAddress', 'serviceCategory', 'cnicNumber', 'serviceArea'], req.body);
  if (missing.length > 0) {
    return res.status(400).json({ success: false, message: `${missing.join(', ')} are required.` });
  }
  
  const nameError = validateLength(fullName, VALIDATION.NAME_MIN_LENGTH, VALIDATION.NAME_MAX_LENGTH, 'Full name');
  if (nameError) {
    return res.status(400).json({ success: false, message: nameError });
  }
  
  if (!isValidEmail(emailAddress)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }
  
  const phoneError = validateLength(phoneNumber, 10, VALIDATION.PHONE_MAX_LENGTH, 'Phone number');
  if (phoneError) {
    return res.status(400).json({ success: false, message: phoneError });
  }
  
  if (!isValidCNIC(cnicNumber)) {
    return res.status(400).json({ success: false, message: 'CNIC must be 13 digits (e.g. 35201-1234567-8).' });
  }
  
  const categoryError = validateLength(serviceCategory, 2, 100, 'Service category');
  if (categoryError) {
    return res.status(400).json({ success: false, message: categoryError });
  }
  
  const areaError = validateLength(serviceArea, 2, 200, 'Service area');
  if (areaError) {
    return res.status(400).json({ success: false, message: areaError });
  }
  
  // Normalize email and CNIC
  req.body.emailAddress = normalizeEmail(emailAddress);
  req.body.cnicNumber = normalizeCNIC(cnicNumber);
  
  next();
};

export const validateProfileUpdate = (req, res, next) => {
  const { fullName, phone } = req.body;
  
  if (fullName !== undefined) {
    const nameError = validateLength(fullName, VALIDATION.NAME_MIN_LENGTH, VALIDATION.NAME_MAX_LENGTH, 'Full name');
    if (nameError) {
      return res.status(400).json({ success: false, message: nameError });
    }
  }
  
  if (phone !== undefined) {
    const phoneError = validateLength(phone, 10, VALIDATION.PHONE_MAX_LENGTH, 'Phone number');
    if (phoneError) {
      return res.status(400).json({ success: false, message: phoneError });
    }
  }
  
  next();
};

// Admin login validation
export const validateAdminLogin = (req, res, next) => {
  const { email, pin, loginAs } = req.body;
  
  const missing = validateRequired(['email', 'pin', 'loginAs'], req.body);
  if (missing.length > 0) {
    return res.status(400).json({ success: false, message: `${missing.join(', ')} are required.` });
  }

  if (!['admin', 'super_admin'].includes(loginAs)) {
    return res.status(400).json({
      success: false,
      message: 'loginAs must be "admin" or "super_admin".',
    });
  }
  
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }
  
  if (String(pin).length !== VALIDATION.PIN_LENGTH) {
    return res.status(400).json({ success: false, message: `PIN must be exactly ${VALIDATION.PIN_LENGTH} digits.` });
  }
  
  // Normalize email
  req.body.email = normalizeEmail(email);
  
  next();
};
