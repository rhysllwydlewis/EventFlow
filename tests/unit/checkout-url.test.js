'use strict';

/**
 * The only addresses a payment or billing page may navigate to: Stripe's hosted pages over https,
 * or a page on this site. public/assets/js/utils/checkout-url.js
 */

const fs = require('fs');
const path = require('path');
const { resolve, STRIPE_HOSTS } = require('../../public/assets/js/utils/checkout-url');
const { loadAppRedirect } = require('../helpers/load-app-redirect');

const ORIGIN = 'https://event-flow.co.uk';
const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');

describe('EFCheckoutUrl.resolve', () => {
  it.each([
    [
      'https://checkout.stripe.com/c/pay/cs_test_123#frag',
      'https://checkout.stripe.com/c/pay/cs_test_123#frag',
    ],
    ['https://billing.stripe.com/p/session/abc', 'https://billing.stripe.com/p/session/abc'],
    ['/dashboard/supplier?billing=success', `${ORIGIN}/dashboard/supplier?billing=success`],
    [`${ORIGIN}/payment-success`, `${ORIGIN}/payment-success`],
  ])('follows %s', (input, expected) => {
    expect(resolve(input, ORIGIN)).toBe(expected);
  });

  it.each([
    'https://evil.example/checkout',
    'https://checkout.stripe.com.evil.example/c/pay',
    'https://evil.example/https://checkout.stripe.com/',
    'http://checkout.stripe.com/c/pay',
    'https://user:pass@checkout.stripe.com/c/pay',
    '//evil.example/x',
    '/\\evil.example',
    '/\t/evil.example',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://checkout.stripe.com/',
    '',
    '   ',
    null,
    undefined,
    42,
    {},
  ])('refuses %p', input => {
    expect(resolve(input, ORIGIN)).toBeNull();
  });

  it('allows only Stripe hosts that the billing pages really use', () => {
    expect(STRIPE_HOSTS).toEqual(['checkout.stripe.com', 'billing.stripe.com']);
  });
});

describe('every page that navigates to a server-supplied payment address uses it', () => {
  it.each([
    ['public/assets/js/pricing.js', 'public/pricing.html', 'utils/checkout-url.js'],
    ['public/assets/js/checkout.js', 'public/checkout.html', 'utils/checkout-url.js'],
    ['public/supplier/js/subscription.js', 'public/supplier/subscription.html', 'checkout-url.js'],
  ])('%s', (script, page, include) => {
    const source = read(script);
    expect(source).toContain('EFCheckoutUrl');
    expect(source).not.toMatch(/location\.href\s*=\s*(data|target)\b/);
    expect(read(page)).toContain(include);
  });

  it('app.js checks the same host list before following a checkout address', () => {
    const app = read('public/assets/js/app.js');
    STRIPE_HOSTS.forEach(host => expect(app).toContain(`'${host}'`));
  });
});

describe('app.js resolveCheckoutUrl behaves exactly like the shared helper', () => {
  const { resolveCheckoutUrl } = loadAppRedirect(ORIGIN);
  it.each([
    'https://checkout.stripe.com/c/pay/cs_test_123',
    'https://billing.stripe.com/p/session/abc',
    '/dashboard/supplier?billing=success',
    'https://evil.example/checkout',
    'https://checkout.stripe.com.evil.example/c/pay',
    'http://checkout.stripe.com/c/pay',
    'https://user:pass@checkout.stripe.com/c/pay',
    '//evil.example/x',
    '/\\evil.example',
    'javascript:alert(1)',
    '',
    null,
    42,
  ])('%p', input => {
    expect(resolveCheckoutUrl(input)).toBe(resolve(input, ORIGIN));
  });
});
