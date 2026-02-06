const express = require('express');
const { authenticate, requireRole, optionalAuth } = require('../utils/auth');
const {
  createDiseasePage,
  getDiseasePages,
  getDiseasePageBySlug,
  followDiseasePage,
  unfollowDiseasePage,
  featurePost,
  unfeaturePost,
  addResource,
  removeResource,
  updateDiseasePage,
  deleteDiseasePage,
  createEvent,
  getDiseasePagePosts,
  createDiseasePagePost,
  removeDiseasePagePost,
  reviewDiseasePagePost,
  getAllDiseasePagePosts,
  likeDiseasePagePost,
} = require('../controllers/diseasePagesController');

const router = express.Router();

// Create disease page (admin/moderator)
router.post('/', authenticate, requireRole(['admin-user', 'moderator-user']), createDiseasePage);

// Get all disease pages (search/browse) - public but can be authenticated
router.get('/', optionalAuth, getDiseasePages);

// Get single disease page by slug - public but can be authenticated
router.get('/:slug', optionalAuth, getDiseasePageBySlug);

// Follow disease page
router.post('/:slug/follow', authenticate, followDiseasePage);

// Unfollow disease page
router.delete('/:slug/follow', authenticate, unfollowDiseasePage);

// ===== Disease Page Posts Routes =====

// Get posts for a disease page (only from followed users)
router.get('/:slug/posts', authenticate, getDiseasePagePosts);

// Get all posts for disease page (moderators - includes all users' posts)
router.get('/:slug/posts/all', authenticate, getAllDiseasePagePosts);

// Create a post on a disease page
router.post('/:slug/posts', authenticate, createDiseasePagePost);

// Like or unlike a post on a disease page
router.post('/:slug/posts/:id/like', authenticate, likeDiseasePagePost);

// Remove a post from disease page (moderator/admin only)
router.delete('/:slug/posts/:postId', authenticate, removeDiseasePagePost);

// Review a post (approve/reject - moderator/admin only)
router.put('/:slug/posts/:postId/review', authenticate, reviewDiseasePagePost);

// ===== Feature Post Routes =====

// Feature a post (editors/admin only)
router.post('/:slug/feature-post', authenticate, featurePost);

// Unfeature a post (editors/admin only)
router.delete('/:slug/feature-post/:postId', authenticate, unfeaturePost);

// Add resource link (editors/admin only)
router.post('/:slug/resources', authenticate, addResource);

// Remove resource link (editors/admin only)
router.delete('/:slug/resources/:resourceId', authenticate, removeResource);

// Update disease page (editors/admin only)
router.put('/:slug', authenticate, updateDiseasePage);

// Delete disease page (admin/moderator only)
router.delete('/:slug', authenticate, deleteDiseasePage);

// Create event tied to disease page (editors/admin only)
router.post('/:slug/events', authenticate, createEvent);

module.exports = router;

