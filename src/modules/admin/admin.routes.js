const express = require('express');
const { authenticate, requireRole } = require('../../utils/auth');
const ctrl = require('./admin.controller');

const router = express.Router();

router.get('/stats', authenticate, requireRole(['admin-user']), ctrl.getStats);
router.get('/users', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.getAllUsers);
router.put('/users/:id', authenticate, requireRole(['admin-user']), ctrl.updateUser);
router.put('/users/:id/role', authenticate, requireRole(['admin-user']), ctrl.updateUserRole);
router.post('/users/:id/suspend', authenticate, requireRole(['admin-user']), ctrl.suspendUser);
router.post('/users/:id/unsuspend', authenticate, requireRole(['admin-user']), ctrl.unsuspendUser);
router.put('/users/:id/suspend', authenticate, requireRole(['admin-user']), ctrl.updateUserSuspendStatus);
router.get('/moderation/posts', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.getReportedPosts);
router.post('/moderation/posts/:id/approve', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.approvePost);
router.post('/moderation/posts/:id/reject', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.rejectPost);
router.get('/moderation/comments', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.getReportedComments);
router.post('/moderation/comments/:id/approve', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.approveComment);
router.post('/moderation/comments/:id/reject', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.rejectComment);
router.get('/analytics', authenticate, requireRole(['admin-user']), ctrl.getAnalytics);
router.get('/logs', authenticate, requireRole(['admin-user']), ctrl.listActivityLogs);
router.get('/logs/stats', authenticate, requireRole(['admin-user']), ctrl.getLogStats);
router.delete('/logs/:id', authenticate, requireRole(['admin-user']), ctrl.deleteLog);
router.post('/logs/delete-range', authenticate, requireRole(['admin-user']), ctrl.deleteLogsByRange);

router.get('/email/health', authenticate, requireRole(['admin-user']), ctrl.getEmailHealth);
router.post('/email/test', authenticate, requireRole(['admin-user']), ctrl.sendEmailTest);

router.delete('/groups/:id', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.deleteGroup);

module.exports = router;
