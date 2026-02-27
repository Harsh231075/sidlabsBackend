const { toPublicUrl } = require('./publicUrl');

// Helper function to check if user can view group forum
function canViewGroupForum(groupId, groups, user) {
  if (!groupId) return true; // Global forum
  const group = groups.find((g) => g.id === groupId);
  if (!group) return false;
  if (group.privacy === 'public') return true;
  const isMember =
    group.members?.includes(user.id) || group.adminIds?.includes(user.id) || group.ownerId === user.id;
  if (group.privacy === 'private' || group.privacy === 'hidden') {
    return isMember || user.role === 'admin-user';
  }
  return true;
}

// Helper function to build thread response with enriched data
function buildThreadResponse(thread, users, currentUserId, posts = [], groups = []) {
  const creator = users.find((u) => u.id === thread.creatorId);
  const group = thread.groupId ? groups.find((g) => g.id === thread.groupId) : null;
  const replyCount = posts.filter((p) => p.threadId === thread.id && !p.removed).length;
  const lastReply = posts
    .filter((p) => p.threadId === thread.id && !p.removed)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  return {
    ...thread,
    creator: creator ? { id: creator.id, name: creator.name, role: creator.role, avatarUrl: toPublicUrl(creator.avatarUrl) } : null,
    replyCount,
    group: group
      ? { id: group.id, name: group.name, privacy: group.privacy, isMember: group.members?.includes(currentUserId) }
      : null,
    lastReply: lastReply
      ? {
        id: lastReply.id,
        authorId: lastReply.authorId,
        author: users.find((u) => u.id === lastReply.authorId)
          ? { id: lastReply.authorId, name: users.find((u) => u.id === lastReply.authorId).name }
          : null,
        createdAt: lastReply.createdAt,
      }
      : null,
  };
}

// Helper function to build forum post response with author data
function buildForumPostResponse(post, users) {
  const author = users.find((u) => u.id === post.authorId);
  const repliedToUser = post.repliedToUserId ? users.find((u) => u.id === post.repliedToUserId) : null;
  return {
    ...post,
    author: author ? { id: author.id, name: author.name, role: author.role, avatarUrl: toPublicUrl(author.avatarUrl) } : null,
    repliedToUser: repliedToUser ? { id: repliedToUser.id, name: repliedToUser.name } : null,
  };
}

module.exports = {
  canViewGroupForum,
  buildThreadResponse,
  buildForumPostResponse,
};

