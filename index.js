import dotenv from "dotenv";
dotenv.config();

// ─── Global Error Handlers ───────────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  console.error("⚠️ UNCAUGHT EXCEPTION:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("⚠️ UNHANDLED REJECTION:", reason);
  // Don't crash the entire API on a single rejected promise.
  // We'll rely on logs + fixes rather than downtime.
});

// ─── Env ────────────────────────────────────────~─────────────────────────────
import "./utils/env.js";

// ─── Imports ────────────────────────────────────────────────────────────────
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

import routes from "./routes/index.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { verifyToken } from "./utils/jwt.js";
import logger from "./utils/logger.js";
import {
  authRateLimit,
  apiRateLimit,
  strictRateLimit,
  sanitizeMongo,
  sanitizeXSS,
  requestTimeout,
  handleTimeout,
  securityHeaders,
  validateContentType,
  preventParameterPollution,
} from "./middleware/security.js";

import env from "./utils/env.js";
import Admin from "./models/Admin.js";
import Customer from "./customerSchema.js";
import Worker from "./workerSchema.js";
import { cleanupLegacyMongoSuperAdmins } from "./services/envSuperAdmin.js";
import { normalizeLegacyDbStatuses } from "./utils/dbNormalize.js";
import { initCache, closeCache } from "./utils/cache.js";
import emailService from "./services/emailService.js";
import { startEmailWorker } from "./utils/emailQueue.js";

import {
  initializeSocketIO,
  setUserSocket,
  removeUserSocket,
  addAdminSocket,
  removeAdminSocket,
  isAdminConnected,
  emitToAdmin,
  emitToSuperAdmins,
} from "./utils/socketManager.js";
import {
  setUserPresenceOnline,
  setUserPresenceOffline,
} from "./utils/userPresence.js";
import { getAccessTokenFromRequest } from "./utils/authCookies.js";

// ❌ REMOVED: Redis import
// import { initRedis } from "./utils/cache.js";

const app = express();

/** Railway/Vercel/Render sit behind a reverse proxy — required for rate-limit + secure cookies. */
const behindReverseProxy =
  env.NODE_ENV === "production" ||
  process.env.TRUST_PROXY === "1" ||
  process.env.TRUST_PROXY === "true" ||
  Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_SERVICE_NAME ||
      process.env.RENDER ||
      process.env.FLY_APP_NAME,
  );

if (behindReverseProxy) {
  app.set("trust proxy", 1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const httpServer = createServer(app);

// ─── CORS ────────────────────────────────────────────────────────────────────
function normalizeOrigin(url) {
  if (!url || typeof url !== "string") return "";
  return url.trim().replace(/\/$/, "");
}

function buildAllowedOrigins() {
  const origins = new Set();
  const add = (value) => {
    const normalized = normalizeOrigin(value);
    if (normalized) origins.add(normalized);
  };

  const clientList = process.env.CLIENT_ORIGINS || env.CLIENT_ORIGINS || "";
  clientList
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
    .forEach(add);

  add(process.env.FRONTEND_URL || env.FRONTEND_URL);
  add(process.env.ADMIN_FRONTEND_URL || env.ADMIN_FRONTEND_URL);
  add(process.env.VITE_APP_URL);

  if (origins.size === 0) {
    [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "http://localhost:5176",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
      "http://127.0.0.1:5175",
      "http://127.0.0.1:5176",
      "https://fix-it-now-omega.vercel.app",
      "https://fixitnow-admin.vercel.app",
      "https://fix-it-now-admin-panal.vercel.app",
    ].forEach(add);
  }

  return origins;
}

const ALLOWED_ORIGINS = buildAllowedOrigins();

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const normalized = normalizeOrigin(origin);
    if (ALLOWED_ORIGINS.has(normalized)) return callback(null, true);
    logger.warn("CORS blocked request", {
      origin: normalized,
      allowed: [...ALLOWED_ORIGINS],
    });
    return callback(new Error(`CORS: origin not allowed (${normalized})`));
  },
  credentials: true,
};

// ─── Socket.IO ───────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: corsOptions,
});

initializeSocketIO(io);

io.on("connection", (socket) => {
  logger.info("Client connected", {
    socketId: socket.id,
    ip: socket.handshake.address,
  });

  socket.on("join-admin", async (tokenArg) => {
    try {
      const token =
        typeof tokenArg === "string" && tokenArg
          ? tokenArg
          : getAccessTokenFromRequest({
              headers: { cookie: socket.handshake.headers.cookie || "" },
            });
      if (!token) {
        return socket.emit("error", { message: "Admin token required" });
      }
      // token may come from httpOnly cookie when client emits join-admin without body
      const decoded = verifyToken(token);

      if (decoded.role !== "admin") {
        return socket.emit("error", { message: "Admin access required" });
      }

      const { isEnvSuperAdminToken, ENV_SUPER_ADMIN_ID } = await import(
        "./services/envSuperAdmin.js"
      );
      if (isEnvSuperAdminToken(decoded)) {
        const adminId = ENV_SUPER_ADMIN_ID;
        const becameOnline = addAdminSocket(adminId, socket.id);
        socket.join("admin-room");
        socket.join(`admin:${adminId}`);
        socket.isAdmin = true;
        socket.adminId = adminId;
        socket.adminPanelRole = "super_admin";
        socket.join("super-admin-room");
        if (becameOnline) {
          emitToAdmin("admin-status-updated", {
            adminId,
            status: "active",
            adminRole: "super_admin",
            timestamp: new Date().toISOString(),
          });
        }
        logger.info("Super admin joined (env)", { adminId });
        return;
      }

      const adminDoc = await Admin.findById(decoded.id).select("isActive role");
      if (!adminDoc) {
        return socket.emit("error", { message: "Admin account not found" });
      }
      if (!adminDoc.isActive) {
        return socket.emit("error", {
          message: "Admin account deactivated",
          code: "ADMIN_DEACTIVATED",
        });
      }

      const adminId = String(decoded.id);
      const becameOnline = addAdminSocket(adminId, socket.id);

      socket.join("admin-room");
      socket.join(`admin:${adminId}`);

      socket.isAdmin = true;
      socket.adminId = adminId;
      socket.adminPanelRole = decoded.adminRole || null;

      if (decoded.adminRole === "super_admin") {
        socket.join("super-admin-room");
      }

      if (becameOnline) {
        emitToAdmin("admin-status-updated", {
          adminId,
          status: "active",
          adminRole: decoded.adminRole || "admin",
          timestamp: new Date().toISOString(),
        });
        emitToSuperAdmins("admin-status-updated", {
          adminId,
          status: "active",
          adminRole: decoded.adminRole || "admin",
          timestamp: new Date().toISOString(),
        });
        emitToSuperAdmins("admin-team-updated", {
          action: "connected",
          adminId,
          timestamp: new Date().toISOString(),
        });
      }

      logger.info("Admin joined", { adminId });
    } catch (err) {
      socket.emit("error", { message: "Invalid token" });
    }
  });

  socket.on("join-user", async (data) => {
    const token =
      data?.token ||
      getAccessTokenFromRequest({
        headers: { cookie: socket.handshake.headers.cookie || "" },
      });

    if (!token) {
      return socket.emit("error", { message: "Token required" });
    }

    try {
      const decoded = verifyToken(token);
      if (decoded.role !== "customer" && decoded.role !== "worker") {
        return socket.emit("error", { message: "User access required" });
      }

      const userId = String(decoded.id || "");
      if (!userId) {
        return socket.emit("error", { message: "Invalid token" });
      }

      // Optional client userId must match token identity
      if (data?.userId && String(data.userId) !== userId) {
        return socket.emit("error", { message: "User mismatch" });
      }

      if (decoded.role === "worker") {
        const worker = await Worker.findOne({
          _id: userId,
          isDeleted: { $ne: true },
        })
          .select("isDisabled status")
          .lean();
        if (!worker) {
          return socket.emit("error", { message: "Worker account not found" });
        }
        if (worker.isDisabled) {
          return socket.emit("error", {
            message: "Worker account disabled",
            code: "WORKER_DISABLED",
          });
        }
        if (worker.status === "rejected") {
          return socket.emit("error", {
            message: "Worker account rejected",
            code: "WORKER_REJECTED",
          });
        }
      } else {
        const customer = await Customer.findOne({
          _id: userId,
          isDeleted: { $ne: true },
        })
          .select("isActive status")
          .lean();
        if (!customer) {
          return socket.emit("error", { message: "Customer account not found" });
        }
        if (customer.isActive === false) {
          return socket.emit("error", {
            message: "Customer account deactivated",
            code: "CUSTOMER_DEACTIVATED",
          });
        }
        if (customer.status === "rejected") {
          return socket.emit("error", {
            message: "Customer account rejected",
            code: "CUSTOMER_REJECTED",
          });
        }
      }

      setUserSocket(userId, socket.id);
      socket.userId = userId;
      socket.userRole = decoded.role;

      if (decoded.role === "worker") {
        socket.join("workers-room");
      }
      setUserPresenceOnline(userId, decoded.role);
      logger.info("User joined", { userId, role: decoded.role });
    } catch {
      socket.emit("error", { message: "Invalid token" });
    }
  });

  socket.on("disconnect", () => {
    if (socket.userId) {
      const role = socket.userRole;
      removeUserSocket(socket.userId);
      if (role === "customer" || role === "worker") {
        setUserPresenceOffline(socket.userId, role);
      }
    }

    if (socket.isAdmin && socket.adminId) {
      const becameOffline = removeAdminSocket(socket.adminId, socket.id);
      if (becameOffline) {
        emitToAdmin("admin-status-updated", {
          adminId: socket.adminId,
          status: "inactive",
          adminRole: socket.adminPanelRole || "admin",
          timestamp: new Date().toISOString(),
        });
        emitToSuperAdmins("admin-status-updated", {
          adminId: socket.adminId,
          status: "inactive",
          adminRole: socket.adminPanelRole || "admin",
          timestamp: new Date().toISOString(),
        });
        emitToSuperAdmins("admin-team-updated", {
          action: "disconnected",
          adminId: socket.adminId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  });
});

// ─── App Config ──────────────────────────────────────────────────────────────
const PORT = env.PORT || 5000;

app.use(cors(corsOptions));
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(securityHeaders);
app.use(sanitizeMongo);
app.use(sanitizeXSS);
app.use(requestTimeout);
app.use(handleTimeout);
app.use(validateContentType);
app.use(preventParameterPollution);

// ─── Uploads ────────────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, "uploads");

const folders = [
  "admin-profiles",
  "advertisements",
  "profile-pictures",
  "payment-receipts",
  "worker-verification",
];

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

folders.forEach((f) => {
  const p = path.join(uploadsDir, f);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

app.use(
  "/uploads",
  cors(corsOptions),
  (req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  async (req, res, next) => {
    // Sensitive folders must require an admin token (cookie-supported).
    const p = String(req.path || "");
    const isSensitive =
      p.startsWith("/payment-receipts/") ||
      p.startsWith("/admin-profiles/") ||
      p.startsWith("/worker-verification/");
    if (!isSensitive) return next();

    const token = getAccessTokenFromRequest({
      headers: {
        cookie: req.headers.cookie || "",
        authorization: req.headers.authorization || "",
      },
    });
    if (!token) {
      return res
        .status(401)
        .json({ success: false, message: "Authorization required." });
    }

    try {
      const decoded = verifyToken(token);
      if (decoded.role !== "admin") {
        return res
          .status(403)
          .json({ success: false, message: "Admin access required." });
      }

      const { isEnvSuperAdminToken } = await import("./services/envSuperAdmin.js");
      if (isEnvSuperAdminToken(decoded)) return next();

      const adminDoc = await Admin.findById(decoded.id).select("isActive").lean();
      if (!adminDoc) {
        return res
          .status(401)
          .json({ success: false, message: "Admin account not found." });
      }
      if (!adminDoc.isActive) {
        return res
          .status(403)
          .json({ success: false, message: "Admin account deactivated." });
      }

      return next();
    } catch {
      return res.status(401).json({ success: false, message: "Invalid token." });
    }
  },
  express.static(path.join(__dirname, "uploads"), {
    maxAge: process.env.NODE_ENV === "production" ? "7d" : 0,
    etag: true,
    lastModified: true,
  }),
);

// ─── Rate Limit ──────────────────────────────────────────────────────────────
app.use("/api", apiRateLimit);
app.use("/api/auth", authRateLimit);
app.use("/api/admin/login", strictRateLimit);

// ─── Logging ────────────────────────────────────────────────────────────────
app.use(
  morgan(process.env.NODE_ENV === "production" ? "combined" : "dev", {
    stream: { write: (msg) => logger.http(msg.trim()) },
  }),
);

// ─── Body Parser ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb", strict: true }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use("/api", routes);

app.get("/health", async (req, res) => {
  const dbOk = mongoose.connection.readyState === 1;
  const emailConfigured = Boolean(String(env.RESEND_API_KEY || "").trim());
  res.status(dbOk ? 200 : 503).json({
    success: dbOk,
    message: dbOk ? "FixItNow API running" : "Database not connected",
    uptime: process.uptime(),
    env: env.NODE_ENV,
    checks: {
      database: dbOk ? "ok" : "down",
      email: emailConfigured ? "configured" : "missing",
    },
  });
});

// ─── Errors ──────────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── MongoDB Connection ──────────────────────────────────────────────────────
async function connectDB(uri) {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });

  console.log("✅ MongoDB connected");

  mongoose.connection.on("error", (err) =>
    console.error("Mongo error:", err.message),
  );
}

// ─── Start Server ────────────────────────────────────────────────────────────
async function startServer() {
  try {
    console.log("🚀 Starting API...");
    console.log("🌐 Env:", env.NODE_ENV);

    if (!env.MONGODB_URI) {
      throw new Error("MONGODB_URI missing");
    }

    await connectDB(env.MONGODB_URI);
    await initCache();
    startEmailWorker(emailService, 5000);
    await cleanupLegacyMongoSuperAdmins();
    await normalizeLegacyDbStatuses();
    httpServer.listen(PORT, () => {
      logger.info("Server started", {
        port: PORT,
        env: env.NODE_ENV,
      });

      console.log(`✅ Server running on ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Startup error:", err);
    process.exit(1);
  }
}

// ─── Shutdown ────────────────────────────────────────────────────────────────
process.on("SIGINT", async () => {
  await closeCache();
  await mongoose.connection.close();
  io.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeCache();
  await mongoose.connection.close();
  io.close();
  process.exit(0);
});

// ─── Run ─────────────────────────────────────────────────────────────────────
startServer();

export default app;
export { io };
