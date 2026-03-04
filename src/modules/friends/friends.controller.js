const svc = require('./friends.service');
function sendErr(res, err, next) {
  if (err.responseBody) return res.status(err.status).json(err.responseBody);
  if (err.status) return res.sendStatus(err.status);
  return next(err);
}

async function sendFriendRequest(req, res, next) {
  try {
    const result = await svc.sendFriendRequest(req.user.id, req.params.username);
    const code = result._statusCode || 200; delete result._statusCode;
    res.status(code).json(result);
  } catch (e) { sendErr(res, e, next); }
}

async function sendFriendRequestById(req, res, next) {
  try {
    const result = await svc.sendFriendRequestById(req.user.id, req.params.userId);
    const code = result._statusCode || 200; delete result._statusCode;
    res.status(code).json(result);
  } catch (e) { sendErr(res, e, next); }
}

async function acceptFriendRequest(req, res, next) {
  try {
    return res.json(await svc.acceptFriendRequest(req.user.id, req.params.requestId));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function rejectFriendRequest(req, res, next) {
  try {
    return res.json(await svc.rejectFriendRequest(req.user.id, req.params.requestId));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function cancelFriendRequest(req, res, next) {
  try {
    return res.json(await svc.cancelFriendRequest(req.user.id, req.params.requestId));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function listFriendRequests(req, res, next) {
  try {
    return res.json(await svc.listFriendRequests(req.user.id, req.query.type));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function listAcceptedFriends(req, res, next) {
  try {
    return res.json(await svc.listAcceptedFriends(req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

module.exports = {
  sendFriendRequest,
  sendFriendRequestById,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  listFriendRequests,
  listAcceptedFriends,
};
