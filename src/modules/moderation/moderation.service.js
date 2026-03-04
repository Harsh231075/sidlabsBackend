const Post = require('../../models/Post');
const Comment = require('../../models/Comment');
const Message = require('../../models/Message');
const User = require('../../models/User');
const {
  sendContentApprovedEmailToAuthor,
  sendContentApprovedEmailToReporter,
  sendContentRemovedEmailToAuthor,
  sendContentRemovedEmailToReporter,
} = require('../../services/emailService');
const { httpError } = require('../../utils/httpError');

function getModel(type) {
  switch (type) {
    case 'post': return Post;
    case 'comment': return Comment;
    case 'message': return Message;
    default: return null;
  }
}

function contentSummary(item) {
  return item.content ? item.content.substring(0, 50) + '...' : 'Media content';
}

function notifyApproval(item) {
  if (item.authorId) {
    User.findById(item.authorId).select('name email').then(author => {
      if (!author) return;
      sendContentApprovedEmailToAuthor({ authorName: author.name, authorEmail: author.email, contentSummary: contentSummary(item) })
        .then(() => console.log(`[Moderation] Approved email sent to author ${author.email}`))
        .catch(e => console.error('Failed to email author:', e));
    });
  }
  if (item.reports && item.reports.length > 0) {
    const reporterIds = [...new Set(item.reports.map(r => r.reporterId).filter(Boolean))];
    User.find({ _id: { $in: reporterIds } }).select('name email').then(reporters => {
      reporters.forEach(r => sendContentApprovedEmailToReporter({ reporterName: r.name, reporterEmail: r.email, contentSummary: contentSummary(item) }).catch(e => console.error('Failed to email reporter:', e)));
    });
  }
}

function notifyRejection(item) {
  if (item.authorId) {
    User.findById(item.authorId).select('name email').then(author => {
      if (!author) return;
      sendContentRemovedEmailToAuthor({ authorName: author.name, authorEmail: author.email, contentSummary: contentSummary(item), reason: 'Violation of Community Guidelines' })
        .then(() => console.log(`[Moderation] Removed email sent to author ${author.email}`))
        .catch(e => console.error('Failed to email author:', e));
    });
  }
  if (item.reports && item.reports.length > 0) {
    const reporterIds = [...new Set(item.reports.map(r => r.reporterId).filter(Boolean))];
    User.find({ _id: { $in: reporterIds } }).select('name email').then(reporters => {
      reporters.forEach(r => sendContentRemovedEmailToReporter({ reporterName: r.name, reporterEmail: r.email, contentSummary: contentSummary(item) }).catch(e => console.error('Failed to email reporter:', e)));
    });
  }
}

async function getQuarantinedContent(contentType) {
  const tasks = [];
  if (contentType === 'all' || contentType === 'posts')
    tasks.push(Post.find({ 'moderation.status': 'QUARANTINE', removed: false }).lean().then(items => ({ type: 'posts', items })));
  if (contentType === 'all' || contentType === 'comments')
    tasks.push(Comment.find({ 'moderation.status': 'QUARANTINE', removed: false }).lean().then(items => ({ type: 'comments', items })));
  if (contentType === 'all' || contentType === 'messages')
    tasks.push(Message.find({ 'moderation.status': 'QUARANTINE' }).lean().then(items => ({ type: 'messages', items })));

  const results = await Promise.all(tasks);
  const quarantined = { posts: [], comments: [], messages: [] };
  results.forEach(r => { quarantined[r.type] = r.items.map(item => ({ ...item, id: item._id })); });
  return quarantined;
}

async function approveContent(type, id, reviewerId) {
  const model = getModel(type);
  if (!model) throw httpError(400, { error: 'Invalid content type' });

  const item = await model.findById(id);
  if (!item) throw httpError(404, { error: 'Content not found' });
  if (item.moderation?.status !== 'QUARANTINE') throw httpError(400, { error: 'Content is not quarantined' });

  item.moderation.status = 'ALLOW';
  item.visible = true;
  item.moderation.reviewedBy = reviewerId;
  item.moderation.reviewedAt = new Date();
  await item.save(); // fixed: was called twice in original

  notifyApproval(item);
  return { success: true, item: { ...item.toObject(), id: item._id } };
}

async function rejectContent(type, id, reviewerId) {
  const model = getModel(type);
  if (!model) throw httpError(400, { error: 'Invalid content type' });

  const item = await model.findById(id);
  if (!item) throw httpError(404, { error: 'Content not found' });

  item.removed = true;
  if (!item.moderation) item.moderation = {};
  item.moderation.status = 'REJECT';
  item.moderation.reviewedBy = reviewerId;
  item.moderation.reviewedAt = new Date();
  await item.save(); // fixed: was called twice in original

  notifyRejection(item);
  return { success: true };
}

async function requestEdit(type, id, reviewerId, reason) {
  const model = getModel(type);
  if (!model) throw httpError(400, { error: 'Invalid content type' });

  const item = await model.findById(id);
  if (!item) throw httpError(404, { error: 'Content not found' });

  if (!item.moderation) item.moderation = {};
  item.moderation.editRequested = true;
  item.moderation.editReason = reason;
  item.moderation.reviewedBy = reviewerId;
  item.moderation.reviewedAt = new Date();
  await item.save();

  return { success: true, item: { ...item.toObject(), id: item._id } };
}

module.exports = { getQuarantinedContent, approveContent, rejectContent, requestEdit };
