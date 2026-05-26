import Worker from "../workerSchema.js";

/**
 * Rank workers for a booking by score (rating, experience, completion, verified, availability).
 */
export function scoreWorker(worker) {
  let score = 0;
  score += (worker.rating || 0) * 0.4;

  const experienceScore = Math.min((worker.yearsOfExperience || 0) / 10, 1) * 10;
  score += experienceScore * 0.3;

  const completionRate =
    worker.totalJobs > 0 ? (worker.completedJobs || 0) / worker.totalJobs : 0;
  score += completionRate * 10 * 0.2;

  if (["approved", "active"].includes(worker.status)) score += 1;
  if (worker.availability !== false) score += 5;

  return Math.round(score * 100) / 100;
}

export async function rankWorkersForBooking(booking) {
  const serviceCategory = booking.serviceCategory || booking.category || "";
  const categoryPattern = serviceCategory
    ? new RegExp(String(serviceCategory).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    : null;

  const query = {
    status: { $in: ["approved", "active"] },
    isDeleted: false,
    availability: { $ne: false },
  };

  if (categoryPattern) {
    query.$or = [
      { primaryServiceCategory: categoryPattern },
      { serviceCategories: categoryPattern },
    ];
  }

  const workers = await Worker.find(query)
    .select(
      "fullName phoneNumber emailAddress primaryServiceCategory yearsOfExperience rating totalJobs completedJobs availability status",
    )
    .lean();

  return workers
    .map((w) => ({
      ...w,
      rankingScore: scoreWorker(w),
      completionRate: Math.round(
        (w.totalJobs > 0 ? (w.completedJobs || 0) / w.totalJobs : 0) * 100,
      ),
    }))
    .sort((a, b) => b.rankingScore - a.rankingScore);
}

export async function pickBestWorkerForBooking(booking) {
  const ranked = await rankWorkersForBooking(booking);
  return ranked[0] || null;
}
