import express from "express";
import { handleQuery } from "../controllers/chatbot.js";
import authenticate from "../middlewares/authentication.js";

const router = express.Router();

// POST /api/chat/query - Handle chatbot queries
router.post("/query", handleQuery);

export default router;
