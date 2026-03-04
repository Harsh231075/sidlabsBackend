const express = require('express');
const { authenticate } = require('../../utils/auth');
const ctrl = require('./conversations.controller');

const router = express.Router();

router.get('/', authenticate, ctrl.getConversations);
router.post('/', authenticate, ctrl.startConversation);
router.post('/user/:targetUserId', authenticate, ctrl.startConversationByUserId);
router.post('/group', authenticate, ctrl.createGroup);
router.get('/:convId', authenticate, ctrl.getConversation);
router.post('/:convId/messages', authenticate, ctrl.sendMessage);
router.put('/:convId/messages/:messageId', authenticate, ctrl.editMessage);

module.exports = router;
