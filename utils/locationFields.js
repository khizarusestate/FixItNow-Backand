/**
 * Shared location helpers for customer, worker, and booking documents.
 */

export const geoLocationSchemaFields = {
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  placeId: { type: String, default: "", trim: true },
};

/** Effective location label from a document (supports legacy fields). */
export function getLocationLabel(doc) {
  if (!doc) return "";
  return (
    (doc.location || "").trim() ||
    (doc.address || "").trim() ||
    (doc.serviceArea || "").trim()
  );
}

/** Parse location body from API request. */
export function parseLocationBody(body = {}) {
  const location =
    body.location !== undefined
      ? String(body.location || "").trim()
      : body.serviceArea !== undefined
        ? String(body.serviceArea || "").trim()
        : body.address !== undefined
          ? String(body.address || "").trim()
          : undefined;

  const latitude =
    body.latitude !== undefined && body.latitude !== null && body.latitude !== ""
      ? Number(body.latitude)
      : undefined;
  const longitude =
    body.longitude !== undefined &&
    body.longitude !== null &&
    body.longitude !== ""
      ? Number(body.longitude)
      : undefined;
  const placeId =
    body.placeId !== undefined ? String(body.placeId || "").trim() : undefined;

  return { location, latitude, longitude, placeId };
}

/** Apply parsed location fields to a mongoose update object. */
export function applyLocationUpdate(updateFields, body) {
  const { location, latitude, longitude, placeId } = parseLocationBody(body);

  if (location !== undefined) {
    updateFields.location = location;
    // Legacy mirrors for existing queries / job matching
    updateFields.serviceArea = location;
    updateFields.address = location;
  }
  if (latitude !== undefined && !Number.isNaN(latitude)) {
    updateFields.latitude = latitude;
  }
  if (longitude !== undefined && !Number.isNaN(longitude)) {
    updateFields.longitude = longitude;
  }
  if (placeId !== undefined) {
    updateFields.placeId = placeId;
  }

  return updateFields;
}

export function formatLocationResponse(doc) {
  const label = getLocationLabel(doc);
  return {
    location: label,
    latitude: doc?.latitude ?? null,
    longitude: doc?.longitude ?? null,
    placeId: doc?.placeId || "",
    // Legacy aliases for gradual frontend migration
    address: label,
    serviceArea: doc?.serviceArea || label,
  };
}
