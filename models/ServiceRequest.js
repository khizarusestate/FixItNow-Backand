import mongoose from 'mongoose';

// A worker's request to add a new service type that doesn't exist in the
// catalog yet. Mirrors the fields on the Service model itself (models/Service.js)
// so that, on approval, the request can be converted into a real Service
// document without any field-mapping guesswork.
const serviceRequestSchema = new mongoose.Schema(
  {
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Worker',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      default: 0,
      min: 0,
    },
    icon: {
      type: String,
      default: 'Wrench',
      trim: true,
    },
    image: {
      type: String,
      default: null,
      trim: true,
    },
    estimatedDuration: {
      type: String,
      default: null,
      trim: true,
    },
    requirements: [
      {
        type: String,
        trim: true,
      },
    ],
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    rejectionReason: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    // Set once approved and converted into a real Service document.
    createdServiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true },
);

serviceRequestSchema.index({ status: 1, isDeleted: 1, createdAt: -1 });
serviceRequestSchema.index({ workerId: 1, isDeleted: 1 });

export default mongoose.model('ServiceRequest', serviceRequestSchema);
