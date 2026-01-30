const express = require('express');
const { authenticate, requireRole } = require('../utils/auth');
const gamificationController = require('../controllers/gamificationController');

const router = express.Router();

// Get user's gamification stats
router.get('/users/:userId/stats', authenticate, gamificationController.getUserGamificationStats);

// Get current user's stats (shortcut)
router.get('/me/stats', authenticate, gamificationController.getUserGamificationStats);

// Get leaderboard
router.get('/leaderboard', authenticate, gamificationController.getLeaderboardStats);

// Manually award tokens (admin/moderator only)
router.post('/award-tokens', authenticate, requireRole(['admin-user', 'moderator-user']), gamificationController.awardTokensManually);

module.exports = router;

