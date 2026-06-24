import Service from "../models/Service.js";

/** Resolve worker trade fields from DB service id or legacy category string. */
export async function resolveWorkerServiceFields(body = {}) {
  const {
    primaryServiceId,
    primaryServiceName,
    primaryServiceCategory,
    serviceCategory,
  } = body;

  if (primaryServiceId) {
    const svc = await Service.findOne({
      _id: primaryServiceId,
      isActive: true,
    }).lean();
    if (svc) {
      return {
        primaryServiceId: svc._id,
        primaryServiceName: svc.name,
        primaryServiceCategory: svc.category,
      };
    }
  }

  const category = String(
    primaryServiceCategory || serviceCategory || "",
  ).trim();
  const name = String(primaryServiceName || "").trim();

  if (name && !category) {
    const svc = await Service.findOne({
      name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
      isActive: true,
    }).lean();
    if (svc) {
      return {
        primaryServiceId: svc._id,
        primaryServiceName: svc.name,
        primaryServiceCategory: svc.category,
      };
    }
  }

  return {
    primaryServiceId: primaryServiceId || null,
    primaryServiceName: name,
    primaryServiceCategory: category,
  };
}

export function formatWorkerServiceLabel(worker) {
  const cat = worker?.primaryServiceCategory || "";
  const name = worker?.primaryServiceName || "";
  if (cat && name) return `${cat} - ${name}`;
  return cat || name || "";
}
