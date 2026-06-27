/**
 * FILE: backend/routes/notificationSettings.js
 * 
 * Endpoints for user notification preferences
 */

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';
import NotificationPreference from '../models/NotificationPreference.js';

const router = express.Router();

/**
 * GET /api/notification-settings
 * Get user's notification preferences
 */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user?.id || req.worker?.id || req.admin?.id;
    const userType = req.user?.type || req.worker?.type || req.admin?.role;

    if (!userId || !userType) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    let preferences = await NotificationPreference.findOne({ userId });

    // Create default preferences if not exists
    if (!preferences) {
      preferences = new NotificationPreference({
        userId,
        userType,
        pushEnabled: true,
        inAppEnabled: true,
        emailEnabled: false,
        notificationTypes: {
          newBooking: true,
          newWorker: true,
          newCustomer: true,
          claimPending: true,
          newReview: true,
          newAdvertisement: true,
          newJob: true,
          claimApproved: true,
          claimRejected: true,
          bookingReceived: true,
          workerAssigned: true,
          jobCompleted: true,
        },
      });
      await preferences.save();
    }

    return res.json({
      success: true,
      data: preferences,
    });
  })
);

/**
 * PUT /api/notification-settings
 * Update user's notification preferences
 */
router.put(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user?.id || req.worker?.id || req.admin?.id;
    const userType = req.user?.type || req.worker?.type || req.admin?.role;

    if (!userId || !userType) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const { pushEnabled, inAppEnabled, emailEnabled, notificationTypes } = req.body;

    let preferences = await NotificationPreference.findOne({ userId });

    if (!preferences) {
      preferences = new NotificationPreference({
        userId,
        userType,
      });
    }

    // Update preferences
    if (pushEnabled !== undefined) {
      preferences.pushEnabled = Boolean(pushEnabled);
    }
    if (inAppEnabled !== undefined) {
      preferences.inAppEnabled = Boolean(inAppEnabled);
    }
    if (emailEnabled !== undefined) {
      preferences.emailEnabled = Boolean(emailEnabled);
    }
    if (notificationTypes && typeof notificationTypes === 'object') {
      preferences.notificationTypes = {
        ...preferences.notificationTypes,
        ...notificationTypes,
      };
    }

    preferences.updatedAt = new Date();
    await preferences.save();

    console.log(`✓ Notification settings updated for user ${userId}`);

    return res.json({
      success: true,
      message: 'Notification settings updated',
      data: preferences,
    });
  })
);

/**
 * PATCH /api/notification-settings/:type
 * Toggle a specific notification type
 */
router.patch(
  '/:type',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user?.id || req.worker?.id || req.admin?.id;
    const { type } = req.params;
    const { enabled } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    if (enabled === undefined) {
      return res.status(400).json({
        success: false,
        message: 'enabled field is required',
      });
    }

    let preferences = await NotificationPreference.findOne({ userId });

    if (!preferences) {
      return res.status(404).json({
        success: false,
        message: 'Notification preferences not found',
      });
    }

    // Validate notification type exists
    if (!(type in preferences.notificationTypes)) {
      return res.status(400).json({
        success: false,
        message: `Invalid notification type: ${type}`,
      });
    }

    preferences.notificationTypes[type] = Boolean(enabled);
    preferences.updatedAt = new Date();
    await preferences.save();

    console.log(`✓ Notification type ${type} set to ${enabled} for user ${userId}`);

    return res.json({
      success: true,
      message: `Notification type ${type} updated`,
      data: preferences,
    });
  })
);

export default router;
