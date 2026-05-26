import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ADMIN_PANEL_ROLES } from '../middleware/adminRoles.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const adminSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: 100,
    },
    phone: {
      type: String,
      required: [true, 'Phone is required'],
      trim: true,
      maxlength: 20,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      index: true,
    },
    /** Bcrypt-hashed 8-digit PIN — never returned in queries by default */
    pin: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: [ADMIN_PANEL_ROLES.ADMIN, ADMIN_PANEL_ROLES.SUPER_ADMIN],
      default: ADMIN_PANEL_ROLES.ADMIN,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    lockUntil: {
      type: Date,
      default: null,
      select: false,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    lastLoginIp: {
      type: String,
      default: null,
      select: false,
    },
    profilePicture: {
      type: String,
      default: '',
    },
    /** When false, web push (device) is not sent; in-app admin notifications still work. */
    devicePushEnabled: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'admins',
  },
);

adminSchema.index({ role: 1, isActive: 1 });
adminSchema.index({ lastLogin: -1 });

adminSchema.pre('save', async function preSave(next) {
  try {
    if (this.isModified('pin') && this.pin) {
      if (!/^\d{8}$/.test(this.pin)) {
        return next(new Error('PIN must be exactly 8 digits.'));
      }
      this.pin = await bcrypt.hash(this.pin, 12);
    }

    if (this.role === ADMIN_PANEL_ROLES.SUPER_ADMIN) {
      const query = { role: ADMIN_PANEL_ROLES.SUPER_ADMIN };
      if (!this.isNew) {
        query._id = { $ne: this._id };
      }
      const existingSuper = await mongoose.model('Admin').countDocuments(query);
      if (existingSuper > 0) {
        return next(new Error('Only one super admin account is allowed.'));
      }
    }

    next();
  } catch (err) {
    next(err);
  }
});

adminSchema.methods.comparePin = function comparePin(candidatePin) {
  return bcrypt.compare(String(candidatePin), this.pin);
};

adminSchema.methods.isLocked = function isLocked() {
  return this.lockUntil && this.lockUntil > new Date();
};

adminSchema.methods.recordFailedLogin = async function recordFailedLogin() {
  this.failedLoginAttempts += 1;
  if (this.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
    this.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
  }
  await this.save();
};

adminSchema.methods.recordSuccessfulLogin = async function recordSuccessfulLogin(ip) {
  this.failedLoginAttempts = 0;
  this.lockUntil = null;
  this.lastLogin = new Date();
  this.lastLoginIp = ip || null;
  await this.save();
};

adminSchema.statics.sanitize = function sanitize(doc) {
  const data = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  delete data.pin;
  delete data.failedLoginAttempts;
  delete data.lockUntil;
  delete data.lastLoginIp;
  return {
    id: data._id,
    _id: data._id,
    name: data.name,
    email: data.email,
    phone: data.phone,
    role: data.role,
    isActive: data.isActive ?? true,
    createdBy: data.createdBy || null,
    lastLogin: data.lastLogin,
    profilePicture: data.profilePicture || '',
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
};

export default mongoose.models.Admin || mongoose.model('Admin', adminSchema);
