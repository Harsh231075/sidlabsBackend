const express = require('express');
const { authenticate, requireRole } = require('../../utils/auth');
const responseCache = require('../../middleware/responseCache');
const postsController = require('./posts.controller');

const router = express.Router();

router.get('/', authenticate, responseCache(10), postsController.getPosts);

router.get('/feed-stats', authenticate, responseCache(30), postsController.getFeedStats);

router.get('/reported', authenticate, requireRole(['admin-user', 'moderator-user']), postsController.getReportedPosts);

router.post('/', authenticate, postsController.createPost);

router.post('/:id/like', authenticate, postsController.likePost);

router.post('/:id/report', authenticate, postsController.reportPost);

router.post('/:id/remove', authenticate, postsController.removePost);

router.put('/:postId', authenticate, postsController.updatePost);

router.put('/:postId/review', authenticate, requireRole(['admin-user', 'moderator-user']), postsController.reviewPost);

router.get('/:id/comments', authenticate, responseCache(5), postsController.getPostComments);

router.post('/:id/comments', authenticate, postsController.addPostComment);

router.get('/:id', authenticate, postsController.getPostById);

module.exports = router;
