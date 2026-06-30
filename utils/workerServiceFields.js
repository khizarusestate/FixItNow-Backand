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

/** Resolve worker services array from request body. */
export async function resolveWorkerServicesArray(body = {}) {
  let raw = body.services;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    const primary = await resolveWorkerServiceFields(body);
    if (primary.primaryServiceId) {
      return [
        {
          serviceId: primary.primaryServiceId,
          serviceName: primary.primaryServiceName,
          serviceCategory: primary.primaryServiceCategory,
        },
      ];
    }
    return [];
  }

  const resolved = [];
  for (const entry of raw.slice(0, 5)) {
    const fields = await resolveWorkerServiceFields({
      primaryServiceId: entry.serviceId || entry.primaryServiceId,
      primaryServiceName: entry.serviceName || entry.primaryServiceName,
      primaryServiceCategory: entry.serviceCategory || entry.primaryServiceCategory,
    });
    if (fields.primaryServiceId || fields.primaryServiceName) {
      resolved.push({
        serviceId: fields.primaryServiceId,
        serviceName: fields.primaryServiceName,
        serviceCategory: fields.primaryServiceCategory,
      });
    }
  }
  return resolved;
}

/** Apply services array to worker document; sets primary from first service. */
export function applyWorkerServices(worker, services = []) {
  if (!services.length) return;
  worker.services = services;
  const primary = services[0];
  worker.primaryServiceId = primary.serviceId || null;
  worker.primaryServiceName = primary.serviceName || "";
  worker.primaryServiceCategory = primary.serviceCategory || "";
  worker.serviceCategories = [
    ...new Set(services.map((s) => s.serviceCategory).filter(Boolean)),
  ];
}

export function formatWorkerServiceLabel(worker) {
  const cat = worker?.primaryServiceCategory || "";
  const name = worker?.primaryServiceName || "";
  if (cat && name) return `${cat} - ${name}`;
  return cat || name || "";
}
