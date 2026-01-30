const express = require('express');
const { authenticate, requireRole } = require('../utils/auth');
const {
  getEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  registerForEvent,
  unregisterFromEvent,
} = require('../controllers/eventsController');

const router = express.Router();

// Get all events (with optional filters)
router.get('/', authenticate, getEvents);

// Get single event
router.get('/:id', authenticate, getEventById);

// Create a new event (admin/moderator only)
router.post('/', authenticate, requireRole(['admin-user', 'moderator-user']), createEvent);

// Update an event (admin/moderator only)
router.put('/:id', authenticate, requireRole(['admin-user', 'moderator-user']), updateEvent);

// Delete an event (admin/moderator only)
router.delete('/:id', authenticate, requireRole(['admin-user', 'moderator-user']), deleteEvent);

// Register for an event
router.post('/:id/register', authenticate, registerForEvent);

// Unregister from an event
router.delete('/:id/register', authenticate, unregisterFromEvent);

module.exports = router;
