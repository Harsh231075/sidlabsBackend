const express = require('express');
const { authenticate, requireRole } = require('../utils/auth');
const {
  getStats,
  getAllUsers,
  updateUser,
  updateUserRole,
  suspendUser,
  unsuspendUser,
  updateUserSuspendStatus,
  getReportedPosts,
  approvePost,
  rejectPost,
  getReportedComments,
  approveComment,
  rejectComment,
  getAnalytics,
  deleteGroup,
} = require('../controllers/adminController');

const { sendTestEmail, verifyEmailTransport, getEmailConfigSummary } = require('../services/emailService');

const { listActivityLogs, deleteLogsByRange, deleteLog, getLogStats } = require('../controllers/activityLogsController');

const router = express.Router();

// Stats
router.get('/stats', authenticate, requireRole(['admin-user']), getStats);

// Users management
router.get('/users', authenticate, requireRole(['admin-user', 'moderator-user']), getAllUsers);
router.put('/users/:id', authenticate, requireRole(['admin-user']), updateUser);
router.put('/users/:id/role', authenticate, requireRole(['admin-user']), updateUserRole);
router.post('/users/:id/suspend', authenticate, requireRole(['admin-user']), suspendUser);
router.post('/users/:id/unsuspend', authenticate, requireRole(['admin-user']), unsuspendUser);
router.put('/users/:id/suspend', authenticate, requireRole(['admin-user']), updateUserSuspendStatus);

// Moderation - Posts
router.get('/moderation/posts', authenticate, requireRole(['admin-user', 'moderator-user']), getReportedPosts);
router.post('/moderation/posts/:id/approve', authenticate, requireRole(['admin-user', 'moderator-user']), approvePost);
router.post('/moderation/posts/:id/reject', authenticate, requireRole(['admin-user', 'moderator-user']), rejectPost);

// Moderation - Comments
router.get('/moderation/comments', authenticate, requireRole(['admin-user', 'moderator-user']), getReportedComments);
router.post('/moderation/comments/:id/approve', authenticate, requireRole(['admin-user', 'moderator-user']), approveComment);
router.post('/moderation/comments/:id/reject', authenticate, requireRole(['admin-user', 'moderator-user']), rejectComment);

// Analytics
router.get('/analytics', authenticate, requireRole(['admin-user']), getAnalytics);

// Activity logs
router.get('/logs', authenticate, requireRole(['admin-user']), listActivityLogs);
router.get('/logs/stats', authenticate, requireRole(['admin-user']), getLogStats);
router.delete('/logs/:id', authenticate, requireRole(['admin-user']), deleteLog);
router.post('/logs/delete-range', authenticate, requireRole(['admin-user']), deleteLogsByRange);

// Email (admin only)
router.get('/email/health', authenticate, requireRole(['admin-user']), async (req, res) => {
  const verify = await verifyEmailTransport();
  return res.json({
    ...verify,
    config: getEmailConfigSummary(),
  });
});

router.post('/email/test', authenticate, requireRole(['admin-user']), async (req, res) => {
  const { to } = req.body || {};
  if (!to) return res.status(400).json({ error: 'to is required' });

  const verify = await verifyEmailTransport();
  if (!verify.ok) {
    return res.status(400).json({
      error: 'Email transport not healthy',
      ...verify,
    });
  }

  const result = await sendTestEmail(String(to));
  if (!result.ok) {
    return res.status(500).json({ error: 'Failed to send test email', result });
  }
  return res.json({ success: true, result });
});

// Groups
router.delete('/groups/:id', authenticate, requireRole(['admin-user']), deleteGroup);

module.exports = router;
