import mongoose from 'mongoose';

const advertisementSchema = new mongoose.Schema(
  {
    // New paid advertisement flow
    name: {
      type: String,
      trim: true,
      maxlength: 100,
      default: '',
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 254,
      default: '',
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 30,
      default: '',
    },
    purpose: {
      type: String,
      trim: true,
      minlength: 1,
      maxlength: 500,
      default: '',
    },
    duration: {
      type: String,
      enum: ['24 hours', '3 days', '1 week', '2 weeks', '1 month'],
      default: '1 week',
    },
    price: {
      type: Number,
      min: 0,
      default: 0,
    },
    adType: {
      type: String,
      enum: ['image', 'video'],
      default: 'image',
    },
    adFileUrls: {
      type: [String],
      default: [],
    },
    paymentMethod: {
      type: String,
      enum: ['jazzcash', 'bank-transfer', 'pay-after-work', ''],
      default: '',
    },
    payAfterWork: {
      type: Boolean,
      default: false,
    },
    paymentReference: {
      type: String,
      trim: true,
      maxlength: 100,
      default: '',
    },
    paymentReceiptUrl: {
      type: String,
      trim: true,
      default: '',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    paymentSubmittedAt: {
      type: Date,
      default: null,
    },
    paymentReviewedAt: {
      type: Date,
      default: null,
    },
    paymentReviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    submitterId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    submitterType: {
      type: String,
      enum: ['customer', 'worker', 'guest'],
      default: 'guest',
    },
    submitterProfilePicture: {
      type: String,
      default: null,
    },

    // Legacy fields retained for backward compatibility with existing ads.
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Worker',
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      index: true,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 100,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    service: {
      type: String,
      index: true,
      default: 'advertisement',
    },
    category: {
      type: String,
      default: '',
    },
    budget: {
      type: Number,
      min: 0,
      default: 0,
    },
    images: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'expired'],
      default: 'pending',
      index: true,
    },
    adminNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
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
    location: {
      type: String,
      default: '',
    },
    latitude: Number,
    longitude: Number,
    phoneNumber: {
      type: String,
      default: '',
    },
    isGuest: {
      type: Boolean,
      default: false,
    },
    views: {
      type: Number,
      default: 0,
      min: 0,
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
      default: null,
      index: true,
    },
  },
  { timestamps: true },
);

advertisementSchema.index({ workerId: 1, isDeleted: 1 });
advertisementSchema.index({ customerId: 1, isDeleted: 1 });
advertisementSchema.index({ submitterId: 1, submitterType: 1 });
advertisementSchema.index({ status: 1, isDeleted: 1, createdAt: -1 });
advertisementSchema.index({ service: 1, isDeleted: 1 });
advertisementSchema.index({ paymentStatus: 1, paymentSubmittedAt: -1 });
advertisementSchema.index({ expiresAt: 1, status: 1 });

export default mongoose.model('Advertisement', advertisementSchema);
