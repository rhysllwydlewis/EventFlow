/**
 * Homepage mobile sign-up CTA
 *
 * Adds a visible, auth-aware sign-up action to the mobile header while
 * retaining separate Log in and Create account actions inside the burger menu.
 * Supports the shared V1/V3 navbar and the V2 navbar.
 */
(function () {
  'use strict';

  if (window.__efHomeMobileSignupInitialised) {
    return;
  }
  window.__efHomeMobileSignupInitialised = true;

  const SIGNUP_URL = '/auth?tab=create';
  const NUDGE_STORAGE_KEY = 'eventflow_home_mobile_signup_nudge_seen_v1';
  const NUDGE_DELAY_MS = 650;
  const NUDGE_FALLBACK_MS = 4300;

  const sharedHeader = document.querySelector('.ef-header');
  const v2Header = document.querySelector('.hv2-header');
  const mode = sharedHeader ? 'shared' : v2Header ? 'v2' : null;

  if (!mode) {
    return;
  }

  function ensureStylesheet() {
    if (document.getElementById('ef-home-mobile-signup-css')) {
      return;
    }

    const link = document.createElement('link');
    link.id = 'ef-home-mobile-signup-css';
    link.rel = 'stylesheet';
    link.href = '/assets/css/home-mobile-signup.css?v=1.0.0';
    document.head.appendChild(link);
  }

  function createLink({ id, className, label, source }) {
    const link = document.createElement('a');
    link.id = id;
    link.className = className;
    link.href = SIGNUP_URL;
    link.textContent = label;
    link.dataset.mobileSignupSource = source;
    link.setAttribute('aria-label', 'Create a free EventFlow account');
    link.hidden = true;
    return link;
  }

  function ensureSharedElements() {
    const actions = sharedHeader.querySelector('.ef-header-actions');
    const toggle = sharedHeader.querySelector('#ef-mobile-toggle');
    const mobileAuth = document.getElementById('ef-mobile-auth');
    const mobileNav = sharedHeader.querySelector('.ef-mobile-nav');

    if (!actions || !toggle || !mobileNav || !mobileAuth) {
      return null;
    }

    let headerCta = document.getElementById('ef-mobile-signup-cta');
    if (!headerCta) {
      headerCta = createLink({
        id: 'ef-mobile-signup-cta',
        className: 'ef-btn ef-btn-primary ef-home-mobile-signup',
        label: 'Sign up',
        source: 'header',
      });
      actions.insertBefore(headerCta, toggle);
    }

    let menuCta = document.getElementById('ef-mobile-signup-menu');
    if (!menuCta) {
      menuCta = createLink({
        id: 'ef-mobile-signup-menu',
        className: 'ef-mobile-link ef-mobile-primary ef-home-mobile-signup-menu',
        label: 'Create free account',
        source: 'menu',
      });
      mobileNav.insertBefore(menuCta, mobileAuth);
    }

    mobileAuth.classList.remove('ef-mobile-primary');
    mobileAuth.classList.add('ef-home-mobile-login');

    return { headerCta, menuCta, mediaQuery: '(max-width: 767px)' };
  }

  function ensureV2Elements() {
    const actions = v2Header.querySelector('.hv2-actions');
    const toggle = v2Header.querySelector('.hv2-menu');
    const mobileNav = document.getElementById('hv2-mobile-nav');
    const mobileLogin = mobileNav && mobileNav.querySelector('.hv2-mobile-login');

    if (!actions || !toggle || !mobileNav || !mobileLogin) {
      return null;
    }

    let headerCta = document.getElementById('hv2-mobile-signup-cta');
    if (!headerCta) {
      headerCta = createLink({
        id: 'hv2-mobile-signup-cta',
        className: 'hv2-button hv2-button--solid hv2-home-mobile-signup',
        label: 'Sign up',
        source: 'header',
      });
      actions.insertBefore(headerCta, toggle);
    }

    let menuCta = document.getElementById('hv2-mobile-signup-menu');
    if (!menuCta) {
      menuCta = createLink({
        id: 'hv2-mobile-signup-menu',
        className: 'hv2-mobile-signup-menu',
        label: 'Create free account',
        source: 'menu',
      });
      mobileNav.insertBefore(menuCta, mobileLogin);
    }

    mobileLogin.classList.add('hv2-home-mobile-login');

    return { headerCta, menuCta, mediaQuery: '(max-width: 960px)' };
  }

  function canUseStorage() {
    try {
      const probe = '__ef_signup_probe__';
      sessionStorage.setItem(probe, '1');
      sessionStorage.removeItem(probe);
      return true;
    } catch (_) {
      return false;
    }
  }

  function hasSeenNudge(storageAvailable) {
    if (!storageAvailable) {
      return false;
    }
    try {
      return sessionStorage.getItem(NUDGE_STORAGE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function markNudgeSeen(storageAvailable) {
    if (!storageAvailable) {
      return;
    }
    try {
      sessionStorage.setItem(NUDGE_STORAGE_KEY, '1');
    } catch (_) {
      // Ignore storage failures in private or restricted browsing modes.
    }
  }

  ensureStylesheet();
  const elements = mode === 'shared' ? ensureSharedElements() : ensureV2Elements();
  if (!elements) {
    return;
  }

  const { headerCta, menuCta, mediaQuery } = elements;
  const storageAvailable = canUseStorage();
  let nudgeTimer = null;
  let fallbackTimer = null;
  let nudgeStarted = false;

  function stopNudge() {
    if (nudgeTimer) {
      window.clearTimeout(nudgeTimer);
      nudgeTimer = null;
    }
    if (fallbackTimer) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    headerCta.classList.remove('is-nudging');
  }

  function shouldNudge() {
    if (nudgeStarted || hasSeenNudge(storageAvailable)) {
      return false;
    }

    if (typeof window.matchMedia !== 'function') {
      return false;
    }

    const isMobile = window.matchMedia(mediaQuery).matches;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return isMobile && !prefersReducedMotion && !headerCta.hidden;
  }

  function startNudge() {
    if (!shouldNudge()) {
      return;
    }

    nudgeStarted = true;
    markNudgeSeen(storageAvailable);
    nudgeTimer = window.setTimeout(() => {
      nudgeTimer = null;
      if (headerCta.hidden || !document.body.contains(headerCta)) {
        return;
      }
      headerCta.classList.add('is-nudging');
      fallbackTimer = window.setTimeout(stopNudge, NUDGE_FALLBACK_MS);
    }, NUDGE_DELAY_MS);
  }

  function setLoggedOutVisibility(isLoggedOut) {
    headerCta.hidden = !isLoggedOut;
    menuCta.hidden = !isLoggedOut;
    headerCta.setAttribute('aria-hidden', String(!isLoggedOut));
    menuCta.setAttribute('aria-hidden', String(!isLoggedOut));

    if (isLoggedOut) {
      startNudge();
    } else {
      stopNudge();
    }
  }

  ['click', 'focus', 'pointerdown'].forEach(eventName => {
    headerCta.addEventListener(eventName, stopNudge, { once: true });
  });
  headerCta.addEventListener('animationend', stopNudge);

  function syncUser(user) {
    setLoggedOutVisibility(!user);
  }

  const authManager = window.AuthStateManager || window.__authState;
  if (authManager && typeof authManager.subscribe === 'function') {
    authManager.subscribe(({ user }) => syncUser(user || null));
  }

  if (authManager && typeof authManager.init === 'function') {
    authManager
      .init()
      .then(result => syncUser(result && result.user ? result.user : null))
      .catch(() => syncUser(null));
  } else {
    syncUser(null);
  }

  window.addEventListener('__auth-state-updated', event => {
    syncUser(event.detail && event.detail.user ? event.detail.user : null);
  });
})();
