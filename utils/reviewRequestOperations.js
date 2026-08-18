'use strict';

const logger = require('./logger');

const ACTIVE_STATUSES = new Set(['pending', 'sent', 'opened']);
const KNOWN_STATUSES = new Set(['pending', 'sent', 'opened', 'completed', 'failed', 'expired']);
const REVIEW_REQUEST_COOLDOWN_DAYS = 30;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function maintenanceIsEnabled() {
  const configured = process.env.REVIEW_REQUEST_MAINTENANCE_ENABLED;
  if (configured !== undefined) {
    return configured !== 'false' && configured !== '0';
  }
  return process.env.NODE_ENV === 'production';
}

function initialiseReviewRequestMaintenance({ service, log = logger } = {}) {
  if (!maintenanceIsEnabled()) {
    return null;
  }

  try {
    const maintenanceService = service || require('../services/reviewRequestMaintenance.service');
    return maintenanceService.scheduleMaintenance({ log });
  } catch (error) {
    log.warn('[review-request-maintenance] Scheduler failed to initialise:', error.message);
    return null;
  }
}

function parseDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normaliseNow(now) {
  const value = parseDate(now);
  return value || new Date();
}

function getEffectiveStatus(request, now = new Date()) {
  const status = KNOWN_STATUSES.has(request && request.status) ? request.status : 'failed';
  if (!ACTIVE_STATUSES.has(status)) {
    return status;
  }
  const expiry = parseDate(request && request.expiresAt);
  return !expiry || expiry <= normaliseNow(now) ? 'expired' : status;
}

function getCooldownEnd(request) {
  const completedAt = parseDate(request && (request.completedAt || request.createdAt));
  if (!completedAt) {
    return null;
  }
  return new Date(completedAt.getTime() + REVIEW_REQUEST_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
}

function getRetryState(request, now = new Date()) {
  const currentTime = normaliseNow(now);
  const status = getEffectiveStatus(request, currentTime);

  if (status === 'failed' || status === 'expired') {
    return { retryable: true, retryAt: null, retryReason: status };
  }

  if (status === 'completed') {
    const cooldownEnd = getCooldownEnd(request);
    if (!cooldownEnd || cooldownEnd <= currentTime) {
      return {
        retryable: true,
        retryAt: cooldownEnd ? cooldownEnd.toISOString() : null,
        retryReason: 'cooldown-complete',
      };
    }
    return {
      retryable: false,
      retryAt: cooldownEnd.toISOString(),
      retryReason: 'cooldown',
    };
  }

  return {
    retryable: false,
    retryAt: request && request.expiresAt ? request.expiresAt : null,
    retryReason: 'active',
  };
}

function trimText(value, maxLength = 300) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function baseItem(request, now) {
  const status = getEffectiveStatus(request, now);
  return {
    id: request.id || (request._id ? String(request._id) : null),
    customerEmail: trimText(request.customerEmail, 254),
    customerName: trimText(request.customerName, 120),
    status,
    deliveryStatus: trimText(request.deliveryStatus || status, 80),
    createdAt: request.createdAt || null,
    updatedAt: request.updatedAt || null,
    sentAt: request.sentAt || null,
    openedAt: request.openedAt || null,
    completedAt: request.completedAt || null,
    failedAt: request.failedAt || null,
    expiredAt: request.expiredAt || null,
    expiresAt: request.expiresAt || null,
    reviewId: request.reviewId || null,
    ...getRetryState(request, now),
  };
}

function toSupplierItem(request, now) {
  const item = baseItem(request, now);
  return {
    ...item,
    lastError:
      item.status === 'failed' ? 'Email delivery failed. You can safely retry this request.' : null,
  };
}

function toAdminItem(request, now) {
  return {
    ...baseItem(request, now),
    supplierId: request.supplierId || null,
    supplierName: trimText(request.supplierName, 160),
    supplierOwnerUserId: request.supplierOwnerUserId || null,
    threadId: request.threadId || null,
    deliveryProvider: trimText(request.deliveryProvider, 80),
    providerMessageId: request.providerMessageId || null,
    emailLogId: request.emailLogId || null,
    lastError: request.lastError ? trimText(request.lastError, 500) : null,
  };
}

function summarise(records, now = new Date()) {
  const counts = {
    total: 0,
    active: 0,
    pending: 0,
    sent: 0,
    opened: 0,
    completed: 0,
    failed: 0,
    expired: 0,
    deliveryIssues: 0,
    conversionRate: 0,
  };

  (records || []).forEach(request => {
    const status = getEffectiveStatus(request, now);
    counts.total += 1;
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }
    if (ACTIVE_STATUSES.has(status)) {
      counts.active += 1;
    }
    if (status === 'failed' || status === 'expired') {
      counts.deliveryIssues += 1;
    }
  });

  const resolved = counts.completed + counts.failed + counts.expired;
  counts.conversionRate = resolved ? Math.round((counts.completed / resolved) * 1000) / 10 : 0;
  return counts;
}

function normalisePage(value) {
  const page = Number.parseInt(value, 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function normaliseLimit(value) {
  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(limit, MAX_LIMIT);
}

function paginate(items, query) {
  const page = normalisePage(query.page);
  const limit = normaliseLimit(query.limit);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  return {
    items: items.slice(start, start + limit),
    pagination: { page: safePage, limit, total, totalPages },
  };
}

function sortNewestFirst(items) {
  return items.sort((a, b) => {
    const aTime = parseDate(a.createdAt || a.updatedAt);
    const bTime = parseDate(b.createdAt || b.updatedAt);
    return (bTime ? bTime.getTime() : 0) - (aTime ? aTime.getTime() : 0);
  });
}

function listSupplierRequests(records, query = {}, now = new Date()) {
  const all = records || [];
  const requestedStatus = trimText(query.status, 40).toLowerCase();
  const search = trimText(query.search, 160).toLowerCase();
  let items = all.map(request => toSupplierItem(request, now));

  if (KNOWN_STATUSES.has(requestedStatus)) {
    items = items.filter(item => item.status === requestedStatus);
  }
  if (search) {
    items = items.filter(item =>
      `${item.customerEmail} ${item.customerName}`.toLowerCase().includes(search)
    );
  }

  return {
    summary: summarise(all, now),
    ...paginate(sortNewestFirst(items), query),
  };
}

function listAdminRequests(records, query = {}, now = new Date()) {
  const all = records || [];
  const requestedStatus = trimText(query.status, 40).toLowerCase();
  const recipient = trimText(query.recipient, 160).toLowerCase();
  const supplier = trimText(query.supplier, 160).toLowerCase();
  let items = all.map(request => toAdminItem(request, now));

  if (KNOWN_STATUSES.has(requestedStatus)) {
    items = items.filter(item => item.status === requestedStatus);
  }
  if (recipient) {
    items = items.filter(item =>
      `${item.customerEmail} ${item.customerName}`.toLowerCase().includes(recipient)
    );
  }
  if (supplier) {
    items = items.filter(item =>
      `${item.supplierName} ${item.supplierId}`.toLowerCase().includes(supplier)
    );
  }

  return {
    summary: summarise(all, now),
    ...paginate(sortNewestFirst(items), query),
  };
}

module.exports = {
  ACTIVE_STATUSES,
  KNOWN_STATUSES,
  REVIEW_REQUEST_COOLDOWN_DAYS,
  getCooldownEnd,
  getEffectiveStatus,
  getRetryState,
  initialiseReviewRequestMaintenance,
  listAdminRequests,
  listSupplierRequests,
  maintenanceIsEnabled,
  summarise,
  toAdminItem,
  toSupplierItem,
};
