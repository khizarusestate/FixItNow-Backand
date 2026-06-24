/** Platform commission taken when a worker claims a job (20%). */
export const COMMISSION_RATE = 0.2;

export function calculateCommissionAmount(bookingPrice) {
  const price = Number(bookingPrice) || 0;
  return Math.round(price * COMMISSION_RATE);
}

export function calculateWorkerEarnings(bookingPrice) {
  const price = Number(bookingPrice) || 0;
  return Math.max(0, price - calculateCommissionAmount(price));
}
