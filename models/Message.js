import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: false, default: null, index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: false, default: null, index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
    senderRole: { type: String, enum: ["customer", "worker", "admin"], required: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, required: false, default: null },
    recipientRole: { type: String, enum: ["customer", "worker", "admin"], required: false, default: null },
    text: { type: String, required: true, maxlength: 5000 },
    encryptionVersion: { type: Number, default: 1 },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

messageSchema.pre("validate", function validateMessage(next) {
  const hasBooking = Boolean(this.bookingId);
  const hasConversation = Boolean(this.conversationId);
  if (hasBooking === hasConversation) return next(new Error("Message must belong to exactly one booking or conversation."));
  next();
});

messageSchema.index({ bookingId: 1, createdAt: 1 });
messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ recipientId: 1, readAt: 1, createdAt: -1 });

// User -> admin support messages are also persisted as normal notifications,
// so they reach the admin browser push channel and respect supportChat settings.
messageSchema.post("save", function supportMessageNotification(doc) {
  if (!doc.conversationId || !["customer", "worker"].includes(doc.senderRole)) return;
  Promise.resolve().then(async () => {
    const Conversation = (await import("./Conversation.js")).default;
    const conversation = await Conversation.findOne({ _id: doc.conversationId, type: "support" }).select("_id").lean();
    if (!conversation) return;
    const { notifyAdminSupportChat } = await import("../services/notificationService.js");
    await notifyAdminSupportChat(doc.conversationId, doc.senderRole);
  }).catch(() => {});
});

export default mongoose.model("Message", messageSchema);
