import jwt from "jsonwebtoken";
import { User, Department } from "../models/index.js";

/**
 * Verify JWT token from cookies and attach user data to request
 */
export const verifyJWT = async (req, res, next) => {
  try {
    // Extract token from cookies
    const token = req.cookies?.access_token;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Access token is required",
        error: "UNAUTHORIZED",
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch (jwtError) {
      if (jwtError.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          message: "Access token has expired",
          error: "TOKEN_EXPIRED",
        });
      } else if (jwtError.name === "JsonWebTokenError") {
        return res.status(401).json({
          success: false,
          message: "Invalid access token",
          error: "INVALID_TOKEN",
        });
      } else {
        return res.status(401).json({
          success: false,
          message: "Token verification failed",
          error: "TOKEN_VERIFICATION_FAILED",
        });
      }
    }

    // Fetch user data with company and department details
    const user = await User.findById(decoded.userId)
      .populate("company", "name subscription.status isActive")
      .populate("department", "name isActive");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
        error: "USER_NOT_FOUND",
      });
    }

    // Check if user is verified
    if (!user.isVerified) {
      return res.status(401).json({
        success: false,
        message: "User account is not verified",
        error: "ACCOUNT_NOT_VERIFIED",
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
      return res.status(401).json({});
      res.clearCookie("refresh_token", {
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

    // Attach user data to request
    req.user = user;
    next();
  } catch (error) {
    console.error("JWT verification error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during authentication",
      error: "AUTHENTICATION_ERROR",
    });
  }
};

/**
 * Authorize user roles
 * @param {Array} allowedRoles - Array of allowed roles
 */
export const authorizeRoles = (allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
          error: "AUTHENTICATION_REQUIRED",
        });
      }

      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: `Access denied. Required roles: ${allowedRoles.join(", ")}`,
          error: "INSUFFICIENT_PERMISSIONS",
        });
      }

      next();
    } catch (error) {
      console.error("Role authorization error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error during role authorization",
        error: "AUTHORIZATION_ERROR",
      });
    }
  };
};

/**
 * Verify department access for resources
 * SuperAdmin can access all departments within their company
 */
export const verifyDepartmentAccess = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        error: "AUTHENTICATION_REQUIRED",
      });
    }

    // SuperAdmin can access all departments within their company
    if (req.user.role === "SuperAdmin") {
      return next();
    }

    // Extract department ID from various sources
    let resourceDepartmentId = null;

    // Check request parameters
    if (req.params.departmentId) {
      resourceDepartmentId = req.params.departmentId;
    }

    // Check request body
    if (req.body.department) {
      resourceDepartmentId = req.body.department;
    }

    // Check query parameters
    if (req.query.department) {
      resourceDepartmentId = req.query.department;
    }

    // If no department specified in request, allow access (will be handled by business logic)
    if (!resourceDepartmentId) {
      return next();
    }

    // Validate department exists and belongs to user's company
    const department = await Department.findById(resourceDepartmentId);

    if (!department) {
      return res.status(404).json({
        success: false,
        message: "Department not found",
        error: "DEPARTMENT_NOT_FOUND",
      });
    }

    // Check if department belongs to user's company
    if (!department.company.equals(req.user.company._id)) {
      return res.status(403).json({
        success: false,
        message: "Access denied to department from different company",
        error: "CROSS_COMPANY_ACCESS_DENIED",
      });
    }

    // Check if user has access to this department
    // Managers can access their own department
    // Users can only access their own department
    if (req.user.role === "Manager") {
      // Managers can access their own department or departments they manage
      const managedDepartments = await Department.find({
        company: req.user.company._id,
        managers: { $in: [req.user._id] },
      });

      const canAccess =
        req.user.department._id.equals(resourceDepartmentId) ||
        managedDepartments.some((dept) =>
          dept._id.equals(resourceDepartmentId)
        );

      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: "Access denied to this department",
          error: "DEPARTMENT_ACCESS_DENIED",
        });
      }
    } else if (req.user.role === "User") {
      // Users can only access their own department
      if (!req.user.department._id.equals(resourceDepartmentId)) {
        return res.status(403).json({
          success: false,
          message: "Access denied to department outside your scope",
          error: "DEPARTMENT_ACCESS_DENIED",
        });
      }
    }

    // Attach department to request for use in controllers
    req.resourceDepartment = department;
    next();
  } catch (error) {
    console.error("Department access verification error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during department access verification",
      error: "DEPARTMENT_ACCESS_ERROR",
    });
  }
};

/**
 * Verify company access for resources
 * Ensures all operations are within user's company scope
 */
export const verifyCompanyAccess = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        error: "AUTHENTICATION_REQUIRED",
      });
    }

    // Extract company ID from various sources
    let resourceCompanyId = null;

    if (req.params.companyId) {
      resourceCompanyId = req.params.companyId;
    }

    if (req.body.company) {
      resourceCompanyId = req.body.company;
    }

    if (req.query.company) {
      resourceCompanyId = req.query.company;
    }

    // If no company specified, use user's company
    if (!resourceCompanyId) {
      req.body.company = req.user.company._id;
      return next();
    }

    // Verify company access
    if (!req.user.company._id.equals(resourceCompanyId)) {
      return res.status(403).json({
        success: false,
        message: "Access denied to resources from different company",
        error: "CROSS_COMPANY_ACCESS_DENIED",
      });
    }

    next();
  } catch (error) {
    console.error("Company access verification error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during company access verification",
      error: "COMPANY_ACCESS_ERROR",
    });
  }
};

/**
 * Check if user can manage other users (for user management operations)
 */
export const canManageUsers = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        error: "AUTHENTICATION_REQUIRED",
      });
    }

    // SuperAdmin can manage all users in their company
    if (req.user.role === "SuperAdmin") {
      return next();
    }

    // Managers can manage users in their department
    if (req.user.role === "Manager") {
      const targetUserId = req.params.userId || req.body.userId;

      if (targetUserId) {
        const targetUser = await User.findById(targetUserId);

        if (!targetUser) {
          return res.status(404).json({
            success: false,
            message: "Target user not found",
            error: "USER_NOT_FOUND",
          });
        }

        // Check if target user is in manager's department
        if (!targetUser.department.equals(req.user.department._id)) {
          return res.status(403).json({
            success: false,
            message: "Cannot manage users outside your department",
            error: "DEPARTMENT_MANAGEMENT_DENIED",
          });
        }

        // Managers cannot manage other managers or superadmins
        if (["Manager", "SuperAdmin"].includes(targetUser.role)) {
          return res.status(403).json({
            success: false,
            message: "Cannot manage users with equal or higher privileges",
            error: "PRIVILEGE_MANAGEMENT_DENIED",
          });
        }
      }

      return next();
    }

    // Regular users cannot manage other users
    return res.status(403).json({
      success: false,
      message: "Insufficient permissions to manage users",
      error: "USER_MANAGEMENT_DENIED",
    });
  } catch (error) {
    console.error("User management authorization error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during user management authorization",
      error: "USER_MANAGEMENT_ERROR",
    });
  }
};
