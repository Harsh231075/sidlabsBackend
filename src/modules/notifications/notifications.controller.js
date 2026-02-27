const svc = require('./notifications.service');
function sendErr(res, err, next) {
  if (err.responseBody) return res.status(err.status).json(err.responseBody);
  if (err.status) return res.sendStatus(err.status);
  return next(err);
}

async function getNotifications(req, res, next) {
  try {
    return res.json(await svc.getNotifications(req.user.id, req.query));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getUnreadCount(req, res, next) {
  try {
    return res.json(await svc.getUnreadCount(req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function markAsRead(req, res, next) {
  try {
    return res.json(await svc.markAsRead(req.user.id, req.params.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function markAllAsRead(req, res, next) {
  try {
    return res.json(await svc.markAllAsRead(req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function deleteNotification(req, res, next) {
  try {
    return res.json(await svc.deleteNotification(req.user.id, req.params.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getPreferences(req, res, next) {
  try {
    return res.json(await svc.getPreferences(req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function updatePreferences(req, res, next) {
  try {
    return res.json(await svc.updatePreferences(req.user.id, req.body));
  } catch (e) {
    return sendErr(res, e, next);
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
