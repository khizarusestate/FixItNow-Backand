import Customer from '../customerSchema.js';
import Worker from '../workerSchema.js';
import logger from './logger.js';

/** One-time-safe cleanup: legacy invalid status values in existing documents. */
export async function normalizeLegacyDbStatuses() {
  const [customerPending, workerPending] = await Promise.all([
    Customer.updateMany({ status: 'pending' }, { $set: { status: 'not_approved' } }),
    Worker.updateMany({ status: 'pending' }, { $set: { status: 'not_approved' } }),
  ]);

  if (customerPending.modifiedCount > 0 || workerPending.modifiedCount > 0) {
    logger.info('Normalized legacy pending status fields', {
      customers: customerPending.modifiedCount,
      workers: workerPending.modifiedCount,
    });
  }
}
