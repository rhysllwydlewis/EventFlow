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

  test('the dashboard asks for the check itself for the signed-in user, not only the auth module', () => {
    expect(results.cards.atLimit.scoped).toEqual(['u1']);
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

describe('the greeting for a plan that has passed', () => {
  test('offers a new plan while the customer can still have one', () => {
    expect(results.summary.lede.underLimit).toBe(
      'Hen weekend has passed. Start a new plan whenever you are ready.'
    );
    expect(results.summary.lede.noLimitGiven).toBe(results.summary.lede.underLimit);
  });

  test('does not, at the most plans allowed: the wizard would refuse it at the last step', () => {
    expect(results.summary.lede.atLimit).toMatch(/has passed\.$/);
    expect(results.summary.lede.atLimit).not.toMatch(/Start a new plan/);
  });
});

describe('the plans card at the plan limit', () => {
  const { cards } = results;

  test('hides "New plan" and says why when the customer has the most plans allowed', () => {
    expect(cards.atLimit.newPlanHidden).toBe(true);
    expect(cards.atLimit.plans).toContain('You have 3 of 3 plans. Delete one to start another.');
  });

  test('leaves "New plan" alone under the limit', () => {
    expect(cards.underLimit.newPlanHidden).toBe(false);
    expect(cards.underLimit.plans).not.toContain('Delete one to start another');
  });

  test('uses the limit the server reports, and 3 until it does', () => {
    expect(cards.serverLimit.newPlanHidden).toBe(true);
    expect(cards.serverLimit.plans).toContain('You have 2 of 2 plans');
    expect(cards.noLimitReported.newPlanHidden).toBe(true);
  });
});

describe('the saved suppliers card', () => {
  test('says it could not load, with a retry, when the request fails, not that nothing is saved', () => {
    const { shortlistFails } = results.cards;
    expect(shortlistFails.saved).toContain('could not be loaded');
    expect(shortlistFails.saved).not.toContain('No saved suppliers yet');
    expect(shortlistFails.retryButton).toBe(true);
    expect(shortlistFails.viewSavedHidden).toBe(true);
  });

  test('still says nothing is saved when the request works and the list is empty', () => {
    expect(results.cards.underLimit.saved).toContain('No saved suppliers yet');
    expect(results.cards.underLimit.retryButton).toBe(false);
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

describe('the greeting for a plan that has passed', () => {
  test('offers a new plan while the customer can still have one', () => {
    expect(results.summary.lede.underLimit).toBe(
      'Hen weekend has passed. Start a new plan whenever you are ready.'
    );
    expect(results.summary.lede.noLimitGiven).toBe(results.summary.lede.underLimit);
  });

  test('does not, at the most plans allowed: the wizard would refuse it at the last step', () => {
    expect(results.summary.lede.atLimit).toMatch(/has passed\.$/);
    expect(results.summary.lede.atLimit).not.toMatch(/Start a new plan/);
  });
});

describe('the plans card at the plan limit', () => {
  const init = read('public/assets/js/pages/dashboard-customer-init.js');
  const html = read('public/dashboard-customer.html');

  test('hides "New plan" and says why, using the limit the server reports', () => {
    expect(html).toContain('id="cdh-new-plan"');
    expect(init).toMatch(/newPlanLink\.hidden = atLimit/);
    expect(init).toMatch(/Delete one to start another/);
    expect(init).toMatch(/rememberPlanLimit\(data\)/);
  });
});

describe('the summary when it is drawn twice', () => {
  test('a slow first draw does not overwrite the newer one', () => {
    expect(results.summary.race.budget).toContain('of £2,000');
    expect(results.summary.race.step).toBe('Draw 2');
  });
});

describe('the dashboard calendar "Next up"', () => {
  const { calendar } = results;

  test('names a plan by its name, which is where plans keep it', () => {
    expect(calendar.named).toContain('Our wedding');
    expect(calendar.named).not.toContain('Untitled');
  });

  test('shows a whole-day entry as a date, not as a time of day', () => {
    expect(calendar.named).toContain(calendar.expectedDate);
    expect(calendar.named).not.toMatch(/\d{2}:\d{2}/);
  });

  test('still shows an entry for today until the day is over', () => {
    expect(calendar.today).toContain('Launch party');
  });

  test('has nothing to show for a plan with no date or one that has passed', () => {
    expect(calendar.undated).toMatch(/^No upcoming/);
    expect(calendar.passed).toMatch(/^No upcoming/);
  });

  test('a plan opens its editor on the dashboard instead of the older planner page', () => {
    expect(read('public/assets/js/calendar-view.js')).toMatch(/cdh:edit-plan/);
  });
});
