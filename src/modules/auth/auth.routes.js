const express = require('express');
const { authenticate } = require('../../utils/auth');
const authController = require('./auth.controller');

const router = express.Router();

router.post('/register', authController.registerUser);
router.post('/login', authController.cognitoLogin);
router.post('/login/challenge', authController.respondToAuthChallenge);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.get('/me', authenticate, authController.getMe);
router.get('/user', authController.getUser);
router.post('/logout', authController.logout);

module.exports = router;
