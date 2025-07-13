// backend/routes/index.js
import express from "express";

import AuthRoutes from "./AuthRoutes.js";

const router = express.Router();

router.use("/auth", AuthRoutes);

export default router;
