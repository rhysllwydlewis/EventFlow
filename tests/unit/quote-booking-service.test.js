const {
  QUOTE_STATES,
  BOOKING_STATES,
  calculateQuoteTotals,
  canTransitionQuote,
  immutableQuoteSnapshot,
  validateQuoteAcceptance,
  bookingIdempotencyKey,
  createBookingFromAcceptedQuote,
  quoteBookingIndexes,
} = require('../../services/quoteBooking.service');

describe('quote booking service', () => {
  test('calculates quote totals using safe integer minor units', () => {
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

  test('rejects zero quantities, invalid discounts and unsafe arithmetic', () => {
    expect(() =>
      calculateQuoteTotals({ lineItems: [{ quantity: 1, unitAmount: 1000, discountAmount: 1001 }] })
    ).toThrow('discount_exceeds_subtotal');
    expect(() => calculateQuoteTotals({ lineItems: [{ quantity: 0, unitAmount: 1000 }] })).toThrow(
      'quantity_must_be_positive_safe_integer'
    );
    expect(() =>
      calculateQuoteTotals({
        lineItems: [{ quantity: Number.MAX_SAFE_INTEGER, unitAmount: 2 }],
      })
    ).toThrow('exceeds_safe_integer_range');
  });

  test('enforces quote state transitions and terminal states', () => {
    expect(canTransitionQuote(QUOTE_STATES.DRAFT, QUOTE_STATES.SENT)).toBe(true);
    expect(canTransitionQuote(QUOTE_STATES.ACCEPTED, QUOTE_STATES.REVISED)).toBe(false);
  });

  test('creates deeply immutable sent-version snapshots', () => {
    const snapshot = immutableQuoteSnapshot({
      id: 'q1',
      version: 2,
      supplierId: 's1',
      customerId: 'c1',
      lineItems: [{ description: 'Music', quantity: 1 }],
      subtotal: 1,
      tax: 0,
      total: 1,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.lineItems)).toBe(true);
    expect(Object.isFrozen(snapshot.lineItems[0])).toBe(true);
    expect(snapshot).toMatchObject({ id: 'q1', version: 2, total: 1 });
  });

  test('rejects stale, malformed, expired and unconfirmed acceptance attempts', () => {
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
        quote: { ...quote, expiresAt: 'not-a-date' },
        customerId: 'c1',
        version: 3,
        now: new Date('2026-07-17T00:00:00Z'),
        availability: { status: 'available' },
      })
    ).toEqual({ ok: false, code: 'invalid_quote_expiry' });
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
      })
    ).toEqual({ ok: false, code: 'availability_unconfirmed' });
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

  test('requires accepted quotes and builds deterministic payment-aware bookings', () => {
    const quote = {
      id: 'q1',
      version: 4,
      status: QUOTE_STATES.ACCEPTED,
      customerId: 'c1',
      supplierId: 's1',
      eventBriefId: 'e1',
      lineItems: [],
      subtotal: 10000,
      tax: 0,
      total: 10000,
      depositAmount: 2500,
    };
    const eventBrief = {
      startDate: '2026-08-01',
      endDate: '2026-08-02',
      location: { postcode: 'SW1A 1AA' },
    };
    const booking = createBookingFromAcceptedQuote(quote, eventBrief, {
      bookingPaymentsEnabled: true,
      bookingId: 'b1',
      now: new Date('2026-07-17T12:00:00Z'),
    });
    const externalPaymentBooking = createBookingFromAcceptedQuote(quote, eventBrief, {
      bookingPaymentsEnabled: false,
      bookingId: 'b2',
    });

    expect(booking.idempotencyKey).toBe(bookingIdempotencyKey('q1', 4, 'c1'));
    expect(booking.idempotencyKey).not.toContain('q1');
    expect(booking.status).toBe(BOOKING_STATES.PENDING_PAYMENT);
    expect(booking.paymentStatus).toBe('deposit_required');
    expect(booking.quoteSnapshot.total).toBe(10000);
    expect(externalPaymentBooking.status).toBe(BOOKING_STATES.PENDING_CONFIRMATION);
    expect(externalPaymentBooking.paymentStatus).toBe('external_payment_required');
    expect(() =>
      createBookingFromAcceptedQuote({ ...quote, status: QUOTE_STATES.SENT }, eventBrief, {
        bookingId: 'b3',
      })
    ).toThrow('quote_must_be_accepted');
  });

  test('declares uniqueness indexes for quote versions and booking idempotency', () => {
    const indexes = quoteBookingIndexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: 'bookings',
          key: { idempotencyKey: 1 },
          options: expect.objectContaining({ unique: true }),
        }),
      ])
    );
  });
});
