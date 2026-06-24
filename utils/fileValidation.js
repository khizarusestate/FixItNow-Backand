import fs from "fs";
import path from "path";

// Magic byte signatures for common file types
const MAGIC_BYTES = {
  // Images
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/jpg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/gif": [0x47, 0x49, 0x46, 0x38],
  "image/webp": [0x52, 0x49, 0x46, 0x46],
  "image/svg+xml": null, // SVG is text-based, handled separately
  "image/bmp": [0x42, 0x4d],
  "image/tiff": [0x49, 0x49, 0x2a, 0x00],

  // Videos
  "video/mp4": [0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70],
  "video/webm": [0x1a, 0x45, 0xdf, 0xa3],
  "video/quicktime": [0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70],
  "application/pdf": [0x25, 0x50, 0x44, 0x46],
};

// Allowed MIME types
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "video/mp4",
  "video/webm",
  "application/pdf",
]);

// Allowed file extensions
const ALLOWED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".mp4",
  ".webm",
  ".mov",
  ".pdf",
]);

/**
 * Validate file extension
 */
export const validateExtension = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`File extension ${ext} is not allowed`);
  }
  return ext;
};

/**
 * Validate MIME type
 */
export const validateMimeType = (mimeType) => {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(`MIME type ${mimeType} is not allowed`);
  }
  return mimeType;
};

/**
 * Read magic bytes from file
 */
const readMagicBytes = (filePath, byteCount = 12) => {
  try {
    const buffer = Buffer.alloc(byteCount);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buffer, 0, byteCount, 0);
    fs.closeSync(fd);
    return buffer;
  } catch (error) {
    throw new Error("Failed to read file for magic byte validation");
  }
};

/**
 * Validate magic bytes against expected MIME type
 */
export const validateMagicBytes = (filePath, mimeType) => {
  // Skip magic byte validation for SVG (text-based) and MOV/quicktime variants
  if (mimeType === "image/svg+xml" || mimeType === "video/quicktime") {
    return true;
  }

  const expectedBytes = MAGIC_BYTES[mimeType];
  if (!expectedBytes) {
    return true;
  }

  try {
    const buffer = readMagicBytes(filePath, expectedBytes.length);

    for (let i = 0; i < expectedBytes.length; i++) {
      if (expectedBytes[i] !== null && buffer[i] !== expectedBytes[i]) {
        throw new Error(
          `File magic bytes do not match expected ${mimeType} format`,
        );
      }
    }

    return true;
  } catch (error) {
    throw new Error(`Magic byte validation failed: ${error.message}`);
  }
};

/**
 * Comprehensive file validation
 */
export const validateFile = async (filePath, filename, mimeType) => {
  // Validate extension
  const ext = validateExtension(filename);

  // Validate MIME type
  validateMimeType(mimeType);

  // Validate extension matches MIME type
  const extToMime = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".pdf": "application/pdf",
  };

  if (extToMime[ext] !== mimeType) {
    throw new Error(
      `File extension ${ext} does not match MIME type ${mimeType}`,
    );
  }

  // Validate the file content using magic bytes
  validateMagicBytes(filePath, mimeType);

  return true;
};

/**
 * Generate secure filename
 */
export const generateSecureFilename = (originalFilename, userId = null) => {
  const ext = path.extname(originalFilename).toLowerCase();
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const prefix = userId ? `${userId}_` : "";
  return `${prefix}${timestamp}_${random}${ext}`;
};

/**
 * Sanitize filename to prevent path traversal
 */
export const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "");
};
