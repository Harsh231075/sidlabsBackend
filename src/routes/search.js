const express = require('express');
const { optionalAuth } = require('../utils/auth');
const { search } = require('../controllers/searchController');

const router = express.Router();

router.get('/', optionalAuth, search);

module.exports = router;

