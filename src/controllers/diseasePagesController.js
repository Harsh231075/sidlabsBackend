const { v4: uuidv4 } = require('uuid');
const DiseasePage = require('../models/DiseasePage');
const DiseaseFollower = require('../models/DiseaseFollower');
const User = require('../models/User');
const Group = require('../models/Group');
const Post = require('../models/Post');
const Event = require('../models/Event');
const { sanitizeInput } = require('../utils/moderation');

// Helper: Check if user is an editor or admin
function isEditorOrAdmin(diseasePage, userId, userRole) {
  return (
    diseasePage.editors?.includes(userId) ||
    userRole === 'admin-user' ||
    userRole === 'moderator-user'
  );
}

// Helper: Build disease page response with enriched data
async function buildDiseasePageResponse(diseasePage, currentUserId, userRole) {
  const isFollowing = currentUserId
    ? await DiseaseFollower.exists({ diseasePageSlug: diseasePage.slug, userId: currentUserId })
    : false;

  const followersCount = await DiseaseFollower.countDocuments({ diseasePageSlug: diseasePage.slug });

  // Get linked groups
  const linkedGroups = await Group.find({ _id: { $in: diseasePage.linkedGroupIds || [] } })
    .select('id name description privacy memberCount')
    .lean();

  // Get featured posts
  // Note: diseasePage.featuredPostIds stores IDs.
  const featuredPostsLogs = await Post.find({
    _id: { $in: diseasePage.featuredPostIds || [] },
    removed: false
  })
    .populate('authorId', 'name role')
    .lean();

  // Map to required format
  const featuredPosts = featuredPostsLogs.map(p => ({
    id: p._id,
    content: p.content,
    author: p.authorId ? { id: p.authorId._id, name: p.authorId.name, role: p.authorId.role } : null,
    createdAt: p.createdAt,
    likeCount: (p.likes || []).length,
  }));

  // Get disease-specific events (upcoming events sorted by date)
  const diseaseEventsLogs = await Event.find({
    diseasePageSlug: diseasePage.slug,
    eventDate: { $gte: new Date() }
  })
    .sort({ eventDate: 1 })
    .populate('createdBy', 'name role')
    .lean();

  const diseaseEvents = diseaseEventsLogs.map(e => ({
    id: e._id,
    title: e.title,
    description: e.description,
    eventDate: e.eventDate,
    location: e.location,
    eventType: e.eventType,
    registrationUrl: e.registrationUrl,
    creator: e.createdBy ? { id: e.createdBy._id, name: e.createdBy.name, role: e.createdBy.role } : null,
  }));

  return {
    ...diseasePage,
    isFollowing: !!isFollowing,
    followersCount,
    linkedGroups: linkedGroups || [],
    featuredPosts: featuredPosts || [],
    events: diseaseEvents || [],
    isEditor: isEditorOrAdmin(diseasePage, currentUserId, userRole),
  };
}

// Create a new disease page (admin only)
async function createDiseasePage(req, res, next) {
  try {
    const name = sanitizeInput(req.body.name || '');
    const slug = sanitizeInput(req.body.slug || '')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const description = sanitizeInput(req.body.description || '');
    const codes = req.body.codes || {};
    const heroImageUrl = (req.body.heroImageUrl || '').trim();
    const iconUrl = (req.body.iconUrl || '').trim();
    const editors = Array.isArray(req.body.editors) ? req.body.editors : [];
    const linkedGroupIds = Array.isArray(req.body.linkedGroupIds) ? req.body.linkedGroupIds : [];
    const resourceLinks = Array.isArray(req.body.resourceLinks) ? req.body.resourceLinks : [];

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!slug) {
      return res.status(400).json({ error: 'Slug is required' });
    }

    const existing = await DiseasePage.findOne({ slug });
    if (existing) {
      return res.status(400).json({ error: 'A disease page with this slug already exists' });
    }

    // Validate linked groups exist
    if (linkedGroupIds.length > 0) {
      const existingGroups = await Group.find({ _id: { $in: linkedGroupIds } }).select('_id');
      const foundIds = existingGroups.map(g => g._id.toString());
      const invalidGroups = linkedGroupIds.filter(gId => !foundIds.includes(gId));
      if (invalidGroups.length > 0) {
        return res.status(400).json({ error: `Invalid group IDs: ${invalidGroups.join(', ')}` });
      }
    }

    const now = new Date();
    const newDiseasePage = await DiseasePage.create({
      _id: uuidv4(),
      name,
      slug,
      description,
      codes: {
        orphaCode: codes.orphaCode || null,
        omim: codes.omim || null,
        icd10: codes.icd10 || null,
        snomed: codes.snomed || null,
      },
      heroImageUrl,
      iconUrl,
      editors: [...editors, req.user.id], // Creator is automatically an editor
      linkedGroupIds,
      featuredPostIds: [],
      resourceLinks,
      createdAt: now,
      updatedAt: now,
    });

    const response = await buildDiseasePageResponse(newDiseasePage.toObject(), req.user.id, req.user.role);
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}

// Get all disease pages (search/browse)
async function getDiseasePages(req, res, next) {
  try {
    const search = (req.query.search || '').toLowerCase().trim();
    let query = {};
    if (search) {
      query = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { slug: { $regex: search, $options: 'i' } }
        ]
      };
    }

    const diseasePages = await DiseasePage.find(query).lean();

    // Build responses for all pages
    const responses = await Promise.all(
      diseasePages.map((dp) => buildDiseasePageResponse(dp, req.user?.id, req.user?.role))
    );

    res.json(responses);
  } catch (error) {
    next(error);
  }
}

// Get a single disease page by slug
async function getDiseasePageBySlug(req, res, next) {
  try {
    const diseasePage = await DiseasePage.findOne({ slug: req.params.slug }).lean();

    if (!diseasePage) {
      return res.status(404).json({ error: 'Disease page not found' });
    }

    const response = await buildDiseasePageResponse(
      diseasePage,
      req.user?.id || null,
      req.user?.role || null
    );
    res.json(response);
  } catch (error) {
    next(error);
  }
}

// Follow a disease page
async function followDiseasePage(req, res, next) {
  try {
    const diseasePage = await DiseasePage.findOne({ slug: req.params.slug }).lean();

    if (!diseasePage) {
      return res.status(404).json({ error: 'Disease page not found' });
    }

    const existingFollow = await DiseaseFollower.findOne({
      diseasePageSlug: req.params.slug,
      userId: req.user.id
    });

    if (existingFollow) {
      return res.status(400).json({ error: 'Already following this disease page' });
    }

    await DiseaseFollower.create({
      _id: uuidv4(),
      diseasePageSlug: req.params.slug,
      userId: req.user.id,
      followedAt: new Date(),
    });

    const response = await buildDiseasePageResponse(diseasePage, req.user.id, req.user.role);
    res.json(response);
  } catch (error) {
    next(error);
  }
}

// Unfollow a disease page
async function unfollowDiseasePage(req, res, next) {
  try {
    const diseasePage = await DiseasePage.findOne({ slug: req.params.slug }).lean();

    if (!diseasePage) {
      return res.status(404).json({ error: 'Disease page not found' });
    }

    const deleted = await DiseaseFollower.findOneAndDelete({
      diseasePageSlug: req.params.slug,
      userId: req.user.id
    });

    if (!deleted) {
      return res.status(400).json({ error: 'Not following this disease page' });
    }

    const response = await buildDiseasePageResponse(diseasePage, req.user.id, req.user.role);
    res.json(response);
  } catch (error) {
    next(error);
  }
}

// Feature/promote a post to the disease page (editors/admin only)
async function featurePost(req, res, next) {
  try {
    const postId = req.body.postId;
    if (!postId) {
      return res.status(400).json({ error: 'Post ID is required' });
    }

    const diseasePage = await DiseasePage.findOne({ slug: req.params.slug });
    if (!diseasePage) {
      return res.status(404).json({ error: 'Disease page not found' });
    }

    if (!isEditorOrAdmin(diseasePage, req.user.id, req.user.role)) {
      return res.status(403).json({ error: 'Only editors can feature posts' });
    }

    const post = await Post.findOne({ _id: postId, removed: false });
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    diseasePage.featuredPostIds = diseasePage.featuredPostIds || [];
    if (diseasePage.featuredPostIds.includes(postId)) {
      return res.status(400).json({ error: 'Post is already featured' });
    }

    diseasePage.featuredPostIds.push(postId);
    diseasePage.updatedAt = new Date();

    await diseasePage.save();

    const response = await buildDiseasePageResponse(diseasePage.toObject(), req.user.id, req.user.role);
    res.json(response);
  } catch (error) {
    next(error);
  }
}

// Unfeature a post (editors/admin only)
async function unfeaturePost(req, res, next) {
  try {
    const postId = req.params.postId;

    const diseasePage = await DiseasePage.findOne({ slug: req.params.slug });
    if (!diseasePage) {
      return res.status(404).json({ error: 'Disease page not found' });
    }

    if (!isEditorOrAdmin(diseasePage, req.user.id, req.user.role)) {
      return res.status(403).json({ error: 'Only editors can unfeature posts' });
    }

    diseasePage.featuredPostIds = (diseasePage.featuredPostIds || []).filter(
      (id) => id !== postId
    );
    diseasePage.updatedAt = new Date();

    await diseasePage.save();

    const response = await buildDiseasePageResponse(diseasePage.toObject(), req.user.id, req.user.role);
    res.json(response);
  } catch (error) {
    next(error);
  }
}

// Add a resource link (editors/admin only)
async function addResource(req, res, next) {
  try {
    const title = sanitizeInput(req.body.title || '');
    const url = (req.body.url || '').trim();
    const category = sanitizeInput(req.body.category || 'general');

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const diseasePage = await DiseasePage.findOne({ slug: req.params.slug });
    if (!diseasePage) {
      return res.status(404).json({ error: 'Disease page not found' });
    }

    if (!isEditorOrAdmin(diseasePage, req.user.id, req.user.role)) {
      return res.status(403).json({ error: 'Only editors can add resources' });
    }

    diseasePage.resourceLinks = diseasePage.resourceLinks || [];
    diseasePage.resourceLinks.push({
      id: uuidv4(),
      title,
      url,
      category,
      addedBy: req.user.id,
      addedAt: new Date(),
    });
    diseasePage.updatedAt = new Date();

    await diseasePage.save();

    const response = await buildDiseasePageResponse(diseasePage.toObject(), req.user.id, req.user.role);
    res.json(response);
  } catch (error) {
    next(error);
  }
}

// Remove a resource link (editors/admin only)
async function removeResource(req, res, next) {
  try {
    const resourceId = req.params.resourceId;

    const diseasePage = await DiseasePage.findOne({ slug: req.params.slug });
    if (!diseasePage) {
      return res.status(404).json({ error: 'Disease page not found' });
    }

    if (!isEditorOrAdmin(diseasePage, req.user.id, req.user.role)) {
      return res.status(403).json({ error: 'Only editors can remove resources' });
    }

    // resourceLinks is an array of objects
    // Using string filter
    diseasePage.resourceLinks = (diseasePage.resourceLinks || []).filter(
      (r) => r.id !== resourceId
    );
    diseasePage.updatedAt = new Date();

    await diseasePage.save();

    const response = await buildDiseasePageResponse(diseasePage.toObject(), req.user.id, req.user.role);
    res.json(response);
  } catch (error) {
    next(error);
  }
}

// Update disease page (editors/admin only)
async function updateDiseasePage(req, res, next) {
  try {
    const diseasePage = await DiseasePage.findOne({ slug: req.params.slug });
    if (!diseasePage) {
      return res.status(404).json({ error: 'Disease page not found' });
    }

    if (!isEditorOrAdmin(diseasePage, req.user.id, req.user.role)) {
      return res.status(403).json({ error: 'Only editors can update disease pages' });
    }

    // Update allowed fields
    if (req.body.name !== undefined) {
      diseasePage.name = sanitizeInput(req.body.name);
    }
    if (req.body.description !== undefined) {
      diseasePage.description = sanitizeInput(req.body.description);
    }
    if (req.body.heroImageUrl !== undefined) {
      diseasePage.heroImageUrl = (req.body.heroImageUrl || '').trim();
    }
    if (req.body.iconUrl !== undefined) {
      diseasePage.iconUrl = (req.body.iconUrl || '').trim();
    }
    if (req.body.codes !== undefined) {
      diseasePage.codes = {
        orphaCode: req.body.codes.orphaCode || null,
        omim: req.body.codes.omim || null,
        icd10: req.body.codes.icd10 || null,
        snomed: req.body.codes.snomed || null,
      };
    }
    if (req.body.linkedGroupIds !== undefined && Array.isArray(req.body.linkedGroupIds)) {
      // Validate groups exist
      const existingGroups = await Group.find({ _id: { $in: req.body.linkedGroupIds } }).select('_id');
      const foundIds = existingGroups.map(g => g._id.toString());
      const invalidGroups = req.body.linkedGroupIds.filter(gId => !foundIds.includes(gId));
      if (invalidGroups.length > 0) {
        return res.status(400).json({ error: `Invalid group IDs: ${invalidGroups.join(', ')}` });
      }
      diseasePage.linkedGroupIds = req.body.linkedGroupIds;
    }
    if (req.body.editors !== undefined && Array.isArray(req.body.editors)) {
      // Only admins can change editors list
      if (req.user.role !== 'admin-user') {
        return res.status(403).json({ error: 'Only admins can modify editors list' });
      }
      diseasePage.editors = req.body.editors;
    }

    diseasePage.updatedAt = new Date();
    await diseasePage.save();

    const response = await buildDiseasePageResponse(diseasePage.toObject(), req.user.id, req.user.role);
    res.json(response);
  } catch (error) {
    next(error);
  }
}

// Create an event tied to a disease page (editors/admin only)
async function createEvent(req, res, next) {
  try {
    const title = sanitizeInput(req.body.title || '');
    const description = sanitizeInput(req.body.description || '');
    const eventDate = req.body.eventDate; // ISO string
    const location = sanitizeInput(req.body.location || '');
    const eventType = sanitizeInput(req.body.eventType || 'virtual'); // virtual, in-person, hybrid
    const registrationUrl = (req.body.registrationUrl || '').trim();

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    if (!eventDate) {
      return res.status(400).json({ error: 'Event date is required' });
    }

    const diseasePage = await DiseasePage.findOne({ slug: req.params.slug });
    if (!diseasePage) {
      return res.status(404).json({ error: 'Disease page not found' });
    }

    if (!isEditorOrAdmin(diseasePage, req.user.id, req.user.role)) {
      return res.status(403).json({ error: 'Only editors can create events' });
    }

    const now = new Date();

    const newEvent = await Event.create({
      _id: uuidv4(),
      title,
      description,
      eventDate,
      location,
      eventType,
      registrationUrl,
      diseasePageSlug: req.params.slug,
      createdBy: req.user.id,
      createdAt: now,
      updatedAt: now,
    });

    const creator = await User.findById(req.user.id);

    res.status(201).json({
      event: {
        ...newEvent.toObject(),
        creator: creator ? { id: creator.id, name: creator.name, role: creator.role } : null,
      },
    });
  } catch (error) {
    next(error);
  }
}

// Delete a disease page (admin/moderator only)
async function deleteDiseasePage(req, res, next) {
  try {
    if (req.user?.role !== 'admin-user' && req.user?.role !== 'moderator-user') {
      return res.status(403).json({ error: 'Only admins and moderators can delete disease pages' });
    }

    const slug = req.params.slug;
    const diseasePage = await DiseasePage.findOne({ slug });

    if (!diseasePage) {
      return res.status(404).json({ error: 'Disease page not found' });
    }

    // Remove dependent documents to avoid orphaned data
    await Promise.all([
      DiseaseFollower.deleteMany({ diseasePageSlug: slug }),
      Event.deleteMany({ diseasePageSlug: slug }),
    ]);

    await DiseasePage.deleteOne({ slug });

    res.json({ message: 'Disease page deleted successfully', slug });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createDiseasePage,
  getDiseasePages,
  getDiseasePageBySlug,
  followDiseasePage,
  unfollowDiseasePage,
  featurePost,
  unfeaturePost,
  addResource,
  removeResource,
  updateDiseasePage,
  deleteDiseasePage,
  createEvent,
};

