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

// First-login flow for manually-created users (NEW_PASSWORD_REQUIRED)
router.post('/login/challenge', authController.respondToAuthChallenge);

// Get current user profile
router.get('/me', authenticate, authController.getMe);

router.get('/user', authController.getUser);

router.post('/logout', authController.logout);

module.exports = router;
