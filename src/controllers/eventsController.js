const { v4: uuidv4 } = require('uuid');
const Event = require('../models/Event');
const User = require('../models/User');
const DiseasePage = require('../models/DiseasePage');
const { sanitizeInput } = require('../utils/moderation');

/**
 * Get all events (with optional filters)
 */
async function getEvents(req, res, next) {
  try {
    const { status, type, diseaseSlug, search } = req.query;

    let query = {};

    // Filter by status
    if (status === 'upcoming') {
      // eventDate is stored as a string (typically YYYY-MM-DD). Comparing against a Date
      // causes BSON type mismatch and yields empty results.
      const todayStr = new Date().toISOString().slice(0, 10);
      query.eventDate = { $gte: todayStr };
    } else if (status === 'past') {
      const todayStr = new Date().toISOString().slice(0, 10);
      query.eventDate = { $lt: todayStr };
    }

    // Filter by type
    if (type) {
      query.eventType = type;
    }

    // Filter by disease page slug
    if (diseaseSlug) {
      query.diseasePageSlug = diseaseSlug;
    }

    // Search by title or description
    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      query.$or = [{ title: searchRegex }, { description: searchRegex }];
    }

    const events = await Event.find(query)
      .sort({ eventDate: 1 })
      .lean();

    // Enrich with creator and disease page info
    // For large lists, consider optimizing this. But for now, simple population logic.
    // Schema doesn't have ref for diseasePageSlug directly populated. 
    // And createdBy is ref to User.

    // Let's populate creators
    const eventsWithPopulatedCreator = await Event.populate(events, { path: 'createdBy', select: 'name role' });

    // Fetch disease pages
    const slugs = [...new Set(events.map(e => e.diseasePageSlug).filter(Boolean))];
    const diseasePages = await DiseasePage.find({ slug: { $in: slugs } }).select('slug name').lean();

    const enrichedEvents = eventsWithPopulatedCreator.map((event) => {
      const creator = event.createdBy; // populated
      const diseasePage = diseasePages.find((dp) => dp.slug === event.diseasePageSlug);
      const now = new Date();
      const eventDate = new Date(event.eventDate);

      return {
        ...event,
        id: event._id,
        status: eventDate >= now ? 'upcoming' : 'past',
        creator: creator ? { id: creator._id, name: creator.name, role: creator.role } : null,
        diseasePage: diseasePage
          ? { slug: diseasePage.slug, name: diseasePage.name }
          : null,
        attendeesCount: (event.attendees || []).length,
      };
    });

    res.json({
      events: enrichedEvents,
      total: enrichedEvents.length,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get single event by ID
 */
async function getEventById(req, res, next) {
  try {
    const event = await Event.findById(req.params.id)
      .populate('createdBy', 'name role')
      .populate('attendees', 'name role')
      .lean();

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const diseasePage = event.diseasePageSlug
      ? await DiseasePage.findOne({ slug: event.diseasePageSlug }).select('slug name').lean()
      : null;

    const now = new Date();
    const eventDate = new Date(event.eventDate);

    // Get attendees details (populated above)
    const attendeesDetails = (event.attendees || []).map(u => ({
      id: u._id, name: u.name, role: u.role
    }));

    res.json({
      ...event,
      id: event._id,
      status: eventDate >= now ? 'upcoming' : 'past',
      creator: event.createdBy ? { id: event.createdBy._id, name: event.createdBy.name, role: event.createdBy.role } : null,
      diseasePage: diseasePage
        ? { slug: diseasePage.slug, name: diseasePage.name }
        : null,
      attendeesCount: attendeesDetails.length,
      attendeesDetails,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Create a new event (admin/moderator only)
 */
async function createEvent(req, res, next) {
  try {
    const title = sanitizeInput(req.body.title || '');
    const description = sanitizeInput(req.body.description || '');
    const eventDate = req.body.eventDate;
    const eventTime = req.body.eventTime || '';
    const location = sanitizeInput(req.body.location || '');
    const eventType = sanitizeInput(req.body.eventType || 'virtual');
    const registrationUrl = (req.body.registrationUrl || '').trim();
    const diseasePageSlug = req.body.diseasePageSlug || null;
    const maxAttendees = parseInt(req.body.maxAttendees) || null;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    if (!eventDate) {
      return res.status(400).json({ error: 'Event date is required' });
    }

    // Validate event type
    const validTypes = ['virtual', 'in-person', 'hybrid'];
    if (!validTypes.includes(eventType)) {
      return res.status(400).json({ error: 'Invalid event type. Must be virtual, in-person, or hybrid' });
    }

    // Validate disease page if provided
    if (diseasePageSlug) {
      const diseasePage = await DiseasePage.exists({ slug: diseasePageSlug });
      if (!diseasePage) {
        return res.status(400).json({ error: 'Disease page not found' });
      }
    }

    const now = new Date();

    const newEvent = await Event.create({
      _id: uuidv4(),
      title,
      description,
      eventDate,
      eventTime,
      location,
      eventType,
      registrationUrl,
      diseasePageSlug,
      maxAttendees,
      attendees: [],
      createdBy: req.user.id,
      createdAt: now,
      updatedAt: now,
    });

    const creator = await User.findById(req.user.id).select('name role').lean();

    res.status(201).json({
      ...newEvent.toObject(),
      status: new Date(newEvent.eventDate) >= new Date() ? 'upcoming' : 'past',
      creator: creator ? { id: creator._id, name: creator.name, role: creator.role } : null,
      attendeesCount: 0,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Update an event (admin/moderator only)
 */
async function updateEvent(req, res, next) {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Update fields if provided
    if (req.body.title !== undefined) {
      event.title = sanitizeInput(req.body.title);
    }
    if (req.body.description !== undefined) {
      event.description = sanitizeInput(req.body.description);
    }
    if (req.body.eventDate !== undefined) {
      event.eventDate = req.body.eventDate;
    }
    if (req.body.eventTime !== undefined) {
      event.eventTime = req.body.eventTime;
    }
    if (req.body.location !== undefined) {
      event.location = sanitizeInput(req.body.location);
    }
    if (req.body.eventType !== undefined) {
      const validTypes = ['virtual', 'in-person', 'hybrid'];
      if (!validTypes.includes(req.body.eventType)) {
        return res.status(400).json({ error: 'Invalid event type' });
      }
      event.eventType = req.body.eventType;
    }
    if (req.body.registrationUrl !== undefined) {
      event.registrationUrl = (req.body.registrationUrl || '').trim();
    }
    if (req.body.maxAttendees !== undefined) {
      event.maxAttendees = parseInt(req.body.maxAttendees) || null;
    }

    event.updatedAt = new Date();
    await event.save();

    const creator = await User.findById(event.createdBy).lean();
    const diseasePage = event.diseasePageSlug
      ? await DiseasePage.findOne({ slug: event.diseasePageSlug }).select('slug name').lean()
      : null;

    res.json({
      ...event.toObject(),
      status: new Date(event.eventDate) >= new Date() ? 'upcoming' : 'past',
      creator: creator ? { id: creator._id, name: creator.name, role: creator.role } : null,
      diseasePage: diseasePage
        ? { slug: diseasePage.slug, name: diseasePage.name }
        : null,
      attendeesCount: (event.attendees || []).length,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete an event (admin/moderator only)
 */
async function deleteEvent(req, res, next) {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ message: 'Event deleted successfully', eventId: event._id });
  } catch (error) {
    next(error);
  }
}

/**
 * Register for an event
 */
async function registerForEvent(req, res, next) {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check if event is in the past
    if (new Date(event.eventDate) < new Date()) {
      return res.status(400).json({ error: 'Cannot register for past events' });
    }

    // Initialize attendees array if not exists
    if (!event.attendees) {
      event.attendees = [];
    }

    // Check if already registered (Mongoose array uses strings in IDs but be careful with strict equality if stored as ObjectIds. 
    // Here we use string IDs for User ref, so .includes should work if type matched.
    if (event.attendees.includes(req.user.id)) {
      return res.status(400).json({ error: 'Already registered for this event' });
    }

    // Check max attendees
    if (event.maxAttendees && event.attendees.length >= event.maxAttendees) {
      return res.status(400).json({ error: 'Event is at full capacity' });
    }

    event.attendees.push(req.user.id);
    event.updatedAt = new Date();
    await event.save();

    res.json({
      message: 'Successfully registered for event',
      attendeesCount: event.attendees.length,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Unregister from an event
 */
async function unregisterFromEvent(req, res, next) {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (!event.attendees || !event.attendees.includes(req.user.id)) {
      return res.status(400).json({ error: 'Not registered for this event' });
    }

    event.attendees = event.attendees.filter((id) => id !== req.user.id);
    event.updatedAt = new Date();
    await event.save();

    res.json({
      message: 'Successfully unregistered from event',
      attendeesCount: event.attendees.length,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  registerForEvent,
  unregisterFromEvent,
};

