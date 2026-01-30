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

// Groups
router.delete('/groups/:id', authenticate, requireRole(['admin-user']), deleteGroup);

module.exports = router;
