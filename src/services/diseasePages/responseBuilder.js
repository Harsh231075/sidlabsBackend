const DiseaseFollower = require('../../models/DiseaseFollower');
const Group = require('../../models/Group');
const Post = require('../../models/Post');
const Event = require('../../models/Event');
const { toPublicUrl } = require('../../utils/publicUrl');
const { isEditorOrAdmin } = require('./permissions');

async function buildDiseasePageResponse(diseasePage, currentUserId, userRole) {
  const linkedGroupIds = Array.isArray(diseasePage.linkedGroupIds) ? diseasePage.linkedGroupIds : [];
  const featuredPostIds = Array.isArray(diseasePage.featuredPostIds) ? diseasePage.featuredPostIds : [];

  const [isFollowing, followersCount, linkedGroups, featuredPostsLogs, diseaseEventsLogs] = await Promise.all([
    currentUserId
      ? DiseaseFollower.exists({ diseasePageSlug: diseasePage.slug, userId: currentUserId })
      : Promise.resolve(false),
    DiseaseFollower.countDocuments({ diseasePageSlug: diseasePage.slug }),
    linkedGroupIds.length
      ? Group.find({ _id: { $in: linkedGroupIds } })
        .select('name description privacy memberCount')
        .lean()
      : Promise.resolve([]),
    featuredPostIds.length
      ? Post.find({ _id: { $in: featuredPostIds }, removed: false })
        .select('-reports -moderation')
        .populate('authorId', 'name role')
        .lean()
      : Promise.resolve([]),
    Event.find({
      diseasePageSlug: diseasePage.slug,
      eventDate: { $gte: new Date() },
    })
      .sort({ eventDate: 1 })
      .populate('createdBy', 'name role')
      .lean(),
  ]);

  const featuredPosts = featuredPostsLogs.map((p) => ({
    id: p._id,
    content: p.content,
    author: p.authorId ? { id: p.authorId._id, name: p.authorId.name, role: p.authorId.role } : null,
    createdAt: p.createdAt,
    likeCount: (p.likes || []).length,
  }));

  const diseaseEvents = diseaseEventsLogs.map((e) => ({
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

async function buildDiseasePageSummaryResponses(diseasePages, currentUserId, userRole) {
  if (!Array.isArray(diseasePages) || diseasePages.length === 0) return [];

  const slugs = diseasePages.map((dp) => dp.slug).filter(Boolean);
  if (slugs.length === 0) return [];

  const [followersAgg, followingRows] = await Promise.all([
    DiseaseFollower.aggregate([
      { $match: { diseasePageSlug: { $in: slugs } } },
      { $group: { _id: '$diseasePageSlug', count: { $sum: 1 } } },
    ]),
    currentUserId
      ? DiseaseFollower.find({ userId: currentUserId, diseasePageSlug: { $in: slugs } })
        .select('diseasePageSlug')
        .lean()
      : Promise.resolve([]),
  ]);

  const followersCountBySlug = followersAgg.reduce((acc, row) => {
    acc[String(row._id)] = row.count;
    return acc;
  }, {});

  const followingSlugSet = new Set(followingRows.map((r) => String(r.diseasePageSlug)));

  return diseasePages.map((dp) => {
    const linkedGroupIds = Array.isArray(dp.linkedGroupIds) ? dp.linkedGroupIds : [];

    return {
      ...dp,
      heroImageUrl: toPublicUrl(dp.heroImageUrl),
      iconUrl: toPublicUrl(dp.iconUrl),
      isFollowing: currentUserId ? followingSlugSet.has(String(dp.slug)) : false,
      followersCount: followersCountBySlug[String(dp.slug)] || 0,
      linkedGroups: linkedGroupIds.map((id) => ({ id })),
      featuredPosts: [],
      events: [],
      isEditor: isEditorOrAdmin(dp, currentUserId, userRole),
    };
  });
}

module.exports = {
  buildDiseasePageResponse,
  buildDiseasePageSummaryResponses,
};
