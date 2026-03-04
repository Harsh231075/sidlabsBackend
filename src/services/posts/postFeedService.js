const Post = require('../../models/Post');
const { parsePositiveInt, encodeCursor } = require('./cursor');
const { getDiseaseFollowerIdsCached } = require('./diseaseFollowerCache');
const { attachAuthorsToPosts, buildPostResponsesBulk } = require('./postResponseBuilder');

/**
 * Get filtered posts (by group or disease page)
 * NOTE: maintains existing controller behavior (writes response directly)
 */
async function getFilteredPosts(req, res, next, options = {}) {
  const { groupId, diseasePageSlug, limit = 20, cursor = null, blockedUserIds = [] } = options;

  const baseQuery = { removed: false, visible: true };

  if (blockedUserIds && blockedUserIds.length > 0) {
    baseQuery.authorId = { $nin: blockedUserIds };
  }

  if (groupId) {
    baseQuery.groupId = groupId;
  } else if (diseasePageSlug) {
    const followerIds = await getDiseaseFollowerIdsCached(diseasePageSlug);

    baseQuery.$or = [
      { diseasePageSlug: diseasePageSlug },
      {
        authorId: { $in: followerIds },
        groupId: null, // Only public posts from followers to avoid privacy leaks
      },
    ];
  }

  const Group = require('../../models/Group');
  const myGroups = await Group.find({
    $or: [{ members: req.user.id }, { adminIds: req.user.id }, { ownerId: req.user.id }],
  }).select('_id').lean();
  const myGroupIds = myGroups.map((g) => g._id);

  const query = { ...baseQuery };
  if (cursor) {
    const cursorFilter = {
      $or: [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
      ],
    };

    if (query.$or) {
      const existingOr = query.$or;
      delete query.$or;
      query.$and = [{ $or: existingOr }, cursorFilter];
    } else {
      query.$or = cursorFilter.$or;
    }
  }

  // Optimization: fetch limit+1 once instead of small batches in a loop.
  const posts = await Post.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .select('-reports -moderation')
    .lean();

  const postsWithAuthors = await attachAuthorsToPosts(posts);
  const results = await buildPostResponsesBulk(postsWithAuthors, req.user.id, req.user.role);

  const hasMore = results.length > limit;
  const trimmed = hasMore ? results.slice(0, limit) : results;
  const nextCursor = hasMore ? trimmed[trimmed.length - 1]?.cursor : null;

  res.json({ posts: trimmed.map((r) => r.post), nextCursor });
}

/**
 * Get Smart Feed posts - personalized based on user's connections
 * NOTE: maintains existing controller behavior (writes response directly)
 */
async function getSmartFeedPosts(req, res, next, options = {}) {
  const { limit = 20, cursor = null, blockedUserIds = [] } = options;
  const smartFeedService = require('../smartFeedService');

  try {
    const feedResult = await smartFeedService.getSmartFeed(req.user.id, {
      limit,
      cursor,
      blockedUserIds,
    });

    // If no posts from smart feed, fall back to recent posts
    if (feedResult.posts.length === 0 && !cursor) {
      const fallbackQuery = {
        removed: false,
        groupId: null,
        diseasePageSlug: null,
      };

      if (blockedUserIds && blockedUserIds.length > 0) {
        fallbackQuery.authorId = { $nin: blockedUserIds };
      }

      let fallbackPosts = await Post.find(fallbackQuery)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .select('-reports -moderation')
        .lean();

      fallbackPosts = await attachAuthorsToPosts(fallbackPosts);

      const batch = await buildPostResponsesBulk(fallbackPosts, req.user.id, req.user.role);
      return res.json({
        posts: batch.map((r) => r.post),
        nextCursor: null,
        isColdStart: true,
        message: 'Follow users, join groups, or follow disease pages to personalize your feed!',
      });
    }

    // Avoid re-querying Posts by id (smartFeedService already fetched them).
    const orderedPosts = await attachAuthorsToPosts(feedResult.posts);
    const batch = await buildPostResponsesBulk(orderedPosts, req.user.id, req.user.role);

    const nextCursor = feedResult.nextCursor
      ? encodeCursor(feedResult.nextCursor.createdAt, feedResult.nextCursor.id)
      : null;

    res.json({
      posts: batch.map((r) => r.post),
      nextCursor,
      isColdStart: feedResult.isColdStart || false,
    });
  } catch (error) {
    console.error('Smart feed error, falling back to filtered posts:', error);
    return await getFilteredPosts(req, res, next, options);
  }
}

module.exports = {
  parsePositiveInt,
  getFilteredPosts,
  getSmartFeedPosts,
};
