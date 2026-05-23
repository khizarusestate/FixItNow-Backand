import { validateExtension, validateMimeType, generateSecureFilename, sanitizeFilename } from '../utils/fileValidation.js';

describe('File Validation Utilities', () => {
  describe('validateExtension', () => {
    it('should accept valid image extensions', () => {
      expect(() => validateExtension('test.jpg')).not.toThrow();
      expect(() => validateExtension('test.png')).not.toThrow();
      expect(() => validateExtension('test.jpeg')).not.toThrow();
      expect(() => validateExtension('test.webp')).not.toThrow();
    });

    it('should reject invalid extensions', () => {
      expect(() => validateExtension('test.exe')).toThrow();
      expect(() => validateExtension('test.bat')).toThrow();
      expect(() => validateExtension('test.sh')).toThrow();
    });
  });

  describe('validateMimeType', () => {
    it('should accept valid MIME types', () => {
      expect(() => validateMimeType('image/jpeg')).not.toThrow();
      expect(() => validateMimeType('image/png')).not.toThrow();
      expect(() => validateMimeType('image/webp')).not.toThrow();
    });

    it('should reject invalid MIME types', () => {
      expect(() => validateMimeType('application/exe')).toThrow();
      expect(() => validateMimeType('text/html')).toThrow();
    });
  });

  describe('generateSecureFilename', () => {
    it('should generate unique filename', () => {
      const filename1 = generateSecureFilename('test.jpg');
      const filename2 = generateSecureFilename('test.jpg');
      expect(filename1).not.toBe(filename2);
    });

    it('should preserve extension', () => {
      const filename = generateSecureFilename('test.jpg');
      expect(filename).toMatch(/\.jpg$/);
    });

    it('should include user ID when provided', () => {
      const userId = '507f1f77bcf86cd799439011';
      const filename = generateSecureFilename('test.jpg', userId);
      expect(filename).toContain(userId);
    });
  });

  describe('sanitizeFilename', () => {
    it('should remove special characters', () => {
      const sanitized = sanitizeFilename('test@#$file.jpg');
      expect(sanitized).toBe('test_file.jpg');
    });

    it('should prevent path traversal', () => {
      const sanitized = sanitizeFilename('../../../etc/passwd');
      expect(sanitized).not.toContain('..');
    });

    it('should remove leading dots', () => {
      const sanitized = sanitizeFilename('.hidden.jpg');
      expect(sanitized).not.toMatch(/^\./);
    });
  });
});
