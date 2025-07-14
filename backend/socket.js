import jwt from "jsonwebtoken";
import User from "./models/UserModel.js";
import { Server as SocketIOServer } from "socket.io";
import { joinDepartmentRooms } from "./utils/SocketEmitter.js";
import { setIO } from "./utils/SocketInstance.js";

const extractToken = (cookieHeader) => {
  if (!cookieHeader) return null;
  const tokenCookie = cookieHeader
    .split(";")
    .find((c) => c.trim().startsWith("access_token="));
  return tokenCookie ? tokenCookie.split("=")[1].trim() : null;
};

const socketAuth = async (socket, next) => {
  try {
    const token = extractToken(socket.handshake.headers.cookie);
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

const setupSocketIO = (server, corsSocketOptions) => {
  try {
    const io = new SocketIOServer(server, {
      path: "/api/socket.io",
      cors: corsSocketOptions,
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true,
      },
    });

    setIO(io);
    io.use(socketAuth);

    io.on("connection", (socket) => {
      console.log(`Socket connected: ${socket.id} | User: ${socket.user._id}`);

      // Non-blocking room join
      setTimeout(() => {
        joinDepartmentRooms(socket.user._id).catch((err) =>
          console.error(`Room join error: ${err.message}`)
        );
      }, 0);

      socket.on("disconnect", (reason) => {
        console.log(`Socket disconnected (${reason}): ${socket.id}`);
      });

      socket.on("error", (err) => {
        console.error(`Socket error: ${socket.id} | ${err.message}`);
      });
    });

    io.engine.on("connection_error", (err) => {
      console.error(`Socket.IO connection error: ${err.message}`);
    });

    return io;
  } catch (err) {
    console.error(`Socket.IO setup failed: ${err.message}`);
    throw err;
  }
};

export default setupSocketIO;
