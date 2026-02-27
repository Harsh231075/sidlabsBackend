const svc = require('./forums.service');
function sendErr(res, err, next) {
  if (err.responseBody) return res.status(err.status).json(err.responseBody);
  if (err.status) return res.sendStatus(err.status);
  return next(err);
}

async function getThreads(req, res, next) {
  try {
    return res.json(await svc.getThreads(req.params.groupId, req.user.id, req.user.role));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function createThread(req, res, next) {
  try {
    const result = await svc.createThread(req.params.groupId, req.body, req.user.id, req.user.role);
    const code = result._statusCode || 200; delete result._statusCode;
    res.status(code).json(result);
  } catch (e) { sendErr(res, e, next); }
}
async function getThread(req, res, next) {
  try {
    return res.json(await svc.getThread(req.params.threadId, req.user.id, req.user.role));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function replyToThread(req, res, next) {
  try {
    const result = await svc.replyToThread(req.params.threadId, req.body, req.user.id, req.user.role);
    const code = result._statusCode || 200; delete result._statusCode;
    res.status(code).json(result);
  } catch (e) { sendErr(res, e, next); }
}
async function removeThread(req, res, next) {
  try {
    return res.json(await svc.removeThread(req.params.threadId, req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function editPost(req, res, next) {
  try {
    return res.json(await svc.editPost(req.params.postId, req.body.content, req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function deletePost(req, res, next) {
  try {
    return res.json(await svc.deletePost(req.params.postId, req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

module.exports = {
  getThreads,
  createThread,
  getThread,
  replyToThread,
  removeThread,
  editPost,
  deletePost,
};
