import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import Service from '../models/Service.js';
import { cacheGetOrSet } from '../utils/cache.js';

const router = express.Router();

// ─── GET /api/public/services ────────────────────────────────────────────────
// Get all active services (public endpoint - no auth required)
router.get('/', asyncHandler(async (req, res) => {
  const { category, search } = req.query;

  if (search) {
    let query = { isActive: true, $text: { $search: String(search) } };
    if (category) query.category = category;
    const services = await Service.find(query).sort({ name: 1 }).lean();
    const categories = await Service.distinct('category', { isActive: true });
    return res.json({
      success: true,
      data: {
        services: services.map(formatService),
        categories: categories.sort(),
      },
    });
  }

  const cacheKey = `fixitnow:public:services:${category || 'all'}`;
  const { value } = await cacheGetOrSet(cacheKey, 120, async () => {
    let query = { isActive: true };
    if (category) query.category = category;
    const services = await Service.find(query).sort({ name: 1 }).lean();
    const categories = await Service.distinct('category', { isActive: true });
    return {
      services: services.map(formatService),
      categories: categories.sort(),
    };
  });

  res.json({ success: true, data: value });
}));

function formatService(s) {
  return {
    id: s._id,
    name: s.name,
    description: s.description,
    category: s.category,
    icon: s.icon,
    image: s.image,
    price: s.price,
    estimatedDuration: s.estimatedDuration,
    requirements: s.requirements,
  };
}

// ─── GET /api/public/services/categories ────────────────────────────────────
router.get('/categories', asyncHandler(async (req, res) => {
  const { value } = await cacheGetOrSet('fixitnow:public:categories', 300, async () => {
    const categories = await Service.distinct('category', { isActive: true });
    return categories.sort();
  });
  res.json({ success: true, data: value });
}));

// ─── GET /api/public/services/:id ───────────────────────────────────────────
// Get single service by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const service = await Service.findById(req.params.id);
  
  if (!service) {
    return res.status(404).json({
      success: false,
      message: 'Service not found'
    });
  }
  
  res.json({
    success: true,
    data: {
      id: service._id,
      name: service.name,
      description: service.description,
      category: service.category,
      icon: service.icon,
      image: service.image,
      price: service.price,
      estimatedDuration: service.estimatedDuration,
      requirements: service.requirements,
      isActive: service.isActive
    }
  });
}));

export default router;
