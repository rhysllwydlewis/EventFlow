'use strict';

const fs = require('fs');
const path = require('path');
const { sanitizeAnonymousPublicHtml } = require('../../utils/template-renderer');

const ROOT = path.resolve(__dirname, '../..');
const PUBLIC = path.join(ROOT, 'public');

const BANNED_PUBLIC_PATTERNS = [
  /Version:\s*loading/i,
  /Dashboard\s+Log out/i,
  /Mark all as read/i,
  /What Our Customers Say/i,
  /Sarah\s*&(?:amp;)?\s*Tom/i,
  /James Wilson/i,
  /Emma Davies/i,
  /All suppliers are verified and vetted/i,
  /Explore our full range of verified UK suppliers/i,
  /Calendar publishing requests/i,
  /Approve suitable suppliers/i,
  /admin override/i,
  /pending_review/i,
  /rejected/i,
];

const CRAWLABLE_PUBLIC_PAGES = [
  'index.html',
  'start.html',
  'public-calendar.html',
  'guides.html',
  'pricing.html',
  'faq.html',
  'marketplace.html',
  'suppliers.html',
  'for-suppliers.html',
  'legal.html',
  'contact.html',
  'auth.html',
  'forgot-password.html',
  'reset-password.html',
  'verify.html',
];

function readPublic(file) {
  return fs.readFileSync(path.join(PUBLIC, file), 'utf8');
}

describe('final public render mop-up guardrails', () => {
  test.each(CRAWLABLE_PUBLIC_PAGES)(
    '%s anonymous rendered HTML avoids launch-blocking bleed',
    page => {
      const requestPath = `/${page}`;
      const rendered = sanitizeAnonymousPublicHtml(readPublic(page), requestPath, {});
      for (const pattern of BANNED_PUBLIC_PATTERNS) {
        expect(rendered).not.toMatch(pattern);
      }
    }
  );

  test('anonymous public calendar render hides role-gated controls and keeps safe status filter', () => {
    const rendered = sanitizeAnonymousPublicHtml(
      readPublic('public-calendar.html'),
      '/public-calendar.html',
      {}
    );
    expect(rendered).not.toMatch(/\b(?:Add Event|Publish Event)\b/i);
    expect(rendered).not.toMatch(/pending_review|rejected|admin override/i);
    expect(rendered).toMatch(
      /<select id="pc-filter-status"><option value="">All upcoming events<\/option><\/select>/i
    );
  });

  test('authenticated public calendar render skips anonymous sanitizer for JS role-gating', () => {
    const source = readPublic('public-calendar.html');
    const rendered = sanitizeAnonymousPublicHtml(source, '/public-calendar.html', {
      user: { role: 'admin' },
    });
    expect(rendered).toBe(source);
    expect(rendered).toMatch(/Calendar publishing requests/i);
  });
});
