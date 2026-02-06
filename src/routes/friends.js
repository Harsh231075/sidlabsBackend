const express = require('express');
const { authenticate } = require('../utils/auth');
const friendsController = require('../controllers/friendsController');

const router = express.Router();

router.post('/request/:username', authenticate, friendsController.sendFriendRequest);
router.post('/request/id/:userId', authenticate, friendsController.sendFriendRequestById);
router.put('/request/:requestId/accept', authenticate, friendsController.acceptFriendRequest);
router.put('/request/:requestId/reject', authenticate, friendsController.rejectFriendRequest);
router.delete('/request/:requestId', authenticate, friendsController.cancelFriendRequest);
router.get('/requests', authenticate, friendsController.listFriendRequests);
router.get('/list', authenticate, friendsController.listAcceptedFriends);

module.exports = router;
