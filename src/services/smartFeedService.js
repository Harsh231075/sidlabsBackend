const Follow = require('../models/Follow');
const FriendRequest = require('../models/FriendRequest');
const DiseaseFollower = require('../models/DiseaseFollower');
const Group = require('../models/Group');
const Post = require('../models/Post');
const User = require('../models/User');

/**
 * Smart Feed Service
 * 
 * Provides personalized feed based on:
 * 1. Posts from users the current user follows
 * 2. Posts from friends (accepted friend requests)
 * 3. Posts from disease pages the user follows
 * 4. Posts from groups the user is a member of
 * 5. For new users without connections: location-based and interest-based suggestions
 */

/**
 * Get all user IDs that the current user has a connection with
 * (following, friends, same groups, same disease pages)
 */
async function getUserConnections(userId) {
    const [
        followingDocs,
        friendRequests,
        myGroups,
        diseaseFollows,
        currentUser
    ] = await Promise.all([
        // People I follow
        Follow.find({ follower: userId }).select('following').lean(),
        // Accepted friend requests (both directions)
        FriendRequest.find({
            $or: [{ from: userId }, { to: userId }],
            status: 'accepted'
        }).lean(),
        // Groups I'm in
        Group.find({
            $or: [
                { members: userId },
                { adminIds: userId },
                { ownerId: userId }
            ]
        }).select('_id members adminIds ownerId').lean(),
        // Disease pages I follow
        DiseaseFollower.find({ userId }).select('diseasePageSlug').lean(),
        // Current user's profile
        User.findById(userId).select('disease location healthInterests').lean()
    ]);

    // Extract following user IDs
    const followingIds = followingDocs.map(f => f.following);

    // Extract friend IDs
    const friendIds = friendRequests.map(fr =>
        fr.from === userId ? fr.to : fr.from
    );

    // Extract group member IDs (people in same groups)
    const groupMemberIds = new Set();
    const groupIds = [];
    for (const group of myGroups) {
        groupIds.push(group._id);
        (group.members || []).forEach(m => groupMemberIds.add(m));
        (group.adminIds || []).forEach(a => groupMemberIds.add(a));
        if (group.ownerId) groupMemberIds.add(group.ownerId);
    }
    groupMemberIds.delete(userId); // Remove self

    // Extract disease page slugs I follow
    const followedDiseaseSlugs = diseaseFollows.map(df => df.diseasePageSlug);

    return {
        followingIds,
        friendIds,
        groupIds,
        groupMemberIds: Array.from(groupMemberIds),
        followedDiseaseSlugs,
        userProfile: currentUser
    };
}

/**
 * Get smart feed for a user with connections
 * Priority: Friends > Following > Group Members > Disease Pages
 */
async function getSmartFeedWithConnections(userId, connections, options = {}) {
    const { limit = 20, cursor = null } = options;

    // Combine all connected user IDs with weights
    const connectedUserIds = new Set();

    // Add friends (highest priority)
    connections.friendIds.forEach(id => connectedUserIds.add(id));

    // Add following
    connections.followingIds.forEach(id => connectedUserIds.add(id));

    // Add group members
    connections.groupMemberIds.forEach(id => connectedUserIds.add(id));

    // Build feed query
    const baseQuery = {
        removed: false,
        visible: true,
        $or: []
    };

    // 1. Posts from connected users (no group/disease page)
    if (connectedUserIds.size > 0) {
        baseQuery.$or.push({
            authorId: { $in: Array.from(connectedUserIds) },
            groupId: null,
            diseasePageSlug: null
        });
    }

    // 2. Posts from groups I'm in
    if (connections.groupIds.length > 0) {
        baseQuery.$or.push({
            groupId: { $in: connections.groupIds }
        });
    }

    // 3. Posts from disease pages I follow
    if (connections.followedDiseaseSlugs.length > 0) {
        baseQuery.$or.push({
            diseasePageSlug: { $in: connections.followedDiseaseSlugs }
        });
    }

    // 4. User's own posts (always show)
    baseQuery.$or.push({
        authorId: userId,
        groupId: null,
        diseasePageSlug: null
    });

    // If no connections at all, return empty (caller will use cold start)
    if (baseQuery.$or.length === 0) {
        return { posts: [], hasMore: false };
    }

    // Add cursor pagination if provided
    if (cursor) {
        baseQuery.$and = [
            { $or: baseQuery.$or },
            {
                $or: [
                    { createdAt: { $lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, _id: { $lt: cursor.id } }
                ]
            }
        ];
        delete baseQuery.$or;
    }

    // Fetch posts
    const posts = await Post.find(baseQuery)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean();

    const hasMore = posts.length > limit;
    const trimmedPosts = hasMore ? posts.slice(0, limit) : posts;

    return {
        posts: trimmedPosts,
        hasMore,
        nextCursor: trimmedPosts.length > 0 ? {
            createdAt: trimmedPosts[trimmedPosts.length - 1].createdAt,
            id: trimmedPosts[trimmedPosts.length - 1]._id
        } : null
    };
}

/**
 * Cold Start Feed for New Users
 * Uses location, disease, and health interests for smart suggestions
 */
async function getColdStartFeed(userId, userProfile, options = {}) {
    const { limit = 20, cursor = null } = options;

    const location = userProfile?.location?.trim() || '';
    const disease = userProfile?.disease?.trim() || '';
    const healthInterests = userProfile?.healthInterests || [];

    // Find users with similar attributes
    const similarUserQuery = {
        _id: { $ne: userId },
        suspended: false,
        $or: []
    };

    // 1. Same location (highest priority for cold start)
    if (location) {
        similarUserQuery.$or.push({
            location: { $regex: new RegExp(location, 'i') }
        });
    }

    // 2. Same disease
    if (disease) {
        similarUserQuery.$or.push({
            disease: { $regex: new RegExp(disease, 'i') }
        });
    }

    // 3. Similar health interests
    if (healthInterests.length > 0) {
        similarUserQuery.$or.push({
            healthInterests: { $in: healthInterests }
        });
    }

    let similarUserIds = [];

    if (similarUserQuery.$or.length > 0) {
        const similarUsers = await User.find(similarUserQuery)
            .select('_id')
            .limit(50)
            .lean();
        similarUserIds = similarUsers.map(u => u._id);
    }

    // Find disease pages matching user's disease
    let matchingDiseaseSlugs = [];
    if (disease) {
        const DiseasePage = require('../models/DiseasePage');
        const matchingPages = await DiseasePage.find({
            $or: [
                { name: { $regex: new RegExp(disease, 'i') } },
                { slug: { $regex: new RegExp(disease.toLowerCase().replace(/\s+/g, '-'), 'i') } }
            ]
        }).select('slug').limit(5).lean();
        matchingDiseaseSlugs = matchingPages.map(p => p.slug);
    }

    // Build feed query
    const baseQuery = {
        removed: false,
        visible: true,
        $or: []
    };

    // Posts from similar users (no private groups)
    if (similarUserIds.length > 0) {
        baseQuery.$or.push({
            authorId: { $in: similarUserIds },
            groupId: null // Only public feed posts
        });
    }

    // Posts from matching disease pages
    if (matchingDiseaseSlugs.length > 0) {
        baseQuery.$or.push({
            diseasePageSlug: { $in: matchingDiseaseSlugs }
        });
    }

    // If still no matches, show recent public posts from active users
    if (baseQuery.$or.length === 0) {
        // Fallback: Recent posts from any public source
        baseQuery.$or.push({
            groupId: null,
            diseasePageSlug: null
        });
    }

    // Add cursor pagination
    if (cursor) {
        baseQuery.$and = [
            { $or: baseQuery.$or },
            {
                $or: [
                    { createdAt: { $lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, _id: { $lt: cursor.id } }
                ]
            }
        ];
        delete baseQuery.$or;
    }

    // Fetch posts
    const posts = await Post.find(baseQuery)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean();

    const hasMore = posts.length > limit;
    const trimmedPosts = hasMore ? posts.slice(0, limit) : posts;

    return {
        posts: trimmedPosts,
        hasMore,
        nextCursor: trimmedPosts.length > 0 ? {
            createdAt: trimmedPosts[trimmedPosts.length - 1].createdAt,
            id: trimmedPosts[trimmedPosts.length - 1]._id
        } : null,
        isColdStart: true
    };
}

/**
 * Main Smart Feed Function
 * Determines if user has connections or needs cold start
 */
async function getSmartFeed(userId, options = {}) {
    try {
        const connections = await getUserConnections(userId);

        // Check if user has any connections
        const hasConnections =
            connections.followingIds.length > 0 ||
            connections.friendIds.length > 0 ||
            connections.groupIds.length > 0 ||
            connections.followedDiseaseSlugs.length > 0;

        if (hasConnections) {
            // User has connections - show personalized feed
            return await getSmartFeedWithConnections(userId, connections, options);
        } else {
            // New user without connections - use cold start strategy
            return await getColdStartFeed(userId, connections.userProfile, options);
        }
    } catch (error) {
        console.error('Error getting smart feed:', error);
        throw error;
    }
}

/**
 * Get feed stats for debugging/analytics
 */
async function getFeedStats(userId) {
    const connections = await getUserConnections(userId);

    return {
        followingCount: connections.followingIds.length,
        friendsCount: connections.friendIds.length,
        groupsCount: connections.groupIds.length,
        diseasePageFollowsCount: connections.followedDiseaseSlugs.length,
        hasConnections:
            connections.followingIds.length > 0 ||
            connections.friendIds.length > 0 ||
            connections.groupIds.length > 0 ||
            connections.followedDiseaseSlugs.length > 0,
        userProfile: connections.userProfile
    };
}

module.exports = {
    getSmartFeed,
    getUserConnections,
    getSmartFeedWithConnections,
    getColdStartFeed,
    getFeedStats
};
