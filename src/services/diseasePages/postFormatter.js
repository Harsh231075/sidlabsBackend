//const Comment = require('../../models/Comment');
const { toPublicUrl } = require('../../utils/publicUrl');

async function formatDiseasePagePosts(posts, currentUserId, options = {}) {
  const { includeModeration = false } = options;

  if (!Array.isArray(posts) || posts.length === 0) return [];

  //const postIds = posts.map((p) => p._id);

  return posts.map((post) => {
    const likes = Array.isArray(post.likes) ? post.likes : [];
    const authorDoc = post.authorId && typeof post.authorId === 'object' ? post.authorId : null;

    const formatted = {
      id: post._id,
      authorId: authorDoc?._id || post.authorId,
      author: authorDoc
        ? {
          id: authorDoc._id,
          name: authorDoc.name,
          role: authorDoc.role,
          avatarUrl: toPublicUrl(authorDoc.avatarUrl),
        }
        : null,
      content: post.content,
      mediaUrl: toPublicUrl(post.mediaUrl),
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      likeCount: likes.length,
      likedByCurrentUser: likes.includes(currentUserId),
      commentCount: post.commentCount || 0, // Direct use of denormalized field
      reported: post.reported,
      removed: post.removed,
      diseasePageSlug: post.diseasePageSlug,
    };

    if (includeModeration) {
      formatted.moderation = post.moderation;
    }

    return formatted;
  });
}

module.exports = {
  formatDiseasePagePosts,
};
