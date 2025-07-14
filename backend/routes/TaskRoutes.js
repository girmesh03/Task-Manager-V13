import express from "express";

import {
  createTask,
  getAllTasks,
  getTaskById,
  updateTaskById,
} from "../controllers/TaskController.js";

import {
  verifyJWT,
  verifyCompanyAccess,
  verifyDepartmentAccess,
  authorizeRoles,
} from "../middlewares/authMiddleware.js";

const router = express.Router();

// @route   POST /api/tasks
// @desc    Create a new task (AssignedTask or ProjectTask)
// @access  Private (Authenticated users)
router.post(
  "/",
  verifyJWT,
  authorizeRoles(["SuperAdmin", "Manager"]),
  verifyCompanyAccess,
  verifyDepartmentAccess,
  createTask
);

// @route   GET /api/tasks
// @desc    Get all tasks for the authenticated user
// @access  Private
router.get(
  "/",
  verifyJWT,
  authorizeRoles(["SuperAdmin", "Manager", "User"]),
  verifyCompanyAccess,
  verifyDepartmentAccess,
  getAllTasks
);

// @route   GET /api/tasks/:taskId
// @desc    Get a task by ID
// @access  Private
router.get(
  "/:taskId",
  verifyJWT,
  authorizeRoles(["SuperAdmin", "Manager", "User"]),
  verifyCompanyAccess,
  verifyDepartmentAccess,
  getTaskById
);

// @route   PUT /api/tasks/:taskId
// @desc    Update a task by ID
// @access  Private
router.put(
  "/:taskId",
  verifyJWT,
  authorizeRoles(["SuperAdmin", "Manager"]),
  verifyCompanyAccess,
  verifyDepartmentAccess,
  updateTaskById
);

export default router;
