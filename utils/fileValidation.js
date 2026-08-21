import fs from "fs";
import path from "path";

export const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;

// Magic byte signatures for common file types
const MAGIC_BYTES = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/jpg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/gif": [0x47, 0x49, 0x46, 0x38],
  "image/webp": [0x52, 0x49, 0x46, 0x46],
  "image/svg+xml": null,
  "image/bmp": [0x42, 0x4d],
  "image/tiff": [0x49, 0x49, 0x2a, 0x00],
  "image/avif": null,
  "video/mp4": [0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70],
  "video/webm": [0x1a, 0x45, 0xdf, 0xa3],
  "video/quicktime": [0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70],
  "application/pdf": [0x25, 0x50, 0x44, 0x46],
};

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/tiff",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/pdf",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".tif",
  ".tiff",
  ".avif",
  ".mp4",
  ".webm",
  ".mov",
  ".pdf",
]);

const EXT_TO_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
};

const IMAGE_MIME_TYPES = new Set(
  [...ALLOWED_MIME_TYPES].filter((mime) => mime.startsWith("image/")),
);

export const validateExtension = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error(`File extension ${ext} is not allowed`);
  return ext;
};

export const validateMimeType = (mimeType) => {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error(`MIME type ${mimeType} is not allowed`);
  return mimeType;
};

const readMagicBytes = (filePath, byteCount = 12) => {
  try {
    const buffer = Buffer.alloc(byteCount);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buffer, 0, byteCount, 0);
    fs.closeSync(fd);
    return buffer;
  } catch {
    throw new Error("Failed to read file for magic byte validation");
  }
};

export const validateMagicBytes = (filePath, mimeType) => {
  if (mimeType === "image/svg+xml" || mimeType === "image/avif" || mimeType === "video/quicktime") return true;

  const expectedBytes = MAGIC_BYTES[mimeType];
  if (!expectedBytes) return true;

  try {
    const buffer = readMagicBytes(filePath, expectedBytes.length);
    for (let i = 0; i < expectedBytes.length; i++) {
      if (expectedBytes[i] !== null && buffer[i] !== expectedBytes[i]) {
        throw new Error(`File magic bytes do not match expected ${mimeType} format`);
      }
    }
    return true;
  } catch (error) {
    throw new Error(`Magic byte validation failed: ${error.message}`);
  }
};

export const validateFile = async (filePath, filename, mimeType) => {
  const ext = validateExtension(filename);
  validateMimeType(mimeType);

  if (EXT_TO_MIME[ext] !== mimeType) {
    throw new Error(`File extension ${ext} does not match MIME type ${mimeType}`);
  }

  validateMagicBytes(filePath, mimeType);
  return true;
};

export const validateImageFile = async (filePath, filename, mimeType) => {
  if (!IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported image format: ${mimeType}`);
  }

  const stats = await fs.promises.stat(filePath);
  if (stats.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("Image must be 2 MB or smaller.");
  }

  return validateFile(filePath, filename, mimeType);
};

export const generateSecureFilename = (originalFilename, userId = null) => {
  const ext = path.extname(originalFilename).toLowerCase();
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const prefix = userId ? `${userId}_` : "";
  return `${prefix}${timestamp}_${random}${ext}`;
};

export const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "");
};
