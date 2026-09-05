import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { geoLocationSchemaFields } from "./utils/locationFields.js";

const workerSchema = new mongoose.Schema({
  firstName: { type: String, default: "", trim: true },
  lastName: { type: String, default: "", trim: true },
  fullName: { type: String, required: true, trim: true },
  phoneNumber: { type: String, default: "", trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, minlength: 6, required: true },
  serviceCategories: [{ type: String, trim: true }],
  services: [{
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Service" },
    serviceName: String,
    serviceCategory: String,
  }],
  primaryServiceCategory: {
    type: String,
    default: "",
    trim: true,
    required: function primaryCategoryRequired() { return this.signupStep === "complete"; },
  },
  primaryServiceName: { type: String, default: "", trim: true },
  primaryServiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Service", default: null },
  yearsOfExperience: { type: Number, default: 0, min: 0, max: 50 },
  cnicNumber: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    default: "",
    required: function cnicRequired() { return this.signupStep === "complete"; },
  },
  location: { type: String, default: "", trim: true },
  ...geoLocationSchemaFields,
  serviceArea: { type: String, default: "", trim: true },
  emailVerificationCode: { type: String, default: null, trim: true },
  emailVerificationExpiresAt: { type: Date, default: null },
  passwordResetCode: { type: String, default: null, trim: true },
  passwordResetExpiresAt: { type: Date, default: null },
  profilePicture: { type: String, default: null },
  verificationPhoto: { type: String, default: null },
  cnicFrontPhoto: { type: String, default: null },
  cnicBackPhoto: { type: String, default: null },
  emailVerified: { type: Boolean, default: false },
  rating: { type: Number, default: 0, min: 0, max: 5 },
  totalReviews: { type: Number, default: 0 },
  totalJobs: { type: Number, default: 0 },
  assignedJobs: { type: Number, default: 0 },
  activeJobs: { type: Number, default: 0 },
  completedJobs: { type: Number, default: 0 },
  status: { type: String, default: "inactive", enum: ["inactive", "active", "suspended", "rejected"] },
  approvalStatus: { type: String, default: "pending_approval", enum: ["pending_approval", "approved", "rejected"] },
  approvedAt: { type: Date, default: null, description: "When admin approved the worker account" },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null, description: "Which admin approved this worker" },
  rejectionReason: { type: String, default: "", description: "Reason if worker account was rejected" },
  signupStep: { type: String, enum: ["complete"], default: "complete", description: "Single-step signup - always complete after initial registration" },
  availability: { type: Boolean, default: true },
  devicePushEnabled: { type: Boolean, default: false },
  joinDate: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now },
  totalEarnings: { type: Number, default: 0 },
  isDisabled: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Keep the two worker lifecycle fields synchronized when a document is saved.
// approvalStatus is the admin decision; status is the current operational state.
workerSchema.pre("save", async function (next) {
  this.updatedAt = Date.now();

  if (this.isModified("status")) {
    if (this.status === "active" && this.approvalStatus === "pending_approval") {
      this.approvalStatus = "approved";
    } else if (this.status === "rejected") {
      this.approvalStatus = "rejected";
    }
  }

  if (this.isModified("approvalStatus")) {
    if (this.approvalStatus === "approved" && this.status === "inactive") {
      this.status = "active";
    } else if (this.approvalStatus === "rejected") {
      this.status = "rejected";
    }
  }

  if (this.isModified("cnicNumber") && this.cnicNumber) {
    const digits = String(this.cnicNumber).replace(/\D/g, "");
    if (digits.length === 13) this.cnicNumber = digits;
  }

  const label = (this.location || this.serviceArea || "").trim();
  if (label) {
    this.location = label;
    this.serviceArea = label;
  }

  if (this.isModified("password")) this.password = await bcrypt.hash(this.password, 12);
  next();
});

workerSchema.pre(["findOneAndUpdate", "updateOne", "updateMany"], function (next) {
  const update = this.getUpdate() || {};
  const $set = { ...(update.$set || {}) };

  if ($set.status === "active" || update.status === "active") {
    $set.status = "active";
    $set.approvalStatus = "approved";
  }
  if ($set.status === "rejected" || update.status === "rejected") {
    $set.status = "rejected";
    $set.approvalStatus = "rejected";
  }
  if ($set.approvalStatus === "approved" || update.approvalStatus === "approved") {
    $set.approvalStatus = "approved";
    $set.status = "active";
  }
  if ($set.approvalStatus === "rejected" || update.approvalStatus === "rejected") {
    $set.approvalStatus = "rejected";
    $set.status = "rejected";
  }

  if (Object.keys($set).length > 0) update.$set = $set;
  this.setUpdate(update);
  next();
});

// Worker login calls comparePassword immediately after locating the account.
// Enforce the complete authentication state here as a second defensive layer,
// while still allowing the existing route to handle incorrect passwords normally.
workerSchema.methods.comparePassword = async function (candidatePassword) {
  if (this.isDeleted === true) {
    const error = new Error("Your worker account no longer exists.");
    error.status = 403;
    error.code = "ACCOUNT_DELETED";
    throw error;
  }

  if (this.isDisabled === true || this.status === "suspended") {
    const error = new Error("Your worker account is currently suspended or disabled. Please contact support.");
    error.status = 403;
    error.code = "ACCOUNT_DISABLED";
    throw error;
  }

  if (this.approvalStatus === "rejected" || this.status === "rejected") {
    const error = new Error("Your worker account has been rejected. Please contact support.");
    error.status = 403;
    error.code = "ACCOUNT_REJECTED";
    throw error;
  }

  if (this.emailVerified !== true) {
    const error = new Error("Please verify your email before logging in.");
    error.status = 403;
    error.code = "EMAIL_NOT_VERIFIED";
    throw error;
  }

  if (this.approvalStatus !== "approved" || this.status !== "active") {
    const error = new Error("Your worker account is awaiting admin approval.");
    error.status = 403;
    error.code = "PENDING_APPROVAL";
    throw error;
  }

  return bcrypt.compare(candidatePassword, this.password);
};

workerSchema.index({ primaryServiceCategory: 1 });
workerSchema.index({ primaryServiceName: 1 });
workerSchema.index({ primaryServiceId: 1 });
workerSchema.index({ primaryServiceCategory: 1, primaryServiceName: 1 });
workerSchema.index({ serviceCategories: 1 });
workerSchema.index({ status: 1 });
workerSchema.index({ approvalStatus: 1 });
workerSchema.index({ email: 1 }, { unique: true });
workerSchema.index({ cnicNumber: 1 }, { unique: true });
workerSchema.index({ status: 1, createdAt: -1 });
workerSchema.index({ approvalStatus: 1, createdAt: -1 });
workerSchema.index({ isDeleted: 1, status: 1 });
workerSchema.index({ isDeleted: 1, approvalStatus: 1 });
workerSchema.index({ location: 1 });
workerSchema.index({ serviceArea: 1 });
workerSchema.index({ availability: 1, status: 1 });
workerSchema.index({ rating: -1 });
workerSchema.index({ totalJobs: -1 });
workerSchema.index({ lastActive: -1 });
workerSchema.index({ phoneNumber: 1 });

export default mongoose.model("Worker", workerSchema);
