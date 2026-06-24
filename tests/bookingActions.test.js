import {
  getBookingActionBlock,
  BOOKING_ACTION,
} from '../utils/bookingActions.js';
import { ERROR_CODES } from '../utils/apiErrors.js';

describe('bookingActions', () => {
  const booking = (status, title = 'Pipe repair') => ({
    status,
    serviceTitle: title,
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
        booking('assigned'),
        BOOKING_ACTION.CUSTOMER_CANCEL,
      );
      expect(block.code).toBe(ERROR_CODES.BOOKING_WORKER_ASSIGNED);
    });
  });

  describe('worker claim', () => {
    it('allows claim when approved and unassigned', () => {
      expect(
        getBookingActionBlock(booking('approved'), BOOKING_ACTION.WORKER_CLAIM, {
          existingWorkerId: null,
        }),
      ).toBeNull();
    });

    it('blocks claim when already taken', () => {
      const block = getBookingActionBlock(booking('approved'), BOOKING_ACTION.WORKER_CLAIM, {
        existingWorkerId: '507f1f77bcf86cd799439011',
      });
      expect(block.code).toBe(ERROR_CODES.BOOKING_ALREADY_CLAIMED);
    });
  });

  describe('admin status', () => {
    it('blocks invalid transition from rejected', () => {
      const block = getBookingActionBlock(booking('rejected'), BOOKING_ACTION.ADMIN_SET_STATUS, {
        targetStatus: 'approved',
      });
      expect(block.code).toBe(ERROR_CODES.BOOKING_INVALID_TRANSITION);
    });
  });
});
