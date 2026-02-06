/**
 * Reset + Seed Demo Data (non-User collections)
 *
 * Goal:
 * - Remove old demo/JSON artifacts (incl. Gamification entries that cause "Unknown User")
 * - Seed realistic, English-only content tied to the 3 base Cognito users
 *
 * IMPORTANT:
 * - This script does NOT delete users.
 * - Ensure you ran scripts/resetAndSeedCognito.js at least once (or already have these users):
 *   admin@winsights.life, moderator@winsights.life, sarah@winsights.life
 *
 * Run:
 *   node scripts/resetAndSeedDemoData.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connectDB = require('../src/db/index');

// Models
const User = require('../src/models/User');
const Post = require('../src/models/Post');
const Comment = require('../src/models/Comment');
const Group = require('../src/models/Group');
const Conversation = require('../src/models/Conversation');
const Message = require('../src/models/Message');
const Notification = require('../src/models/Notification');
const Badge = require('../src/models/Badge');
const BadgeDefinition = require('../src/models/BadgeDefinition');
const Event = require('../src/models/Event');
const DiseasePage = require('../src/models/DiseasePage');
const DiseaseFollower = require('../src/models/DiseaseFollower');
const ForumThread = require('../src/models/ForumThread');
const ForumPost = require('../src/models/ForumPost');
const Gamification = require('../src/models/Gamification');
const BlockedUser = require('../src/models/BlockedUser');
const NotificationPreference = require('../src/models/NotificationPreference');

function mustGetUserByEmail(usersByEmail, email) {
  const u = usersByEmail.get(String(email).trim().toLowerCase());
  if (!u) {
    throw new Error(
      `Missing required user: ${email}. Run scripts/resetAndSeedCognito.js first (or seed the base users).`
    );
  }
  return u;
}

function dayOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

async function resetCollections() {
  const collections = [
    Gamification,
    Badge,
    BadgeDefinition,
    Notification,
    NotificationPreference,
    Message,
    Conversation,
    ForumPost,
    ForumThread,
    Comment,
    Post,
    DiseaseFollower,
    Event,
    Group,
    DiseasePage,
    BlockedUser,
  ];

  for (const Model of collections) {
    const res = await Model.deleteMany({});
    console.log(`🧹 Cleared ${Model.modelName}: ${res.deletedCount}`);
  }
}

async function seedDemoData() {
  await connectDB();
  console.log('✅ Connected to MongoDB');

  const baseUsers = await User.find({
    email: {
      $in: ['admin@winsights.life', 'moderator@winsights.life', 'sarah@winsights.life'],
    },
  });
  const usersByEmail = new Map(baseUsers.map((u) => [String(u.email).toLowerCase(), u]));

  const admin = mustGetUserByEmail(usersByEmail, 'admin@winsights.life');
  const moderator = mustGetUserByEmail(usersByEmail, 'moderator@winsights.life');
  const sarah = mustGetUserByEmail(usersByEmail, 'sarah@winsights.life');

  console.log(`👤 Using users: ${admin._id}, ${moderator._id}, ${sarah._id}`);

  console.log('\n🗑️  Resetting non-user collections...');
  await resetCollections();

  const now = new Date();

  console.log('\n🌿 Seeding disease pages...');
  const diseases = [
    {
      _id: 'dpage-cystic-fibrosis',
      name: 'Cystic Fibrosis',
      slug: 'cystic-fibrosis',
      description:
        'A genetic condition that affects the lungs and digestive system by producing thick, sticky mucus. Management often involves airway clearance, nutrition support, and targeted therapies.',
      codes: { orphaCode: '586', omim: '219700', icd10: 'E84', snomed: '190905008' },
    },
    {
      _id: 'dpage-type-1-diabetes',
      name: 'Type 1 Diabetes',
      slug: 'type-1-diabetes',
      description:
        'An autoimmune condition where the body stops making insulin. Day-to-day care includes insulin dosing, glucose monitoring, and planning meals and activity.',
      codes: { orphaCode: '', omim: '', icd10: 'E10', snomed: '46635009' },
    },
    {
      _id: 'dpage-multiple-sclerosis',
      name: 'Multiple Sclerosis',
      slug: 'multiple-sclerosis',
      description:
        'A chronic disease of the central nervous system that can affect movement, sensation, vision, and fatigue. Symptoms and progression vary widely between people.',
      codes: { orphaCode: '', omim: '', icd10: 'G35', snomed: '24700007' },
    },
    {
      _id: 'dpage-parkinsons-disease',
      name: "Parkinson's Disease",
      slug: 'parkinsons-disease',
      description:
        'A progressive neurological disorder affecting movement. Common symptoms include tremor, stiffness, and slowed movement. Treatment may include medication and therapies.',
      codes: { orphaCode: '', omim: '', icd10: 'G20', snomed: '49049000' },
    },
    {
      _id: 'dpage-systemic-lupus-erythematosus',
      name: 'Systemic Lupus Erythematosus (SLE)',
      slug: 'systemic-lupus-erythematosus',
      description:
        'An autoimmune disease that can affect skin, joints, kidneys, and more. Many people manage flares with medication, sun protection, and careful monitoring.',
      codes: { orphaCode: '', omim: '', icd10: 'M32', snomed: '55464009' },
    },
    {
      _id: 'dpage-crohns-disease',
      name: "Crohn's Disease",
      slug: 'crohns-disease',
      description:
        'A type of inflammatory bowel disease that can affect any part of the digestive tract. Symptoms may include abdominal pain, diarrhea, and fatigue.',
      codes: { orphaCode: '', omim: '', icd10: 'K50', snomed: '34000006' },
    },
    {
      _id: 'dpage-celiac-disease',
      name: 'Celiac Disease',
      slug: 'celiac-disease',
      description:
        'An immune reaction to gluten that damages the small intestine. A strict gluten-free diet is the cornerstone of treatment.',
      codes: { orphaCode: '', omim: '', icd10: 'K90.0', snomed: '396331005' },
    },
    {
      _id: 'dpage-sickle-cell-disease',
      name: 'Sickle Cell Disease',
      slug: 'sickle-cell-disease',
      description:
        'A group of inherited red blood cell disorders. People may experience pain crises, anemia, and increased risk of infection.',
      codes: { orphaCode: '', omim: '', icd10: 'D57', snomed: '127040003' },
    },
  ];

  await DiseasePage.insertMany(
    diseases.map((d) => ({
      ...d,
      heroImageUrl: '',
      iconUrl: '',
      editors: [admin._id, moderator._id],
      linkedGroupIds: [],
      featuredPostIds: [],
      resourceLinks: [
        'https://www.cdc.gov/',
        'https://www.who.int/',
        'https://medlineplus.gov/',
      ],
      createdAt: now,
      updatedAt: now,
    }))
  );

  console.log('\n👥 Seeding groups...');
  const groups = [
    {
      _id: 'grp-cf-support',
      name: 'CF Support Circle',
      description: 'A welcoming space to share coping strategies, airway clearance tips, and day-to-day wins.',
      privacy: 'public',
      ownerId: moderator._id,
      adminIds: [admin._id, moderator._id],
      members: [admin._id, moderator._id, sarah._id],
      diseaseTag: 'cystic-fibrosis',
    },
    {
      _id: 'grp-t1d-daily',
      name: 'Type 1 Diabetes Daily',
      description: 'Talk carb counting, CGM patterns, insulin timing, exercise, and practical routines.',
      privacy: 'public',
      ownerId: admin._id,
      adminIds: [admin._id, moderator._id],
      members: [admin._id, moderator._id, sarah._id],
      diseaseTag: 'type-1-diabetes',
    },
    {
      _id: 'grp-ms-community',
      name: 'MS Community',
      description: 'Community support around fatigue management, mobility, treatment decisions, and mental health.',
      privacy: 'public',
      ownerId: moderator._id,
      adminIds: [moderator._id],
      members: [admin._id, moderator._id, sarah._id],
      diseaseTag: 'multiple-sclerosis',
    },
    {
      _id: 'grp-lupus-lounge',
      name: 'Lupus Lounge',
      description: 'Discuss flares, labs, appointments, and day-to-day self-care. Kindness-first rules.',
      privacy: 'public',
      ownerId: admin._id,
      adminIds: [admin._id, moderator._id],
      members: [admin._id, moderator._id, sarah._id],
      diseaseTag: 'systemic-lupus-erythematosus',
    },
  ].map((g) => ({
    ...g,
    memberCount: g.members.length,
    createdAt: now,
  }));

  await Group.insertMany(groups);

  // Link groups back to disease pages
  const diseaseToGroupIds = new Map();
  for (const g of groups) {
    if (!g.diseaseTag) continue;
    const arr = diseaseToGroupIds.get(g.diseaseTag) || [];
    arr.push(g._id);
    diseaseToGroupIds.set(g.diseaseTag, arr);
  }
  for (const [slug, groupIds] of diseaseToGroupIds.entries()) {
    await DiseasePage.updateOne({ slug }, { $set: { linkedGroupIds: groupIds, updatedAt: now } });
  }

  console.log('\n📝 Seeding posts...');
  const postTemplates = [
    {
      authorId: sarah._id,
      groupId: 'grp-cf-support',
      content:
        "Today I finally found a routine that makes airway clearance feel less overwhelming. Small win: 10 minutes at a time, twice a day, and I track it like brushing my teeth.",
      likes: [moderator._id],
    },
    {
      authorId: moderator._id,
      groupId: 'grp-cf-support',
      content:
        'Reminder: If you share medical advice, please include that it is personal experience and encourage people to consult their care team. We keep this space supportive and safe.',
      likes: [admin._id],
    },
    {
      authorId: sarah._id,
      groupId: 'grp-t1d-daily',
      content:
        "Question: For morning workouts, do you pre-bolus and snack after, or adjust basal? I'm seeing a dip around minute 20 even with a small snack.",
      likes: [moderator._id, admin._id],
    },
    {
      authorId: admin._id,
      groupId: 'grp-t1d-daily',
      content:
        'Tip thread: share one habit that improved your CGM trends this month (sleep, hydration, timing, stress management, anything).',
      likes: [sarah._id, moderator._id],
    },
    {
      authorId: sarah._id,
      groupId: 'grp-ms-community',
      content:
        'Fatigue has been the hardest symptom to explain. What has helped you advocate for yourself at work or school without feeling guilty?',
      likes: [moderator._id],
    },
    {
      authorId: moderator._id,
      groupId: 'grp-ms-community',
      content:
        'If you are comfortable sharing: what is one accommodation that made a big difference for you (remote days, flexible hours, mobility aids, etc.)?',
      likes: [sarah._id],
    },
    {
      authorId: sarah._id,
      groupId: 'grp-lupus-lounge',
      content:
        'Has anyone found a good way to track flares and triggers without obsessing? I want data for appointments but not anxiety.',
      likes: [admin._id],
    },
    {
      authorId: admin._id,
      groupId: 'grp-lupus-lounge',
      content:
        'Friendly reminder: sun protection matters for many people with autoimmune conditions. Share your favorite sunscreen or clothing hacks.',
      likes: [sarah._id, moderator._id],
    },
    {
      authorId: sarah._id,
      groupId: null,
      content:
        "I'm new here. I love that this app has both disease pages and group chats—feels less lonely already.",
      likes: [admin._id, moderator._id],
    },
    {
      authorId: moderator._id,
      groupId: null,
      content:
        'Welcome post: Introduce yourself with your name, what you hope to find here, and one small thing that brought you comfort this week.',
      likes: [sarah._id],
    },
  ];

  // Expand to more posts by remixing templates
  const posts = [];
  for (let i = 0; i < 24; i++) {
    const base = postTemplates[i % postTemplates.length];
    const createdAt = dayOffset(-(24 - i));
    posts.push({
      _id: `post-${String(i + 1).padStart(3, '0')}`,
      authorId: base.authorId,
      content: base.content,
      mediaUrl: '',
      createdAt,
      updatedAt: createdAt,
      likes: base.likes || [],
      reported: false,
      reports: [],
      removed: false,
      removedBy: null,
      removedAt: null,
      moderation: { status: 'clean', scannedAt: createdAt },
      moderationStatus: 'clean',
      visible: true,
      groupId: base.groupId,
    });
  }

  await Post.insertMany(posts);

  console.log('\n💬 Seeding comments...');
  const comments = [
    {
      _id: 'cmt-001',
      postId: 'post-001',
      authorId: moderator._id,
      content: 'That routine sounds really sustainable. Celebrating that win with you.',
      parentCommentId: null,
      createdAt: dayOffset(-6),
      removed: false,
      moderation: { status: 'clean' },
      visible: true,
    },
    {
      _id: 'cmt-002',
      postId: 'post-001',
      authorId: sarah._id,
      content: 'Thank you! I needed the encouragement today.',
      parentCommentId: 'cmt-001',
      createdAt: dayOffset(-6),
      removed: false,
      moderation: { status: 'clean' },
      visible: true,
    },
    {
      _id: 'cmt-003',
      postId: 'post-004',
      authorId: sarah._id,
      content:
        'For me: a 10-minute walk after lunch consistently helps. Not perfect, but it makes afternoons easier.',
      parentCommentId: null,
      createdAt: dayOffset(-4),
      removed: false,
      moderation: { status: 'clean' },
      visible: true,
    },
    {
      _id: 'cmt-004',
      postId: 'post-010',
      authorId: admin._id,
      content: 'Welcome! Glad you are here. Let us know what features would help you most.',
      parentCommentId: null,
      createdAt: dayOffset(-1),
      removed: false,
      moderation: { status: 'clean' },
      visible: true,
    },
  ];
  await Comment.insertMany(comments);

  console.log('\n🧵 Seeding forum threads + posts...');
  const threads = [
    {
      _id: 'thread-001',
      title: 'How do you prepare for specialist appointments?',
      creatorId: sarah._id,
      groupId: null,
      createdAt: dayOffset(-10),
      updatedAt: dayOffset(-10),
      removed: false,
    },
    {
      _id: 'thread-002',
      title: 'Share your go-to fatigue management strategies',
      creatorId: moderator._id,
      groupId: 'grp-ms-community',
      createdAt: dayOffset(-9),
      updatedAt: dayOffset(-8),
      removed: false,
    },
    {
      _id: 'thread-003',
      title: 'Beginner resources for Type 1 Diabetes (newly diagnosed)',
      creatorId: admin._id,
      groupId: 'grp-t1d-daily',
      createdAt: dayOffset(-8),
      updatedAt: dayOffset(-7),
      removed: false,
    },
  ];
  await ForumThread.insertMany(
    threads.map((t) => ({
      ...t,
      removedBy: null,
      removedAt: null,
    }))
  );

  const forumPosts = [
    {
      _id: 'fpost-001',
      threadId: 'thread-001',
      authorId: moderator._id,
      content:
        'I keep a one-page template: symptoms, timeline, questions, meds, and what I want to decide today. It helps me stay calm and focused.',
      repliedToUserId: sarah._id,
      createdAt: dayOffset(-10),
      updatedAt: dayOffset(-10),
    },
    {
      _id: 'fpost-002',
      threadId: 'thread-001',
      authorId: admin._id,
      content:
        'Bringing a friend/family member on speakerphone can help. Also, ask for a written summary or after-visit notes when possible.',
      repliedToUserId: null,
      createdAt: dayOffset(-9),
      updatedAt: dayOffset(-9),
    },
    {
      _id: 'fpost-003',
      threadId: 'thread-002',
      authorId: sarah._id,
      content:
        'A timer + short breaks helps. I try to avoid pushing through until I crash. Still learning to accept that rest is part of treatment.',
      repliedToUserId: null,
      createdAt: dayOffset(-8),
      updatedAt: dayOffset(-8),
    },
    {
      _id: 'fpost-004',
      threadId: 'thread-003',
      authorId: moderator._id,
      content:
        'If you are newly diagnosed: keep it simple at first—learn patterns, not perfection. CGM trends over time matter more than any single number.',
      repliedToUserId: null,
      createdAt: dayOffset(-7),
      updatedAt: dayOffset(-7),
    },
  ].map((p) => ({
    ...p,
    removed: false,
    removedAt: null,
    moderation: { status: 'clean' },
  }));
  await ForumPost.insertMany(forumPosts);

  console.log('\n💌 Seeding conversations + messages...');
  const conversations = [
    {
      _id: 'conv-sarah-moderator',
      participantIds: [sarah._id, moderator._id],
      isGroup: false,
      name: null,
      createdBy: moderator._id,
      createdAt: dayOffset(-5),
      updatedAt: dayOffset(-1),
    },
    {
      _id: 'conv-community-admin-mod-sarah',
      participantIds: [admin._id, moderator._id, sarah._id],
      isGroup: true,
      name: 'Community Support',
      createdBy: admin._id,
      createdAt: dayOffset(-3),
      updatedAt: dayOffset(-1),
    },
  ];
  await Conversation.insertMany(conversations);

  const messages = [
    {
      _id: 'msg-001',
      convId: 'conv-sarah-moderator',
      senderId: moderator._id,
      text: 'Hi Sarah — welcome. If you need help finding the right group, I can point you to a few.',
      createdAt: dayOffset(-5),
    },
    {
      _id: 'msg-002',
      convId: 'conv-sarah-moderator',
      senderId: sarah._id,
      text: 'Thank you! I joined CF Support Circle. Everyone seems kind.',
      createdAt: dayOffset(-5),
    },
    {
      _id: 'msg-003',
      convId: 'conv-community-admin-mod-sarah',
      senderId: admin._id,
      text: 'Welcome to Winsights. We are glad you are here.',
      createdAt: dayOffset(-3),
    },
    {
      _id: 'msg-004',
      convId: 'conv-community-admin-mod-sarah',
      senderId: moderator._id,
      text: 'Feel free to ask anything. Our goal is supportive, respectful conversations.',
      createdAt: dayOffset(-3),
    },
    {
      _id: 'msg-005',
      convId: 'conv-community-admin-mod-sarah',
      senderId: sarah._id,
      text: 'Appreciate it. I will start with reading a few disease pages.',
      createdAt: dayOffset(-2),
    },
  ].map((m) => ({
    ...m,
    mediaUrl: '',
    moderation: { status: 'clean' },
    visible: true,
  }));
  await Message.insertMany(messages);

  console.log('\n📅 Seeding events...');
  const events = [
    {
      _id: 'evt-001',
      title: 'Living Well with Chronic Illness: Practical Routines',
      description:
        'A community session on pacing, planning, and building routines that reduce burnout. Not medical advice—peer discussion and general education.',
      eventDate: '2026-02-15',
      eventTime: '16:00',
      location: 'Online',
      eventType: 'virtual',
      registrationUrl: 'https://example.com/register',
      diseasePageSlug: null,
      maxAttendees: 250,
      attendees: [sarah._id],
      createdBy: moderator._id,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: 'evt-002',
      title: 'Ask-Me-Anything: Navigating Labs and Appointments',
      description:
        'Bring questions about organizing labs, symptom timelines, and communicating with your care team. General guidance only.',
      eventDate: '2026-03-01',
      eventTime: '18:30',
      location: 'Online',
      eventType: 'virtual',
      registrationUrl: 'https://example.com/ama',
      diseasePageSlug: 'systemic-lupus-erythematosus',
      maxAttendees: 200,
      attendees: [admin._id, sarah._id],
      createdBy: admin._id,
      createdAt: now,
      updatedAt: now,
    },
  ];
  await Event.insertMany(events);

  console.log('\n⭐ Seeding disease followers...');
  const followers = [
    {
      _id: `df-${sarah._id}-cystic-fibrosis`,
      diseasePageSlug: 'cystic-fibrosis',
      userId: sarah._id,
      followedAt: dayOffset(-7),
    },
    {
      _id: `df-${sarah._id}-type-1-diabetes`,
      diseasePageSlug: 'type-1-diabetes',
      userId: sarah._id,
      followedAt: dayOffset(-4),
    },
    {
      _id: `df-${moderator._id}-multiple-sclerosis`,
      diseasePageSlug: 'multiple-sclerosis',
      userId: moderator._id,
      followedAt: dayOffset(-10),
    },
  ];
  await DiseaseFollower.insertMany(followers);

  console.log('\n🏅 Seeding badges + definitions...');
  const badgeDefs = [
    {
      badgeId: 'first-post',
      name: 'First Post',
      description: 'Created your first post in the community.',
      criteria: { actionType: 'post_created', threshold: 1 },
      imageUrl: 'https://example.com/badges/first-post.png',
      tokenReward: 25,
      isNFT: false,
      createdAt: now,
    },
    {
      badgeId: 'helpful-comment',
      name: 'Helpful Comment',
      description: 'Left supportive comments for others.',
      criteria: { actionType: 'comment_created', threshold: 3 },
      imageUrl: 'https://example.com/badges/helpful-comment.png',
      tokenReward: 40,
      isNFT: false,
      createdAt: now,
    },
    {
      badgeId: 'community-builder',
      name: 'Community Builder',
      description: 'Helped grow engagement and healthy discussion.',
      criteria: { actionType: 'group_post', threshold: 5 },
      imageUrl: 'https://example.com/badges/community-builder.png',
      tokenReward: 60,
      isNFT: false,
      createdAt: now,
    },
  ];
  await BadgeDefinition.insertMany(badgeDefs);

  const badges = [
    {
      _id: 'badge-001',
      userId: sarah._id,
      type: 'first-post',
      name: 'First Post',
      awardedAt: dayOffset(-2),
    },
    {
      _id: 'badge-002',
      userId: moderator._id,
      type: 'helpful-comment',
      name: 'Helpful Comment',
      awardedAt: dayOffset(-1),
    },
  ];
  await Badge.insertMany(badges);

  console.log('\n🪙 Seeding gamification (leaderboard will be clean)...');
  const gamification = [
    {
      userId: admin._id,
      totalTokens: 420,
      tokenHistory: [
        {
          id: 'tok-admin-001',
          action: 'seed',
          tokens: 420,
          timestamp: now,
          metadata: { note: 'Initial demo balance' },
        },
      ],
      badges: [],
      actionCounts: { post_created: 5, comment_created: 2, moderation_actions: 3 },
      createdAt: now,
      updatedAt: now,
    },
    {
      userId: moderator._id,
      totalTokens: 610,
      tokenHistory: [
        {
          id: 'tok-mod-001',
          action: 'seed',
          tokens: 610,
          timestamp: now,
          metadata: { note: 'Initial demo balance' },
        },
      ],
      badges: [
        {
          badgeId: 'helpful-comment',
          minted: false,
          mintedAt: null,
          nftTokenId: null,
          nftContractAddress: null,
        },
      ],
      actionCounts: { post_created: 6, comment_created: 9, moderation_actions: 12 },
      createdAt: now,
      updatedAt: now,
    },
    {
      userId: sarah._id,
      totalTokens: 350,
      tokenHistory: [
        {
          id: 'tok-sarah-001',
          action: 'seed',
          tokens: 350,
          timestamp: now,
          metadata: { note: 'Initial demo balance' },
        },
      ],
      badges: [
        {
          badgeId: 'first-post',
          minted: false,
          mintedAt: null,
          nftTokenId: null,
          nftContractAddress: null,
        },
      ],
      actionCounts: { post_created: 8, comment_created: 3 },
      createdAt: now,
      updatedAt: now,
    },
  ];
  await Gamification.insertMany(gamification);

  console.log('\n🔔 Seeding notification preferences + notifications...');
  const prefs = [
    {
      userId: admin._id,
      emailComments: true,
      emailLikes: true,
      emailGroupPosts: true,
      emailForumReplies: true,
      emailEventReminders: true,
      emailPatientHubTasks: true,
    },
    {
      userId: moderator._id,
      emailComments: true,
      emailLikes: true,
      emailGroupPosts: true,
      emailForumReplies: true,
      emailEventReminders: true,
      emailPatientHubTasks: true,
    },
    {
      userId: sarah._id,
      emailComments: true,
      emailLikes: true,
      emailGroupPosts: true,
      emailForumReplies: true,
      emailEventReminders: true,
      emailPatientHubTasks: true,
    },
  ];
  await NotificationPreference.insertMany(prefs);

  const notifications = [
    {
      _id: 'notif-001',
      userId: sarah._id,
      type: 'welcome',
      message: 'Welcome to Winsights. Explore disease pages and join groups for support.',
      entityId: null,
      entityType: null,
      read: false,
      createdAt: dayOffset(-2),
      metadata: { source: 'seed' },
    },
    {
      _id: 'notif-002',
      userId: sarah._id,
      type: 'like',
      message: 'Your post got a like in CF Support Circle.',
      entityId: 'post-001',
      entityType: 'post',
      read: false,
      createdAt: dayOffset(-1),
      metadata: { likedBy: moderator._id },
    },
    {
      _id: 'notif-003',
      userId: moderator._id,
      type: 'event',
      message: 'New event scheduled: Living Well with Chronic Illness.',
      entityId: 'evt-001',
      entityType: 'event',
      read: true,
      createdAt: dayOffset(-3),
      metadata: {},
    },
  ];
  await Notification.insertMany(notifications);

  // Feature a few posts on disease pages
  await DiseasePage.updateOne(
    { slug: 'cystic-fibrosis' },
    { $set: { featuredPostIds: ['post-001', 'post-002'], updatedAt: now } }
  );
  await DiseasePage.updateOne(
    { slug: 'type-1-diabetes' },
    { $set: { featuredPostIds: ['post-003', 'post-004'], updatedAt: now } }
  );

  console.log('\n✅ Demo data seeded successfully.');
  console.log('💡 Leaderboard should no longer show "Unknown User" after this reset.');
}

seedDemoData()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err?.message || err);
    process.exit(1);
  });
