import dotenv from "dotenv";
dotenv.config();

import { cleanEnv, str, port, bool, num } from "envalid";

/**
 * IMPORTANT:
 * - No fallback to localhost for MongoDB
 * - Fail fast if critical env missing
 */
const env = cleanEnv(process.env, {
  NODE_ENV: str({
    default: "development",
    choices: ["development", "production", "test"],
  }),

  PORT: port({ default: 5000 }),

  // 🔥 MUST BE PROVIDED IN .env (NO DEFAULT LOCALHOST)
  MONGODB_URI: str({
    desc: "MongoDB connection string (Atlas or local)",
  }),

  JWT_SECRET: str({
    default: "development-secret-change-me",
    devDefault: "development-secret-change-me",
    custom: {
      validator: (value) => value.length >= 6,
      message: "JWT_SECRET must be at least 6 characters long",
    },
  }),

  CLIENT_ORIGINS: str({
    default:
      "https://fix-it-now-omega.vercel.app,https://fixitnow-admin.vercel.app,https://fix-it-now-admin-panal.vercel.app,http://localhost:3000,http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176",
  }),

  SUPER_ADMIN_EMAIL: str({ default: "" }),
  SUPER_ADMIN_NAME: str({ default: "" }),
  SUPER_ADMIN_PHONE: str({ default: "" }),
  SUPER_ADMIN_PIN: str({ default: "" }),

  USE_REFRESH_TOKENS: bool({ default: true }),
  USE_HTTPONLY_AUTH: bool({ default: true }),

  ACCESS_TOKEN_EXPIRY_MINUTES: num({ default: 15 }),
  REFRESH_TOKEN_EXPIRY_DAYS: num({ default: 7 }),

  REDIS_URL: str({ default: "" }),
  REDIS_PASSWORD: str({ default: "" }),

  LOG_LEVEL: str({
    default: "info",
    choices: ["error", "warn", "info", "debug"],
  }),

  /** Resend API key — https://resend.com/api-keys (HTTP; works on Railway) */
  RESEND_API_KEY: str({ default: "" }),

  /** Verified sender in Resend (e.g. noreply@yourdomain.com) */
  EMAIL_FROM: str({ default: "onboarding@resend.dev" }),
  EMAIL_FROM_NAME: str({ default: "Fix It Now" }),

  FRONTEND_URL: str({ default: "https://fix-it-now-omega.vercel.app" }),

  ADMIN_FRONTEND_URL: str({ default: "https://fixitnow-admin.vercel.app" }),

  /** Google OAuth Web client ID (same as VITE_GOOGLE_CLIENT_ID on frontend) */
  GOOGLE_CLIENT_ID: str({ default: "" }),

  VAPID_PUBLIC_KEY: str({ default: "" }),
  VAPID_PRIVATE_KEY: str({ default: "" }),
  VAPID_SUBJECT: str({ default: "mailto:support@fixitnow.app" }),
});

if (
  env.NODE_ENV === "production" &&
  (!env.MONGODB_URI || env.MONGODB_URI.includes("localhost"))
) {
  throw new Error(
    "Invalid MONGODB_URI for production. Set a MongoDB Atlas connection string.",
  );
}

if (env.NODE_ENV === "production") {
  const weakSecrets = [
    "development-secret-change-me",
    "your-secret-key",
    "changeme",
  ];
  if (
    !env.JWT_SECRET ||
    env.JWT_SECRET.length < 32 ||
    weakSecrets.includes(env.JWT_SECRET)
  ) {
    throw new Error(
      "JWT_SECRET must be at least 32 random characters in production.",
    );
  }

  const origins = env.CLIENT_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  if (origins.length === 0) {
    throw new Error("CLIENT_ORIGINS must list your production frontend URLs.");
  }
}

export default env;