import mongoose from "mongoose";
import Task from "./TaskModel.js";

const assignedTaskSchema = new mongoose.Schema(
  {
    assignedTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, "Assigned user is required"],
      },
    ],
  },
  {
    toJSON: Task.schema.options.toJSON,
    toObject: Task.schema.options.toObject,
  }
);

export default Task.discriminator("AssignedTask", assignedTaskSchema);
