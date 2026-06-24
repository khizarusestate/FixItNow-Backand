import Customer from '../customerSchema.js';
import Worker from '../workerSchema.js';
import Admin from '../models/Admin.js';
import Booking from '../bookingSchema.js';
import logger from './logger.js';

/** One-time-safe cleanup: legacy invalid status values in existing documents. */
export async function normalizeLegacyDbStatuses() {
  const [customerPending, workerPending, adminMissingActive, adminMissingRole] = await Promise.all([
    Customer.updateMany({ status: 'pending' }, { $set: { status: 'not_approved' } }),
    Worker.updateMany({ status: 'pending' }, { $set: { status: 'not_approved' } }),
    Admin.updateMany(
      { role: 'admin', isActive: { $exists: false } },
      { $set: { isActive: true } },
    ),
    Admin.updateMany(
      {
        $or: [{ role: { $exists: false } }, { role: null }, { role: '' }],
      },
      { $set: { role: 'admin' } },
    ),
  ]);

  if (customerPending.modifiedCount > 0 || workerPending.modifiedCount > 0) {
    logger.info('Normalized legacy pending status fields', {
      customers: customerPending.modifiedCount,
      workers: workerPending.modifiedCount,
    });
  }

  if (adminMissingActive.modifiedCount > 0) {
    logger.info('Normalized legacy admin isActive fields', {
      admins: adminMissingActive.modifiedCount,
    });
  }

  if (adminMissingRole.modifiedCount > 0) {
    logger.info('Normalized legacy admin role fields', {
      admins: adminMissingRole.modifiedCount,
    });
  }

  const legacyClaims = await Booking.updateMany(
    { status: 'pending_approval', isDeleted: false },
    [
      {
        $set: {
          status: 'claim-pending',
          claimWorkerId: { $ifNull: ['$claimWorkerId', '$workerId'] },
          workerId: null,
        },
      },
    ],
  );

  if (legacyClaims.modifiedCount > 0) {
    logger.info('Normalized legacy pending_approval bookings to claim-pending', {
      bookings: legacyClaims.modifiedCount,
    });
  }
}
