const express = require('express');
const { authenticate, requireRole } = require('../../utils/auth');
const ctrl = require('./users.controller');

const router = express.Router();

router.get('/', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.getUsers);
router.put('/me', authenticate, ctrl.updateMyProfile);
router.post('/me/avatar', authenticate, ctrl.uploadAvatar);
router.delete('/me/avatar', authenticate, ctrl.removeAvatar);
router.post('/me/cover', authenticate, ctrl.uploadCover);
router.delete('/me/cover', authenticate, ctrl.removeCover);
router.get('/me/reports', authenticate, ctrl.getMyReports);
router.put('/:id', authenticate, ctrl.updateUser);
router.get('/:id/badges', authenticate, ctrl.getUserBadges);
router.post('/:id/block', authenticate, ctrl.blockUser);
router.post('/:id/unblock', authenticate, ctrl.unblockUser);
router.get('/me/blocked', authenticate, ctrl.getBlockedUsersList);

module.exports = router;
