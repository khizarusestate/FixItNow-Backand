import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    index: true
  },
  adminEmail: {
    type: String,
    required: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'login', 'logout',
      'worker_approve', 'worker_reject', 'worker_delete', 'worker_create', 'worker_update', 'worker_status_change',
      'customer_delete', 'customer_update', 'customer_status_change',
      'booking_assign', 'booking_update', 'booking_delete',
      'service_create', 'service_update', 'service_delete',
      'profile_update', 'settings_update',
      'job_complete',
      'admin_create', 'admin_update', 'admin_delete'
    ]
  },
  targetType: {
    type: String,
    enum: ['worker', 'customer', 'booking', 'service', 'admin', 'system'],
    required: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  ipAddress: {
    type: String,
    default: ''
  },
  userAgent: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

auditLogSchema.index({ adminId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1 });

export default mongoose.model('AuditLog', auditLogSchema);
