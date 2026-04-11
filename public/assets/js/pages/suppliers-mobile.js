/**
 * Suppliers Page — Mobile UX Enhancements
 *
 * Handles:
 *  1. Advanced filter toggle (aria-expanded, aria-controls, active-filter badge,
 *     sessionStorage state persistence, smooth CSS max-height animation)
 *  2. Package carousel touch-swipe (delegates to existing arrow-button click handlers)
 *
 * This script is intentionally kept free of ES module syntax so it can be loaded
 * with a plain `<script defer>` tag alongside the module-based suppliers-init.js.
 *
 * Mobile breakpoint: 640px — must match the CSS @media (max-width: 640px) rule in
 * suppliers-page.css. Both values are in sync; update both if the breakpoint changes.
 */

(function () {
  'use strict';

  /* ────────────────────────────────────────────────────────
     Constants
  ──────────────────────────────────────────────────────── */

  /** sessionStorage key for persisting the panel open/closed state */
  var STORAGE_KEY = 'sp_adv_open';

  /** Must match the CSS @media (max-width: 640px) breakpoint in suppliers-page.css */
  var MOBILE_BP = 640;

  /** IDs of the inputs that live inside the advanced panel (used for badge count) */
  var ADVANCED_FILTER_IDS = [
    'filterEventType',
    'filterDistance',
    'filterPrice',
    'filterRating',
    'filterSort',
    'filterVerified',
  ];

  /* ────────────────────────────────────────────────────────
     Helpers
  ──────────────────────────────────────────────────────── */

  function isMobile() {
    return window.innerWidth <= MOBILE_BP;
  }

  function readStorage() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === 'true';
    } catch (_) {
      return false;
    }
  }

  function writeStorage(val) {
    try {
      sessionStorage.setItem(STORAGE_KEY, String(val));
    } catch (_) {
      /* ignore — storage unavailable (private mode etc.) */
    }
  }

  /* ────────────────────────────────────────────────────────
     Advanced filter panel toggle
  ──────────────────────────────────────────────────────── */

  function initAdvancedFilterToggle() {
    var toggle = document.getElementById('sp-adv-toggle');
    var panel  = document.getElementById('sp-advanced-filters');
    var badge  = document.getElementById('sp-adv-badge');

    if (!toggle || !panel) {
      return; /* panel not in DOM — nothing to do */
    }

    var isOpen = false;

    /* ── Badge: count active advanced filters ── */

    function countActiveAdvanced() {
      var count = 0;
      ADVANCED_FILTER_IDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) { return; }
        if (el.type === 'checkbox') {
          if (el.checked) { count++; }
        } else if (el.value && el.value !== '' && el.value !== 'relevance') {
          count++;
        }
      });
      return count;
    }

    function refreshBadge() {
      if (!badge) { return; }
      var n = countActiveAdvanced();
      if (n > 0) {
        badge.textContent = String(n);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }

    /* ── Open / close the panel ── */

    function setOpen(open, animate) {
      isOpen = open;

      /* Apply or remove the open state */
      panel.classList.toggle('is-open', open);

      /* Update ARIA on the toggle button */
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Hide advanced filters' : 'Show advanced filters');

      /* Swap the button label text */
      var labelEl = toggle.querySelector('.sp-adv-toggle-label');
      if (labelEl) {
        labelEl.textContent = open ? 'Less filters' : 'More filters';
      }

      /* Persist to sessionStorage (only when we're actually on mobile) */
      if (isMobile()) {
        writeStorage(open);
      }

      /*
       * Move keyboard focus into the panel when opening so the user can
       * immediately interact with the newly revealed controls.
       * preventScroll avoids the page jumping when the panel expands.
       * A small delay lets the CSS max-height transition begin first.
       */
      if (open && animate) {
        setTimeout(function () {
          var firstControl = panel.querySelector('select, input');
          if (firstControl) {
            firstControl.focus({ preventScroll: true });
          }
        }, 60);
      }
    }

    /* ── Enable CSS transition after first interaction ── */
    /*
     * We add the animation class only after the page has loaded (so there
     * is no unstyled-content flash on load) and only when the panel is
     * about to change state for the first time.
     */
    var animationEnabled = false;
    function enableAnimation() {
      if (!animationEnabled) {
        panel.classList.add('sp-advanced-filters--animate');
        animationEnabled = true;
      }
    }

    /* ── Toggle on button click ── */

    toggle.addEventListener('click', function () {
      enableAnimation();
      setOpen(!isOpen, true);
    });

    /* ── Badge refresh on every filter change ── */

    ADVANCED_FILTER_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', refreshBadge);
        el.addEventListener('input',  refreshBadge);
      }
    });

    /* ── Handle viewport resize across the mobile breakpoint ── */

    var wasMobile = isMobile();

    window.addEventListener('resize', function () {
      var nowMobile = isMobile();
      if (nowMobile === wasMobile) { return; }
      wasMobile = nowMobile;

      if (!nowMobile) {
        /*
         * Crossed from mobile to desktop: remove any open state so the
         * display:contents CSS rule can take full effect cleanly.
         */
        panel.classList.remove('is-open', 'sp-advanced-filters--animate');
        toggle.setAttribute('aria-expanded', 'false');
        isOpen = false;
        animationEnabled = false;
      } else {
        /* Crossed from desktop back to mobile: restore persisted state */
        var stored = readStorage();
        setOpen(stored, false);
      }
    }, { passive: true });

    /* ── Initial state on page load ── */

    if (isMobile()) {
      /*
       * On mobile, restore the previously-saved open/closed state.
       * We do NOT animate here to avoid a jarring expand on page load.
       * If the user had the panel open last time they visited the page
       * the panel opens silently so their filter context is preserved.
       */
      setOpen(readStorage(), false);
    }
    /* On tablet/desktop the toggle is hidden via CSS; no state needed. */

    refreshBadge();
  }

  /* ────────────────────────────────────────────────────────
     Package carousel — touch swipe support
  ──────────────────────────────────────────────────────── */

  function initCarouselSwipe() {
    /*
     * Delegate touch events on the document level so this works for
     * cards that are dynamically injected by suppliers-init.js after
     * the initial search results load.
     *
     * When a horizontal swipe is detected inside a .sp-pkg-carousel,
     * we programmatically click the appropriate arrow button so the
     * existing carousel logic in suppliers-init.js handles the scroll.
     */

    var touchStartX   = 0;
    var touchStartY   = 0;
    var activeCarousel = null;

    /** Minimum horizontal distance (px) to count as a swipe */
    var SWIPE_THRESHOLD_X = 40;
    /** Maximum vertical drift allowed — prevents conflict with page scroll */
    var SWIPE_MAX_Y = 60;

    document.addEventListener('touchstart', function (e) {
      var carousel = e.target.closest('.sp-pkg-carousel');
      if (!carousel) { return; }
      touchStartX    = e.touches[0].clientX;
      touchStartY    = e.touches[0].clientY;
      activeCarousel = carousel;
    }, { passive: true });

    document.addEventListener('touchend', function (e) {
      if (!activeCarousel) { return; }

      var dx = e.changedTouches[0].clientX - touchStartX;
      var dy = e.changedTouches[0].clientY - touchStartY;

      /* Reset regardless of whether we act */
      var carousel = activeCarousel;
      activeCarousel = null;

      /* Ignore mostly-vertical swipes (user is likely scrolling the page) */
      if (Math.abs(dy) > SWIPE_MAX_Y) { return; }

      if (Math.abs(dx) < SWIPE_THRESHOLD_X) { return; }

      /* Left-swipe → advance to next card; right-swipe → go back */
      var arrowSelector = dx < 0
        ? '.sp-pkg-arrow--next:not([disabled])'
        : '.sp-pkg-arrow--prev:not([disabled])';

      var btn = carousel.querySelector(arrowSelector);
      if (btn) {
        btn.click();
      }
    }, { passive: true });
  }

  /* ────────────────────────────────────────────────────────
     Initialise
  ──────────────────────────────────────────────────────── */

  function init() {
    initAdvancedFilterToggle();
    initCarouselSwipe();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
