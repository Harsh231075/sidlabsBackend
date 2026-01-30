const express = require('express');
const { authenticate } = require('../utils/auth');
const authController = require('../controllers/authController');

const router = express.Router();

// ============================================
// AWS Cognito Authentication
// ============================================

// Register new user (creates DB record after Cognito signup)
// Expected body: { cognitoSub, name, email, roleType, disease, caregiverRelationship, location, bio }
router.post('/register', authController.registerUser);

// Login via Cognito token (POST /api/auth/login)
router.post('/login', authController.cognitoLogin);

// Get current user profile
router.get('/me', authenticate, authController.getMe);

module.exports = router;
