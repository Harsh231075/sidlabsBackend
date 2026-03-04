const svc = require('./groups.service');
function sendErr(res, err, next) {
  if (err.responseBody) return res.status(err.status).json(err.responseBody);
  if (err.status) return res.sendStatus(err.status);
  return next(err);
}

async function getGroups(req, res, next) {
  try {
    return res.json(await svc.getGroups(req.user.id, req.user.role, req.query));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function createGroup(req, res, next) {
  try {
    return res.status(201).json(await svc.createGroup(req.body, req.user.id, req.user.role));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getGroup(req, res, next) {
  try {
    return res.json(await svc.getGroup(req.params.id, req.user.id, req.user.role));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function joinGroup(req, res, next) {
  try {
    return res.json(await svc.joinGroup(req.params.id, req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function leaveGroup(req, res, next) {
  try {
    return res.json(await svc.leaveGroup(req.params.id, req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function updateGroup(req, res, next) {
  try {
    return res.json(await svc.updateGroup(req.params.id, req.body, req.user.id, req.user.role));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getSubGroups(req, res, next) {
  try {
    return res.json(await svc.getSubGroups(req.params.id, req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getGroupMembers(req, res, next) {
  try {
    return res.json(await svc.getGroupMembers(req.params.id, req.user.id, req.query));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function sendGroupMessage(req, res, next) {
  try {
    return res.status(201).json(await svc.sendGroupMessage(req.params.id, req.user.id, req.body.content));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getGroupMessages(req, res, next) {
  try {
    return res.json(await svc.getGroupMessages(req.params.id, req.user.id, req.query));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

module.exports = {
  getGroups,
  createGroup,
  getGroup,
  joinGroup,
  leaveGroup,
  updateGroup,
  getSubGroups,
  getGroupMembers,
  sendGroupMessage,
  getGroupMessages,
};
