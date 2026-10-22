'use strict';

/**
 * The first-visit setup guide for new suppliers (supplier-dashboard-onboarding.js): which steps it
 * shows, that they come from the same next-steps data as the Next steps card, who sees it, and how
 * its progress is kept. The script runs in a vm with a stand-in window; the dialog itself is
 * exercised in a real browser (see the Playwright run in the PR notes).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const html = read('public/dashboard-supplier.html');
const guideSource = read('public/assets/js/pages/supplier-dashboard-onboarding.js');
const homeSource = read('public/assets/js/pages/supplier-dashboard-home.js');

/** Loads the guide script with a fake window whose localStorage can be swapped. */
function loadGuide(storage, consent) {
  const window = {
    localStorage: storage,
    SupplierDashboardHome: null,
    ...(consent ? { CookieConsent: { getConsent: () => consent } } : {}),
  };
  const document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
  };
  vm.runInNewContext(guideSource, { window, document, console });
  return window.SupplierDashboardOnboarding;
}

/** A Map-backed localStorage. */
const memoryStorage = () => {
  const store = new Map();
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
    key: index => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
    store,
  };
};

/** The page's own step-to-action mapping, copied from the home script's stepAction. */
const how = step => {
  const key = String(step.key || '');
  if (/email/u.test(key)) {
    return { action: 'resend-email' };
  }
  if (/package/u.test(key) && /photo|image/u.test(key)) {
    return { action: 'scroll', target: 'my-packages' };
  }
  if (/package/u.test(key)) {
    return { action: 'new-package' };
  }
  if (/approv|verif/u.test(key)) {
    return { action: 'verify' };
  }
  if (/gallery|photo/u.test(key)) {
    return { action: 'edit-profile', focus: 'sup-photo-drop' };
  }
  return { action: 'edit-profile', focus: 'sup-name' };
};

const step = (key, label, extra) => ({
  key,
  label,
  done: false,
  locked: false,
  waiting: false,
  ...extra,
});

describe('setup guide: structure', () => {
  test('the guide is a native dialog with progress, Skip, Back and Next, and a reopen link', () => {
    const start = html.indexOf('<dialog id="sdh-guide-dialog"');
    const dialog = html.slice(start, html.indexOf('</dialog>', start));
    expect(dialog).toMatch(/aria-labelledby="sdh-guide-title"/);
    expect(dialog).toMatch(/id="sdh-guide-bar"[^>]*role="progressbar"/);
    [
      'sdh-guide-count',
      'sdh-guide-skip',
      'sdh-guide-back',
      'sdh-guide-next',
      'sdh-guide-action',
    ].forEach(id => expect(dialog).toContain(`id="${id}"`));
    expect(dialog).toContain('aria-label="Close setup guide"');
    expect(html).toMatch(/id="sdh-guide-open"[^>]*hidden/);
    expect(html).toMatch(/supplier-dashboard-onboarding\.js\?v=\d/);
  });

  test('the guide holds no steps of its own in the markup: they are built from next-steps data', () => {
    expect(html).not.toMatch(/Step \d of \d/);
    expect(guideSource).toContain('getContext');
    expect(guideSource).toContain('stepAction');
    expect(homeSource).toContain("document.dispatchEvent(new CustomEvent('sdh:rendered'))");
  });

  test('progress is kept per user in the browser and on the account, with failures tolerated', () => {
    expect(guideSource).toContain("'ef.supplierGuide.v1.'");
    expect(guideSource).toMatch(/try \{\s*const raw = window\.localStorage/);
    expect(guideSource).toMatch(/try \{\s*window\.localStorage\.setItem/);
    // The account copy goes through the dashboard's own helpers (CSRF handled), never a bare fetch.
    expect(guideSource).not.toMatch(/\bfetch\(/);
    expect(guideSource).toContain('/api/supplier/guide-progress');
  });
});

describe('setup guide: steps', () => {
  const guide = loadGuide(memoryStorage());

  test('a supplier with no profile gets: welcome, create the profile, then what comes later', () => {
    const steps = guide.buildSteps({ loaded: true, noProfile: true }, how);
    expect(steps.map(item => item.id)).toEqual(['welcome', 'profile', 'packages', 'verify']);
    expect(steps[1].cta).toMatchObject({
      label: 'Create your profile',
      action: 'edit-profile',
      focus: 'sup-name',
    });
    // Later steps explain, they do not offer a button that cannot work yet.
    expect(steps[2].cta).toBeNull();
    expect(steps[2].note).toMatch(/approved/);
    expect(steps[3].cta).toBeNull();
  });

  test('every button is the Next steps card button: same label, same action', () => {
    const list = [
      step('verify-email', 'Verify your email address'),
      step('profile-description', 'Add a description'),
      step('first-package', 'Create your first package'),
      step('get-approved', 'Get your profile verified'),
      step('profile-gallery', 'Add photos to your gallery'),
    ];
    const steps = guide.buildSteps({ loaded: true, noProfile: false, steps: { steps: list } }, how);
    expect(steps.map(item => item.id)).toEqual([
      'welcome',
      'email',
      'profile',
      'packages',
      'verify',
      'photos',
    ]);
    steps.slice(1).forEach(item => {
      const source = list.find(candidate => candidate.label === item.cta.label);
      expect(source).toBeTruthy();
      expect(item.cta.action).toBe(how(source).action);
    });
  });

  test('finished steps are left out, so the guide never asks for what the card shows as done', () => {
    const list = [
      step('verify-email', 'Verify your email address', { done: true }),
      step('profile-description', 'Add a description', { done: true }),
      step('first-package', 'Create your first package'),
      step('get-approved', 'Get your profile verified', { done: true }),
    ];
    const steps = guide.buildSteps({ loaded: true, noProfile: false, steps: { steps: list } }, how);
    expect(steps.map(item => item.id)).toEqual(['welcome', 'packages']);
  });

  test('with everything done only the welcome is left, so there is nothing to reopen', () => {
    const list = [step('verify-email', 'Verify', { done: true })];
    expect(
      guide.buildSteps({ loaded: true, noProfile: false, steps: { steps: list } }, how)
    ).toHaveLength(1);
  });

  test("a locked step says why (the card's reason) and a step in review says so; neither has a button", () => {
    const list = [
      step('first-package', 'Create your first package', {
        locked: true,
        lockedReason: 'Your profile must be approved first',
      }),
      step('get-approved', 'Verification is in review', { waiting: true }),
    ];
    const steps = guide.buildSteps({ loaded: true, noProfile: false, steps: { steps: list } }, how);
    const packages = steps.find(item => item.id === 'packages');
    const verify = steps.find(item => item.id === 'verify');
    expect(packages.cta).toBeNull();
    expect(packages.note).toBe('Your profile must be approved first');
    expect(verify.cta).toBeNull();
    expect(verify.note).toMatch(/in review/);
  });

  test('polish steps (banner, tagline, social links) and review requests are not part of the guide', () => {
    const list = [
      step('profile-coverImage', 'Add banner'),
      step('social-links', 'Add social links'),
      step('first-review', 'Ask a past customer for a review'),
    ];
    const steps = guide.buildSteps({ loaded: true, noProfile: false, steps: { steps: list } }, how);
    expect(steps.map(item => item.id)).toEqual(['welcome']);
  });

  test('before the page has loaded there is only the welcome (nothing is guessed)', () => {
    expect(guide.buildSteps({ loaded: false }, how).map(item => item.id)).toEqual(['welcome']);
    expect(guide.buildSteps(null, how).map(item => item.id)).toEqual(['welcome']);
  });
});

describe('setup guide: when part of the page could not be loaded', () => {
  const guide = loadGuide(memoryStorage());

  test('the welcome step says a step may be missing', () => {
    const steps = guide.buildSteps(
      {
        loaded: true,
        noProfile: false,
        steps: { steps: [] },
        model: { unavailable: ['packages'] },
      },
      how
    );
    expect(steps[0].note).toMatch(/step may be missing/);
  });

  test('and says nothing when everything loaded', () => {
    const steps = guide.buildSteps(
      { loaded: true, noProfile: false, steps: { steps: [] }, model: { unavailable: [] } },
      how
    );
    expect(steps[0].note).toBe('');
  });
});

describe('setup guide: who sees it by themselves', () => {
  const guide = loadGuide(memoryStorage());
  const model = (packages, approved, reviews) => ({
    packages: { total: packages },
    verification: { approved },
    reviews: { count: reviews },
  });

  test('a supplier with no profile, or a profile with nothing set up, yes', () => {
    expect(guide.isBrandNew({ loaded: true, noProfile: true })).toBe(true);
    expect(guide.isBrandNew({ loaded: true, model: model(0, false, 0) })).toBe(true);
  });

  test('anyone with a package, an approval or a review, no; and nothing before the page has loaded', () => {
    expect(guide.isBrandNew({ loaded: true, model: model(1, false, 0) })).toBe(false);
    expect(guide.isBrandNew({ loaded: true, model: model(0, true, 0) })).toBe(false);
    expect(guide.isBrandNew({ loaded: true, model: model(0, false, 2) })).toBe(false);
    expect(guide.isBrandNew({ loaded: false, noProfile: true })).toBe(false);
    expect(guide.isBrandNew({ loaded: true, model: null })).toBe(false);
  });
});

describe('setup guide: remembering progress', () => {
  test('progress is stored per user id', () => {
    const storage = memoryStorage();
    const guide = loadGuide(storage);
    guide.writeProgress({ id: 'u1' }, 'dismissed', 'packages');
    guide.writeProgress({ id: 'u2' }, 'completed', '');
    expect(guide.readProgress({ id: 'u1' })).toMatchObject({
      status: 'dismissed',
      step: 'packages',
    });
    expect(guide.readProgress({ id: 'u2' })).toMatchObject({ status: 'completed' });
    expect(guide.readProgress({ id: 'u3' })).toEqual({});
    expect(guide.storageKey({ id: 'u1' })).toBe('ef.supplierGuide.v1.u1');
  });

  test('corrupt or blocked storage never throws', () => {
    const corrupt = memoryStorage();
    corrupt.setItem('ef.supplierGuide.v1.u1', '{not json');
    expect(loadGuide(corrupt).readProgress({ id: 'u1' })).toEqual({});
    const blocked = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    const guide = loadGuide(blocked);
    expect(guide.readProgress({ id: 'u1' })).toEqual({});
    expect(() => guide.writeProgress({ id: 'u1' }, 'dismissed', 'x')).not.toThrow();
  });
});

describe('setup guide: the dialog in jsdom', () => {
  const { execFileSync } = require('child_process');
  const runner = path.join(__dirname, '../helpers/supplier-overlays-scenario.js');
  const context = {
    loaded: true,
    noProfile: true,
    user: { id: 'u-test' },
    model: null,
    steps: null,
  };
  const log = JSON.parse(
    execFileSync(
      process.execPath,
      [runner, 'guide', Buffer.from(JSON.stringify({ context }), 'utf8').toString('base64')],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }
    )
  );

  test('it opens by itself once the dashboard has drawn, for a new supplier', () => {
    expect(log.autoOpened).toBe(true);
    expect(log.count1).toBe('Step 1 of 4');
    expect(log.title1).toBe('Welcome to your dashboard');
    expect(log.backHidden1).toBe(true);
    expect(log.linkHidden).toBe(false);
  });

  test('Next goes to the profile step, with the page button and a progress value', () => {
    expect(log.count2).toBe('Step 2 of 4');
    expect(log.cta2).toBe('Create your profile');
    expect(log.ctaAction2).toBe('edit-profile');
    expect(Number(log.barNow)).toBe(50);
  });

  test('Skip closes it and remembers the step; it does not come back by itself', () => {
    expect(log.closedAfterSkip).toBe(true);
    expect(log.storedAfterSkip).toEqual({ status: 'dismissed', step: 'profile' });
    expect(log.reopenedByItself).toBe(false);
  });

  test('the Setup guide link resumes where it was left, and Finish marks it completed', () => {
    expect(log.resumedCount).toBe('Step 2 of 4');
    expect(log.lastNext).toBe('Finish');
    expect(log.closedAfterFinish).toBe(true);
    expect(log.storedAfterFinish).toBe('completed');
  });
});

describe('setup guide progress follows the cookie choice', () => {
  test('is kept in the browser when functional storage is allowed', () => {
    const storage = memoryStorage();
    const guide = loadGuide(storage, { essential: true, functional: true });
    guide.writeProgress({ id: 'u1' }, 'dismissed', 'packages');
    expect(storage.store.has('ef.supplierGuide.v1.u1')).toBe(true);
    expect(guide.readProgress({ id: 'u1' })).toMatchObject({ status: 'dismissed' });
  });

  test('is NOT written to the browser when functional storage is not allowed, but lasts the visit', () => {
    const storage = memoryStorage();
    const guide = loadGuide(storage, { essential: true, functional: false });
    guide.writeProgress({ id: 'u1' }, 'dismissed', 'packages');
    expect(storage.store.size).toBe(0);
    // Skipped stays skipped for the rest of this page view.
    expect(guide.readProgress({ id: 'u1' })).toMatchObject({
      status: 'dismissed',
      step: 'packages',
    });
  });

  test('anything saved earlier is not read back once functional storage is declined', () => {
    const storage = memoryStorage();
    loadGuide(storage).writeProgress({ id: 'u1' }, 'completed', '');
    const declined = loadGuide(storage, { essential: true, functional: false });
    expect(declined.readProgress({ id: 'u1' })).toEqual({});
  });

  test('erasing removes every guide record, and nothing else', () => {
    const storage = memoryStorage();
    const guide = loadGuide(storage);
    guide.writeProgress({ id: 'u1' }, 'dismissed', 'a');
    guide.writeProgress({ id: 'u2' }, 'completed', '');
    storage.setItem('theme', 'dark');
    guide.eraseSavedProgress();
    expect(Array.from(storage.store.keys())).toEqual(['theme']);
  });

  test('without a consent banner on the page there is no choice to follow, so progress is kept', () => {
    const storage = memoryStorage();
    loadGuide(storage).writeProgress({ id: 'u1' }, 'dismissed', 'a');
    expect(storage.store.has('ef.supplierGuide.v1.u1')).toBe(true);
  });
});

describe('setup guide progress is kept on the account', () => {
  /** The guide with a dashboard-helpers stand-in whose requests are recorded. */
  function loadWithAccount(accountRecord, consent) {
    const calls = [];
    const window = {
      localStorage: memoryStorage(),
      ...(consent ? { CookieConsent: { getConsent: () => consent } } : {}),
      SupplierDashboardHome: {
        getJson: async url => {
          calls.push(['GET', url]);
          return { ok: true, data: { progress: accountRecord } };
        },
        sendJson: async (url, method, body) => {
          calls.push([method, url, body]);
          return { ok: true, data: {} };
        },
      },
    };
    const document = {
      readyState: 'loading',
      addEventListener() {},
      getElementById: () => null,
      querySelector: () => null,
    };
    vm.runInNewContext(guideSource, { window, document, console });
    return { guide: window.SupplierDashboardOnboarding, calls, window };
  }

  test('saving sends the status and step to the account', () => {
    const { guide, calls } = loadWithAccount({});
    guide.writeProgress({ id: 'u1' }, 'dismissed', 'packages');
    expect(calls).toEqual([
      ['PUT', '/api/supplier/guide-progress', { status: 'dismissed', step: 'packages' }],
    ]);
  });

  test('what another device saved is read back, even with no browser copy', async () => {
    const { guide } = loadWithAccount({
      status: 'dismissed',
      step: 'verify',
      at: '2026-10-01T10:00:00.000Z',
    });
    await guide.loadAccountProgress({ id: 'u1' });
    expect(guide.readProgress({ id: 'u1' })).toMatchObject({ status: 'dismissed', step: 'verify' });
  });

  test('the newer of the browser copy and the account copy wins', async () => {
    const { guide, window } = loadWithAccount({
      status: 'dismissed',
      step: 'verify',
      at: '2026-10-01T10:00:00.000Z',
    });
    window.localStorage.setItem(
      guide.storageKey({ id: 'u1' }),
      JSON.stringify({ status: 'completed', step: '', at: '2026-10-02T10:00:00.000Z' })
    );
    await guide.loadAccountProgress({ id: 'u1' });
    expect(guide.readProgress({ id: 'u1' }).status).toBe('completed');
  });

  test('it does not depend on the cookie choice: declining storage still keeps it on the account', async () => {
    const { guide, calls } = loadWithAccount({}, { functional: false });
    guide.writeProgress({ id: 'u1' }, 'completed', '');
    expect(calls[0][0]).toBe('PUT');
    expect(guide.readProgress({ id: 'u1' }).status).toBe('completed');
  });

  test('a failed request leaves the browser copy in charge', async () => {
    const { guide, window } = loadWithAccount({});
    window.SupplierDashboardHome.getJson = async () => {
      throw new Error('offline');
    };
    await guide.loadAccountProgress({ id: 'u1' });
    guide.writeProgress({ id: 'u1' }, 'dismissed', 'a');
    expect(guide.readProgress({ id: 'u1' }).status).toBe('dismissed');
  });
});
