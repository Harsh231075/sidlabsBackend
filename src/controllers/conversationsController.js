const { v4: uuidv4 } = require('uuid');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const { sanitizeInput } = require('../utils/moderation');
const { canMessageUsers } = require('../utils/messaging');
const { getIoInstance, emitNewMessage, emitConversationUpdate } = require('../socket');
const { notifyNewMessage } = require('../utils/notifications');
const { scan: moderationScan } = require('../services/moderationService');
const Follow = require('../models/Follow');
const FriendRequest = require('../models/FriendRequest');
const { toPublicUrl } = require('../utils/publicUrl');

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
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
  } catch {
    return null;
  }
}

/**
 * Check if a user is a participant in a conversation
 */
function isParticipant(conversation, userId) {
  return conversation.participantIds?.includes(userId);
}

/**
 * Load conversations for a user with participant details
 */
async function loadConversationsForUser(userId) {
  const conversations = await Conversation.find({ participantIds: userId })
    .sort({ updatedAt: -1 })
    .lean();

  // Populate participants
  // We can also use .populate('participantIds') if ref is set up correctly in model, 
  // but User model uses string _id (which matches), so standard populate works if Schema ref matches.
  // In Conversation.js schema: participantIds: [{ type: String, ref: 'User' }]
  // So we can use populate. But let's stick to manual or simple populate.
  // Actually, let's use manual population to ensure we handle missing users gracefully and structure it exactly as before.

  const userIds = new Set();
  conversations.forEach(c => c.participantIds.forEach(p => userIds.add(p)));
  const users = await User.find({ _id: { $in: Array.from(userIds) } }).lean();

  const withParticipants = conversations.map((conv) => ({
    id: conv._id || conv.id,
    ...conv,
    participants: conv.participantIds
      .map((id) => users.find((u) => u._id === id)) // _id is string
      .filter(Boolean)
      .map((u) => ({ id: u._id, name: u.name, role: u.role })),
  }));
  return withParticipants;
}

/**
 * Ensure a conversation exists between two users (create if doesn't exist)
 */
async function ensureConversation(currentUserId, targetUserId) {
  if (currentUserId === targetUserId) {
    const err = new Error('Cannot message yourself');
    err.status = 400;
    throw err;
  }

  // Check if users can message each other (not blocked)
  const canMessage = await canMessageUsers(currentUserId, targetUserId);
  if (!canMessage) {
    const err = new Error('Cannot message this user. They may have blocked you or you have blocked them.');
    err.status = 403;
    throw err;
    throw err;
  }

  // Check if users are connected (Friends or Following)
  // Logic: Can message if:
  // 1. They are friends (FriendRequest accepted in either direction)
  // 2. OR Current user follows target user
  // 3. OR Target user follows current user (Reciprocal messaging allowed? Usually yes)

  // Let's implement strict: One-way follow allows messaging? Or mutual?
  // User Requirement: "friends and follewer se hi kar paye"
  // Interpretation: Can message if I follow them OR they follow me OR we are friends upon request.
  // Actually, usually messaging requires bidirectional "Friend" or "I follow them" allows me to message? 
  // Let's stick to: Can message if Friends OR (I follow them) OR (They follow me).
  // "Friends" covers "friends". "Follower" covers "following/followers".

  const [friendship, iFollowThem, theyFollowMe] = await Promise.all([
    FriendRequest.findOne({
      $or: [
        { from: currentUserId, to: targetUserId, status: 'accepted' },
        { from: targetUserId, to: currentUserId, status: 'accepted' }
      ]
    }),
    Follow.exists({ follower: currentUserId, following: targetUserId }),
    Follow.exists({ follower: targetUserId, following: currentUserId })
  ]);

  if (!friendship && !iFollowThem && !theyFollowMe) {
    const err = new Error('You can only message friends or people you follow/who follow you.');
    err.status = 403;
    throw err;
  }

  const targetUser = await User.findById(targetUserId);
  if (!targetUser) {
    const err = new Error('Target user not found');
    err.status = 404;
    throw err;
  }

  // Find existing 1-on-1 conv
  let existing = await Conversation.findOne({
    isGroup: false,
    participantIds: { $all: [currentUserId, targetUserId] }
  });

  // Double check it's only 2 people (though isGroup: false usually implies it)
  // Our schema doesn't enforce size, but logic does.

  let isNew = false;
  if (!existing) {
    existing = await Conversation.create({
      _id: uuidv4(),
      participantIds: [currentUserId, targetUserId],
      isGroup: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    isNew = true;
  }

  // Populate participants for response
  const participantsUsers = await User.find({ _id: { $in: existing.participantIds } }).lean();
  const participants = existing.participantIds
    .map((id) => participantsUsers.find((u) => u._id === id))
    .filter(Boolean)
    .map((u) => ({ id: u._id, name: u.name, role: u.role }));

  const conversationResult = { ...existing.toObject(), participants };

  // Emit conversation update via WebSocket if it's a new conversation
  if (isNew) {
    const io = getIoInstance();
    if (io) {
      emitConversationUpdate(io, conversationResult, [currentUserId, targetUserId]).catch((err) => {
        console.error('Error emitting conversation update:', err);
      });
    }
  }

  return { conversation: conversationResult };
}

/**
 * Create a group conversation
 */
async function createGroupConversation(currentUserId, participantIds, name) {
  // Include current user in participants
  const allParticipants = [...new Set([currentUserId, ...participantIds])];

  if (allParticipants.length < 2) {
    const err = new Error('Group conversation must have at least 2 participants');
    err.status = 400;
    throw err;
  }

  // Check blocking status for all participants
  for (const participantId of allParticipants) {
    for (const otherId of allParticipants) {
      if (participantId !== otherId) {
        const canMessage = await canMessageUsers(participantId, otherId);
        if (!canMessage) {
          const err = new Error('Cannot create group. Some users cannot message each other (blocked).');
          err.status = 403;
          throw err;
        }
      }
    }
  }

  const newConversation = await Conversation.create({
    _id: uuidv4(),
    participantIds: allParticipants,
    isGroup: true,
    name: name || null,
    createdBy: currentUserId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const users = await User.find({ _id: { $in: allParticipants } }).lean();
  const participants = allParticipants
    .map((id) => users.find((u) => u._id === id))
    .filter(Boolean)
    .map((u) => ({ id: u._id, name: u.name, role: u.role }));

  const conversationResult = { ...newConversation.toObject(), participants };

  // Emit conversation update via WebSocket
  const io = getIoInstance();
  if (io) {
    emitConversationUpdate(io, conversationResult, allParticipants).catch((err) => {
      console.error('Error emitting group conversation update:', err);
    });
  }

  return { conversation: conversationResult };
}

/**
 * Get all conversations for the authenticated user
 */
async function getConversations(req, res, next) {
  try {
    const convs = await loadConversationsForUser(req.user.id);
    res.json(convs);
  } catch (error) {
    next(error);
  }
}

/**
 * Start a new conversation with a user by email
 */
async function startConversation(req, res, next) {
  try {
    const targetEmail = (req.body.targetEmail || '').trim().toLowerCase();
    const target = await User.findOne({ email: targetEmail });
    if (!target) return res.status(404).json({ error: 'Target user not found' });
    const result = await ensureConversation(req.user.id, target.id);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Start a new conversation with a user by userId
 */
async function startConversationByUserId(req, res, next) {
  try {
    const result = await ensureConversation(req.user.id, req.params.targetUserId);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get conversation details and messages
 */
async function getConversation(req, res, next) {
  try {
    const conv = await Conversation.findById(req.params.convId).lean();
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (!isParticipant(conv, req.user.id)) return res.status(403).json({ error: 'Not authorized' });

    const limit = Math.min(parsePositiveInt(req.query.limit, 50), 200);
    const before = req.query.before ? decodeCursor(req.query.before) : null;

    const messageQuery = { convId: req.params.convId };
    if (before) {
      messageQuery.$or = [
        { createdAt: { $lt: before.createdAt } },
        { createdAt: before.createdAt, _id: { $lt: before.id } },
      ];
    }

    // Fetch newest first then reverse to keep UI chronological.
    const messages = await Message.find(messageQuery)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .populate('senderId', 'name role')
      .lean();

    const hasMore = messages.length > limit;
    const page = hasMore ? messages.slice(0, limit) : messages;
    const ordered = page.reverse();
    const nextCursor = hasMore ? encodeCursor(ordered[0].createdAt, ordered[0]._id) : null;

    const convMessages = ordered.map((m) => ({
      ...m,
      sender: m.senderId
        ? {
          id: m.senderId._id,
          name: m.senderId.name,
          // role: m.senderId.role // Optional if needed
        }
        : null,
      // Map senderID to senderId in string if needed or rely on populate
      senderId: m.senderId ? m.senderId._id : m.senderId
    }));

    // Participants for the conversation object
    const users = await User.find({ _id: { $in: conv.participantIds } }).lean();
    const participants = conv.participantIds
      .map((id) => users.find((u) => u._id === id))
      .filter(Boolean)
      .map((u) => ({ id: u._id, name: u.name, role: u.role }));

    res.json({ conversation: { ...conv, participants }, messages: convMessages, nextCursor });
  } catch (error) {
    next(error);
  }
}

/**
 * Send a message in a conversation
 */
const storageService = require('../services/storageService');

async function sendMessage(req, res, next) {
  try {
    const conv = await Conversation.findById(req.params.convId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (!isParticipant(conv, req.user.id)) return res.status(403).json({ error: 'Not authorized' });

    const text = (req.body.text || '').toString();
    const image = req.body.image || null; // base64 or data URL
    if (!text.trim() && !image) return res.status(400).json({ error: 'Message must include text or image' });

    // Run moderation scan only when text is present; allow image-only messages
    let moderationResult;
    if (text && text.trim()) {
      moderationResult = await moderationScan({
        text: text,
        userId: req.user.id,
        context: { type: 'message', conversationId: req.params.convId },
      });
    } else {
      moderationResult = {
        status: 'ALLOW',
        scores: {
          phi_score: 0,
          spam_score: 0,
          sales_pitch_score: 0,
          toxicity_score: 0,
          link_risk_score: 0,
          user_trust_score: 0,
        },
        flags: [],
        detectedSpans: [],
        timestamp: new Date().toISOString(),
        context: { type: 'message-image', conversationId: req.params.convId },
      };
    }

    // Block submission if content is risky (REJECT, QUARANTINE, or SOFT_BLOCK)
    if (moderationResult.status === 'REJECT') {
      return res.status(400).json({
        error: 'content_rejected',
        message: 'This message cannot be sent. It violates our community guidelines.',
        flags: moderationResult.flags,
        reason: 'Message rejected due to policy violations',
      });
    }

    if (moderationResult.status === 'QUARANTINE') {
      return res.status(400).json({
        error: 'content_quarantined',
        message: 'This message cannot be sent. It contains sensitive information or requires review.',
        flags: moderationResult.flags,
        reason: 'Message requires moderator review before sending',
      });
    }

    if (moderationResult.status === 'SOFT_BLOCK') {
      return res.status(400).json({
        error: 'content_blocked',
        message: 'This message cannot be sent. Please revise and try again.',
        flags: moderationResult.flags,
        reason: 'Message contains potentially problematic content',
      });
    }

    const sanitizedText = sanitizeInput(text);

    const now = new Date();
    const sender = await User.findById(req.user.id).lean();

    // Optional: handle image upload if provided
    let mediaUrl = '';
    if (image) {
      let base64 = image;
      let mime = 'image/png';
      const dataUrlMatch = String(image).match(/^data:(.+);base64,(.+)$/);
      if (dataUrlMatch) {
        mime = dataUrlMatch[1];
        base64 = dataUrlMatch[2];
      }
      const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase();
      const filename = `${req.user.id}-${Date.now()}.${ext}`;
      const buffer = Buffer.from(base64, 'base64');
      const uploaded = await storageService.upload({ buffer, contentType: mime, key: `messages/${filename}` });
      mediaUrl = uploaded.url;
    }

    // Create Message
    const newMessage = await Message.create({
      _id: uuidv4(),
      convId: conv.id,
      senderId: req.user.id,
      text: sanitizedText,
      mediaUrl,
      createdAt: now,
      moderation: {
        status: moderationResult.status,
        scores: moderationResult.scores,
        flags: moderationResult.flags,
        scannedAt: moderationResult.timestamp,
      },
      visible: true,
    });

    // Update Conversation timestamp
    conv.updatedAt = now;
    await conv.save();

    // Enrich message with sender info
    const enrichedMessage = {
      ...newMessage.toObject(),
      mediaUrl: toPublicUrl(newMessage.mediaUrl),
      sender: sender ? { id: sender._id, name: sender.name, role: sender.role } : null,
    };

    // Emit new message via WebSocket
    const io = getIoInstance();
    if (io) {
      emitNewMessage(io, enrichedMessage, conv.id).catch((err) => {
        console.error('Error emitting new message:', err);
      });
    }

    // Send notifications to other participants
    // Note: Do this asynchronously to not block response
    (async () => {
      try {
        const recipients = conv.participantIds.filter(pid => pid !== req.user.id);
        for (const recipientId of recipients) {
          await notifyNewMessage(req.user.id, recipientId, conv.id, sanitizedText);
        }
      } catch (err) {
        console.error('Failed to send message notifications:', err);
      }
    })();

    res.status(201).json({ message: enrichedMessage });
  } catch (error) {
    next(error);
  }
}

/**
 * Create a group conversation
 */
async function createGroup(req, res, next) {
  try {
    const { participantIds, name } = req.body;
    if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({ error: 'participantIds array is required' });
    }
    const result = await createGroupConversation(req.user.id, participantIds, name);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getConversations,
  startConversation,
  startConversationByUserId,
  getConversation,
  sendMessage,
  createGroup,
};
