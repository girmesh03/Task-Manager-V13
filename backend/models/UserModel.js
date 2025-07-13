import mongoose from "mongoose";
import bcrypt from "bcrypt";
import crypto from "crypto";
import mongoosePaginate from "mongoose-paginate-v2";

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
      minlength: [2, "First name must be at least 2 characters"],
      maxlength: [30, "First name cannot exceed 30 characters"],
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
      minlength: [2, "Last name must be at least 2 characters"],
      maxlength: [30, "Last name cannot exceed 30 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required."],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email",
      ],
    },
    password: {
      type: String,
      required: [true, "Password is required."],
      minlength: [6, "Password must be at least 6 characters long."],
      select: false, // Do not return password in queries by default
    },
    role: {
      type: String,
      enum: ["SuperAdmin", "Manager", "User"],
      default: "User",
    },
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company is required."],
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: [true, "Department is required."],
    },
    profilePicture: {
      url: String,
      public_id: String,
    },
    skills: [{ type: String, trim: true, maxlength: 30 }],
    employeeId: { type: String, trim: true, sparse: true },
    hireDate: { type: Date, default: Date.now },
    lastLogin: { type: Date },
    isActive: { type: Boolean, default: true, index: true },
    isVerified: { type: Boolean, default: false },
    pendingEmail: { type: String, trim: true, lowercase: true },
    emailChangeToken: { type: String, select: false },
    emailChangeTokenExpiry: { type: Date, select: false },
    verificationToken: { type: String, select: false },
    verificationTokenExpiry: { type: Date, select: false },
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpiry: { type: Date, select: false },
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

// Indexes
userSchema.index({ verificationTokenExpiry: 1 }, { expireAfterSeconds: 900 });
userSchema.index({ emailChangeTokenExpiry: 1 }, { expireAfterSeconds: 900 });
userSchema.index({ resetPasswordExpiry: 1 }, { expireAfterSeconds: 3600 });

// Virtuals
userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.virtual("assignedTasksCount", {
  ref: "Task",
  localField: "_id",
  foreignField: "assignedTo",
  count: true,
});

userSchema.virtual("createdTasksCount", {
  ref: "Task",
  localField: "_id",
  foreignField: "createdBy",
  count: true,
});

// Format name fields on save
userSchema.pre("save", function (next) {
  const capitalize = (str) =>
    str.trim().replace(/\b\w/g, (char) => char.toUpperCase());

  if (this.isModified("firstName")) {
    this.firstName = capitalize(this.firstName);
  }

  if (this.isModified("lastName")) {
    this.lastName = capitalize(this.lastName);
  }

  if (this.isModified("position")) {
    this.position = capitalize(this.position);
  }

  next();
});

// Pre-save hook to hash password
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function (enteredPassword) {
  // We must re-select the password field as it's excluded by default.
  const user = await this.constructor.findById(this._id).select("+password");
  if (!user) return false;
  return await bcrypt.compare(enteredPassword, user.password);
};

// Verification token
userSchema.methods.generateVerificationToken = function () {
  const token = crypto.randomBytes(3).toString("hex").toUpperCase();
  this.verificationToken = token;
  this.verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  return token;
};

// Password  reset token
userSchema.methods.generatePasswordResetToken = function () {
  const token = crypto.randomBytes(32).toString("hex");
  this.resetPasswordToken = token;
  this.resetPasswordExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
  return token;
};

// Pagination plugin
userSchema.plugin(mongoosePaginate);

export default mongoose.model("User", userSchema);
