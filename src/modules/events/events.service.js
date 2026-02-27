const { v4: uuidv4 } = require('uuid');
const Event = require('../../models/Event');
const User = require('../../models/User');
const DiseasePage = require('../../models/DiseasePage');
const { sanitizeInput } = require('../../utils/moderation');
const { httpError } = require('../../utils/httpError');

function enrichEvent(event, creator, diseasePage) {
  const now = new Date();
  const eventDate = new Date(event.eventDate);
  return {
    ...event,
    id: event._id,
    status: eventDate >= now ? 'upcoming' : 'past',
    creator: creator ? { id: creator._id, name: creator.name, role: creator.role } : null,
    diseasePage: diseasePage ? { slug: diseasePage.slug, name: diseasePage.name } : null,
    attendeesCount: (event.attendees || []).length,
  };
}

async function getEvents(query) {
  const { status, type, diseaseSlug, search } = query;
  let filter = {};

  if (status === 'upcoming') {
    filter.eventDate = { $gte: new Date().toISOString().slice(0, 10) };
  } else if (status === 'past') {
    filter.eventDate = { $lt: new Date().toISOString().slice(0, 10) };
  }
  if (type) filter.eventType = type;
  if (diseaseSlug) filter.diseasePageSlug = diseaseSlug;
  if (search) {
    const searchRegex = { $regex: search, $options: 'i' };
    filter.$or = [{ title: searchRegex }, { description: searchRegex }];
  }

  const events = await Event.find(filter).sort({ eventDate: 1 }).lean();
  const eventsWithCreator = await Event.populate(events, { path: 'createdBy', select: 'name role' });

  const slugs = [...new Set(events.map(e => e.diseasePageSlug).filter(Boolean))];
  const diseasePages = await DiseasePage.find({ slug: { $in: slugs } }).select('slug name').lean();

  const enriched = eventsWithCreator.map(event => {
    const dp = diseasePages.find(d => d.slug === event.diseasePageSlug);
    return enrichEvent(event, event.createdBy, dp);
  });

  return { events: enriched, total: enriched.length };
}

async function getEventById(eventId) {
  const event = await Event.findById(eventId)
    .populate('createdBy', 'name role')
    .populate('attendees', 'name role')
    .lean();
  if (!event) throw httpError(404, { error: 'Event not found' });

  const diseasePage = event.diseasePageSlug
    ? await DiseasePage.findOne({ slug: event.diseasePageSlug }).select('slug name').lean()
    : null;

  const attendeesDetails = (event.attendees || []).map(u => ({ id: u._id, name: u.name, role: u.role }));
  const base = enrichEvent(event, event.createdBy, diseasePage);
  return { ...base, attendeesDetails };
}

async function createEvent(body, userId) {
  const title = sanitizeInput(body.title || '');
  const description = sanitizeInput(body.description || '');
  const eventDate = body.eventDate;
  const eventTime = body.eventTime || '';
  const location = sanitizeInput(body.location || '');
  const eventType = sanitizeInput(body.eventType || 'virtual');
  const registrationUrl = (body.registrationUrl || '').trim();
  const diseasePageSlug = body.diseasePageSlug || null;
  const maxAttendees = parseInt(body.maxAttendees) || null;

  if (!title) throw httpError(400, { error: 'Title is required' });
  if (!eventDate) throw httpError(400, { error: 'Event date is required' });
  if (!['virtual', 'in-person', 'hybrid'].includes(eventType)) {
    throw httpError(400, { error: 'Invalid event type. Must be virtual, in-person, or hybrid' });
  }
  if (diseasePageSlug) {
    const exists = await DiseasePage.exists({ slug: diseasePageSlug });
    if (!exists) throw httpError(400, { error: 'Disease page not found' });
  }

  const now = new Date();
  const newEvent = await Event.create({
    _id: uuidv4(), title, description, eventDate, eventTime, location, eventType,
    registrationUrl, diseasePageSlug, maxAttendees, attendees: [], createdBy: userId, createdAt: now, updatedAt: now,
  });

  const creator = await User.findById(userId).select('name role').lean();
  return enrichEvent(newEvent.toObject(), creator, null);
}

async function updateEvent(eventId, body) {
  const event = await Event.findById(eventId);
  if (!event) throw httpError(404, { error: 'Event not found' });

  if (body.title !== undefined) event.title = sanitizeInput(body.title);
  if (body.description !== undefined) event.description = sanitizeInput(body.description);
  if (body.eventDate !== undefined) event.eventDate = body.eventDate;
  if (body.eventTime !== undefined) event.eventTime = body.eventTime;
  if (body.location !== undefined) event.location = sanitizeInput(body.location);
  if (body.eventType !== undefined) {
    if (!['virtual', 'in-person', 'hybrid'].includes(body.eventType)) throw httpError(400, { error: 'Invalid event type' });
    event.eventType = body.eventType;
  }
  if (body.registrationUrl !== undefined) event.registrationUrl = (body.registrationUrl || '').trim();
  if (body.maxAttendees !== undefined) event.maxAttendees = parseInt(body.maxAttendees) || null;

  event.updatedAt = new Date();
  await event.save();

  const creator = await User.findById(event.createdBy).lean();
  const dp = event.diseasePageSlug
    ? await DiseasePage.findOne({ slug: event.diseasePageSlug }).select('slug name').lean()
    : null;
  return enrichEvent(event.toObject(), creator, dp);
}

async function deleteEvent(eventId) {
  const event = await Event.findByIdAndDelete(eventId);
  if (!event) throw httpError(404, { error: 'Event not found' });
  return { message: 'Event deleted successfully', eventId: event._id };
}

async function registerForEvent(eventId, userId) {
  const event = await Event.findById(eventId);
  if (!event) throw httpError(404, { error: 'Event not found' });
  if (new Date(event.eventDate) < new Date()) throw httpError(400, { error: 'Cannot register for past events' });
  if (!event.attendees) event.attendees = [];
  if (event.attendees.includes(userId)) throw httpError(400, { error: 'Already registered for this event' });
  if (event.maxAttendees && event.attendees.length >= event.maxAttendees) throw httpError(400, { error: 'Event is at full capacity' });

  event.attendees.push(userId);
  event.updatedAt = new Date();
  await event.save();
  return { message: 'Successfully registered for event', attendeesCount: event.attendees.length };
}

async function unregisterFromEvent(eventId, userId) {
  const event = await Event.findById(eventId);
  if (!event) throw httpError(404, { error: 'Event not found' });
  if (!event.attendees || !event.attendees.includes(userId)) throw httpError(400, { error: 'Not registered for this event' });

  event.attendees = event.attendees.filter(id => id !== userId);
  event.updatedAt = new Date();
  await event.save();
  return { message: 'Successfully unregistered from event', attendeesCount: event.attendees.length };
}

module.exports = { getEvents, getEventById, createEvent, updateEvent, deleteEvent, registerForEvent, unregisterFromEvent };
