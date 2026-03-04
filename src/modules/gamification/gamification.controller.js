const svc = require('./gamification.service');
function sendErr(res, err, next) {
  if (err.responseBody) return res.status(err.status).json(err.responseBody);
  if (err.status) return res.sendStatus(err.status);
  return next(err);
}

async function getUserGamificationStats(req, res, next) {
  try {
    return res.json(await svc.getUserGamificationStats(req.params.userId, req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function getLeaderboardStats(req, res, next) {
  try {
    return res.json(await svc.getLeaderboardStats(req.user.id, req.query));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function awardTokensManually(req, res, next) {
  try {
    return res.json(await svc.awardTokensManually(req.user.id, req.user.role, req.body));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

module.exports = {
  getUserGamificationStats,
  getLeaderboardStats,
  awardTokensManually,
};
