import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

const router = express.Router();

const NOMINATIM_BASE =
  process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const NOMINATIM_UA =
  process.env.NOMINATIM_USER_AGENT ||
  'FixItNow/1.0 (https://fixitnow.app; support@fixitnow.app)';

const nominatimFetch = async (path, query) => {
  const url = new URL(`${NOMINATIM_BASE}${path}`);
  Object.entries(query).forEach(([k, v]) => {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  });

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent': NOMINATIM_UA,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Geocoding service returned ${response.status}`);
  }

  return response.json();
};

// ─── GET /api/geocode/reverse?lat=&lng= ────────────────────────────────────────
router.get(
  '/reverse',
  asyncHandler(async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({
        success: false,
        message: 'Valid lat and lng query parameters are required.',
      });
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ success: false, message: 'Coordinates out of range.' });
    }

    try {
      const data = await nominatimFetch('/reverse', {
        format: 'json',
        lat,
        lon: lng,
        'accept-language': 'en',
      });

      return res.json({
        success: true,
        data: {
          location: data.display_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
          latitude: lat,
          longitude: lng,
          placeId: data.place_id ? String(data.place_id) : '',
        },
      });
    } catch (err) {
      logger.warn('Reverse geocode failed', { error: err.message, lat, lng });
      return res.status(502).json({
        success: false,
        message: 'Could not resolve address for this location.',
      });
    }
  }),
);

// ─── GET /api/geocode/search?q= ────────────────────────────────────────────────
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ success: true, data: [] });
    }

    try {
      const results = await nominatimFetch('/search', {
        format: 'json',
        q,
        limit: 8,
        countrycodes: 'pk',
        'accept-language': 'en',
        addressdetails: 1,
      });

      const items = (Array.isArray(results) ? results : []).map((item) => ({
        location: item.display_name,
        latitude: Number(item.lat),
        longitude: Number(item.lon),
        placeId: item.place_id ? String(item.place_id) : '',
      }));

      return res.json({ success: true, data: items });
    } catch (err) {
      logger.warn('Place search failed', { error: err.message, q });
      return res.status(502).json({
        success: false,
        message: 'Location search is temporarily unavailable.',
      });
    }
  }),
);

export default router;
