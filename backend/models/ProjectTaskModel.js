import mongoose from "mongoose";
import Task from "./TaskModel.js";

const projectTaskSchema = new mongoose.Schema(
  {
    clientInfo: {
      name: {
        type: String,
        required: [true, "Client name is required"],
        trim: true,
      },
      phone: {
        type: String,
        required: [true, "Client phone number is required"],
        trim: true,
        validate: {
          validator: (v) => /^(09\d{8}|\+2519\d{8})$/.test(v),
          message: "Invalid phone number format for Ethiopia.",
        },
      },
      address: {
        type: String,
        trim: true,
      },
    },
  },
  {
    toJSON: Task.schema.options.toJSON,
    toObject: Task.schema.options.toObject,
  }
);

export default Task.discriminator("ProjectTask", projectTaskSchema);
