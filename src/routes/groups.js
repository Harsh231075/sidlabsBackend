const express = require('express');
const { authenticate, requireRole } = require('../utils/auth');
const groupsController = require('../controllers/groupsController');

const router = express.Router();

// Get all groups
router.get('/', authenticate, groupsController.getGroups);

// Create a new group
router.post('/', authenticate, requireRole(['admin-user', 'moderator-user']), groupsController.createGroup);

// Get a specific group by ID
router.get('/:id', authenticate, groupsController.getGroup);

// Update a group's metadata
router.put('/:id', authenticate, groupsController.updateGroup);

// Join a group
router.post('/:id/join', authenticate, groupsController.joinGroup);

// Leave a group
router.post('/:id/leave', authenticate, groupsController.leaveGroup);

module.exports = router;
