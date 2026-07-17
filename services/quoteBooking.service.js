'use strict';

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

function asMinorUnit(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName}_must_be_non_negative_integer_minor_units`);
  }
  return value;
}

function calculateQuoteTotals(input) {
  const lineItems = (input.lineItems || []).map((item, index) => {
    const quantity = asMinorUnit(item.quantity, `line_${index}_quantity`);
    const unitAmount = asMinorUnit(item.unitAmount, `line_${index}_unitAmount`);
    const discountAmount = asMinorUnit(item.discountAmount || 0, `line_${index}_discountAmount`);
    const lineSubtotal = quantity * unitAmount;
    if (discountAmount > lineSubtotal) {
      throw new Error(`line_${index}_discount_exceeds_subtotal`);
    }
    return { ...item, quantity, unitAmount, discountAmount, total: lineSubtotal - discountAmount };
  });
  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
  const tax = asMinorUnit(input.tax || 0, 'tax');
  const total = subtotal + tax;
  const depositAmount = asMinorUnit(input.depositAmount || 0, 'depositAmount');
  if (depositAmount > total) {
    throw new Error('deposit_exceeds_total');
  }
  return { currency: input.currency || 'GBP', lineItems, subtotal, tax, total, depositAmount };
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

function immutableQuoteSnapshot(quote) {
  return Object.freeze(
    JSON.parse(
      JSON.stringify({
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
        cancellationTerms: quote.cancellationTerms || '',
        expiresAt: quote.expiresAt || null,
      })
    )
  );
}

function validateQuoteAcceptance({ quote, customerId, version, now = new Date(), availability }) {
  if (!quote || quote.customerId !== customerId) {
    return { ok: false, code: 'not_found' };
  }
  if (!ACTIVE_ACCEPTABLE.has(quote.status)) {
    return { ok: false, code: 'quote_not_active' };
  }
  if (quote.expiresAt && new Date(quote.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, code: 'quote_expired' };
  }
  if (quote.version !== version) {
    return { ok: false, code: 'stale_quote_version' };
  }
  if (availability && availability.status !== 'available') {
    return { ok: false, code: 'availability_conflict' };
  }
  return { ok: true };
}

function bookingIdempotencyKey(quoteId, version, customerId) {
  return `quote_accept:${quoteId}:v${version}:customer:${customerId}`;
}

function createBookingFromAcceptedQuote(quote, eventBrief, options = {}) {
  const snapshot = immutableQuoteSnapshot(quote);
  const requiresPayment = Boolean(options.bookingPaymentsEnabled && snapshot.depositAmount > 0);
  return {
    id: options.bookingId,
    customerId: quote.customerId,
    supplierId: quote.supplierId,
    eventBriefId: quote.eventBriefId,
    threadId: quote.threadId || eventBrief?.threadId || null,
    acceptedQuoteId: quote.id,
    acceptedQuoteVersion: quote.version,
    quoteSnapshot: snapshot,
    eventDate: eventBrief?.startDate || quote.eventDate,
    eventEndDate:
      eventBrief?.endDate || eventBrief?.startDate || quote.eventEndDate || quote.eventDate,
    locationSnapshot: eventBrief?.location || null,
    currency: snapshot.currency,
    total: snapshot.total,
    depositAmount: snapshot.depositAmount,
    status: requiresPayment ? BOOKING_STATES.PENDING_PAYMENT : BOOKING_STATES.PENDING_CONFIRMATION,
    paymentStatus: requiresPayment ? 'deposit_required' : 'not_required',
    source: 'quote_acceptance',
    idempotencyKey: bookingIdempotencyKey(quote.id, quote.version, quote.customerId),
  };
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
};
