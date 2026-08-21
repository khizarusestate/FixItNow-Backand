import mongoose from "mongoose";

const workerLiveLocationSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true,
      index: true,
    },
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Worker",
      required: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    accuracy: { type: Number, default: null, min: 0 },
    heading: { type: Number, default: null, min: 0, max: 360 },
    speed: { type: Number, default: null, min: 0 },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

workerLiveLocationSchema.index({ workerId: 1, updatedAt: -1 });
workerLiveLocationSchema.index({ customerId: 1, updatedAt: -1 });

export default mongoose.model("WorkerLiveLocation", workerLiveLocationSchema);
