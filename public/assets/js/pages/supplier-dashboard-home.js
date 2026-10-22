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
  const PERIODS = [7, 30, 90];
  const SUPPLIERS_WAIT_MS = 4000;

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

  /**
   * HTML-escapes any value (null and undefined become an empty string) for safe use in markup,
   * in text and inside quoted attributes alike: the quote characters become entities too.
   */
  function esc(value) {
    const holder = document.createElement('div');
    holder.textContent = String(value === null || value === undefined ? '' : value);
    return holder.innerHTML.split('"').join('&quot;').split("'").join('&#39;');
  }

  const LOCAL_BASE = 'https://local.invalid';

  /**
   * A link that stays on this site, or ''. Only a same-site path ("/dashboard/supplier?x=1") or a
   * fragment ("#reviews") passes. The text is parsed the way a browser parses it, so tricks that a
   * pattern test would miss (a tab or newline after the first slash, which browsers drop, leaving
   * "//evil.example"; a backslash; a scheme) never get through: anything with whitespace or control
   * characters is refused outright, and a path must still resolve to this site.
   */
  function localHref(value) {
    if (typeof value !== 'string') {
      return '';
    }
    const text = value.trim();
    if (!text || Array.from(text).some(char => char.charCodeAt(0) <= 32 || char === '\\')) {
      return '';
    }
    if (text.startsWith('#')) {
      return text;
    }
    if (!text.startsWith('/')) {
      return '';
    }
    try {
      const parsed = new URL(text, LOCAL_BASE);
      return parsed.origin === LOCAL_BASE ? `${parsed.pathname}${parsed.search}${parsed.hash}` : '';
    } catch {
      return '';
    }
  }

  /**
   * An address the server asked the page to navigate to (the billing portal): one of Stripe's own
   * hosted pages over https, or a page on this site, as utils/checkout-url.js decides. Anything else
   * (another https site, a javascript: or data: address, plain http, text that is not an address)
   * is '' and is never navigated to, whatever the response says.
   */
  function navigableUrl(value, base) {
    const resolver = window.EFCheckoutUrl;
    if (!resolver || typeof resolver.resolve !== 'function') {
      return '';
    }
    try {
      return resolver.resolve(value, new URL(base || window.location.href).origin) || '';
    } catch {
      return '';
    }
  }

  /** True for a finite number (not NaN, not a numeric string, not null). */
  function isNum(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  /** "1 day" / "2 days": the count followed by the singular or plural noun. */
  function plural(amount, one, many) {
    return `${amount.toLocaleString('en-GB')} ${amount === 1 ? one : many || `${one}s`}`;
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
    const attempt = token =>
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

  /** The value when it is an object, else null. */
  function objectOrNull(value) {
    return value && typeof value === 'object' ? value : null;
  }

  /** A percentage clamped to 0-100 and rounded, or null when the value is not a number. */
  function percentOrNull(value) {
    return isNum(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
  }

  /** The verification block: the flags as booleans (or null), the state text and the rejection count. */
  function normaliseVerification(verification) {
    if (!verification) {
      return null;
    }
    let stateText = '';
    if (typeof verification.status === 'string' && verification.status) {
      stateText = verification.status;
    } else if (typeof verification.state === 'string') {
      stateText = verification.state;
    }
    return {
      approved: typeof verification.approved === 'boolean' ? verification.approved : null,
      emailVerified:
        typeof verification.emailVerified === 'boolean' ? verification.emailVerified : null,
      state: stateText,
      notes: typeof verification.notes === 'string' ? verification.notes : '',
      rejectionCount: count(verification.rejectionCount) || 0,
    };
  }

  /** The profile block: name, id, a same-site public path, the completeness score and its checks. */
  function normaliseProfile(profile) {
    if (!profile) {
      return null;
    }
    const completeness = objectOrNull(profile.completeness);
    const publicPath = localHref(profile.publicProfilePath);
    return {
      name: typeof profile.name === 'string' ? profile.name : '',
      id: profile.topProfileId ? String(profile.topProfileId) : '',
      publicProfilePath: publicPath.startsWith('/') ? publicPath : '',
      score: percentOrNull(completeness?.score),
      checks: Array.isArray(completeness?.checks) ? completeness.checks : [],
    };
  }

  /** The packages block: the counts and the plan limit. */
  function normalisePackages(packages) {
    if (!packages) {
      return null;
    }
    return {
      total: count(packages.total),
      active: count(packages.active),
      paused: count(packages.paused),
      awaitingApproval: count(packages.awaitingApproval),
      counted: count(packages.countedTowardsLimit),
      limit: limitOf(packages.limit),
    };
  }

  /** The messages block: unread messages, conversations with unread, and when the latest arrived. */
  function normaliseMessages(messages) {
    if (!messages) {
      return null;
    }
    return {
      unread: count(messages.unreadMessages),
      conversations: count(messages.conversationsWithUnread),
      latestAt: messages.latestAt || '',
    };
  }

  /** The responses block: sample size, reply rate and median reply time. */
  function normaliseResponses(responses) {
    if (!responses) {
      return null;
    }
    return {
      sampleSize: count(responses.sampleSize) || 0,
      repliedPct: percentOrNull(responses.repliedPct),
      medianMinutes:
        isNum(responses.medianMinutes) && responses.medianMinutes >= 0
          ? responses.medianMinutes
          : null,
    };
  }

  /** The enquiries block: this period and the last, requests received, and where they came from. */
  function normaliseEnquiries(enquiries) {
    if (!enquiries) {
      return null;
    }
    return {
      fresh: count(enquiries.newThisPeriod),
      previous: count(enquiries.previousPeriod),
      requestsReceived: count(enquiries.requests?.received),
      requestsNew: count(enquiries.requests?.new),
      quoteRequests: count(enquiries.sources?.quoteRequests),
      contactForm: count(enquiries.sources?.contactForm),
      conversations: count(enquiries.sources?.conversations),
      truncated: enquiries.truncated === true,
    };
  }

  /** The views block: the total, the window it covers and the daily series. */
  function normaliseViews(data, views, windowInfo, viewDays) {
    if (!views) {
      return null;
    }
    return {
      description: typeof views.description === 'string' ? views.description : '',
      maxDays: limitOf(windowInfo?.maxDays) || null,
      total: count(views.total),
      days: viewDays,
      daily: normaliseDaily(views.daily || views.series || data.analytics?.dailyData),
      requestedDays: limitOf(windowInfo?.requestedDays) || SUMMARY_DAYS,
    };
  }

  /** The reviews block: approved count, approved average and pending count. */
  function normaliseReviews(reviews) {
    if (!reviews) {
      return null;
    }
    return {
      count: count(reviews.approvedCount),
      average: isNum(reviews.averageRating) ? reviews.averageRating : null,
      pending: count(reviews.pendingCount),
    };
  }

  /** The subscription block: plan, status, dates, the cancel flag and the plan's limits. */
  function normaliseSubscription(subscription) {
    if (!subscription) {
      return null;
    }
    return {
      plan: typeof subscription.plan === 'string' ? subscription.plan : '',
      status: typeof subscription.status === 'string' ? subscription.status : '',
      activeUntil: subscription.activeUntil || '',
      trialEndsAt: subscription.trialEndsAt || '',
      cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
      limits: objectOrNull(subscription.limits),
    };
  }

  /**
   * Turns whatever the server sent into the one shape the page draws from. Every field is
   * optional: a block that is missing, or whose values are not numbers, comes out as null and
   * the page shows a dash or leaves it out. Nothing is defaulted to 0 or 100.
   */
  function normaliseSummary(raw) {
    const data = objectOrNull(raw) || {};
    const views = objectOrNull(data.views);
    const windowInfo = objectOrNull(data.window);
    const viewDays = limitOf(views?.days) || limitOf(windowInfo?.days) || SUMMARY_DAYS;

    return {
      windowDays: limitOf(windowInfo?.days) || viewDays,
      verification: normaliseVerification(objectOrNull(data.verification)),
      profile: normaliseProfile(objectOrNull(data.profile)),
      packages: normalisePackages(objectOrNull(data.packages)),
      messages: normaliseMessages(objectOrNull(data.messages)),
      responses: normaliseResponses(objectOrNull(data.responses)),
      enquiries: normaliseEnquiries(objectOrNull(data.enquiries)),
      views: normaliseViews(data, views, windowInfo, viewDays),
      reviews: normaliseReviews(objectOrNull(data.reviews)),
      subscription: normaliseSubscription(objectOrNull(data.subscription)),
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
      .map(item => ({
        date: String(item.date || item.label || ''),
        views: count(item.views),
        enquiries: count(item.enquiries),
      }));
  }

  /** Names the banner step the way the editor does: "Add banner" while open, "Banner added" once done. */
  function stepLabel(key, label, done) {
    if (/banner|cover/u.test(String(key))) {
      return done ? 'Banner added' : 'Add banner';
    }
    return label;
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
        label: stepLabel(
          String(step.id || step.key || ''),
          String(step.label || step.title),
          Boolean(step.done || step.completed)
        ),
        done: Boolean(step.done || step.completed),
        locked: Boolean(step.locked),
        lockedReason: typeof step.lockedReason === 'string' ? step.lockedReason : '',
        waiting: Boolean(step.waiting),
        href: localHref(step.href),
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
        label: stepLabel(
          `profile-${String(check.id || check.key || '')}`,
          String(check.label || check.id || 'Complete your profile'),
          false
        ),
        done: false,
        locked: false,
        waiting: false,
        href: '',
      });
    });
    const verification = model?.verification;
    if (verification && verification.approved === false) {
      const inReview = isInReview(verification);
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
      .filter(check => check?.done)
      .forEach(check => {
        steps.push({
          key: `profile-${String(check.id || check.key || '')}`,
          label: stepLabel(
            `profile-${String(check.id || check.key || '')}`,
            String(check.label || check.id || ''),
            true
          ),
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

  /** True for the steps that polish a profile (banner, tagline, social links) rather than set it up. */
  function isPolishStep(step) {
    return /banner|cover|social|tagline/u.test(String(step?.key || ''));
  }

  /**
   * The first step the supplier can act on now: not done, not locked behind approval, not just
   * waiting, and not a polish step. The banner is an Edit profile field, so it never becomes the
   * big button at the top of the page; when only polish is left there is no primary action.
   */
  function pickPrimaryStep(steps) {
    const list = steps?.steps || [];
    /** True for a step the supplier can act on right now, and that is worth a headline button. */
    const open = step => !step.done && !step.locked && !step.waiting && !isPolishStep(step);
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
    const inReview = isInReview(verification);
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
    if (/banner|cover/u.test(key)) {
      return { action: 'edit-profile', focus: 'sdh-banner-upload' };
    }
    if (/social|tagline/u.test(key)) {
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

  /** True while a verification request is waiting for a decision (the server says pending_review, or pending). */
  function isInReview(verification) {
    return Boolean(verification) && /^pending/u.test(verification.state);
  }

  /** What the verification strip should say for the profile's state, or null when there is nothing to say. */
  function stripFor(verification) {
    if (!verification || verification.approved !== false) {
      return null;
    }
    const state = verification.state;
    if (isInReview(verification)) {
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
    if (strip && isInReview(model.verification)) {
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
    showOnTop(node);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      node.hidden = true;
      hideOnTop(node);
    }, 5000);
  }

  /**
   * Puts a node in the browser's top layer, above any open dialog, where popovers are supported.
   * A toast that confirms a save would otherwise be hidden behind the editor it came from.
   */
  function showOnTop(node) {
    if (typeof node.showPopover !== 'function') {
      return;
    }
    try {
      node.setAttribute('popover', 'manual');
      if (node.matches(':popover-open')) {
        node.hidePopover();
      }
      node.showPopover();
    } catch {
      /* the toast still shows, just not above a dialog */
    }
  }

  /** Takes a node out of the top layer again. */
  function hideOnTop(node) {
    try {
      if (typeof node.hidePopover === 'function' && node.matches(':popover-open')) {
        node.hidePopover();
      }
    } catch {
      /* nothing to undo */
    }
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
   * Opens the page's confirmation dialog and resolves to true when the supplier confirms. Where
   * <dialog> is not supported the same dialog is shown plainly; with no dialog on the page the
   * answer is "no", so nothing destructive ever happens without an explicit yes.
   */
  function confirmAction(options) {
    const settings = options || {};
    const dialog = byId(ids.confirmDialog);
    if (!dialog) {
      return Promise.resolve(false);
    }
    byId('sdh-confirm-title').textContent = settings.title || 'Are you sure?';
    byId('sdh-confirm-text').textContent = settings.message || '';
    const okButton = byId('sdh-confirm-ok');
    const cancelButton = byId('sdh-confirm-cancel');
    okButton.textContent = settings.confirmLabel || 'Delete';
    cancelButton.textContent = settings.cancelLabel || 'Cancel';
    const opener = document.activeElement;
    return new Promise(resolve => {
      let confirmed = false;
      /** Records the answer and closes the dialog. */
      const finish = answer => {
        confirmed = answer;
        closeDialog(dialog);
        if (typeof dialog.close !== 'function') {
          // Without <dialog> there is no native close event, so raise the one the cleanup waits for.
          dialog.dispatchEvent(new Event('close'));
        }
      };
      /** The confirm button was pressed. */
      const onOk = event => {
        event.preventDefault();
        finish(true);
      };
      /** The cancel button was pressed. */
      const onCancel = () => finish(false);
      /** Escape answers "no", whatever the browser does with its own close request. */
      const onKey = event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      };
      /** Resolves once the dialog has closed, however it was closed. */
      const onClose = () => {
        okButton.removeEventListener('click', onOk);
        cancelButton.removeEventListener('click', onCancel);
        dialog.removeEventListener('close', onClose);
        document.removeEventListener('keydown', onKey);
        if (opener && typeof opener.focus === 'function') {
          opener.focus();
        }
        resolve(confirmed);
      };
      document.addEventListener('keydown', onKey);
      okButton.addEventListener('click', onOk);
      cancelButton.addEventListener('click', onCancel);
      dialog.addEventListener('close', onClose);
      openDialog(dialog);
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
    skippedSummary: false,
    suppliersKnown: null,
    markSuppliersKnown: null,
    loaded: false,
    loadersStarted: false,
    billing: null,
    billingRequested: false,
    messenger: null,
    ownSubscriptionPromise: null,
    days: SUMMARY_DAYS,
  };

  /** Resolves once app.js has reported the supplier list, or after a few seconds if it never does. */
  state.suppliersKnown = new Promise(resolve => {
    const timer = window.setTimeout(resolve, SUPPLIERS_WAIT_MS);
    state.markSuppliersKnown = () => {
      window.clearTimeout(timer);
      resolve();
    };
  });

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

  /** The signed-in supplier's own subscription record, requested once and shared by everything that needs it. */
  function ownSubscription() {
    if (!state.ownSubscriptionPromise) {
      state.ownSubscriptionPromise = getJson('/api/v2/subscriptions/me');
    }
    return state.ownSubscriptionPromise;
  }

  /**
   * Fetches the summary once and normalises it; resolves to the model, or null when there is none.
   * A supplier with no profile gets a 404, which the site's fetch wrapper turns into an error
   * toast. So unless the caller forces it, the request waits for the supplier list and is not
   * sent at all when that list is empty.
   */
  async function fetchSummary(skipWhenNoProfile) {
    if (skipWhenNoProfile) {
      await state.suppliersKnown;
    }
    state.skippedSummary = Boolean(skipWhenNoProfile) && isNoProfile();
    const result = state.skippedSummary
      ? { status: 404, data: null }
      : await getJson(`/api/supplier/dashboard-summary?days=${state.days}`);
    state.notFound = result.status === 404;
    state.failed = !result.data;
    if (!result.data) {
      state.model = null;
      // No summary (for example no profile yet): the plan card can still say which plan it is.
      const own = await ownSubscription();
      state.plan = own.data ? normaliseSummary({ subscription: own.data }).subscription : null;
      return null;
    }
    const model = normaliseSummary(result.data);
    if (!model.subscription) {
      const sub = await ownSubscription();
      if (sub.data) {
        model.subscription = normaliseSummary({ subscription: sub.data }).subscription;
      }
    }
    state.model = model;
    return model;
  }

  /** The shared summary request. Pass force to ask the server again (after a profile or package change). */
  function getSummary(force) {
    if (!state.summaryPromise || force) {
      state.summaryPromise = fetchSummary(!force);
    }
    return state.summaryPromise;
  }

  /** The plan's limits (packages, photos, service areas, analytics days) from the one summary request, or null. */
  async function getPlanLimits() {
    const model = await getSummary(false);
    return model?.subscription?.limits || state.plan?.limits || null;
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

  /** The step the headline button points at, or null when there is nothing to push. */
  function heroNextStep(model, noProfile) {
    if (noProfile) {
      return { key: 'business-details', label: 'Create your profile', href: '' };
    }
    const step = pickPrimaryStep(state.steps);
    if (step) {
      return step;
    }
    const strip = stripFor(model?.verification);
    return strip?.action === 'verify'
      ? { key: 'get-approved', label: 'Get verified', href: '' }
      : null;
  }

  /** The headline button when no next step claims it: inbox, first package, or nothing. */
  function heroFallbackStep(model) {
    if (model?.messages?.unread) {
      return { key: 'inbox', label: 'Open your inbox', href: '/messenger/' };
    }
    if (model?.packages?.total === 0 && model?.verification?.approved !== false) {
      return { key: 'first-package', label: 'Create a package', href: '' };
    }
    return null;
  }

  /** True when a banner already carries the button for this step, so the headline button steps aside. */
  function bannerOwnsStep(next, model) {
    const strip = stripFor(model?.verification);
    const task = stepAction(next).action;
    return (
      (task === 'resend-email' && emailVerifiedFlag(state.user, model) === false) ||
      (task === 'verify' && Boolean(strip) && strip.action === 'verify')
    );
  }

  /** Points the headline button at the most useful next thing, or hides it. */
  function renderPrimaryButton(primary, model, noProfile) {
    const next = heroNextStep(model, noProfile);
    // Two filled buttons for one job is noise, so a banner that owns the task wins.
    const target = next && bannerOwnsStep(next, model) ? null : next || heroFallbackStep(model);
    primary.hidden = !target;
    if (target) {
      setStepLink(primary, target);
    }
  }

  /** Shows or hides a "view public profile" link and points it at the public path. */
  function setPublicLink(node, show, publicPath) {
    if (!node) {
      return;
    }
    node.hidden = !show;
    if (show) {
      node.setAttribute('href', publicPath);
    }
  }

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
      renderPrimaryButton(primary, model, noProfile);
    }
    const publicPath = model?.profile?.publicProfilePath || '';
    const showPublic = Boolean(publicPath) && model?.verification?.approved !== false && !noProfile;
    setPublicLink(byId(ids.secondary), showPublic, publicPath);
    setPublicLink(byId(ids.viewPublic), showPublic, publicPath);
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
    // Setup comes before polish: the banner is only offered when nothing else is left.
    const nextCheck =
      open.find(check => !isPolishStep({ key: `profile-${check.id || ''}` })) || open[0];
    const nextKey = `profile-${nextCheck?.id || ''}`;
    const sub = nextCheck
      ? `Next: <a class="sdh-link" href="#profile-card"${stepAttrs({ key: nextKey })}>${esc(stepLabel(nextKey, String(nextCheck.label || 'Complete your profile'), false).toLowerCase())}</a>`
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

  /**
   * Summary tile: the plan and how much of it is used. A failed payment drops what the supplier may
   * use to the free plan, but the plan they pay for is still Pro or Pro Plus, so the tile says that
   * and that the payment failed (the same as the plan card), never "Starter".
   */
  function planTile(model) {
    const subscription = model?.subscription;
    const link = '<a class="sdh-link" href="/supplier/subscription">Manage plan</a>';
    if (!subscription) {
      return tile(
        'Plan',
        `<p class="sdh-tile__value sdh-tile__value--empty">Not available</p><p class="sdh-tile__sub">${link}</p>`
      );
    }
    if (String(subscription.status || '').toLowerCase() === 'past_due') {
      // The paid plan is in the subscription record, which loads just after the summary.
      const paid = state.billing?.record?.plan;
      return tile(
        'Plan',
        `<p class="sdh-tile__value">${esc(paid ? planLabel(paid) : 'Past due')}</p><p class="sdh-tile__sub">Payment failed.</p><p class="sdh-tile__sub">${link}</p>`
      );
    }
    const usage = packageUsage(model);
    const limit = packageLimit(model);
    const meter =
      limit && usage
        ? bar(((model.packages.counted ?? model.packages.active) / limit) * 100, usage)
        : '';
    return tile(
      'Plan',
      `<p class="sdh-tile__value">${esc(planLabel(subscription.plan))}</p>${meter}${usage ? `<p class="sdh-tile__sub">${esc(usage)}</p>` : ''}<p class="sdh-tile__sub">${link}</p>`
    );
  }

  /**
   * How this period's enquiries compare with the one before, in words: "Up 250% on the 30 days
   * before.", "None in the 30 days before." or "Same as the 30 days before."; '' when the server did
   * not say what the earlier period held.
   */
  function enquiryTrend(asked, days) {
    if (!asked || asked.fresh === null || asked.previous === null) {
      return '';
    }
    const span = days || SUMMARY_DAYS;
    if (asked.previous === 0) {
      return asked.fresh === 0
        ? `None in this or the ${span} days before.`
        : `None in the ${span} days before.`;
    }
    const change = Math.round(((asked.fresh - asked.previous) / asked.previous) * 100);
    if (change === 0) {
      return `Same as the ${span} days before.`;
    }
    return `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change)}% on the ${span} days before.`;
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
    const asked = model?.enquiries;
    if (asked && asked.fresh !== null) {
      items.push(
        `<div class="sdh-stat"><p class="sdh-stat__label">Enquiries, last ${model.views?.days || model.windowDays || SUMMARY_DAYS} days</p><p class="sdh-stat__value">${asked.fresh.toLocaleString('en-GB')}</p><p class="sdh-stat__note">${esc(enquiryTrend(asked, model.views?.days || model.windowDays))}${asked.requestsReceived ? ` <button type="button" class="sdh-link" data-sdh-action="open-enquiries">View ${esc(plural(asked.requestsNew || 0, 'new request'))}</button>` : ''}</p></div>`
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
      // On a phone the second row of numbers folds into "More numbers"; on a wide screen it is just there.
      const phone = Boolean(window.matchMedia && window.matchMedia('(max-width: 767px)').matches);
      extra.innerHTML = `<details class="sdh-summary__more"${phone ? '' : ' open'}><summary class="sdh-more__summary">More numbers</summary><div class="sdh-summary__extra-grid">${rows}</div></details>`;
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

  /**
   * An accessible bar chart as inline SVG. `key` picks the series (views or enquiries) and `noun`
   * names one unit for the labels. Only drawn when the server sent a daily series.
   */
  function chartSvg(daily, days, key, noun, label, nouns) {
    const series = key || 'views';
    const word = noun || 'visit';
    const width = 560;
    const height = 140;
    const gap = 2;
    // Each day has an even slot of the width and its bar sits in the middle of it, at most
    // 28 wide, so a week with one busy day still reads as a chart and not as one slab.
    const slot = width / daily.length;
    const barWidth = Math.max(2, Math.min(slot - gap, 28));
    const peak = Math.max(1, ...daily.map(item => item[series] || 0));
    const total = daily.reduce((sum, item) => sum + (item[series] || 0), 0);
    const bars = daily
      .map((item, index) => {
        const value = item[series] || 0;
        const barHeight = Math.max(value > 0 ? 2 : 0, Math.round((value / peak) * (height - 4)));
        const text = `${formatShortDate(item.date) || item.date}: ${plural(value, word, nouns)}`;
        return `<rect class="sdh-chart__bar${series === 'enquiries' ? ' sdh-chart__bar--alt' : ''}" x="${(index * slot + (slot - barWidth) / 2).toFixed(1)}" y="${height - barHeight}" width="${barWidth.toFixed(1)}" height="${barHeight}" rx="1.5"><title>${esc(text)}</title></rect>`;
      })
      .join('');
    const first = formatShortDate(daily[0].date);
    const last = formatShortDate(daily[daily.length - 1].date);
    return `<figure class="sdh-chart"><svg class="sdh-chart__svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(`${label || 'Profile visits'} per day over the last ${days} days: ${plural(total, word, nouns)} in total, busiest day ${plural(peak, word, nouns)}.`)}">${bars}</svg><figcaption class="sdh-chart__axis"><span>${esc(first)}</span><span>${esc(last)}</span></figcaption></figure>`;
  }

  /** The period buttons (7, 30, 90 days): the longer ones are off, with the reason, beyond what the plan shows. */
  function periodButtons(views) {
    const max = views.maxDays || Math.max(...PERIODS);
    const buttons = PERIODS.map(days => {
      const locked = days > max;
      const pressed = days === views.days;
      return `<button type="button" class="sdh-seg__btn" data-sdh-days="${days}" aria-pressed="${pressed}"${locked ? ` disabled title="${esc(`Your plan shows up to ${max} days`)}"` : ''}>${days} days</button>`;
    }).join('');
    return `<div class="sdh-seg" role="group" aria-label="Period shown">${buttons}</div>`;
  }

  /**
   * "From visit to reply": page loads, enquiries and the reply rate side by side, each only when
   * the server has a real value. They are separate measures (people counted once an hour, requests
   * and conversations), so the card says it is not a conversion rate.
   */
  function funnelHtml(model) {
    const steps = [];
    const views = model?.views;
    if (views && views.total !== null) {
      steps.push(
        `<li><strong>${views.total.toLocaleString('en-GB')}</strong> profile page loads</li>`
      );
    }
    const asked = model?.enquiries;
    if (asked && asked.fresh !== null) {
      steps.push(
        `<li><strong>${asked.fresh.toLocaleString('en-GB')}</strong> enquiries (${esc(plural(asked.conversations || 0, 'conversation'))}, ${esc(plural(asked.quoteRequests || 0, 'quote request'))}, ${esc(plural(asked.contactForm || 0, 'contact message'))})</li>`
      );
    }
    const reply = replyMetric(model?.responses);
    if (reply && reply.repliedPct !== null) {
      steps.push(
        `<li><strong>${reply.repliedPct}%</strong> of ${esc(plural(reply.sampleSize, 'recent conversation'))} replied to</li>`
      );
    }
    if (steps.length < 2) {
      return '';
    }
    return `<div class="sdh-funnel"><p class="sdh-plan__head">From visit to reply</p><ol class="sdh-funnel__list">${steps.join('')}</ol><p class="sdh-note sdh-note--foot">These are counted separately, so this is not a conversion rate.</p></div>`;
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
    // A chart of all-zero bars is a blank block with two dates; the "No visits yet" note says it better.
    const body =
      views.total > 0 && views.daily.length >= 2 ? chartSvg(views.daily, views.days) : '';
    const hasEnquirySeries =
      views.daily.length >= 2 &&
      views.daily.some(item => item.enquiries !== null && item.enquiries > 0);
    const enquiryChart = hasEnquirySeries
      ? `<p class="sdh-plan__head">Enquiries per day</p>${chartSvg(views.daily, views.days, 'enquiries', 'enquiry', 'Enquiries', 'enquiries')}`
      : '';
    const empty =
      views.total === 0
        ? '<p class="sdh-note">No visits yet. Your profile appears in search once it is approved.</p>'
        : '';
    const shorter =
      views.requestedDays > views.days
        ? `<p class="sdh-note">Your plan shows the last ${views.days} days. <a class="sdh-link" href="/pricing">See plans</a> for longer history.</p>`
        : '';
    const foot =
      views.description || 'Counts page loads, not people. Your own visits are not counted.';
    box.innerHTML = `${periodButtons(views)}<p class="sdh-metric"><span class="sdh-metric__value">${views.total.toLocaleString('en-GB')}</span><span class="sdh-metric__unit"> ${views.total === 1 ? 'visit' : 'visits'}</span></p>${body}${enquiryChart}${funnelHtml(state.model)}${empty}${shorter}<p class="sdh-note sdh-note--foot">${esc(foot)}</p>`;
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
    const areas = limitOf(limits?.maxServiceAreas);
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
    if (areas) {
      lines.push(`Up to ${plural(areas, 'extra area')} you serve`);
    }
    if (analytics) {
      lines.push(`${analytics} days of visit history`);
    }
    // Only what the plan really includes is listed: a flag that is false or missing is left out.
    [
      ['priorityListing', 'Priority listing'],
      ['prioritySupport', 'Priority support'],
      ['customBranding', 'Custom branding'],
      ['homepageCarousel', 'Homepage carousel'],
      ['apiAccess', 'API access'],
    ].forEach(([key, text]) => {
      if (limits && limits[key] === true) {
        lines.push(text);
      }
    });
    return lines;
  }

  const CARD_BRANDS = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'Amex',
    discover: 'Discover',
    diners: 'Diners',
    jcb: 'JCB',
    unionpay: 'UnionPay',
  };

  /** "£29.00" from an amount in pence and a currency code; '' when either is not usable. */
  function formatMoney(pence, currency) {
    if (!isNum(pence) || pence <= 0) {
      return '';
    }
    try {
      return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: String(currency || 'gbp').toUpperCase(),
      }).format(pence / 100);
    } catch {
      return '';
    }
  }

  /** "Annual" / "Monthly" for the record's billing interval, or "" when it is not known. */
  function intervalLabel(record) {
    if (record.billingInterval === 'year') {
      return 'Annual';
    }
    return record.billingInterval === 'month' ? 'Monthly' : '';
  }

  /** The "Trial ends" and "Trial left" rows for a trialing record (none when it is not trialing). */
  function trialRows(record, today) {
    const trialEnd = record.trialEnd ? new Date(record.trialEnd) : null;
    if (record.status !== 'trialing' || !trialEnd || Number.isNaN(trialEnd.getTime())) {
      return [];
    }
    const rows = [{ label: 'Trial ends', value: formatDate(trialEnd) }];
    // Whole calendar days (UTC), so a trial that ends later today reads "Ends today", not "1 day".
    const days = Math.round(
      (Date.UTC(trialEnd.getUTCFullYear(), trialEnd.getUTCMonth(), trialEnd.getUTCDate()) -
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) /
        86400000
    );
    if (days > 0) {
      rows.push({ label: 'Trial left', value: plural(days, 'day') });
    } else if (days === 0) {
      rows.push({ label: 'Trial left', value: 'Ends today' });
    }
    return rows;
  }

  /** The "Payment method" row ("Visa ending 4242"), or null when the card is not known. */
  function paymentMethodRow(billing) {
    const brand = typeof billing.brand === 'string' ? billing.brand : '';
    if (!brand || !billing.last4) {
      return null;
    }
    const name =
      CARD_BRANDS[brand.toLowerCase()] || `${brand.charAt(0).toUpperCase()}${brand.slice(1)}`;
    return { label: 'Payment method', value: `${name} ending ${billing.last4}` };
  }

  /** The "Discount" row ("20% off (Launch)"), or null when the record has no discount. */
  function discountRow(record) {
    if (!record.discountName) {
      return null;
    }
    const percent =
      isNum(record.discountPercent) && record.discountPercent > 0
        ? `${record.discountPercent}% off`
        : 'Applied';
    return { label: 'Discount', value: `${percent} (${record.discountName})` };
  }

  /** The one sentence about the end of the period: renews, downgrades to another plan, or cancels. */
  function periodNotice(record, pending) {
    const end = formatDate(record.currentPeriodEnd);
    if (!end) {
      return null;
    }
    if (record.cancelAtPeriodEnd && pending && pending !== 'free') {
      return { tone: 'warn', text: `Downgrades to ${planLabel(pending)} on ${end}` };
    }
    if (record.cancelAtPeriodEnd) {
      return { tone: 'warn', text: `Cancels on ${end}` };
    }
    return { tone: 'ok', text: `Renews on ${end}` };
  }

  /** The "Next payment" row, unless billing ends with this period or no invoice is known. */
  function nextPaymentRow(billing, billingEnds) {
    const invoice = billing.invoice;
    const next = invoice ? formatMoney(invoice.amount, invoice.currency) : '';
    return next && !billingEnds ? { label: 'Next payment', value: next } : null;
  }

  /**
   * The billing facts for the plan card, from the subscription record only: billing interval,
   * trial end and days left, start date, next payment, card on file, discount, and one sentence
   * about what happens at the end of the period (renews, downgrades to another plan, or cancels).
   * `billing` is { record, brand, last4, invoice: { amount, currency } | null }. Nothing is
   * invented: a fact the record does not have is not listed.
   */
  function billingDetails(billing, now) {
    const record = billing?.record;
    const result = { interval: '', rows: [], notice: null, plan: '' };
    if (!record) {
      return result;
    }
    const today = now && typeof now.getTime === 'function' ? now : new Date();
    const pending = typeof record.pendingPlan === 'string' ? record.pendingPlan : '';
    const billingEnds = Boolean(record.cancelAtPeriodEnd) && (!pending || pending === 'free');
    const started = formatDate(record.createdAt);
    result.plan = typeof record.plan === 'string' ? record.plan : '';
    result.interval = intervalLabel(record);
    result.rows = [
      ...trialRows(record, today),
      started ? { label: 'Started', value: started } : null,
      nextPaymentRow(billing, billingEnds),
      paymentMethodRow(billing),
      discountRow(record),
    ].filter(Boolean);
    result.notice = periodNotice(record, pending);
    return result;
  }

  /** The pill text for a paid plan's status. */
  function planPillText(status, pastDue) {
    if (status === 'trialing') {
      return 'Trial';
    }
    if (pastDue) {
      return 'Past due';
    }
    return status && status !== 'active' ? status : 'Active';
  }

  /** The pill modifier class for a paid plan's status. */
  function planPillClass(status, pastDue) {
    if (status === 'active' || status === 'trialing') {
      return ' sdh-pill--accent';
    }
    return pastDue ? ' sdh-pill--warn' : '';
  }

  /** The status and interval pills after the plan name (none for the free plan). */
  function planStatusPill(status, pastDue, details) {
    const interval = details.interval
      ? `<span class="sdh-pill">${esc(details.interval)}</span>`
      : '';
    return `<span class="sdh-pill${planPillClass(status, pastDue)}">${esc(planPillText(status, pastDue))}</span>${interval}`;
  }

  /** The end-of-period line: the record's own sentence, else one from the summary's end date. */
  function periodLine(subscription, details, paid) {
    if (details.notice) {
      return details.notice.text;
    }
    const until = formatDate(subscription.activeUntil);
    if (!paid || !until) {
      return '';
    }
    return subscription.cancelAtPeriodEnd ? `Ends on ${until}` : `Renews on ${until}`;
  }

  /** The plan card's fact lines: end of period (not for a failed payment), billing facts, package usage. */
  function planFactRows(subscription, details, paid, pastDue) {
    const rows = [];
    const period = pastDue ? '' : periodLine(subscription, details, paid);
    if (period) {
      rows.push(period);
    }
    details.rows.forEach(row => rows.push(`${row.label}: ${row.value}`));
    const usage = packageUsage(state.model);
    if (usage) {
      rows.push(usage);
    }
    return rows;
  }

  /** A bulleted list of plain-text lines, or "" for none. */
  function factList(lines, extraClass) {
    return lines.length
      ? `<ul class="sdh-facts${extraClass}">${lines.map(row => `<li>${esc(row)}</li>`).join('')}</ul>`
      : '';
  }

  /** The "Included" heading and list for what the plan includes, or "" for none. */
  function includedList(lines) {
    return lines.length
      ? `<p class="sdh-plan__head">Included</p>${factList(lines, ' sdh-facts--muted')}`
      : '';
  }

  /** The plan card's action row: manage billing for a paid plan, see plans otherwise. */
  function planActions(paid, pastDue) {
    if (paid) {
      return `<button type="button" class="sdh-btn sdh-btn--secondary sdh-btn--sm" data-sdh-action="billing">${pastDue ? 'Update payment method' : 'Manage billing'}</button><a class="sdh-link" href="/supplier/subscription">View subscription</a>`;
    }
    return `<a class="sdh-btn ${isNoProfile() ? 'sdh-btn--secondary' : 'sdh-btn--primary'} sdh-btn--sm" href="/pricing">See plans</a>`;
  }

  /**
   * Draws the plan card: the plan, its status, what happens at the end of the period, the billing
   * facts from the subscription record, what the plan includes, and billing actions. A payment that
   * failed drops the entitlement to the free plan, so the card shows the plan the supplier pays
   * for (from the record) with the failed payment, never "Starter".
   */
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
    const status = String(subscription.status || '').toLowerCase();
    const details = billingDetails(state.billing);
    const pastDue = status === 'past_due';
    const planKey = pastDue && details.plan ? details.plan : subscription.plan;
    const label = planLabel(planKey);
    const paid = pastDue || String(planKey || 'free').toLowerCase() !== 'free';
    const notice = pastDue
      ? `<div class="sdh-callout sdh-callout--danger"><p class="sdh-callout__title">Payment failed</p><p class="sdh-callout__text">Your last payment for ${esc(label)} did not go through, so paid features are paused. Update your payment method to restore them; we will also try the payment again.</p></div>`
      : '';
    const rows = planFactRows(subscription, details, paid, pastDue);
    const included = pastDue ? [] : limitLines(subscription.limits);
    const statusPill = paid ? planStatusPill(status, pastDue, details) : '';
    box.innerHTML = `<div class="sdh-plan"><p class="sdh-plan__name">${esc(label)} ${statusPill}</p>${notice}${factList(rows, '')}${includedList(included)}<div class="sdh-plan__actions">${planActions(paid, pastDue)}</div></div>`;
  }

  /**
   * Loads the billing details the plan card shows beyond the summary (interval, start date, next
   * payment, card on file, discount, scheduled downgrade) once, from the subscription record. A
   * supplier on the free plan with no failed payment has none, so nothing is requested.
   */
  async function loadBilling() {
    if (state.billingRequested) {
      return;
    }
    const subscription = state.model?.subscription || state.plan;
    const status = String(subscription?.status || '').toLowerCase();
    const plan = String(subscription?.plan || 'free').toLowerCase();
    if (!subscription || (plan === 'free' && status !== 'past_due')) {
      return;
    }
    state.billingRequested = true;
    const own = await ownSubscription();
    const record = objectOrNull(own.data?.subscription);
    if (!record) {
      return;
    }
    let invoice = null;
    if (record.stripeSubscriptionId) {
      const upcoming = await getJson('/api/v2/subscriptions/upcoming-invoice');
      invoice = upcoming.data?.upcomingInvoice || null;
    }
    state.billing = {
      record,
      brand: own.data.paymentMethodBrand || '',
      last4: own.data.paymentMethodLast4 || '',
      invoice,
    };
    renderPlan();
    // The summary tile names the paid plan of a past-due supplier from this same record.
    renderSummary();
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
      const target = navigableUrl(result.data.url);
      if (!result.ok || !target) {
        throw new Error(result.data.error || 'Could not open the billing portal.');
      }
      window.location.href = target;
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

  /**
   * The button or link for a tip. The server names the tip (`id`) and gives a link that is only a
   * fragment of this page, so the tip is mapped to what the page can really do: open the profile
   * editor on a field, open the package editor, open Request a review, or go to the page that has
   * the setting. Anything that maps to none of those, and has no same-site link, gets no action.
   */
  function tipActionHtml(tip) {
    const label = tip?.action?.label;
    if (!label) {
      return '';
    }
    const known = {
      'add-desc': { action: 'edit-profile', focus: 'sup-long' },
      'add-photos': { action: 'edit-profile', focus: 'sup-photo-drop' },
      'add-package': { action: 'new-package' },
      'get-review': { action: 'request-review' },
      'add-tagline': { href: '/supplier/profile-customization' },
      'social-links': { href: '/supplier/profile-customization' },
    }[String(tip.id || '')];
    if (known?.action) {
      const focus = known.focus ? ` data-sdh-focus="${esc(known.focus)}"` : '';
      return `<button type="button" class="sdh-link" data-sdh-action="${esc(known.action)}"${focus}>${esc(label)}</button>`;
    }
    const href = localHref(known ? known.href : tip.action.href);
    if (href && !href.startsWith('#toggle-') && href !== '#my-suppliers') {
      return `<a class="sdh-link" href="${esc(href)}">${esc(label)}</a>`;
    }
    return '';
  }

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
    const tips = Array.isArray(result.data.tips) ? result.data.tips.filter(tip => tip?.title) : [];
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
        const action = tipActionHtml(tip);
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
  const requestView = { filter: '', showAll: false, open: false };
  const REQUESTS_SHOWN = 5;

  /** The rows of the request history that match the status filter, newest first as the server sent them. */
  function filterRequests(items, filter) {
    return filter ? items.filter(item => item.status === filter) : items;
  }

  /**
   * The history of review requests as a real <details>: the counts (total, still open, completed,
   * needing attention), a status filter, and the rows with who was asked, what happened, why a
   * failed one failed and when a retry is possible. The first few rows show; "Show all" the rest.
   */
  function renderReviewRequests() {
    const box = byId(ids.reviewRequests);
    if (!box) {
      return;
    }
    const all = Array.isArray(reviewRequests.items) ? reviewRequests.items : [];
    if (!all.length) {
      box.innerHTML = '';
      return;
    }
    const summary = reviewRequests.summary || {};
    const counts = [
      ['Requests', count(summary.total)],
      ['Waiting', count(summary.active)],
      ['Completed', count(summary.completed)],
      ['Needs attention', count(summary.deliveryIssues)],
    ]
      .filter(([, value]) => value !== null)
      .map(([label, value]) => `<li><strong>${value}</strong> ${esc(label.toLowerCase())}</li>`)
      .join('');
    const rows = filterRequests(all, requestView.filter);
    const shown = requestView.showAll ? rows : rows.slice(0, REQUESTS_SHOWN);
    const options = [['', 'All requests']]
      .concat(Object.entries(REQUEST_STATUS))
      .map(
        ([value, label]) =>
          `<option value="${esc(value)}"${value === requestView.filter ? ' selected' : ''}>${esc(label)}</option>`
      )
      .join('');
    const list = shown
      .map(item => {
        const when = formatDate(
          item.completedAt || item.openedAt || item.sentAt || item.failedAt || item.createdAt
        );
        const retry = item.retryable
          ? `<button type="button" class="sdh-link" data-sdh-action="retry-request" data-request="${esc(item.id)}">${item.status === 'completed' ? 'Request again' : 'Retry'}</button>`
          : '';
        const wait =
          !item.retryable && item.retryAt && formatDate(item.retryAt)
            ? `<p class="sdh-list__meta">You can ask again on ${esc(formatDate(item.retryAt))}.</p>`
            : '';
        const reason =
          item.status === 'failed' && item.lastError
            ? `<p class="sdh-list__meta sdh-list__meta--bad">${esc(item.lastError)}</p>`
            : '';
        const who = item.customerName || item.customerEmail || '';
        const email =
          item.customerName && item.customerEmail
            ? `<p class="sdh-list__meta">${esc(item.customerEmail)}</p>`
            : '';
        return `<li class="sdh-list__row"><div class="sdh-list__main"><p class="sdh-list__title">${esc(who)}</p>${email}<p class="sdh-list__meta">${esc(REQUEST_STATUS[item.status] || 'Unknown')}${when ? ` · ${esc(when)}` : ''}</p>${reason}${wait}</div>${retry}</li>`;
      })
      .join('');
    const more =
      !requestView.showAll && rows.length > REQUESTS_SHOWN
        ? `<button type="button" class="sdh-link" data-sdh-action="show-all-requests">Show all ${rows.length}</button>`
        : '';
    const empty = rows.length ? '' : '<p class="sdh-note">No requests with that status.</p>';
    box.innerHTML = `<details class="sdh-more sdh-rreq-history"${requestView.open ? ' open' : ''}><summary class="sdh-more__summary">Review requests${count(summary.deliveryIssues) ? ` (${count(summary.deliveryIssues)} need attention)` : ''}</summary><ul class="sdh-inline-counts">${counts}</ul><div class="sdh-field sdh-rreq-history__filter"><label class="sdh-label" for="rreq-filter">Show</label><select id="rreq-filter" class="sdh-input">${options}</select></div>${empty}<ul class="sdh-list">${list}</ul>${more}</details>`;
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
    const path = state.model?.profile?.publicProfilePath || '';
    const linkField = byId('rreq-link-field');
    const linkInput = byId('rreq-profile-link');
    if (linkField && linkInput) {
      linkField.hidden = !path;
      linkInput.value = path ? new URL(path, window.location.origin).href : '';
    }
    openDialog(dialog);
    byId('rreq-email')?.focus();
  }

  /** Copies the public profile link, or selects it so the supplier can copy it by hand. */
  async function copyProfileLink() {
    const input = byId('rreq-profile-link');
    if (!input || !input.value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(input.value);
      toast('Profile link copied.', 'success');
    } catch {
      input.focus();
      input.select();
      toast('Press Ctrl+C (Cmd+C on a Mac) to copy the selected link.', 'info');
    }
  }

  /** A plain sentence for a refused review request: unverified email, unapproved profile, or already asked. */
  function reviewRequestError(result) {
    const code = result.data?.code;
    if (code === 'EMAIL_NOT_VERIFIED') {
      return 'Verify your email address before you ask for reviews.';
    }
    if (code === 'SUPPLIER_NOT_APPROVED') {
      return 'You can ask for reviews once your profile has been approved.';
    }
    if (result.status === 409) {
      return result.data?.error || 'You have already asked this customer.';
    }
    return result.data?.error || 'Could not send the request. Please try again.';
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
        status.textContent = reviewRequestError(result);
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
        result.ok ? 'Review request sent again.' : reviewRequestError(result),
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
    // A card folded up on a phone opens when something sends the supplier to it.
    const fold = node.closest('details.sdh-fold') || node.querySelector('details.sdh-fold');
    if (fold) {
      fold.open = true;
    }
    node.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: block || 'start',
    });
  }

  /**
   * Opens a profile or package editor dialog by pressing its toggle (app.js fills the form and
   * supplier-dashboard-overlays.js opens the dialog), then focuses a field in it.
   */
  function openForm(sectionId, toggleId, focusId) {
    const section = byId(sectionId);
    const toggle = byId(toggleId);
    if (!section || !toggle) {
      return;
    }
    const overlays = window.SupplierDashboardOverlays;
    const name = sectionId === 'profile-form-section' ? 'profile' : 'package';
    if (!overlays?.isOpen(name) && !toggle.disabled) {
      toggle.click();
    }
    const field = focusId ? byId(focusId) : null;
    window.setTimeout(() => {
      if (field) {
        field.scrollIntoView({ block: 'center' });
        field.focus({ preventScroll: true });
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

  /** Scrolls to the profile card and puts focus on its photo button. */
  function focusAvatarUpload() {
    const card = byId('my-suppliers');
    const button =
      card?.querySelector('[data-action="upload-photo"]') ||
      card?.querySelector('label[for^="supplier-profile-photo-upload"]');
    if (card) {
      scrollToNode(card, 'center');
    }
    button?.focus({ preventScroll: true });
  }

  /** Scrolls to the node a button names with data-sdh-target. */
  function scrollToTarget(node) {
    const target = byId(node.dataset.sdhTarget || '');
    if (target) {
      scrollToNode(target, 'start');
    }
  }

  /** Scrolls to the support ticket button and opens it. */
  function openSupportTicket() {
    const ticket = byId('createSupplierTicketBtn');
    if (ticket) {
      scrollToNode(ticket, 'center');
      ticket.click();
    }
  }

  /** Wraps a handler so the link's own navigation is cancelled before it runs. */
  function handled(handler) {
    return (node, event) => {
      event.preventDefault();
      handler(node);
    };
  }

  /** What each data-sdh-action does. A handler gets the clicked node, and the click event if it needs it. */
  const ACTION_HANDLERS = {
    'edit-profile': handled(node =>
      openForm('profile-form-section', 'toggle-profile-form', node.dataset.sdhFocus || 'sup-name')
    ),
    'new-package': handled(() =>
      openForm('package-form-section', 'toggle-package-form', 'pkg-title')
    ),
    'upload-avatar': handled(focusAvatarUpload),
    scroll: handled(scrollToTarget),
    'copy-profile-link': () => copyProfileLink(),
    'show-all-requests': () => {
      requestView.showAll = true;
      renderReviewRequests();
    },
    'open-enquiries': () => document.dispatchEvent(new CustomEvent('sdh:open-enquiries')),
    verify: handled(() => openVerification()),
    'resend-email': handled(node => resendVerification(node)),
    'request-review': handled(() => openReviewDialog()),
    support: handled(openSupportTicket),
    billing: node => openBilling(node),
    'save-availability': node => saveAvailability(node),
    'retry-availability': () => loadAvailability(),
    'retry-tips': () => loadTips(),
    'reload-packages': () => window._efLoadPackages?.(),
    'retry-request': node => retryReviewRequest(node),
    reload: () => refresh(),
  };

  /** Runs one of the page's data-sdh-action buttons. */
  function runAction(node, event) {
    const action = node.dataset.sdhAction;
    if (Object.hasOwn(ACTION_HANDLERS, action)) {
      ACTION_HANDLERS[action](node, event);
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
      const periodButton = target.closest?.('[data-sdh-days]');
      if (periodButton) {
        if (!periodButton.disabled) {
          setPeriod(Number(periodButton.dataset.sdhDays));
        }
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
    document.addEventListener('change', event => {
      if (event.target?.id === 'rreq-filter') {
        requestView.filter = event.target.value;
        requestView.showAll = false;
        renderReviewRequests();
        byId('rreq-filter')?.focus();
      }
    });
    document.addEventListener(
      'toggle',
      event => {
        if (event.target?.matches?.('details.sdh-rreq-history')) {
          requestView.open = event.target.open;
        }
      },
      true
    );
    byId(ids.reviewForm)?.addEventListener('submit', submitReviewRequest);
    document.querySelectorAll('dialog.sdh-dialog').forEach(dialog => {
      dialog.addEventListener('click', event => {
        // A click on the backdrop lands on the dialog element itself.
        // The editors (data-overlay) ask before throwing away edits, so a stray click outside them does not close them.
        if (
          event.target === dialog &&
          dialog.id !== 'sdh-confirm-dialog' &&
          !dialog.hasAttribute('data-overlay')
        ) {
          closeDialog(dialog);
        }
      });
    });
    document.addEventListener('sdh:suppliers', event => {
      if (event.detail?.failed) {
        // The profile list could not be loaded: say nothing about whether there is a profile, and
        // let the summary (which decides for itself) go ahead.
        state.markSuppliersKnown();
        return;
      }
      state.suppliers = event.detail?.suppliers || [];
      state.markSuppliersKnown();
      applyProfileMode();
      startProfileLoaders();
      renderAll();
      initReviews();
      // The profile was created after the summary was skipped: ask for it now.
      if (state.skippedSummary && !isNoProfile()) {
        refresh();
      }
    });
    document.addEventListener('sdh:changed', () => {
      refresh();
    });
    window.addEventListener('unreadCountUpdated', event => {
      // The unread count the messenger reports is live: keep the tile and the greeting in step with it.
      const unread = count(event.detail?.count);
      if (state.model && unread !== null) {
        const messages = state.model.messages || {
          unread: null,
          conversations: null,
          latestAt: '',
        };
        if (messages.unread !== unread) {
          state.model.messages = {
            ...messages,
            unread,
            conversations: unread === 0 ? 0 : messages.conversations,
          };
          renderSummary();
          renderHero();
        }
      }
    });
  }

  /** Deep links from the public profile and from emails: #photos, #packages, #profile. */
  function handleDeepLink() {
    const hash = window.location.hash.slice(1);
    if (hash === 'photos') {
      openForm('profile-form-section', 'toggle-profile-form', 'sup-photo-drop');
    } else if (hash === 'reviews' || hash === 'review-requests') {
      const card = byId('sdh-reviews');
      if (card) {
        scrollToNode(card, 'start');
      }
    } else if (hash === 'verification') {
      openVerification();
    } else if (hash === 'enquiries') {
      document.dispatchEvent(new CustomEvent('sdh:open-enquiries'));
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
    state.messenger = new MessengerWidgetV4(ids.messenger, {
      maxItems: 20,
      broadcastUnread: false,
    });
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

  /**
   * Redraws everything that depends on the summary. Until the first load has finished the cards
   * keep their loading placeholders: drawing an error before the request has even been sent would
   * announce a failure that has not happened.
   */
  function renderAll() {
    applyProfileMode();
    if (!state.loaded) {
      return;
    }
    state.steps = resolveSteps(state.model, {
      emailVerified: emailVerifiedFlag(state.user, state.model),
    });
    renderHero();
    renderSummary();
    renderSteps();
    renderStrip();
    renderVisits();
    renderPlan();
    syncTierBadge();
    initReviews();
    loadBilling();
    document.dispatchEvent(new CustomEvent('sdh:rendered'));
  }

  /** Shows the page for another period (7, 30 or 90 days): asks the server for that window and redraws. */
  async function setPeriod(days) {
    if (!PERIODS.includes(days) || days === state.days) {
      return;
    }
    state.days = days;
    const box = byId(ids.chart);
    box?.setAttribute('aria-busy', 'true');
    await refresh();
    box?.removeAttribute('aria-busy');
    // Redrawing replaced the buttons: put keyboard focus back on the one that was chosen.
    byId(ids.chart)?.querySelector(`[data-sdh-days="${days}"]`)?.focus();
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
    state.loaded = true;
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
    // Availability, tips and review requests are all about a profile: a supplier who has none
    // would only collect 404s (which the site's fetch wrapper shows as error toasts).
    state.suppliersKnown.then(startProfileLoaders);
    initMessenger();
    initReviews();
  }

  /** What other page scripts (the setup guide) may read: who is signed in and what the page shows. */
  function getContext() {
    return {
      user: state.user,
      model: state.model,
      steps: state.steps,
      noProfile: isNoProfile(),
      loaded: state.loaded,
      failed: state.failed,
    };
  }

  /** Starts the requests that need a profile, once, and only when there is one. */
  function startProfileLoaders() {
    if (state.loadersStarted || isNoProfile()) {
      return;
    }
    state.loadersStarted = true;
    loadAvailability();
    loadTips();
    loadReviewRequests();
  }

  window.SupplierDashboardHome = {
    getSummary,
    getPackageAllowance,
    getPlanLimits,
    refresh,
    confirm: confirmAction,
    getContext,
    getJson,
    enquiryTrend,
    sendJson,
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
    billingDetails,
    localHref,
    navigableUrl,
  };

  // The summary request starts as soon as this script runs; the rest waits for the other scripts.
  begin();
  if (document.readyState === 'complete') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
