const express = require('express');
const { authenticate } = require('../../utils/auth');
const ctrl = require('./notifications.controller');

const router = express.Router();

router.get('/', authenticate, ctrl.getNotifications);
router.get('/unread-count', authenticate, ctrl.getUnreadCount);
router.put('/:id/read', authenticate, ctrl.markAsRead);
router.put('/read-all', authenticate, ctrl.markAllAsRead);
router.delete('/:id', authenticate, ctrl.deleteNotification);
router.get('/preferences', authenticate, ctrl.getPreferences);
router.put('/preferences', authenticate, ctrl.updatePreferences);

module.exports = router;
