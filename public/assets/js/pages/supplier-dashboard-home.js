/**
 * Supplier dashboard home: greeting, summary row, next steps and the small cards around them.
 *
 * One module for everything on /dashboard/supplier that is not a form or a feature app:
 *
 *   - the greeting line and the single most useful next action
 *   - the verification strip and the email verification banner
 *   - the summary row (unread messages, profile completeness, rating, plan, visits, replies)
 *   - the Next steps checklist
 *   - the profile visits chart, availability, tips, plan and review requests
 *
 * It replaces dashboard-supplier-module.js (hero tiles, stats grid, chart, funnel, lead quality,
 * next steps, subscription card), dashboard-supplier-overhaul.js (availability, tips, review
 * requests), supplier-dashboard-enhancements.js, dashboard-supplier-threads.js,
 * dashboard-supplier-actions.js, dashboard-supplier-auth.js and dashboard-supplier-inline.js.
 * Those drew the same facts several times from different calculations.
 *
 * Every number comes from one request, GET /api/supplier/dashboard-summary. Anything the server
 * does not send (or sends as null: "not enough data") is shown as a dash or left out. Nothing is
 * estimated or invented on this page.
 *
 * Public surface: window.SupplierDashboardHome (getSummary, refresh, confirm, toast and the
 * pure helpers the unit tests call). app.js asks it for the package allowance and tells it when
 * the profile or the packages change.
 */
'use strict';
(function () {
  const SUMMARY_DAYS = 30;
  const MIN_REPLY_SAMPLE = 3;
  const SUMMARY_URL = `/api/supplier/dashboard-summary?days=${SUMMARY_DAYS}`;

  const ids = {
    heading: 'welcome-heading',
    lede: 'sdh-lede',
    primary: 'sdh-next-action',
    secondary: 'sdh-secondary-action',
    banners: 'sdh-banners',
    strip: 'verification-status-banner',
    summary: 'sdh-summary-grid',
    summaryExtra: 'sdh-summary-extra',
    stepsBody: 'sdh-steps-body',
    stepsSub: 'sdh-steps-sub',
    viewPublic: 'sdh-view-public',
    chart: 'supplier-performance-chart',
    chartSub: 'sdh-performance-sub',
    tips: 'supplier-perf-tips',
    availability: 'supplier-availability-widget',
    plan: 'supplier-subscription-card',
    reviews: 'supplier-reviews-section',
    reviewRequests: 'supplier-review-request-widget',
    reviewDialog: 'sdh-review-dialog',
    reviewForm: 'supplier-review-request-form',
    messenger: 'messenger-dashboard-widget-supplier',
    confirmDialog: 'sdh-confirm-dialog',
  };

  /** Short plan names as the pricing page shows them. */
  const PLAN_LABELS = { free: 'Starter', pro: 'Pro', pro_plus: 'Pro Plus' };

  /** Shorthand for document.getElementById. */
  const byId = key => document.getElementById(key);

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  /** HTML-escapes any value (null and undefined become an empty string) for safe use in markup. */
  function esc(value) {
    const holder = document.createElement('div');
    holder.textContent = String(value === null || value === undefined ? '' : value);
    return holder.innerHTML;
  }

  /** True for a finite number (not NaN, not a numeric string, not null). */
  function isNum(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  /** "1 day" / "2 days": the count followed by the singular or plural noun. */
  function plural(count, one, many) {
    return `${count.toLocaleString('en-GB')} ${count === 1 ? one : many || `${one}s`}`;
  }

  /** True when the visitor has asked their system for reduced motion. */
  function prefersReducedMotion() {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }

  /** Long British date, e.g. 19 June 2027. Empty string for anything that is not a date. */
  function formatDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  /** Short British day and month for chart labels, e.g. 19 Jun. */
  function formatShortDate(value) {
    const date = value ? new Date(`${String(value).slice(0, 10)}T00:00:00`) : null;
    if (!date || Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  /** A read-only JSON GET. Resolves to { status, data } and never throws. */
  async function getJson(url) {
    try {
      const response = await fetch(url, { credentials: 'include' });
      const data = response.ok ? await response.json().catch(() => null) : null;
      return { status: response.status, data };
    } catch {
      return { status: 0, data: null };
    }
  }

  /** The CSRF token the write requests need, fetched once and kept on window like the other scripts do. */
  async function csrfToken(forceRefresh) {
    if (!forceRefresh && window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }
    try {
      const response = await fetch('/api/csrf-token', { credentials: 'include' });
      if (!response.ok) {
        return '';
      }
      const data = await response.json();
      const token = data.csrfToken || data.token || '';
      if (token) {
        window.__CSRF_TOKEN__ = token;
      }
      return token;
    } catch {
      return '';
    }
  }

  /** A write request with the CSRF token, retried once with a fresh token when the server refuses it. */
  async function sendJson(url, method, body) {
    /** One attempt with the given token. */
    const attempt = async token =>
      fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    let response = await attempt(await csrfToken(false));
    if (response.status === 403 || response.status === 419) {
      const retry = await csrfToken(true);
      if (retry) {
        response = await attempt(retry);
      }
    }
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }

  /* ------------------------------------------------------------------ *
   * Pure logic (no DOM): these are what the unit tests exercise
   * ------------------------------------------------------------------ */

  /** A count that is a real number >= 0, or null. */
  function count(value) {
    return isNum(value) && value >= 0 ? Math.round(value) : null;
  }

  /** The plan limit as a positive whole number, or null for "no limit" or "not known". */
  function limitOf(value) {
    return isNum(value) && value > 0 && value < 100000 ? Math.round(value) : null;
  }

  /**
   * Turns whatever the server sent into the one shape the page draws from. Every field is
   * optional: a block that is missing, or whose values are not numbers, comes out as null and
   * the page shows a dash or leaves it out. Nothing is defaulted to 0 or 100.
   */
  function normaliseSummary(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const verification =
      data.verification && typeof data.verification === 'object' ? data.verification : null;
    const profile = data.profile && typeof data.profile === 'object' ? data.profile : null;
    const packages = data.packages && typeof data.packages === 'object' ? data.packages : null;
    const messages = data.messages && typeof data.messages === 'object' ? data.messages : null;
    const responses = data.responses && typeof data.responses === 'object' ? data.responses : null;
    const views = data.views && typeof data.views === 'object' ? data.views : null;
    const reviews = data.reviews && typeof data.reviews === 'object' ? data.reviews : null;
    const subscription =
      data.subscription && typeof data.subscription === 'object' ? data.subscription : null;
    const completeness =
      profile?.completeness && typeof profile.completeness === 'object'
        ? profile.completeness
        : null;
    const windowInfo = data.window && typeof data.window === 'object' ? data.window : null;
    const unreadMessages = count(messages?.unreadMessages);
    const averageRating = isNum(reviews?.averageRating) ? reviews.averageRating : null;
    const viewDays = limitOf(views?.days) || limitOf(windowInfo?.days) || SUMMARY_DAYS;

    return {
      windowDays: limitOf(windowInfo?.days) || viewDays,
      verification: verification
        ? {
            approved: typeof verification.approved === 'boolean' ? verification.approved : null,
            emailVerified:
              typeof verification.emailVerified === 'boolean' ? verification.emailVerified : null,
            state:
              typeof verification.status === 'string' && verification.status
                ? verification.status
                : typeof verification.state === 'string'
                  ? verification.state
                  : '',
            notes: typeof verification.notes === 'string' ? verification.notes : '',
            rejectionCount: count(verification.rejectionCount) || 0,
          }
        : null,
      profile: profile
        ? {
            name: typeof profile.name === 'string' ? profile.name : '',
            id: profile.topProfileId ? String(profile.topProfileId) : '',
            publicProfilePath:
              typeof profile.publicProfilePath === 'string' &&
              /^\/[^/\\]/u.test(profile.publicProfilePath)
                ? profile.publicProfilePath
                : '',
            score:
              completeness && isNum(completeness.score)
                ? Math.max(0, Math.min(100, Math.round(completeness.score)))
                : null,
            checks: Array.isArray(completeness?.checks) ? completeness.checks : [],
          }
        : null,
      packages: packages
        ? {
            total: count(packages.total),
            active: count(packages.active),
            paused: count(packages.paused),
            awaitingApproval: count(packages.awaitingApproval),
            counted: count(packages.countedTowardsLimit),
            limit: limitOf(packages.limit),
          }
        : null,
      messages: messages
        ? {
            unread: unreadMessages,
            conversations: count(messages.conversationsWithUnread),
            latestAt: messages.latestAt || '',
          }
        : null,
      responses: responses
        ? {
            sampleSize: count(responses.sampleSize) || 0,
            repliedPct: isNum(responses.repliedPct)
              ? Math.max(0, Math.min(100, Math.round(responses.repliedPct)))
              : null,
            medianMinutes:
              isNum(responses.medianMinutes) && responses.medianMinutes >= 0
                ? responses.medianMinutes
                : null,
          }
        : null,
      views: views
        ? {
            total: count(views.total),
            days: viewDays,
            daily: normaliseDaily(views.daily || views.series || data.analytics?.dailyData),
            requestedDays: limitOf(windowInfo?.requestedDays) || SUMMARY_DAYS,
          }
        : null,
      reviews: reviews
        ? {
            count: count(reviews.approvedCount),
            average: averageRating,
            pending: count(reviews.pendingCount),
          }
        : null,
      subscription: subscription
        ? {
            plan: typeof subscription.plan === 'string' ? subscription.plan : '',
            status: typeof subscription.status === 'string' ? subscription.status : '',
            activeUntil: subscription.activeUntil || '',
            cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
            limits:
              subscription.limits && typeof subscription.limits === 'object'
                ? subscription.limits
                : null,
          }
        : null,
      nextSteps: normaliseSteps(data.nextSteps),
    };
  }

  /** Daily visit counts as [{ date, views }] with numbers only; anything else is dropped. */
  function normaliseDaily(list) {
    if (!Array.isArray(list)) {
      return [];
    }
    return list
      .filter(item => item && typeof item === 'object' && count(item.views) !== null)
      .map(item => ({ date: String(item.date || item.label || ''), views: count(item.views) }));
  }

  /** Server next steps as [{ key, label, done, locked, waiting, href }], or null when there are none. */
  function normaliseSteps(raw) {
    const list = Array.isArray(raw?.steps) ? raw.steps : Array.isArray(raw) ? raw : null;
    if (!list || !list.length) {
      return null;
    }
    const steps = list
      .filter(step => step && typeof step === 'object' && (step.label || step.title))
      .map(step => ({
        key: String(step.id || step.key || ''),
        label: String(step.label || step.title),
        done: Boolean(step.done || step.completed),
        locked: Boolean(step.locked),
        lockedReason: typeof step.lockedReason === 'string' ? step.lockedReason : '',
        waiting: Boolean(step.waiting),
        href: typeof step.href === 'string' && /^(\/(?!\/)|#)/u.test(step.href) ? step.href : '',
      }));
    return steps.length
      ? {
          steps,
          completed: steps.filter(step => step.done).length,
          total: steps.length,
          primaryKey: typeof raw?.primaryStepId === 'string' ? raw.primaryStepId : '',
        }
      : null;
  }

  /**
   * What the checklist would say if the server did not send nextSteps: built from the same facts
   * the summary row shows (email, verification, the completeness checks, packages, reviews), in
   * the order a new supplier needs them. Only steps whose facts are known are included.
   */
  function deriveSteps(model, context) {
    const steps = [];
    const ctx = context || {};
    if (ctx.emailVerified === false) {
      steps.push({
        key: 'verify-email',
        label: 'Verify your email address',
        done: false,
        locked: false,
        waiting: false,
        href: '',
      });
    }
    const checks = model?.profile?.checks || [];
    const open = checks.filter(check => check && !check.done);
    open.forEach(check => {
      steps.push({
        key: `profile-${String(check.id || check.key || '')}`,
        label: String(check.label || check.id || 'Complete your profile'),
        done: false,
        locked: false,
        waiting: false,
        href: '',
      });
    });
    const verification = model?.verification;
    if (verification && verification.approved === false) {
      const inReview = verification.state === 'pending_review';
      steps.push({
        key: 'get-approved',
        label: inReview ? 'Verification is in review' : 'Get your profile verified',
        done: false,
        locked: false,
        waiting: inReview,
        href: '',
      });
    }
    const packages = model?.packages;
    if (packages && packages.total === 0) {
      steps.push({
        key: 'first-package',
        label: 'Create your first package',
        done: false,
        locked: verification?.approved === false,
        waiting: false,
        href: '',
      });
    }
    if (model?.reviews && model.reviews.count === 0 && verification?.approved !== false) {
      steps.push({
        key: 'first-review',
        label: 'Ask a past customer for a review',
        done: false,
        locked: false,
        waiting: false,
        href: '',
      });
    }
    checks
      .filter(check => check && check.done)
      .forEach(check => {
        steps.push({
          key: `profile-${String(check.id || check.key || '')}`,
          label: String(check.label || check.id || ''),
          done: true,
          locked: false,
          waiting: false,
          href: '',
        });
      });
    if (!steps.length) {
      return null;
    }
    return { steps, completed: steps.filter(step => step.done).length, total: steps.length };
  }

  /** The first step the supplier can act on now: not done, not locked behind approval, not just waiting. */
  function pickPrimaryStep(steps) {
    const list = steps?.steps || [];
    const open = step => !step.done && !step.locked && !step.waiting;
    const named = steps?.primaryKey ? list.find(step => step.key === steps.primaryKey) : null;
    return named && open(named) ? named : list.find(open) || null;
  }

  /**
   * The server lists "Get your profile verified" as open until approval. While the request is in
   * review there is nothing for the supplier to do, so it becomes a waiting step, not the next action.
   */
  function applyVerificationState(steps, verification) {
    if (!steps || !verification || verification.approved !== false) {
      return steps;
    }
    const inReview = verification.state === 'pending_review';
    return {
      ...steps,
      steps: steps.steps.map(step =>
        inReview && /verif|approv/u.test(step.key) && !/email/u.test(step.key) && !step.done
          ? { ...step, waiting: true, label: 'Verification is in review' }
          : step
      ),
    };
  }

  /**
   * How a step is acted on: { action, focus } for the buttons this page owns, or { href } for a
   * link. Matched on the step's key, because the server's labels and links change.
   */
  function stepAction(step) {
    const key = String(step?.key || '').toLowerCase();
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
    if (/review/u.test(key)) {
      return { action: 'request-review' };
    }
    if (/calendar/u.test(key)) {
      return { action: 'scroll', target: 'availability-calendar' };
    }
    if (/social|banner|cover/u.test(key)) {
      return { href: '/supplier/profile-customization' };
    }
    if (/logo|avatar|profile-photo/u.test(key)) {
      return { action: 'upload-avatar' };
    }
    if (/gallery|photo/u.test(key)) {
      return { action: 'edit-profile', focus: 'sup-photo-drop' };
    }
    if (/descr/u.test(key)) {
      return { action: 'edit-profile', focus: 'sup-long' };
    }
    if (/website/u.test(key)) {
      return { action: 'edit-profile', focus: 'sup-website' };
    }
    if (/location|postcode|area/u.test(key)) {
      return { action: 'edit-profile', focus: 'sup-base-postcode' };
    }
    if (/business|detail|name|categor|profile/u.test(key)) {
      return { action: 'edit-profile', focus: 'sup-name' };
    }
    return step?.href ? { href: step.href } : { action: 'edit-profile', focus: 'sup-name' };
  }

  /** "45 min", "1 h 30 min", "2 days": a typical reply time for people, never rounded down to "0 h". */
  function formatMinutes(minutes) {
    if (!isNum(minutes) || minutes < 0) {
      return '';
    }
    if (minutes < 1) {
      return 'Under a minute';
    }
    if (minutes < 60) {
      return `${Math.round(minutes)} min`;
    }
    if (minutes < 60 * 24) {
      const hours = Math.floor(minutes / 60);
      const rest = Math.round(minutes - hours * 60);
      return rest ? `${hours} h ${rest} min` : `${hours} h`;
    }
    return plural(Math.round(minutes / (60 * 24)), 'day');
  }

  /** A rating like 4.8 (one decimal), or an empty string when there is no rating. */
  function formatRating(value) {
    return isNum(value) && value > 0 ? value.toFixed(1) : '';
  }

  /** The plan's display name; unknown plans are shown as the server named them. */
  function planLabel(plan) {
    const key = String(plan || 'free').toLowerCase();
    return PLAN_LABELS[key] || String(plan);
  }

  /** The package limit for the plan: from the summary, else from the plan's own limits, else null (none or unknown). */
  function packageLimit(model) {
    return model?.packages?.limit ?? limitOf(model?.subscription?.limits?.maxPackages);
  }

  /** "2 of 3 active packages", "2 active packages" (no limit) or "No active packages", from the counts. */
  function packageUsage(model) {
    // The server counts every package that is not paused against the limit, awaiting approval included.
    const active = model?.packages?.counted ?? model?.packages?.active;
    if (active === null || active === undefined) {
      return '';
    }
    const limit = packageLimit(model);
    if (limit) {
      return `${active.toLocaleString('en-GB')} of ${limit.toLocaleString('en-GB')} active packages`;
    }
    return active === 0 ? 'No active packages yet' : plural(active, 'active package');
  }

  /** Reply figures are shown only with enough conversations behind them and a real value; otherwise null. */
  function replyMetric(responses) {
    if (!responses || responses.sampleSize < MIN_REPLY_SAMPLE) {
      return null;
    }
    if (responses.repliedPct === null && responses.medianMinutes === null) {
      return null;
    }
    return responses;
  }

  /** What the verification strip should say for the profile's state, or null when there is nothing to say. */
  function stripFor(verification) {
    if (!verification || verification.approved !== false) {
      return null;
    }
    const state = verification.state;
    if (state === 'pending_review') {
      return {
        tone: 'info',
        title: 'Verification is in review',
        text: 'We will email you as soon as it has been decided. Until then your profile is not shown to customers.',
        action: '',
      };
    }
    if (state === 'suspended') {
      return {
        tone: 'danger',
        title: 'Your listing is suspended',
        text: 'Customers cannot see your profile right now. Open a support ticket and we will look into it.',
        action: 'support',
      };
    }
    if (verification.rejectionCount >= 5) {
      return {
        tone: 'danger',
        title: 'Verification cannot be sent again',
        text: 'It has been declined too many times to resubmit. Open a support ticket and we will help.',
        action: 'support',
      };
    }
    if (state === 'rejected' || state === 'needs_changes') {
      return {
        tone: 'danger',
        title: state === 'rejected' ? 'Verification was declined' : 'Changes are needed',
        text:
          state === 'rejected'
            ? 'Read our notes, update your profile and send it again.'
            : 'We need a few changes before we can approve your profile.',
        action: 'resubmit',
      };
    }
    return {
      tone: 'warn',
      title: 'Get verified to go live',
      text: 'Until we approve your profile, customers cannot find it, and you cannot create packages, send messages or publish calendar events.',
      action: 'verify',
    };
  }

  /** The sentence under the heading, from what is known about the account. */
  function ledeFor(model, flags) {
    if (flags.error) {
      return 'We could not load your summary just now.';
    }
    if (flags.noProfile) {
      return 'Create your business profile and we will show you what to do next.';
    }
    const strip = stripFor(model?.verification);
    if (strip && model.verification.state === 'pending_review') {
      return 'Your profile is in review. We will email you when it is decided.';
    }
    if (strip) {
      return 'Your profile is not visible to customers yet.';
    }
    const unread = model?.messages?.unread;
    if (unread) {
      return `You have ${plural(unread, 'unread message')}.`;
    }
    const next = pickPrimaryStep(model?.nextSteps);
    if (next) {
      return `Next: ${next.label.charAt(0).toLowerCase()}${next.label.slice(1)}.`;
    }
    return 'Your profile, packages and messages in one place.';
  }

  /** True or false when the account says whether the email is verified; null when it does not say. */
  function emailVerifiedFlag(user, model) {
    if (typeof model?.verification?.emailVerified === 'boolean') {
      return model.verification.emailVerified;
    }
    if (user && typeof user.emailVerified === 'boolean') {
      return user.emailVerified;
    }
    return user && typeof user.verified === 'boolean' ? user.verified : null;
  }

  /** The greeting for the time of day, e.g. "Good morning". */
  function greetingFor(date) {
    const hour = (date || new Date()).getHours();
    if (hour < 12) {
      return 'Good morning';
    }
    return hour < 18 ? 'Good afternoon' : 'Good evening';
  }

  /* ------------------------------------------------------------------ *
   * Notices: toast, announcements, confirmation dialog
   * ------------------------------------------------------------------ */

  /** Announces a message to screen readers through the page's live region. */
  function announce(message) {
    const region = byId('sr-announcer');
    if (region) {
      region.textContent = message;
      window.setTimeout(() => {
        region.textContent = '';
      }, 1000);
    }
  }

  let toastTimer = 0;

  /** The one toast on this page. Replaces any toast already showing; fades after five seconds. */
  function toast(message, type) {
    const text = String(message || '');
    if (!text) {
      return;
    }
    let node = document.querySelector('.sdh-toast');
    if (!node) {
      node = document.createElement('div');
      node.className = 'sdh-toast';
      node.setAttribute('role', 'status');
      document.body.appendChild(node);
    }
    node.dataset.tone = type || 'info';
    node.textContent = text;
    node.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      node.hidden = true;
    }, 5000);
  }

  /** Shims so the feature scripts that call Toast.error() or EFToast.success() use this page's toast. */
  function installToastShims() {
    const shim = {};
    ['success', 'error', 'warning', 'info'].forEach(type => {
      shim[type] = message => toast(message, type);
    });
    window.Toast = window.Toast || shim;
    window.EFToast = window.EFToast || shim;
    window.announceToSR = announce;
  }

  /**
   * Opens the page's confirmation dialog and resolves to true when the supplier confirms. Falls
   * back to the browser's confirm() where <dialog> is not supported.
   */
  function confirmAction(options) {
    const settings = options || {};
    const dialog = byId(ids.confirmDialog);
    if (!dialog || typeof dialog.showModal !== 'function') {
      return Promise.resolve(window.confirm(settings.message || 'Are you sure?'));
    }
    byId('sdh-confirm-title').textContent = settings.title || 'Are you sure?';
    byId('sdh-confirm-text').textContent = settings.message || '';
    const okButton = byId('sdh-confirm-ok');
    okButton.textContent = settings.confirmLabel || 'Delete';
    const opener = document.activeElement;
    return new Promise(resolve => {
      let confirmed = false;
      /** Records the answer and closes the dialog. */
      const finish = answer => {
        confirmed = answer;
        dialog.close();
      };
      /** Resolves once the dialog has closed, however it was closed. */
      const onClose = () => {
        okButton.removeEventListener('click', onOk);
        byId('sdh-confirm-cancel').removeEventListener('click', onCancel);
        dialog.removeEventListener('close', onClose);
        if (opener && typeof opener.focus === 'function') {
          opener.focus();
        }
        resolve(confirmed);
      };
      /** The confirm button was pressed. */
      const onOk = event => {
        event.preventDefault();
        finish(true);
      };
      /** The cancel button was pressed. */
      const onCancel = () => finish(false);
      okButton.addEventListener('click', onOk);
      byId('sdh-confirm-cancel').addEventListener('click', onCancel);
      dialog.addEventListener('close', onClose);
      dialog.showModal();
    });
  }

  /** Opens a native dialog, or shows it plainly where <dialog> is not supported. */
  function openDialog(dialog) {
    if (!dialog) {
      return;
    }
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      dialog.setAttribute('open', '');
    }
  }

  /** Closes a native dialog, however it was opened. */
  function closeDialog(dialog) {
    if (!dialog) {
      return;
    }
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  /* ------------------------------------------------------------------ *
   * Data: one summary request, shared by everything on the page
   * ------------------------------------------------------------------ */

  const state = {
    summaryPromise: null,
    model: null,
    failed: false,
    notFound: false,
    user: null,
    plan: null,
    suppliers: null,
    steps: null,
  };

  /** The signed-in user from the shared auth state, or from /api/v1/auth/me when that is not loaded. */
  async function loadUser() {
    try {
      if (window.AuthStateManager?.init) {
        const auth = await window.AuthStateManager.init();
        if (auth?.user) {
          return auth.user;
        }
      }
      const fetched = window._efFetchOnceJSON
        ? await window._efFetchOnceJSON('/api/v1/auth/me', { credentials: 'include' })
        : (await getJson('/api/v1/auth/me')).data;
      return fetched?.user || null;
    } catch {
      return null;
    }
  }

  /** Fetches the summary once and normalises it; resolves to the model, or null when the request failed. */
  function fetchSummary() {
    return getJson(SUMMARY_URL).then(async result => {
      state.notFound = result.status === 404;
      state.failed = !result.data;
      if (!result.data) {
        state.model = null;
        // No summary (for example no profile yet): the plan card can still say which plan it is.
        const own = await getJson('/api/v2/subscriptions/me');
        state.plan = own.data ? normaliseSummary({ subscription: own.data }).subscription : null;
        return null;
      }
      const model = normaliseSummary(result.data);
      if (!model.subscription) {
        const sub = await getJson('/api/v2/subscriptions/me');
        if (sub.data) {
          model.subscription = normaliseSummary({ subscription: sub.data }).subscription;
        }
      }
      state.model = model;
      return model;
    });
  }

  /** The shared summary request. Pass force to ask the server again (after a profile or package change). */
  function getSummary(force) {
    if (!state.summaryPromise || force) {
      state.summaryPromise = fetchSummary();
    }
    return state.summaryPromise;
  }

  /** What app.js needs to know about packages: the active limit (null for none or unknown) and the plan label. */
  async function getPackageAllowance() {
    const model = await getSummary(false);
    return {
      known: Boolean(model),
      limit: model ? packageLimit(model) : null,
      plan: model?.subscription?.plan || '',
      active: model?.packages?.active ?? null,
    };
  }

  /* ------------------------------------------------------------------ *
   * Page state: which cards show for a supplier with no profile yet
   * ------------------------------------------------------------------ */

  /** True when the supplier list has loaded and is empty. app.js sets window._supplierProfileMissing. */
  function isNoProfile() {
    return Array.isArray(state.suppliers) ? state.suppliers.length === 0 : false;
  }

  /** Marks the page as "no profile yet" so only the profile, plan and support cards show. */
  function applyProfileMode() {
    document.body.classList.toggle('sdh-no-profile', isNoProfile());
  }

  /* ------------------------------------------------------------------ *
   * Hero
   * ------------------------------------------------------------------ */

  /** Sets the heading, the lede and the primary and secondary buttons for the current state. */
  function renderHero() {
    const model = state.model;
    const noProfile = isNoProfile();
    const heading = byId(ids.heading);
    if (heading) {
      const first =
        state.user?.firstName || (state.user?.name ? String(state.user.name).split(' ')[0] : '');
      heading.textContent = first ? `${greetingFor()}, ${first}` : greetingFor();
    }
    const lede = byId(ids.lede);
    if (lede) {
      lede.textContent = ledeFor(model, { error: !model && !noProfile, noProfile });
    }

    const primary = byId(ids.primary);
    if (primary) {
      const strip = stripFor(model?.verification);
      const next = noProfile
        ? { key: 'business-details', label: 'Create your profile', href: '' }
        : pickPrimaryStep(state.steps) ||
          (strip && strip.action === 'verify'
            ? { key: 'get-approved', label: 'Get verified', href: '' }
            : null);
      if (next) {
        setStepLink(primary, next);
        primary.hidden = false;
      } else if (model?.messages?.unread) {
        setStepLink(primary, { key: 'inbox', label: 'Open your inbox', href: '/messenger/' });
        primary.hidden = false;
      } else if (model?.packages?.total === 0 && model?.verification?.approved !== false) {
        setStepLink(primary, { key: 'first-package', label: 'Create a package', href: '' });
        primary.hidden = false;
      } else {
        primary.hidden = true;
      }
    }
    const publicPath = model?.profile?.publicProfilePath || '';
    const showPublic = Boolean(publicPath) && model?.verification?.approved !== false && !noProfile;
    const secondary = byId(ids.secondary);
    if (secondary) {
      secondary.hidden = !showPublic;
      if (showPublic) {
        secondary.setAttribute('href', publicPath);
      }
    }
    const viewPublic = byId(ids.viewPublic);
    if (viewPublic) {
      viewPublic.hidden = !showPublic;
      if (showPublic) {
        viewPublic.setAttribute('href', publicPath);
      }
    }
  }

  /** The href for a step link: its own page, or the card its action works in. */
  function stepHref(step) {
    const how = stepAction(step);
    if (!how.action) {
      return how.href || '#profile-card';
    }
    const cards = {
      'new-package': '#packages-section',
      'request-review': '#sdh-reviews',
      'resend-email': '#sdh-banners',
      verify: '#sdh-banners',
      scroll: '#my-packages',
    };
    return cards[how.action] || '#profile-card';
  }

  /** Attribute string for a step link: the page action it runs and the field it focuses. */
  function stepAttrs(step) {
    const how = stepAction(step);
    if (!how.action) {
      return '';
    }
    return ` data-sdh-action="${esc(how.action)}"${how.focus ? ` data-sdh-focus="${esc(how.focus)}"` : ''}${how.target ? ` data-sdh-target="${esc(how.target)}"` : ''}`;
  }

  /** Points a link or button at a step: its label, and either its page or the page action that does it. */
  function setStepLink(node, step) {
    const how = stepAction(step);
    node.textContent = step.label;
    node.setAttribute('href', stepHref(step));
    ['sdhAction', 'sdhFocus', 'sdhTarget'].forEach(key => {
      delete node.dataset[key];
    });
    if (how.action) {
      node.dataset.sdhAction = how.action;
    }
    if (how.focus) {
      node.dataset.sdhFocus = how.focus;
    }
    if (how.target) {
      node.dataset.sdhTarget = how.target;
    }
  }

  /* ------------------------------------------------------------------ *
   * Summary row
   * ------------------------------------------------------------------ */

  /** Markup for a thin progress bar, with the percentage clamped to 0-100. */
  function bar(percent, label) {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    return `<div class="sdh-bar" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><span class="sdh-bar__fill" data-width="${value}"></span></div>`;
  }

  /** Wraps a label, body markup and optional action markup in one summary tile. */
  function tile(label, body, action) {
    return `<div class="sdh-tile"><div class="sdh-tile__label"><span>${esc(label)}</span>${action || ''}</div>${body}</div>`;
  }

  /** Summary tile: unread messages, or a dash when the server could not say. */
  function messagesTile(model) {
    const messages = model?.messages;
    const link = '<a class="sdh-link" href="/messenger/">Open inbox</a>';
    if (!messages || messages.unread === null) {
      return tile(
        'Unread messages',
        `<p class="sdh-tile__value sdh-tile__value--empty">Not available</p><p class="sdh-tile__sub">${link}</p>`
      );
    }
    const detail =
      messages.unread === 0
        ? 'You are all caught up.'
        : messages.conversations
          ? `In ${plural(messages.conversations, 'conversation')}.`
          : 'Waiting for your reply.';
    return tile(
      'Unread messages',
      `<p class="sdh-tile__value">${messages.unread.toLocaleString('en-GB')}</p><p class="sdh-tile__sub">${esc(detail)}</p><p class="sdh-tile__sub">${link}</p>`
    );
  }

  /** Summary tile: profile completeness as a percentage, with the next thing to do. */
  function profileTile(model) {
    const profile = model?.profile;
    if (!profile || profile.score === null) {
      return tile(
        'Profile',
        '<p class="sdh-tile__value sdh-tile__value--empty">Not available</p><p class="sdh-tile__sub"><a class="sdh-link" href="#profile-card" data-sdh-action="edit-profile">Edit profile</a></p>'
      );
    }
    const open = profile.checks.filter(check => check && !check.done);
    const sub = open.length
      ? `Next: <a class="sdh-link" href="#profile-card"${stepAttrs({ key: `profile-${open[0].id || ''}` })}>${esc(String(open[0].label || 'Complete your profile').toLowerCase())}</a>`
      : 'Everything on your profile is filled in.';
    return tile(
      'Profile complete',
      `<p class="sdh-tile__value">${profile.score}<span class="sdh-tile__unit">%</span></p>${bar(profile.score, `Profile ${profile.score}% complete`)}<p class="sdh-tile__sub">${sub}</p>`
    );
  }

  /** Summary tile: approved rating and how many reviews it is based on, or "No reviews yet". */
  function ratingTile(model) {
    const reviews = model?.reviews;
    if (!reviews || reviews.count === null) {
      return tile('Rating', '<p class="sdh-tile__value sdh-tile__value--empty">Not available</p>');
    }
    if (reviews.count === 0 || reviews.average === null) {
      const pending = reviews.pending
        ? `<p class="sdh-tile__sub">${plural(reviews.pending, 'review')} waiting for approval.</p>`
        : '';
      return tile(
        'Rating',
        `<p class="sdh-tile__value sdh-tile__value--empty">No reviews yet</p><p class="sdh-tile__sub"><button type="button" class="sdh-link" data-sdh-action="request-review">Request a review</button></p>${pending}`
      );
    }
    const pending = reviews.pending ? ` · ${reviews.pending} waiting for approval` : '';
    return tile(
      'Rating',
      `<p class="sdh-tile__value">${esc(formatRating(reviews.average))}<span class="sdh-tile__unit"> out of 5</span></p><p class="sdh-tile__sub">${esc(plural(reviews.count, 'review') + pending)}</p>`
    );
  }

  /** Summary tile: the plan and how much of it is used. */
  function planTile(model) {
    const subscription = model?.subscription;
    const link = '<a class="sdh-link" href="/supplier/subscription">Manage plan</a>';
    if (!subscription) {
      return tile(
        'Plan',
        `<p class="sdh-tile__value sdh-tile__value--empty">Not available</p><p class="sdh-tile__sub">${link}</p>`
      );
    }
    const usage = packageUsage(model);
    const limit = packageLimit(model);
    const meter =
      limit && model?.packages?.active !== null
        ? bar(((model.packages.counted ?? model.packages.active) / limit) * 100, usage)
        : '';
    return tile(
      'Plan',
      `<p class="sdh-tile__value">${esc(planLabel(subscription.plan))}</p>${meter}${usage ? `<p class="sdh-tile__sub">${esc(usage)}</p>` : ''}<p class="sdh-tile__sub">${link}</p>`
    );
  }

  /** The second row: visits and reply figures, each only when the server has a real value. */
  function extraRow(model) {
    const items = [];
    const views = model?.views;
    if (views && views.total !== null) {
      items.push(
        `<div class="sdh-stat"><p class="sdh-stat__label">Profile visits, last ${views.days} days</p><p class="sdh-stat__value">${views.total.toLocaleString('en-GB')}</p><p class="sdh-stat__note">Counts page loads, not people.</p></div>`
      );
    }
    const reply = replyMetric(model?.responses);
    if (reply) {
      if (reply.repliedPct !== null) {
        items.push(
          `<div class="sdh-stat"><p class="sdh-stat__label">Reply rate</p><p class="sdh-stat__value">${reply.repliedPct}%</p><p class="sdh-stat__note">Of ${plural(reply.sampleSize, 'recent conversation')}.</p></div>`
        );
      }
      if (reply.medianMinutes !== null) {
        items.push(
          `<div class="sdh-stat"><p class="sdh-stat__label">Typical reply time</p><p class="sdh-stat__value">${esc(formatMinutes(reply.medianMinutes))}</p><p class="sdh-stat__note">Of ${plural(reply.sampleSize, 'recent conversation')}.</p></div>`
        );
      }
    }
    return items.join('');
  }

  /** Sets the width of every progress bar from its data attribute (so no inline style is needed in markup). */
  function sizeBars(root) {
    root.querySelectorAll('[data-width]').forEach(node => {
      node.style.width = `${node.dataset.width}%`;
    });
  }

  /** Draws the summary row: the error state, the no-profile note, or the tiles. */
  function renderSummary() {
    const grid = byId(ids.summary);
    const extra = byId(ids.summaryExtra);
    if (!grid) {
      return;
    }
    grid.setAttribute('aria-busy', 'false');
    if (extra) {
      extra.hidden = true;
      extra.innerHTML = '';
    }
    if (isNoProfile()) {
      grid.className = 'sdh-summary__grid sdh-summary__grid--empty';
      grid.innerHTML =
        '<p class="sdh-note">Once you have a profile, your messages, profile completeness, rating and plan appear here.</p>';
      return;
    }
    if (!state.model) {
      grid.className = 'sdh-summary__grid sdh-summary__grid--empty';
      grid.innerHTML =
        '<div class="sdh-empty"><p class="sdh-empty__title">Your summary could not be loaded</p><p class="sdh-empty__text">Check your connection and try again.</p><button type="button" class="sdh-btn sdh-btn--secondary sdh-btn--sm" data-sdh-action="reload">Try again</button></div>';
      return;
    }
    grid.className = 'sdh-summary__grid';
    grid.innerHTML = [
      messagesTile(state.model),
      profileTile(state.model),
      ratingTile(state.model),
      planTile(state.model),
    ].join('');
    sizeBars(grid);
    const rows = extraRow(state.model);
    if (extra && rows) {
      extra.innerHTML = rows;
      extra.hidden = false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Next steps
   * ------------------------------------------------------------------ */

  const CHECK =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
  const CHEVRON =
    '<svg class="sdh-step__go" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

  /** The steps to show: the server's list, else the one derived from the summary, else null. */
  function resolveSteps(model, context) {
    const steps = model?.nextSteps || (model ? deriveSteps(model, context) : null);
    return applyVerificationState(steps, model?.verification);
  }

  /** Draws the Next steps checklist: to do first, finished ones folded into a details element. */
  function renderSteps() {
    const body = byId(ids.stepsBody);
    const sub = byId(ids.stepsSub);
    if (!body) {
      return;
    }
    if (!state.model) {
      if (sub) {
        sub.textContent = 'We could not load your checklist.';
      }
      body.innerHTML =
        '<p class="sdh-note">Something went wrong while loading your next steps.</p><button type="button" class="sdh-btn sdh-btn--secondary sdh-btn--sm" data-sdh-action="reload">Try again</button>';
      return;
    }
    const steps = state.steps;
    if (!steps) {
      if (sub) {
        sub.textContent = 'Nothing is waiting for you.';
      }
      body.innerHTML =
        '<p class="sdh-note">Nicely done. We will add steps here when something needs your attention.</p>';
      return;
    }
    const todo = steps.steps.filter(step => !step.done);
    const done = steps.steps.filter(step => step.done);
    if (sub) {
      sub.textContent = todo.length
        ? `${steps.completed} of ${steps.total} done. Start with the first one.`
        : 'Everything on the checklist is done.';
    }
    const primary = pickPrimaryStep(steps);
    // A long run of steps that cannot be started yet is noise: show a few, then say how many are coming.
    const blocked = todo.filter(step => step.locked && !step.waiting);
    const shown = blocked.length > 2 ? todo.filter(step => !step.locked || step.waiting) : todo;
    const later = todo.length - shown.length;
    const laterNote = later
      ? `<p class="sdh-note sdh-note--foot">${plural(later, 'more step')} unlock as you work through these.</p>`
      : '';
    const todoList = shown.length
      ? `<ul class="sdh-steps">${shown
          .map(step => {
            const label = esc(step.label);
            if (step.waiting) {
              return `<li><span class="sdh-step sdh-step--waiting"><span class="sdh-step__mark" aria-hidden="true"></span><span class="sdh-step__label">${label}</span></span></li>`;
            }
            if (step.locked) {
              return `<li><span class="sdh-step sdh-step--locked"><span class="sdh-step__mark" aria-hidden="true"></span><span class="sdh-step__label">${label}<span class="sdh-step__note"> ${esc(step.lockedReason || 'Not available yet')}</span></span></span></li>`;
            }
            return `<li><a class="sdh-step${step === primary ? ' sdh-step--next' : ''}" href="${esc(stepHref(step))}"${stepAttrs(step)}><span class="sdh-step__mark" aria-hidden="true"></span><span class="sdh-step__label">${label}</span>${CHEVRON}</a></li>`;
          })
          .join('')}</ul>${laterNote}`
      : '<p class="sdh-note">Nicely done. You can still change any of these from your profile.</p>';
    const doneList = done.length
      ? `<details class="sdh-done"><summary>${done.length} completed</summary><ul class="sdh-steps sdh-steps--done">${done
          .map(
            step =>
              `<li class="sdh-step sdh-step--done"><span class="sdh-step__mark" aria-hidden="true">${CHECK}</span><span class="sdh-step__label">${esc(step.label)}<span class="sdh-sr"> (done)</span></span></li>`
          )
          .join('')}</ul></details>`
      : '';
    body.innerHTML = `${bar((steps.completed / steps.total) * 100, `${Math.round((steps.completed / steps.total) * 100)}% of next steps complete`)}${todoList}${doneList}`;
    sizeBars(body);
  }

  /* ------------------------------------------------------------------ *
   * Verification strip and email banner
   * ------------------------------------------------------------------ */

  /** Draws the verification strip, or hides it when there is nothing to say (approved, unknown, or no profile). */
  function renderStrip() {
    const node = byId(ids.strip);
    if (!node) {
      return;
    }
    const candidate = isNoProfile() ? null : stripFor(state.model?.verification);
    // Until the email address is verified that is the step to take: do not stack a second banner on it.
    const emailPending = emailVerifiedFlag(state.user, state.model) === false;
    const strip = candidate && candidate.action === 'verify' && emailPending ? null : candidate;
    if (!strip) {
      node.hidden = true;
      node.innerHTML = '';
      return;
    }
    const notes = state.model.verification.notes;
    const buttons = {
      verify:
        '<button type="button" class="sdh-btn sdh-btn--primary sdh-btn--sm" data-sdh-action="verify">Get verified</button>',
      resubmit:
        '<button type="button" class="sdh-btn sdh-btn--primary sdh-btn--sm" data-sdh-action="verify">Resubmit</button>',
      support:
        '<button type="button" class="sdh-btn sdh-btn--secondary sdh-btn--sm" data-sdh-action="support">Open a ticket</button>',
    };
    node.dataset.tone = strip.tone;
    node.innerHTML = `<div class="sdh-strip__copy"><p class="sdh-strip__title">${esc(strip.title)}</p><p class="sdh-strip__text">${esc(strip.text)}</p>${
      notes && strip.action !== 'verify' ? `<p class="sdh-strip__notes">${esc(notes)}</p>` : ''
    }</div>${buttons[strip.action] ? `<div class="sdh-strip__actions">${buttons[strip.action]}</div>` : ''}`;
    node.hidden = false;
  }

  /** Shows the email verification reminder, with a button to send the link again. */
  function showEmailBanner(email) {
    const holder = byId(ids.banners);
    if (!holder || byId('email-verify-banner')) {
      return;
    }
    const node = document.createElement('div');
    node.id = 'email-verify-banner';
    node.className = 'sdh-strip';
    node.dataset.tone = 'warn';
    node.setAttribute('role', 'status');
    node.innerHTML =
      '<div class="sdh-strip__copy"><p class="sdh-strip__title">Please verify your email address</p><p class="sdh-strip__text">We sent you a link. Until you use it, you cannot save your profile or add packages.</p></div><div class="sdh-strip__actions"><button type="button" class="sdh-btn sdh-btn--primary sdh-btn--sm" data-sdh-action="resend-email">Resend email</button></div>';
    node.dataset.email = email || '';
    holder.insertBefore(node, holder.firstChild);
  }

  /** Sends the verification email again and says what happened in the banner. */
  async function resendVerification(button) {
    const banner = byId('email-verify-banner');
    const email = banner?.dataset.email || state.user?.email || '';
    if (!email) {
      toast('We could not find your email address. Try again from Settings.', 'error');
      return;
    }
    button.disabled = true;
    try {
      const result = await sendJson('/api/v1/auth/resend-verification', 'POST', { email });
      if (result.ok) {
        toast('Verification email sent. Check your inbox.', 'success');
        if (banner) {
          banner.querySelector('.sdh-strip__text').textContent =
            'Verification email sent. Check your inbox and use the link.';
        }
      } else {
        toast(result.data?.error || 'Could not resend the email. Please try again.', 'error');
        button.disabled = false;
      }
    } catch {
      toast('Could not resend the email. Please try again.', 'error');
      button.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Profile visits
   * ------------------------------------------------------------------ */

  /** An accessible bar chart of visits per day as inline SVG. Only drawn when the server sent a daily series. */
  function chartSvg(daily, days) {
    const width = 560;
    const height = 140;
    const gap = 2;
    const barWidth = Math.max(2, (width - gap * (daily.length - 1)) / daily.length);
    const peak = Math.max(1, ...daily.map(item => item.views));
    const total = daily.reduce((sum, item) => sum + item.views, 0);
    const bars = daily
      .map((item, index) => {
        const barHeight = Math.max(
          item.views > 0 ? 2 : 0,
          Math.round((item.views / peak) * (height - 4))
        );
        const label = `${formatShortDate(item.date) || item.date}: ${plural(item.views, 'visit')}`;
        return `<rect class="sdh-chart__bar" x="${(index * (barWidth + gap)).toFixed(1)}" y="${height - barHeight}" width="${barWidth.toFixed(1)}" height="${barHeight}" rx="1.5"><title>${esc(label)}</title></rect>`;
      })
      .join('');
    const first = formatShortDate(daily[0].date);
    const last = formatShortDate(daily[daily.length - 1].date);
    return `<figure class="sdh-chart"><svg class="sdh-chart__svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(`Profile visits per day over the last ${days} days: ${plural(total, 'visit')} in total, busiest day ${plural(peak, 'visit')}.`)}">${bars}</svg><figcaption class="sdh-chart__axis"><span>${esc(first)}</span><span>${esc(last)}</span></figcaption></figure>`;
  }

  /** Draws the profile visits card from the summary: total, chart when there is a daily series, and the footnote. */
  function renderVisits() {
    const box = byId(ids.chart);
    const sub = byId(ids.chartSub);
    if (!box) {
      return;
    }
    const views = state.model?.views;
    if (!state.model) {
      box.innerHTML = '<p class="sdh-note">We could not load your visits.</p>';
      return;
    }
    if (!views || views.total === null) {
      box.innerHTML = '<p class="sdh-note">Visit numbers are not available right now.</p>';
      return;
    }
    if (sub) {
      sub.textContent = `Last ${views.days} days.`;
    }
    const body = views.daily.length >= 2 ? chartSvg(views.daily, views.days) : '';
    const empty =
      views.total === 0
        ? '<p class="sdh-note">No visits yet. Your profile appears in search once it is approved.</p>'
        : '';
    const shorter =
      views.requestedDays > views.days
        ? `<p class="sdh-note">Your plan shows the last ${views.days} days. <a class="sdh-link" href="/pricing">See plans</a> for longer history.</p>`
        : '';
    box.innerHTML = `<p class="sdh-metric"><span class="sdh-metric__value">${views.total.toLocaleString('en-GB')}</span><span class="sdh-metric__unit"> ${views.total === 1 ? 'visit' : 'visits'}</span></p>${body}${empty}${shorter}<p class="sdh-note sdh-note--foot">Counts page loads, not people. One visitor can be counted once an hour.</p>`;
  }

  /* ------------------------------------------------------------------ *
   * Plan
   * ------------------------------------------------------------------ */

  /** "3 active packages, 10 photos, 7 days of analytics": what the plan includes, from its own limits. */
  function limitLines(limits) {
    const lines = [];
    const packages = limitOf(limits?.maxPackages);
    const photos = limitOf(limits?.maxPhotos);
    const analytics = limitOf(limits?.analyticsWindowDays);
    if (packages) {
      lines.push(`Up to ${plural(packages, 'active package')}`);
    } else if (limits && limits.maxPackages !== undefined) {
      lines.push('No limit on active packages');
    }
    if (photos) {
      lines.push(`Up to ${plural(photos, 'profile photo')}`);
    } else if (limits && limits.maxPhotos !== undefined) {
      lines.push('No limit on profile photos');
    }
    if (analytics) {
      lines.push(`${analytics} days of visit history`);
    }
    return lines;
  }

  /** Draws the plan card: the plan, its status and renewal date, what it includes, and billing actions. */
  function renderPlan() {
    const box = byId(ids.plan);
    if (!box) {
      return;
    }
    const subscription = state.model?.subscription || state.plan;
    if (!subscription) {
      box.innerHTML =
        '<p class="sdh-note">We could not load your plan.</p><a class="sdh-btn sdh-btn--secondary sdh-btn--sm" href="/supplier/subscription">View subscription</a>';
      return;
    }
    const label = planLabel(subscription.plan);
    const paid = String(subscription.plan || 'free').toLowerCase() !== 'free';
    const status = String(subscription.status || '').toLowerCase();
    const until = formatDate(subscription.activeUntil);
    const rows = [];
    let notice = '';
    if (status === 'past_due') {
      notice =
        '<div class="sdh-callout sdh-callout--danger"><p class="sdh-callout__title">Payment failed</p><p class="sdh-callout__text">Your last payment did not go through, so paid features are paused. Update your payment method to restore them.</p></div>';
    } else if (paid && until) {
      rows.push(subscription.cancelAtPeriodEnd ? `Ends on ${until}` : `Renews on ${until}`);
    }
    const usage = packageUsage(state.model);
    if (usage) {
      rows.push(usage);
    }
    const included = limitLines(subscription.limits);
    const statusPill = paid
      ? `<span class="sdh-pill${status === 'active' || status === 'trialing' ? ' sdh-pill--accent' : ''}">${esc(status === 'trialing' ? 'Trial' : status === 'past_due' ? 'Past due' : status === 'active' ? 'Active' : status || 'Active')}</span>`
      : '';
    box.innerHTML = `<div class="sdh-plan"><p class="sdh-plan__name">${esc(label)} ${statusPill}</p>${notice}${rows.length ? `<ul class="sdh-facts">${rows.map(row => `<li>${esc(row)}</li>`).join('')}</ul>` : ''}${
      included.length
        ? `<p class="sdh-plan__head">Included</p><ul class="sdh-facts sdh-facts--muted">${included.map(row => `<li>${esc(row)}</li>`).join('')}</ul>`
        : ''
    }<div class="sdh-plan__actions">${
      paid
        ? `<button type="button" class="sdh-btn sdh-btn--secondary sdh-btn--sm" data-sdh-action="billing">${status === 'past_due' ? 'Update payment method' : 'Manage billing'}</button>`
        : '<a class="sdh-btn sdh-btn--primary sdh-btn--sm" href="/pricing">See plans</a>'
    }</div></div>`;
  }

  /** Opens the Stripe billing portal so a supplier can update a card, see invoices or cancel. */
  async function openBilling(button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Loading…';
    try {
      const result = await sendJson('/api/payments/create-portal-session', 'POST', {
        returnUrl: window.location.href,
      });
      if (!result.ok || !result.data.url) {
        throw new Error(result.data.error || 'Could not open the billing portal.');
      }
      window.location.href = result.data.url;
    } catch (error) {
      toast(error.message || 'Could not open the billing portal. Please try again.', 'error');
      button.disabled = false;
      button.textContent = original;
    }
  }

  /* ------------------------------------------------------------------ *
   * Availability
   * ------------------------------------------------------------------ */

  const AVAILABILITY = [
    { value: 'available', label: 'Available' },
    { value: 'limited', label: 'Limited' },
    { value: 'unavailable', label: 'Unavailable' },
  ];

  /** Draws the availability picker (three options and a note) with a Save button. */
  function renderAvailability(availability) {
    const box = byId(ids.availability);
    if (!box) {
      return;
    }
    const current = AVAILABILITY.some(option => option.value === availability?.status)
      ? availability.status
      : 'available';
    box.innerHTML = `<div class="sdh-availability" data-status="${esc(current)}">
      <div class="sdh-seg" role="group" aria-label="Your availability">${AVAILABILITY.map(
        option =>
          `<button type="button" class="sdh-seg__btn" data-availability="${option.value}" aria-pressed="${option.value === current}">${option.label}</button>`
      ).join('')}</div>
      <div class="sdh-field">
        <label class="sdh-label" for="sdh-availability-note">Note for customers (optional)</label>
        <textarea id="sdh-availability-note" class="sdh-input sdh-input--area" rows="2" maxlength="300">${esc(availability?.notes || '')}</textarea>
      </div>
      <div class="sdh-form__actions">
        <button type="button" class="sdh-btn sdh-btn--secondary sdh-btn--sm" data-sdh-action="save-availability">Save</button>
        <span class="sdh-form__status" id="sdh-availability-status" role="status" aria-live="polite"></span>
      </div>
    </div>`;
  }

  /** Loads the saved availability, or shows an error with a retry button. */
  async function loadAvailability() {
    const box = byId(ids.availability);
    if (!box) {
      return;
    }
    const result = await getJson('/api/v1/supplier/availability');
    if (!result.data) {
      box.innerHTML =
        '<p class="sdh-note">We could not load your availability.</p><button type="button" class="sdh-btn sdh-btn--secondary sdh-btn--sm" data-sdh-action="retry-availability">Try again</button>';
      return;
    }
    renderAvailability(result.data.availability || {});
  }

  /** Saves the chosen availability and note. */
  async function saveAvailability(button) {
    const box = byId(ids.availability);
    const root = box?.querySelector('.sdh-availability');
    const status = byId('sdh-availability-status');
    if (!root) {
      return;
    }
    const pressed = root.querySelector('[aria-pressed="true"]');
    const note = byId('sdh-availability-note');
    button.disabled = true;
    if (status) {
      status.dataset.tone = '';
      status.textContent = 'Saving…';
    }
    try {
      const result = await sendJson('/api/v1/supplier/availability', 'PATCH', {
        status: pressed ? pressed.dataset.availability : 'available',
        notes: note ? note.value : '',
      });
      if (status) {
        status.dataset.tone = result.ok ? 'success' : 'error';
        status.textContent = result.ok
          ? 'Saved'
          : result.data?.error || 'Could not save. Please try again.';
      }
    } catch {
      if (status) {
        status.dataset.tone = 'error';
        status.textContent = 'Could not save. Please try again.';
      }
    } finally {
      button.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Tips
   * ------------------------------------------------------------------ */

  /** Draws the tips the server chose for this profile; nothing is shown that the server did not send. */
  async function loadTips() {
    const box = byId(ids.tips);
    if (!box) {
      return;
    }
    const result = await getJson('/api/v1/supplier/performance-tips');
    const section = byId('sdh-tips');
    if (!result.data) {
      box.innerHTML =
        '<p class="sdh-note">We could not load your tips.</p><button type="button" class="sdh-btn sdh-btn--secondary sdh-btn--sm" data-sdh-action="retry-tips">Try again</button>';
      return;
    }
    const tips = Array.isArray(result.data.tips)
      ? result.data.tips.filter(tip => tip && tip.title)
      : [];
    if (!tips.length) {
      if (section) {
        section.hidden = true;
      }
      return;
    }
    if (section) {
      section.hidden = false;
    }
    box.innerHTML = `<ul class="sdh-tips">${tips
      .map(tip => {
        const action =
          tip.action && tip.action.label
            ? tip.action.href && /^(\/(?!\/)|#)/u.test(tip.action.href)
              ? `<a class="sdh-link" href="${esc(tip.action.href)}">${esc(tip.action.label)}</a>`
              : tip.action.data === 'request-review'
                ? `<button type="button" class="sdh-link" data-sdh-action="request-review">${esc(tip.action.label)}</button>`
                : ''
            : '';
        return `<li class="sdh-tip"><p class="sdh-tip__title">${esc(tip.title)}</p>${tip.body ? `<p class="sdh-tip__text">${esc(tip.body)}</p>` : ''}${action}</li>`;
      })
      .join('')}</ul>`;
  }

  /* ------------------------------------------------------------------ *
   * Review requests
   * ------------------------------------------------------------------ */

  const REQUEST_STATUS = {
    pending: 'Preparing',
    sent: 'Sent',
    opened: 'Opened',
    completed: 'Completed',
    failed: 'Failed',
    expired: 'Expired',
  };

  let reviewRequests = { items: [], summary: {} };

  /** Draws the short list of review requests under the reviews: who was asked and what happened. */
  function renderReviewRequests() {
    const box = byId(ids.reviewRequests);
    if (!box) {
      return;
    }
    const items = Array.isArray(reviewRequests.items) ? reviewRequests.items.slice(0, 5) : [];
    if (!items.length) {
      box.innerHTML = '';
      return;
    }
    const summary = reviewRequests.summary || {};
    const total = count(summary.total);
    const completed = count(summary.completed);
    const head =
      total !== null && completed !== null
        ? `${completed} of ${plural(total, 'request')} answered`
        : 'Recent requests';
    box.innerHTML = `<h3 class="sdh-subhead">Review requests <span class="sdh-subhead__note">${esc(head)}</span></h3><ul class="sdh-list">${items
      .map(item => {
        const when = formatDate(
          item.completedAt || item.openedAt || item.sentAt || item.failedAt || item.createdAt
        );
        const retry = item.retryable
          ? `<button type="button" class="sdh-link" data-sdh-action="retry-request" data-request="${esc(item.id)}">${item.status === 'completed' ? 'Request again' : 'Retry'}</button>`
          : '';
        return `<li class="sdh-list__row"><div class="sdh-list__main"><p class="sdh-list__title">${esc(item.customerName || item.customerEmail)}</p><p class="sdh-list__meta">${esc(REQUEST_STATUS[item.status] || 'Unknown')}${when ? ` · ${esc(when)}` : ''}</p></div>${retry}</li>`;
      })
      .join('')}</ul>`;
  }

  /** Loads the review request history; a failure leaves the list out rather than showing an error for a side note. */
  async function loadReviewRequests() {
    const result = await getJson('/api/v1/supplier/review-requests?limit=50');
    if (result.data) {
      reviewRequests = { items: result.data.items || [], summary: result.data.summary || {} };
    }
    renderReviewRequests();
  }

  /** Opens the request-a-review dialog with the email field focused. */
  function openReviewDialog() {
    const dialog = byId(ids.reviewDialog);
    if (!dialog) {
      return;
    }
    const status = byId('rreq-status');
    if (status) {
      status.textContent = '';
      status.dataset.tone = '';
    }
    openDialog(dialog);
    byId('rreq-email')?.focus();
  }

  /** Sends one review request and refreshes the list. */
  async function submitReviewRequest(event) {
    event.preventDefault();
    const email = byId('rreq-email');
    const name = byId('rreq-name');
    const status = byId('rreq-status');
    const button = byId('rreq-send-btn');
    if (!email || !email.value.trim() || !email.checkValidity()) {
      status.dataset.tone = 'error';
      status.textContent = 'Enter a valid customer email address.';
      email?.focus();
      return;
    }
    button.disabled = true;
    status.dataset.tone = '';
    status.textContent = 'Sending…';
    try {
      const result = await sendJson('/api/v1/supplier/request-review', 'POST', {
        customerEmail: email.value.trim(),
        customerName: name ? name.value.trim() : '',
      });
      if (result.ok) {
        toast('Review request sent.', 'success');
        email.value = '';
        if (name) {
          name.value = '';
        }
        closeDialog(byId(ids.reviewDialog));
        await loadReviewRequests();
      } else {
        status.dataset.tone = 'error';
        status.textContent =
          result.status === 409
            ? result.data?.error || 'You have already asked this customer.'
            : result.data?.error || 'Could not send the request. Please try again.';
      }
    } catch {
      status.dataset.tone = 'error';
      status.textContent = 'Could not send the request. Please try again.';
    } finally {
      button.disabled = false;
    }
  }

  /** Sends a failed or finished request again, from its row in the list. */
  async function retryReviewRequest(button) {
    const item = (reviewRequests.items || []).find(
      candidate => String(candidate.id) === button.dataset.request
    );
    if (!item) {
      return;
    }
    button.disabled = true;
    try {
      const result = await sendJson('/api/v1/supplier/request-review', 'POST', {
        customerEmail: item.customerEmail,
        customerName: item.customerName || '',
      });
      toast(
        result.ok
          ? 'Review request sent again.'
          : result.data?.error || 'Could not send the request.',
        result.ok ? 'success' : 'error'
      );
      if (result.ok) {
        await loadReviewRequests();
      }
    } catch {
      toast('Could not send the request. Please try again.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Page actions: buttons that open forms and dialogs owned by other scripts
   * ------------------------------------------------------------------ */

  /** Scrolls an element into view, without animation for people who ask for reduced motion. */
  function scrollToNode(node, block) {
    node.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: block || 'start',
    });
  }

  /** Opens a collapsible form section by clicking its toggle (app.js owns the open/close state), then focuses a field. */
  function openForm(sectionId, toggleId, focusId) {
    const section = byId(sectionId);
    const toggle = byId(toggleId);
    if (!section || !toggle) {
      return;
    }
    if (!section.classList.contains('expanded') && !toggle.disabled) {
      toggle.click();
    }
    const field = focusId ? byId(focusId) : null;
    window.setTimeout(() => {
      if (field) {
        scrollToNode(field, 'center');
        field.focus({ preventScroll: true });
      } else {
        scrollToNode(section, 'start');
      }
    }, 120);
  }

  /** The supplier's profile as the verification form pre-fills it. */
  function profileForVerification() {
    const supplier = Array.isArray(state.suppliers) ? state.suppliers[0] : null;
    return supplier
      ? { ...supplier, email: supplier.email || state.user?.email || '' }
      : { email: state.user?.email || '' };
  }

  /** Opens the verification dialog (verification.js) with the notes from the last review. */
  function openVerification() {
    const verification = state.model?.verification;
    const resubmit =
      verification && (verification.state === 'rejected' || verification.state === 'needs_changes');
    if (window.SupplierVerification?.open) {
      window.SupplierVerification.open(
        profileForVerification(),
        resubmit ? { rejectionNotes: verification.notes || '' } : {}
      );
    }
  }

  /** Runs one of the page's data-sdh-action buttons. */
  function runAction(node, event) {
    const action = node.dataset.sdhAction;
    if (action === 'edit-profile') {
      event.preventDefault();
      openForm('profile-form-section', 'toggle-profile-form', node.dataset.sdhFocus || 'sup-name');
    } else if (action === 'new-package') {
      event.preventDefault();
      openForm('package-form-section', 'toggle-package-form', 'pkg-title');
    } else if (action === 'upload-avatar') {
      event.preventDefault();
      const card = byId('my-suppliers');
      const button =
        card?.querySelector('[data-action="upload-photo"]') ||
        card?.querySelector('label[for^="supplier-profile-photo-upload"]');
      if (card) {
        scrollToNode(card, 'center');
      }
      button?.focus({ preventScroll: true });
    } else if (action === 'scroll') {
      event.preventDefault();
      const target = byId(node.dataset.sdhTarget || '');
      if (target) {
        scrollToNode(target, 'start');
      }
    } else if (action === 'verify') {
      event.preventDefault();
      openVerification();
    } else if (action === 'resend-email') {
      event.preventDefault();
      resendVerification(node);
    } else if (action === 'request-review') {
      event.preventDefault();
      openReviewDialog();
    } else if (action === 'support') {
      event.preventDefault();
      const ticket = byId('createSupplierTicketBtn');
      if (ticket) {
        scrollToNode(ticket, 'center');
        ticket.click();
      }
    } else if (action === 'billing') {
      openBilling(node);
    } else if (action === 'save-availability') {
      saveAvailability(node);
    } else if (action === 'retry-availability') {
      loadAvailability();
    } else if (action === 'retry-tips') {
      loadTips();
    } else if (action === 'reload-packages') {
      if (typeof window._efLoadPackages === 'function') {
        window._efLoadPackages();
      }
    } else if (action === 'retry-request') {
      retryReviewRequest(node);
    } else if (action === 'reload') {
      refresh();
    }
  }

  /** Wires the clicks for every data-sdh-action, the availability picker and the dialogs' close buttons. */
  function bindPageEvents() {
    document.addEventListener('click', event => {
      const target = event.target;
      const seg = target.closest?.('[data-availability]');
      if (seg) {
        seg.parentElement.querySelectorAll('[data-availability]').forEach(button => {
          button.setAttribute('aria-pressed', String(button === seg));
        });
        return;
      }
      const action = target.closest?.('[data-sdh-action]');
      if (action) {
        runAction(action, event);
        return;
      }
      const close = target.closest?.('[data-sdh-close]');
      if (close) {
        closeDialog(close.closest('dialog'));
      }
    });
    byId(ids.reviewForm)?.addEventListener('submit', submitReviewRequest);
    document.querySelectorAll('dialog.sdh-dialog').forEach(dialog => {
      dialog.addEventListener('click', event => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === dialog && dialog.id !== 'sdh-confirm-dialog') {
          closeDialog(dialog);
        }
      });
    });
    document.addEventListener('sdh:suppliers', event => {
      state.suppliers = event.detail?.suppliers || [];
      applyProfileMode();
      renderAll();
      initReviews();
    });
    document.addEventListener('sdh:changed', () => {
      refresh();
    });
    window.addEventListener('unreadCountUpdated', event => {
      // The summary's number is the one shown; this only fills it in when the summary had none.
      const unread = count(event.detail?.count);
      if (
        state.model &&
        unread !== null &&
        (!state.model.messages || state.model.messages.unread === null)
      ) {
        state.model.messages = { unread, conversations: null, latestAt: '' };
        renderSummary();
      }
    });
  }

  /** Deep links from the public profile and from emails: #photos, #packages, #profile. */
  function handleDeepLink() {
    const hash = window.location.hash.slice(1);
    if (hash === 'photos') {
      openForm('profile-form-section', 'toggle-profile-form', 'sup-photo-drop');
    } else if (hash === 'packages') {
      const section = byId('my-packages') || byId('packages-section');
      if (section) {
        scrollToNode(section, 'start');
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Reviews and messages (their own scripts draw the lists)
   * ------------------------------------------------------------------ */

  let reviewsStarted = false;

  /** Starts the review list for the supplier's profile once its id is known (supplier-reviews-init.js). */
  function initReviews() {
    if (reviewsStarted || isNoProfile()) {
      return;
    }
    const id =
      state.model?.profile?.id || (Array.isArray(state.suppliers) && state.suppliers[0]?.id) || '';
    if (!id || !window.SupplierReviews?.init) {
      return;
    }
    reviewsStarted = true;
    window.SupplierReviews.init(String(id), ids.reviews);
  }

  /** Starts the messenger widget in its card. The widget draws its own list; its heading is hidden by the sheet. */
  function initMessenger() {
    if (typeof MessengerWidgetV4 === 'undefined' || !byId(ids.messenger)) {
      return;
    }
    // eslint-disable-next-line no-new -- the widget attaches itself to its container
    new MessengerWidgetV4(ids.messenger, { maxItems: 5, broadcastUnread: false });
  }

  /* ------------------------------------------------------------------ *
   * Putting it together
   * ------------------------------------------------------------------ */

  /** Shows the plan from the summary on the profile card's badge (the supplier record can be stale). */
  function syncTierBadge() {
    const plan = state.model?.subscription?.plan;
    if (!plan) {
      return;
    }
    document.querySelectorAll('[data-sdh-tier]').forEach(node => {
      node.textContent = planLabel(plan);
    });
  }

  /** Redraws everything that depends on the summary. */
  function renderAll() {
    state.steps = resolveSteps(state.model, {
      emailVerified: emailVerifiedFlag(state.user, state.model),
    });
    applyProfileMode();
    renderHero();
    renderSummary();
    renderSteps();
    renderStrip();
    renderVisits();
    renderPlan();
    syncTierBadge();
    initReviews();
  }

  /** Asks the server for the summary again and redraws. Called after a profile or package change. */
  async function refresh() {
    state.summaryPromise = null;
    await getSummary(true);
    renderAll();
  }

  /** Loads the data, then draws the page. The summary and the user load together. */
  async function start() {
    const [model, user] = await Promise.all([getSummary(false), loadUser()]);
    state.user = user;
    if (emailVerifiedFlag(user, model) === false) {
      showEmailBanner(user?.email || '');
    }
    renderAll();
  }

  /** Starts the data requests. The summary request is asked for before app.js needs the allowance. */
  function begin() {
    getSummary(false);
    start();
  }

  /** Binds events and starts the parts that need the other scripts, once the page has been parsed. */
  function init() {
    installToastShims();
    // app.js declares its own showToast; this runs after it, so the page has one toast.
    window.showToast = toast;
    bindPageEvents();
    handleDeepLink();
    window.addEventListener('hashchange', handleDeepLink);
    loadAvailability();
    loadTips();
    loadReviewRequests();
    initMessenger();
    initReviews();
  }

  window.SupplierDashboardHome = {
    getSummary,
    getPackageAllowance,
    refresh,
    confirm: confirmAction,
    toast,
    normaliseSummary,
    deriveSteps,
    applyVerificationState,
    normaliseSteps,
    pickPrimaryStep,
    stepAction,
    formatMinutes,
    formatRating,
    packageUsage,
    packageLimit,
    replyMetric,
    stripFor,
    ledeFor,
    greetingFor,
    limitLines,
    planLabel,
    emailVerifiedFlag,
  };

  // The summary request starts as soon as this script runs; the rest waits for the other scripts.
  begin();
  if (document.readyState === 'complete') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
