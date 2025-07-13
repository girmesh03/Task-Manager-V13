// backend/routes/authRoutes.js
import express from "express";

import {
  registerUser,
  loginUser,
  logoutUser,
  getRefreshToken,
  getCurrentUser,
} from "../controllers/AuthController.js";

import { verifyJWT } from "../middlewares/authMiddleware.js";
import authLimiter from "../middlewares/rateLimiter.js";

const router = express.Router();

// @route   POST /api/auth/register
// @desc    Register company and assign department and user as super admin
// @access  Public
router.post("/register", authLimiter, registerUser);

// @route   POST /api/auth/login
// @desc    Authenticate user and get token
// @access  Public
router.post("/login", authLimiter, loginUser);

// @route   DELETE /api/auth/logout
// @desc    Logout user
// @access  Private
router.delete("/logout", verifyJWT, logoutUser);

// @route   GET /api/auth/refresh-token
// @desc    Refresh user token
// @access  Private
router.get("/refresh-token", verifyJWT, getRefreshToken);

// @route   GET /api/auth/me
// @desc    Get current user profile
// @access  Private
router.get("/me", verifyJWT, getCurrentUser);

export default router;
