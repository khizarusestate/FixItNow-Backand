import Worker from "../workerSchema.js";
import {
  getJobMatchPriority,
  calculateRankScore,
} from "./jobMatching.js";
import { emitToUser } from "./socketManager.js";
import { createNotification } from "./createNotification.js";
import logger from "./logger.js";

/** Minimum composite match score for a "high priority" new-job alert. */
export const HIGH_PRIORITY_MIN_SCORE = 40;

export function isHighPriorityJobForWorker(worker, booking) {
  const priority = getJobMatchPriority(worker, booking);
  return priority.tier === "high" || priority.tier === "very-high";
}

export function isVeryHighPriorityJobForWorker(worker, booking) {
  return getJobMatchPriority(worker, booking).tier === "very-high";
}

/**
 * Notify workers with a strong match when a booking becomes available.
 */
export async function notifyWorkersOfHighPriorityJob(booking) {
  if (!booking || booking.workerId) {
    return;
  }
  const openStatuses = ["open", "approved", "pending"];
  if (!openStatuses.includes(booking.status)) {
    return;
  }

  const workers = await Worker.find({
    isDeleted: false,
    isDisabled: { $ne: true },
    availability: true,
    status: { $in: ["approved", "active", "inactive"] },
  })
    .select(
      "primaryServiceCategory primaryServiceName primaryServiceId services serviceCategories location serviceArea address latitude longitude",
    )
    .lean();

  await Promise.all(
    workers.map(async (worker) => {
      try {
        const priority = getJobMatchPriority(worker, booking);
        if (priority.tier === "low") return;

        const score = calculateRankScore(worker, booking)._matchScore;
        const workerId = String(worker._id);
        const title = booking.serviceTitle || "Service";
        const isVeryHigh = priority.tier === "very-high";

        emitToUser(workerId, "new-booking", {
          id: booking._id,
          bookingId: booking._id,
          serviceTitle: title,
          category: booking.category,
          message: `${priority.label} priority job: ${title}`,
          _matchScore: score,
          _matchPriority: priority,
        });

        await createNotification({
          userId: worker._id,
          userRole: "worker",
          title: isVeryHigh
            ? "New Very High Priority Job"
            : "New High Priority Job",
          message: `${priority.label} match: ${title}. Open your dashboard to view it.`,
          type: "urgent",
          relatedEntityId: booking._id,
          link: "",
          pushOptions: { urgency: isVeryHigh ? "very-high" : "high" },
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
