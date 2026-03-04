const express = require('express');
const { authenticate, requireRole } = require('../../utils/auth');
const ctrl = require('./forums.controller');

const router = express.Router();

router.get('/:groupId/threads', authenticate, ctrl.getThreads);
router.post('/:groupId/threads', authenticate, ctrl.createThread);
router.get('/threads/:threadId', authenticate, ctrl.getThread);
router.post('/threads/:threadId/reply', authenticate, ctrl.replyToThread);
router.post('/threads/:threadId/remove', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.removeThread);
router.put('/posts/:postId', authenticate, ctrl.editPost);
router.delete('/posts/:postId', authenticate, ctrl.deletePost);

module.exports = router;
