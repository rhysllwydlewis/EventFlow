/**
 * Homepage mobile sign-up CTA
 *
 * Adds a visible, auth-aware sign-up action to the mobile header while
 * retaining separate Log in and Create account actions inside the burger menu.
 * Supports the shared V1/V3 navbar and the V2 navbar.
 */
'use strict';
(function () {
  if (window.__efHomeMobileSignupInitialised) {
    return;
  }
  window.__efHomeMobileSignupInitialised = true;

  const SIGNUP_URL = '/auth?tab=create';
  const NUDGE_STORAGE_KEY = 'eventflow_home_mobile_signup_nudge_seen_v2';
  const NUDGE_DELAY_MS = 650;
  const NUDGE_FALLBACK_MS = 4300;
  const STYLESHEET_ID = 'ef-home-mobile-signup-css';
  const STYLESHEET_URL = '/assets/css/home-mobile-signup.css?v=1.2.0';
  const SHARED_HEADER_ACTIVE_CLASS = 'ef-home-mobile-signup-active';

  const sharedHeader = document.querySelector('.ef-header');
  const v2Header = document.querySelector('.hv2-header');
  const mode = sharedHeader ? 'shared' : v2Header ? 'v2' : null;

  if (!mode) {
    return;
  }

  function ensureStylesheet() {
    let link = document.getElementById(STYLESHEET_ID);

    if (!link) {
      link = document.createElement('link');
      link.id = STYLESHEET_ID;
      link.rel = 'stylesheet';
      link.href = STYLESHEET_URL;
      document.head.appendChild(link);
    }

    if (link.sheet) {
      return Promise.resolve(true);
    }

    return new Promise(resolve => {
      link.addEventListener('load', () => resolve(true), { once: true });
      link.addEventListener('error', () => resolve(false), { once: true });
    });
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
    link.setAttribute('aria-hidden', 'true');
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

    return {
      headerCta,
      menuCta,
      loginLink: mobileAuth,
      mediaQuery: '(max-width: 767px)',
    };
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

    return {
      headerCta,
      menuCta,
      loginLink: mobileLogin,
      mediaQuery: '(max-width: 960px)',
    };
  }

  const elements = mode === 'shared' ? ensureSharedElements() : ensureV2Elements();
  if (!elements) {
    return;
  }

  const { headerCta, menuCta, loginLink, mediaQuery } = elements;
  let authResolved = false;
  let stylesheetReady = false;
  let currentUser = null;
  let nudgeTimer = null;
  let fallbackTimer = null;
  let nudgeStarted = false;

  function getStorage() {
    try {
      const storage = window.localStorage;
      const probe = '__ef_signup_probe__';
      storage.setItem(probe, '1');
      storage.removeItem(probe);
      return storage;
    } catch (_) {
      return null;
    }
  }

  const storage = getStorage();

  function hasSeenNudge() {
    try {
      return storage ? storage.getItem(NUDGE_STORAGE_KEY) === '1' : false;
    } catch (_) {
      return false;
    }
  }

  function markNudgeSeen() {
    try {
      storage?.setItem(NUDGE_STORAGE_KEY, '1');
    } catch (_) {
      // Ignore storage failures in private or restricted browsing modes.
    }
  }

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
    if (nudgeStarted || hasSeenNudge() || typeof window.matchMedia !== 'function') {
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
    nudgeTimer = window.setTimeout(() => {
      nudgeTimer = null;
      if (headerCta.hidden || !document.body.contains(headerCta)) {
        return;
      }

      markNudgeSeen();
      headerCta.classList.add('is-nudging');
      fallbackTimer = window.setTimeout(stopNudge, NUDGE_FALLBACK_MS);
    }, NUDGE_DELAY_MS);
  }

  function setVisible(element, visible) {
    element.hidden = !visible;
    if (visible) {
      element.removeAttribute('aria-hidden');
    } else {
      element.setAttribute('aria-hidden', 'true');
    }
  }

  function applyLoginStyling() {
    if (mode === 'shared') {
      loginLink.classList.remove('ef-mobile-primary');
      loginLink.classList.add('ef-home-mobile-login');
      return;
    }

    loginLink.classList.add('hv2-home-mobile-login');
  }

  function setSharedHeaderSignupActive(active) {
    if (mode === 'shared') {
      sharedHeader.classList.toggle(SHARED_HEADER_ACTIVE_CLASS, active);
    }
  }

  function applyVisibility() {
    if (!authResolved || !stylesheetReady) {
      return;
    }

    const isLoggedOut = !currentUser;
    setVisible(headerCta, isLoggedOut);
    setVisible(menuCta, isLoggedOut);
    setSharedHeaderSignupActive(isLoggedOut);

    if (isLoggedOut) {
      startNudge();
    } else {
      stopNudge();
    }
  }

  function syncUser(user) {
    currentUser = user || null;
    authResolved = true;
    applyVisibility();
  }

  ['click', 'focus', 'pointerdown'].forEach(eventName => {
    headerCta.addEventListener(eventName, stopNudge);
  });
  headerCta.addEventListener('animationend', event => {
    if (event.animationName === 'ef-home-mobile-signup-glow') {
      stopNudge();
    }
  });

  ensureStylesheet().then(loaded => {
    if (!loaded) {
      setSharedHeaderSignupActive(false);
      headerCta.remove();
      menuCta.remove();
      return;
    }

    applyLoginStyling();
    stylesheetReady = true;
    applyVisibility();
  });

  const authManager = window.AuthStateManager || window.__authState;
  if (authManager && typeof authManager.subscribe === 'function') {
    authManager.subscribe(state => syncUser(state?.user || null));
  }

  if (authManager && typeof authManager.init === 'function') {
    authManager
      .init()
      .then(result => syncUser(result?.user || null))
      .catch(() => syncUser(null));
  } else {
    syncUser(null);
  }

  window.addEventListener('__auth-state-updated', event => {
    syncUser(event.detail?.user || null);
  });
})();
