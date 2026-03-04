const Notification = require('../../models/Notification');
const User = require('../../models/User');
const { getUserNotificationPreferences, updateUserNotificationPreferences } = require('../../utils/notifications');
const { httpError } = require('../../utils/httpError');

async function getNotifications(userId, query) {
  const rawLimit = Number.parseInt(String(query.limit ?? ''), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : null;
  let q = Notification.find({ userId }).sort({ createdAt: -1, _id: -1 });
  if (limit) q = q.limit(limit);
  let notifications = await q.lean();
  return notifications.map((n) => ({ ...n, id: n._id }));
}

async function getUnreadCount(userId) {
  const user = await User.findById(userId).select('unreadCount').lean();
  return { count: user?.unreadCount || 0 };
}

async function markAsRead(userId, notificationId) {
  const notification = await Notification.findOneAndUpdate({ _id: notificationId, userId, read: false }, { read: true }, { new: true });
  if (notification) {
    await User.updateOne({ _id: userId, unreadCount: { $gt: 0 } }, { $inc: { unreadCount: -1 } });
  }
  const result = notification || await Notification.findOne({ _id: notificationId, userId });
  if (!result) throw httpError(404, { error: 'Notification not found' });
  const obj = result.toObject ? result.toObject() : result;
  obj.id = obj._id;
  return { success: true, notification: obj };
}

async function markAllAsRead(userId) {
  await Promise.all([
    Notification.updateMany({ userId, read: false }, { read: true }),
    User.updateOne({ _id: userId }, { unreadCount: 0 })
  ]);
  return { success: true };
}

async function deleteNotification(userId, notificationId) {
  const notification = await Notification.findOne({ _id: notificationId, userId });
  if (!notification) throw httpError(404, { error: 'Notification not found' });
  const wasUnread = notification.read === false;
  await Notification.deleteOne({ _id: notificationId, userId });
  if (wasUnread) {
    await User.updateOne({ _id: userId, unreadCount: { $gt: 0 } }, { $inc: { unreadCount: -1 } });
  }
  return { success: true };
}

async function getPreferences(userId) {
  return await getUserNotificationPreferences(userId);
}

async function updatePreferences(userId, body) {
  return await updateUserNotificationPreferences(userId, body);
}

module.exports = { getNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteNotification, getPreferences, updatePreferences };
