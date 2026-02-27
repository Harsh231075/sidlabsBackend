const svc = require('./users.service');
function sendErr(res, err, next) {
  if (err.responseBody) return res.status(err.status).json(err.responseBody);
  if (err.status) return res.sendStatus(err.status);
  return next(err);
}

async function getUsers(req, res, next) {
  try {
    return res.json(await svc.getUsers());
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function updateMyProfile(req, res, next) {
  try {
    return res.json(await svc.updateMyProfile(req.user.id, req.body));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function updateUser(req, res, next) {
  try {
    return res.json(await svc.updateUser(req.params.id, req.body, req.user.id, req.user.role));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getUserBadges(req, res, next) {
  try {
    return res.json(await svc.getUserBadges(req.user.id, req.user.role, req.params.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function blockUser(req, res, next) {
  try {
    return res.json(await svc.blockUserById(req.user.id, req.params.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function unblockUser(req, res, next) {
  try {
    return res.json(await svc.unblockUserById(req.user.id, req.params.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getBlockedUsersList(req, res, next) {
  try {
    return res.json(await svc.getBlockedUsersList(req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function uploadAvatar(req, res, next) {
  try {
    return res.json(await svc.uploadAvatar(req.user.id, (req.body || {}).image));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function uploadCover(req, res, next) {
  try {
    return res.json(await svc.uploadCover(req.user.id, (req.body || {}).image));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function removeAvatar(req, res, next) {
  try {
    return res.json(await svc.removeAvatar(req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function removeCover(req, res, next) {
  try {
    return res.json(await svc.removeCover(req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getMyReports(req, res, next) {
  try {
    return res.json(await svc.getMyReports(req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

module.exports = {
  getUsers,
  updateMyProfile,
  updateUser,
  getUserBadges,
  blockUser,
  unblockUser,
  getBlockedUsersList,
  uploadAvatar,
  uploadCover,
  removeAvatar,
  removeCover,
  getMyReports,
};
