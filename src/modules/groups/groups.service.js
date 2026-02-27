const { v4: uuidv4 } = require('uuid');
const Group = require('../../models/Group');
const Post = require('../../models/Post');
const User = require('../../models/User');
const GroupMessage = require('../../models/GroupMessage');
const { sanitizeInput } = require('../../utils/moderation');
const { toPublicUrl } = require('../../utils/publicUrl');
const { emitGroupMessage, getIoInstance } = require('../../socket');
const { httpError } = require('../../utils/httpError');

function groupView(group, userId) {
  const g = group.toObject ? group.toObject() : group;
  const isMember =
    g.members?.some(id => id === userId || (id._id && id._id.toString() === userId)) ||
    g.adminIds?.some(id => id === userId || (id._id && id._id.toString() === userId)) ||
    g.ownerId === userId || (g.ownerId && g.ownerId._id && g.ownerId._id.toString() === userId);
  const isAdmin =
    g.adminIds?.some(id => id === userId || (id._id && id._id.toString() === userId)) ||
    g.ownerId === userId || (g.ownerId && g.ownerId._id && g.ownerId._id.toString() === userId);
  g.photoUrl = toPublicUrl(g.photoUrl);
  g.coverPhotoUrl = toPublicUrl(g.coverPhotoUrl);
  return { ...g, id: g.id || g._id, isMember, isAdmin };
}

function parseBase64Image(base64String) {
  if (!base64String || typeof base64String !== 'string') return {};
  const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) return {};
  const contentType = matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const ext = (contentType.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return { buffer, contentType, ext };
}

async function getGroups(userId) {
  const groups = await Group.find({ parentGroupId: null }).sort({ createdAt: -1 }).limit(500).lean();
  const visible = groups.filter(g => {
    if (g.privacy !== 'hidden') return true;
    return groupView(g, userId).isMember;
  });
  return visible.map(g => groupView(g, userId));
}

async function createGroup(body, userId, userRole) {
  const name = sanitizeInput(body.name || '');
  const description = sanitizeInput(body.description || '');
  const privacy = ['public', 'private', 'hidden'].includes(body.privacy) ? body.privacy : 'public';
  const diseaseTag = sanitizeInput(body.diseaseTag || '');
  const parentGroupId = body.parentGroupId;

  if (!name) throw httpError(400, { error: 'Name is required' });

  if (parentGroupId) {
    const parentGroup = await Group.findById(parentGroupId);
    if (!parentGroup) throw httpError(404, { error: 'Parent group not found' });
    const isOwner = parentGroup.ownerId === userId;
    const isAdmin = parentGroup.adminIds && parentGroup.adminIds.includes(userId);
    const isSiteAdmin = userRole === 'admin-user';
    const isSiteMod = userRole === 'moderator-user';
    if (!isOwner && !isAdmin && !isSiteAdmin && !isSiteMod) throw httpError(403, { error: 'Only group admins can create sub-groups' });
  }

  const now = new Date();
  const newGroupObj = {
    _id: uuidv4(), name, description, privacy, ownerId: userId, adminIds: [userId],
    members: [userId], memberCount: 1, diseaseTag, createdAt: now, updatedAt: now,
    parentGroupId: parentGroupId || null, isSubGroup: !!parentGroupId, chatEnabled: true,
    photoUrl: null, coverPhotoUrl: null,
  };

  const storageService = require('../../services/storageService');
  if (body.photo) {
    const { buffer, contentType, ext } = parseBase64Image(body.photo);
    if (buffer) {
      const filename = `group-photo-${newGroupObj._id}-${Date.now()}.${ext}`;
      const uploaded = await storageService.upload({ buffer, contentType, key: `groups/${filename}` });
      newGroupObj.photoUrl = uploaded.url;
    }
  }
  if (body.coverPhoto) {
    const { buffer, contentType, ext } = parseBase64Image(body.coverPhoto);
    if (buffer) {
      const filename = `group-cover-${newGroupObj._id}-${Date.now()}.${ext}`;
      const uploaded = await storageService.upload({ buffer, contentType, key: `groups/${filename}` });
      newGroupObj.coverPhotoUrl = uploaded.url;
    }
  }

  const newGroup = await Group.create(newGroupObj);
  return groupView(newGroup, userId);
}

async function getGroup(groupId, userId, userRole) {
  const group = await Group.findById(groupId).lean();
  if (!group) throw httpError(404, { error: 'Group not found' });

  const view = groupView(group, userId);
  const isPrivate = group.privacy === 'private' || group.privacy === 'hidden';
  const canSeeContent = !isPrivate || view.isMember || userRole === 'admin-user';
  const postCount = canSeeContent ? await Post.countDocuments({ groupId: group._id, removed: false }) : 0;

  return { group: view, postCount, locked: !canSeeContent };
}

async function joinGroup(groupId, userId) {
  const group = await Group.findById(groupId);
  if (!group) throw httpError(404, { error: 'Group not found' });
  if (!group.members.includes(userId)) {
    group.members.push(userId);
    group.memberCount = group.members.length;
    await group.save();
  }
  return groupView(group, userId);
}

async function leaveGroup(groupId, userId) {
  const group = await Group.findById(groupId);
  if (!group) throw httpError(404, { error: 'Group not found' });
  if (group.ownerId === userId) throw httpError(400, { error: 'Owner cannot leave their own group' });
  group.members = group.members.filter(m => m !== userId);
  group.adminIds = group.adminIds.filter(m => m !== userId);
  group.memberCount = group.members.length;
  await group.save();
  return groupView(group, userId);
}

async function updateGroup(groupId, body, userId, userRole) {
  const group = await Group.findById(groupId);
  if (!group) throw httpError(404, { error: 'Group not found' });

  const isOwner = group.ownerId === userId;
  const isAdminOfGroup = group.adminIds && group.adminIds.includes(userId);
  const isSiteAdmin = userRole === 'admin-user';
  const isSiteMod = userRole === 'moderator-user';
  if (!isOwner && !isAdminOfGroup && !isSiteAdmin && !isSiteMod) throw httpError(403, { error: 'Not authorized to update group' });

  const name = typeof body.name === 'string' ? sanitizeInput(body.name.trim()) : undefined;
  const description = typeof body.description === 'string' ? sanitizeInput(body.description) : undefined;
  const privacy = ['public', 'private', 'hidden'].includes(body.privacy) ? body.privacy : undefined;
  const diseaseTag = typeof body.diseaseTag === 'string' ? sanitizeInput(body.diseaseTag) : undefined;

  if (typeof name !== 'undefined' && name.length === 0) throw httpError(400, { error: 'Name is required' });

  if (typeof name !== 'undefined') group.name = name;
  if (typeof description !== 'undefined') group.description = description;
  if (typeof privacy !== 'undefined') group.privacy = privacy;
  if (typeof diseaseTag !== 'undefined') group.diseaseTag = diseaseTag;

  const storageService = require('../../services/storageService');
  if (body.photo) {
    const { buffer, contentType, ext } = parseBase64Image(body.photo);
    if (buffer) {
      const filename = `group-photo-${group._id}-${Date.now()}.${ext}`;
      const uploaded = await storageService.upload({ buffer, contentType, key: `groups/${filename}` });
      if (group.photoUrl) await storageService.deleteFile(group.photoUrl);
      group.photoUrl = uploaded.url;
    }
  }
  if (body.coverPhoto) {
    const { buffer, contentType, ext } = parseBase64Image(body.coverPhoto);
    if (buffer) {
      const filename = `group-cover-${group._id}-${Date.now()}.${ext}`;
      const uploaded = await storageService.upload({ buffer, contentType, key: `groups/${filename}` });
      if (group.coverPhotoUrl) await storageService.deleteFile(group.coverPhotoUrl);
      group.coverPhotoUrl = uploaded.url;
    }
  }

  group.updatedAt = new Date();
  await group.save();
  return groupView(group, userId);
}

async function getSubGroups(parentId, userId) {
  const subGroups = await Group.find({ parentGroupId: parentId }).lean();
  const visible = subGroups.filter(g => {
    if (g.privacy !== 'hidden') return true;
    return groupView(g, userId).isMember;
  });
  return visible.map(g => groupView(g, userId));
}

async function getGroupMembers(groupId, userId, query) {
  const limit = parseInt(query.limit) || 20;
  const page = parseInt(query.page) || 1;
  const skip = (page - 1) * limit;
  const search = query.query;

  const group = await Group.findById(groupId);
  if (!group) throw httpError(404, { error: 'Group not found' });

  const view = groupView(group, userId);
  if (!view.isMember && group.privacy === 'hidden') throw httpError(403, { error: 'Not authorized' });

  let match = {};
  if (search) match = { $or: [{ name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }] };

  const members = await User.find({ _id: { $in: group.members }, ...match }).select('name avatar bio _id role').skip(skip).limit(limit);
  const total = await User.countDocuments({ _id: { $in: group.members }, ...match });

  return { members, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function sendGroupMessage(groupId, userId, content) {
  if (!content || !content.trim()) throw httpError(400, { error: 'Message content is required' });

  const group = await Group.findById(groupId);
  if (!group) throw httpError(404, { error: 'Group not found' });

  const isMember = group.members.includes(userId) || group.ownerId === userId || (group.adminIds && group.adminIds.includes(userId));
  if (!isMember) throw httpError(403, { error: 'You must be a member to send messages' });

  const message = await GroupMessage.create({ _id: uuidv4(), groupId, senderId: userId, content: sanitizeInput(content), createdAt: new Date() });
  const populated = await GroupMessage.findById(message._id).populate('senderId', 'name avatarUrl _id').lean();
  const formatted = { ...populated, id: populated._id, senderId: { ...populated.senderId, id: populated.senderId._id } };

  const io = getIoInstance();
  emitGroupMessage(io, formatted, groupId);

  return formatted;
}

async function getGroupMessages(groupId, userId, query) {
  const { before, limit = 50 } = query;

  const group = await Group.findById(groupId);
  if (!group) throw httpError(404, { error: 'Group not found' });

  const isMember = group.members.includes(userId) || group.ownerId === userId || (group.adminIds && group.adminIds.includes(userId));
  if (!isMember && group.privacy !== 'public') throw httpError(403, { error: 'You must be a member to view messages' });

  const filter = { groupId };
  if (before) filter.createdAt = { $lt: new Date(before) };

  const messages = await GroupMessage.find(filter).sort({ createdAt: -1 }).limit(parseInt(limit))
    .populate('senderId', 'name avatarUrl _id').lean();

  return messages.map(m => ({ ...m, id: m._id, senderId: { ...m.senderId, id: m.senderId._id } })).reverse();
}

module.exports = {
  getGroups, createGroup, getGroup, joinGroup, leaveGroup, updateGroup, getSubGroups, getGroupMembers,
  sendGroupMessage, getGroupMessages,
};
