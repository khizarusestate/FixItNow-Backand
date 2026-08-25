import mongoose from 'mongoose';
import { geoLocationSchemaFields } from './utils/locationFields.js';

const bookingSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    isGuest: { type: Boolean, default: false },
    customerName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true, default: '' },
    serviceTitle: { type: String, required: true, trim: true },
    category: { type: String, trim: true, default: '' },
    serviceCategory: { type: String, trim: true, default: '' },
    price: { type: Number, default: 0 },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null },
    address: { type: String, required: true, trim: true },
    location: { type: String, default: '', trim: true },
    ...geoLocationSchemaFields,
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    workerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', default: null },
    status: {
      type: String,
      default: 'pending',
      enum: ['pending', 'claim-pending', 'worker-assigned', 'on-the-way', 'in-progress', 'completed', 'cancelled', 'rejected'],
    },
    claimWorkerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', default: null },
    assignedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null, description: 'Set when admin approves the worker claim' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null, description: 'Admin who approved the claim' },
    onTheWayAt: { type: Date, default: null, description: 'Set when worker starts traveling to the customer' },
    startedAt: { type: Date, default: null, description: 'Set automatically when worker reaches the customer geofence' },
    currentLatitude: { type: Number, default: null },
    currentLongitude: { type: Number, default: null },
    lastLocationUpdate: { type: Date, default: null },
    timeline: [{ status: String, timestamp: Date, note: String }],
    paymentDetails: {
      serviceFee: { type: Number, default: 0 },
      workerEarnings: { type: Number, default: 0 },
      totalAmount: { type: Number, default: 0 },
      platformCommission: { type: Number, default: 0 },
      processedAt: { type: Date, default: null },
      paymentReceipt: { type: String, default: '' },
      paymentMethod: { type: String, default: '', trim: true },
      payAfterWork: { type: Boolean, default: false },
      payToSummary: { type: String, default: '', trim: true },
      paymentReceived: { type: Boolean, default: false },
      paymentReceivedAt: { type: Date, default: null },
      paymentReceivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
      paymentReminderSentAt: { type: Date, default: null },
      commissionAmount: { type: Number, default: 0 },
      commissionReceipt: { type: String, default: '' },
      commissionTransactionId: { type: String, default: '', trim: true },
      commissionPaymentMethod: { type: String, default: '', trim: true },
      commissionSubmittedAt: { type: Date, default: null },
      commissionVerifiedAt: { type: Date, default: null },
      commissionVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
      commissionRejectedAt: { type: Date, default: null },
      commissionRejectReason: { type: String, default: '', trim: true },
    },
    completedAt: { type: Date, default: null },
    customerRating: { type: Number, min: 1, max: 5, default: null },
    customerMarkedDone: { type: Boolean, default: false },
    customerMarkedDoneAt: { type: Date, default: null },
    workerMarkedDone: { type: Boolean, default: false },
    workerMarkedDoneAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
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

// Push notification hooks for status changes that can happen from multiple routes.
// They are deliberately limited to the exact transitions to avoid duplicate pushes.
bookingSchema.post('save', function onBookingSave(doc) {
  const changedOnTheWay = doc.isModified('status') && doc.status === 'on-the-way' && doc.customerId && !doc.isGuest;
  const customerMarkedDone = doc.isModified('customerMarkedDone') && doc.customerMarkedDone && doc.workerId;
  if (!changedOnTheWay && !customerMarkedDone) return;

  Promise.resolve().then(async () => {
    const {
      notifyCustomerWorkerOnTheWay,
      notifyWorkerCustomerCompleted,
    } = await import('./services/notificationService.js');

    if (changedOnTheWay) await notifyCustomerWorkerOnTheWay(doc.customerId, doc);
    if (customerMarkedDone) await notifyWorkerCustomerCompleted(doc.workerId, doc);
  }).catch(() => {});
});

export default mongoose.model('Booking', bookingSchema);
