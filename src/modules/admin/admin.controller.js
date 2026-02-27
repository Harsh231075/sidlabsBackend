const svc = require('./admin.service');

function sendErr(res, err, next) {
  if (err.responseBody) return res.status(err.status).json(err.responseBody);
  if (err.status) return res.sendStatus(err.status);
  return next(err);
}

async function getStats(req, res, next) {
  try {
    return res.json(await svc.getStats());
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getAllUsers(req, res, next) {
  try {
    return res.json(await svc.getAllUsers());
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function updateUser(req, res, next) {
  try {
    return res.json(await svc.updateUser(req.params.id, req.body));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function updateUserRole(req, res, next) {
  try {
    return res.json(await svc.updateUserRole(req.params.id, req.body));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function suspendUser(req, res, next) {
  try {
    return res.json(await svc.suspendUser(req.params.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function unsuspendUser(req, res, next) {
  try {
    return res.json(await svc.unsuspendUser(req.params.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function updateUserSuspendStatus(req, res, next) {
  try {
    return res.json(await svc.updateUserSuspendStatus(req.params.id, req.body));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getReportedPosts(req, res, next) {
  try {
    return res.json(await svc.getReportedPosts());
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function approvePost(req, res, next) {
  try {
    return res.json(await svc.approvePost(req.params.id, req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function rejectPost(req, res, next) {
  try {
    return res.json(await svc.rejectPost(req.params.id, req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getReportedComments(req, res, next) {
  try {
    return res.json(await svc.getReportedComments());
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function approveComment(req, res, next) {
  try {
    return res.json(await svc.approveComment(req.params.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function rejectComment(req, res, next) {
  try {
    return res.json(await svc.rejectComment(req.params.id, req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getAnalytics(req, res, next) {
  try {
    return res.json(await svc.getAnalytics());
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function deleteGroup(req, res, next) {
  try {
    return res.json(await svc.deleteGroup(req.params.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function listActivityLogs(req, res, next) {
  try {
    return res.json(await svc.listActivityLogs(req.query));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function deleteLogsByRange(req, res, next) {
  try {
    return res.json(await svc.deleteLogsByRange(req.body));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function deleteLog(req, res, next) {
  try {
    return res.json(await svc.deleteLog(req.params.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getLogStats(req, res, next) {
  try {
    return res.json(await svc.getLogStats());
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function getEmailHealth(req, res, next) {
  try {
    return res.json(await svc.getEmailHealth());
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function sendEmailTest(req, res, next) {
  try {
    return res.json(await svc.sendEmailTest(req.body));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

module.exports = {
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
  listActivityLogs,
  deleteLogsByRange,
  deleteLog,
  getLogStats,
  getEmailHealth,
  sendEmailTest,
};
