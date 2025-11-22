import express from "express";
import { addComment, getComments, updateComment, deleteComment } from "../controllers/comment.js";
import authenticate from "../middlewares/authentication.js";

const router = express.Router();

// POST /api/comments/comment/:pollId - Add a comment to a poll (requires auth)
router.post("/comment/:pollId", authenticate, addComment);

// GET /api/comments/comment/:pollId - Get all comments for a poll (public)
router.get("/comment/:pollId", getComments);

// PUT /api/comments/comment/:id - Update a comment (requires auth)
router.put("/comment/:id", authenticate, updateComment);

// DELETE /api/comments/comment/:id - Delete a comment (requires auth)
router.delete("/comment/:id", authenticate, deleteComment);

export default router;
