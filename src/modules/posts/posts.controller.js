
const postsService = require('./posts.service');

const { getAllBlockedUserIds } = require('../../utils/messaging');
const { decodeCursor, parsePositiveInt } = require('../../services/posts/cursor');
const { getFilteredPosts, getSmartFeedPosts } = require('../../services/posts/postFeedService');

function sendServiceError(res, err, next) {
  if (err.responseBody) return res.status(err.status || 500).json(err.responseBody);
  next(err);
}

async function getPosts(req, res, next) {
  try {
    const groupId = req.query.groupId;
    const diseasePageSlug = req.query.diseasePageSlug;
    const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);
    const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;
    const useSmartFeed = req.query.smartFeed !== 'false';
    const blockedUserIds = await getAllBlockedUserIds(req.user.id);

    if (groupId || diseasePageSlug) {
      return await getFilteredPosts(req, res, next, { groupId, diseasePageSlug, limit, cursor, blockedUserIds });
    }
    if (useSmartFeed) {
      return await getSmartFeedPosts(req, res, next, { limit, cursor, blockedUserIds });
    }
    return await getFilteredPosts(req, res, next, { limit, cursor, blockedUserIds });
  } catch (error) {
    next(error);
  }
}

async function createPost(req, res, next) {
  try {
    const result = await postsService.createPost(req.user.id, req.user.role, req.body);
    res.status(201).json(result);
  } catch (err) {
    sendServiceError(res, err, next);
  }
}

async function likePost(req, res, next) {
  try {
    const result = await postsService.likePost(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    sendServiceError(res, err, next);
  }
}

async function reportPost(req, res, next) {
  try {
    const result = await postsService.reportPost(req.user.id, req.user.role, req.params.id, req.body.reason);
    res.json(result);
  } catch (err) {
    sendServiceError(res, err, next);
  }
}

async function removePost(req, res, next) {
  try {
    const result = await postsService.removePost(req.user.id, req.user.role, req.params.id);
    res.json(result);
  } catch (err) {
    sendServiceError(res, err, next);
  }
}

async function getPostComments(req, res, next) {
  try {
    const result = await postsService.getPostComments(req.user.id, req.user.role, req.params.id);
    res.json(result);
  } catch (err) {
    sendServiceError(res, err, next);
  }
}

async function addPostComment(req, res, next) {
  try {
    const result = await postsService.addPostComment(req.user.id, req.user.role, req.params.id, req.body);
    res.status(201).json(result);
  } catch (err) {
    sendServiceError(res, err, next);
  }
}

async function getFeedStats(req, res, next) {
  try {
    const result = await postsService.getFeedStats(req.user.id);
    res.json(result);
  } catch (err) {
    sendServiceError(res, err, next);
  }
}

async function getPostById(req, res, next) {
  try {
    const result = await postsService.getPostById(req.user.id, req.user.role, req.params.id);
    res.json(result);
  } catch (err) {
    sendServiceError(res, err, next);
  }
}

async function updatePost(req, res, next) {
  try {
    const result = await postsService.updatePost(req.user.id, req.params.postId, req.body);
    res.json(result);
  } catch (err) {
    sendServiceError(res, err, next);
  }
}

async function reviewPost(req, res, next) {
  try {
    const result = await postsService.reviewPost(req.user.id, req.user.role, req.params.postId, req.body.action);
    res.json(result);
  } catch (err) {
    sendServiceError(res, err, next);
  }
}

async function getReportedPosts(req, res, next) {
  try {
    const result = await postsService.getReportedPosts(req.user.role, req.query);
    res.json(result);
  } catch (err) {
    sendServiceError(res, err, next);
  }
}

module.exports = {
  getPosts,
  createPost,
  likePost,
  reportPost,
  removePost,
  getPostComments,
  addPostComment,
  getFeedStats,
  getPostById,
  updatePost,
  reviewPost,
  getReportedPosts,
};
