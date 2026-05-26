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
    required: true,
    minlength: 6,
  },
  phone: {
    type: String,
    required: true,
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
  status: {
    type: String,
    default: "active",
    enum: [
      "not_approved",
      "approved",
      "rejected",
      "active",
      "inactive",
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
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  next();
});

customerSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Database indexes for performance optimization
customerSchema.index({ email: 1 }, { unique: true });
customerSchema.index({ status: 1, createdAt: -1 });
customerSchema.index({ isActive: 1, isDeleted: 1 });
customerSchema.index({ createdAt: -1 });
customerSchema.index({ lastBooking: -1 });
customerSchema.index({ location: 1 });
customerSchema.index({ phone: 1 });

export default mongoose.model("Customer", customerSchema);
