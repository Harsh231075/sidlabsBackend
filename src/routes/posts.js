const express = require('express');
const { authenticate, requireRole } = require('../utils/auth');
const postsController = require('../controllers/postsController');

const router = express.Router();

// Get all posts (optionally filtered by groupId)
router.get('/', authenticate, postsController.getPosts);

// Create a new post
router.post('/', authenticate, postsController.createPost);

// Like or unlike a post
router.post('/:id/like', authenticate, postsController.likePost);

// Report a post
router.post('/:id/report', authenticate, postsController.reportPost);

// Remove a post (admin/moderator only)
router.post('/:id/remove', authenticate, requireRole(['admin-user', 'moderator-user']), postsController.removePost);

// Get comments for a post
router.get('/:id/comments', authenticate, postsController.getPostComments);

// Add a comment to a post
router.post('/:id/comments', authenticate, postsController.addPostComment);

module.exports = router;
