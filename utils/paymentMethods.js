/** Customer-facing payment methods (bookings & advertisements). */
export const PAYMENT_METHODS = ["jazzcash"];

export const PAY_AFTER_WORK_METHOD = "pay-after-work";

export function parsePayAfterWork(value) {
  return (
    value === true ||
    value === "true" ||
    value === "1" ||
    value === "on"
  );
}

export function normalizePaymentMethod(method) {
  return String(method || "").trim().toLowerCase();
}

export function isWalletPaymentMethod(method) {
  const m = normalizePaymentMethod(method);
  return m === "easypaisa" || m === "jazzcash";
}

/** Receipt required only for wallet payments when paying upfront. */
export function paymentReceiptRequired({ payAfterWork, paymentMethod }) {
  if (parsePayAfterWork(payAfterWork)) return false;
  return isWalletPaymentMethod(paymentMethod);
}

export function paymentMethodRequired({ payAfterWork }) {
  return !parsePayAfterWork(payAfterWork);
}

export function validatePaymentSelection({ payAfterWork, paymentMethod }) {
  if (parsePayAfterWork(payAfterWork)) {
    return { ok: true, method: PAY_AFTER_WORK_METHOD };
  }
  const pm = normalizePaymentMethod(paymentMethod);
  if (!pm || !PAYMENT_METHODS.includes(pm)) {
    return {
      ok: false,
      message:
        "Please select a payment method (JazzCash).",
    };
  }
  return { ok: true, method: pm };
}

export function buildPayToSummaryServer(method) {
  const m = normalizePaymentMethod(method);
  if (m === PAY_AFTER_WORK_METHOD) {
    return "Payment after work is completed";
  }
  if (m === "jazzcash") {
    return "JazzCash (platform wallet)";
  }
  return "";
}
