/**
 * FILE: backend/middleware/maintenanceMode.js
 * 
 * Check if app is in maintenance mode
 * Block access for non-super-admin users
 */

import PlatformSettings from '../models/PlatformSettings.js';

export const checkMaintenanceMode = async (req, res, next) => {
  try {
    // Super admin can always access
    if (req.admin?.isSuperAdmin) {
      return next();
    }

    // Check maintenance mode status
    const settings = await PlatformSettings.findOne().select('maintenanceMode');
    
    if (settings?.maintenanceMode?.enabled) {
      return res.status(503).json({
        success: false,
        message: settings.maintenanceMode.message || 'App is in maintenance. Please try again later.',
        maintenanceMode: true,
      });
    }

    next();
  } catch (error) {
    // If error checking maintenance mode, allow access
    console.error('Error checking maintenance mode:', error);
    next();
  }
};

export default checkMaintenanceMode;
