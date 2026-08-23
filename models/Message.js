import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    conversationKey: { type: String, required: true, index: true },
    senderId: { type: String, required: true, index: true },
    senderType: {
      type: String,
      required: true,
      enum: ["admin", "super_admin", "customer", "worker"],
    },
    recipientId: { type: String, required: true, index: true },
    recipientType: {
      type: String,
      required: true,
      enum: ["admin", "super_admin", "customer", "worker"],
    },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
    },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

messageSchema.index({ conversationKey: 1, createdAt: 1 });
messageSchema.index({ recipientId: 1, readAt: 1, createdAt: -1 });

export default mongoose.model("Message", messageSchema);
