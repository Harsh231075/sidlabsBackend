const express = require('express');
const { authenticate, requireRole } = require('../utils/auth');
const postsController = require('../controllers/postsController');

const router = express.Router();

// Get all posts (optionally filtered by groupId) - Uses Smart Feed by default
router.get('/', authenticate, postsController.getPosts);

// Get feed stats (shows connections affecting smart feed)
router.get('/feed-stats', authenticate, postsController.getFeedStats);

// Get reported posts (admin/moderator only)
router.get('/reported', authenticate, requireRole(['admin-user', 'moderator-user']), postsController.getReportedPosts);

// Create a new post
router.post('/', authenticate, postsController.createPost);

// Like or unlike a post
router.post('/:id/like', authenticate, postsController.likePost);

// Report a post
router.post('/:id/report', authenticate, postsController.reportPost);

// Remove a post (admin/moderator or author)
router.post('/:id/remove', authenticate, postsController.removePost);

// Update a post (author only)
router.put('/:postId', authenticate, postsController.updatePost);

// Review a post (approve/reject - moderator/admin only)
router.put('/:postId/review', authenticate, requireRole(['admin-user', 'moderator-user']), postsController.reviewPost);

// Get comments for a post
router.get('/:id/comments', authenticate, postsController.getPostComments);

// Add a comment to a post
router.post('/:id/comments', authenticate, postsController.addPostComment);

module.exports = router;
