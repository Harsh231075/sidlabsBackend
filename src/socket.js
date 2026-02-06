const jwt = require('jsonwebtoken');
const Conversation = require('./models/Conversation');

const JWT_SECRET = process.env.JWT_SECRET || 'winsights-dev-secret';

// Store active connections: userId -> socketId
const userSockets = new Map();
// Store socket to user mapping: socketId -> userId
const socketUsers = new Map();

/**
 * Initialize Socket.io server
 */
function initializeSocket(server) {
  const { Server } = require('socket.io');
  const io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Authentication middleware for Socket.io
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.id;
      socket.user = decoded;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;

    // Store user connection
    userSockets.set(userId, socket.id);
    socketUsers.set(socket.id, userId);

    console.log(`User ${userId} connected via socket ${socket.id}`);

    // Join user's personal room for direct messaging
    socket.join(`user:${userId}`);

    // Notify conversation participants that user came online
    await notifyUserPresence(io, userId, true);

    // Handle joining conversation rooms
    socket.on('join_conversation', (conversationId) => {
      socket.join(`conversation:${conversationId}`);
      console.log(`User ${userId} joined conversation ${conversationId}`);
    });

    // Handle leaving conversation rooms
    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
      console.log(`User ${userId} left conversation ${conversationId}`);
    });

    // Handle typing indicators
    socket.on('typing', async ({ conversationId, isTyping }) => {
      try {
        const conversation = await Conversation.findById(conversationId).select('participantIds').lean();
        if (conversation && conversation.participantIds.includes(userId)) {
          socket.to(`conversation:${conversationId}`).emit('user_typing', {
            conversationId,
            userId,
            isTyping,
          });
        }
      } catch (e) { console.error(e); }
    });

    // Handle presence status requests
    socket.on('get_presence', async ({ userIds }) => {
      const presence = userIds.map((uid) => ({
        userId: uid,
        isOnline: userSockets.has(uid),
      }));
      socket.emit('presence_status', { presence });
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      console.log(`User ${userId} disconnected`);
      userSockets.delete(userId);
      socketUsers.delete(socket.id);
      // Notify conversation participants that user went offline
      await notifyUserPresence(io, userId, false);
    });
  });

  return io;
}

/**
 * Emit a new message to conversation participants
 */
async function emitNewMessage(io, message, conversationId) {
  if (!io) return;

  try {
    const conversation = await Conversation.findById(conversationId).select('participantIds').lean();

    if (conversation) {
      // Emit to all participants in the conversation room
      io.to(`conversation:${conversationId}`).emit('new_message', {
        message,
        conversationId,
      });
    }
  } catch (e) { console.error(e); }
}

/**
 * Emit conversation update (e.g., new conversation created)
 */
async function emitConversationUpdate(io, conversation, userIds) {
  if (!io) return;

  userIds.forEach((userId) => {
    io.to(`user:${userId}`).emit('conversation_updated', {
      conversation,
    });
  });
}

/**
 * Check if a user is online
 */
function isUserOnline(userId) {
  return userSockets.has(userId);
}

/**
 * Notify conversation participants about user presence change
 */
async function notifyUserPresence(io, userId, isOnline) {
  if (!io) return;

  try {
    // Find all conversations where this user is a participant
    const userConversations = await Conversation.find({ participantIds: userId }).select('participantIds').lean();

    userConversations.forEach((conversation) => {
      // Notify all participants in the conversation
      conversation.participantIds.forEach((participantId) => {
        if (participantId !== userId) {
          io.to(`user:${participantId}`).emit('user_presence', {
            userId,
            conversationId: conversation._id, // doc or lean object uses _id usually
            isOnline,
          });
        }
      });
    });
  } catch (error) {
    console.error('Error notifying user presence:', error);
  }
}

/**
 * Get presence status for multiple users
 */
function getPresenceStatus(userIds) {
  return userIds.map((userId) => ({
    userId,
    isOnline: userSockets.has(userId),
  }));
}

/**
 * Get socket instance (will be set after initialization)
 */
let ioInstance = null;

function setIoInstance(io) {
  ioInstance = io;
}

function getIoInstance() {
  return ioInstance;
}

module.exports = {
  initializeSocket,
  emitNewMessage,
  emitConversationUpdate,
  isUserOnline,
  getPresenceStatus,
  setIoInstance,
  getIoInstance,
};

