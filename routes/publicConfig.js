import express from "express";
import env from "../utils/env.js";

const router = express.Router();

/** Public client config (no secrets). */
router.get("/config", (_req, res) => {
  const googleClientId = String(
    process.env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || "",
  ).trim();

  res.json({
    success: true,
    googleClientId: googleClientId || null,
  });
});

export default router;
