import mongoose from "mongoose";
import asyncHandler from "express-async-handler";

import {
  Task,
  AssignedTask,
  ProjectTask,
  User,
  Notification,
} from "../models/index.js";

import CustomError from "../errorHandler/CustomError.js";
import { emitToUser, emitToManagers } from "../utils/SocketEmitter.js";

// @desc    Create a new task (AssignedTask or ProjectTask)
// @route   POST /api/tasks
// @access  Private
export const createTask = asyncHandler(async (req, res, next) => {
  // --- PHASE 1: INPUT VALIDATION ---

  const { taskType, assignedTo, clientInfo, ...taskData } = req.body;

  // Required field validation
  const requiredFields = {
    "Task title": taskData.title,
    "Task description": taskData.description,
    "Due date": taskData.dueDate,
    "Task type": taskType,
    Location: taskData.location,
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

  // Task type validation
  if (!["AssignedTask", "ProjectTask"].includes(taskType)) {
    return next(
      new CustomError(
        "Task type must be either 'AssignedTask' or 'ProjectTask'",
        400,
        "INVALID_TASK_TYPE"
      )
    );
  }

  // Due date validation
  const dueDate = new Date(taskData.dueDate);
  if (isNaN(dueDate.getTime())) {
    return next(
      new CustomError("Invalid due date format", 400, "INVALID_DUE_DATE")
    );
  }

  if (dueDate < new Date()) {
    return next(
      new CustomError("Due date cannot be in the past", 400, "PAST_DUE_DATE")
    );
  }

  // --- PHASE 2: TASK TYPE SPECIFIC VALIDATION ---

  let assignedUsers = [];
  let notificationReceivers = [];

  if (taskType === "AssignedTask") {
    // AssignedTask validation
    if (!assignedTo || !Array.isArray(assignedTo) || assignedTo.length === 0) {
      return next(
        new CustomError(
          "AssignedTask must have at least one assigned user",
          400,
          "MISSING_ASSIGNED_USERS"
        )
      );
    }

    // Validate ObjectId format
    const invalidIds = assignedTo.filter(
      (id) => !mongoose.Types.ObjectId.isValid(id)
    );
    if (invalidIds.length > 0) {
      return next(
        new CustomError("Invalid user ID format", 400, "INVALID_USER_ID")
      );
    }

    // Check if assigned users exist and belong to same company/department
    assignedUsers = await User.find({
      _id: { $in: assignedTo },
      company: req.user.company._id,
      department: req.user.department._id,
      isActive: true,
    }).lean();

    if (assignedUsers.length !== assignedTo.length) {
      return next(
        new CustomError(
          "One or more assigned users not found or not in your department",
          404,
          "INVALID_ASSIGNED_USERS"
        )
      );
    }

    // Notification receivers: all assigned users
    notificationReceivers = assignedUsers.map((user) => user._id);
    notificationReceivers = notificationReceivers.filter(
      (user) => user._id.toString() !== req.user._id.toString()
    );
  } else if (taskType === "ProjectTask") {
    // 8. ProjectTask validation
    if (!clientInfo || typeof clientInfo !== "object") {
      return next(
        new CustomError(
          "ProjectTask must include client information",
          400,
          "MISSING_CLIENT_INFO"
        )
      );
    }

    const { name: clientName, phone: clientPhone } = clientInfo;

    if (!clientName || !clientPhone) {
      return next(
        new CustomError(
          "Client name and phone are required for ProjectTask",
          400,
          "MISSING_CLIENT_DETAILS"
        )
      );
    }

    // Notification receivers: managers and super admins in the department
    const managersAndAdmins = await User.find({
      company: req.user.company._id,
      department: req.user.department._id,
      role: { $in: ["Manager", "SuperAdmin"] },
      isActive: true,
    }).lean();

    notificationReceivers = managersAndAdmins.map((user) => user._id);
    notificationReceivers = notificationReceivers.filter(
      (user) => user._id.toString() !== req.user._id.toString()
    );
  }

  // --- PHASE 3: TRANSACTIONAL CREATION ---

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // 9. Prepare task data
    const baseTaskData = {
      title: taskData.title.trim(),
      description: taskData.description.trim(),
      location: taskData.location.trim(),
      dueDate: dueDate,
      priority: taskData.priority || "Medium",
      status: taskData.status || "To Do",
      createdBy: req.user._id,
      company: req.user.company._id,
      department: req.user.department._id,
    };

    let task;

    // 10. Create task based on type
    if (taskType === "AssignedTask") {
      task = new AssignedTask({
        ...baseTaskData,
        assignedTo: assignedTo,
      });
    } else {
      task = new ProjectTask({
        ...baseTaskData,
        clientInfo: {
          name: clientInfo.name.trim(),
          phone: clientInfo.phone.trim(),
          address: clientInfo.address ? clientInfo.address.trim() : undefined,
        },
      });
    }

    await task.save({ session });

    // 11. Create notifications
    const notifications = notificationReceivers.map((userId) => ({
      user: userId,
      message: `New ${
        taskType === "AssignedTask" ? "assigned" : "project"
      } task: ${task.title}`,
      type: "TaskAssignment",
      task: task._id,
      company: req.user.company._id,
      department: req.user.department._id,
      linkedDocument: task._id,
      linkedDocumentType: "Task",
    }));

    if (notifications.length > 0) {
      await Notification.insertMany(notifications, { session });
      notifications.forEach((notif) => {
        if (taskType === "ProjectTask") {
          emitToManagers(notif.user, "New Project Task Created", notif);
        } else {
          emitToUser(notif.user, "New Task Assignment", notif);
        }
      });
    }

    // 12. Populate task for response
    const populatedTask = await Task.findById(task._id, null, { session })
      .populate("createdBy", "firstName lastName email")
      .populate("company", "name")
      .populate("department", "name");

    // If AssignedTask, populate assignedTo
    if (taskType === "AssignedTask") {
      await populatedTask.populate(
        "assignedTo",
        "firstName lastName email position role profilePicture"
      );
    }

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: `${taskType} created successfully`,
      data: populatedTask,
    });
  } catch (error) {
    // Rollback transaction on error
    await session.abortTransaction();

    // Pass error to error handler
    next(error);
  } finally {
    await session.endSession();
  }
});

// @desc    Get all tasks for the authenticated user
// @route   GET /api/tasks
// @access  Private
export const getAllTasks = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 10, status, taskType, departmentId } = req.query;
  const user = req.user;

  // Build base query
  const query = {
    company: req.user.company._id,
    department: req.user.department._id,
  };

  // Apply user-specific filters
  if (status) query.status = status;
  if (taskType) query.taskType = taskType;

  // Apply task type filter
  if (taskType && ["AssignedTask", "ProjectTask"].includes(taskType)) {
    query.taskType = taskType;
  }

  // Apply user role filter
  if (user.role === "User") {
    query.assignedTo = { $in: [user._id] };
    query.taskType = "AssignedTask";
  }

  // Apply department filter if provided
  if (departmentId) {
    if (!mongoose.Types.ObjectId.isValid(departmentId)) {
      return next(
        new CustomError(
          "Invalid department ID format",
          400,
          "INVALID_DEPARTMENT_ID"
        )
      );
    }
    if (user.role === "SuperAdmin") {
      query.department = departmentId;
    }
  }

  // Configure pagination
  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    populate: [
      { path: "createdBy", select: "firstName lastName email" },
      { path: "company", select: "name" },
      { path: "department", select: "name" },
      {
        path: "assignedTo",
        select: "firstName lastName email position role profilePicture",
      },
    ],
  };

  // Execute paginated query
  const results = await Task.paginate(query, options);

  res.status(200).json({
    success: true,
    message: "Tasks retrieved successfully",
    data: results.docs,
    page: results.page,
    limit: results.limit,
    totalPages: results.totalPages,
    totalItems: results.totalDocs,
  });
});

// @desc    Get a task by ID
// @route   GET /api/tasks/:taskId
// @access  Private(SuperAdmin any, Manager and User department tasks only)
export const getTaskById = asyncHandler(async (req, res, next) => {
  const { taskId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(taskId)) {
    return next(
      new CustomError("Invalid task ID format", 400, "INVALID_TASK_ID")
    );
  }
  // Fetch task
  const task = await Task.findById(taskId)
    .populate("createdBy", "firstName lastName email")
    .populate("company", "name")
    .populate("department", "name");

  // Check if the task exsits
  if (!task) {
    return next(new CustomError("Task not found", 404, "TASK_NOT_FOUND"));
  }

  // Check if user has access to the task
  if (req.user.role === "User" && !task.assignedTo.includes(req.user._id)) {
    return next(
      new CustomError(
        "You do not have permission to view this task",
        403,
        "FORBIDDEN"
      )
    );
  }

  res.status(200).json({
    success: true,
    message: "Task retrieved successfully",
    data: task,
  });
});

// @desc    Update a task by ID
// @route   PUT /api/tasks/:taskId
// @access  Private(SuperAdmin and Manager both department tasks only)
export const updateTaskById = asyncHandler(async (req, res, next) => {
  const { taskId } = req.params;
  const updateData = { ...req.body };
  const user = req.user;

  // Validate task ID
  if (!mongoose.Types.ObjectId.isValid(taskId)) {
    return next(
      new CustomError("Invalid task ID format", 400, "INVALID_TASK_ID")
    );
  }

  // User role validation, User cannot update tasks
  if (user.role === "User") {
    return next(
      new CustomError(
        "You do not have permission to update this task",
        403,
        "PERMISSION_DENIED"
      )
    );
  }

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // Check if task exists
    const task = await Task.findById(taskId).session(session);
    if (!task) {
      return next(new CustomError("Task not found", 404, "TASK_NOT_FOUND"));
    }

    // Authorization check
    const isCreator = task.createdBy.equals(user._id);
    const isManagerPlus = ["SuperAdmin", "Manager"].includes(user.role);

    const validDepartment = task.department.equals(user.department._id);
    if (!(isCreator || (isManagerPlus && validDepartment))) {
      throw new CustomError(
        "Not authorized to update this task",
        403,
        "PERMISSION_DENIED"
      );
    }

    // Capture original state
    const originalTaskState = task.toObject();
    const originalAssignedTo =
      originalTaskState.assignedTo?.map((id) => id.toString()) || [];

    // Filter protected fields
    const protectedFields = ["taskType", "createdBy", "department", "status"];
    protectedFields.forEach((field) => delete updateData[field]);

    // Validate allowed updates
    const allowedUpdates = [
      "title",
      "description",
      "location",
      "dueDate",
      "priority",
    ];
    if (task.taskType === "AssignedTask") allowedUpdates.push("assignedTo");
    if (task.taskType === "ProjectTask") allowedUpdates.push("clientInfo");

    // Apply updates and track changes
    let hasAssignedToChange = false;
    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        if (key === "assignedTo") {
          const newAssignees = updateData[key].map((id) => id.toString());
          const oldAssignees = task[key].map((id) => id.toString());
          hasAssignedToChange = !arraysEqual(newAssignees, oldAssignees);
        }
        task[key] =
          key === "dueDate" ? new Date(updateData[key]) : updateData[key];
      }
    });

    // Validate assignedTo users
    if (task.taskType === "AssignedTask" && updateData.assignedTo) {
      const validUsers = await User.countDocuments({
        _id: { $in: updateData.assignedTo },
        company: user.company._id,
        department: user.department._id,
      }).session(session);

      if (validUsers !== updateData.assignedTo.length) {
        throw new CustomError("Invalid users in assignedTo list", 400);
      }
    }

    // Get changed fields
    const changedFields = [];
    Object.keys(updateData).forEach((key) => {
      if (
        allowedUpdates.includes(key) &&
        JSON.stringify(task[key]) !== JSON.stringify(originalTaskState[key])
      ) {
        changedFields.push(key);
      }
    });

    // Special handling for assignedTo
    if (task.taskType === "AssignedTask") {
      const currentAssignedTo =
        task.assignedTo?.map((id) => id.toString()) || [];
      if (!arraysEqual(currentAssignedTo, originalAssignedTo)) {
        if (!changedFields.includes("assignedTo")) {
          changedFields.push("assignedTo");
        }
      }
    }

    // Save changes
    await task.save({ session });

    // Notification logic
    const notifications = [];
    const currentAssignedTo = task.assignedTo?.map((id) => id.toString()) || [];

    // Notification for new assignees
    if (task.taskType === "AssignedTask" && hasAssignedToChange) {
      const newAssignees = currentAssignedTo.filter(
        (id) => !originalAssignedTo.includes(id)
      );

      if (newAssignees.length) {
        notifications.push(
          ...newAssignees.map((userId) => ({
            user: userId,
            type: "TaskUpdate",
            message: `Assigned to task: ${task.title}`,
            linkedDocument: task._id,
            linkedDocumentType: "Task",
            company: user.company._id,
            department: user.department._id,
          }))
        );
      }
    }

    // Notification for important changes
    const importantFields = new Set([
      "title",
      "dueDate",
      "priority",
      "companyInfo",
    ]);
    const hasImportantChange =
      changedFields.some((f) => importantFields.has(f)) || hasAssignedToChange;

    if (hasImportantChange) {
      // Notify creator
      if (!isCreator) {
        notifications.push({
          user: task.createdBy,
          type: "TaskUpdate",
          message: `Task updated: ${task.title}`,
          linkedDocument: task._id,
          linkedDocumentType: "Task",
          company: user.company._id,
          department: user.department._id,
        });
      }

      // Notify existing assignees
      if (task.taskType === "AssignedTask") {
        originalAssignedTo.forEach((userId) => {
          if (userId !== user._id.toString()) {
            notifications.push({
              user: userId,
              type: "TaskUpdate",
              message: `Task modified: ${task.title}`,
              linkedDocument: task._id,
              linkedDocumentType: "Task",
              company: user.company._id,
              department: user.department._id,
            });
          }
        });
      }

      // Notify project stakeholders
      if (task.taskType === "ProjectTask") {
        const leaders = await User.find({
          company: user.company._id,
          department: user.department._id,
          role: { $in: ["Manager", "SuperAdmin"] },
          _id: { $ne: user._id },
        }).session(session);

        leaders.forEach((leader) => {
          notifications.push({
            user: leader._id,
            type: "TaskUpdate",
            message: `Project task updated: ${task.title}`,
            linkedDocument: task._id,
            linkedDocumentType: "Task",
            company: user.company._id,
            department: user.department._id,
          });
        });
      }
    }

    // Save notifications and emit events
    if (notifications.length) {
      await Notification.insertMany(notifications, { session });
      notifications.forEach((notif) => {
        emitToUser(notif.user, "notification-update", notif);
      });
    }

    // Get updated task data
    const populatedTask = await Task.findById(taskId)
      .populate([
        {
          path: "company",
          select: "name",
        },
        {
          path: "department",
          select: "name",
        },
        {
          path: "createdBy",
          select:
            "firstName lastName fullName email position role profilePicture",
        },
        {
          path: "assignedTo",
          select:
            "firstName lastName fullName email position role profilePicture",
        },
        {
          path: "activities",
          populate: {
            path: "performedBy",
            select:
              "firstName lastName fullName email position role profilePicture",
          },
        },
      ])
      .session(session)
      .lean({ virtuals: true });

    // Clean response format
    if (populatedTask.taskType === "ProjectTask") {
      delete populatedTask.assignedTo;
    } else {
      delete populatedTask.clientInfo;
    }

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      data: populatedTask,
      activities: populatedTask.activities || [],
      message: "Task updated successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    await session.endSession();
  }
});
