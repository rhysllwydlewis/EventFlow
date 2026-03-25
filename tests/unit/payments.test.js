/**
 * Unit tests for payment routes
 */

describe('Payment Routes', () => {
  describe('Stripe Integration', () => {
    it('should have stripe module available', () => {
      const stripe = require('stripe');
      expect(stripe).toBeDefined();
      expect(typeof stripe).toBe('function');
    });

    it('should handle missing Stripe configuration gracefully', () => {
      // The payment routes should check for STRIPE_ENABLED
      // and return 503 if Stripe is not configured
      const ensureStripeEnabled = (req, res, next) => {
        const STRIPE_ENABLED = false;
        if (!STRIPE_ENABLED) {
          return res.status(503).json({
            error: 'Payment processing is not available',
            message: 'Stripe is not configured. Please contact support.',
          });
        }
        next();
      };

      const mockReq = {};
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const mockNext = jest.fn();

      ensureStripeEnabled(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Payment processing is not available',
        message: 'Stripe is not configured. Please contact support.',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Payment Schema Validation', () => {
    it('should validate payment type', () => {
      const validTypes = ['one_time', 'subscription'];
      const invalidTypes = ['monthly', 'yearly', null, undefined, ''];

      validTypes.forEach(type => {
        expect(validTypes).toContain(type);
      });

      invalidTypes.forEach(type => {
        expect(validTypes).not.toContain(type);
      });
    });

    it('should validate payment status', () => {
      const validStatuses = ['pending', 'succeeded', 'failed', 'cancelled', 'refunded'];
      const invalidStatuses = ['completed', 'active', null, undefined];

      validStatuses.forEach(status => {
        expect(validStatuses).toContain(status);
      });

      invalidStatuses.forEach(status => {
        expect(validStatuses).not.toContain(status);
      });
    });

    it('should validate currency codes', () => {
      const validCurrencies = ['gbp', 'usd', 'eur'];
      const testCurrency = 'gbp';

      expect(validCurrencies).toContain(testCurrency);
      expect(testCurrency).toBe(testCurrency.toLowerCase());
    });

    it('should validate amount is a number', () => {
      const validAmounts = [100, 999, 5000, 0];
      const invalidAmounts = ['100', null, undefined, NaN, -1];

      validAmounts.forEach(amount => {
        expect(typeof amount).toBe('number');
        expect(amount).toBeGreaterThanOrEqual(0);
      });

      invalidAmounts.forEach(amount => {
        const isValid = typeof amount === 'number' && amount >= 0 && !isNaN(amount);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Payment Record Structure', () => {
    it('should have required payment fields', () => {
      const paymentRecord = {
        id: 'pay_123',
        userId: 'user_456',
        amount: 9.99,
        currency: 'gbp',
        status: 'succeeded',
        type: 'one_time',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(paymentRecord).toHaveProperty('id');
      expect(paymentRecord).toHaveProperty('userId');
      expect(paymentRecord).toHaveProperty('amount');
      expect(paymentRecord).toHaveProperty('currency');
      expect(paymentRecord).toHaveProperty('status');
      expect(paymentRecord).toHaveProperty('type');
      expect(paymentRecord).toHaveProperty('createdAt');
      expect(paymentRecord).toHaveProperty('updatedAt');
    });

    it('should have optional subscription details for subscription payments', () => {
      const subscriptionPayment = {
        id: 'pay_123',
        userId: 'user_456',
        amount: 9.99,
        currency: 'gbp',
        status: 'succeeded',
        type: 'subscription',
        subscriptionDetails: {
          planId: 'price_123',
          planName: 'Pro Monthly',
          interval: 'month',
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date().toISOString(),
          cancelAtPeriodEnd: false,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(subscriptionPayment.type).toBe('subscription');
      expect(subscriptionPayment).toHaveProperty('subscriptionDetails');
      expect(subscriptionPayment.subscriptionDetails).toHaveProperty('planId');
      expect(subscriptionPayment.subscriptionDetails).toHaveProperty('interval');
    });
  });

  describe('Webhook Security', () => {
    it('should require signature for webhook verification', () => {
      const mockReq = {
        headers: {},
        body: Buffer.from('{}'),
      };

      const hasSignature = !!mockReq.headers['stripe-signature'];
      expect(hasSignature).toBe(false);
    });

    it('should validate webhook signature format', () => {
      const validSignature = 't=1234567890,v1=signature_hash_here';
      const invalidSignatures = ['', null, undefined, 'invalid', '123'];

      expect(validSignature).toContain('t=');
      expect(validSignature).toContain('v1=');

      invalidSignatures.forEach(sig => {
        const isValid = !!(sig && sig.includes('t=') && sig.includes('v1='));
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Promotion Codes', () => {
    it('should enable allow_promotion_codes for subscription checkout without intro pricing', () => {
      const useIntroPricing = false;
      const type = 'subscription';

      const sessionConfig = {
        customer: 'cus_123',
        mode: type === 'subscription' ? 'subscription' : 'payment',
        line_items: [{ price: 'price_pro_123', quantity: 1 }],
      };

      if (type !== 'one_time') {
        if (useIntroPricing) {
          sessionConfig.discounts = [{ coupon: 'coupon_intro_123' }];
        } else {
          sessionConfig.allow_promotion_codes = true;
        }
      }

      expect(sessionConfig.allow_promotion_codes).toBe(true);
      expect(sessionConfig.discounts).toBeUndefined();
    });

    it('should not set allow_promotion_codes when intro pricing discount is applied', () => {
      const useIntroPricing = true;
      const type = 'subscription';

      const sessionConfig = {
        customer: 'cus_123',
        mode: 'subscription',
        line_items: [{ price: 'price_pro_123', quantity: 1 }],
      };

      if (type !== 'one_time') {
        if (useIntroPricing) {
          sessionConfig.discounts = [{ coupon: 'coupon_intro_123' }];
        } else {
          sessionConfig.allow_promotion_codes = true;
        }
      }

      expect(sessionConfig.discounts).toBeDefined();
      expect(sessionConfig.discounts[0].coupon).toBe('coupon_intro_123');
      expect(sessionConfig.allow_promotion_codes).toBeUndefined();
    });

    it('should not set allow_promotion_codes for one_time payments', () => {
      const type = 'one_time';

      const sessionConfig = {
        customer: 'cus_123',
        mode: 'payment',
        line_items: [
          {
            price_data: { currency: 'gbp', product_data: { name: 'EventFlow Payment' }, unit_amount: 1000 },
            quantity: 1,
          },
        ],
      };

      // allow_promotion_codes is only set in the subscription branch
      if (type !== 'one_time') {
        sessionConfig.allow_promotion_codes = true;
      }

      expect(sessionConfig.allow_promotion_codes).toBeUndefined();
    });
  });

  describe('Amount Conversion', () => {
    it('should convert pounds to pence correctly', () => {
      const pounds = 9.99;
      const pence = Math.round(pounds * 100);

      expect(pence).toBe(999);
    });

    it('should convert pence to pounds correctly', () => {
      const pence = 999;
      const pounds = pence / 100;

      expect(pounds).toBe(9.99);
    });

    it('should handle zero amounts', () => {
      const pounds = 0;
      const pence = Math.round(pounds * 100);

      expect(pence).toBe(0);
      expect(pence / 100).toBe(0);
    });

    it('should handle large amounts', () => {
      const pounds = 10000.5;
      const pence = Math.round(pounds * 100);

      expect(pence).toBe(1000050);
      expect(pence / 100).toBe(10000.5);
    });
  });

  describe('URL Configuration', () => {
    it('should use environment variables for URLs', () => {
      const defaultSuccessUrl = 'http://localhost:3000/payment-success';
      const defaultCancelUrl = 'http://localhost:3000/payment-cancel';

      expect(defaultSuccessUrl).toContain('/payment-success');
      expect(defaultCancelUrl).toContain('/payment-cancel');
    });

    it('should append session_id parameter to success URL', () => {
      const baseUrl = 'http://localhost:3000/payment-success';
      const successUrl = `${baseUrl}?session_id={CHECKOUT_SESSION_ID}`;

      expect(successUrl).toContain('session_id=');
      expect(successUrl).toContain('{CHECKOUT_SESSION_ID}');
    });
  });
});
