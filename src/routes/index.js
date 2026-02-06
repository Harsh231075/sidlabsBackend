const express = require('express');
const usersRouter = require('./users');
const postsRouter = require('./posts');
const authRouter = require('./auth');
const groupsRouter = require('./groups');
const conversationsRouter = require('./conversations');
const adminRouter = require('./admin');
const forumsRouter = require('./forums');
const diseasePagesRouter = require('./diseasePages');
const searchRouter = require('./search');
const notificationsRouter = require('./notifications');
const eventsRouter = require('./events');
const gamificationRouter = require('./gamification');
const moderationRouter = require('./moderation');
const profileRouter = require('./profile');
const friendsRouter = require('./friends');

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
