const express = require('express');
const { optionalAuth } = require('../utils/auth');
const { search, getSuggestedUsers } = require('../controllers/searchController');

const router = express.Router();

router.get('/', optionalAuth, search);
router.get('/suggested', optionalAuth, getSuggestedUsers);

module.exports = router;

