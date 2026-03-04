const express = require('express');
const { authenticate } = require('../../utils/auth');
const ctrl = require('./search.controller');

const router = express.Router();

router.get('/', authenticate, ctrl.search);
router.get('/suggested', authenticate, ctrl.getSuggestedUsers);

module.exports = router;
