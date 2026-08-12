import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Canonical uploads root — always resolved relative to this file's own
 * location on disk, not process.cwd(). This matters because index.js's
 * static file server (`app.use("/uploads", ..., express.static(...))`)
 * also resolves relative to its own file location — if some upload routes
 * used process.cwd() instead (which depends on the directory the Node
 * process was launched from, e.g. via PM2), a mismatch between the two
 * would mean files upload successfully but 404 forever when fetched back.
 */
export const UPLOADS_ROOT = path.join(__dirname, "..", "uploads");

export function uploadsSubdir(...segments) {
  return path.join(UPLOADS_ROOT, ...segments);
}
