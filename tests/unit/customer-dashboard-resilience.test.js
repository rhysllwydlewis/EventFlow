/**
 * Customer dashboard resilience, driven through a real DOM.
 *
 * The scripts run in a plain Node process (jsdom cannot be loaded through Jest's transform here)
 * and report their outcomes as JSON; this suite asserts on them. The scenarios are in
 * tests/helpers/customer-dashboard-resilience-scenarios.js.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const results = JSON.parse(
  execFileSync(
    process.execPath,
    [path.join(root, 'tests/helpers/customer-dashboard-resilience-scenarios.js')],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  )
);

describe('the sign-in guard and slow requests', () => {
  test('a slow plans request still delivers the real plans, with a "taking longer" notice meanwhile', () => {
    const { slowButAnswers } = results.guard;
    expect(slowButAnswers.noticeWhileWaiting).toBe(true);
    expect(slowButAnswers.status).toBe(200);
    expect(slowButAnswers.body.plans).toEqual([{ id: 'real-plan' }]);
    expect(slowButAnswers.fallbackHeader).toBeNull();
    expect(slowButAnswers.noticeAfter).toBe(false);
  });

  test('a request that never answers is cancelled, not answered with an empty list', () => {
    const { neverAnswers } = results.guard;
    for (const target of [
      '/api/me/plans',
      '/api/notifications',
      '/api/conversations',
      '/api/tickets',
    ]) {
      expect(neverAnswers[target]).toEqual({ rejected: 'AbortError' });
    }
    expect(neverAnswers.noticeAfter).toBe(false);
  });

  test('only the confirmed user and an existing CSRF token may stand in for a slow reply', () => {
    const { standIns } = results.guard;
    expect(standIns.me.body.user.id).toBe('u1');
    expect(standIns.csrf.body.csrfToken).toBe('token-from-page');
  });

  test('the guard source no longer builds empty plans, notifications, conversations or tickets', () => {
    const guard = read('public/assets/js/dashboard-guard.js');
    expect(guard).not.toMatch(/plans:\s*\[\]/);
    expect(guard).not.toMatch(/notifications:\s*\[\]/);
    expect(guard).not.toMatch(/conversations:\s*\[\]/);
    expect(guard).not.toMatch(/tickets:\s*\[\]/);
  });
});
