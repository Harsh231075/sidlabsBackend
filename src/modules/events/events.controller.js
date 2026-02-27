const svc = require('./events.service');
function sendErr(res, err, next) {
  if (err.responseBody) return res.status(err.status).json(err.responseBody);
  if (err.status) return res.sendStatus(err.status);
  return next(err);
}

async function getEvents(req, res, next) {
  try {
    return res.json(await svc.getEvents(req.query));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getEventById(req, res, next) {
  try {
    return res.json(await svc.getEventById(req.params.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function createEvent(req, res, next) {
  try {
    return res.status(201).json(await svc.createEvent(req.body, req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function updateEvent(req, res, next) {
  try {
    return res.json(await svc.updateEvent(req.params.id, req.body));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function deleteEvent(req, res, next) {
  try {
    return res.json(await svc.deleteEvent(req.params.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function registerForEvent(req, res, next) {
  try {
    return res.json(await svc.registerForEvent(req.params.id, req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function unregisterFromEvent(req, res, next) {
  try {
    return res.json(await svc.unregisterFromEvent(req.params.id, req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
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
