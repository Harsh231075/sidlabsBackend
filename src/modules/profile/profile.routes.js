const express = require('express');
const { authenticate, optionalAuth } = require('../../utils/auth');
const profileController = require('./profile.controller');

const router = express.Router();

router.get('/:username', optionalAuth, profileController.getProfileByUsername);
router.get('/id/:userId', optionalAuth, profileController.getProfileById);
router.get('/:username/posts', optionalAuth, profileController.getUserPosts);
router.get('/:username/likes', optionalAuth, profileController.getUserLikes);
router.get('/:username/comments', optionalAuth, profileController.getUserComments);
router.get('/:username/followers', optionalAuth, profileController.getFollowers);
router.get('/:username/following', optionalAuth, profileController.getFollowing);
router.put('/', authenticate, profileController.updateProfile);
router.post('/:username/follow', authenticate, profileController.followUser);
router.delete('/:username/follow', authenticate, profileController.unfollowUser);

module.exports = router;
