const express = require('express');
const { authenticate } = require('../utils/auth');
const {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getPreferences,
  updatePreferences,
} = require('../controllers/notificationsController');

const router = express.Router();

// All routes require authentication
router.get('/', authenticate, getNotifications);
router.get('/unread-count', authenticate, getUnreadCount);
router.put('/:id/read', authenticate, markAsRead);
router.put('/read-all', authenticate, markAllAsRead);
router.delete('/:id', authenticate, deleteNotification);
router.get('/preferences', authenticate, getPreferences);
router.put('/preferences', authenticate, updatePreferences);

module.exports = router;

