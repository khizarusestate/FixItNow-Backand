import mongoose from "mongoose";

const participantSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ["customer", "worker", "admin"], required: true },
  },
  { _id: false },
);

const conversationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["support", "booking"], required: true, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null, index: true },
    participants: {
      type: [participantSchema],
      required: true,
      validate: { validator: (value) => Array.isArray(value) && value.length >= 2, message: "A conversation must have at least two participants." },
    },
    // Encrypted preview; plaintext is never persisted.
    lastMessage: { type: String, default: "", maxlength: 5000 },
    lastMessageEncryptionVersion: { type: Number, default: 1 },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true },
);

conversationSchema.index({ "participants.userId": 1, updatedAt: -1 });
conversationSchema.index({ type: 1, bookingId: 1 });
conversationSchema.index({ "participants.userId": 1, "participants.role": 1, type: 1 });

export default mongoose.model("Conversation", conversationSchema);
