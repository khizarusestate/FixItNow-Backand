import {
  getBookingActionBlock,
  BOOKING_ACTION,
} from '../utils/bookingActions.js';
import { ERROR_CODES } from '../utils/apiErrors.js';

describe('bookingActions', () => {
  const booking = (status, title = 'Pipe repair') => ({
    status,
    serviceTitle: title,
    workerId: '507f1f77bcf86cd799439011',
  });

  describe('customer cancel', () => {
    it('allows cancel when pending', () => {
      expect(
        getBookingActionBlock(booking('pending'), BOOKING_ACTION.CUSTOMER_CANCEL),
      ).toBeNull();
    });

    it('blocks cancel when rejected by admin', () => {
      const block = getBookingActionBlock(
        booking('rejected'),
        BOOKING_ACTION.CUSTOMER_CANCEL,
      );
      expect(block.code).toBe(ERROR_CODES.BOOKING_ALREADY_REJECTED);
      expect(block.message).toMatch(/rejected by the admin/i);
      expect(block.refreshRecommended).toBe(true);
    });

    it('blocks cancel when already assigned', () => {
      const block = getBookingActionBlock(
        booking('worker-assigned'),
        BOOKING_ACTION.CUSTOMER_CANCEL,
      );
      expect(block.code).toBe(ERROR_CODES.BOOKING_WORKER_ASSIGNED);
    });

    it('blocks cancel when worker is on the way', () => {
      const block = getBookingActionBlock(
        booking('on-the-way'),
        BOOKING_ACTION.CUSTOMER_CANCEL,
      );
      expect(block.code).toBe(ERROR_CODES.BOOKING_IN_PROGRESS);
    });
  });

  describe('customer completion', () => {
    it.each(['worker-assigned', 'on-the-way', 'in-progress'])('allows done at %s', (status) => {
      expect(
        getBookingActionBlock(booking(status), BOOKING_ACTION.CUSTOMER_COMPLETE),
      ).toBeNull();
    });
  });

  describe('worker completion', () => {
    it.each(['worker-assigned', 'on-the-way', 'in-progress'])('allows mark done at %s', (status) => {
      expect(
        getBookingActionBlock(booking(status), BOOKING_ACTION.WORKER_MARK_DONE),
      ).toBeNull();
    });

    it('blocks mark done while claim is pending', () => {
      const block = getBookingActionBlock(
        booking('claim-pending'),
        BOOKING_ACTION.WORKER_MARK_DONE,
      );
      expect(block.code).toBe(ERROR_CODES.BOOKING_NOT_COMPLETABLE);
    });
  });

  describe('worker claim', () => {
    it('allows claim when pending and unassigned', () => {
      expect(
        getBookingActionBlock(booking('pending'), BOOKING_ACTION.WORKER_CLAIM, {
          existingWorkerId: null,
        }),
      ).toBeNull();
    });

    it('blocks claim when already taken', () => {
      const block = getBookingActionBlock(booking('pending'), BOOKING_ACTION.WORKER_CLAIM, {
        existingWorkerId: '507f1f77bcf86cd799439011',
      });
      expect(block.code).toBe(ERROR_CODES.BOOKING_ALREADY_CLAIMED);
    });
  });

  describe('admin status', () => {
    it('allows the operational worker lifecycle', () => {
      expect(
        getBookingActionBlock(booking('worker-assigned'), BOOKING_ACTION.ADMIN_SET_STATUS, {
          targetStatus: 'on-the-way',
        }),
      ).toBeNull();
      expect(
        getBookingActionBlock(booking('on-the-way'), BOOKING_ACTION.ADMIN_SET_STATUS, {
          targetStatus: 'in-progress',
        }),
      ).toBeNull();
      expect(
        getBookingActionBlock(booking('in-progress'), BOOKING_ACTION.ADMIN_SET_STATUS, {
          targetStatus: 'completed',
        }),
      ).toBeNull();
    });

    it('blocks invalid transition from rejected', () => {
      const block = getBookingActionBlock(booking('rejected'), BOOKING_ACTION.ADMIN_SET_STATUS, {
        targetStatus: 'worker-assigned',
      });
      expect(block.code).toBe(ERROR_CODES.BOOKING_INVALID_TRANSITION);
    });
  });
});
