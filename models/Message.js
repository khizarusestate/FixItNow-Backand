import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      index: true,
      default: null,
    },
    // Kept for backward compatibility with existing booking conversations.
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      index: true,
      default: null,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    senderRole: {
      type: String,
      enum: ["customer", "worker", "admin"],
      required: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    recipientRole: {
      type: String,
      enum: ["customer", "worker", "admin"],
      required: true,
    },
    // AES-256-GCM ciphertext. Plaintext is never persisted.
    text: {
      type: String,
      required: true,
      maxlength: 5000,
    },
    encryptionVersion: {
      type: Number,
      default: 1,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ bookingId: 1, createdAt: 1 });
messageSchema.index({ recipientId: 1, readAt: 1, createdAt: -1 });

export default mongoose.model("Message", messageSchema);
