// Role-Based Access Control (RBAC) Permissions

// Define permissions for each role
export const PERMISSIONS = {
  // Admin permissions
  ADMIN: {
    // User management
    'users.view': true,
    'users.create': true,
    'users.update': true,
    'users.delete': true,
    'users.approve': true,
    'users.reject': true,
    
    // Worker management
    'workers.view': true,
    'workers.create': true,
    'workers.update': true,
    'workers.delete': true,
    'workers.approve': true,
    'workers.reject': true,
    
    // Customer management
    'customers.view': true,
    'customers.update': true,
    'customers.delete': true,
    'customers.suspend': true,
    
    // Booking management
    'bookings.view': true,
    'bookings.update': true,
    'bookings.delete': true,
    'bookings.assign': true,
    'bookings.cancel': true,
    
    // Service management
    'services.view': true,
    'services.create': true,
    'services.update': true,
    'services.delete': true,
    
    // Advertisement management
    'advertisements.view': true,
    'advertisements.approve': true,
    'advertisements.reject': true,
    'advertisements.delete': true,
    
    // Review management
    'reviews.view': true,
    'reviews.delete': true,
    
    // System management
    'system.view': true,
    'system.configure': true,
    'system.logs': true,
    
    // Payment management
    'payments.view': true,
    'payments.process': true,
  },
  
  // Worker permissions
  WORKER: {
    // Own profile
    'profile.view': true,
    'profile.update': true,
    'profile.picture.update': true,
    
    // Job management
    'jobs.view.available': true,
    'jobs.view.assigned': true,
    'jobs.accept': true,
    'jobs.update.status': true,
    'jobs.complete': true,
    
    // Own bookings
    'bookings.view.own': true,
    
    // Payment info
    'payment.view.own': true,
    'payment.update.own': true,
    
    // Reviews
    'reviews.view.received': true,
  },
  
  // Customer permissions
  CUSTOMER: {
    // Own profile
    'profile.view': true,
    'profile.update': true,
    'profile.picture.update': true,
    
    // Booking management
    'bookings.create': true,
    'bookings.view.own': true,
    'bookings.cancel.own': true,
    'bookings.complete.own': true,
    
    // Reviews
    'reviews.create': true,
    'reviews.view.own': true,
    
    // Advertisements
    'advertisements.create': true,
    'advertisements.view.own': true,
    
    // Services
    'services.view': true,
    
    // Workers
    'workers.view': true,
  },
};

// Permission checker middleware factory
export const requirePermission = (permission) => {
  return (req, res, next) => {
    const user = req.user || req.admin || req.customer || req.worker;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const role = user.role;
    const rolePermissions = PERMISSIONS[role.toUpperCase()];
    
    if (!rolePermissions) {
      return res.status(403).json({
        success: false,
        message: 'Invalid role'
      });
    }
    
    if (!rolePermissions[permission]) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }
    
    next();
  };
};

// Check if user has permission (utility function)
export const hasPermission = (role, permission) => {
  const rolePermissions = PERMISSIONS[role.toUpperCase()];
  return rolePermissions && rolePermissions[permission] === true;
};

// Check multiple permissions (all must be true)
export const requireAllPermissions = (permissions) => {
  return (req, res, next) => {
    const user = req.user || req.admin || req.customer || req.worker;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const role = user.role;
    const rolePermissions = PERMISSIONS[role.toUpperCase()];
    
    if (!rolePermissions) {
      return res.status(403).json({
        success: false,
        message: 'Invalid role'
      });
    }
    
    const missingPermissions = permissions.filter(p => !rolePermissions[p]);
    
    if (missingPermissions.length > 0) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
        missing: missingPermissions
      });
    }
    
    next();
  };
};

// Check multiple permissions (at least one must be true)
export const requireAnyPermission = (permissions) => {
  return (req, res, next) => {
    const user = req.user || req.admin || req.customer || req.worker;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const role = user.role;
    const rolePermissions = PERMISSIONS[role.toUpperCase()];
    
    if (!rolePermissions) {
      return res.status(403).json({
        success: false,
        message: 'Invalid role'
      });
    }
    
    const hasAnyPermission = permissions.some(p => rolePermissions[p]);
    
    if (!hasAnyPermission) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }
    
    next();
  };
};

// Resource ownership checker
export const requireOwnership = (getResourceId) => {
  return (req, res, next) => {
    const user = req.user || req.admin || req.customer || req.worker;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    // Admins can access any resource
    if (user.role === 'admin') {
      return next();
    }
    
    const resourceId = getResourceId(req);
    
    if (resourceId !== user.id && resourceId !== user._id?.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You do not own this resource'
      });
    }
    
    next();
  };
};
