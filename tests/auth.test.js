import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { verifyToken, createAccessToken } from '../utils/jwt.js';
import { validateTokenStructure } from '../utils/jwt.js';
import env from '../utils/env.js';

describe('JWT Utilities', () => {
  const mockUser = {
    id: '507f1f77bcf86cd799439011',
    role: 'customer',
    email: 'test@example.com'
  };

  describe('createAccessToken', () => {
    it('should create a valid access token', () => {
      const token = createAccessToken(mockUser);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });

    it('should decode to correct user data', () => {
      const token = createAccessToken(mockUser);
      const decoded = jwt.decode(token);
      expect(decoded.id).toBe(mockUser.id);
      expect(decoded.role).toBe(mockUser.role);
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', () => {
      const token = createAccessToken(mockUser);
      const decoded = verifyToken(token);
      expect(decoded.id).toBe(mockUser.id);
      expect(decoded.role).toBe(mockUser.role);
    });

    it('should throw error for invalid token', () => {
      expect(() => verifyToken('invalid-token')).toThrow();
    });

    it('should throw error for expired token', () => {
      const expiredToken = jwt.sign(mockUser, env.JWT_SECRET, {
        expiresIn: '-1h',
        algorithm: 'HS256',
      });
      expect(() => verifyToken(expiredToken)).toThrow('Token expired');
    });
  });

  describe('validateTokenStructure', () => {
    it('should validate correct token structure', () => {
      const validToken = {
        id: '507f1f77bcf86cd799439011',
        role: 'customer',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      };
      expect(validateTokenStructure(validToken)).toBe(true);
    });

    it('should reject token without id', () => {
      const invalidToken = {
        role: 'customer',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      };
      expect(validateTokenStructure(invalidToken)).toBe(false);
    });

    it('should reject token without role', () => {
      const invalidToken = {
        id: '507f1f77bcf86cd799439011',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      };
      expect(validateTokenStructure(invalidToken)).toBe(false);
    });
  });
});

describe('Password Hashing', () => {
  describe('bcrypt', () => {
    it('should hash password correctly', async () => {
      const password = 'testPassword123';
      const hashedPassword = await bcrypt.hash(password, 12);
      expect(hashedPassword).not.toBe(password);
      expect(hashedPassword.length).toBeGreaterThan(50);
    });

    it('should compare password correctly', async () => {
      const password = 'testPassword123';
      const hashedPassword = await bcrypt.hash(password, 12);
      const isMatch = await bcrypt.compare(password, hashedPassword);
      expect(isMatch).toBe(true);
    });

    it('should reject wrong password', async () => {
      const password = 'testPassword123';
      const wrongPassword = 'wrongPassword';
      const hashedPassword = await bcrypt.hash(password, 12);
      const isMatch = await bcrypt.compare(wrongPassword, hashedPassword);
      expect(isMatch).toBe(false);
    });
  });
});
