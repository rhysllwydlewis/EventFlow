/**
 * Customer dashboard fixes, driven through a real DOM.
 *
 * The scripts run in a plain Node process (jsdom cannot be loaded through Jest's transform here)
 * and report their outcomes as JSON; this suite asserts on them. The scenarios are in
 * tests/helpers/customer-dashboard-fixes-scenarios.js.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

const results = JSON.parse(
  execFileSync(
    process.execPath,
    [path.join(root, 'tests/helpers/customer-dashboard-fixes-scenarios.js')],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  )
);

const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

describe('the Escape shortcut', () => {
  test('leaves a native dialog to close itself', () => {
    expect(results.escape.nativeDialogOpen.cancelled).toBe(false);
  });

  test('does not swallow Escape when nothing of its own is open', () => {
    expect(results.escape.nothingOpen.cancelled).toBe(false);
    expect(results.escape.alreadyHiddenModal.cancelled).toBe(false);
  });

  test('still closes a visible .modal', () => {
    expect(results.escape.visibleModal.cancelled).toBe(true);
    expect(results.escape.visibleModal.display).toBe('none');
    expect(results.escape.visibleModal.ariaHidden).toBe('true');
  });

  test('never hides the mobile navigation, which closes itself', () => {
    expect(results.escape.mobileMenuOnly).toEqual({
      cancelled: false,
      display: '',
      ariaHidden: null,
    });
    expect(results.escape.visibleModal.menuDisplay).toBe('');
  });
});

describe('device data after a different account signs in', () => {
  test('is kept for the same account', () => {
    expect(results.deviceData.sameAccount.eventflow_custom_budget).toBe('12000');
    expect(results.deviceData.sameAccount.eventflow_saved_suppliers).toBe('["s1"]');
  });

  test('is forgotten for another account, and the new account becomes the owner', () => {
    const { otherAccount } = results.deviceData;
    expect(otherAccount.eventflow_custom_budget).toBeNull();
    expect(otherAccount.eventflow_saved_suppliers).toBeNull();
    expect(otherAccount.eventflow_device_data_owner).toBe('u2');
  });

  test('is kept on the first sign-in, when nobody owns it yet, and unrelated keys are never touched', () => {
    expect(results.deviceData.firstSignIn.eventflow_custom_budget).toBe('12000');
    expect(results.deviceData.firstSignIn.eventflow_device_data_owner).toBe('u1');
    expect(results.deviceData.otherAccount.unrelated_key).toBe('keep');
  });

  test('is left alone when there is no user to compare with', () => {
    expect(results.deviceData.noUser.eventflow_custom_budget).toBe('12000');
    expect(results.deviceData.noUser.eventflow_device_data_owner).toBe('u1');
  });

  test('the dashboard asks for the check itself, not only the auth module', () => {
    expect(read('public/assets/js/pages/dashboard-customer-init.js')).toMatch(
      /scopeDeviceData\?\.\(user\)/
    );
  });
});

describe('the budget tile', () => {
  test('shows the range the plan wizard saved instead of a bare "Not set"', () => {
    expect(results.summary.wizardRange).toContain('Not set');
    expect(results.summary.wizardRange).toContain('£5,000–£10,000');
    expect(results.summary.upTo).toContain('Up to £1,000');
  });

  test('a figure from the budget form is the total', () => {
    expect(results.summary.number).toContain('of £7,500');
  });

  test('no budget at all says so without inventing a range', () => {
    expect(results.summary.noBudget).toContain('Not set');
    expect(results.summary.noBudget).not.toContain('You picked');
  });
});

describe('which plan the summary describes', () => {
  test('a plan with no date yet comes before one whose date has passed', () => {
    expect(results.summary.focus.undatedBeatsPassed).toBe('wedding');
  });

  test('the rest of the order is unchanged', () => {
    expect(results.summary.focus.upcomingBeatsUndated).toBe('soon');
    expect(results.summary.focus.latestPassedWhenAllDated).toBe('recent');
    expect(results.summary.focus.firstWhenNoneDated).toBe('a');
  });

  test('the guest list and budget pages use the same rule', () => {
    for (const file of ['public/assets/js/guests.js', 'public/assets/js/pages/budget-page.js']) {
      expect(read(file)).toMatch(/const undated = plans\.find\(plan => !planDay\(plan\)\);/);
    }
  });
});

describe('the summary when it is drawn twice', () => {
  test('a slow first draw does not overwrite the newer one', () => {
    expect(results.summary.race.budget).toContain('of £2,000');
    expect(results.summary.race.step).toBe('Draw 2');
  });
});

describe('the dashboard calendar', () => {
  const calendar = read('public/assets/js/calendar-view.js');

  test('names a plan by its name, which is where plans keep it', () => {
    expect(calendar).not.toMatch(/displayTitle\(plan\.eventName/);
    expect(calendar.match(/plan\.name \|\| plan\.eventName \|\| plan\.title/g)).toHaveLength(2);
  });

  test('shows a whole-day entry as a date, not as a time of day', () => {
    expect(calendar).toMatch(/function formatDateTime\(date, allDay\)/);
    expect(calendar).toMatch(/formatDateTime\(next\.start, next\.allDay\)/);
  });

  test('a plan opens its editor on the dashboard instead of the older planner page', () => {
    expect(calendar).toMatch(/cdh:edit-plan/);
  });
});
