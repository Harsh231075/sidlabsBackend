const { v4: uuidv4 } = require('uuid');
const Conversation = require('../../models/Conversation');
const Message = require('../../models/Message');
const User = require('../../models/User');
const Follow = require('../../models/Follow');
const FriendRequest = require('../../models/FriendRequest');
const { sanitizeInput } = require('../../utils/moderation');
const { canMessageUsers, isUserBlocked } = require('../../utils/messaging');
const { getIoInstance, emitNewMessage, emitMessageUpdated, emitConversationUpdate } = require('../../socket');
const { notifyNewMessage } = require('../../utils/notifications');
const { scan: moderationScan } = require('../../services/moderationService');
const { toPublicUrl } = require('../../utils/publicUrl');
const storageService = require('../../services/storageService');
const { httpError } = require('../../utils/httpError');

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return (!Number.isFinite(n) || n <= 0) ? fallback : n;
}

function encodeCursor(createdAt, id) {
  return Buffer.from(`${new Date(createdAt).toISOString()}|${id}`, 'utf8').toString('base64');
}

function decodeCursor(cursor) {
  try {
    const decoded = Buffer.from(String(cursor), 'base64').toString('utf8');
    const [iso, id] = decoded.split('|');
    const createdAt = new Date(iso);
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch { return null; }
}

function isParticipant(conv, userId) { return conv.participantIds?.includes(userId); }

async function loadConversationsForUser(userId) {
  const conversations = await Conversation.find({ participantIds: userId }).sort({ updatedAt: -1 }).lean();
  const userIds = new Set();
  conversations.forEach(c => c.participantIds.forEach(p => userIds.add(p)));
  const users = await User.find({ _id: { $in: Array.from(userIds) } }).select('name role').lean();
  const userMap = new Map(users.map(u => [u._id, { id: u._id, name: u.name, role: u.role }]));
  return conversations.map(conv => ({
    id: conv._id || conv.id, ...conv,
    participants: conv.participantIds.map(id => userMap.get(id)).filter(Boolean),
  }));
}

async function checkBlockStatus(userId, otherIds) {
  const idsToCheck = Array.isArray(otherIds) ? otherIds : [otherIds];
  const BlockedUser = require('../../models/BlockedUser');
  const blockFound = await BlockedUser.findOne({
    $or: [
      { blockerId: userId, blockedId: { $in: idsToCheck } },
      { blockerId: { $in: idsToCheck }, blockedId: userId }
    ]
  }).lean();

  if (blockFound) {
    const isIBlockedThem = blockFound.blockerId === userId;
    let msg = 'Cannot message due to a block.';
    if (isIBlockedThem) msg = 'You have blocked a participant. Unblock them to send messages.';
    else msg = 'A user in this conversation has blocked you.';
    throw httpError(403, { error: msg });
  }
}

async function ensureConversation(currentUserId, targetUserId) {
  if (currentUserId === targetUserId) throw httpError(400, { error: 'Cannot message yourself' });

  const [currentUser, targetUser] = await Promise.all([User.findById(currentUserId), User.findById(targetUserId)]);
  if (!targetUser) throw httpError(404, { error: 'Target user not found' });

  await checkBlockStatus(currentUserId, targetUserId);

  let existing = await Conversation.findOne({ isGroup: false, participantIds: { $all: [currentUserId, targetUserId] } });
  let isNew = false;
  if (!existing) {
    existing = await Conversation.create({ _id: uuidv4(), participantIds: [currentUserId, targetUserId], isGroup: false, createdAt: new Date(), updatedAt: new Date() });
    isNew = true;
  }

  const participantsUsers = await User.find({ _id: { $in: existing.participantIds } }).select('name role').lean();
  const userMap = new Map(participantsUsers.map(u => [u._id, u]));
  const participants = existing.participantIds.map(id => {
    const u = userMap.get(id);
    return u ? { id: u._id, name: u.name, role: u.role } : null;
  }).filter(Boolean);
  const conversationResult = { ...existing.toObject(), participants };

  if (isNew) {
    const io = getIoInstance();
    if (io) emitConversationUpdate(io, conversationResult, [currentUserId, targetUserId]).catch(err => console.error('Error emitting conversation update:', err));
  }
  return { conversation: conversationResult };
}

function handleModerationBlock(moderationResult) {
  if (moderationResult.status === 'REJECT') throw httpError(400, { error: 'content_rejected', message: 'This message cannot be sent. It violates our community guidelines.', flags: moderationResult.flags, reason: 'Message rejected due to policy violations' });
  if (moderationResult.status === 'QUARANTINE') throw httpError(400, { error: 'content_quarantined', message: 'This message cannot be sent. It contains sensitive information or requires review.', flags: moderationResult.flags, reason: 'Message requires moderator review before sending' });
  if (moderationResult.status === 'SOFT_BLOCK') throw httpError(400, { error: 'content_blocked', message: 'This message cannot be sent. Please revise and try again.', flags: moderationResult.flags, reason: 'Message contains potentially problematic content' });
}

async function getConversations(userId) {
  return await loadConversationsForUser(userId);
}

async function startConversation(userId, targetEmail) {
  const target = await User.findOne({ email: targetEmail });
  if (!target) throw httpError(404, { error: 'Target user not found' });
  return await ensureConversation(userId, target.id);
}

async function startConversationByUserId(userId, targetUserId) {
  return await ensureConversation(userId, targetUserId);
}

async function createGroup(userId, participantIds, name) {
  const allParticipants = [...new Set([userId, ...participantIds])];
  if (allParticipants.length < 2) throw httpError(400, { error: 'Group conversation must have at least 2 participants' });

  for (const pid of allParticipants) {
    for (const oid of allParticipants) {
      if (pid !== oid) {
        const canMsg = await canMessageUsers(pid, oid);
        if (!canMsg) throw httpError(403, { error: 'Cannot create group. Some users cannot message each other (blocked).' });
      }
    }
  }

  const newConv = await Conversation.create({ _id: uuidv4(), participantIds: allParticipants, isGroup: true, name: name || null, createdBy: userId, createdAt: new Date(), updatedAt: new Date() });
  const users = await User.find({ _id: { $in: allParticipants } }).lean();
  const participants = allParticipants.map(id => users.find(u => u._id === id)).filter(Boolean).map(u => ({ id: u._id, name: u.name, role: u.role }));
  const result = { ...newConv.toObject(), participants };

  const io = getIoInstance();
  if (io) emitConversationUpdate(io, result, allParticipants).catch(err => console.error('Error emitting group conversation update:', err));
  return { conversation: result };
}

async function getConversation(userId, convId, query) {
  const conv = await Conversation.findById(convId).select('participantIds isGroup name createdBy createdAt updatedAt').lean();
  if (!conv) throw httpError(404, { error: 'Conversation not found' });
  if (!isParticipant(conv, userId)) throw httpError(403, { error: 'Not authorized' });

  const limit = Math.min(parsePositiveInt(query.limit, 50), 200);
  const before = query.before ? decodeCursor(query.before) : null;

  const messageQuery = { convId };
  if (before) messageQuery.$or = [{ createdAt: { $lt: before.createdAt } }, { createdAt: before.createdAt, _id: { $lt: before.id } }];

  const [messages, participantsUsers] = await Promise.all([
    Message.find(messageQuery).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).select('convId senderId text mediaUrl createdAt editedAt visible').lean(),
    User.find({ _id: { $in: conv.participantIds } }).select('name role').lean(),
  ]);

  const senderIds = [...new Set(messages.map(m => m.senderId).filter(Boolean))];
  const senders = senderIds.length ? await User.find({ _id: { $in: senderIds } }).select('name role').lean() : [];
  const senderMap = new Map(senders.map(u => [u._id, u]));

  const hasMore = messages.length > limit;
  const page = hasMore ? messages.slice(0, limit) : messages;
  const ordered = page.reverse();
  const nextCursor = hasMore ? encodeCursor(ordered[0].createdAt, ordered[0]._id) : null;

  const convMessages = ordered.map(m => {
    const sender = senderMap.get(m.senderId);
    const { _id, __v, ...rest } = m;
    return { id: _id, ...rest, sender: sender ? { id: sender._id, name: sender.name } : null };
  });

  const participants = conv.participantIds.map(id => participantsUsers.find(u => u._id === id)).filter(Boolean).map(u => ({ id: u._id, name: u.name, role: u.role }));
  const { _id: convObjId, __v, ...convRest } = conv;

  return { conversation: { id: convObjId, ...convRest, participants }, messages: convMessages, nextCursor };
}

async function sendMessage(userId, convId, text, image) {
  const conv = await Conversation.findById(convId);
  if (!conv) throw httpError(404, { error: 'Conversation not found' });
  if (!isParticipant(conv, userId)) throw httpError(403, { error: 'Not authorized' });
  if (!(text || '').trim() && !image) throw httpError(400, { error: 'Message must include text or image' });

  const otherParticipantIds = conv.participantIds.filter(pid => pid !== userId);
  if (otherParticipantIds.length > 0) {
    await checkBlockStatus(userId, otherParticipantIds);
  }

  let moderationResult;
  if (text && text.trim()) {
    moderationResult = await moderationScan({ text, userId, context: { type: 'message', conversationId: convId } });
  } else {
    moderationResult = { status: 'ALLOW', scores: { phi_score: 0, spam_score: 0, sales_pitch_score: 0, toxicity_score: 0, link_risk_score: 0, user_trust_score: 0 }, flags: [], detectedSpans: [], timestamp: new Date().toISOString(), context: { type: 'message-image', conversationId: convId } };
  }
  handleModerationBlock(moderationResult);

  const sanitizedText = sanitizeInput(text || '');
  const now = new Date();
  const sender = await User.findById(userId).lean();

  let mediaUrl = '';
  if (image) {
    let base64 = image; let mime = 'image/png';
    const match = String(image).match(/^data:(.+);base64,(.+)$/);
    if (match) { mime = match[1]; base64 = match[2]; }
    const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const filename = `${userId}-${Date.now()}.${ext}`;
    const buffer = Buffer.from(base64, 'base64');
    const uploaded = await storageService.upload({ buffer, contentType: mime, key: `messages/${filename}` });
    mediaUrl = uploaded.url;
  }

  const newMsg = await Message.create({ _id: uuidv4(), convId: conv.id, senderId: userId, text: sanitizedText, mediaUrl, createdAt: now, moderation: { status: moderationResult.status, scores: moderationResult.scores, flags: moderationResult.flags, scannedAt: moderationResult.timestamp }, visible: true });
  conv.updatedAt = now;
  await conv.save();

  const enriched = { ...newMsg.toObject(), mediaUrl: toPublicUrl(newMsg.mediaUrl), sender: sender ? { id: sender._id, name: sender.name, role: sender.role } : null };

  const io = getIoInstance();
  if (io) emitNewMessage(io, enriched, conv.id).catch(err => console.error('Error emitting new message:', err));

  (async () => {
    try {
      for (const rid of conv.participantIds.filter(pid => pid !== userId)) {
        await notifyNewMessage(userId, rid, conv.id, sanitizedText);
      }
    } catch (err) { console.error('Failed to send message notifications:', err); }
  })();

  return { _statusCode: 201, message: enriched };
}

async function editMessage(userId, convId, messageId, text) {
  const conv = await Conversation.findById(convId).select('participantIds').lean();
  if (!conv) throw httpError(404, { error: 'Conversation not found' });
  if (!isParticipant(conv, userId)) throw httpError(403, { error: 'Not authorized' });

  const message = await Message.findById(messageId);
  if (!message || String(message.convId) !== String(convId)) throw httpError(404, { error: 'Message not found' });
  if (String(message.senderId) !== String(userId)) throw httpError(403, { error: 'You can only edit your own messages' });
  if (message.visible === false) throw httpError(400, { error: 'Message cannot be edited' });
  if (!(text || '').trim()) throw httpError(400, { error: 'Message text is required' });

  const moderationResult = await moderationScan({ text, userId, context: { type: 'message-edit', conversationId: convId, messageId } });
  handleModerationBlock(moderationResult);

  message.text = sanitizeInput(text);
  message.editedAt = new Date();
  message.moderation = { status: moderationResult.status, scores: moderationResult.scores, flags: moderationResult.flags, scannedAt: moderationResult.timestamp };
  await message.save();

  const sender = await User.findById(userId).lean();
  const enriched = { ...message.toObject(), mediaUrl: toPublicUrl(message.mediaUrl), sender: sender ? { id: sender._id, name: sender.name, role: sender.role } : null };

  const io = getIoInstance();
  if (io) emitMessageUpdated(io, enriched, convId).catch(err => console.error('Error emitting message update:', err));

  return { message: enriched };
}

module.exports = { getConversations, startConversation, startConversationByUserId, createGroup, getConversation, sendMessage, editMessage };
