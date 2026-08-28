'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function loadProviderSanitizer(source) {
  const start = source.indexOf('  function sanitizePostHogProviderEvent(event)');
  const end = source.indexOf('\n  function startPostHog(config)', start);
  if (start < 0 || end <= start) {
    throw new Error('Unable to locate sanitizePostHogProviderEvent');
  }

  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${source.slice(start, end)}\nthis.sanitizePostHogProviderEvent = sanitizePostHogProviderEvent;`,
    context
  );
  return context.sanitizePostHogProviderEvent;
}

describe('PostHog Web Analytics health hardening', () => {
  test('enables standard consent-gated Web Vitals without network timing attribution', () => {
    const source = read('public/assets/js/behaviour-analytics.js');

    expect(source).toContain('capture_performance: {');
    expect(source).toContain('web_vitals: true');
    expect(source).toContain('web_vitals_attribution: false');
    expect(source).toContain('before_send: sanitizePostHogProviderEvent');
    expect(source).not.toContain('capture_performance: false');
  });

  test('keeps person processing boolean and strips query data from nested Web Vitals URLs', () => {
    const source = read('public/assets/js/behaviour-analytics.js');
    const sanitize = loadProviderSanitizer(source);
    const event = {
      event: '$web_vitals',
      properties: {
        $process_person_profile: '019f6251-06a8-76c3-abe6-59e81e75cf04',
        $web_vitals_LCP_event: {
          $current_url: 'https://event-flow.co.uk/suppliers?token=secret#results',
        },
        $web_vitals_LCP_value: 1725,
      },
    };

    expect(sanitize(event)).toBe(event);
    expect(event.properties.$process_person_profile).toBe(false);
    expect(event.properties.$web_vitals_LCP_event.$current_url).toBe(
      'https://event-flow.co.uk/suppliers'
    );
    expect(event.properties.$web_vitals_LCP_value).toBe(1725);
  });

  test('bumps the public analytics asset cache key', () => {
    const renderer = read('utils/template-renderer.js');
    expect(renderer).toContain('/assets/js/behaviour-analytics.js?v=3');
    expect(renderer).not.toContain('/assets/js/behaviour-analytics.js?v=2');
  });
});
