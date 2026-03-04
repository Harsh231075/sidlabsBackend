const svc = require('./moderation.service');
function sendErr(res, err, next) {
  if (err.responseBody) return res.status(err.status).json(err.responseBody);
  if (err.status) return res.sendStatus(err.status);
  return next(err);
}

async function getQuarantinedContent(req, res, next) {
  try {
    return res.json(await svc.getQuarantinedContent(req.query.type || 'all'));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function approveContent(req, res, next) {
  try {
    return res.json(await svc.approveContent(req.params.type, req.params.id, req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function rejectContent(req, res, next) {
  try {
    return res.json(await svc.rejectContent(req.params.type, req.params.id, req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function requestEdit(req, res, next) {
  try {
    return res.json(await svc.requestEdit(req.params.type, req.params.id, req.user.id, req.body.reason));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

module.exports = {
  getQuarantinedContent,
  approveContent,
  rejectContent,
  requestEdit,
};
