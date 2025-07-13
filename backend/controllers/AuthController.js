// backend/controllers/authController.js
import mongoose from "mongoose";
import asyncHandler from "express-async-handler";
import jwt from "jsonwebtoken";

import { User, Company, Department } from "../models/index.js";
import CustomError from "../errorHandler/CustomError.js";

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
  // --- PHASE 1: INPUT VALIDATION ---

  // 1. Payload validation
  const { companyData, userData } = req.body;

  if (!companyData || !userData) {
    return next(
      new CustomError(
        "Company data and user data are required",
        400,
        "MISSING_REQUIRED_DATA"
      )
    );
  }

  // 2. Extract and validate required fields
  const { name, email, phone, address, size, industry } = companyData;
  const {
    adminFirstName,
    adminLastName,
    departmentName,
    adminEmail,
    adminPassword,
  } = userData;

  // Required field validation
  const requiredFields = {
    "Company name": name,
    "Company email": email,
    "Company phone": phone,
    "Company address": address,
    "Admin first name": adminFirstName,
    "Admin last name": adminLastName,
    "Department name": departmentName,
    "Admin email": adminEmail,
    "Admin password": adminPassword,
  };

  const missingFields = Object.entries(requiredFields)
    .filter(
      ([key, value]) => !value || (typeof value === "string" && !value.trim())
    )
    .map(([key]) => key);

  if (missingFields.length > 0) {
    return next(
      new CustomError(
        `Missing required fields: ${missingFields.join(", ")}`,
        400,
        "MISSING_REQUIRED_FIELDS"
      )
    );
  }

  // 3. Data format validation
  const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
  const phoneRegex = /^(09\d{8}|\+2519\d{8})$/;

  if (!emailRegex.test(email.trim())) {
    return next(
      new CustomError(
        "Invalid company email format",
        400,
        "INVALID_EMAIL_FORMAT"
      )
    );
  }

  if (!emailRegex.test(adminEmail.trim())) {
    return next(
      new CustomError("Invalid admin email format", 400, "INVALID_EMAIL_FORMAT")
    );
  }

  if (!phoneRegex.test(phone.trim())) {
    return next(
      new CustomError(
        "Invalid phone number format for Ethiopia",
        400,
        "INVALID_PHONE_FORMAT"
      )
    );
  }

  if (adminPassword.length < 6) {
    return next(
      new CustomError(
        "Password must be at least 6 characters long",
        400,
        "INVALID_PASSWORD_LENGTH"
      )
    );
  }

  // 4. Length validation
  if (name.trim().length < 2 || name.trim().length > 100) {
    return next(
      new CustomError(
        "Company name must be between 2 and 100 characters",
        400,
        "INVALID_COMPANY_NAME_LENGTH"
      )
    );
  }

  if (departmentName.trim().length < 2 || departmentName.trim().length > 50) {
    return next(
      new CustomError(
        "Department name must be between 2 and 50 characters",
        400,
        "INVALID_DEPARTMENT_NAME_LENGTH"
      )
    );
  }

  if (adminFirstName.trim().length < 2 || adminFirstName.trim().length > 30) {
    return next(
      new CustomError(
        "First name must be between 2 and 30 characters",
        400,
        "INVALID_FIRST_NAME_LENGTH"
      )
    );
  }

  if (adminLastName.trim().length < 2 || adminLastName.trim().length > 30) {
    return next(
      new CustomError(
        "Last name must be between 2 and 30 characters",
        400,
        "INVALID_LAST_NAME_LENGTH"
      )
    );
  }

  // 5. Security validation - prevent role injection
  if (userData.role) {
    return next(
      new CustomError(
        "Role cannot be set during registration",
        400,
        "ROLE_NOT_ALLOWED"
      )
    );
  }

  // Validate enum values if provided
  const validSizes = [
    "1-10 Employees",
    "11-50 Employees",
    "51-200 Employees",
    "201-500 Employees",
    "500+ Employees",
  ];
  const validIndustries = [
    "Hospitality",
    "Technology",
    "Healthcare",
    "Finance",
    "Education",
    "Retail",
    "Manufacturing",
    "Consulting",
    "Other",
  ];

  if (size && !validSizes.includes(size)) {
    return next(
      new CustomError("Invalid company size", 400, "INVALID_COMPANY_SIZE")
    );
  }

  if (industry && !validIndustries.includes(industry)) {
    return next(
      new CustomError("Invalid industry type", 400, "INVALID_INDUSTRY_TYPE")
    );
  }

  // --- PHASE 2: UNIQUENESS VALIDATION ---

  // 6. Check uniqueness before transaction
  const [
    existingCompanyByName,
    existingCompanyByEmail,
    existingCompanyByPhone,
    existingUser,
  ] = await Promise.all([
    Company.findOne({ name: name.trim() }).lean(),
    Company.findOne({ email: email.toLowerCase().trim() }).lean(),
    Company.findOne({ phone: phone.trim() }).lean(),
    User.findOne({ email: adminEmail.toLowerCase().trim() }).lean(),
  ]);

  if (existingCompanyByName) {
    return next(
      new CustomError("Company name already exists", 409, "COMPANY_NAME_EXISTS")
    );
  }

  if (existingCompanyByEmail) {
    return next(
      new CustomError(
        "Company email already exists",
        409,
        "COMPANY_EMAIL_EXISTS"
      )
    );
  }

  if (existingCompanyByPhone) {
    return next(
      new CustomError(
        "Company phone number already exists",
        409,
        "COMPANY_PHONE_EXISTS"
      )
    );
  }

  if (existingUser) {
    return next(
      new CustomError("Admin email already exists", 409, "USER_EMAIL_EXISTS")
    );
  }

  // --- PHASE 3: TRANSACTIONAL CREATION ---

  const session = await mongoose.startSession();

  try {
    // 7. Start transaction
    session.startTransaction();

    // 8. Create company
    const company = new Company({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      address: address.trim(),
      size: size || "1-10 Employees",
      industry: industry || "Hospitality",
    });
    await company.save({ session });

    // 9. Check department name uniqueness within company (race condition protection)
    const existingDepartment = await Department.findOne({
      name: departmentName.trim(),
      company: company._id,
    }).session(session);

    if (existingDepartment) {
      throw new CustomError(
        "Department name already exists in this company",
        409,
        "DEPARTMENT_NAME_EXISTS"
      );
    }

    // 10. Create department
    const department = new Department({
      name: departmentName.trim(),
      company: company._id,
      managers: [], // Will be updated after user creation
    });
    await department.save({ session });

    // 11. Create admin user
    const adminUser = new User({
      firstName: adminFirstName.trim(),
      lastName: adminLastName.trim(),
      email: adminEmail.toLowerCase().trim(),
      password: adminPassword,
      role: "SuperAdmin",
      company: company._id,
      department: department._id,
      isVerified: true, // Auto-verify first user
    });
    await adminUser.save({ session });

    // 12. Update department with manager
    department.managers = [adminUser._id];
    await department.save({ session });

    // 13. Commit transaction
    await session.commitTransaction();

    // 14. Generate tokens
    const accessToken = generateAccessToken(adminUser._id);
    const refreshToken = generateRefreshToken(adminUser._id);

    // 15. Set cookies
    res.cookie("access_token", accessToken, getAccessTokenCookieOptions());
    res.cookie("refresh_token", refreshToken, getRefreshTokenCookieOptions());

    // 16. Populate user data for response
    const populatedUser = await User.findById(adminUser._id)
      .populate("company", "name")
      .populate("department", "name");

    res.status(201).json({
      success: true,
      message: "Company and admin user registered successfully",
      data: populatedUser,
    });
  } catch (error) {
    // 17. Rollback transaction on error
    await session.abortTransaction();

    // Pass error to global error handler
    return next(error);
  } finally {
    // 18. Always end session
    await session.endSession();
  }
});

//@desc    Authenticate user and get token
//@route   POST /api/auth/login
//@access  Public
export const loginUser = asyncHandler(async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Input validation
    if (!email || !password) {
      return next(
        new CustomError(
          "Email and password are required",
          400,
          "MISSING_CREDENTIALS"
        )
      );
    }

    // Validate email format
    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
    if (!emailRegex.test(email)) {
      return next(
        new CustomError("Invalid email format", 400, "INVALID_EMAIL_FORMAT")
      );
    }

    // Find user with company and department details
    const user = await User.findOne({ email: email.toLowerCase() })
      .populate("company", "name isActive subscription.status")
      .populate("department", "name isActive")
      .select("+password");

    if (!user) {
      return next(
        new CustomError("Invalid email or password", 401, "INVALID_CREDENTIALS")
      );
    }

    // Verify password
    if (!(await user.comparePassword(password))) {
      return next(
        new CustomError("Invalid email or password", 401, "INVALID_CREDENTIALS")
      );
    }

    // Check if user is active
    if (!user.isActive) {
      return next(
        new CustomError("User account is deactivated", 401, "USER_DEACTIVATED")
      );
    }

    // Check if company is active
    if (!user.company.isActive) {
      return next(
        new CustomError(
          "Company account is deactivated",
          401,
          "COMPANY_DEACTIVATED"
        )
      );
    }

    // Check company subscription status
    if (user.company.subscription.status !== "active") {
      return next(
        new CustomError(
          "Company subscription is not active",
          403,
          "SUBSCRIPTION_INACTIVE"
        )
      );
    }

    // Check if department is active
    if (!user.department.isActive) {
      return next(
        new CustomError(
          "Department is deactivated",
          401,
          "DEPARTMENT_DEACTIVATED"
        )
      );
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
      data: userResponse,
    });
  } catch (error) {
    console.error("Login error:", error);
    return next(
      new CustomError("Internal server error during login", 500, "LOGIN_ERROR")
    );
  }
});

//@desc    Logout user and clear cookies
//@route   DELETE /api/auth/logout
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
    return next(
      new CustomError(
        "Internal server error during logout",
        500,
        "LOGOUT_ERROR"
      )
    );
  }
});

//@desc    Get new access token using refresh token
//@route   GET /api/auth/refresh-token
//@access  Private
export const getRefreshToken = asyncHandler(async (req, res, next) => {
  try {
    // Extract refresh token from cookies
    const refreshToken = req.cookies?.refresh_token;

    if (!refreshToken) {
      return next(
        new CustomError(
          "Refresh token is required",
          401,
          "MISSING_REFRESH_TOKEN"
        )
      );
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
        return next(
          new CustomError(
            "Refresh token has expired",
            401,
            "REFRESH_TOKEN_EXPIRED"
          )
        );
      } else if (jwtError.name === "JsonWebTokenError") {
        return next(
          new CustomError("Invalid refresh token", 401, "INVALID_REFRESH_TOKEN")
        );
      } else {
        return next(
          new CustomError(
            "Refresh token verification failed",
            401,
            "REFRESH_TOKEN_VERIFICATION_FAILED"
          )
        );
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

      return next(new CustomError("User not found", 401, "USER_NOT_FOUND"));
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

      return next(
        new CustomError(
          "User account is not verified",
          401,
          "USER_NOT_VERIFIED"
        )
      );
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

      return next(
        new CustomError("User account is deactivated", 401, "USER_DEACTIVATED")
      );
    }

    // Check if company is active
    if (!user.company.isActive) {
      // Clear cookies if company is deactivated
      res.clearCookie("refresh_token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api/auth/refresh-token",
      });

      return next(
        new CustomError(
          "Company account is deactivated",
          401,
          "COMPANY_DEACTIVATED"
        )
      );
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

      return next(
        new CustomError(
          "Company subscription is not active",
          403,
          "SUBSCRIPTION_INACTIVE"
        )
      );
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

      return next(
        new CustomError(
          "Department is deactivated",
          401,
          "DEPARTMENT_DEACTIVATED"
        )
      );
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
    return next(
      new CustomError(
        "Internal server error during token refresh",
        500,
        "TOKEN_REFRESH_ERROR"
      )
    );
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
    return next(
      new CustomError(
        "Internal server error while retrieving user profile",
        500,
        "USER_PROFILE_ERROR"
      )
    );
  }
});
