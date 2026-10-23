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

describe('the Support card', () => {
  test('a failing /api/tickets shows an error with a retry, not a skeleton or "No support tickets yet"', () => {
    const { failing } = results.tickets;
    expect(failing.text).toContain('Your support tickets could not be loaded');
    expect(failing.retryButton).toBe(true);
    expect(failing.skeleton).toBe(false);
    expect(failing.text).not.toContain('No support tickets yet');
  });

  test('trying again once the server recovers shows the tickets', () => {
    expect(results.tickets.afterRetry.text).toContain('Cake');
  });

  test('a signed-out answer is an error too, not an empty list', () => {
    expect(results.tickets.signedOut.text).toContain('could not be loaded');
    expect(results.tickets.signedOut.text).not.toContain('No support tickets yet');
  });

  test('a working request with no tickets still says there are none', () => {
    expect(results.tickets.noTickets.text).toContain('No support tickets yet');
  });
});

describe('the summary row', () => {
  test('a failed guest-replies request says so instead of "No guest list yet"', () => {
    for (const key of ['guestsFailing', 'guestsNetworkError']) {
      const { tile, retry } = results.summary[key];
      expect(tile).toContain('Not available');
      expect(tile).toContain('could not load guest replies');
      expect(tile).not.toContain('No guest list yet');
      expect(retry).toBe(true);
    }
  });

  test('a working request with no guests still reports the expected count and no list', () => {
    expect(results.summary.guestsNoList.tile).toContain('80 expected');
    expect(results.summary.guestsNoList.tile).toContain('No guest list yet');
    expect(results.summary.guestsReplies.tile).toContain('2 of 4 replied');
  });

  test('the Budget tile splits committed money into budget items and package prices', () => {
    expect(results.summary.budgetWithPackages).toContain('£1,400 of £5,000');
    expect(results.summary.budgetWithPackages).toContain(
      '£1,000 in budget items + £400 in listed package prices'
    );
    expect(results.summary.budgetItemsOnly).not.toContain('package prices');
  });

  test('the checklist is asked about the focus plan', () => {
    expect(results.summary.milestonesUrl).toBe('/api/v1/customer/milestones?planId=p1');
  });
});

describe('the dashboard start-up script', () => {
  test('blocked browser storage does not stop the page drawing or the budget saving', () => {
    const { storageBlocked } = results.page;
    expect(storageBlocked.welcome).toBe('Welcome back, Ann');
    expect(storageBlocked.plans).toContain('Our wedding');
    expect(storageBlocked.tiles).toBe(4);
    expect(storageBlocked.saved).toContain('No saved suppliers yet');
    expect(storageBlocked.patches).toEqual([{ budget: 7500 }]);
    expect(storageBlocked.budgetStatus).toBe('Budget set to £7,500');
  });

  test('full browser storage does not skip the budget PATCH', () => {
    expect(results.page.storageFull.patches).toEqual([{ budget: 9000 }]);
    expect(results.page.storageFull.budgetStatus).toBe('Budget set to £9,000');
  });

  test('failed plans say so everywhere, never "No plans yet", and retry works', () => {
    const { plansFailing, plansRetried } = results.page;
    expect(plansFailing.plans).toContain('could not be loaded');
    expect(plansFailing.plans).not.toContain('No plans yet');
    expect(plansFailing.summary).toContain('could not be loaded');
    expect(plansFailing.lede).toBe('We could not load your plans just now.');
    expect(plansFailing.retryButton).toBe(true);
    // The failed fetch is not repeated behind the user's back for the list.
    expect(plansFailing.plansRequests).toBe(1);
    expect(plansRetried.plans).toContain('Our wedding');
    expect(plansRetried.lede).toContain('until Our wedding');
  });

  test('a failed refresh keeps the plans that were loaded and says it could not refresh', () => {
    expect(results.page.refreshFails.plans).toContain('Our wedding');
    expect(results.page.refreshFails.notice).toContain('Could not refresh your plans');
  });

  test('a dropped connection during the sign-in check is retried, then the page carries on', () => {
    expect(results.page.authBlip).toEqual({ welcome: 'Welcome back, Ann', meRequests: 3 });
  });

  test('if the check keeps failing the page uses the user the guard confirmed', () => {
    expect(results.page.authDownGuardUser.welcome).toBe('Welcome back, Guard');
  });

  test('with nobody confirmed it offers a retry instead of leaving for the home page', () => {
    const { authDownNobody } = results.page;
    expect(authDownNobody.banner).toContain('could not check that you are signed in');
    expect(authDownNobody.plansRequests).toBe(0);
    const init = read('public/assets/js/pages/dashboard-customer-init.js');
    expect(init).not.toMatch(/window\.location\.href = '\/'/);
    expect(init).toContain('/auth?redirect=');
  });

  test('a real refusal (401) is a sign-out: no retry banner, nothing loaded', () => {
    expect(results.page.authRefused).toEqual({ meRequests: 1, banner: false, plansRequests: 0 });
  });

  test('the plan editor asks before throwing away edits', () => {
    const { page } = results;
    expect(page.editUntouched.open).toBe(false);
    expect(page.editFirstCancel).toEqual({
      open: true,
      cancelLabel: 'Discard changes',
      status: 'You have unsaved changes. Save them, or choose Discard changes.',
    });
    expect(page.editEscapeWhileArmed.prevented).toBe(false);
    expect(page.editTypedAgain.cancelLabel).toBe('Cancel');
    expect(page.editCrossWhenDisarmed.open).toBe(true);
    expect(page.editDiscard.open).toBe(false);
  });
});

describe('storage access in the dashboard script', () => {
  test('every localStorage access goes through the guarded helpers', () => {
    const init = read('public/assets/js/pages/dashboard-customer-init.js');
    const bare = init
      .split('\n')
      .filter(line => /\blocalStorage\./.test(line) && !/^\s*(\/\/|\*)/.test(line));
    // Only the three helper bodies touch it directly.
    expect(bare).toHaveLength(3);
  });
});
