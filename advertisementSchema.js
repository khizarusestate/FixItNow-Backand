import mongoose from "mongoose";

const advertisementSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    purpose: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    duration: {
      type: String,
      enum: ["24 hours", "3 days", "1 week", "2 weeks", "1 month"],
      default: "1 week",
    },
    adType: {
      type: String,
      enum: ["image", "video"],
      required: true,
    },
    adFileUrls: {
      type: [String],
      required: true,
      validate: {
        validator: function (v) {
          return v.length > 0 && v.length <= 3;
        },
        message: "Must have between 1 and 3 ad files",
      },
    },
    paymentMethod: {
      type: String,
      trim: true,
      default: "",
    },
    paymentReference: {
      type: String,
      trim: true,
      default: "",
    },
    paymentReceiptUrl: {
      type: String,
      default: "",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    paymentSubmittedAt: {
      type: Date,
      default: null,
    },
    paymentReviewedAt: {
      type: Date,
      default: null,
    },
    paymentReviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    submitterId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    submitterType: {
      type: String,
      enum: ["customer", "worker", "guest"],
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
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

advertisementSchema.index({ status: 1, createdAt: -1 });
advertisementSchema.index({ submitterId: 1, submitterType: 1 });
advertisementSchema.index({ email: 1 });
advertisementSchema.index({ duration: 1 });
advertisementSchema.index({ adType: 1 });
advertisementSchema.index({ paymentStatus: 1, paymentSubmittedAt: -1 });
advertisementSchema.index({ reviewedAt: -1 });

export default mongoose.model("Advertisement", advertisementSchema);
