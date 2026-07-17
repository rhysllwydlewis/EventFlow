const {
  QUOTE_STATES,
  BOOKING_STATES,
  calculateQuoteTotals,
  canTransitionQuote,
  immutableQuoteSnapshot,
  validateQuoteAcceptance,
  bookingIdempotencyKey,
  createBookingFromAcceptedQuote,
} = require('../../services/quoteBooking.service');

describe('quote booking service', () => {
  test('calculates quote totals using integer minor units', () => {
    expect(
      calculateQuoteTotals({
        lineItems: [
          { description: 'Music', quantity: 2, unitAmount: 12500 },
          {
            description: 'Discounted lighting',
            quantity: 1,
            unitAmount: 5000,
            discountAmount: 1000,
          },
        ],
        tax: 4000,
        depositAmount: 10000,
      })
    ).toMatchObject({
      subtotal: 29000,
      tax: 4000,
      total: 33000,
      depositAmount: 10000,
      currency: 'GBP',
    });
  });

  test('rejects invalid money arithmetic', () => {
    expect(() =>
      calculateQuoteTotals({ lineItems: [{ quantity: 1, unitAmount: 1000, discountAmount: 1001 }] })
    ).toThrow('discount_exceeds_subtotal');
    expect(() =>
      calculateQuoteTotals({ lineItems: [{ quantity: 1.5, unitAmount: 1000 }] })
    ).toThrow('quantity_must_be_non_negative_integer_minor_units');
  });

  test('enforces quote state transitions and terminal states', () => {
    expect(canTransitionQuote(QUOTE_STATES.DRAFT, QUOTE_STATES.SENT)).toBe(true);
    expect(canTransitionQuote(QUOTE_STATES.ACCEPTED, QUOTE_STATES.REVISED)).toBe(false);
  });

  test('creates immutable sent-version snapshots', () => {
    const snapshot = immutableQuoteSnapshot({
      id: 'q1',
      version: 2,
      supplierId: 's1',
      customerId: 'c1',
      lineItems: [],
      subtotal: 1,
      tax: 0,
      total: 1,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot).toMatchObject({ id: 'q1', version: 2, total: 1 });
  });

  test('rejects stale, expired and conflicting quote acceptance attempts', () => {
    const quote = {
      id: 'q1',
      customerId: 'c1',
      status: QUOTE_STATES.SENT,
      version: 3,
      expiresAt: '2026-07-18T00:00:00Z',
    };
    expect(
      validateQuoteAcceptance({
        quote,
        customerId: 'c1',
        version: 2,
        now: new Date('2026-07-17T00:00:00Z'),
        availability: { status: 'available' },
      })
    ).toEqual({ ok: false, code: 'stale_quote_version' });
    expect(
      validateQuoteAcceptance({
        quote,
        customerId: 'c1',
        version: 3,
        now: new Date('2026-07-19T00:00:00Z'),
        availability: { status: 'available' },
      })
    ).toEqual({ ok: false, code: 'quote_expired' });
    expect(
      validateQuoteAcceptance({
        quote,
        customerId: 'c1',
        version: 3,
        now: new Date('2026-07-17T00:00:00Z'),
        availability: { status: 'unavailable' },
      })
    ).toEqual({ ok: false, code: 'availability_conflict' });
  });

  test('builds deterministic booking idempotency keys and payment-aware booking state', () => {
    const quote = {
      id: 'q1',
      version: 4,
      customerId: 'c1',
      supplierId: 's1',
      eventBriefId: 'e1',
      lineItems: [],
      subtotal: 10000,
      tax: 0,
      total: 10000,
      depositAmount: 2500,
    };
    const booking = createBookingFromAcceptedQuote(
      quote,
      { startDate: '2026-08-01', endDate: '2026-08-02', location: { postcode: 'SW1A 1AA' } },
      { bookingPaymentsEnabled: true, bookingId: 'b1' }
    );
    expect(booking.idempotencyKey).toBe(bookingIdempotencyKey('q1', 4, 'c1'));
    expect(booking.status).toBe(BOOKING_STATES.PENDING_PAYMENT);
    expect(booking.paymentStatus).toBe('deposit_required');
    expect(booking.quoteSnapshot.total).toBe(10000);
  });
});
