/**
 * FILE: backend/models/PlatformSettings.js
 * 
 * App-wide platform settings (maintenance mode, etc)
 */

import mongoose from 'mongoose';

const platformSettingsSchema = new mongoose.Schema(
  {
    maintenanceMode: {
      enabled: { type: Boolean, default: false },
      message: {
        type: String,
        default: 'App is in maintenance. Please try again later.',
      },
      enabledAt: Date,
      enabledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
      },
    },
    lastModified: {
      timestamp: { type: Date, default: Date.now },
      by: { type: String, enum: ['super_admin', 'admin'] },
    },
  },
  {
    timestamps: true,
    collection: 'platformSettings',
  }
);

// Ensure only one settings document exists
platformSettingsSchema.index({ _id: 1 });

export default mongoose.model('PlatformSettings', platformSettingsSchema);
