import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { geoLocationSchemaFields } from "./utils/locationFields.js";

const workerSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
    trim: true,
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true,
  },
  emailAddress: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
  },
  serviceCategories: [
    {
      type: String,
      trim: true,
    },
  ],
  primaryServiceCategory: {
    type: String,
    required: true,
    trim: true,
  },
  yearsOfExperience: {
    type: Number,
    default: 0,
    min: 0,
    max: 50,
  },
  cnicNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  location: {
    type: String,
    default: "",
    trim: true,
  },
  ...geoLocationSchemaFields,
  /** @deprecated Use location — kept for legacy data / queries */
  serviceArea: {
    type: String,
    default: "",
    trim: true,
  },
  /** @deprecated Use location */
  address: {
    type: String,
    default: "",
    trim: true,
  },
  aboutExperience: {
    type: String,
    default: "",
    trim: true,
    maxlength: 500,
  },
  experience: {
    type: String,
    default: "",
    trim: true,
    maxlength: 1000,
  },
  emailVerificationCode: {
    type: String,
    default: null,
    trim: true,
  },
  emailVerificationExpiresAt: {
    type: Date,
    default: null,
  },
  passwordResetCode: {
    type: String,
    default: null,
    trim: true,
  },
  passwordResetExpiresAt: {
    type: Date,
    default: null,
  },
  profilePicture: {
    type: String,
    default: null,
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5,
  },
  totalReviews: {
    type: Number,
    default: 0,
  },
  totalJobs: {
    type: Number,
    default: 0,
  },
  assignedJobs: {
    type: Number,
    default: 0,
  },
  activeJobs: {
    type: Number,
    default: 0,
  },
  completedJobs: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    default: "not_approved",
    enum: [
      "not_approved",
      "approved",
      "rejected",
      "active",
      "inactive",
      "pending-verification",
    ],
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  availability: {
    type: Boolean,
    default: true,
  },
  hourlyRate: {
    type: Number,
    default: 0,
  },
  joinDate: {
    type: Date,
    default: Date.now,
  },
  lastActive: {
    type: Date,
    default: Date.now,
  },
  // REMOVED: paymentMethod, accountUsername, accountNumber
  // These are now in WorkerPayment collection for security
  totalEarnings: {
    type: Number,
    default: 0,
  },
  isDisabled: {
    type: Boolean,
    default: false,
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update the updatedAt field before saving
workerSchema.pre("save", async function (next) {
  this.updatedAt = Date.now();
  if (this.isModified("cnicNumber") && this.cnicNumber) {
    const digits = String(this.cnicNumber).replace(/\D/g, "");
    if (digits.length === 13) {
      this.cnicNumber = digits;
    }
  }
  const label = (
    this.location ||
    this.serviceArea ||
    this.address ||
    ""
  ).trim();
  if (label) {
    this.location = label;
    this.serviceArea = label;
    this.address = label;
  }
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  next();
});

workerSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Create indexes for faster queries (only for non-unique fields)
workerSchema.index({ primaryServiceCategory: 1 });
workerSchema.index({ serviceCategories: 1 });
workerSchema.index({ status: 1 });
workerSchema.index({ emailAddress: 1 }, { unique: true });
workerSchema.index({ cnicNumber: 1 }, { unique: true });
workerSchema.index({ status: 1, createdAt: -1 });
workerSchema.index({ isDeleted: 1, status: 1 });
workerSchema.index({ location: 1 });
workerSchema.index({ serviceArea: 1 });
workerSchema.index({ availability: 1, status: 1 });
workerSchema.index({ rating: -1 });
workerSchema.index({ totalJobs: -1 });
workerSchema.index({ lastActive: -1 });
workerSchema.index({ phoneNumber: 1 });

export default mongoose.model("Worker", workerSchema);
