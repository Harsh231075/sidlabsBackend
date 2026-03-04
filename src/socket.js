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
  const { createAdapter } = require('@socket.io/redis-adapter');
  const redisService = require('./services/redisClient');

  const io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Setup Redis Adapter for multi-instance scaling
  try {
    const pubClient = redisService.getClient().duplicate();
    const subClient = redisService.getClient().duplicate();

    // Prevent unhandled error crashes if Redis is unreachable
    pubClient.on('error', () => { });
    subClient.on('error', () => { });

    // We must wait for the clients to connect because the main client has enableOfflineQueue: false
    Promise.all([pubClient.connect(), subClient.connect()])
      .then(() => {
        io.adapter(createAdapter(pubClient, subClient));
        console.log('[Socket.io] Redis adapter configured for scaling');
      })
      .catch((err) => {
        console.warn('[Socket.io] Redis connection failed, falling back to in-memory adapter:', err.message);
      });
  } catch (err) {
    console.warn('[Socket.io] Redis adapter failed to initialize:', err.message);
  }

  // Authentication middleware for Socket.io
  const { verifyCognitoToken, extractUserFromPayload } = require('./utils/cognitoAuth');
  const User = require('./models/User');
  const { v4: uuidv4 } = require('uuid');

  io.use(async (socket, next) => {
    try {
      let token = socket.handshake.auth.token;
      if (!token) {
        console.error('Socket auth failed: Token missing');
        return next(new Error('Authentication error: Token missing'));
      }

      // Remove Bearer prefix if present
      if (token.startsWith('Bearer ')) {
        token = token.slice(7, token.length).trim();
      }

      const authProvider = process.env.AUTH_PROVIDER || 'local';

      if (authProvider === 'cognito') {
        const payload = await verifyCognitoToken(token);
        const userInfo = extractUserFromPayload(payload);

        // Find user in DB
        let dbUser = await User.findOne({ cognitoSub: userInfo.cognitoSub });

        if (!dbUser && userInfo.email) {
          dbUser = await User.findOne({ email: userInfo.email.trim().toLowerCase() });

          if (dbUser) {
            // Link existing user
            dbUser.cognitoSub = userInfo.cognitoSub;
            dbUser.authProvider = 'cognito';
            await dbUser.save();
          }
        }

        if (!dbUser) {
          // Create if missing (fallback, though usually created on login)
          const now = new Date();
          const email = userInfo.email ? userInfo.email.trim().toLowerCase() : '';
          const name = email.split('@')[0] || 'User';

          dbUser = await User.create({
            _id: uuidv4(),
            cognitoSub: userInfo.cognitoSub,
            name: name,
            email: email,
            role: userInfo.role,
            roleType: userInfo.roleType,
            authProvider: 'cognito',
            isPatient: userInfo.roleType === 'patient',
            disease: '',
            caregiverRelationship: '',
            location: '',
            bio: '',
            createdAt: now,
            updatedAt: now,
          });
        }

        socket.userId = dbUser._id.toString();
        socket.user = {
          id: dbUser._id.toString(),
          role: dbUser.role,
          email: dbUser.email,
          name: dbUser.name
        };

      } else {
        // Local JWT
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.userId = decoded.id;
        socket.user = decoded;
      }

      next();
    } catch (error) {
      console.error('Socket auth failed:', error.message);
      next(new Error('Authentication error: ' + error.message));
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

    // Handle joining group rooms
    socket.on('join_group', (groupId) => {
      socket.join(`group:${groupId}`);
      console.log(`User ${userId} joined room group:${groupId}`);
    });

    // Handle leaving group rooms
    socket.on('leave_group', (groupId) => {
      socket.leave(`group:${groupId}`);
      // console.log(`User ${userId} left group ${groupId}`);
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
 * Emit an updated message to conversation participants (e.g., message edited)
 */
async function emitMessageUpdated(io, message, conversationId) {
  if (!io) return;

  try {
    const conversation = await Conversation.findById(conversationId).select('participantIds').lean();

    if (conversation) {
      io.to(`conversation:${conversationId}`).emit('message_updated', {
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

/**
 * Emit a new group chat message
 */
async function emitGroupMessage(io, message, groupId) {
  if (!io) return;
  console.log(`Emitting group_message to room group:${groupId}`, { id: message.id });
  io.to(`group:${groupId}`).emit('group_message', {
    ...message, // Should include text, senderId, createdAt, id
    groupId: groupId
  });
}

module.exports = {
  initializeSocket,
  emitNewMessage,
  emitMessageUpdated,
  emitConversationUpdate,
  isUserOnline,
  getPresenceStatus,
  setIoInstance,
  getIoInstance,
  emitGroupMessage,
};

