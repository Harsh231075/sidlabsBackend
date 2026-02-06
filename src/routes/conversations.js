const express = require('express');
const { authenticate } = require('../utils/auth');
const conversationsController = require('../controllers/conversationsController');

const router = express.Router();

// Get all conversations for the authenticated user
router.get('/', authenticate, conversationsController.getConversations);

// Start a new conversation with a user by email
router.post('/start', authenticate, conversationsController.startConversation);

// Create a group conversation (must be before /:targetUserId to avoid route conflict)
router.post('/group', authenticate, conversationsController.createGroup);

// Send a message in a conversation (must be before /:targetUserId to avoid route conflict)
router.post('/:convId/messages', authenticate, conversationsController.sendMessage);

// Get conversation details and messages
router.get('/:convId', authenticate, conversationsController.getConversation);

// Start a new conversation with a user by userId (must be last to avoid route conflicts)
router.post('/:targetUserId', authenticate, conversationsController.startConversationByUserId);

module.exports = router;
