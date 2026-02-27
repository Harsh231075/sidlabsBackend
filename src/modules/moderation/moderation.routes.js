const express = require('express');
const { authenticate, requireRole } = require('../../utils/auth');
const ctrl = require('./moderation.controller');

const router = express.Router();

router.get('/quarantine', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.getQuarantinedContent);
router.post('/:type/:id/approve', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.approveContent);
router.post('/:type/:id/reject', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.rejectContent);
router.post('/:type/:id/request-edit', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.requestEdit);

module.exports = router;
