import mongoose from "mongoose";

const appReviewSchema = new mongoose.Schema(
  {
    submitterId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
      default: null,
      index: true,
    },
    submitterType: {
      type: String,
      required: false,
      enum: ["customer", "worker", "guest"],
      default: "guest",
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      required: true,
    },
    submitterProfilePicture: {
      type: String,
      default: null,
    },
    adminNote: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

appReviewSchema.index({ submitterId: 1, submitterType: 1 });
appReviewSchema.index({ status: 1, createdAt: -1 });
appReviewSchema.index({ rating: 1 });
appReviewSchema.index({ createdAt: -1 });

export default mongoose.model("AppReview", appReviewSchema);
