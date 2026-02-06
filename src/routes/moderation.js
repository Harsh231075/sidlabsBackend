const express = require('express');
const { authenticate, requireRole } = require('../utils/auth');
const moderationController = require('../controllers/moderationController');

const router = express.Router();

// Get quarantined content for moderation queue
router.get('/queue', authenticate, requireRole(['admin-user', 'moderator-user']), moderationController.getQuarantinedContent);

// Approve quarantined content
router.post('/:type/:id/approve', authenticate, requireRole(['admin-user', 'moderator-user']), moderationController.approveContent);

// Reject quarantined content
router.post('/:type/:id/reject', authenticate, requireRole(['admin-user', 'moderator-user']), moderationController.rejectContent);

// Request edit for quarantined content
router.post('/:type/:id/request-edit', authenticate, requireRole(['admin-user', 'moderator-user']), moderationController.requestEdit);

module.exports = router;

