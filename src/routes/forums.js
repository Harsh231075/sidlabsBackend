const express = require('express');
const { authenticate, requireRole } = require('../utils/auth');
const forumsController = require('../controllers/forumsController');

const router = express.Router();

// GET /forums/:groupId/threads - List threads for a group (or global if groupId is 'global')
router.get('/:groupId/threads', authenticate, forumsController.getThreads);

// POST /forums/:groupId/threads - Create a new thread
router.post('/:groupId/threads', authenticate, forumsController.createThread);

// GET /forums/threads/:threadId - Get a single thread with its posts
router.get('/threads/:threadId', authenticate, forumsController.getThread);

// POST /forums/threads/:threadId/reply - Add a reply to a thread
router.post('/threads/:threadId/reply', authenticate, forumsController.replyToThread);

// POST /forums/threads/:threadId/remove - Remove a thread (admin/moderator only)
router.post('/threads/:threadId/remove', authenticate, requireRole(['admin-user', 'moderator-user']), forumsController.removeThread);

// PUT /forums/posts/:postId - Edit a forum post (only by author)
router.put('/posts/:postId', authenticate, forumsController.editPost);

// DELETE /forums/posts/:postId - Delete a forum post (only by author)
router.delete('/posts/:postId', authenticate, forumsController.deletePost);

module.exports = router;
