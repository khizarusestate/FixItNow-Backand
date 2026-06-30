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
    // Push notifications (browser/device) - OFF by default
    pushEnabled: {
      type: Boolean,
      default: false,
    },
    // In-app notifications (notification bell)
    inAppEnabled: {
      type: Boolean,
      default: true,
    },
    // Email notifications (account verification and approvals only)
    emailEnabled: {
      type: Boolean,
      default: true,
    },
    // Specific notification types - only high/very high priority
    notificationTypes: {
      // Admin notifications (Very High Priority)
      newWorkerApproval: { type: Boolean, default: true },      // New Worker Approval Request
      newCustomerRegistration: { type: Boolean, default: true }, // New Customer Registration
      newBooking: { type: Boolean, default: true },              // New Booking
      newReview: { type: Boolean, default: true },               // New Review
      newAdvertisement: { type: Boolean, default: true },        // New Advertisement
      
      // Worker notifications (High Priority)
      newJob: { type: Boolean, default: true },
      
      // Customer notifications (High Priority)
      bookingSubmitted: { type: Boolean, default: true },
      workerAssigned: { type: Boolean, default: true },
    },
    // Email-only notifications (account related)
    emailNotifications: {
      accountVerification: { type: Boolean, default: true },
      workerApproved: { type: Boolean, default: true },
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
