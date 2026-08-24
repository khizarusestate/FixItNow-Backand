import mongoose from "mongoose";

const participantSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ["customer", "worker", "admin"], required: true },
    name: { type: String, default: "" },
  },
  { _id: false },
);

const conversationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["support"], default: "support", index: true },
    participants: { type: [participantSchema], required: true },
    lastMessageAt: { type: Date, default: null, index: true },
    lastMessagePreview: { type: String, default: "" },
  },
  { timestamps: true },
);

conversationSchema.index({ type: 1, "participants.userId": 1, "participants.role": 1 });

export default mongoose.model("Conversation", conversationSchema);
