import mongoose from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";

const companySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
      minlength: [2, "Company name must be at least 2 characters"],
      maxlength: [100, "Company name cannot exceed 100 characters"],
      unique: true,
    },
    email: {
      type: String,
      required: [true, "Company email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email",
      ],
    },
    phone: {
      type: String,
      required: [true, "Company phone number is required"],
      trim: true,
      unique: true,
      validate: {
        validator: (v) => /^(09\d{8}|\+2519\d{8})$/.test(v),
        message: "Invalid phone number format for Ethiopia.",
      },
    },
    address: {
      type: String,
      required: [true, "Company address is required"],
      trim: true,
      minLength: [2, "Address must be at least 2 characters long"],
      maxLength: [100, "Address cannot exceed 100 characters"],
    },
    size: {
      type: String,
      required: [true, "Company size is required"],
      enum: [
        "1-10 Employees",
        "11-50 Employees",
        "51-200 Employees",
        "201-500 Employees",
        "500+ Employees",
      ],
      default: "1-10 Employees",
    },
    industry: {
      type: String,
      required: [true, "Company industry is required"],
      enum: [
        "Hospitality",
        "Technology",
        "Healthcare",
        "Finance",
        "Education",
        "Retail",
        "Manufacturing",
        "Consulting",
        "Other",
      ],
      default: "Hospitality",
    },
    logo: {
      type: String,
      validate: {
        validator: function (v) {
          return !v || /^https?:\/\//.test(v);
        },
        message: "Logo must be a valid URL",
      },
    },
    subscription: {
      plan: {
        type: String,
        enum: ["basic", "premium", "enterprise"],
        default: "basic",
      },
      status: {
        type: String,
        enum: ["active", "inactive", "suspended"],
        default: "active",
        index: true,
      },
    },
    isActive: { type: Boolean, default: true, index: true },
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

companySchema.virtual("departmentCount", {
  ref: "Department",
  localField: "_id",
  foreignField: "company",
  count: true,
});

companySchema.virtual("userCount", {
  ref: "User",
  localField: "_id",
  foreignField: "company",
  count: true,
});

// Pre-save hook to capitalize name and address
companySchema.pre("save", function (next) {
  const capitalize = (str) =>
    str
      .trim()
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  if (this.isModified("name")) this.name = capitalize(this.name);
  if (this.isModified("address")) this.address = capitalize(this.address);
  if (this.isModified("phone") && this.phone.startsWith("09"))
    this.phone = this.phone.replace("09", "+2519");
  next();
});

// Pagination plugin
companySchema.plugin(mongoosePaginate);

export default mongoose.model("Company", companySchema);
