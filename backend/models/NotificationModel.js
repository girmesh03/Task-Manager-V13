import mongoose from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Notification Recipient user is required"],
      index: true,
    },
    message: {
      type: String,
      required: [true, "Notification message is required"],
      trim: true,
      maxlength: [150, "Message cannot exceed 150 characters"],
    },
    type: {
      type: String,
      enum: [
        "TaskAssignment", // When user is assigned to task
        "TaskCompletion", // When task is completed
        "TaskUpdate", // When task details change
        "StatusChange", // When task status changes
        "CompanyWide", // Company-wide notifications
      ],
      required: [true, "Notification type/category is required"],
      index: true,
    },
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
    },
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company reference is required"],
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      index: true,
    },
    linkedDocument: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "linkedDocumentType",
      validate: {
        validator: function (value) {
          // Ensure linkedDocument is required when the type is one of the specified options
          return (
            !["TaskAssignment", "TaskUpdate", "StatusChange"].includes(
              this.type
            ) || value != null
          );
        },
        message:
          "Notification Linked document is required when type is TaskAssignment, TaskUpdate, or StatusChange.",
      },
    },
    linkedDocumentType: {
      type: String,
      enum: ["Department", "User", "Task", "TaskActivity", "RoutineTask"],
      validate: {
        validator: function (value) {
          // Ensure linkedDocumentType is required when linkedDocument is provided
          return !this.linkedDocument || !!value;
        },
        message:
          "Notification Linked document is required if linkedDocument is provided.",
      },
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.id;
        return ret;
      },
    },
    toObject: {
      transform: (doc, ret) => {
        delete ret.id;
        return ret;
      },
    },
  }
);

// Auto-expire after 30 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });
notificationSchema.index({ user: 1, isRead: 1 });

// Pagination plugin
notificationSchema.plugin(mongoosePaginate);

export default mongoose.model("Notification", notificationSchema);
