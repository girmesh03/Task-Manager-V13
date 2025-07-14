// backend/routes/index.js
import express from "express";

import AuthRoutes from "./AuthRoutes.js";
import TaskRoutes from "./TaskRoutes.js";

const router = express.Router();

router.use("/auth", AuthRoutes);
router.use("/tasks", TaskRoutes);

export default router;
