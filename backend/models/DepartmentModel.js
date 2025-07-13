import mongoose from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";

const departmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Department name is required"],
      trim: true,
      minlength: [2, "Department name must be at least 2 characters"],
      maxlength: [50, "Department name cannot exceed 50 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company reference is required"],
    },
    managers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, "Manager reference is required"],
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.id;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.id;
        return ret;
      },
    },
  }
);

// Prevent duplicate department names within the same company
departmentSchema.index({ name: 1, company: 1 }, { unique: true });

// Virtuals
departmentSchema.virtual("userCount", {
  ref: "User",
  localField: "_id",
  foreignField: "department",
  count: true,
});

departmentSchema.virtual("taskCount", {
  ref: "Task",
  localField: "_id",
  foreignField: "department",
  count: true,
});

// Formatt name and description
departmentSchema.pre("save", function (next) {
  const capitalize = (str) =>
    str.trim().replace(/\b\w/g, (char) => char.toUpperCase());

  if (this.isModified("name")) {
    this.name = capitalize(this.name);
  }

  if (this.isModified("description")) {
    this.description = capitalize(this.description);
  }

  next();
});

// Pagination plugin
departmentSchema.plugin(mongoosePaginate);

export default mongoose.model("Department", departmentSchema);
