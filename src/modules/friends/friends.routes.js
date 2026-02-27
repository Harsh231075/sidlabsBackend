const express = require('express');
const { authenticate } = require('../../utils/auth');
const ctrl = require('./friends.controller');

const router = express.Router();

router.post('/request/:username', authenticate, ctrl.sendFriendRequest);
router.post('/request/id/:userId', authenticate, ctrl.sendFriendRequestById);
router.put('/request/:requestId/accept', authenticate, ctrl.acceptFriendRequest);
router.put('/request/:requestId/reject', authenticate, ctrl.rejectFriendRequest);
router.delete('/request/:requestId', authenticate, ctrl.cancelFriendRequest);
router.get('/requests', authenticate, ctrl.listFriendRequests);
router.get('/list', authenticate, ctrl.listAcceptedFriends);

module.exports = router;
