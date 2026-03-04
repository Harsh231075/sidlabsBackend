const { v4: uuidv4 } = require('uuid');
const ForumThread = require('../../models/ForumThread');
const ForumPost = require('../../models/ForumPost');
const Group = require('../../models/Group');
const User = require('../../models/User');
const Comment = require('../../models/Comment');
const { sanitizeInput, analyzeTextForModeration } = require('../../utils/moderation');
const { checkForBadges } = require('../../utils/badges');
const { notifyForumReply } = require('../../utils/notifications');
const { toPublicUrl } = require('../../utils/publicUrl');
const { httpError } = require('../../utils/httpError');

function canViewGroupForum(group, userId, userRole) {
  if (!group) return true;
  if (group.privacy === 'public') return true;
  const isMember = group.members?.some(id => id === userId) || group.adminIds?.some(id => id === userId) || group.ownerId === userId;
  if (group.privacy === 'private' || group.privacy === 'hidden') return isMember || userRole === 'admin-user';
  return true;
}

async function buildThreadResponse(thread, currentUserId) {
  await thread.populate('creatorId', 'name role avatarUrl');
  let group = null;
  if (thread.groupId) {
    const gDoc = await Group.findById(thread.groupId).select('name privacy members adminIds ownerId link').lean();
    if (gDoc) {
      const isMember = gDoc.members?.includes(currentUserId) || gDoc.adminIds?.includes(currentUserId) || gDoc.ownerId === currentUserId;
      group = { id: gDoc._id, name: gDoc.name, privacy: gDoc.privacy, isMember };
    }
  }
  const replyCount = await ForumPost.countDocuments({ threadId: thread._id, removed: false });
  const lastReplyDoc = await ForumPost.findOne({ threadId: thread._id, removed: false }).sort({ createdAt: -1 }).populate('authorId', 'name').lean();
  const lastReply = lastReplyDoc ? { id: lastReplyDoc._id, authorId: lastReplyDoc.authorId?._id, author: lastReplyDoc.authorId ? { id: lastReplyDoc.authorId._id, name: lastReplyDoc.authorId.name } : null, createdAt: lastReplyDoc.createdAt } : null;
  return { ...thread.toObject(), id: thread._id, creator: thread.creatorId ? { id: thread.creatorId._id, name: thread.creatorId.name, role: thread.creatorId.role, avatarUrl: toPublicUrl(thread.creatorId.avatarUrl) } : null, replyCount, group, lastReply };
}

async function buildForumPostResponse(post) {
  await post.populate('authorId', 'name role avatarUrl');
  await post.populate('repliedToUserId', 'name');
  return { ...post.toObject(), id: post._id, author: post.authorId ? { id: post.authorId._id, name: post.authorId.name, role: post.authorId.role, avatarUrl: toPublicUrl(post.authorId.avatarUrl) } : null, repliedToUser: post.repliedToUserId ? { id: post.repliedToUserId._id, name: post.repliedToUserId.name } : null };
}

async function checkBadgesAfterPost(userId, userRole) {
  const userForumPostsCount = await ForumPost.countDocuments({ authorId: userId, removed: false });
  const userCommentsCount = await Comment.countDocuments({ authorId: userId, removed: false });
  await checkForBadges(userId, { postsCount: userForumPostsCount, commentsCount: userCommentsCount, role: userRole });
}

async function getThreads(groupIdParam, userId, userRole) {
  const groupId = groupIdParam === 'global' ? null : groupIdParam;
  let query = { removed: false };
  if (groupId) {
    query.groupId = groupId;
    const group = await Group.findById(groupId).lean();
    if (group && !canViewGroupForum(group, userId, userRole)) throw httpError(403, { error: 'Not authorized to view this group forum' });
  } else {
    query.groupId = null;
  }
  const threads = await ForumThread.find(query).sort({ createdAt: -1 });
  return await Promise.all(threads.map(t => buildThreadResponse(t, userId)));
}

async function createThread(groupIdParam, body, userId, userRole) {
  const groupId = groupIdParam === 'global' ? null : groupIdParam;
  const title = sanitizeInput(body.title || '');
  const content = sanitizeInput(body.content || '');
  if (!title) throw httpError(400, { error: 'Title is required' });
  if (!content) throw httpError(400, { error: 'Content is required' });

  const analysis = analyzeTextForModeration(`${title}\n${content}`);
  const userConfirmed = !!body.userConfirmedModeration;
  if (analysis.alertRequired && !userConfirmed) {
    throw httpError(409, { error: 'moderation_confirmation_required', message: 'This post may contain PHI, spam, or promotional content. This post will be monitored. Are you sure you want to post?', analysis });
  }
  const isPendingReview = analysis.alertRequired && userConfirmed;

  if (groupId) {
    const targetGroup = await Group.findById(groupId).lean();
    if (!targetGroup) throw httpError(404, { error: 'Group not found' });
    const isMember = targetGroup.members?.includes(userId) || targetGroup.adminIds?.includes(userId) || targetGroup.ownerId === userId;
    if (targetGroup.privacy !== 'public' && !isMember && userRole !== 'admin-user') throw httpError(403, { error: 'Not a member of this private group' });
  }

  const now = new Date();
  const newThread = await ForumThread.create({ _id: uuidv4(), title, creatorId: userId, groupId, createdAt: now, updatedAt: now, removed: false });
  await ForumPost.create({ _id: uuidv4(), threadId: newThread._id, authorId: userId, content, repliedToUserId: null, createdAt: now, updatedAt: now, removed: false, moderation: { status: isPendingReview ? 'PENDING_REVIEW' : 'ALLOW', analysis, flaggedAt: isPendingReview ? now : null, flaggedBy: isPendingReview ? userId : null } });

  await checkBadgesAfterPost(userId, userRole);
  const response = await buildThreadResponse(newThread, userId);
  return { _statusCode: 201, thread: response };
}

async function getThread(threadId, userId, userRole) {
  const thread = await ForumThread.findOne({ _id: threadId, removed: false });
  if (!thread) throw httpError(404, { error: 'Thread not found' });
  if (thread.groupId) {
    const group = await Group.findById(thread.groupId).lean();
    if (!canViewGroupForum(group, userId, userRole)) throw httpError(403, { error: 'Not authorized to view this thread' });
  }
  const posts = await ForumPost.find({ threadId: thread._id, removed: false }).sort({ createdAt: 1 });
  const postsResponse = await Promise.all(posts.map(buildForumPostResponse));
  const threadResponse = await buildThreadResponse(thread, userId);
  return { thread: threadResponse, posts: postsResponse };
}

async function replyToThread(threadId, body, userId, userRole) {
  const content = sanitizeInput(body.content || '');
  if (!content) throw httpError(400, { error: 'Content is required' });

  const analysis = analyzeTextForModeration(content);
  const userConfirmed = !!body.userConfirmedModeration;
  if (analysis.alertRequired && !userConfirmed) {
    throw httpError(409, { error: 'moderation_confirmation_required', message: 'This post may contain PHI, spam, or promotional content. This post will be monitored. Are you sure you want to post?', analysis });
  }
  const isPendingReview = analysis.alertRequired && userConfirmed;

  const thread = await ForumThread.findOne({ _id: threadId, removed: false });
  if (!thread) throw httpError(404, { error: 'Thread not found' });
  if (thread.groupId) {
    const group = await Group.findById(thread.groupId).lean();
    if (!canViewGroupForum(group, userId, userRole)) throw httpError(403, { error: 'Not authorized to reply to this thread' });
  }

  const repliedToUserId = body.repliedToUserId || null;
  if (repliedToUserId) {
    const userExists = await User.exists({ _id: repliedToUserId });
    if (!userExists) throw httpError(400, { error: 'Invalid user to reply to' });
  }

  const now = new Date();
  const newPost = await ForumPost.create({ _id: uuidv4(), threadId: thread._id, authorId: userId, content, repliedToUserId, createdAt: now, updatedAt: now, removed: false, moderation: { status: isPendingReview ? 'PENDING_REVIEW' : 'ALLOW', analysis, flaggedAt: isPendingReview ? now : null, flaggedBy: isPendingReview ? userId : null } });

  thread.updatedAt = now;
  await thread.save();
  notifyForumReply(userId, thread.creatorId, thread._id, newPost._id, repliedToUserId).catch(err => console.error('Error creating forum reply notifications:', err));
  await checkBadgesAfterPost(userId, userRole);

  const response = await buildForumPostResponse(newPost);
  return { _statusCode: 201, post: response };
}

async function removeThread(threadId, userId) {
  const thread = await ForumThread.findById(threadId);
  if (!thread) throw httpError(404, { error: 'Thread not found' });
  thread.removed = true;
  thread.removedBy = userId;
  thread.removedAt = new Date();
  await thread.save();
  return { success: true };
}

async function editPost(postId, content, userId) {
  const sanitized = sanitizeInput(content || '');
  if (!sanitized) throw httpError(400, { error: 'Content is required' });
  const post = await ForumPost.findOne({ _id: postId, removed: false });
  if (!post) throw httpError(404, { error: 'Post not found' });
  if (post.authorId !== userId) throw httpError(403, { error: 'Not authorized to edit this post' });
  post.content = sanitized;
  post.updatedAt = new Date();
  await post.save();
  const response = await buildForumPostResponse(post);
  return { post: response };
}

async function deletePost(postId, userId) {
  const post = await ForumPost.findById(postId);
  if (!post) throw httpError(404, { error: 'Post not found' });
  if (post.authorId !== userId) throw httpError(403, { error: 'Not authorized to delete this post' });
  post.removed = true;
  post.removedAt = new Date();
  await post.save();
  const thread = await ForumThread.findById(post.threadId);
  if (thread) { thread.updatedAt = new Date(); await thread.save(); }
  return { success: true };
}

module.exports = { getThreads, createThread, getThread, replyToThread, removeThread, editPost, deletePost };
