'use strict';

/**
 * The verification dialog on the supplier dashboard, run for real against the dashboard's own
 * markup in jsdom (in a child process, like the other jsdom scenarios here): what it sends,
 * through which request helper, and what it says back.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const runner = path.join(__dirname, '../helpers/supplier-overlays-scenario.js');

/** Runs the verification scenario in the given mode and returns what it found. */
const run = mode =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [runner, 'verification', Buffer.from(JSON.stringify({ mode }), 'utf8').toString('base64')],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }
    )
  );

describe('supplier verification dialog', () => {
  test('sends through the dashboard write helper, so a stale CSRF token is retried once', () => {
    const log = run('helper');

    expect(log.sent).toEqual([
      {
        via: 'helper',
        url: '/api/supplier/verification/submit',
        method: 'POST',
        body: {
          name: 'Moor Audio',
          category: 'Entertainment',
          phone: '01234 567890',
          location: 'Cardiff',
          email: 'hello@moor.example',
        },
      },
    ]);
    expect(log.success).toBe('Sent for review.');
  });

  test('still works with its own request when the helper is not on the page', () => {
    const log = run('fallback');

    expect(log.sent).toEqual([
      { via: 'fetch', url: '/api/supplier/verification/submit', token: 'token-1' },
    ]);
    expect(log.success).toBe('Your profile has been verified and approved.');
  });

  test('a dropped connection is reported in the dialog and the button comes back', () => {
    const log = run('offline');

    expect(log.error).toBe('Network error. Check your connection and try again.');
    expect(log.submitDisabled).toBe(false);
  });

  test('missing required fields are listed and nothing is sent', () => {
    const log = run('missing');

    expect(log.sent).toEqual([]);
    expect(log.error).toBe('These fields are required: Phone.');
  });
});
