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
    for (const target of ['/api/me/plans', '/api/tickets']) {
      expect(neverAnswers[target]).toEqual({ rejected: 'AbortError' });
    }
    expect(neverAnswers.noticeAfter).toBe(false);
  });

  test('the confirmed user and an existing CSRF token stand in for a slow reply, and arrive', () => {
    // The scenario's fetch rejects the moment the request is aborted, like a browser's. The
    // stand-in only reaches the caller when it is handed over before the abort.
    const { standIns } = results.guard;
    expect(standIns.me.status).toBe(200);
    expect(standIns.me.body.user.id).toBe('u1');
    expect(standIns.me.fallbackHeader).toBe('timeout');
    for (const key of ['csrf', 'csrfV1']) {
      expect(standIns[key].status).toBe(200);
      expect(standIns[key].body.csrfToken).toBe('token-from-page');
      expect(standIns[key].fallbackHeader).toBe('timeout');
    }
  });

  test('a CSRF cookie that is not valid percent-encoding still gets a stand-in', () => {
    const { malformedCsrfCookie } = results.guard;
    expect(malformedCsrfCookie.status).toBe(200);
    expect(malformedCsrfCookie.body.csrfToken).toBe('%E0%A4%A');
  });

  test('a request carrying its own AbortSignal is still cut off, and the caller can still cancel', () => {
    const { callerSignal } = results.guard;
    expect(callerSignal.cancelledAtCutOff).toEqual({ rejected: 'AbortError' });
    expect(callerSignal.cancelledByCaller).toEqual({ rejected: 'AbortError' });
    expect(callerSignal.alreadyAborted).toEqual({ rejected: 'AbortError' });
    expect(callerSignal.noticeAfter).toBe(false);
  });

  test('the background ticket refresh gets no "still loading" notice; a slow plans request does, at the bottom', () => {
    const { ticketPoll } = results.guard;
    expect(ticketPoll.noticeWhileSlow).toBe(false);
    expect(ticketPoll.rejected).toBe('AbortError');
    expect(ticketPoll.plansNoticeWhileSlow).toBe(true);
    expect(ticketPoll.plansNoticeIsLow).toBe(true);
  });

  test('paths the page never asks for are not intercepted', () => {
    expect(results.guard.unguarded).toMatchObject({ status: 200, fallbackHeader: null });
  });

  test('the timeout handling is in place before the sign-in check has finished', () => {
    expect(results.guard.earlyInstall.wrappedBeforeCheckEnds).toBe(true);
    expect(results.guard.earlyInstall.pageCall).toEqual({ rejected: 'AbortError' });
  });

  describe('the sign-in check', () => {
    const { check } = results.guard;

    test('a signed-in customer is let in', () => {
      expect(check.signedIn).toMatchObject({ revealed: true, navigations: 0, unconfirmed: false });
    });

    test('a real refusal (401 or 403) is the only thing that sends a customer to sign in', () => {
      for (const refused of [check.refused, check.forbidden]) {
        expect(refused).toMatchObject({ meRequests: 1, navigations: 1, revealed: false });
      }
    });

    test('a server error, a dropped connection or a hung request shows the page, not the sign-in page', () => {
      for (const failed of [check.serverDown, check.offline, check.hung]) {
        expect(failed).toMatchObject({
          meRequests: 3,
          navigations: 0,
          revealed: true,
          unconfirmed: true,
        });
      }
    });

    test('a request that hangs shows a notice meanwhile, and the notice goes away', () => {
      expect(check.hung.noticeShown).toBe(true);
      expect(check.hung.noticeLeft).toBe(false);
      expect(check.serverDown.noticeShown).toBe(false);
    });

    test('a check that recovers on a retry lets the customer in as normal', () => {
      expect(check.recovers).toMatchObject({ revealed: true, navigations: 0, unconfirmed: false });
    });

    test('supplier and admin pages still redirect when the check fails outright', () => {
      for (const other of [check.supplierServerDown, check.adminOffline]) {
        expect(other).toMatchObject({ navigations: 1, revealed: false, unconfirmed: false });
      }
    });

    test('a slow admin check is not cancelled: it keeps waiting as it always did, with a notice', () => {
      // Cancelling would turn a working but slow session into a redirect.
      expect(check.adminHung).toMatchObject({
        meRequests: 1,
        navigations: 0,
        revealed: false,
        unconfirmed: false,
        noticeShown: true,
      });
    });

    test('only the customer dashboard gets the fetch wrapper', () => {
      expect(check.signedIn.wrapped).toBe(true);
      for (const other of [check.supplierServerDown, check.adminOffline, check.adminHung]) {
        expect(other.wrapped).toBe(false);
      }
    });
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

describe('the JadeAssist launcher badge on customer pages', () => {
  test('the "1" nudge is hidden on the dashboard, budget and guest pages', () => {
    for (const hidden of Object.values(results.badge.quietOn)) {
      expect(hidden).toBe(true);
    }
  });

  test('it is left alone everywhere else', () => {
    for (const hidden of Object.values(results.badge.shownOn)) {
      expect(hidden).toBe(false);
    }
  });
});

describe('browser storage and cookie consent', () => {
  const { consent } = results.badge;

  test('rejecting in the cookie banner forgets remembered choices and browser copies', () => {
    for (const key of [
      'ef_account_type_notice_dismissed',
      'ef_customer_plan',
      'eventflow_saved_suppliers',
      'eventflow_custom_budget',
    ]) {
      expect(consent.rejectForgets).toContain(key);
    }
  });

  test("rejecting does not wipe a customer's own device-only budget or the guest-plan token", () => {
    for (const key of [
      'ef_budget_v2',
      'ef_budget',
      'ef_budget_imported',
      'eventflow_guest_plan_token',
    ]) {
      expect(consent.rejectKeeps).toContain(key);
      expect(consent.rejectForgets).not.toContain(key);
    }
  });

  describe('the one check every page asks before remembering a choice', () => {
    test('follows the visitor once the banner has loaded', () => {
      expect(consent.gate.accepted).toBe(true);
      expect(consent.gate.declined).toBe(false);
      expect(consent.gate.notChosenYet).toBe(false);
    });

    test('says no when the check itself fails', () => {
      expect(consent.gate.throws).toBe(false);
    });

    test('a page with no cookie banner has no choice to follow', () => {
      expect(consent.gate.noBannerOnPage).toBe(true);
    });

    test('a page whose banner script has not run yet has not asked the visitor, so says no', () => {
      expect(consent.gate.bannerScriptNotRunYet).toBe(false);
    });

    test('the pages ask it rather than carrying their own copy of the rule', () => {
      for (const file of [
        'public/assets/js/pages/dashboard-customer-init.js',
        'public/assets/js/pages/budget-page.js',
        'public/assets/js/guests.js',
        'public/assets/js/pages/dashboard-account-type-notice.js',
        'public/assets/js/app.js',
      ]) {
        const code = read(file);
        expect(code).toContain('efMayKeepFunctionalStorage');
        expect(code).not.toMatch(/getConsent\(\)\??\.functional/);
      }
    });
  });

  test('declining functional storage means a dismissed notice is not remembered', () => {
    expect(consent.noticeDeclined).toBe(false);
    expect(consent.noticeAccepted).toBe(true);
    expect(consent.noticeNoBanner).toBe(true);
  });

  test('declining functional storage keeps the browser copy of the budget off but still saves it', () => {
    expect(consent.budgetDeclined.stored).toBeNull();
    expect(consent.budgetDeclined.patches).toEqual([{ budget: 4000 }]);
    expect(consent.budgetDeclined.status).toBe('Budget set to £4,000');
    expect(consent.budgetAccepted.stored).toBe('4000');
  });

  test('a different account signing in forgets every device-only budget and plan choice', () => {
    for (const [key, value] of Object.entries(consent.accountSwitch)) {
      if (key === 'eventflow_guest_plan_token') {
        // Not account data: it is the way a guest's plan is claimed after sign-up.
        expect(value).toBe('x');
      } else {
        expect(value).toBeNull();
      }
    }
  });
});

describe('the sign-in guard and the dashboard start-up script agree', () => {
  test('a customer the guard could not confirm is sent to the right dashboard by the start-up check', () => {
    const init = read('public/assets/js/pages/dashboard-customer-init.js');
    expect(init).toContain("{ admin: '/admin', supplier: '/dashboard/supplier' }[user.role]");
  });
});

describe('the guest plan token (a plan claimed after sign-up)', () => {
  const { claim } = results.fixes;

  test('is dropped when the server gives a final answer, or the claim worked', () => {
    for (const final of ['claimed', 'alreadyHasPlan', 'notFound', 'conflict']) {
      expect(claim[final]).toEqual({ token: null, claims: 1 });
    }
  });

  test('is kept when a proxy answers with an HTML page instead of JSON (502, 504)', () => {
    expect(claim.proxyPage502).toEqual({ token: 'GUEST', claims: 1 });
    expect(claim.proxyPage504).toEqual({ token: 'GUEST', claims: 1 });
  });

  test('is kept on a 5xx, a 429 or a dropped connection', () => {
    for (const transient of ['unavailable503', 'serverError500', 'tooMany429', 'offline']) {
      expect(claim[transient]).toEqual({ token: 'GUEST', claims: 1 });
    }
  });

  test('a rejected CSRF token is retried once with a fresh one, and the token kept if it keeps failing', () => {
    expect(claim.csrfRefusedThenOk).toEqual({ token: null, claims: 2 });
    expect(claim.csrfRefusedAlways).toEqual({ token: 'GUEST', claims: 2 });
  });
});

describe('the budget form when the plans could not be loaded', () => {
  const { budgetPlansFailed, budgetPlansFailedDeclined, budgetPlansFailedThenLoads } =
    results.fixes;

  test('never says the budget was saved, and sends nothing', () => {
    for (const failed of [budgetPlansFailed, budgetPlansFailedDeclined]) {
      expect(failed.patches).toEqual([]);
      expect(failed.status).not.toContain('Budget set to');
      expect(failed.status).toContain('could not load your plans');
      expect(failed.status).toContain('has not been saved');
      expect(failed.retryInStatus).toBe(true);
    }
  });

  test('leaves the honest error where it is instead of drawing "no plans"', () => {
    for (const failed of [budgetPlansFailed, budgetPlansFailedDeclined]) {
      expect(failed.lede).toBe('We could not load your plans just now.');
      expect(failed.summary).toContain('could not be loaded');
      expect(failed.summary).not.toContain('Create a plan');
      expect(failed.listError).toContain('could not be loaded');
    }
  });

  test('declining functional storage does not make it claim there is "no plan"', () => {
    expect(budgetPlansFailedDeclined.status).not.toMatch(/no plan/);
  });

  test('its retry reloads the plans once however often it is clicked', () => {
    expect(budgetPlansFailed.afterStatusRetry.status).toContain('Your plans have loaded');
    expect(budgetPlansFailed.afterStatusRetry.plans).toContain('Our wedding');
    // the page load, the save attempt and one retry (clicked twice)
    expect(budgetPlansFailed.afterStatusRetry.plansRequests).toBe(3);
  });

  test('if the plans load on the way, the budget is saved on the focus plan as usual', () => {
    expect(budgetPlansFailedThenLoads.patches).toEqual([{ budget: 5000 }]);
    expect(budgetPlansFailedThenLoads.status).toBe('Budget set to £5,000');
  });

  test('"no plan" is only said when the plans did load and there are none', () => {
    expect(results.fixes.budgetNoPlanDeclined.patches).toEqual([]);
    expect(results.fixes.budgetNoPlanDeclined.status).toContain('no plan to save it to yet');
    expect(results.fixes.budgetNoPlanDeclined.status).toContain('cookie choices');
  });
});

describe('the saved suppliers card', () => {
  const { saved } = results.fixes;

  test('a request that throws is an error with a retry, not "No saved suppliers yet"', () => {
    for (const failed of [saved.networkErrorNoCopy, saved.serverError]) {
      expect(failed.text).toContain('could not be loaded');
      expect(failed.text).not.toContain('No saved suppliers yet');
      expect(failed.retry).toBe(true);
      expect(failed.viewButtonHidden).toBe(true);
    }
  });

  test('a copy kept in the browser stands in only when there is one, and is labelled', () => {
    expect(saved.networkErrorWithCopy.text).toContain('2 saved suppliers');
    expect(saved.networkErrorWithCopy.text).toContain('last saved list');
    expect(saved.networkErrorWithCopy.retry).toBe(true);
  });

  test('trying again asks once however often it is clicked, then shows the suppliers', () => {
    expect(saved.retry.text).toContain('Cake Co');
    expect(saved.retry.extraRequests).toBe(1);
  });
});

describe('retries and notices on the start-up script', () => {
  const { fixes } = results;

  test('clicking a retry button twice sends one request', () => {
    expect(fixes.retryOnce).toEqual({ plans: 1, steps: 1 });
  });

  test('the sign-in banner retry runs one check, keeps one banner and keeps focus', () => {
    expect(fixes.signInRetry).toEqual({
      disabledWhileChecking: true,
      checks: 3,
      focusOnNewRetry: true,
      banners: 1,
    });
  });

  test('Escape on an edited plan form asks first, then lets go; on an untouched one it just closes', () => {
    const escape = fixes.escapeOnDirtyForm;
    expect(escape.firstPrevented).toBe(true);
    expect(escape.stillOpen).toBe(true);
    expect(escape.cancelLabel).toBe('Discard changes');
    expect(escape.status).toContain('unsaved changes');
    expect(escape.secondPrevented).toBe(false);
    expect(escape.cleanPrevented).toBe(false);
  });

  test('a plan that was deleted does not come back when the refresh after it fails', () => {
    expect(fixes.deletedPlan.deleteRequests).toBe(1);
    expect(fixes.deletedPlan.plans).toContain('Our wedding');
    expect(fixes.deletedPlan.plans).not.toContain('Hen weekend');
    expect(fixes.deletedPlan.notice).toContain('may be out of date');
  });

  test('quotes in a plan name cannot add attributes to the markup', () => {
    const escaped = fixes.escapedName;
    expect(escaped.attributesInList).toBe(0);
    expect(escaped.attributesInDialog).toBe(0);
    expect(escaped.ariaLabel).toBe(`Edit ${escaped.hostile}`);
    expect(escaped.inputValue).toBe(escaped.hostile);
    expect(results.summary.escapedHome.withAttribute).toBe(0);
    expect(results.summary.escapedHome.editPlanAttribute).toContain('onfocus');
  });
});

describe('the Budget tile when package prices cannot be fetched', () => {
  const { bulkFails } = results.summary;

  test('says the packages could not be priced instead of showing a confident low figure', () => {
    for (const key of ['status500', 'networkError']) {
      expect(bulkFails[key]).toContain('1 package could not be priced just now');
    }
    expect(bulkFails.twoPackages).toContain('2 packages could not be priced just now');
  });

  test('says so when no total is set too', () => {
    expect(bulkFails.noBudgetSet).toContain('1 saved package could not be priced just now');
  });

  test('says nothing of the kind when the prices were fetched', () => {
    expect(results.summary.budgetWithPackages).not.toContain('could not be priced');
  });
});

describe('the Support card and its refresh', () => {
  const fixes = results.ticketFixes;

  test('a failed sign-in check carries on with the user the guard confirmed', () => {
    expect(fixes.checkFailsGuardUser.text).toContain('Cake');
  });

  test('with nobody confirmed it is an error with a retry, never "Sign in to view tickets"', () => {
    for (const failed of [fixes.checkFails, fixes.checkThrows]) {
      expect(failed.text).toContain('could not be loaded');
      expect(failed.text).not.toContain('Sign in');
    }
    expect(fixes.checkFails.retryButton).toBe(true);
    expect(fixes.checkFails.afterRetry).toContain('Cake');
  });

  test('the New ticket button opens the form even though the check failed', () => {
    expect(fixes.checkFails.newTicketOpens).toBe(true);
  });

  test('tickets already shown stay when a refresh fails, with a note, and recover afterwards', () => {
    expect(fixes.staleList.after).toContain('Cake');
    expect(fixes.staleList.after).toContain('may be out of date');
    expect(fixes.staleList.afterRefusal).toContain('Cake');
    expect(fixes.staleList.afterRefusal).toContain('signed out');
    expect(fixes.staleList.recovered).toContain('Cake');
    expect(fixes.staleList.recovered).not.toContain('out of date');
  });

  test('a refusal does not stop the refresh for good: it carries on slowly and recovers', () => {
    expect(fixes.refusedFirst.text).toContain('signed out');
    expect(fixes.refusedFirst.delays[0]).toBe(300000);
    expect(fixes.refusedFirst.recovered).toContain('Cake');
    // ...and goes back to the normal minute once it works again
    expect(fixes.refusedFirst.delays[1]).toBe(60000);
  });

  test('failing refreshes wait longer each time, never less than a healthy one', () => {
    // a healthy refresh waits 60 s
    expect(fixes.backoffOnTicketCard.slice(0, 3)).toEqual([120000, 240000, 240000]);
    for (const delay of fixes.backoffOnTicketCard) {
      expect(delay).toBeGreaterThanOrEqual(60000);
    }
    const sorted = [...fixes.backoffDefault].sort((a, b) => a - b);
    expect(fixes.backoffDefault).toEqual(sorted);
    expect(fixes.backoffDefault[0]).toBe(10000);
  });

  test('a caller that does not handle failures still stops after a refusal (the supplier card)', () => {
    expect(fixes.refusedWithoutErrorHandler.callbackArgs).toEqual([[]]);
    expect(fixes.refusedWithoutErrorHandler.timersScheduled).toEqual([]);
  });
});

describe('device-only data is cleared for a different account before it is read', () => {
  const { deviceData } = results;

  test("the budget page does not show the previous account's device budget", () => {
    expect(deviceData.budget_secondAccount.showsOldFigure).toBe(false);
    expect(deviceData.budget_secondAccount.stored).toBeNull();
  });

  test('the same account still gets its own device budget back (the check can tell them apart)', () => {
    expect(deviceData.budget_sameAccount.showsOldFigure).toBe(true);
  });

  test("the guest list page ignores the previous account's picked plan", () => {
    expect(deviceData.guests_secondAccount.subtitle).toContain('Alpha');
    expect(deviceData.guests_secondAccount.stored).toBeNull();
    expect(deviceData.guests_sameAccount.subtitle).toContain('Beta');
  });
});
