const express = require('express');
const { authenticate, requireRole } = require('../utils/auth');
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
} = require('../controllers/diseasePagesController');

const router = express.Router();

// Create disease page (admin/moderator)
router.post('/', authenticate, requireRole(['admin-user', 'moderator-user']), createDiseasePage);

// Get all disease pages (search/browse) - public but can be authenticated
router.get('/', getDiseasePages);

// Get single disease page by slug - public but can be authenticated
router.get('/:slug', getDiseasePageBySlug);

// Follow disease page
router.post('/:slug/follow', authenticate, followDiseasePage);

// Unfollow disease page
router.delete('/:slug/follow', authenticate, unfollowDiseasePage);

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

