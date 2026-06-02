import {
  CUSTOMER_STATUS,
  CUSTOMER_STATUS_VALUES,
  WORKER_STATUS,
  WORKER_STATUS_VALUES,
} from './constants.js';

/** Admin filter: "pending" means awaiting approval (not_approved in DB). */
export function resolveWorkerListStatusFilter(status) {
  if (!status || status === 'all') return null;
  if (status === 'pending') return WORKER_STATUS.NOT_APPROVED;
  return status;
}

export function resolveCustomerListStatusFilter(status) {
  if (!status || status === 'all') return null;
  if (status === 'pending') return { kind: 'status', value: CUSTOMER_STATUS.NOT_APPROVED };
  if (status === 'active') return { kind: 'presence', value: 'active' };
  if (status === 'inactive') return { kind: 'presence', value: 'inactive' };
  if (CUSTOMER_STATUS_VALUES.includes(status)) {
    return { kind: 'status', value: status };
  }
  return null;
}

/** Build mongoose query for GET /admin/customers. */
export function buildCustomerListQuery(baseQuery, statusFilter) {
  const resolved = resolveCustomerListStatusFilter(statusFilter);
  if (!resolved) return baseQuery;
  if (resolved.kind === 'presence') {
    if (resolved.value === 'active') {
      baseQuery.isActive = true;
      baseQuery.status = { $nin: [CUSTOMER_STATUS.REJECTED] };
    } else {
      baseQuery.$or = [{ isActive: false }, { status: CUSTOMER_STATUS.INACTIVE }];
    }
    return baseQuery;
  }
  baseQuery.status = resolved.value;
  return baseQuery;
}

export function isWorkerPendingStatus(status) {
  return status === WORKER_STATUS.NOT_APPROVED;
}

export function isCustomerPendingStatus(status) {
  return status === CUSTOMER_STATUS.NOT_APPROVED;
}

export function normalizeWorkerStatusInput(status) {
  if (status === 'pending') return WORKER_STATUS.NOT_APPROVED;
  if (status && WORKER_STATUS_VALUES.includes(status)) return status;
  return status;
}

export function normalizeCustomerStatusInput(status) {
  if (status === 'pending') return CUSTOMER_STATUS.NOT_APPROVED;
  if (status && CUSTOMER_STATUS_VALUES.includes(status)) return status;
  return status;
}
