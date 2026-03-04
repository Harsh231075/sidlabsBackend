const { v4: uuidv4 } = require('uuid');

const DiseasePage = require('../../models/DiseasePage');
const DiseaseFollower = require('../../models/DiseaseFollower');
const User = require('../../models/User');
const Group = require('../../models/Group');
const Post = require('../../models/Post');
const Event = require('../../models/Event');
const Comment = require('../../models/Comment');

const { sanitizeInput, analyzeTextForModeration } = require('../../utils/moderation');
const { notifyDiseasePagePost, notifyPostLike } = require('../../utils/notifications');
const { toPublicUrl } = require('../../utils/publicUrl');
const storageService = require('../../services/storageService');
const cacheService = require('../../services/cacheService');

const { encodeCursor, decodeCursor } = require('../../services/posts/cursor');
const { getDiseaseFollowerIdsCached } = require('../../services/posts/diseaseFollowerCache');
const { attachAuthorsToPosts } = require('../../services/posts/postResponseBuilder');

const { isEditorOrAdmin } = require('../../services/diseasePages/permissions');
const { buildDiseasePageResponse, buildDiseasePageSummaryResponses } = require('../../services/diseasePages/responseBuilder');
const { formatDiseasePagePosts } = require('../../services/diseasePages/postFormatter');

const { httpError } = require('../../utils/httpError');

async function maybeUploadDataUrlImage({ dataUrl, keyPrefix, filenamePrefix }) {
  if (!String(dataUrl || '').startsWith('data:image/')) return String(dataUrl || '').trim();

  let base64 = dataUrl;
  let mime = 'image/png';
  const dataUrlMatch = String(dataUrl).match(/^data:(.+);base64,(.+)$/);
  if (dataUrlMatch) {
    mime = dataUrlMatch[1];
    base64 = dataUrlMatch[2];
  }

  const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const filename = `${filenamePrefix}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(base64, 'base64');

  if (buffer.length > 5 * 1024 * 1024) {
    throw httpError(400, { error: 'Server Limit Exceeded: File size must be under 5MB.' });
  }

  const uploaded = await storageService.upload({
    buffer,
    contentType: mime,
    key: `${keyPrefix}/${filename}`,
  });

  return uploaded.url;
}

async function createDiseasePage(user, body) {
  const name = sanitizeInput(body?.name || '');
  const slug = sanitizeInput(body?.slug || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const description = sanitizeInput(body?.description || '');
  const codes = body?.codes || {};
  let heroImageUrl = String(body?.heroImageUrl || '').trim();
  const iconUrl = String(body?.iconUrl || '').trim();
  const editors = Array.isArray(body?.editors) ? body.editors : [];
  const linkedGroupIds = Array.isArray(body?.linkedGroupIds) ? body.linkedGroupIds : [];
  const resourceLinks = Array.isArray(body?.resourceLinks) ? body.resourceLinks : [];

  if (!name) throw httpError(400, { error: 'Name is required' });
  if (!slug) throw httpError(400, { error: 'Slug is required' });

  heroImageUrl = await maybeUploadDataUrlImage({
    dataUrl: heroImageUrl,
    keyPrefix: 'disease-pages',
    filenamePrefix: 'disease-hero',
  });

  const existing = await DiseasePage.findOne({ slug });
  if (existing) throw httpError(400, { error: 'A disease page with this slug already exists' });

  if (linkedGroupIds.length > 0) {
    const existingGroups = await Group.find({ _id: { $in: linkedGroupIds } }).select('_id');
    const foundIds = existingGroups.map((g) => g._id.toString());
    const invalidGroups = linkedGroupIds.filter((gId) => !foundIds.includes(gId));
    if (invalidGroups.length > 0) {
      throw httpError(400, { error: `Invalid group IDs: ${invalidGroups.join(', ')}` });
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
    editors: [...editors, user.id],
    linkedGroupIds,
    featuredPostIds: [],
    resourceLinks,
    createdAt: now,
    updatedAt: now,
  });

  const response = await buildDiseasePageResponse(newDiseasePage.toObject(), user.id, user.role);

  await cacheService.invalidatePattern('dp:*');
  return { _statusCode: 201, body: response };
}

async function getDiseasePages(user, query) {
  const search = String(query?.search || '').toLowerCase().trim();
  const pageStr = query?.page;
  const limitStr = query?.limit;

  const isPaginated = !!pageStr || !!limitStr;
  const page = Math.max(parseInt(pageStr || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(limitStr || '10', 10), 1), 100);
  const skip = (page - 1) * limit;

  const cacheKey = `dp:list:${search || 'all'}:${user?.id || 'anon'}${isPaginated ? `:${page}:${limit}` : ''}`;

  const cached = await cacheService.getOrSet(cacheKey, async () => {
    let mongoQuery = {};
    if (search) {
      mongoQuery = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { slug: { $regex: search, $options: 'i' } },
        ],
      };
    }

    if (isPaginated) {
      const [diseasePages, total] = await Promise.all([
        DiseasePage.find(mongoQuery)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .select('name slug description codes heroImageUrl iconUrl linkedGroupIds editors resourceLinks createdAt updatedAt')
          .lean(),
        DiseasePage.countDocuments(mongoQuery)
      ]);

      const responses = await buildDiseasePageSummaryResponses(
        diseasePages,
        user?.id || null,
        user?.role || null,
      );

      return {
        data: responses,
        totalCount: total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    } else {
      const diseasePages = await DiseasePage.find(mongoQuery)
        .sort({ createdAt: -1 })
        .select('name slug description codes heroImageUrl iconUrl linkedGroupIds editors resourceLinks createdAt updatedAt')
        .lean();

      const responses = await buildDiseasePageSummaryResponses(
        diseasePages,
        user?.id || null,
        user?.role || null,
      );

      return responses;
    }
  }, 30); // 30s TTL — disease pages don't change every second

  return { body: cached };
}

async function getDiseasePageBySlug(user, slug) {
  const cacheKey = `dp:slug:${slug}:${user?.id || 'anon'}`;

  const cached = await cacheService.getOrSet(cacheKey, async () => {
    const diseasePage = await DiseasePage.findOne({ slug }).lean();
    if (!diseasePage) return null;

    const response = await buildDiseasePageResponse(diseasePage, user?.id || null, user?.role || null);
    return response;
  }, 30); // 30s TTL

  if (!cached) throw httpError(404, { error: 'Disease page not found' });
  return { body: cached };
}

async function followDiseasePage(user, slug) {
  const diseasePage = await DiseasePage.findOne({ slug }).lean();
  if (!diseasePage) throw httpError(404, { error: 'Disease page not found' });

  const existingFollow = await DiseaseFollower.findOne({ diseasePageSlug: slug, userId: user.id });
  if (existingFollow) throw httpError(400, { error: 'Already following this disease page' });

  await DiseaseFollower.create({
    _id: uuidv4(),
    diseasePageSlug: slug,
    userId: user.id,
    followedAt: new Date(),
  });

  await cacheService.invalidatePattern(`dp:*${slug}*`);
  const response = await buildDiseasePageResponse(diseasePage, user.id, user.role);
  return { body: response };
}

async function unfollowDiseasePage(user, slug) {
  const diseasePage = await DiseasePage.findOne({ slug }).lean();
  if (!diseasePage) throw httpError(404, { error: 'Disease page not found' });

  const deleted = await DiseaseFollower.findOneAndDelete({ diseasePageSlug: slug, userId: user.id });
  if (!deleted) throw httpError(400, { error: 'Not following this disease page' });

  await cacheService.invalidatePattern(`dp:*${slug}*`);
  const response = await buildDiseasePageResponse(diseasePage, user.id, user.role);
  return { body: response };
}

async function featurePost(user, slug, body) {
  const postId = body?.postId;
  if (!postId) throw httpError(400, { error: 'Post ID is required' });

  const diseasePage = await DiseasePage.findOne({ slug });
  if (!diseasePage) throw httpError(404, { error: 'Disease page not found' });

  if (!isEditorOrAdmin(diseasePage, user.id, user.role)) {
    throw httpError(403, { error: 'Only editors can feature posts' });
  }

  const post = await Post.findOne({ _id: postId, removed: false });
  if (!post) throw httpError(404, { error: 'Post not found' });

  diseasePage.featuredPostIds = diseasePage.featuredPostIds || [];
  if (diseasePage.featuredPostIds.includes(postId)) {
    throw httpError(400, { error: 'Post is already featured' });
  }

  diseasePage.featuredPostIds.push(postId);
  diseasePage.updatedAt = new Date();
  await diseasePage.save();
  await cacheService.invalidatePattern(`dp:*${slug}*`);

  const response = await buildDiseasePageResponse(diseasePage.toObject(), user.id, user.role);
  return { body: response };
}

async function unfeaturePost(user, slug, postId) {
  const diseasePage = await DiseasePage.findOne({ slug });
  if (!diseasePage) throw httpError(404, { error: 'Disease page not found' });

  if (!isEditorOrAdmin(diseasePage, user.id, user.role)) {
    throw httpError(403, { error: 'Only editors can unfeature posts' });
  }

  diseasePage.featuredPostIds = (diseasePage.featuredPostIds || []).filter((id) => id !== postId);
  diseasePage.updatedAt = new Date();
  await diseasePage.save();
  await cacheService.invalidatePattern(`dp:*${slug}*`);

  const response = await buildDiseasePageResponse(diseasePage.toObject(), user.id, user.role);
  return { body: response };
}

async function addResource(user, slug, body) {
  const title = sanitizeInput(body?.title || '');
  const url = String(body?.url || '').trim();
  const category = sanitizeInput(body?.category || 'general');

  if (!title) throw httpError(400, { error: 'Title is required' });
  if (!url) throw httpError(400, { error: 'URL is required' });

  const diseasePage = await DiseasePage.findOne({ slug });
  if (!diseasePage) throw httpError(404, { error: 'Disease page not found' });

  if (!isEditorOrAdmin(diseasePage, user.id, user.role)) {
    throw httpError(403, { error: 'Only editors can add resources' });
  }

  diseasePage.resourceLinks = diseasePage.resourceLinks || [];
  diseasePage.resourceLinks.push({
    id: uuidv4(),
    title,
    url,
    category,
    addedBy: user.id,
    addedAt: new Date(),
  });
  diseasePage.updatedAt = new Date();
  await diseasePage.save();
  await cacheService.invalidatePattern(`dp:*${slug}*`);

  const response = await buildDiseasePageResponse(diseasePage.toObject(), user.id, user.role);
  return { body: response };
}

async function removeResource(user, slug, resourceId) {
  const diseasePage = await DiseasePage.findOne({ slug });
  if (!diseasePage) throw httpError(404, { error: 'Disease page not found' });

  if (!isEditorOrAdmin(diseasePage, user.id, user.role)) {
    throw httpError(403, { error: 'Only editors can remove resources' });
  }

  diseasePage.resourceLinks = (diseasePage.resourceLinks || []).filter((r) => r.id !== resourceId);
  diseasePage.updatedAt = new Date();
  await diseasePage.save();
  await cacheService.invalidatePattern(`dp:*${slug}*`);

  const response = await buildDiseasePageResponse(diseasePage.toObject(), user.id, user.role);
  return { body: response };
}

async function updateDiseasePage(user, slug, body) {
  const diseasePage = await DiseasePage.findOne({ slug });
  if (!diseasePage) throw httpError(404, { error: 'Disease page not found' });

  if (!isEditorOrAdmin(diseasePage, user.id, user.role)) {
    throw httpError(403, { error: 'Only editors can update disease pages' });
  }

  if (body?.name !== undefined) diseasePage.name = sanitizeInput(body.name);
  if (body?.description !== undefined) diseasePage.description = sanitizeInput(body.description);

  if (body?.heroImageUrl !== undefined) {
    const heroImageUrl = await maybeUploadDataUrlImage({
      dataUrl: String(body.heroImageUrl || '').trim(),
      keyPrefix: 'disease-pages',
      filenamePrefix: 'disease-hero',
    });
    diseasePage.heroImageUrl = heroImageUrl;
  }

  if (body?.iconUrl !== undefined) diseasePage.iconUrl = String(body.iconUrl || '').trim();

  if (body?.codes !== undefined) {
    diseasePage.codes = {
      orphaCode: body.codes.orphaCode || null,
      omim: body.codes.omim || null,
      icd10: body.codes.icd10 || null,
      snomed: body.codes.snomed || null,
    };
  }

  if (body?.linkedGroupIds !== undefined && Array.isArray(body.linkedGroupIds)) {
    const existingGroups = await Group.find({ _id: { $in: body.linkedGroupIds } }).select('_id');
    const foundIds = existingGroups.map((g) => g._id.toString());
    const invalidGroups = body.linkedGroupIds.filter((gId) => !foundIds.includes(gId));
    if (invalidGroups.length > 0) {
      throw httpError(400, { error: `Invalid group IDs: ${invalidGroups.join(', ')}` });
    }
    diseasePage.linkedGroupIds = body.linkedGroupIds;
  }

  if (body?.editors !== undefined && Array.isArray(body.editors)) {
    if (user.role !== 'admin-user') {
      throw httpError(403, { error: 'Only admins can modify editors list' });
    }
    diseasePage.editors = body.editors;
  }

  diseasePage.updatedAt = new Date();
  await diseasePage.save();
  await cacheService.invalidatePattern('dp:*');

  const response = await buildDiseasePageResponse(diseasePage.toObject(), user.id, user.role);
  return { body: response };
}

async function createEvent(user, slug, body) {
  const title = sanitizeInput(body?.title || '');
  const description = sanitizeInput(body?.description || '');
  const eventDate = body?.eventDate;
  const location = sanitizeInput(body?.location || '');
  const eventType = sanitizeInput(body?.eventType || 'virtual');
  const registrationUrl = String(body?.registrationUrl || '').trim();

  if (!title) throw httpError(400, { error: 'Title is required' });
  if (!eventDate) throw httpError(400, { error: 'Event date is required' });

  const diseasePage = await DiseasePage.findOne({ slug });
  if (!diseasePage) throw httpError(404, { error: 'Disease page not found' });

  if (!isEditorOrAdmin(diseasePage, user.id, user.role)) {
    throw httpError(403, { error: 'Only editors can create events' });
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
    diseasePageSlug: slug,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  });

  const creator = await User.findById(user.id);
  await cacheService.invalidatePattern(`dp:*${slug}*`);

  return {
    _statusCode: 201,
    body: {
      event: {
        ...newEvent.toObject(),
        creator: creator ? { id: creator.id, name: creator.name, role: creator.role } : null,
      },
    },
  };
}

async function deleteDiseasePage(user, slug) {
  if (user?.role !== 'admin-user' && user?.role !== 'moderator-user') {
    throw httpError(403, { error: 'Only admins and moderators can delete disease pages' });
  }

  const diseasePage = await DiseasePage.findOne({ slug });
  if (!diseasePage) throw httpError(404, { error: 'Disease page not found' });

  const posts = await Post.find({ diseasePageSlug: slug }).select('_id mediaUrl');
  const postIds = posts.map((p) => p._id);

  await Promise.all([
    DiseaseFollower.deleteMany({ diseasePageSlug: slug }),
    Event.deleteMany({ diseasePageSlug: slug }),
    Comment.deleteMany({ postId: { $in: postIds } }),
    Post.deleteMany({ diseasePageSlug: slug }),
    DiseasePage.deleteOne({ slug }),
  ]);

  const deletionPromises = [];
  if (diseasePage.heroImageUrl) deletionPromises.push(storageService.deleteFile(diseasePage.heroImageUrl));
  if (diseasePage.iconUrl) deletionPromises.push(storageService.deleteFile(diseasePage.iconUrl));
  for (const p of posts) {
    if (p.mediaUrl) deletionPromises.push(storageService.deleteFile(p.mediaUrl));
  }
  await Promise.all(deletionPromises);
  await cacheService.invalidatePattern('dp:*');

  return { body: { message: 'Disease page deleted successfully', slug } };
}

async function getDiseasePagePosts(user, slug, query) {
  const limit = Math.min(parseInt(query?.limit, 10) || 20, 100);
  const cursor = query?.cursor ? decodeCursor(query.cursor) : null;

  const diseasePage = await DiseasePage.findOne({ slug }).lean();
  if (!diseasePage) throw httpError(404, { error: 'Disease page not found' });

  const isFollowing = await DiseaseFollower.exists({ diseasePageSlug: slug, userId: user.id });
  if (!isFollowing) throw httpError(403, { error: 'You must follow this disease page to view posts' });

  const followerIds = await getDiseaseFollowerIdsCached(slug);

  const baseQuery = { removed: false, visible: true };
  const cursorFilter = cursor
    ? {
      $or: [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
      ],
    }
    : null;

  const directQuery = { ...baseQuery, diseasePageSlug: slug };
  if (cursorFilter) directQuery.$or = cursorFilter.$or;

  const followerQuery = { ...baseQuery, authorId: { $in: followerIds }, groupId: null };
  if (cursorFilter) followerQuery.$or = cursorFilter.$or;

  const [directPosts, followerPosts] = await Promise.all([
    Post.find(directQuery)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .select('authorId content mediaUrl createdAt updatedAt likes reported removed diseasePageSlug groupId')
      .lean(),
    followerIds.length > 0
      ? Post.find(followerQuery)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .select('authorId content mediaUrl createdAt updatedAt likes reported removed diseasePageSlug groupId')
        .lean()
      : Promise.resolve([]),
  ]);

  const allPostsMap = new Map();
  [...directPosts, ...followerPosts].forEach((p) => allPostsMap.set(String(p._id), p));

  let posts = Array.from(allPostsMap.values());
  posts.sort((a, b) => {
    const timeDiff = new Date(b.createdAt) - new Date(a.createdAt);
    if (timeDiff !== 0) return timeDiff;
    return String(b._id).localeCompare(String(a._id));
  });

  posts = await attachAuthorsToPosts(posts);

  const hasMore = posts.length > limit;
  const trimmedPosts = hasMore ? posts.slice(0, limit) : posts;

  const formattedPosts = await formatDiseasePagePosts(trimmedPosts, user.id);

  const nextCursor = hasMore && trimmedPosts.length > 0
    ? encodeCursor(trimmedPosts[trimmedPosts.length - 1].createdAt, trimmedPosts[trimmedPosts.length - 1]._id)
    : null;

  return {
    body: {
      posts: formattedPosts,
      nextCursor,
      hasMore,
    },
  };
}

async function createDiseasePagePost(user, slug, body) {
  const content = sanitizeInput(body?.content || '');
  let mediaUrl = String(body?.mediaUrl || '').trim();
  const image = body?.image || null;

  if (!content) throw httpError(400, { error: 'Content is required' });

  const diseasePage = await DiseasePage.findOne({ slug }).lean();
  if (!diseasePage) throw httpError(404, { error: 'Disease page not found' });

  const isFollowing = await DiseaseFollower.exists({ diseasePageSlug: slug, userId: user.id });
  if (!isFollowing) throw httpError(403, { error: 'You must follow this disease page to create posts' });

  const analysis = analyzeTextForModeration(content);
  const userConfirmed = !!body?.userConfirmedModeration;

  if (analysis.alertRequired && !userConfirmed) {
    throw httpError(409, {
      error: 'moderation_confirmation_required',
      message: 'This post may contain PHI, spam, or promotional content. This post will be monitored. Are you sure you want to post?',
      analysis,
    });
  }

  const isPendingReview = analysis.alertRequired && userConfirmed;

  if (image) {
    mediaUrl = await maybeUploadDataUrlImage({
      dataUrl: image,
      keyPrefix: 'disease-posts',
      filenamePrefix: String(user.id),
    });
  }

  const now = new Date();
  const newPost = await Post.create({
    _id: uuidv4(),
    authorId: user.id,
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
      flaggedBy: isPendingReview ? user.id : null,
    },
  });

  const { processUserAction } = require('../../services/tokenService');
  processUserAction(user.id, 'create_post', { postId: newPost._id, diseasePageSlug: slug })
    .catch((err) => console.error('Error processing gamification for disease post:', err));

  notifyDiseasePagePost(diseasePage._id, newPost._id, user.id, diseasePage.name)
    .catch((err) => console.error('Failed to notify disease page followers:', err));

  await newPost.populate('authorId', 'name role avatarUrl');

  const response = {
    id: newPost._id,
    authorId: newPost.authorId._id,
    author: {
      id: newPost.authorId._id,
      name: newPost.authorId.name,
      role: newPost.authorId.role,
      avatarUrl: toPublicUrl(newPost.authorId.avatarUrl),
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
    diseasePageSlug: newPost.diseasePageSlug,
  };

  return { _statusCode: 201, body: { post: response } };
}

async function removeDiseasePagePost(user, slug, postId) {
  const diseasePage = await DiseasePage.findOne({ slug }).lean();
  if (!diseasePage) throw httpError(404, { error: 'Disease page not found' });

  if (!isEditorOrAdmin(diseasePage, user.id, user.role)) {
    throw httpError(403, { error: 'Only moderators and admins can remove posts' });
  }

  const post = await Post.findOne({ _id: postId, diseasePageSlug: slug });
  if (!post) throw httpError(404, { error: 'Post not found on this disease page' });

  if (post.mediaUrl) await storageService.deleteFile(post.mediaUrl);

  post.removed = true;
  post.removedBy = user.id;
  post.removedAt = new Date();
  post.mediaUrl = null;
  await post.save();

  return { body: { success: true, message: 'Post removed successfully' } };
}

async function reviewDiseasePagePost(user, slug, postId, body) {
  const { action } = body || {};
  if (!['approve', 'reject'].includes(action)) {
    throw httpError(400, { error: 'Action must be either "approve" or "reject"' });
  }

  const diseasePage = await DiseasePage.findOne({ slug }).lean();
  if (!diseasePage) throw httpError(404, { error: 'Disease page not found' });

  if (!isEditorOrAdmin(diseasePage, user.id, user.role)) {
    throw httpError(403, { error: 'Only moderators and admins can review posts' });
  }

  const post = await Post.findOne({ _id: postId, diseasePageSlug: slug });
  if (!post) throw httpError(404, { error: 'Post not found on this disease page' });

  if (action === 'approve') {
    post.reported = false;
    post.moderation = {
      ...post.moderation,
      status: 'APPROVED',
      reviewedBy: user.id,
      reviewedAt: new Date(),
    };
  } else {
    if (post.mediaUrl) await storageService.deleteFile(post.mediaUrl);
    post.removed = true;
    post.removedBy = user.id;
    post.removedAt = new Date();
    post.mediaUrl = null;
    post.moderation = {
      ...post.moderation,
      status: 'REJECTED',
      reviewedBy: user.id,
      reviewedAt: new Date(),
    };
  }

  await post.save();

  return {
    body: {
      success: true,
      message: action === 'approve' ? 'Post approved' : 'Post rejected and removed',
      action,
    },
  };
}

async function getAllDiseasePagePosts(user, slug, query) {
  const limit = Math.min(parseInt(query?.limit, 10) || 20, 100);
  const cursor = query?.cursor ? decodeCursor(query.cursor) : null;
  const filter = query?.filter;

  const diseasePage = await DiseasePage.findOne({ slug }).lean();
  if (!diseasePage) throw httpError(404, { error: 'Disease page not found' });

  if (!isEditorOrAdmin(diseasePage, user.id, user.role)) {
    throw httpError(403, { error: 'Only moderators and admins can access all posts' });
  }

  const mongoQuery = { diseasePageSlug: slug, removed: false };
  if (filter === 'reported') mongoQuery.reported = true;

  if (cursor) {
    mongoQuery.$or = [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
    ];
  }

  const posts = await Post.find(mongoQuery)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .populate('authorId', 'name role avatarUrl')
    .lean();

  const hasMore = posts.length > limit;
  const trimmedPosts = hasMore ? posts.slice(0, limit) : posts;

  const formattedPosts = await formatDiseasePagePosts(trimmedPosts, user.id, { includeModeration: true });

  const nextCursor = hasMore && trimmedPosts.length > 0
    ? encodeCursor(trimmedPosts[trimmedPosts.length - 1].createdAt, trimmedPosts[trimmedPosts.length - 1]._id)
    : null;

  return {
    body: {
      posts: formattedPosts,
      nextCursor,
      hasMore,
    },
  };
}

async function likeDiseasePagePost(user, id) {
  const post = await Post.findById(id);
  if (!post) throw httpError(404, { error: 'Post not found' });

  const likeList = post.likes || [];
  const idx2 = likeList.indexOf(user.id);

  const wasLiked = idx2 >= 0;
  const { processUserAction } = require('../../services/tokenService');

  if (!wasLiked) {
    post.likes.push(user.id);

    processUserAction(user.id, 'like_post', { postId: post._id })
      .catch((err) => console.error('Error processing gamification for disease post like:', err));

    if (String(post.authorId) !== String(user.id)) {
      processUserAction(post.authorId, 'receive_like', { postId: post._id, likerId: user.id })
        .catch((err) => console.error('Error processing gamification for disease post receive_like:', err));

      notifyPostLike(user.id, post.authorId, post._id, true)
        .catch((err) => console.error('Error creating like notification:', err));
    }
  } else {
    post.likes.splice(idx2, 1);
  }

  await post.save();

  return { body: { success: true, likeCount: post.likes.length, likedByCurrentUser: !wasLiked } };
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
