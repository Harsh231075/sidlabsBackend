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
  EVENT_REMINDER: 'event_reminder',
  PATIENT_HUB_TASK: 'patient_hub_task', // Cross-system notification
  FRIEND_REQUEST_RECEIVED: 'friend_request_received',
  FRIEND_REQUEST_ACCEPTED: 'friend_request_accepted',
  DISEASE_PAGE_POST: 'disease_page_post',
  NEW_MESSAGE: 'new_message',
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
 * Notify friend request received
 */
async function notifyFriendRequestReceived(fromUserId, toUserId) {
  return createNotification(
    toUserId,
    NOTIFICATION_TYPES.FRIEND_REQUEST_RECEIVED,
    'You received a new friend request',
    {
      entityId: fromUserId,
      entityType: 'user',
      metadata: { fromUserId }
    }
  );
}

/**
 * Notify friend request accepted
 */
async function notifyFriendRequestAccepted(fromUserId, toUserId) {
  return createNotification(
    toUserId,
    NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED,
    'Your friend request was accepted',
    {
      entityId: fromUserId,
      entityType: 'user',
      metadata: { fromUserId }
    }
  );
}

/**
 * Notify disease page post (Simplified: in real app, fetch followers of disease page)
 */
async function notifyDiseasePagePost(diseasePageId, postId, postAuthorId, diseaseName) {
  // NOTES: Usually we need a Follow model for disease pages. 
  // For now, let's assume we can fetch followers from somewhere or this is a stub.
  // We'll skip implementation if we don't have easy access to followers list here
  // But let's export the function stub.

  // Actually, we can implement if we pass followers array or fetch it?
  // Let's assume we pass followers or just log it for now as implementation depends on DiseasePage followers logic.
  // To keep it standard, let's assume the controller passes the followers IDs.
  return null;
}

/**
 * Notify new message (chat)
 */
async function notifyNewMessage(senderId, recipientId, conversationId, messageContent) {
  // Truncate message
  const preview = messageContent.length > 30 ? messageContent.substring(0, 30) + '...' : messageContent;

  return createNotification(
    recipientId,
    NOTIFICATION_TYPES.NEW_MESSAGE,
    `New message: ${preview}`,
    {
      entityId: conversationId,
      entityType: 'conversation',
      metadata: { senderId, messagePreview: preview }
    }
  );
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
  notifyFriendRequestReceived,
  notifyFriendRequestAccepted,
  notifyDiseasePagePost,
  notifyNewMessage,
  getUserNotificationPreferences,
  updateUserNotificationPreferences,
};
