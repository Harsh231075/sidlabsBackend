const { v4: uuidv4 } = require('uuid');
const DiseasePage = require('../models/DiseasePage');
const DiseaseFollower = require('../models/DiseaseFollower');
const User = require('../models/User');
const Group = require('../models/Group');
const Post = require('../models/Post');
const Event = require('../models/Event');
const Follow = require('../models/Follow');
const Comment = require('../models/Comment');
const { sanitizeInput, analyzeTextForModeration } = require('../utils/moderation');
const { notifyDiseasePagePost } = require('../utils/notifications');
const { toPublicUrl } = require('../utils/publicUrl');

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
    heroImageUrl: toPublicUrl(diseasePage.heroImageUrl),
    iconUrl: toPublicUrl(diseasePage.iconUrl),
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

// Helper function for cursor-based pagination
function encodeCursor(createdAt, id) {
  return Buffer.from(`${new Date(createdAt).toISOString()}|${id}`, 'utf8').toString('base64');
}

function decodeCursor(cursor) {
  try {
    const decoded = Buffer.from(String(cursor), 'base64').toString('utf8');
    const [iso, id] = decoded.split('|');
    const createdAt = new Date(iso);
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

// Get posts for a disease page (only from users the current user follows)
async function getDiseasePagePosts(req, res, next) {
  try {
    const slug = req.params.slug;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;

    // Verify disease page exists
    const diseasePage = await DiseasePage.findOne({ slug }).lean();
    if (!diseasePage) {
      return res.status(404).json({ error: 'Disease page not found' });
    }

    // Check if user is following this disease page
    const isFollowing = await DiseaseFollower.exists({
      diseasePageSlug: slug,
      userId: req.user.id
    });

    if (!isFollowing) {
      return res.status(403).json({ error: 'You must follow this disease page to view posts' });
    }

    // Get all users who follow this disease page
    const followers = await DiseaseFollower.find({ diseasePageSlug: slug }).select('userId').lean();
    const followerIds = followers.map(f => f.userId);

    // Build query for posts
    // 1. Posts explicitly tagged with this disease
    // 2. Public posts from users who follow this disease page
    const query = {
      removed: false,
      visible: true,
      $or: [
        { diseasePageSlug: slug },
        {
          authorId: { $in: followerIds },
          groupId: null // Only public posts
        }
      ]
    };

    if (cursor) {
      const existingOr = query.$or;
      delete query.$or;
      query.$and = [
        { $or: existingOr },
        {
          $or: [
            { createdAt: { $lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, _id: { $lt: cursor.id } }
          ]
        }
      ];
    } else {
      // Default query uses $or
    }

    const posts = await Post.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .populate('authorId', 'name role avatarUrl')
      .lean();

    const hasMore = posts.length > limit;
    const trimmedPosts = hasMore ? posts.slice(0, limit) : posts;

    // Get comment counts for all posts
    const postIds = trimmedPosts.map(p => p._id);
    const commentCounts = await Comment.aggregate([
      { $match: { postId: { $in: postIds }, removed: false } },
      { $group: { _id: '$postId', count: { $sum: 1 } } }
    ]);

    const commentCountMap = commentCounts.reduce((acc, c) => {
      acc[c._id] = c.count;
      return acc;
    }, {});

    // Format response
    const formattedPosts = trimmedPosts.map(post => ({
      id: post._id,
      authorId: post.authorId?._id || post.authorId,
      author: post.authorId ? {
        id: post.authorId._id,
        name: post.authorId.name,
        role: post.authorId.role,
        avatarUrl: toPublicUrl(post.authorId.avatarUrl)
      } : null,
      content: post.content,
      mediaUrl: toPublicUrl(post.mediaUrl),
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      likeCount: (post.likes || []).length,
      likedByCurrentUser: (post.likes || []).includes(req.user.id),
      commentCount: commentCountMap[post._id] || 0,
      reported: post.reported,
      removed: post.removed,
      diseasePageSlug: post.diseasePageSlug
    }));

    const nextCursor = hasMore && trimmedPosts.length > 0
      ? encodeCursor(trimmedPosts[trimmedPosts.length - 1].createdAt, trimmedPosts[trimmedPosts.length - 1]._id)
      : null;

    res.json({
      posts: formattedPosts,
      nextCursor,
      hasMore
    });
  } catch (error) {
    next(error);
  }
}

// Create a post on a disease page
async function createDiseasePagePost(req, res, next) {
  try {
    const slug = req.params.slug;
    const content = sanitizeInput(req.body.content || '');
    let mediaUrl = (req.body.mediaUrl || '').trim();
    const image = req.body.image || null;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Verify disease page exists
    const diseasePage = await DiseasePage.findOne({ slug }).lean();
    if (!diseasePage) {
      return res.status(404).json({ error: 'Disease page not found' });
    }

    // Check if user is following this disease page (must follow to post)
    const isFollowing = await DiseaseFollower.exists({
      diseasePageSlug: slug,
      userId: req.user.id
    });

    if (!isFollowing) {
      return res.status(403).json({ error: 'You must follow this disease page to create posts' });
    }

    // Moderation check
    const analysis = analyzeTextForModeration(content);
    const userConfirmed = !!req.body.userConfirmedModeration;

    if (analysis.alertRequired && !userConfirmed) {
      return res.status(409).json({
        error: 'moderation_confirmation_required',
        message: 'This post may contain PHI, spam, or promotional content. This post will be monitored. Are you sure you want to post?',
        analysis
      });
    }

    const isPendingReview = analysis.alertRequired && userConfirmed;

    // Handle image upload if provided
    if (image) {
      const storageService = require('../services/storageService');
      let base64 = image;
      let mime = 'image/png';
      const dataUrlMatch = String(image).match(/^data:(.+);base64,(.+)$/);
      if (dataUrlMatch) {
        mime = dataUrlMatch[1];
        base64 = dataUrlMatch[2];
      }
      const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase();
      const filename = `${req.user.id}-${Date.now()}.${ext}`;
      const buffer = Buffer.from(base64, 'base64');
      const uploaded = await storageService.upload({ buffer, contentType: mime, key: `disease-posts/${filename}` });
      mediaUrl = uploaded.url;
    }

    const now = new Date();
    const newPost = await Post.create({
      _id: uuidv4(),
      authorId: req.user.id,
      content,
      mediaUrl,
      diseasePageSlug: slug,
      createdAt: now,
      updatedAt: now,
      likes: [],
      reported: isPendingReview,
      reports: [],
      removed: false,
      moderation: {
        status: isPendingReview ? 'PENDING_REVIEW' : 'ALLOW',
        analysis,
        flaggedAt: isPendingReview ? now : null,
        flaggedBy: isPendingReview ? req.user.id : null
      },
    });

    const { processUserAction } = require('../services/tokenService');
    // Award tokens for creating a post on a disease page
    processUserAction(req.user.id, 'create_post', { postId: newPost._id, diseasePageSlug: slug })
      .catch((err) => console.error('Error processing gamification for disease post:', err));

    // Notify followers
    // Note: This relies on implementation details of DiseasePage follower tracking which might reside in Follow model or User preferences.
    // For now, we attempt to call the notification utility using the fetched `diseasePage`.
    if (diseasePage) {
      notifyDiseasePagePost(diseasePage._id, newPost._id, req.user.id, diseasePage.name)
        .catch(err => console.error('Failed to notify disease page followers:', err));
    }

    // Populate author for response
    await newPost.populate('authorId', 'name role avatarUrl');

    const response = {
      id: newPost._id,
      authorId: newPost.authorId._id,
      author: {
        id: newPost.authorId._id,
        name: newPost.authorId.name,
        role: newPost.authorId.role,
        avatarUrl: toPublicUrl(newPost.authorId.avatarUrl)
      },
      content: newPost.content,
      mediaUrl: toPublicUrl(newPost.mediaUrl),
      createdAt: newPost.createdAt,
      updatedAt: newPost.updatedAt,
      likeCount: 0,
      likedByCurrentUser: false,
      commentCount: 0,
      reported: newPost.reported,
      removed: newPost.removed,
      diseasePageSlug: newPost.diseasePageSlug
    };

    res.status(201).json({ post: response });
  } catch (error) {
    next(error);
  }
}

// Remove a post from disease page (moderator/admin only)
async function removeDiseasePagePost(req, res, next) {
  try {
    const { slug, postId } = req.params;

    // Verify disease page exists
    const diseasePage = await DiseasePage.findOne({ slug }).lean();
    if (!diseasePage) {
      return res.status(404).json({ error: 'Disease page not found' });
    }

    // Check if user is editor/admin/moderator
    if (!isEditorOrAdmin(diseasePage, req.user.id, req.user.role)) {
      return res.status(403).json({ error: 'Only moderators and admins can remove posts' });
    }

    const post = await Post.findOne({ _id: postId, diseasePageSlug: slug });
    if (!post) {
      return res.status(404).json({ error: 'Post not found on this disease page' });
    }

    post.removed = true;
    post.removedBy = req.user.id;
    post.removedAt = new Date();
    await post.save();

    res.json({ success: true, message: 'Post removed successfully' });
  } catch (error) {
    next(error);
  }
}

// Review a post (mark as reviewed - moderator/admin only)
async function reviewDiseasePagePost(req, res, next) {
  try {
    const { slug, postId } = req.params;
    const { action } = req.body; // 'approve' or 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be either "approve" or "reject"' });
    }

    // Verify disease page exists
    const diseasePage = await DiseasePage.findOne({ slug }).lean();
    if (!diseasePage) {
      return res.status(404).json({ error: 'Disease page not found' });
    }

    // Check if user is editor/admin/moderator
    if (!isEditorOrAdmin(diseasePage, req.user.id, req.user.role)) {
      return res.status(403).json({ error: 'Only moderators and admins can review posts' });
    }

    const post = await Post.findOne({ _id: postId, diseasePageSlug: slug });
    if (!post) {
      return res.status(404).json({ error: 'Post not found on this disease page' });
    }

    if (action === 'approve') {
      post.reported = false;
      post.moderation = {
        ...post.moderation,
        status: 'APPROVED',
        reviewedBy: req.user.id,
        reviewedAt: new Date()
      };
    } else {
      post.removed = true;
      post.removedBy = req.user.id;
      post.removedAt = new Date();
      post.moderation = {
        ...post.moderation,
        status: 'REJECTED',
        reviewedBy: req.user.id,
        reviewedAt: new Date()
      };
    }

    await post.save();

    res.json({
      success: true,
      message: action === 'approve' ? 'Post approved' : 'Post rejected and removed',
      action
    });
  } catch (error) {
    next(error);
  }
}

// Get all posts for disease page (for moderators - includes all users' posts)
async function getAllDiseasePagePosts(req, res, next) {
  try {
    const slug = req.params.slug;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;
    const filter = req.query.filter; // 'reported', 'all'

    // Verify disease page exists
    const diseasePage = await DiseasePage.findOne({ slug }).lean();
    if (!diseasePage) {
      return res.status(404).json({ error: 'Disease page not found' });
    }

    // Check if user is editor/admin/moderator
    if (!isEditorOrAdmin(diseasePage, req.user.id, req.user.role)) {
      return res.status(403).json({ error: 'Only moderators and admins can access all posts' });
    }

    // Build query
    const query = {
      diseasePageSlug: slug,
      removed: false
    };

    if (filter === 'reported') {
      query.reported = true;
    }

    if (cursor) {
      query.$or = [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: cursor.id } }
      ];
    }

    const posts = await Post.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .populate('authorId', 'name role avatarUrl')
      .lean();

    const hasMore = posts.length > limit;
    const trimmedPosts = hasMore ? posts.slice(0, limit) : posts;

    // Get comment counts
    const postIds = trimmedPosts.map(p => p._id);
    const commentCounts = await Comment.aggregate([
      { $match: { postId: { $in: postIds }, removed: false } },
      { $group: { _id: '$postId', count: { $sum: 1 } } }
    ]);

    const commentCountMap = commentCounts.reduce((acc, c) => {
      acc[c._id] = c.count;
      return acc;
    }, {});

    // Format response
    const formattedPosts = trimmedPosts.map(post => ({
      id: post._id,
      authorId: post.authorId?._id || post.authorId,
      author: post.authorId ? {
        id: post.authorId._id,
        name: post.authorId.name,
        role: post.authorId.role,
        avatarUrl: toPublicUrl(post.authorId.avatarUrl)
      } : null,
      content: post.content,
      mediaUrl: toPublicUrl(post.mediaUrl),
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      likeCount: (post.likes || []).length,
      likedByCurrentUser: (post.likes || []).includes(req.user.id),
      commentCount: commentCountMap[post._id] || 0,
      reported: post.reported,
      removed: post.removed,
      diseasePageSlug: post.diseasePageSlug,
      moderation: post.moderation
    }));

    const nextCursor = hasMore && trimmedPosts.length > 0
      ? encodeCursor(trimmedPosts[trimmedPosts.length - 1].createdAt, trimmedPosts[trimmedPosts.length - 1]._id)
      : null;

    res.json({
      posts: formattedPosts,
      nextCursor,
      hasMore
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Like or unlike a post on a disease page
 */
async function likeDiseasePagePost(req, res, next) {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const likeList = post.likes || [];
    const idx2 = likeList.indexOf(req.user.id);

    const wasLiked = idx2 >= 0;
    const { processUserAction } = require('../services/tokenService');

    if (!wasLiked) {
      post.likes.push(req.user.id);

      // Award points for liking (fire and forget - tokenService handles duplicate protection)
      processUserAction(req.user.id, 'like_post', { postId: post._id })
        .catch((err) => console.error('Error processing gamification for disease post like:', err));

      if (post.authorId !== req.user.id) {
        // Award points to post author
        processUserAction(post.authorId, 'receive_like', { postId: post._id, likerId: req.user.id })
          .catch((err) => console.error('Error processing gamification for disease post receive_like:', err));

        // Create notification
        const { notifyPostLike } = require('../utils/notifications');
        notifyPostLike(req.user.id, post.authorId, post._id, true).catch((err) => {
          console.error('Error creating like notification:', err);
        });
      }
    } else {
      post.likes.splice(idx2, 1);
    }

    await post.save();

    res.json({ success: true, likeCount: post.likes.length, likedByCurrentUser: !wasLiked });
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
  getDiseasePagePosts,
  createDiseasePagePost,
  removeDiseasePagePost,
  reviewDiseasePagePost,
  getAllDiseasePagePosts,
  likeDiseasePagePost,
};

