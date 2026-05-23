import mongoose from "mongoose";

const workerPaymentSchema = new mongoose.Schema(
  {
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Worker",
      required: true,
      unique: true,
    },
    paymentMethod: {
      type: String,
      enum: ["bank-transfer", "mobile-wallet", "check", "cash"],
      required: true,
    },
    accountUsername: {
      type: String,
      default: "",
    },
    accountNumber: {
      type: String,
      default: "",
    },
    bankName: {
      type: String,
      default: "",
    },
    bankCode: {
      type: String,
      default: "",
    },
    accountHolder: {
      type: String,
      default: "",
    },
    phoneNumber: {
      type: String,
      default: "",
    },
    verified: {
      type: Boolean,
      default: false,
    },
    verifiedAt: Date,
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: Date,
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  { timestamps: true },
);

// Index for efficient lookups
workerPaymentSchema.index({ workerId: 1 });
workerPaymentSchema.index({ isDeleted: 1 });

const WorkerPayment = mongoose.model("WorkerPayment", workerPaymentSchema);
export default WorkerPayment;
