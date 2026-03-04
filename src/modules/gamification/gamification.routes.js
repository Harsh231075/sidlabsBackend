const express = require('express');
const { authenticate, requireRole } = require('../../utils/auth');
const ctrl = require('./gamification.controller');

const router = express.Router();

router.get('/users/:userId/stats', authenticate, ctrl.getUserGamificationStats);
router.get('/me/stats', authenticate, ctrl.getUserGamificationStats);
router.get('/leaderboard', authenticate, ctrl.getLeaderboardStats);
router.post('/award-tokens', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.awardTokensManually);

module.exports = router;
