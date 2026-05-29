import mongoose from 'mongoose';
import { geoLocationSchemaFields } from './utils/locationFields.js';

const bookingSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
    },
    isGuest: {
      type: Boolean,
      default: false,
    },
    customerName: {
      type: String,
      required: true,
      trim: true
    },
    phone: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: ''
    },
    serviceTitle: {
      type: String,
      required: true,
      trim: true
    },
    category: {
      type: String,
      trim: true,
      default: ''
    },
    serviceCategory: {
      type: String,
      trim: true,
      default: ''
    },
    price: {
      type: Number,
      default: 0
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      default: null
    },
    address: {
      type: String,
      required: true,
      trim: true
    },
    location: {
      type: String,
      default: '',
      trim: true
    },
    ...geoLocationSchemaFields,
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: ''
    },
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Worker',
      default: null
    },
    status: {
      type: String,
      default: 'pending',
      enum: ['pending', 'approved', 'rejected', 'pending-confirmation', 'assigned', 'in-progress', 'completed', 'cancelled']
    },
    assignedAt: {
      type: Date,
      default: null
    },
    timeline: [{
      status: String,
      timestamp: Date,
      note: String
    }],
    paymentDetails: {
      serviceFee: { type: Number, default: 0 },
      workerEarnings: { type: Number, default: 0 },
      totalAmount: { type: Number, default: 0 },
      platformCommission: { type: Number, default: 0 },
      processedAt: { type: Date, default: null },
      paymentReceipt: { type: String, default: '' },
      /** easypaisa | jazzcash | hand-to-hand | pay-after-work */
      paymentMethod: { type: String, default: '', trim: true },
      /** Customer will pay after the job is completed */
      payAfterWork: { type: Boolean, default: false },
      /** Snapshot of pay-to instructions shown to the customer */
      payToSummary: { type: String, default: '', trim: true },
      /** Admin confirmed customer paid (pay-after-work only) */
      paymentReceived: { type: Boolean, default: false },
      paymentReceivedAt: { type: Date, default: null },
      paymentReceivedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        default: null,
      },
      /** One-shot reminder sent 24h after worker marked done without payment */
      paymentReminderSentAt: { type: Date, default: null },
    },
    completedAt: {
      type: Date,
      default: null
    },
    customerRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null
    },
    /** Customer tapped Done + rating (orange tick in admin) */
    customerMarkedDone: {
      type: Boolean,
      default: false,
    },
    customerMarkedDoneAt: {
      type: Date,
      default: null,
    },
    /** Worker tapped Done on their side (blue tick in admin) */
    workerMarkedDone: {
      type: Boolean,
      default: false,
    },
    workerMarkedDoneAt: {
      type: Date,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false
    },
    deletedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

bookingSchema.index({ customerId: 1, createdAt: -1 });
bookingSchema.index({ status: 1, createdAt: -1 });
bookingSchema.index({ serviceTitle: 1 });
bookingSchema.index({ workerId: 1, createdAt: -1 });
bookingSchema.index({ serviceCategory: 1 });
bookingSchema.index({ serviceId: 1 });
bookingSchema.index({ isDeleted: 1, createdAt: -1 });
bookingSchema.index({ assignedAt: -1 });
bookingSchema.index({ completedAt: -1 });
bookingSchema.index({ status: 1, workerId: 1 });
bookingSchema.index({ customerId: 1, status: 1 });

export default mongoose.model('Booking', bookingSchema);
