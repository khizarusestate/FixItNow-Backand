import mongoose from 'mongoose';
import { AUDIT_ACTIONS } from '../utils/constants.js';

const LEGACY_AUDIT_ACTIONS = ['login', 'logout'];
const AUDIT_ACTION_VALUES = [...new Set([...Object.values(AUDIT_ACTIONS), ...LEGACY_AUDIT_ACTIONS])];

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
    enum: AUDIT_ACTION_VALUES
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
