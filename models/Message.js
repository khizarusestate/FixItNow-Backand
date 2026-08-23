import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    senderRole: {
      type: String,
      enum: ["customer", "worker"],
      required: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    recipientRole: {
      type: String,
      enum: ["customer", "worker"],
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

messageSchema.index({ bookingId: 1, createdAt: 1 });
messageSchema.index({ recipientId: 1, readAt: 1, createdAt: -1 });

export default mongoose.model("Message", messageSchema);
