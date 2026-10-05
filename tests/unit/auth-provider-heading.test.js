/**
 * The sign-up "Step 2" heading must only name sign-in options that are
 * actually available, so it never advertises a button that isn't there.
 *
 * The behaviour tests run the real auth.html and the real heading script in
 * jsdom. jsdom 28 cannot be loaded by Jest directly, so — like the other
 * jsdom-backed tests in this repo — they run in a separate Node process.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const PAGES = path.join(ROOT, 'public/assets/js/pages');
const read = file => fs.readFileSync(path.join(PAGES, file), 'utf8');

const headingSource = read('auth-provider-heading.js');
const googleSource = read('auth-google-init.js');
const facebookSource = read('auth-facebook-init.js');
const authHtml = fs.readFileSync(path.join(ROOT, 'public/auth.html'), 'utf8');

const DEFAULT_HEADING = 'Continue with Google, Facebook or email';

/**
 * Loads the real auth page, runs the heading script, replays each scenario's
 * availability announcements, and returns the heading text after each one.
 */
function headingsAfter(scenarios) {
  const output = execFileSync(
    process.execPath,
    [
      '-e',
      String.raw`
      const fs = require('fs');
      const { JSDOM } = require('jsdom');
      const scenarios = JSON.parse(process.argv[1]);
      const html = fs.readFileSync('public/auth.html', 'utf8');
      const source = fs.readFileSync('public/assets/js/pages/auth-provider-heading.js', 'utf8');
      const results = scenarios.map(events => {
        const dom = new JSDOM(html, { url: 'https://event-flow.co.uk/auth', runScripts: 'outside-only' });
        dom.window.eval(source);
        const document = dom.window.document;
        for (const detail of events) {
          document.dispatchEvent(
            new dom.window.CustomEvent('eventflow:auth-provider-availability', { detail })
          );
        }
        return document.getElementById('auth-signup-step-title').textContent.trim();
      });
      process.stdout.write(JSON.stringify(results));
    `,
      JSON.stringify(scenarios),
    ],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  return JSON.parse(output);
}

describe('auth sign-up heading adapts to available providers', () => {
  const scenarios = {
    'no announcements': [],
    'facebook off': [{ provider: 'facebook', available: false }],
    'google off': [{ provider: 'google', available: false }],
    'both off': [
      { provider: 'google', available: false },
      { provider: 'facebook', available: false },
    ],
    'facebook off then back on': [
      { provider: 'facebook', available: false },
      { provider: 'facebook', available: true },
    ],
    'unknown provider': [{ provider: 'apple', available: false }],
    'missing provider': [{ available: false }],
    'facebook confirmed available': [{ provider: 'facebook', available: true }],
  };
  let headings = {};

  beforeAll(() => {
    const results = headingsAfter(Object.values(scenarios));
    headings = Object.fromEntries(Object.keys(scenarios).map((name, i) => [name, results[i]]));
  });

  test('keeps the full heading until a provider reports it is unavailable', () => {
    expect(headings['no announcements']).toBe(DEFAULT_HEADING);
    expect(headings['facebook confirmed available']).toBe(DEFAULT_HEADING);
  });

  test('drops Facebook when Facebook sign-in is off', () => {
    expect(headings['facebook off']).toBe('Continue with Google or email');
  });

  test('drops Google when Google sign-in is off', () => {
    expect(headings['google off']).toBe('Continue with Facebook or email');
  });

  test('falls back to email only when no social provider is available', () => {
    expect(headings['both off']).toBe('Continue with email');
  });

  test('restores the provider when it reports it is available again', () => {
    expect(headings['facebook off then back on']).toBe(DEFAULT_HEADING);
  });

  test('ignores unknown providers and malformed announcements', () => {
    expect(headings['unknown provider']).toBe(DEFAULT_HEADING);
    expect(headings['missing provider']).toBe(DEFAULT_HEADING);
  });
});

describe('auth page wiring', () => {
  test('the static heading still names both providers and carries the hook id', () => {
    expect(authHtml).toMatch(/id="auth-signup-step-title"/);
    expect(authHtml).toContain(DEFAULT_HEADING);
  });

  test('the heading script loads before the provider scripts that announce to it', () => {
    const heading = authHtml.indexOf('auth-provider-heading.js');
    const google = authHtml.indexOf('auth-google-init.js');
    const facebook = authHtml.indexOf('auth-facebook-init.js');
    expect(heading).toBeGreaterThan(-1);
    expect(heading).toBeLessThan(google);
    expect(heading).toBeLessThan(facebook);
  });

  test('Google announces unavailability on every path where its button cannot be used', () => {
    // not configured, config failed to load, GIS script failed, GIS unavailable in browser
    expect(googleSource.match(/announceGoogleAvailability\(false\)/g)).toHaveLength(4);
    expect(googleSource).toContain("provider: 'google'");
  });

  test('Facebook announces unavailable (config failed / not configured) and available', () => {
    expect(facebookSource.match(/announceFacebookAvailability\(false\)/g)).toHaveLength(2);
    expect(facebookSource.match(/announceFacebookAvailability\(true\)/g)).toHaveLength(1);
    expect(facebookSource).toContain("provider: 'facebook'");
  });

  test('both provider scripts use the event name the heading script listens for', () => {
    const eventName = 'eventflow:auth-provider-availability';
    expect(headingSource).toContain(eventName);
    expect(googleSource).toContain(eventName);
    expect(facebookSource).toContain(eventName);
  });
});
