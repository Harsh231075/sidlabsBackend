const svc = require('./search.service');
function sendErr(res, err, next) {
  if (err.responseBody) return res.status(err.status).json(err.responseBody);
  if (err.status) return res.sendStatus(err.status);
  return next(err);
}

async function search(req, res, next) {
  try {
    const result = await svc.searchAll(
      (req.query.q || '').trim(),
      req.query.type,
      req.user?.id,
      req.user?.role
    );
    res.json(result);
  } catch (e) { sendErr(res, e, next); }
}

async function getSuggestedUsers(req, res, next) {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
    const result = await svc.getSuggestedUsers(req.user?.id, rawLimit);
    res.json(result);
  } catch (e) { sendErr(res, e, next); }
}

module.exports = {
  search,
  getSuggestedUsers,
};
