/**
 * User notification preferences.
 *
 * `pushEnabled` is the notification-channel preference and is additionally
 * enforced against the account's devicePushEnabled flag by createNotification.
 */
import mongoose from 'mongoose';

const notificationPreferenceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
    userType: { type: String, enum: ['admin', 'worker', 'customer'], required: true },
    pushEnabled: { type: Boolean, default: true },
    inAppEnabled: { type: Boolean, default: true },
    emailEnabled: { type: Boolean, default: true },
    notificationTypes: {
      // Admin
      newWorker: { type: Boolean, default: true },
      newCustomer: { type: Boolean, default: true },
      newBooking: { type: Boolean, default: true },
      newAdvertisement: { type: Boolean, default: true },
      newReview: { type: Boolean, default: true },
      claimPending: { type: Boolean, default: true },
      supportChat: { type: Boolean, default: true },

      // Worker
      newJob: { type: Boolean, default: true },
      claimApproved: { type: Boolean, default: true },
      customerCompleted: { type: Boolean, default: true },
      claimRejected: { type: Boolean, default: true },

      // Customer
      bookingReceived: { type: Boolean, default: true },
      workerAssigned: { type: Boolean, default: true },
      workerOnTheWay: { type: Boolean, default: true },
      workerCompleted: { type: Boolean, default: true },

      // Backward-compatible keys retained for existing saved preferences/UI.
      newWorkerApproval: { type: Boolean, default: true },
      newCustomerRegistration: { type: Boolean, default: true },
      bookingSubmitted: { type: Boolean, default: true },
      jobCompleted: { type: Boolean, default: true },
    },
    emailNotifications: {
      accountVerification: { type: Boolean, default: true },
      workerApproved: { type: Boolean, default: true },
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export default mongoose.model('NotificationPreference', notificationPreferenceSchema);
