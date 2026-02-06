const Notification = require('../models/Notification');
const { getUserNotificationPreferences, updateUserNotificationPreferences } = require('../utils/notifications');

/**
 * Get all notifications for the authenticated user
 */
async function getNotifications(req, res, next) {
  try {
    const userId = req.user.id;
    // Sort by most recent first
    let notifications = await Notification.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    // Ensure each notification has an `id` property for client compatibility
    notifications = notifications.map((n) => ({ ...n, id: n._id }));

    res.json(notifications);
  } catch (error) {
    next(error);
  }
}

/**
 * Get unread notifications count
 */
async function getUnreadCount(req, res, next) {
  try {
    const userId = req.user.id;
    const unreadCount = await Notification.countDocuments({ userId, read: false });

    res.json({ count: unreadCount });
  } catch (error) {
    next(error);
  }
}

/**
 * Mark notification as read
 */
async function markAsRead(req, res, next) {
  try {
    const userId = req.user.id;
    const notificationId = req.params.id;

    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, userId },
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    // Convert to plain object and add `id` for client
    const notifObj = notification.toObject ? notification.toObject() : notification;
    notifObj.id = notifObj._id;

    res.json({ success: true, notification: notifObj });
  } catch (error) {
    next(error);
  }
}

/**
 * Mark all notifications as read
 */
async function markAllAsRead(req, res, next) {
  try {
    const userId = req.user.id;
    await Notification.updateMany({ userId, read: false }, { read: true });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete a notification
 */
async function deleteNotification(req, res, next) {
  try {
    const userId = req.user.id;
    const notificationId = req.params.id;

    const result = await Notification.deleteOne({ _id: notificationId, userId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

/**
 * Get user notification preferences
 */
async function getPreferences(req, res, next) {
  try {
    const userId = req.user.id;
    const preferences = await getUserNotificationPreferences(userId);
    res.json(preferences);
  } catch (error) {
    next(error);
  }
}

/**
 * Update user notification preferences
 */
async function updatePreferences(req, res, next) {
  try {
    const userId = req.user.id;
    const preferences = await updateUserNotificationPreferences(userId, req.body);
    res.json(preferences);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getPreferences,
  updatePreferences,
};

