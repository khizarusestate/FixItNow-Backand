import crypto from 'crypto';
import logger from '../utils/logger.js';
import { sendEmail } from './emailApi.js';

/**
 * Generate a 6-digit verification code
 */
export function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Store verification code in memory with expiry
 * In production, use Redis or database
 */
const verificationCodes = new Map();
const CODE_EXPIRY_MINUTES = 10;

/**
 * Save verification code for email
 */
export function saveVerificationCode(email) {
  const normalizedEmail = email.toLowerCase().trim();
  const code = generateVerificationCode();
  const expiresAt = Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000;

  verificationCodes.set(normalizedEmail, {
    code,
    expiresAt,
    attempts: 0,
    createdAt: new Date(),
  });

  logger.info('Verification code generated', {
    email: normalizedEmail,
    expiresIn: `${CODE_EXPIRY_MINUTES}m`,
  });

  return code;
}

/**
 * Verify the code against stored code
 */
export function verifyCode(email, code) {
  const normalizedEmail = email.toLowerCase().trim();
  const stored = verificationCodes.get(normalizedEmail);

  if (!stored) {
    return {
      valid: false,
      error: 'No verification code found. Request a new one.',
      expired: true,
    };
  }

  // Check if expired
  if (Date.now() > stored.expiresAt) {
    verificationCodes.delete(normalizedEmail);
    return {
      valid: false,
      error: 'Verification code has expired. Request a new one.',
      expired: true,
    };
  }

  // Check attempts (max 5)
  if (stored.attempts >= 5) {
    verificationCodes.delete(normalizedEmail);
    return {
      valid: false,
      error: 'Too many failed attempts. Request a new code.',
      expired: true,
    };
  }

  // Check code
  if (stored.code !== code.toString()) {
    stored.attempts += 1;
    return {
      valid: false,
      error: `Invalid code. ${5 - stored.attempts} attempts remaining.`,
      expired: false,
    };
  }

  // Code is valid - delete it
  verificationCodes.delete(normalizedEmail);

  logger.info('Verification code verified', { email: normalizedEmail });

  return {
    valid: true,
    error: null,
    expired: false,
  };
}

/**
 * Send verification code via email
 */
export async function sendVerificationEmail(email, code) {
  const subject = 'Fix It Now - Email Verification Code';

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 40px 20px; text-align: center; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700;">Fix It Now</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Verify your email address</p>
      </div>

      <!-- Content -->
      <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb;">
        <p style="color: #1f2937; font-size: 16px; margin: 0 0 24px 0; line-height: 1.6;">
          Hello,
        </p>

        <p style="color: #1f2937; font-size: 16px; margin: 0 0 32px 0; line-height: 1.6;">
          Your verification code is:
        </p>

        <!-- Code Box -->
        <div style="background: #f9fafb; border: 2px solid #f97316; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 32px;">
          <p style="color: #f97316; font-size: 36px; font-weight: 700; margin: 0; letter-spacing: 4px;">
            ${code}
          </p>
          <p style="color: #6b7280; font-size: 12px; margin: 12px 0 0 0;">
            Code expires in 10 minutes
          </p>
        </div>

        <p style="color: #1f2937; font-size: 16px; margin: 0 0 24px 0; line-height: 1.6;">
          Enter this code in your Fix It Now app to verify your email address.
        </p>

        <p style="color: #6b7280; font-size: 14px; margin: 0 0 24px 0; line-height: 1.6;">
          If you didn't request this code, please ignore this email.
        </p>

        <!-- Footer -->
        <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; margin-top: 32px;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0; line-height: 1.6;">
            © 2026 Fix It Now. All rights reserved.
          </p>
          <p style="color: #9ca3af; font-size: 12px; margin: 8px 0 0 0;">
            This is an automated message, please do not reply to this email.
          </p>
        </div>
      </div>

      <!-- Footer Gradient -->
      <div style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); height: 4px;"></div>
    </div>
  `;

  try {
    const result = await sendEmail({
      to: email,
      subject,
      html,
    });

    if (result.success) {
      logger.info('Verification email sent', { to: email, id: result.id });
      return { success: true, message: 'Verification code sent to your email' };
    }

    logger.warn('Verification email failed', { to: email, error: result.error });
    return {
      success: false,
      error: result.error || 'Failed to send verification email',
    };
  } catch (error) {
    logger.error('Verification email error', { to: email, error: error.message });
    return {
      success: false,
      error: 'Failed to send verification email',
    };
  }
}

/**
 * Get remaining time for verification code (minutes)
 */
export function getCodeExpiryTime(email) {
  const normalizedEmail = email.toLowerCase().trim();
  const stored = verificationCodes.get(normalizedEmail);

  if (!stored) {
    return null;
  }

  const remainingMs = Math.max(0, stored.expiresAt - Date.now());
  const remainingMinutes = Math.ceil(remainingMs / 60 / 1000);

  return remainingMinutes;
}

/**
 * Check if verification code exists for email
 */
export function hasVerificationCode(email) {
  const normalizedEmail = email.toLowerCase().trim();
  return verificationCodes.has(normalizedEmail);
}

export default {
  generateVerificationCode,
  saveVerificationCode,
  verifyCode,
  sendVerificationEmail,
  getCodeExpiryTime,
  hasVerificationCode,
};
