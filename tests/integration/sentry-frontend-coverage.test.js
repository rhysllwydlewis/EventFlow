/**
 * Tests that sentry-browser-init.js is loaded on all pages that
 * load global-error-handler.js, ensuring consistent frontend error tracking.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '../../public');

// Pages that should carry both scripts for full error tracking coverage
const PAGES = [
  'admin-analytics.html',
  'admin-moderation.html',
  'admin-supplier-detail.html',
  'admin.html',
  'auth.html',
  'contact.html',
  'dashboard-customer.html',
  'dashboard-supplier.html',
  'faq.html',
  'gallery.html',
  'index.html',
  'marketplace.html',
  'notifications.html',
  'payment-cancel.html',
  'pricing.html',
  'settings.html',
  'suppliers.html',
];

describe('Frontend Sentry error tracking coverage', () => {
  PAGES.forEach(page => {
    describe(page, () => {
      let content;

      beforeAll(() => {
        content = fs.readFileSync(path.join(publicDir, page), 'utf8');
      });

      it('loads global-error-handler.js', () => {
        expect(content).toContain('global-error-handler.js');
      });

      it('loads sentry-browser-init.js for remote error capture', () => {
        expect(content).toContain('sentry-browser-init.js');
      });

      it('loads sentry-browser-init.js after global-error-handler.js', () => {
        const errorHandlerPos = content.indexOf('global-error-handler.js');
        const sentryPos = content.indexOf('sentry-browser-init.js');
        expect(sentryPos).toBeGreaterThan(errorHandlerPos);
      });
    });
  });
});
