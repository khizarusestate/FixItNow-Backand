import express from "express";
import env from "../utils/env.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { getMaintenanceStatus } from "../middleware/maintenanceMode.js";

const router = express.Router();

/** Public maintenance status for customer frontend overlay. */
router.get(
  "/maintenance-status",
  asyncHandler(async (_req, res) => {
    const status = await getMaintenanceStatus();
    return res.json({ success: true, data: status });
  }),
);

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
