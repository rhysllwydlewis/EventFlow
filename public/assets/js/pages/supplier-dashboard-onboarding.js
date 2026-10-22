/**
 * Supplier dashboard: the first-visit setup guide.
 *
 * A short, step-by-step dialog over the dashboard for a brand-new supplier: it introduces the
 * page, then prompts for the things that get a listing live (confirm the email, set up the
 * profile, add a package, get verified, add photos), with "Step 2 of 5" progress, Skip, Back and
 * Next. It is not a welcome card and it holds no content of its own: every step after the first
 * is built from the same next-steps list the Next steps card shows (SupplierDashboardHome
 * .getContext().steps), uses that step's label for its button and does what that step's button
 * does, so the guide can never say something the card does not. A step that is already done is
 * left out; a step that is locked or waiting says why instead of offering a button.
 *
 * Progress is kept on the supplier's account (GET/PUT /api/supplier/guide-progress), so a guide that
 * was skipped or finished stays that way on every device and whatever the cookie choice. The
 * browser also keeps a copy (localStorage, keyed by the signed-in user's id) so the guide knows
 * where it was before the server answers; that copy is a remembered preference, saved only when
 * the visitor has allowed functional storage (held for the visit otherwise) and erased when they
 * decline it. A guide that was skipped or finished does not come back by itself; the "Setup guide"
 * link under the greeting reopens it at the step where it was left.
 */
'use strict';

(function () {
  const STORAGE_PREFIX = 'ef.supplierGuide.v1.';

  const ids = {
    dialog: 'sdh-guide-dialog',
    count: 'sdh-guide-count',
    bar: 'sdh-guide-bar',
    fill: 'sdh-guide-fill',
    title: 'sdh-guide-title',
    text: 'sdh-guide-text',
    note: 'sdh-guide-note',
    skip: 'sdh-guide-skip',
    back: 'sdh-guide-back',
    action: 'sdh-guide-action',
    next: 'sdh-guide-next',
    close: 'sdh-guide-close',
    open: 'sdh-guide-open',
  };

  /** Looks up an element by id. */
  const byId = id => document.getElementById(id);

  const view = { steps: [], index: 0, open: false, autoChecked: false };

  /** The home script's helpers, or null when it has not loaded. */
  const home = () => window.SupplierDashboardHome || null;

  /* ------------------------------------------------------------------ *
   * Progress, kept in this browser per user
   * ------------------------------------------------------------------ */

  /** The storage key for a user: the guide is per person, not per browser. */
  function storageKey(user) {
    return `${STORAGE_PREFIX}${String((user && (user.id || user._id)) || 'anonymous')}`;
  }

  /**
   * Whether this browser may keep the guide's progress. It is a remembered preference, so it follows
   * the visitor's cookie choice: it is kept only when functional storage has been allowed. When the
   * consent banner is not on the page there is no choice to follow and it is kept.
   */
  function mayRemember() {
    const consent = window.CookieConsent;
    if (!consent || typeof consent.getConsent !== 'function') {
      return true;
    }
    try {
      const choice = consent.getConsent();
      return Boolean(choice && choice.functional === true);
    } catch {
      return false;
    }
  }

  /** Progress held for this visit only, used while the browser may not keep it. */
  const visitProgress = {};

  /** What the account says (the server's copy) per user, once it has been fetched. */
  const accountProgress = {};
  let accountProgressRequest = null;

  /** The newer of two progress records (an empty record is older than any). */
  function newerProgress(first, second) {
    const firstAt = Date.parse((first && first.at) || '') || 0;
    const secondAt = Date.parse((second && second.at) || '') || 0;
    return secondAt > firstAt ? second : first;
  }

  /**
   * Fetches the account's copy of the progress once. A failed request leaves the browser's copy in
   * charge; it never stops the guide.
   * @returns {Promise<void>} Resolves when the copy is known (or could not be fetched).
   */
  function loadAccountProgress(user) {
    if (accountProgressRequest) {
      return accountProgressRequest;
    }
    const api = home();
    accountProgressRequest = (async () => {
      if (!api || typeof api.getJson !== 'function') {
        return;
      }
      try {
        const result = await api.getJson('/api/supplier/guide-progress');
        const saved = result && result.data && result.data.progress;
        accountProgress[storageKey(user)] = saved && typeof saved === 'object' ? saved : {};
      } catch {
        /* offline or refused: the browser's copy is used */
      }
    })();
    return accountProgressRequest;
  }

  /** Sends the record to the account, best effort: a failure only means another device is not told. */
  function saveAccountProgress(user, record) {
    accountProgress[storageKey(user)] = record;
    const api = home();
    if (!api || typeof api.sendJson !== 'function') {
      return;
    }
    Promise.resolve(
      api.sendJson('/api/supplier/guide-progress', 'PUT', {
        status: record.status,
        step: record.step,
      })
    ).catch(() => {});
  }

  /** Removes every saved guide record from this browser (all users of it). */
  function eraseSavedProgress() {
    try {
      const keys = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(STORAGE_PREFIX)) {
          keys.push(key);
        }
      }
      keys.forEach(key => window.localStorage.removeItem(key));
    } catch {
      /* storage blocked: nothing was kept */
    }
  }

  /** What was saved for this user: { status: 'active' | 'dismissed' | 'completed', step } or {}. */
  function readProgress(user) {
    return newerProgress(readBrowserProgress(user), accountProgress[storageKey(user)]) || {};
  }

  /** The browser's own copy for this user. */
  function readBrowserProgress(user) {
    if (!mayRemember()) {
      return visitProgress[storageKey(user)] || {};
    }
    try {
      const raw = window.localStorage.getItem(storageKey(user));
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  /**
   * Saves the guide's status and the step it is on. Where the browser may not keep it (functional
   * storage not allowed) it lasts for this visit only. Storage can also be blocked; the guide
   * still works.
   */
  function writeProgress(user, status, stepId) {
    const record = { status, step: stepId || '', at: new Date().toISOString() };
    saveAccountProgress(user, record);
    if (!mayRemember()) {
      visitProgress[storageKey(user)] = record;
      return;
    }
    try {
      window.localStorage.setItem(storageKey(user), JSON.stringify(record));
    } catch {
      /* private mode or blocked storage: the guide just will not remember */
    }
  }

  /* ------------------------------------------------------------------ *
   * The steps: built from the page's own next-steps data
   * ------------------------------------------------------------------ */

  /** True for the steps this guide covers, by the kind of thing they ask for. */
  const KINDS = [
    { id: 'email', test: step => /email/u.test(step.key) },
    {
      id: 'profile',
      test: step =>
        !/email|package|approv|verif|photo|gallery|banner|cover|social|tagline|review|calendar|logo|avatar/u.test(
          step.key
        ),
    },
    { id: 'packages', test: step => /package/u.test(step.key) && !/photo|image/u.test(step.key) },
    { id: 'verify', test: step => /approv|verif/u.test(step.key) && !/email/u.test(step.key) },
    { id: 'photos', test: step => /gallery|photo/u.test(step.key) && !/package/u.test(step.key) },
  ];

  /** The words the guide uses for each kind of step. */
  const COPY = {
    email: {
      title: 'Confirm your email address',
      text: 'We email you when customers message you and when your profile is approved. Confirming your address makes sure those emails reach you.',
    },
    profile: {
      title: 'Set up your profile',
      text: 'Your profile is the page customers see when they find you: your business name, what you do and where you work. It takes a few minutes and you can change it any time.',
    },
    packages: {
      title: 'Add a package',
      text: 'A package is something customers can book, with a price. Suppliers with at least one package are easier to compare, so they get more enquiries.',
    },
    verify: {
      title: 'Get your profile verified',
      text: 'Our team checks every profile before it goes live. Send yours for review and we will email you as soon as it is decided.',
    },
    photos: {
      title: 'Add photos',
      text: 'Photos of your work are the first thing customers look at. Add a few to show what you do.',
    },
  };

  /** The first step of this kind that is still to do, from the page's own next-steps list. */
  function pendingStep(kind, list) {
    const found = (list || []).find(step => !step.done && kind.test(step));
    return found || null;
  }

  /**
   * The guide's steps for what the page knows right now. `homeContext` is the home script's
   * getContext(); `how` turns a next step into the action its button runs (stepAction).
   * Returns [{ id, title, text, note, cta: { label, action, focus, target, href } | null }].
   */
  function buildSteps(homeContext, how) {
    const steps = [
      {
        id: 'welcome',
        title: 'Welcome to your dashboard',
        text: 'This is where you look after your EventFlow listing: your profile, packages, messages and reviews. A few short steps will get you ready for customers. You can skip them and come back from the Setup guide link.',
        note: '',
        cta: null,
      },
    ];
    if (!homeContext || homeContext.loaded === false) {
      return steps;
    }
    // A step whose information could not be read is held back, not guessed at: say so, so a short
    // guide is not mistaken for a finished one.
    if (homeContext.model?.unavailable?.length) {
      steps[0].note =
        'Some of your information could not be loaded just now, so a step may be missing. Reopen this guide from the Setup guide link once the page has loaded fully.';
    }
    if (homeContext.noProfile) {
      steps.push(
        {
          id: 'profile',
          ...COPY.profile,
          note: '',
          cta: { label: 'Create your profile', action: 'edit-profile', focus: 'sup-name' },
        },
        {
          id: 'packages',
          ...COPY.packages,
          note: 'Packages open up once your profile is approved.',
          cta: null,
        },
        {
          id: 'verify',
          ...COPY.verify,
          note: 'This comes after you have created your profile.',
          cta: null,
        }
      );
      return steps;
    }
    const list = homeContext.steps?.steps || [];
    KINDS.forEach(kind => {
      const step = pendingStep(kind, list);
      if (!step) {
        return;
      }
      const copy = COPY[kind.id];
      let note = '';
      let cta = null;
      if (step.locked) {
        note = step.lockedReason || 'This opens up once your profile is approved.';
      } else if (step.waiting) {
        note = 'Verification is in review. We will email you when it is decided.';
      } else {
        const action = how(step) || {};
        cta = { label: step.label, ...action };
      }
      steps.push({ id: kind.id, title: copy.title, text: copy.text, note, cta });
    });
    return steps;
  }

  /**
   * True for a supplier who has not set anything up yet: no profile, or a profile with no
   * packages, not approved and no reviews. Only these see the guide without asking for it.
   */
  function isBrandNew(homeContext) {
    if (!homeContext || !homeContext.loaded) {
      return false;
    }
    if (homeContext.noProfile) {
      return true;
    }
    const model = homeContext.model;
    return Boolean(
      model?.packages?.total === 0 &&
      model.verification &&
      model.verification.approved !== true &&
      model.reviews?.count === 0
    );
  }

  /* ------------------------------------------------------------------ *
   * The dialog
   * ------------------------------------------------------------------ */

  /** The current context, with the step-to-action helper, from the home script. */
  function context() {
    const api = home();
    return api && typeof api.getContext === 'function' ? api.getContext() : null;
  }

  /** The signed-in user, for the storage key. */
  function currentUser() {
    return context()?.user || null;
  }

  /** The current steps, recomputed from the page's data. */
  function currentSteps() {
    const api = home();
    return buildSteps(context(), step => (api?.stepAction ? api.stepAction(step) : {}));
  }

  /** Draws the step the guide is on: count, progress bar, words, note and buttons. */
  function renderStep() {
    const step = view.steps[view.index];
    if (!step) {
      return;
    }
    const total = view.steps.length;
    byId(ids.count).textContent = `Step ${view.index + 1} of ${total}`;
    const bar = byId(ids.bar);
    const percent = Math.round(((view.index + 1) / total) * 100);
    bar.setAttribute('aria-valuenow', String(percent));
    bar.setAttribute('aria-valuetext', `Step ${view.index + 1} of ${total}`);
    byId(ids.fill).style.width = `${percent}%`;
    byId(ids.title).textContent = step.title;
    byId(ids.text).textContent = step.text;
    const note = byId(ids.note);
    note.textContent = step.note;
    note.hidden = !step.note;

    const action = byId(ids.action);
    action.hidden = !step.cta;
    if (step.cta) {
      action.textContent = step.cta.label;
      ['sdhAction', 'sdhFocus', 'sdhTarget'].forEach(key => delete action.dataset[key]);
      if (step.cta.action) {
        action.dataset.sdhAction = step.cta.action;
      }
      if (step.cta.focus) {
        action.dataset.sdhFocus = step.cta.focus;
      }
      if (step.cta.target) {
        action.dataset.sdhTarget = step.cta.target;
      }
      action.dataset.guideHref = step.cta.href || '';
    }
    byId(ids.back).hidden = view.index === 0;
    const nextButton = byId(ids.next);
    const last = view.index === total - 1;
    nextButton.textContent = last ? 'Finish' : 'Next';
    nextButton.classList.toggle('sdh-btn--primary', !step.cta);
    nextButton.classList.toggle('sdh-btn--secondary', Boolean(step.cta));
  }

  /** Saves where the guide is, so it can be resumed. */
  function saveHere(status) {
    const step = view.steps[view.index];
    writeProgress(currentUser(), status, step ? step.id : '');
  }

  /** Puts keyboard and screen reader focus on the step heading (not on a button). */
  function focusTitle() {
    byId(ids.title).focus({ preventScroll: true });
  }

  /** Opens the guide at a step (by id when it still exists, else the first). */
  function open(stepId) {
    const dialog = byId(ids.dialog);
    if (!dialog || view.open) {
      return;
    }
    view.steps = currentSteps();
    const found = view.steps.findIndex(step => step.id === stepId);
    view.index = found > -1 ? found : 0;
    renderStep();
    view.open = true;
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    saveHere('active');
    focusTitle();
  }

  /** Closes the dialog; the close event records what happened. */
  function closeDialog() {
    const dialog = byId(ids.dialog);
    if (dialog?.open && typeof dialog.close === 'function') {
      dialog.close();
    } else if (dialog) {
      dialog.removeAttribute('open');
      afterClose();
    }
  }

  /** Marks the guide as skipped (resumable) unless it was finished or sent the supplier elsewhere. */
  function afterClose() {
    if (!view.open) {
      return;
    }
    view.open = false;
    if (view.outcome === 'completed') {
      writeProgress(currentUser(), 'completed', '');
    } else if (view.outcome === 'went') {
      saveHere('active');
    } else {
      saveHere('dismissed');
    }
    view.outcome = '';
    const opener = byId(ids.open);
    if (opener && !opener.hidden && !document.querySelector('dialog[open]')) {
      opener.focus();
    }
  }

  /** Moves to another step and puts focus on its heading. */
  function go(delta) {
    const target = view.index + delta;
    if (target < 0 || target >= view.steps.length) {
      return;
    }
    view.index = target;
    renderStep();
    saveHere('active');
    focusTitle();
  }

  /** The Next button: the next step, or finishing the guide on the last one. */
  function next() {
    if (view.index >= view.steps.length - 1) {
      view.outcome = 'completed';
      closeDialog();
      return;
    }
    go(1);
  }

  /** The step's own button: the guide gets out of the way and the page does what its button does. */
  function takeAction() {
    const action = byId(ids.action);
    const href = action.dataset.guideHref;
    view.outcome = 'went';
    closeDialog();
    if (href) {
      window.location.assign(href);
    }
  }

  /** Shows or hides the "Setup guide" link: there is only something to reopen when there are steps. */
  function syncOpenLink() {
    const opener = byId(ids.open);
    if (!opener) {
      return;
    }
    const steps = currentSteps();
    opener.hidden = steps.length < 2;
  }

  /** Called whenever the dashboard has drawn: refreshes an open guide and decides on auto-opening. */
  function onRendered() {
    syncOpenLink();
    const current = context();
    if (view.open) {
      // The data changed under an open guide (a profile was saved): keep the step if it is still there.
      const keep = view.steps[view.index] ? view.steps[view.index].id : '';
      view.steps = currentSteps();
      const found = view.steps.findIndex(step => step.id === keep);
      view.index = found > -1 ? found : Math.min(view.index, view.steps.length - 1);
      renderStep();
      return;
    }
    if (view.autoChecked || !current || !current.loaded) {
      return;
    }
    view.autoChecked = true;
    // Ask the account before deciding: a guide skipped on another device should not open here.
    loadAccountProgress(current.user).then(() => openIfNew(current));
  }

  /** Opens the guide for a brand-new supplier who has not skipped or finished it. */
  function openIfNew(current) {
    const progress = readProgress(current.user);
    const resumable = !progress.status || progress.status === 'active';
    if (!resumable || !isBrandNew(current) || view.open || document.querySelector('dialog[open]')) {
      return;
    }
    if (currentSteps().length < 2) {
      return;
    }
    open(progress.step);
  }

  /** Binds the dialog's buttons and the page events that drive the guide. */
  function init() {
    const dialog = byId(ids.dialog);
    if (!dialog) {
      return;
    }
    byId(ids.next).addEventListener('click', next);
    byId(ids.back).addEventListener('click', () => go(-1));
    byId(ids.skip).addEventListener('click', closeDialog);
    byId(ids.close).addEventListener('click', closeDialog);
    byId(ids.action).addEventListener('click', takeAction);
    byId(ids.open)?.addEventListener('click', () => {
      const progress = readProgress(currentUser());
      open(progress.status === 'completed' ? 'welcome' : progress.step);
    });
    dialog.addEventListener('close', afterClose);
    // Escape skips the guide (it can be reopened), whatever the browser does with its own close request.
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && view.open && !event.defaultPrevented) {
        event.preventDefault();
        closeDialog();
      }
    });
    // Declining functional storage (now, or earlier) erases what was kept.
    window.addEventListener('cookieConsentChanged', event => {
      if (event?.detail?.functional === false) {
        eraseSavedProgress();
      }
    });
    if (!mayRemember() && window.CookieConsent) {
      eraseSavedProgress();
    }
    document.addEventListener('sdh:rendered', onRendered);
    onRendered();
  }

  window.SupplierDashboardOnboarding = {
    buildSteps,
    isBrandNew,
    readProgress,
    writeProgress,
    storageKey,
    loadAccountProgress,
    eraseSavedProgress,
    open,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
