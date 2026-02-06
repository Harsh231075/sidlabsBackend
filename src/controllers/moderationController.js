const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Message = require('../models/Message');
const User = require('../models/User'); // Needed to populate reporter emails if not populated
const {
  sendContentApprovedEmailToAuthor,
  sendContentApprovedEmailToReporter,
  sendContentRemovedEmailToAuthor,
  sendContentRemovedEmailToReporter
} = require('../services/emailService');

/**
 * Get quarantined content for moderation queue
 */
async function getQuarantinedContent(req, res, next) {
  try {
    const contentType = req.query.type || 'all'; // 'posts', 'comments', 'messages', 'all'

    const tasks = [];
    if (contentType === 'all' || contentType === 'posts') {
      tasks.push(Post.find({ 'moderation.status': 'QUARANTINE', removed: false }).lean().then(items => ({ type: 'posts', items })));
    }
    if (contentType === 'all' || contentType === 'comments') {
      tasks.push(Comment.find({ 'moderation.status': 'QUARANTINE', removed: false }).lean().then(items => ({ type: 'comments', items })));
    }
    if (contentType === 'all' || contentType === 'messages') {
      tasks.push(Message.find({ 'moderation.status': 'QUARANTINE' }).lean().then(items => ({ type: 'messages', items })));
    }

    const results = await Promise.all(tasks);

    const quarantined = {
      posts: [],
      comments: [],
      messages: [],
    };

    results.forEach(r => {
      quarantined[r.type] = r.items.map(item => ({ ...item, id: item._id }));
    });

    res.json(quarantined);
  } catch (error) {
    next(error);
  }
}

/**
 * Approve quarantined content
 */
async function approveContent(req, res, next) {
  try {
    const { type, id } = req.params; // type: 'post', 'comment', 'message'

    if (!['post', 'comment', 'message'].includes(type)) {
      return res.status(400).json({ error: 'Invalid content type' });
    }

    let model;
    switch (type) {
      case 'post': model = Post; break;
      case 'comment': model = Comment; break;
      case 'message': model = Message; break;
    }

    const item = await model.findById(id);

    if (!item) {
      return res.status(404).json({ error: 'Content not found' });
    }

    if (item.moderation?.status !== 'QUARANTINE') {
      return res.status(400).json({ error: 'Content is not quarantined' });
    }

    // Update moderation status and make visible
    item.moderation.status = 'ALLOW';
    item.visible = true;
    item.moderation.reviewedBy = req.user.id;
    item.moderation.reviewedAt = new Date();

    await item.save();

    await item.save();

    res.json({ success: true, item: { ...item.toObject(), id: item._id } });

    // --- Notifications (Async) ---
    // 1. Notify Author
    // We need author email.
    // Post/Comment usually has authorId.
    if (item.authorId) {
      const author = await User.findById(item.authorId).select('name email');
      if (author) {
        sendContentApprovedEmailToAuthor({
          authorName: author.name,
          authorEmail: author.email,
          contentSummary: item.content ? item.content.substring(0, 50) + '...' : 'Media content'
        })
          .then(() => console.log(`[Moderation] Approved email sent to author ${author.email}`))
          .catch(e => console.error('Failed to email author:', e));
      }
    }

    // 2. Notify Reporters
    if (item.reports && item.reports.length > 0) {
      // Get unique reporter IDs
      const reporterIds = [...new Set(item.reports.map(r => r.reporterId).filter(Boolean))];

      // Find emails
      const reporters = await User.find({ _id: { $in: reporterIds } }).select('name email');

      reporters.forEach(reporter => {
        sendContentApprovedEmailToReporter({
          reporterName: reporter.name,
          reporterEmail: reporter.email,
          contentSummary: item.content ? item.content.substring(0, 50) + '...' : 'Media content'
        }).catch(e => console.error('Failed to email reporter:', e));
      });
    }
  } catch (error) {
    next(error);
  }
}

/**
 * Reject quarantined content
 */
async function rejectContent(req, res, next) {
  try {
    const { type, id } = req.params;

    if (!['post', 'comment', 'message'].includes(type)) {
      return res.status(400).json({ error: 'Invalid content type' });
    }

    let model;
    switch (type) {
      case 'post': model = Post; break;
      case 'comment': model = Comment; break;
      case 'message': model = Message; break;
    }

    const item = await model.findById(id);

    if (!item) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Mark as removed
    item.removed = true;
    if (!item.moderation) item.moderation = {};
    item.moderation.status = 'REJECT';
    item.moderation.reviewedBy = req.user.id;
    item.moderation.reviewedAt = new Date();

    await item.save();

    await item.save();

    res.json({ success: true });

    // --- Notifications (Async) ---
    // 1. Notify Author (Content Removed)
    if (item.authorId) {
      const author = await User.findById(item.authorId).select('name email');
      if (author) {
        sendContentRemovedEmailToAuthor({
          authorName: author.name,
          authorEmail: author.email,
          contentSummary: item.content ? item.content.substring(0, 50) + '...' : 'Media content',
          reason: 'Violation of Community Guidelines'
        })
          .then(() => console.log(`[Moderation] Removed email sent to author ${author.email}`))
          .catch(e => console.error('Failed to email author:', e));
      }
    }

    // 2. Notify Reporters (Action Taken)
    if (item.reports && item.reports.length > 0) {
      const reporterIds = [...new Set(item.reports.map(r => r.reporterId).filter(Boolean))];

      const reporters = await User.find({ _id: { $in: reporterIds } }).select('name email');

      reporters.forEach(reporter => {
        sendContentRemovedEmailToReporter({
          reporterName: reporter.name,
          reporterEmail: reporter.email,
          contentSummary: item.content ? item.content.substring(0, 50) + '...' : 'Media content'
        }).catch(e => console.error('Failed to email reporter:', e));
      });
    }
  } catch (error) {
    next(error);
  }
}

/**
 * Request edit for quarantined content
 */
async function requestEdit(req, res, next) {
  try {
    const { type, id } = req.params;
    const { reason } = req.body;

    if (!['post', 'comment', 'message'].includes(type)) {
      return res.status(400).json({ error: 'Invalid content type' });
    }

    let model;
    switch (type) {
      case 'post': model = Post; break;
      case 'comment': model = Comment; break;
      case 'message': model = Message; break;
    }

    const item = await model.findById(id);

    if (!item) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Mark as needing edit
    if (!item.moderation) item.moderation = {};
    item.moderation.editRequested = true;
    item.moderation.editReason = reason;
    item.moderation.reviewedBy = req.user.id;
    item.moderation.reviewedAt = new Date();

    await item.save();

    res.json({ success: true, item: { ...item.toObject(), id: item._id } });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getQuarantinedContent,
  approveContent,
  rejectContent,
  requestEdit,
};

