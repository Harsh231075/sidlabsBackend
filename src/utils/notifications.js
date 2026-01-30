const Notification = require('../models/Notification');
const NotificationPreference = require('../models/NotificationPreference');
const Group = require('../models/Group');
const { v4: uuidv4 } = require('uuid');

/**
 * Notification types
 */
const NOTIFICATION_TYPES = {
  COMMENT: 'comment',
  LIKE: 'like',
  GROUP_POST: 'group_post',
  FORUM_REPLY: 'forum_reply',
  EVENT_REMINDER: 'event_reminder',
  PATIENT_HUB_TASK: 'patient_hub_task', // Cross-system notification
};

/**
 * Create a notification
 */
async function createNotification(userId, type, message, metadata = {}) {
  const now = new Date(); // Mongoose handles dates

  const notification = await Notification.create({
    _id: uuidv4(),
    userId,
    type,
    message,
    entityId: metadata.entityId || null,
    entityType: metadata.entityType || null,
    read: false,
    createdAt: now,
    metadata: metadata.metadata || {},
  });

  return notification;
}

/**
 * Create notification for post comment
 */
async function notifyPostComment(commentAuthorId, postAuthorId, postId, commentId) {
  if (commentAuthorId === postAuthorId) {
    return null; // Don't notify self
  }

  return createNotification(
    postAuthorId,
    NOTIFICATION_TYPES.COMMENT,
    'Someone commented on your post',
    {
      entityId: commentId,
      entityType: 'comment',
      metadata: { postId },
    }
  );
}

/**
 * Create notification for post like
 */
async function notifyPostLike(likeAuthorId, postAuthorId, postId, isLiking) {
  if (!isLiking || likeAuthorId === postAuthorId) {
    return null; // Don't notify if unliking or self-like
  }

  // Check user preferences
  const prefs = await getUserNotificationPreferences(postAuthorId);
  if (prefs && prefs.emailLikes === false) {
    // skip email logic
  }

  return createNotification(
    postAuthorId,
    NOTIFICATION_TYPES.LIKE,
    'Someone liked your post',
    {
      entityId: postId,
      entityType: 'post',
    }
  );
}

/**
 * Create notification for new post in group
 */
async function notifyGroupPost(groupId, postId, postAuthorId) {
  const group = await Group.findById(groupId);
  if (!group) return;

  const members = group.members || [];
  const notifications = [];

  for (const memberId of members) {
    if (memberId !== postAuthorId) {
      const notification = await createNotification(
        memberId,
        NOTIFICATION_TYPES.GROUP_POST,
        `New post in ${group.name}`,
        {
          entityId: postId,
          entityType: 'post',
          metadata: { groupId, groupName: group.name },
        }
      );
      notifications.push(notification);
    }
  }

  return notifications;
}

/**
 * Create notification for forum reply
 */
async function notifyForumReply(replyAuthorId, threadCreatorId, threadId, postId, repliedToUserId = null) {
  const notifications = [];

  // Notify thread creator
  if (replyAuthorId !== threadCreatorId) {
    notifications.push(
      await createNotification(
        threadCreatorId,
        NOTIFICATION_TYPES.FORUM_REPLY,
        'Someone replied to your forum thread',
        {
          entityId: postId,
          entityType: 'forum_post',
          metadata: { threadId },
        }
      )
    );
  }

  // Notify replied user
  if (repliedToUserId && repliedToUserId !== replyAuthorId && repliedToUserId !== threadCreatorId) {
    notifications.push(
      await createNotification(
        repliedToUserId,
        NOTIFICATION_TYPES.FORUM_REPLY,
        'Someone replied to you in a forum thread',
        {
          entityId: postId,
          entityType: 'forum_post',
          metadata: { threadId },
        }
      )
    );
  }

  return notifications;
}

/**
 * Create cross-system notification
 */
async function notifyPatientHubTask(userId, taskType, message) {
  return createNotification(
    userId,
    NOTIFICATION_TYPES.PATIENT_HUB_TASK,
    message || 'You have a new task in the patient portal',
    {
      entityId: null,
      entityType: 'task',
      metadata: { taskType, source: 'patient_hub' },
    }
  );
}

/**
 * Get user notification preferences
 */
async function getUserNotificationPreferences(userId) {
  const userPrefs = await NotificationPreference.findOne({ userId });

  if (userPrefs) {
    return userPrefs;
  }

  // Default
  return {
    userId,
    emailComments: true,
    emailLikes: true,
    emailGroupPosts: true,
    emailForumReplies: true,
    emailEventReminders: true,
    emailPatientHubTasks: true,
  };
}

/**
 * Update user notification preferences
 */
async function updateUserNotificationPreferences(userId, preferences) {
  const update = {
    userId,
    ...preferences
  };

  // Mongoose findOneAndUpdate with upsert
  const updatedPrefs = await NotificationPreference.findOneAndUpdate(
    { userId },
    update,
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return updatedPrefs;
}

module.exports = {
  NOTIFICATION_TYPES,
  createNotification,
  notifyPostComment,
  notifyPostLike,
  notifyGroupPost,
  notifyForumReply,
  notifyPatientHubTask,
  getUserNotificationPreferences,
  updateUserNotificationPreferences,
};
