import Comment from "../models/comment.js";

// CREATE comment
export const addComment = async (req, res) => {
  try {
    const { text } = req.body;
    const { pollId } = req.params;

    if (!text || !pollId) {
      return res.send({ success: false, message: "Missing required fields" });
    }

    const requestUserId = (req.user?.id || req.user?._id)?.toString();

    if (!requestUserId) {
      return res.status(401).send({ success: false, message: "Unauthorized" });
    }

    const comment = await Comment.create({
      userId: requestUserId,
      pollId,
      text,
    });

    return res.send({ success: true, message: "Comment added", comment });
  } catch (error) {
    console.error(error);
    return res.send({ success: false, message: "Server error" });
  }
};

// GET all comments for a poll
export const getComments = async (req, res) => {
  try {
    const { pollId } = req.params;

    const comments = await Comment.find({ pollId })
      .populate("userId") // populate user info
      .sort({ createdAt: 1 }); // oldest first, optional

   return res.send({ success: true, comments });
  } catch (error) {
    console.error(error);
   return res.send({ success: false, message: "Server error" });
  }
};

// UPDATE comment
export const updateComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    if (!text) return res.send({ success: false, message: "Text is required" });

    const comment = await Comment.findById(id);

    if (!comment) return res.status(404).json({ success: false, message: "Comment not found" });

    const requestUserId = (req.user?.id || req.user?._id)?.toString();

    // only comment owner can update
    if (!requestUserId || comment.userId.toString() !== requestUserId) {
      return res.status(401).send({ success: false, message: "Unauthorized" });
    }

    comment.text = text;
    await comment.save();

   return res.send({ success: true, message: "Comment updated", comment });
  } catch (error) {
    console.error(error);
    return res.send({ success: false, message: "Server error" });
  }
};

// DELETE comment
export const deleteComment = async (req, res) => {
  try {
    const { id } = req.params;

    const comment = await Comment.findById(id);

    if (!comment) return res.status(404).json({ success: false, message: "Comment not found" });

    // only comment owner can delete
    const requestUserId = (req.user?.id || req.user?._id)?.toString();

    if (!requestUserId || comment.userId.toString() !== requestUserId) {
      return res.status(401).send({ success: false, message: "Unauthorized" });
    }

    await comment.deleteOne();

    return res.send({ success: true, message: "Comment deleted" });
  } catch (error) {
    console.error(error);
    return res.send({ success: false, message: "Server error" });
  }
};
