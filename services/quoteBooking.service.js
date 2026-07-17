'use strict';

const crypto = require('crypto');
const { assertDateRange } = require('./availability.service');

const QUOTE_STATES = Object.freeze({
  DRAFT: 'draft',
  SENT: 'sent',
  VIEWED: 'viewed',
  REVISED: 'revised',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
  EXPIRED: 'expired',
});
const BOOKING_STATES = Object.freeze({
  PENDING_CONFIRMATION: 'pending_confirmation',
  PENDING_PAYMENT: 'pending_payment',
  CONFIRMED: 'confirmed',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  DISPUTED: 'disputed',
});
const ACTIVE_ACCEPTABLE = new Set([QUOTE_STATES.SENT, QUOTE_STATES.VIEWED, QUOTE_STATES.REVISED]);

function asNonNegativeSafeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName}_must_be_non_negative_safe_integer_minor_units`);
  }
  return value;
}

function asPositiveSafeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${fieldName}_must_be_positive_safe_integer`);
  }
  return value;
}

function safeAdd(a, b, fieldName) {
  const total = a + b;
  if (!Number.isSafeInteger(total)) {
    throw new Error(`${fieldName}_exceeds_safe_integer_range`);
  }
  return total;
}

function safeMultiply(a, b, fieldName) {
  const total = a * b;
  if (!Number.isSafeInteger(total)) {
    throw new Error(`${fieldName}_exceeds_safe_integer_range`);
  }
  return total;
}

function normaliseCurrency(value) {
  const currency = String(value || 'GBP').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error('currency_must_be_iso_4217_code');
  }
  return currency;
}

function calculateQuoteTotals(input = {}) {
  if (!Array.isArray(input.lineItems)) {
    throw new Error('lineItems_must_be_array');
  }

  const lineItems = input.lineItems.map((item, index) => {
    const quantity = asPositiveSafeInteger(item.quantity, `line_${index}_quantity`);
    const unitAmount = asNonNegativeSafeInteger(item.unitAmount, `line_${index}_unitAmount`);
    const discountAmount = asNonNegativeSafeInteger(
      item.discountAmount || 0,
      `line_${index}_discountAmount`
    );
    const lineSubtotal = safeMultiply(quantity, unitAmount, `line_${index}_subtotal`);
    if (discountAmount > lineSubtotal) {
      throw new Error(`line_${index}_discount_exceeds_subtotal`);
    }
    return { ...item, quantity, unitAmount, discountAmount, total: lineSubtotal - discountAmount };
  });

  const subtotal = lineItems.reduce(
    (sum, item, index) => safeAdd(sum, item.total, `subtotal_after_line_${index}`),
    0
  );
  const tax = asNonNegativeSafeInteger(input.tax || 0, 'tax');
  const total = safeAdd(subtotal, tax, 'total');
  const depositAmount = asNonNegativeSafeInteger(input.depositAmount || 0, 'depositAmount');
  if (depositAmount > total) {
    throw new Error('deposit_exceeds_total');
  }

  return {
    currency: normaliseCurrency(input.currency),
    lineItems,
    subtotal,
    tax,
    total,
    depositAmount,
  };
}

function canTransitionQuote(from, to) {
  const allowed = {
    [QUOTE_STATES.DRAFT]: [QUOTE_STATES.SENT, QUOTE_STATES.WITHDRAWN],
    [QUOTE_STATES.SENT]: [
      QUOTE_STATES.VIEWED,
      QUOTE_STATES.REVISED,
      QUOTE_STATES.ACCEPTED,
      QUOTE_STATES.REJECTED,
      QUOTE_STATES.WITHDRAWN,
      QUOTE_STATES.EXPIRED,
    ],
    [QUOTE_STATES.VIEWED]: [
      QUOTE_STATES.REVISED,
      QUOTE_STATES.ACCEPTED,
      QUOTE_STATES.REJECTED,
      QUOTE_STATES.WITHDRAWN,
      QUOTE_STATES.EXPIRED,
    ],
    [QUOTE_STATES.REVISED]: [
      QUOTE_STATES.VIEWED,
      QUOTE_STATES.ACCEPTED,
      QUOTE_STATES.REJECTED,
      QUOTE_STATES.WITHDRAWN,
      QUOTE_STATES.EXPIRED,
    ],
    [QUOTE_STATES.ACCEPTED]: [],
    [QUOTE_STATES.REJECTED]: [],
    [QUOTE_STATES.WITHDRAWN]: [],
    [QUOTE_STATES.EXPIRED]: [],
  };
  return (allowed[from] || []).includes(to);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function immutableQuoteSnapshot(quote) {
  if (!quote || !quote.id || !quote.supplierId || !quote.customerId) {
    throw new Error('quote_snapshot_missing_required_identity');
  }

  return deepFreeze(
    cloneJson({
      id: quote.id,
      version: quote.version,
      supplierId: quote.supplierId,
      customerId: quote.customerId,
      eventBriefId: quote.eventBriefId,
      threadId: quote.threadId,
      currency: quote.currency || 'GBP',
      lineItems: quote.lineItems || [],
      subtotal: quote.subtotal,
      tax: quote.tax,
      total: quote.total,
      depositAmount: quote.depositAmount || 0,
      paymentSchedule: quote.paymentSchedule || [],
      assumptions: quote.assumptions || '',
      inclusions: quote.inclusions || [],
      exclusions: quote.exclusions || [],
      cancellationTerms: quote.cancellationTerms || '',
      customerMessage: quote.customerMessage || '',
      expiresAt: quote.expiresAt || null,
    })
  );
}

function validateQuoteAcceptance({ quote, customerId, version, now = new Date(), availability }) {
  if (!quote || quote.customerId !== customerId) {
    return { ok: false, code: 'not_found' };
  }
  if (!ACTIVE_ACCEPTABLE.has(quote.status)) {
    return { ok: false, code: 'quote_not_active' };
  }
  if (quote.isLatestVersion === false || quote.supersededAt) {
    return { ok: false, code: 'stale_quote_version' };
  }
  if (!Number.isSafeInteger(version) || version <= 0 || quote.version !== version) {
    return { ok: false, code: 'stale_quote_version' };
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    return { ok: false, code: 'invalid_acceptance_time' };
  }
  if (quote.expiresAt) {
    const expiresAt = new Date(quote.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      return { ok: false, code: 'invalid_quote_expiry' };
    }
    if (expiresAt.getTime() <= now.getTime()) {
      return { ok: false, code: 'quote_expired' };
    }
  }
  if (!availability || availability.status === 'unknown') {
    return { ok: false, code: 'availability_unconfirmed' };
  }
  if (availability.status !== 'available') {
    return { ok: false, code: 'availability_conflict' };
  }
  return { ok: true };
}

function bookingIdempotencyKey(quoteId, version, customerId) {
  if (!quoteId || !customerId || !Number.isSafeInteger(version) || version <= 0) {
    throw new Error('booking_idempotency_key_missing_required_identity');
  }
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify({ quoteId: String(quoteId), version, customerId: String(customerId) }))
    .digest('hex');
  return `quote_accept:${digest}`;
}

function createBookingFromAcceptedQuote(quote, eventBrief, options = {}) {
  if (!quote || quote.status !== QUOTE_STATES.ACCEPTED) {
    throw new Error('quote_must_be_accepted_before_booking_creation');
  }
  if (!options.bookingId) {
    throw new Error('booking_id_is_required');
  }

  const dateRange = assertDateRange(
    eventBrief?.startDate || quote.eventDate,
    eventBrief?.endDate || eventBrief?.startDate || quote.eventEndDate || quote.eventDate,
    'event'
  );
  const snapshot = immutableQuoteSnapshot(quote);
  const hasDeposit = snapshot.depositAmount > 0;
  const requiresPlatformPayment = Boolean(options.bookingPaymentsEnabled && hasDeposit);
  const createdAt = options.now instanceof Date ? options.now : new Date();
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error('booking_created_at_is_invalid');
  }

  return {
    id: options.bookingId,
    customerId: quote.customerId,
    supplierId: quote.supplierId,
    eventBriefId: quote.eventBriefId,
    threadId: quote.threadId || eventBrief?.threadId || null,
    acceptedQuoteId: quote.id,
    acceptedQuoteVersion: quote.version,
    quoteSnapshot: snapshot,
    eventDate: dateRange.start,
    eventEndDate: dateRange.end,
    locationSnapshot: eventBrief?.location ? cloneJson(eventBrief.location) : null,
    currency: snapshot.currency,
    total: snapshot.total,
    depositAmount: snapshot.depositAmount,
    status: requiresPlatformPayment
      ? BOOKING_STATES.PENDING_PAYMENT
      : BOOKING_STATES.PENDING_CONFIRMATION,
    paymentStatus: requiresPlatformPayment
      ? 'deposit_required'
      : hasDeposit
        ? 'external_payment_required'
        : 'not_required',
    source: 'quote_acceptance',
    idempotencyKey: bookingIdempotencyKey(quote.id, quote.version, quote.customerId),
    createdAt: createdAt.toISOString(),
    auditHistory: [
      {
        action: 'booking_created_from_quote',
        at: createdAt.toISOString(),
        quoteId: quote.id,
        quoteVersion: quote.version,
      },
    ],
  };
}

function quoteBookingIndexes() {
  return [
    {
      collection: 'quotes',
      key: { quoteSeriesId: 1, version: 1 },
      options: { unique: true, name: 'quotes_series_version_unique' },
    },
    {
      collection: 'bookings',
      key: { idempotencyKey: 1 },
      options: { unique: true, name: 'bookings_idempotencyKey_unique' },
    },
    {
      collection: 'bookings',
      key: { supplierId: 1, eventDate: 1, eventEndDate: 1, status: 1 },
      options: { name: 'bookings_supplier_event_range_status' },
    },
  ];
}

module.exports = {
  QUOTE_STATES,
  BOOKING_STATES,
  calculateQuoteTotals,
  canTransitionQuote,
  immutableQuoteSnapshot,
  validateQuoteAcceptance,
  bookingIdempotencyKey,
  createBookingFromAcceptedQuote,
  quoteBookingIndexes,
};
