const svc = require('./conversations.service');
function sendErr(res, err, next) {
  if (err.responseBody) return res.status(err.status).json(err.responseBody);
  if (err.status) return res.sendStatus(err.status);
  return next(err);
}

async function getConversations(req, res, next) {
  try {
    return res.json(await svc.getConversations(req.user.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function startConversation(req, res, next) {
  try {
    const email = (req.body.targetEmail || '').trim().toLowerCase();
    const result = await svc.startConversation(req.user.id, email);
    res.status(201).json(result);
  } catch (e) { sendErr(res, e, next); }
}
async function startConversationByUserId(req, res, next) {
  try {
    return res.status(201).json(await svc.startConversationByUserId(req.user.id, req.params.targetUserId));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function createGroup(req, res, next) {
  try {
    const { participantIds, name } = req.body;
    if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({ error: 'participantIds array is required' });
    }
    res.status(201).json(await svc.createGroup(req.user.id, participantIds, name));
  } catch (e) { sendErr(res, e, next); }
}
async function getConversation(req, res, next) {
  try {
    return res.json(await svc.getConversation(req.user.id, req.params.convId, req.query));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function sendMessage(req, res, next) {
  try {
    const result = await svc.sendMessage(req.user.id, req.params.convId, (req.body.text || '').toString(), req.body.image || null);
    const code = result._statusCode || 200; delete result._statusCode;
    res.status(code).json(result);
  } catch (e) { sendErr(res, e, next); }
}
async function editMessage(req, res, next) {
  try {
    return res.json(await svc.editMessage(req.user.id, req.params.convId, req.params.messageId, (req.body.text || '').toString()));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

module.exports = {
  getConversations,
  startConversation,
  startConversationByUserId,
  createGroup,
  getConversation,
  sendMessage,
  editMessage,
};
