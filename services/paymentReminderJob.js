import Booking from "../bookingSchema.js";
import { notifyAllAdmins } from "../utils/createNotification.js";
import { emitToAdmin } from "../utils/socketManager.js";
import logger from "../utils/logger.js";

const HOURS_MS = 24 * 60 * 60 * 1000;

function isPayAfterWorkBooking(booking) {
  const pd = booking?.paymentDetails || {};
  return Boolean(
    pd.payAfterWork || String(pd.paymentMethod || "").toLowerCase() === "pay-after-work",
  );
}

/** Notify admins once when pay-after-work payment is still missing 24h after worker marked done. */
export async function runPayAfterWorkReminders() {
  const cutoff = new Date(Date.now() - HOURS_MS);

  const due = await Booking.find({
    isDeleted: false,
    workerMarkedDone: true,
    workerMarkedDoneAt: { $lte: cutoff, $ne: null },
    $or: [
      { "paymentDetails.payAfterWork": true },
      { "paymentDetails.paymentMethod": "pay-after-work" },
    ],
    "paymentDetails.paymentReceived": { $ne: true },
    $or: [
      { "paymentDetails.paymentReminderSentAt": null },
      { "paymentDetails.paymentReminderSentAt": { $exists: false } },
    ],
  })
    .select("serviceTitle customerName price workerMarkedDoneAt paymentDetails")
    .lean();

  if (!due.length) return 0;

  let sent = 0;
  for (const booking of due) {
    if (!isPayAfterWorkBooking(booking)) continue;

    const title = "Payment reminder";
    const message = `Pay-after-work booking "${booking.serviceTitle}" (${booking.customerName || "Customer"}) — worker marked done over 24 hours ago. Please confirm payment received.`;

    await notifyAllAdmins({
      title,
      message,
      type: "warning",
      relatedEntityId: booking._id,
      link: "#bookings",
    });

    emitToAdmin("notification-new", {
      title,
      message,
      type: "warning",
      relatedEntityId: booking._id,
      link: "#bookings",
    });

    await Booking.updateOne(
      { _id: booking._id },
      {
        $set: { "paymentDetails.paymentReminderSentAt": new Date() },
      },
    );
    sent += 1;
  }

  if (sent > 0) {
    logger.info("Pay-after-work payment reminders sent", { count: sent });
  }
  return sent;
}

export function startPayAfterWorkReminderScheduler() {
  const tick = () => {
    runPayAfterWorkReminders().catch((err) => {
      logger.warn("Pay-after-work reminder job failed", { error: err.message });
    });
  };
  tick();
  const interval = setInterval(tick, 60 * 60 * 1000);
  return () => clearInterval(interval);
}
