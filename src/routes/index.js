const express = require('express');

// ─── Module-based imports ───────────────────────────────────────────
const authRouter = require('../modules/auth');
const usersRouter = require('../modules/users');
const postsRouter = require('../modules/posts');
const groupsRouter = require('../modules/groups');
const conversationsRouter = require('../modules/conversations');
const adminRouter = require('../modules/admin');
const forumsRouter = require('../modules/forums');
const diseasePagesRouter = require('../modules/diseasePages');
const searchRouter = require('../modules/search');
const notificationsRouter = require('../modules/notifications');
const eventsRouter = require('../modules/events');
const gamificationRouter = require('../modules/gamification');
const moderationRouter = require('../modules/moderation');
const profileRouter = require('../modules/profile');
const friendsRouter = require('../modules/friends');

const router = express.Router();

router.get('/ping', (req, res) => {
  res.json({ message: 'Server is running' });
});

router.use('/auth', authRouter);
router.use('/users', usersRouter);
router.use('/posts', postsRouter);
router.use('/groups', groupsRouter);
router.use('/conversations', conversationsRouter);
router.use('/admin', adminRouter);
router.use('/forums', forumsRouter);
router.use('/disease-pages', diseasePagesRouter);
router.use('/search', searchRouter);
router.use('/notifications', notificationsRouter);
router.use('/events', eventsRouter);
router.use('/gamification', gamificationRouter);
router.use('/moderation', moderationRouter);
router.use('/profile', profileRouter);
router.use('/friends', friendsRouter);

module.exports = router;
