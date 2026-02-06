/**
 * Profile Routes
 * 
 * Public and authenticated routes for profile management
 */

const express = require('express');
const { authenticate, optionalAuth } = require('../utils/auth');
const profileController = require('../controllers/profileController');

const router = express.Router();

// ============================================
// Public Routes (with optional auth for isFollowing check)
// ============================================

// Get profile by username
router.get('/:username', optionalAuth, profileController.getProfileByUsername);

// Get profile by user ID
router.get('/id/:userId', optionalAuth, profileController.getProfileById);

// Get user's posts
router.get('/:username/posts', optionalAuth, profileController.getUserPosts);

// Get user's liked posts
router.get('/:username/likes', optionalAuth, profileController.getUserLikes);

// Get user's comments
router.get('/:username/comments', optionalAuth, profileController.getUserComments);

// Get followers list
router.get('/:username/followers', optionalAuth, profileController.getFollowers);

// Get following list
router.get('/:username/following', optionalAuth, profileController.getFollowing);

// ============================================
// Authenticated Routes
// ============================================

// Update own profile
router.put('/', authenticate, profileController.updateProfile);

// Follow a user
router.post('/:username/follow', authenticate, profileController.followUser);

// Unfollow a user
router.delete('/:username/follow', authenticate, profileController.unfollowUser);

module.exports = router;
