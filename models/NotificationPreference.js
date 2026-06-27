/**
 * FILE: backend/models/NotificationPreference.js
 * 
 * Stores user notification preferences
 */

import mongoose from 'mongoose';

const notificationPreferenceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    userType: {
      type: String,
      enum: ['admin', 'worker', 'customer'],
      required: true,
    },
    // Push notifications (browser/device)
    pushEnabled: {
      type: Boolean,
      default: true,
    },
    // In-app notifications (notification bell)
    inAppEnabled: {
      type: Boolean,
      default: true,
    },
    // Email notifications (future)
    emailEnabled: {
      type: Boolean,
      default: false,
    },
    // Specific notification types that can be toggled
    notificationTypes: {
      // Admin notifications
      newBooking: { type: Boolean, default: true },
      newWorker: { type: Boolean, default: true },
      newCustomer: { type: Boolean, default: true },
      claimPending: { type: Boolean, default: true },
      newReview: { type: Boolean, default: true },
      newAdvertisement: { type: Boolean, default: true },
      
      // Worker notifications
      newJob: { type: Boolean, default: true },
      claimApproved: { type: Boolean, default: true },
      claimRejected: { type: Boolean, default: true },
      
      // Customer notifications
      bookingReceived: { type: Boolean, default: true },
      workerAssigned: { type: Boolean, default: true },
      jobCompleted: { type: Boolean, default: true },
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model('NotificationPreference', notificationPreferenceSchema);
