import mongoose from 'mongoose';

const advertisementSchema = new mongoose.Schema(
  {
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Worker',
      required: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 100,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 1000,
    },
    service: {
      type: String,
      required: true,
      index: true,
    },
    category: String,
    budget: {
      type: Number,
      min: 0,
    },
    images: [
      {
        type: String,
        trim: true,
      },
    ],
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'expired'],
      default: 'pending',
      index: true,
    },
    location: String,
    latitude: Number,
    longitude: Number,
    phoneNumber: String,
    email: String,
    isGuest: {
      type: Boolean,
      default: false,
    },
    views: {
      type: Number,
      default: 0,
    },
    interested: [
      {
        workerId: mongoose.Schema.Types.ObjectId,
        interestedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

advertisementSchema.index({ workerId: 1, isDeleted: 1 });
advertisementSchema.index({ customerId: 1, isDeleted: 1 });
advertisementSchema.index({ status: 1, isDeleted: 1 });
advertisementSchema.index({ service: 1, isDeleted: 1 });
advertisementSchema.index({ createdAt: -1 });

export default mongoose.model('Advertisement', advertisementSchema);
