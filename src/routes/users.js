const express = require('express');
const { authenticate, requireRole } = require('../utils/auth');
const usersController = require('../controllers/usersController');
// Avatar uploads handled in controller via base64 JSON to avoid multipart dependency

const router = express.Router();

// Admin/moderator: list all users
router.get('/', authenticate, requireRole(['admin-user', 'moderator-user']), usersController.getUsers);

// Profile update for the authenticated user
router.put('/me', authenticate, usersController.updateMyProfile);

// Upload avatar for authenticated user
router.post('/me/avatar', authenticate, usersController.uploadAvatar);
router.delete('/me/avatar', authenticate, usersController.removeAvatar);

// Upload cover photo for authenticated user
router.post('/me/cover', authenticate, usersController.uploadCover);
router.delete('/me/cover', authenticate, usersController.removeCover);

// Admin can update any user; owner can update themselves
router.put('/:id', authenticate, usersController.updateUser);

// Get user badges
router.get('/:id/badges', authenticate, usersController.getUserBadges);

// Block a user
router.post('/:id/block', authenticate, usersController.blockUser);

// Unblock a user
router.post('/:id/unblock', authenticate, usersController.unblockUser);

// Get list of blocked users
router.get('/me/blocked', authenticate, usersController.getBlockedUsersList);

module.exports = router;
