import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    userRole: {
      type: String,
      required: true,
      enum: ["customer", "worker", "admin"],
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    relatedEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    link: {
      type: String,
      default: "",
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      default: "info",
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// Database indexes for performance optimization
notificationSchema.index({ userId: 1, userRole: 1, createdAt: -1 });
notificationSchema.index({ isRead: 1, createdAt: -1 });
notificationSchema.index({ userRole: 1, createdAt: -1 });
notificationSchema.index({ type: 1, createdAt: -1 });

export default mongoose.model("Notification", notificationSchema);
