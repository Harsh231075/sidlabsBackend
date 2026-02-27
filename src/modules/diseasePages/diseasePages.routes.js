const express = require('express');
const { authenticate, requireRole, optionalAuth } = require('../../utils/auth');
const ctrl = require('./diseasePages.controller');

const router = express.Router();

router.post('/', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.createDiseasePage);
router.get('/', optionalAuth, ctrl.getDiseasePages);
router.get('/:slug', optionalAuth, ctrl.getDiseasePageBySlug);
router.post('/:slug/follow', authenticate, ctrl.followDiseasePage);
router.delete('/:slug/follow', authenticate, ctrl.unfollowDiseasePage);
router.get('/:slug/posts', authenticate, ctrl.getDiseasePagePosts);
router.get('/:slug/posts/all', authenticate, ctrl.getAllDiseasePagePosts);
router.post('/:slug/posts', authenticate, ctrl.createDiseasePagePost);
router.post('/:slug/posts/:id/like', authenticate, ctrl.likeDiseasePagePost);
router.delete('/:slug/posts/:postId', authenticate, ctrl.removeDiseasePagePost);
router.put('/:slug/posts/:postId/review', authenticate, ctrl.reviewDiseasePagePost);
router.post('/:slug/feature-post', authenticate, ctrl.featurePost);
router.delete('/:slug/feature-post/:postId', authenticate, ctrl.unfeaturePost);
router.post('/:slug/resources', authenticate, ctrl.addResource);
router.delete('/:slug/resources/:resourceId', authenticate, ctrl.removeResource);
router.put('/:slug', authenticate, ctrl.updateDiseasePage);
router.delete('/:slug', authenticate, ctrl.deleteDiseasePage);
router.post('/:slug/events', authenticate, ctrl.createEvent);

module.exports = router;
