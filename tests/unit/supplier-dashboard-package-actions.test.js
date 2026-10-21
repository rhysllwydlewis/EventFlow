'use strict';

/**
 * Package actions on the dashboard, end to end against a scripted API: Delete and Pause/Resume go
 * through the dashboard's CSRF-aware request (token fetched, retried once), update the list and the
 * summary, say what happened, and report a refusal or a network failure instead of failing quietly.
 * Edit, View and Photos are links and a dialog; their markup is checked here too.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const appJs = read('public/assets/js/app.js');

const runner = path.join(__dirname, '../helpers/supplier-overlays-scenario.js');
/** Runs one package action in a child process and returns the events it produced. */
const run = options =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [runner, 'packageActions', Buffer.from(JSON.stringify(options), 'utf8').toString('base64')],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }
    )
  );

describe('delete a package', () => {
  test('asks first; on yes it deletes, reloads the list, refreshes the summary, says so and moves focus to the heading', () => {
    const log = run({ action: 'deletePackage', id: 'k1' });
    expect(log.events).toEqual([
      'DELETE /api/v1/me/packages/k1',
      'reloaded',
      'changed-event',
      'toast:success:Package deleted.',
    ]);
    expect(log.focused).toBe(true);
  });

  test('on no, nothing is sent', () => {
    const log = run({ action: 'deletePackage', confirm: false });
    expect(log.events).toEqual([]);
  });

  test('a refusal shows the server reason and leaves the list alone', () => {
    const log = run({ action: 'deletePackage', status: 403, error: 'Package not found' });
    expect(log.events).toEqual([
      'DELETE /api/v1/me/packages/k1',
      'toast:error:Could not delete the package: Package not found',
    ]);
  });

  test('a network failure says it failed and to try again', () => {
    const log = run({ action: 'deletePackage', throws: true });
    expect(log.events).toContain('toast:error:Could not delete the package. Please try again.');
    expect(log.events).not.toContain('reloaded');
  });
});

describe('pause and resume a package', () => {
  test('pause sends PUT .../pause, then refreshes the list and the summary', () => {
    const log = run({ action: 'togglePackagePause', pause: true });
    expect(log.events).toEqual([
      'PUT /api/v1/me/packages/k1/pause',
      'reloaded',
      'changed-event',
      'toast:success:Package paused.',
    ]);
    expect(log.focused).toBe(true);
  });

  test('resume sends PUT .../unpause', () => {
    const log = run({ action: 'togglePackagePause', pause: false });
    expect(log.events[0]).toBe('PUT /api/v1/me/packages/k1/unpause');
    expect(log.events).toContain('toast:success:Package resumed.');
  });

  test("resume refused at the plan limit shows the server's own words", () => {
    const log = run({
      action: 'togglePackagePause',
      pause: false,
      status: 403,
      error: 'You have reached the active package limit on your plan.',
    });
    expect(log.events).toEqual([
      'PUT /api/v1/me/packages/k1/unpause',
      'toast:error:Could not unpause the package: You have reached the active package limit on your plan.',
    ]);
  });

  test('a network failure is reported', () => {
    const log = run({ action: 'togglePackagePause', pause: true, throws: true });
    expect(log.events).toContain('toast:error:Could not pause the package. Please try again.');
  });
});

describe('package writes use the CSRF-aware request, not a bare token', () => {
  test('delete and pause go through packageRequest, which uses the dashboard sendJson (token refresh and one retry)', () => {
    expect(appJs).toContain('async function packageRequest(');
    expect(appJs).toContain('return home.sendJson(url, method)');
    const deleteBody = appJs.slice(
      appJs.indexOf('async function deletePackage('),
      appJs.indexOf('async function togglePackagePause(')
    );
    expect(deleteBody).not.toContain("window.__CSRF_TOKEN__ || ''");
  });
});

describe('Edit, View, Photos', () => {
  test('Edit opens the package dialog filled from the package, View is a link to the public page (off, with the reason, until approved), Photos opens the gallery for that package', () => {
    expect(appJs).toContain('data-action="edit-package"');
    expect(appJs).toContain('/package?slug=${slug}');
    expect(appJs).toContain('This package has no public page yet: it is awaiting approval');
    expect(appJs).toContain('/gallery?type=package&id=${encodeURIComponent(String(p.id');
    expect(appJs).toContain("window.SupplierDashboardOverlays?.open('package'");
  });
});
