import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import Worker from '../workerSchema.js';

const router = express.Router();

const SERVICE_CATEGORIES = [
  { id: 'cleaning', label: 'Cleaning', icon: 'Sparkles' },
  { id: 'home-repair', label: 'Home Repair', icon: 'Hammer' },
  { id: 'electrical', label: 'Electrical', icon: 'Zap' },
  { id: 'plumbing', label: 'Plumbing', icon: 'Droplets' },
  { id: 'automotive', label: 'Automotive', icon: 'Car' },
  { id: 'it-support', label: 'IT Support', icon: 'Monitor' },
  { id: 'other', label: 'Other', icon: 'HelpCircle' }
];

// ─── GET /api/services ────────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const { category } = req.query;

  if (category) {
    const categoryMeta = SERVICE_CATEGORIES.find((c) => c.id === category);
    const categoryLabel = categoryMeta?.label || category;
    const categoryPattern = new RegExp(`^${categoryLabel}$`, 'i');
    const workers = await Worker.find({
      status: 'approved',
      isDeleted: false,
      $or: [
        { primaryServiceCategory: categoryPattern },
        { serviceCategories: categoryPattern },
        { primaryServiceCategory: new RegExp(`^${category}$`, 'i') },
      ],
    })
      .select('fullName primaryServiceCategory serviceArea address availability profilePicture joinDate')
      .sort({ rating: -1, totalJobs: -1 })
      .lean();

    return res.json({
      success: true,
      data: {
        category,
        workers
      }
    });
  }

  // Get worker counts per category
  const counts = await Worker.aggregate([
    { $match: { status: 'approved', isDeleted: false } },
    { $group: { _id: '$primaryServiceCategory', count: { $sum: 1 } } },
  ]);

  const countMap = {};
  counts.forEach((c) => {
    if (c._id) countMap[String(c._id).toLowerCase()] = c.count;
  });

  const categories = SERVICE_CATEGORIES.map((cat) => ({
    ...cat,
    workerCount: countMap[cat.label.toLowerCase()] || countMap[cat.id.toLowerCase()] || 0,
  }));

  return res.json({
    success: true,
    data: categories
  });
}));

export default router;
