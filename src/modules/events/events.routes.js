const express = require('express');
const { authenticate, requireRole } = require('../../utils/auth');
const ctrl = require('./events.controller');

const router = express.Router();

router.get('/', authenticate, ctrl.getEvents);
router.get('/:id', authenticate, ctrl.getEventById);
router.post('/', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.createEvent);
router.put('/:id', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.updateEvent);
router.delete('/:id', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.deleteEvent);
router.post('/:id/register', authenticate, ctrl.registerForEvent);
router.delete('/:id/register', authenticate, ctrl.unregisterFromEvent);

module.exports = router;
