const Comment = require('../../models/Comment');
const User = require('../../models/User');
const Group = require('../../models/Group');
const { toPublicUrl } = require('../../utils/publicUrl');
const { encodeCursor } = require('./cursor');

async function attachAuthorsToPosts(posts) {
  if (!posts || posts.length === 0) return posts;

  const authorIds = [
    ...new Set(
      posts
        .map((p) => {
          if (!p) return null;
          if (p.authorId && typeof p.authorId === 'object') return p.authorId._id;
          return p.authorId;
        })
        .filter(Boolean)
    ),
  ];

  if (authorIds.length === 0) return posts;

  const authors = await User.find({ _id: { $in: authorIds } })
    .select('_id name role avatarUrl')
    .lean();

  const authorMap = new Map(authors.map((a) => [a._id, a]));

  for (const post of posts) {
    if (!post) continue;
    const authorId = post.authorId && typeof post.authorId === 'object' ? post.authorId._id : post.authorId;
    const author = authorMap.get(authorId);
    if (author) post.authorId = author;
  }

  return posts;
}

/**
 * Check if user can view a group post based on group privacy
 */
function canViewGroupPost(post, group, userId, userRole) {
  if (!post.groupId) return true;
  if (!group) return false; // If post has groupId but group not found/loaded
  if (group.privacy === 'public') return true;

  const isMember =
    !!group.isMember ||
    group.members?.includes(userId) ||
    group.adminIds?.includes(userId) ||
    group.ownerId === userId;

  if (group.privacy === 'private' || group.privacy === 'hidden') {
    return isMember || userRole === 'admin-user';
  }
  return true;
}

/**
 * Build post response with enriched data (author, likes, comments, group)
 */
async function buildPostResponse(post, currentUserId) {
  // Ensure author is populated
  if (!post.authorId || !post.authorId.name) {
    await post.populate('authorId', 'name role avatarUrl');
  }

  const likeList = post.likes || [];
  const likedByCurrentUser = likeList.includes(currentUserId);
  const commentCount = await Comment.countDocuments({ postId: post._id, removed: false });

  let group = null;
  if (post.groupId) {
    const groupDoc = await Group.findById(post.groupId).select('name privacy members adminIds ownerId').lean();
    if (groupDoc) {
      group = {
        id: groupDoc._id,
        name: groupDoc.name,
        privacy: groupDoc.privacy,
        isMember: groupDoc.members?.includes(currentUserId),
      };
    }
  }

  return {
    ...post.toObject(),
    id: post._id,
    author: post.authorId
      ? {
        id: post.authorId._id,
        name: post.authorId.name,
        role: post.authorId.role,
        avatarUrl: toPublicUrl(post.authorId.avatarUrl),
      }
      : null,
    mediaUrl: toPublicUrl(post.mediaUrl),
    likeCount: likeList.length,
    likedByCurrentUser,
    commentCount,
    group,
  };
}

async function buildPostResponsesBulk(posts, currentUserId, currentUserRole) {
  if (!posts.length) return [];

  const postIds = posts.map((p) => p._id);
  const groupIds = [...new Set(posts.map((p) => p.groupId).filter(Boolean))];

  const [groupsMeta] = await Promise.all([
    groupIds.length
      ? Group.find({ _id: { $in: groupIds } }).select('name privacy ownerId').lean()
      : Promise.resolve([]),
  ]);

  const nonPublicGroupIds = groupsMeta
    .filter((g) => g && g.privacy && g.privacy !== 'public')
    .map((g) => g._id);

  const membershipRows = nonPublicGroupIds.length
    ? await Group.find({
      _id: { $in: nonPublicGroupIds },
      $or: [{ members: currentUserId }, { adminIds: currentUserId }, { ownerId: currentUserId }],
    })
      .select('_id')
      .lean()
    : [];

  const memberGroupIdSet = new Set(membershipRows.map((g) => String(g._id)));

  const groupsMap = groupsMeta.reduce((acc, g) => {
    acc[g._id] = {
      ...g,
      isMember: memberGroupIdSet.has(String(g._id)) || g.ownerId === currentUserId,
    };
    return acc;
  }, {});

  const visible = [];
  for (const post of posts) {
    if (post.groupId) {
      const group = groupsMap[post.groupId];
      if (!canViewGroupPost(post, group, currentUserId, currentUserRole)) continue;
    }

    const { __v, _id, authorId, likes = [], ...rest } = post;
    const authorObj = authorId && typeof authorId === 'object' ? authorId : null;
    const likeList = Array.isArray(likes) ? likes : [];

    const groupDoc = post.groupId ? groupsMap[post.groupId] : null;
    const isMember = !!groupDoc && (!!groupDoc.isMember || groupDoc.ownerId === currentUserId);

    visible.push({
      cursor: encodeCursor(post.createdAt, _id),
      post: {
        ...rest,
        id: _id,
        authorId: authorObj ? authorObj._id : authorId,
        author: authorObj
          ? {
            id: authorObj._id,
            name: authorObj.name,
            role: authorObj.role,
            avatarUrl: toPublicUrl(authorObj.avatarUrl),
          }
          : null,
        mediaUrl: toPublicUrl(rest.mediaUrl),
        likeCount: likeList.length,
        likedByCurrentUser: likeList.includes(currentUserId),
        commentCount: post.commentCount || 0, // Direct use of denormalized field
        group: groupDoc
          ? {
            id: groupDoc._id,
            name: groupDoc.name,
            privacy: groupDoc.privacy,
            isMember,
          }
          : null,
      },
    });
  }

  return visible;
}

module.exports = {
  attachAuthorsToPosts,
  canViewGroupPost,
  buildPostResponse,
  buildPostResponsesBulk,
};
