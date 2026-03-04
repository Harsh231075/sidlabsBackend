const express = require('express');
const { authenticate, requireRole } = require('../../utils/auth');
const ctrl = require('./groups.controller');

const router = express.Router();

router.get('/', authenticate, ctrl.getGroups);
router.post('/', authenticate, requireRole(['admin-user', 'moderator-user']), ctrl.createGroup);
router.get('/:id', authenticate, ctrl.getGroup);
router.put('/:id', authenticate, ctrl.updateGroup);
router.post('/:id/join', authenticate, ctrl.joinGroup);
router.post('/:id/leave', authenticate, ctrl.leaveGroup);
router.get('/:id/subgroups', authenticate, ctrl.getSubGroups);
router.get('/:id/members', authenticate, ctrl.getGroupMembers);
router.get('/:id/messages', authenticate, ctrl.getGroupMessages);
router.post('/:id/messages', authenticate, ctrl.sendGroupMessage);

module.exports = router;
