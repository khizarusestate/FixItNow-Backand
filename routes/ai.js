import express from "express";
import { chatWithAI } from "../controllers/aiController.js";
import { aiRateLimit } from "../middleware/security.js";

const router = express.Router();

router.post("/chat", aiRateLimit, chatWithAI);

export default router;
