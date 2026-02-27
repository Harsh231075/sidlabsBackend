const svc = require('./profile.service');

function sendErr(res, err, next) {
  if (err.responseBody) return res.status(err.status).json(err.responseBody);
  if (err.status) return res.sendStatus(err.status);
  return next(err);
}

async function getProfileByUsername(req, res, next) {
  try {
    return res.json(await svc.getProfileByUsername(req.params.username, req.user?.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function getProfileById(req, res, next) {
  try {
    return res.json(await svc.getProfileById(req.params.userId, req.user?.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function getUserPosts(req, res, next) {
  try {
    return res.json(await svc.getUserPosts(req.params.username, req.query));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function getUserLikes(req, res, next) {
  try {
    return res.json(await svc.getUserLikes(req.params.username, req.query));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function getUserComments(req, res, next) {
  try {
    return res.json(await svc.getUserComments(req.params.username, req.query));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function getFollowers(req, res, next) {
  try {
    return res.json(await svc.getFollowers(req.params.username, req.query, req.user?.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function getFollowing(req, res, next) {
  try {
    return res.json(await svc.getFollowing(req.params.username, req.query, req.user?.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function updateProfile(req, res, next) {
  try {
    return res.json(await svc.updateProfile(req.user.id, req.body));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function followUser(req, res, next) {
  try {
    return res.json(await svc.followUser(req.params.username, req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function unfollowUser(req, res, next) {
  try {
    return res.json(await svc.unfollowUser(req.params.username, req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

module.exports = {
  getProfileByUsername,
  getProfileById,
  getUserPosts,
  getUserLikes,
  getUserComments,
  getFollowers,
  getFollowing,
  updateProfile,
  followUser,
  unfollowUser,
};
