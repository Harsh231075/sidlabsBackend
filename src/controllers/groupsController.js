const { v4: uuidv4 } = require('uuid');
const Group = require('../models/Group');
const Post = require('../models/Post');
const { sanitizeInput } = require('../utils/moderation');

/**
 * Build group view with membership and admin status for a user
 */
function groupView(group, userId) {
  // Convert mongoose doc to object if needed
  const g = group.toObject ? group.toObject() : group;

  const isMember =
    g.members?.some(id => id === userId || (id._id && id._id.toString() === userId)) ||
    g.adminIds?.some(id => id === userId || (id._id && id._id.toString() === userId)) ||
    g.ownerId === userId || (g.ownerId && g.ownerId._id && g.ownerId._id.toString() === userId);

  const isAdmin =
    g.adminIds?.some(id => id === userId || (id._id && id._id.toString() === userId)) ||
    g.ownerId === userId || (g.ownerId && g.ownerId._id && g.ownerId._id.toString() === userId);

  return {
    ...g,
    id: g.id || g._id,
    isMember,
    isAdmin,
  };
}

/**
 * Get all groups (filtered by privacy)
 */
async function getGroups(req, res, next) {
  try {
    const groups = await Group.find({}).lean();

    // Filter visible groups
    // Logic: Public groups are visible. Private/Hidden are visible only if member.
    // Using groupView checker for consistency
    const visible = groups.filter((g) => {
      if (g.privacy !== 'hidden') return true;
      return groupView(g, req.user.id).isMember;
    });

    res.json(visible.map((g) => groupView(g, req.user.id)));
  } catch (error) {
    next(error);
  }
}

/**
 * Create a new group
 */
async function createGroup(req, res, next) {
  try {
    const name = sanitizeInput(req.body.name || '');
    const description = sanitizeInput(req.body.description || '');
    const privacy = ['public', 'private', 'hidden'].includes(req.body.privacy) ? req.body.privacy : 'public';
    const diseaseTag = sanitizeInput(req.body.diseaseTag || '');

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const now = new Date();
    const newGroup = await Group.create({
      _id: uuidv4(),
      name,
      description,
      privacy,
      ownerId: req.user.id,
      adminIds: [req.user.id],
      members: [req.user.id],
      memberCount: 1,
      diseaseTag,
      createdAt: now,
      updatedAt: now, // Ensure updated at is set
    });

    res.status(201).json(groupView(newGroup, req.user.id));
  } catch (error) {
    next(error);
  }
}

/**
 * Get a specific group by ID
 */
async function getGroup(req, res, next) {
  try {
    const group = await Group.findById(req.params.id).lean();

    if (!group) return res.status(404).json({ error: 'Group not found' });

    const view = groupView(group, req.user.id);

    // Privacy check for content, but still return group info so they can join
    const isPrivate = group.privacy === 'private' || group.privacy === 'hidden';
    const canSeeContent = !isPrivate || view.isMember || req.user.role === 'admin-user';

    const postCount = canSeeContent
      ? await Post.countDocuments({ groupId: group._id, removed: false })
      : 0;

    res.json({
      group: view,
      postCount,
      locked: !canSeeContent
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Join a group
 */
async function joinGroup(req, res, next) {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    // Using string comparison for IDs
    if (!group.members.includes(req.user.id)) {
      group.members.push(req.user.id);
      group.memberCount = group.members.length;
      await group.save();
    }

    res.json(groupView(group, req.user.id));
  } catch (error) {
    next(error);
  }
}

/**
 * Leave a group
 */
async function leaveGroup(req, res, next) {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    if (group.ownerId === req.user.id) {
      return res.status(400).json({ error: 'Owner cannot leave their own group' });
    }

    // Filter out user from members and admins
    // Mongoose array filter
    group.members = group.members.filter((m) => m !== req.user.id);
    group.adminIds = group.adminIds.filter((m) => m !== req.user.id);
    group.memberCount = group.members.length;

    await group.save();

    res.json(groupView(group, req.user.id));
  } catch (error) {
    next(error);
  }
}

/**
 * Update a group's metadata (name, description, privacy, diseaseTag)
 * Only the group owner, group admins, or site admins can update
 */
async function updateGroup(req, res, next) {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const isOwner = group.ownerId === req.user.id;
    const isAdminOfGroup = group.adminIds && group.adminIds.includes(req.user.id);
    const isSiteAdmin = req.user.role === 'admin-user';

    if (!isOwner && !isAdminOfGroup && !isSiteAdmin) {
      return res.status(403).json({ error: 'Not authorized to update group' });
    }

    const name = typeof req.body.name === 'string' ? sanitizeInput(req.body.name.trim()) : undefined;
    const description = typeof req.body.description === 'string' ? sanitizeInput(req.body.description) : undefined;
    const privacy = ['public', 'private', 'hidden'].includes(req.body.privacy) ? req.body.privacy : undefined;
    const diseaseTag = typeof req.body.diseaseTag === 'string' ? sanitizeInput(req.body.diseaseTag) : undefined;

    if (typeof name !== 'undefined' && name.length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (typeof name !== 'undefined') group.name = name;
    if (typeof description !== 'undefined') group.description = description;
    if (typeof privacy !== 'undefined') group.privacy = privacy;
    if (typeof diseaseTag !== 'undefined') group.diseaseTag = diseaseTag;

    group.updatedAt = new Date();
    await group.save();

    res.json(groupView(group, req.user.id));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getGroups,
  createGroup,
  getGroup,
  joinGroup,
  leaveGroup,
  updateGroup,
};


