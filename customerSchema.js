import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { geoLocationSchemaFields } from "./utils/locationFields.js";

const customerSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    minlength: 6,
    required: function passwordRequired() {
      return !this.googleId;
    },
  },
  googleId: {
    type: String,
    default: null,
    sparse: true,
    unique: true,
    trim: true,
  },
  authProvider: {
    type: String,
    enum: ["local", "google"],
    default: "local",
  },
  phone: {
    type: String,
    default: "",
    trim: true,
  },
  location: {
    type: String,
    default: "",
    trim: true,
  },
  address: {
    type: String,
    default: "",
    trim: true,
  },
  ...geoLocationSchemaFields,
  passwordResetCode: {
    type: String,
    default: null,
    trim: true,
  },
  passwordResetExpiresAt: {
    type: Date,
    default: null,
  },
  isVerified: {
    type: Boolean,
    default: false,
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
  profilePicture: {
    type: String,
    default: null,
  },
  totalBookings: {
    type: Number,
    default: 0,
  },
  completedBookings: {
    type: Number,
    default: 0,
  },
  pendingBookings: {
    type: Number,
    default: 0,
  },
  totalSpent: {
    type: Number,
    default: 0,
  },
  joinDate: {
    type: Date,
    default: Date.now,
  },
  lastBooking: {
    type: Date,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  /** When false, web push (device) is not sent; in-app bell/socket still works. */
  devicePushEnabled: {
    type: Boolean,
    default: true,
  },
  status: {
    type: String,
    default: "active",
    enum: [
      "not_approved",
      "approved",
      "rejected",
      "active",
      "inactive",
      "pending-verification",
    ],
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
customerSchema.pre("save", async function (next) {
  this.updatedAt = Date.now();
  const label = (this.location || this.address || "").trim();
  if (label) {
    this.location = label;
    this.address = label;
  }
  if (this.isModified("password") && this.password) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  next();
});

customerSchema.methods.comparePassword = function (candidatePassword) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidatePassword, this.password);
};

// Database indexes for performance optimization
customerSchema.index({ email: 1 }, { unique: true });
customerSchema.index({ googleId: 1 }, { unique: true, sparse: true });
customerSchema.index({ status: 1, createdAt: -1 });
customerSchema.index({ isActive: 1, isDeleted: 1 });
customerSchema.index({ createdAt: -1 });
customerSchema.index({ lastBooking: -1 });
customerSchema.index({ location: 1 });
customerSchema.index({ phone: 1 });

export default mongoose.model("Customer", customerSchema);
