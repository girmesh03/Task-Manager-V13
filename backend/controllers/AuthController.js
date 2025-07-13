// backend/controllers/authController.js
import mongoose from "mongoose";
import asyncHandler from "express-async-handler";
import jwt from "jsonwebtoken";

import { User, Company, Department } from "../models/index.js";

import {
  generateAccessToken,
  generateRefreshToken,
  getAccessTokenCookieOptions,
  getRefreshTokenCookieOptions,
} from "../utils/generateTokens.js";

// @desc    Register a new company and associate department and admin user
// @route   POST /api/auth/register
// @access  Public
export const registerUser = asyncHandler(async (req, res, next) => {
  const { companyData, userData } = req.body;
  const { name, email, phone, address, size, industry, ...otherCompanyFields } =
    companyData;
  const {
    adminFirstName,
    adminLastName,
    adminPosition,
    departmentName,
    adminEmail,
    adminPassword,
    ...otherAdminFields
  } = userData;
});

//@desc    Authenticate user and get token
//@route   POST /api/auth/login
//@access  Public
export const loginUser = asyncHandler(async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Input validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
        error: "MISSING_CREDENTIALS",
      });
    }

    // Validate email format
    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
        error: "INVALID_EMAIL_FORMAT",
      });
    }

    // Find user with company and department details
    const user = await User.findOne({ email: email.toLowerCase() })
      .populate("company", "name isActive subscription.status")
      .populate("department", "name isActive")
      .select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        error: "INVALID_CREDENTIALS",
      });
    }

    // Verify password
    if (!(await user.matchPassword(password))) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        error: "INVALID_CREDENTIALS",
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: "User account is deactivated",
        error: "USER_DEACTIVATED",
      });
    }

    // Check if company is active
    if (!user.company.isActive) {
      return res.status(401).json({
        success: false,
        message: "Company account is deactivated",
        error: "COMPANY_DEACTIVATED",
      });
    }

    // Check company subscription status
    if (user.company.subscription.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Company subscription is not active",
        error: "SUBSCRIPTION_INACTIVE",
      });
    }

    // Check if department is active
    if (!user.department.isActive) {
      return res.status(401).json({
        success: false,
        message: "Department is deactivated",
        error: "DEPARTMENT_DEACTIVATED",
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // Update user's last login
    user.lastLogin = new Date();
    await user.save();

    // Set cookies
    res.cookie("access_token", accessToken, getAccessTokenCookieOptions());
    res.cookie("refresh_token", refreshToken, getRefreshTokenCookieOptions());

    // Remove sensitive data from response
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: user,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error during login",
      error: "LOGIN_ERROR",
    });
  }
});

//@desc    Logout user and clear cookies
//@route   POST /api/auth/logout
//@access  Private
export const logoutUser = asyncHandler(async (req, res, next) => {
  try {
    // Clear cookies
    res.clearCookie("access_token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    });

    res.clearCookie("refresh_token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/auth/refresh-token",
    });

    res.status(200).json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error during logout",
      error: "LOGOUT_ERROR",
    });
  }
});

//@desc    Get new access token using refresh token
//@route   POST /api/auth/refresh-token
//@access  Private
export const getRefreshToken = asyncHandler(async (req, res, next) => {
  try {
    // Extract refresh token from cookies
    const refreshToken = req.cookies?.refresh_token;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token is required",
        error: "MISSING_REFRESH_TOKEN",
      });
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (jwtError) {
      // Clear invalid refresh token cookie
      res.clearCookie("refresh_token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api/auth/refresh-token",
      });

      if (jwtError.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          message: "Refresh token has expired",
          error: "REFRESH_TOKEN_EXPIRED",
        });
      } else if (jwtError.name === "JsonWebTokenError") {
        return res.status(401).json({
          success: false,
          message: "Invalid refresh token",
          error: "INVALID_REFRESH_TOKEN",
        });
      } else {
        return res.status(401).json({
          success: false,
          message: "Refresh token verification failed",
          error: "REFRESH_TOKEN_VERIFICATION_FAILED",
        });
      }
    }

    // Fetch user data with company and department details
    const user = await User.findById(decoded.userId)
      .populate("company", "name isActive subscription.status")
      .populate("department", "name isActive")
      .select("-password");

    if (!user) {
      // Clear cookies if user not found
      res.clearCookie("refresh_token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api/auth/refresh-token",
      });

      return res.status(401).json({
        success: false,
        message: "User not found",
        error: "USER_NOT_FOUND",
      });
    }

    // Check if user verified their email
    if (!user.isVerified) {
      // Clear cookies if user is not verified
      res.clearCookie("refresh_token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api/auth/refresh-token",
      });

      return res.status(401).json({
        success: false,
        message: "User account is not verified",
        error: "USER_NOT_VERIFIED",
      });
    }

    // Check if user is active
    if (!user.isActive) {
      // Clear cookies if user is deactivated
      res.clearCookie("refresh_token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api/auth/refresh-token",
      });

      return res.status(401).json({
        success: false,
        message: "User account is deactivated",
        error: "USER_DEACTIVATED",
      });
    }

    // Check if company is active
    if (!user.company.isActive) {
      // Clear cookies if company is deactivated
      res.clearCookie("refreshToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api/auth/refresh-token",
      });

      return res.status(401).json({
        success: false,
        message: "Company account is deactivated",
        error: "COMPANY_DEACTIVATED",
      });
    }

    // Check company subscription status
    if (user.company.subscription.status !== "active") {
      // Clear cookies if company subscription is not active
      res.clearCookie("refresh_token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api/auth/refresh-token",
      });

      return res.status(403).json({
        success: false,
        message: "Company subscription is not active",
        error: "SUBSCRIPTION_INACTIVE",
      });
    }

    // Check if department is active
    if (!user.department.isActive) {
      // Clear cookies if department is deactivated
      res.clearCookie("refresh_token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api/auth/refresh-token",
      });

      return res.status(401).json({
        success: false,
        message: "Department is deactivated",
        error: "DEPARTMENT_DEACTIVATED",
      });
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(user._id);

    // Set new access token cookie
    res.cookie("access_token", newAccessToken, getAccessTokenCookieOptions());

    res.status(200).json({
      success: true,
      message: "Token refreshed successfully",
      data: user,
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error during token refresh",
      error: "TOKEN_REFRESH_ERROR",
    });
  }
});

//@desc    Get current user profile
//@route   GET /api/auth/me
//@access  Private
export const getCurrentUser = asyncHandler(async (req, res, next) => {
  try {
    // User data is already attached by verifyJWT middleware
    const user = req.user;

    res.status(200).json({
      success: true,
      message: "User profile retrieved successfully",
      data: user,
    });
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while retrieving user profile",
      error: "USER_PROFILE_ERROR",
    });
  }
});
