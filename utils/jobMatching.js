import { getLocationLabel } from "./locationFields.js";

// ─── Ranking weights & geo tuning ───────────────────────────────────────────
const EARTH_RADIUS_KM = 6371;
const GEO_DECAY_TAU_KM = 8;
const DEFAULT_MAX_RADIUS_KM = 100;
const WEIGHT_LOCATION = 0.55;
const WEIGHT_SERVICE = 0.35;
const WEIGHT_URGENCY = 0.1;

/** Related service labels (normalized keys) */
const CATEGORY_SYNONYMS = {
  "computer repair": [
    "computer repair",
    "it support",
    "it services",
    "technical support",
    "computer services",
    "laptop repair",
    "pc repair",
  ],
  "home repair": [
    "home repair",
    "home maintenance",
    "repair services",
    "handyman",
    "maintenance",
  ],
  electrical: [
    "electrical",
    "electrical services",
    "electrician",
    "electrical repair",
    "wiring",
  ],
  plumbing: [
    "plumbing",
    "plumber",
    "plumbing services",
    "pipe repair",
    "drain cleaning",
  ],
  cleaning: [
    "cleaning",
    "cleaning services",
    "house cleaning",
    "office cleaning",
    "maid service",
  ],
  automotive: [
    "automotive",
    "car repair",
    "auto repair",
    "mechanic",
    "vehicle maintenance",
  ],
  painting: [
    "painting",
    "painter",
    "painting services",
    "wall painting",
    "exterior painting",
  ],
};

// ─── Location parsing (text fallback) ───────────────────────────────────────

/**
 * Parse a comma-separated location string into city and area.
 * E.g. "Gujranwala, Model Town" -> { city: 'gujranwala', area: 'model town' }
 */
export function parseLocation(locationStr) {
  if (!locationStr || typeof locationStr !== "string") {
    return { city: "", area: "" };
  }
  const parts = locationStr
    .split(/,\s*/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    city: parts[0] || "",
    area: parts[1] || "",
  };
}

function normalizeServiceKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isValidCoord(lat, lng) {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function getCoords(doc) {
  if (!doc) return null;
  const lat = doc.latitude;
  const lng = doc.longitude;
  return isValidCoord(lat, lng) ? { lat, lng } : null;
}

/**
 * Haversine distance in kilometres.
 */
export function distanceKm(from, to) {
  if (!from || !to) return null;
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const Δφ = ((to.lat - from.lat) * Math.PI) / 180;
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function expandWorkerServices(worker) {
  const category = normalizeServiceKey(worker.primaryServiceCategory);
  const serviceName = normalizeServiceKey(worker.primaryServiceName);
  const composite =
    category && serviceName
      ? normalizeServiceKey(`${worker.primaryServiceCategory} - ${worker.primaryServiceName}`)
      : "";
  const primary = category || serviceName || composite;
  const extra = (worker.serviceCategories || [])
    .map(normalizeServiceKey)
    .filter(Boolean);
  const base = [...new Set([primary, category, serviceName, composite, ...extra])].filter(Boolean);
  const expanded = new Set(base);
  for (const key of base) {
    const synonyms = CATEGORY_SYNONYMS[key] || [];
    for (const syn of synonyms) {
      expanded.add(normalizeServiceKey(syn));
    }
  }
  return { primary, all: expanded };
}

function bookingServiceKeys(booking) {
  return [
    normalizeServiceKey(booking.serviceCategory),
    normalizeServiceKey(booking.category),
    normalizeServiceKey(booking.serviceTitle),
  ].filter(Boolean);
}

/**
 * Service relevance 0–100.
 */
export function getServiceMatchScore(worker, booking) {
  const workerCategory = normalizeServiceKey(worker.primaryServiceCategory);
  const workerServiceName = normalizeServiceKey(worker.primaryServiceName);
  const workerComposite =
    workerCategory && workerServiceName
      ? normalizeServiceKey(
          `${worker.primaryServiceCategory} - ${worker.primaryServiceName}`,
        )
      : "";

  const bookingTitle = normalizeServiceKey(booking.serviceTitle);
  const bookingCategory = normalizeServiceKey(
    booking.serviceCategory || booking.category,
  );

  if (workerServiceName && bookingTitle && workerServiceName === bookingTitle) {
    return {
      score: 100,
      exactService: true,
      sameCategory: true,
      relatedService: false,
      partialService: false,
    };
  }

  if (
    workerComposite &&
    bookingTitle &&
    (workerComposite === bookingTitle ||
      bookingTitle.includes(workerServiceName))
  ) {
    return {
      score: 100,
      exactService: true,
      sameCategory: true,
      relatedService: false,
      partialService: false,
    };
  }

  if (
    workerCategory &&
    bookingCategory &&
    workerCategory === bookingCategory
  ) {
    return {
      score: 90,
      exactService: false,
      sameCategory: true,
      relatedService: true,
      partialService: false,
    };
  }

  const { primary, all } = expandWorkerServices(worker);
  if (all.size === 0) return {
    score: 0,
    exactService: false,
    sameCategory: false,
    relatedService: false,
    partialService: false,
  };

  const keys = bookingServiceKeys(booking);
  if (keys.length === 0) return {
    score: 0,
    exactService: false,
    sameCategory: false,
    relatedService: false,
    partialService: false,
  };

  for (const key of keys) {
    if (key === primary || key === workerServiceName || key === workerComposite) {
      return {
        score: 100,
        exactService: true,
        sameCategory: Boolean(workerCategory && bookingCategory && workerCategory === bookingCategory),
        relatedService: false,
        partialService: false,
      };
    }
  }

  for (const key of keys) {
    if (all.has(key)) {
      return {
        score: 70,
        exactService: false,
        sameCategory: false,
        relatedService: true,
        partialService: false,
      };
    }
  }

  for (const key of keys) {
    for (const ws of all) {
      if (key.includes(ws) || ws.includes(key)) {
        return {
          score: 40,
          exactService: false,
          sameCategory: false,
          relatedService: false,
          partialService: true,
        };
      }
    }
    const keyWords = key.split(/\s+/).filter((w) => w.length > 2);
    for (const ws of all) {
      const wsWords = ws.split(/\s+/).filter((w) => w.length > 2);
      const wordHit = keyWords.some((w) =>
        wsWords.some((tw) => tw.includes(w) || w.includes(tw)),
      );
      if (wordHit) {
        return {
          score: 40,
          exactService: false,
          sameCategory: false,
          relatedService: false,
          partialService: true,
        };
      }
    }
  }

  const bookingTokens = keys
    .join(" ")
    .split(/\s+/)
    .map((token) => normalizeServiceKey(token))
    .filter((token) => token.length > 2);

  for (const token of bookingTokens) {
    for (const ws of all) {
      if (ws.includes(token) || token.includes(ws)) {
        return {
          score: 40,
          exactService: false,
          sameCategory: false,
          relatedService: false,
          partialService: true,
        };
      }
    }
  }

  return {
    score: 0,
    exactService: false,
    sameCategory: false,
    relatedService: false,
    partialService: false,
  };
}

/**
 * Location score 0–100 (geo preferred, text fallback).
 */
export function getLocationMatchScore(worker, booking, distanceKmValue = null) {
  const workerCoords = getCoords(worker);
  const bookingCoords = getCoords(booking);

  if (workerCoords && bookingCoords) {
    const d =
      distanceKmValue != null
        ? distanceKmValue
        : distanceKm(workerCoords, bookingCoords);
    const score = 100 * Math.exp(-d / GEO_DECAY_TAU_KM);
    return {
      score: Math.round(score * 100) / 100,
      distanceKm: Math.round(d * 100) / 100,
      sameCity: false,
      sameArea: false,
      locationMode: "geo",
      approximateLocation: false,
    };
  }

  const workerLoc = parseLocation(getLocationLabel(worker));
  const bookingLoc = parseLocation(getLocationLabel(booking));

  let score = 0;
  let sameCity = false;
  let sameArea = false;

  if (workerLoc.city && bookingLoc.city && workerLoc.city === bookingLoc.city) {
    sameCity = true;
    score = 50;
  }
  if (workerLoc.area && bookingLoc.area && workerLoc.area === bookingLoc.area) {
    sameArea = true;
    score = sameCity ? 80 : 20;
  } else if (!workerLoc.city && !bookingLoc.city) {
    score = 10;
  }

  return {
    score,
    distanceKm: null,
    sameCity,
    sameArea,
    locationMode: "text",
    approximateLocation: true,
  };
}

/**
 * Urgency 0–100 — newer bookings score higher.
 */
export function getUrgencyScore(createdAt) {
  if (!createdAt) return 0;
  const ageHours =
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  if (ageHours < 0) return 100;
  return Math.round(100 * Math.exp(-ageHours / 24) * 100) / 100;
}

/**
 * Whether a job would have been hidden under the old filter rules.
 */
export function wouldDemoteJob(worker, booking, options = {}) {
  const maxRadiusKm = options.maxRadiusKm ?? DEFAULT_MAX_RADIUS_KM;
  const service = getServiceMatchScore(worker, booking);
  if (service.exactService || service.sameCategory) return false;
  if (service.score === 0) return true;

  const workerCoords = getCoords(worker);
  const bookingCoords = getCoords(booking);
  if (workerCoords && bookingCoords && maxRadiusKm > 0) {
    const d = distanceKm(workerCoords, bookingCoords);
    if (d > maxRadiusKm) return true;
  }
  return false;
}

/**
 * Composite rank R(j) = 0.55·L + 0.35·S + 0.10·U
 * All jobs are scored; none are dropped.
 */
export function calculateRankScore(worker, booking, options = {}) {
  const service = getServiceMatchScore(worker, booking);

  const workerCoords = getCoords(worker);
  const bookingCoords = getCoords(booking);
  let dist = null;
  if (workerCoords && bookingCoords) {
    dist = distanceKm(workerCoords, bookingCoords);
  }

  const location = getLocationMatchScore(worker, booking, dist);
  const urgency = getUrgencyScore(booking.createdAt);

  const rankScore =
    Math.round(
      (WEIGHT_LOCATION * location.score +
        WEIGHT_SERVICE * service.score +
        WEIGHT_URGENCY * urgency) *
        100,
    ) / 100;

  const demoted = wouldDemoteJob(worker, booking, options);

  return {
    rankScore,
    _matchScore: rankScore,
    _distanceKm: location.distanceKm,
    _demoted: demoted,
    _matchMeta: {
      rankScore,
      distanceKm: location.distanceKm,
      locationScore: location.score,
      serviceScore: service.score,
      urgencyScore: urgency,
      locationMode: location.locationMode,
      approximateLocation: location.approximateLocation,
      exactService: service.exactService,
      sameCategory: service.sameCategory,
      relatedService: service.relatedService,
      partialService: service.partialService,
      sameCity: location.sameCity,
      sameArea: location.sameArea,
      demoted,
    },
  };
}

function matchTier(job) {
  if (job._matchMeta?.exactService) return 3;
  if (job._matchMeta?.sameCategory) return 2;
  if (!job._demoted) return 1;
  return 0;
}

function compareRankedJobs(a, b) {
  const tierDiff = matchTier(b) - matchTier(a);
  if (tierDiff !== 0) return tierDiff;

  const aDemoted = Boolean(a._demoted);
  const bDemoted = Boolean(b._demoted);
  if (aDemoted !== bDemoted) return aDemoted ? 1 : -1;

  const rankDiff = (b._matchScore ?? 0) - (a._matchScore ?? 0);
  if (rankDiff !== 0) return rankDiff;

  const distA = a._distanceKm ?? Number.POSITIVE_INFINITY;
  const distB = b._distanceKm ?? Number.POSITIVE_INFINITY;
  if (distA !== distB) return distA - distB;

  const serviceDiff =
    (b._matchMeta?.serviceScore ?? 0) - (a._matchMeta?.serviceScore ?? 0);
  if (serviceDiff !== 0) return serviceDiff;

  return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
}

/**
 * Rank all bookings for a worker (location + service + urgency).
 * Previously filtered jobs are demoted to the end, not removed.
 */
export function rankBookingsForWorker(worker, bookings, options = {}) {
  const scored = bookings.map((booking) => {
    const result = calculateRankScore(worker, booking, options);
    return {
      ...booking,
      _matchScore: result._matchScore,
      _distanceKm: result._distanceKm,
      _demoted: result._demoted,
      _matchMeta: result._matchMeta,
    };
  });

  scored.sort(compareRankedJobs);
  return scored;
}

/**
 * Sanitize a booking for worker browsing (available jobs view).
 */
export function sanitizeBookingForWorker(booking) {
  return {
    id: booking._id?.toString ? booking._id.toString() : booking._id,
    serviceTitle: booking.serviceTitle,
    category: booking.category,
    serviceCategory: booking.serviceCategory,
    notes: booking.notes,
    status: booking.status,
    location: getLocationLabel(booking),
    address: getLocationLabel(booking),
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    _matchScore: booking._matchScore,
    _distanceKm: booking._distanceKm ?? null,
    _demoted: booking._demoted ?? false,
    _matchMeta: booking._matchMeta,
  };
}

/**
 * Response shape for /api/worker-jobs/available (includes contact fields).
 */
function parseAreaFromLocation(booking) {
  const label = getLocationLabel(booking);
  const { area, city } = parseLocation(label);
  return area || city || label || "";
}

export function formatAvailableJobForWorker(booking, customer = null) {
  const isGuest = Boolean(booking.isGuest);
  const customerName =
    booking.customerName?.trim() ||
    customer?.fullName?.trim() ||
    (isGuest ? "Guest" : "");
  return {
    id: booking._id?.toString ? booking._id.toString() : booking._id,
    serviceTitle: booking.serviceTitle,
    category: booking.category,
    serviceCategory: booking.serviceCategory,
    customerName,
    isGuest,
    area: parseAreaFromLocation(booking),
    price: booking.price,
    commissionAmount: Math.round((booking.price || 0) * 0.2),
    status: booking.status,
    createdAt: booking.createdAt,
    _matchScore: booking._matchScore,
    _distanceKm: booking._distanceKm ?? null,
    _demoted: booking._demoted ?? false,
    _matchMeta: booking._matchMeta,
  };
}

/**
 * Sanitize a booking for worker assigned jobs view.
 */
export function sanitizeAssignedBooking(booking) {
  return {
    id: booking._id?.toString ? booking._id.toString() : booking._id,
    customerName: booking.customerName,
    phone: booking.phone,
    serviceTitle: booking.serviceTitle,
    category: booking.category,
    location: getLocationLabel(booking),
    address: getLocationLabel(booking),
    notes: booking.notes,
    status: booking.status,
    assignedAt: booking.assignedAt,
    timeline: booking.timeline,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
}
