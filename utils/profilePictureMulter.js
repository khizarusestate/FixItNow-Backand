import multer from "multer";
import fs from "fs";
import { generateSecureFilename } from "./fileValidation.js";
import { uploadsSubdir } from "./uploadPaths.js";

const uploadsDir = uploadsSubdir("profile-pictures");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const userId =
      req.customer?.id || req.worker?.id || req.user?.id || "user";
    const secureName = generateSecureFilename(file.originalname, userId);
    cb(null, secureName);
  },
});

const imageFilter = (_req, file, cb) => {
  const allowed = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/tiff",
    "image/avif",
  ]);
  if (!allowed.has(file.mimetype)) {
    return cb(new Error("Unsupported image format. Please upload a JPG, PNG, GIF, WebP, BMP, TIFF, or AVIF image."), false);
  }
  cb(null, true);
};

export const profilePictureUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: imageFilter,
});

export const profilePicturesDir = uploadsDir;
