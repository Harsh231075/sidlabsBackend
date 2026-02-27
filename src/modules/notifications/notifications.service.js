const Notification = require('../../models/Notification');
const { getUserNotificationPreferences, updateUserNotificationPreferences } = require('../../utils/notifications');
const { SimpleTtlCache } = require('../../utils/simpleTtlCache');
const { httpError } = require('../../utils/httpError');

const unreadCountCache = new SimpleTtlCache({ defaultTtlMs: 5000, maxEntries: 5000 });
function invalidateUnreadCount(userId) { if (userId) unreadCountCache.delete(String(userId)); }

async function getNotifications(userId, query) {
  const rawLimit = Number.parseInt(String(query.limit ?? ''), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : null;
  let q = Notification.find({ userId }).sort({ createdAt: -1, _id: -1 });
  if (limit) q = q.limit(limit);
  let notifications = await q.lean();
  return notifications.map((n) => ({ ...n, id: n._id }));
}

async function getUnreadCount(userId) {
  const cached = unreadCountCache.get(String(userId));
  if (typeof cached === 'number') return { count: cached };
  const count = await Notification.countDocuments({ userId, read: false });
  unreadCountCache.set(String(userId), count);
  return { count };
}

async function markAsRead(userId, notificationId) {
  const notification = await Notification.findOneAndUpdate({ _id: notificationId, userId }, { read: true }, { new: true });
  if (!notification) throw httpError(404, { error: 'Notification not found' });
  const obj = notification.toObject ? notification.toObject() : notification;
  obj.id = obj._id;
  invalidateUnreadCount(userId);
  return { success: true, notification: obj };
}

async function markAllAsRead(userId) {
  await Notification.updateMany({ userId, read: false }, { read: true });
  invalidateUnreadCount(userId);
  return { success: true };
}

async function deleteNotification(userId, notificationId) {
  const result = await Notification.deleteOne({ _id: notificationId, userId });
  if (result.deletedCount === 0) throw httpError(404, { error: 'Notification not found' });
  invalidateUnreadCount(userId);
  return { success: true };
}

async function getPreferences(userId) {
  return await getUserNotificationPreferences(userId);
}

async function updatePreferences(userId, body) {
  return await updateUserNotificationPreferences(userId, body);
}

module.exports = { getNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteNotification, getPreferences, updatePreferences };
