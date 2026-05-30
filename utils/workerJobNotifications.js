import Worker from "../workerSchema.js";
import { calculateRankScore } from "./jobMatching.js";
import { emitToUser } from "./socketManager.js";
import { createNotification } from "./createNotification.js";
import logger from "./logger.js";

/** Minimum composite match score for a "high priority" new-job alert. */
export const HIGH_PRIORITY_MIN_SCORE = 40;

export function isHighPriorityJobForWorker(worker, booking) {
  const result = calculateRankScore(worker, booking);
  const meta = result._matchMeta || {};
  if (meta.exactService || meta.sameCategory) return true;
  return !result._demoted && result._matchScore >= HIGH_PRIORITY_MIN_SCORE;
}

/**
 * Notify workers with a strong match when a booking becomes available (approved, unassigned).
 */
export async function notifyWorkersOfHighPriorityJob(booking) {
  if (!booking || booking.workerId || booking.status !== "approved") {
    return;
  }

  const workers = await Worker.find({
    isDeleted: false,
    isDisabled: { $ne: true },
    availability: true,
    status: { $in: ["approved", "active"] },
  })
    .select(
      "primaryServiceCategory primaryServiceName serviceCategories location serviceArea address latitude longitude",
    )
    .lean();

  await Promise.all(
    workers.map(async (worker) => {
      try {
        if (!isHighPriorityJobForWorker(worker, booking)) return;

        const score = calculateRankScore(worker, booking)._matchScore;
        const workerId = String(worker._id);
        const title = booking.serviceTitle || "Service";

        emitToUser(workerId, "new-booking", {
          id: booking._id,
          bookingId: booking._id,
          serviceTitle: title,
          category: booking.category,
          message: `High-match job: ${title}`,
          _matchScore: score,
        });

        await createNotification({
          userId: worker._id,
          userRole: "worker",
          title: "New job available",
          message: `Strong match for you: ${title}. Open your dashboard to view it.`,
          type: "urgent",
          relatedEntityId: booking._id,
          link: "",
          pushOptions: { urgency: "high" },
        });
      } catch (err) {
        logger.warn("Worker high-priority job notify failed", {
          workerId: worker._id,
          error: err?.message,
        });
      }
    }),
  );
}
