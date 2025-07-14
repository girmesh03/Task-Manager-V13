// backend/utils/SocketEmitter.js
import { getIO } from "./SocketInstance.js";

export const emitToUser = (userId, event, data) => {
  try {
    const io = getIO();
    io.to(userId.toString()).emit(event, data);
    return true;
  } catch (err) {
    console.error(`Emit to user failed: ${err.message}`);
    return false;
  }
};

export const emitToManagers = async (departmentId, event, data) => {
  try {
    const io = getIO();
    const deptIdStr = departmentId.toString();
    io.to(`dept_managers_${deptIdStr}`).emit(event, data);
    return true;
  } catch (err) {
    console.error(`Emit to managers failed: ${err.message}`);
    return false;
  }
};

export const emitToDepartment = async (departmentId, event, data) => {
  try {
    const io = getIO();
    const deptIdStr = departmentId.toString();
    io.to(`department_${deptIdStr}`).emit(event, data);
    return true;
  } catch (err) {
    console.error(`Emit to department failed: ${err.message}`);
    return false;
  }
};

export const joinDepartmentRooms = async (socket) => {
  try {
    const user = socket.user;
    if (!user?._id || !user.department) {
      console.warn(`Socket for user ${socket.id} has incomplete user data.`);
      return;
    }

    const userIdStr = user._id.toString();
    socket.join(userIdStr); // Join user-specific room

    const deptIdStr = user.department.toString();
    socket.join(`department_${deptIdStr}`); // Join department-wide room

    if (["Manager", "Admin", "SuperAdmin"].includes(user.role)) {
      socket.join(`dept_managers_${deptIdStr}`); // Join department manager room
    }
  } catch (error) {
    console.error("Socket room join error:", error.message);
  }
};
