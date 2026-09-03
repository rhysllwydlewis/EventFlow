/**
 * Suppliers Page — Mobile UX Enhancements
 *
 * Handles:
 *  1. Advanced filter toggle (aria-expanded, aria-controls, active-filter badge,
 *     sessionStorage state persistence, smooth CSS max-height animation)
 *  2. Package carousel touch-swipe (delegates to existing arrow-button click handlers)
 *  3. Focused suppliers-page polish: stylesheet loading, GBP price formatting,
 *     compact package fallbacks, responsive carousel alignment, and accessible
 *     description expansion.
 *
 * This script is intentionally kept free of ES module syntax so it can be loaded
 * with a plain `<script defer>` tag alongside the module-based suppliers-init.js.
 *
 * Mobile breakpoint: 640px — must match the CSS @media (max-width: 640px) rule in
 * suppliers-page.css. Both values are in sync; update both if the breakpoint changes.
 */

'use strict';
(function () {
  /* ────────────────────────────────────────────────────────
     Constants
  ──────────────────────────────────────────────────────── */

  /** sessionStorage key for persisting the panel open/closed state */
  const STORAGE_KEY = 'sp_adv_open';

  /** Must match the CSS @media (max-width: 640px) breakpoint in suppliers-page.css
   *  AND the MOBILE_BP constant in public/assets/js/pages/suppliers-init.js.
   *  ⚠ If this value changes, update all three locations. */
  const MOBILE_BP = 640;

  /** Focused polish layer, isolated from the shared/global stylesheet stack. */
  const POLISH_STYLESHEET_ID = 'suppliers-mobile-polish-styles';
  const POLISH_STYLESHEET_HREF = '/assets/css/suppliers-mobile-polish.css?v=19.3.1';

  /** IDs of the inputs that live inside the advanced panel (used for badge count) */
  const ADVANCED_FILTER_IDS = [
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

  function loadPolishStylesheet(onReady) {
    const runReady = () => {
      if (typeof onReady === 'function') {
        requestAnimationFrame(onReady);
      }
    };

    const existing = document.getElementById(POLISH_STYLESHEET_ID);
    if (existing) {
      if (existing.sheet) {
        runReady();
      } else {
        existing.addEventListener('load', runReady, { once: true });
        existing.addEventListener('error', runReady, { once: true });
      }
      return;
    }

    const link = document.createElement('link');
    link.id = POLISH_STYLESHEET_ID;
    link.rel = 'stylesheet';
    link.href = POLISH_STYLESHEET_HREF;
    link.addEventListener('load', runReady, { once: true });
    link.addEventListener('error', runReady, { once: true });
    document.head.appendChild(link);
  }

  function formatPriceAsGBP(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.includes('£')) {
      return raw;
    }

    const numericMatch = raw.replace(/,/g, '').match(/^\d+(?:\.\d{1,2})?$/);
    if (!numericMatch) {
      return raw;
    }

    const amount = Number(numericMatch[0]);
    if (!Number.isFinite(amount)) {
      return raw;
    }

    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  function enhancePackagePrice(priceEl) {
    if (!priceEl || priceEl.dataset.spCurrencyFormatted === 'true') {
      return;
    }

    const formatted = formatPriceAsGBP(priceEl.textContent);
    if (formatted) {
      priceEl.textContent = formatted;
    }
    priceEl.dataset.spCurrencyFormatted = 'true';
  }

  function getVisibleCarouselIndex(track, items) {
    if (!track || items.length === 0) {
      return 0;
    }

    const transformMatch = String(track.style.transform || '').match(
      /translateX\(\s*(-?\d+(?:\.\d+)?)px\s*\)/
    );
    if (!transformMatch) {
      return 0;
    }

    const firstItem = items[0];
    const gap = Number.parseFloat(window.getComputedStyle(track).columnGap) || 0;
    const step = firstItem.getBoundingClientRect().width + gap;
    if (!step) {
      return 0;
    }

    const offset = Math.abs(Number.parseFloat(transformMatch[1]) || 0);
    return Math.min(items.length - 1, Math.max(0, Math.round(offset / step)));
  }

  function syncCarouselMediaHeight(carousel) {
    if (!carousel) {
      return;
    }

    const track = carousel.querySelector('.sp-pkg-carousel-track');
    const items = track ? [...track.querySelectorAll('.sp-pkg-mini')] : [];
    if (!track || items.length === 0) {
      return;
    }

    const visibleIndex = getVisibleCarouselIndex(track, items);
    const thumb = items[visibleIndex]?.querySelector('.sp-pkg-mini-thumb');
    const mediaHeight = thumb?.getBoundingClientRect().height || 0;
    if (!mediaHeight) {
      return;
    }

    const cssValue = `${Math.round(mediaHeight)}px`;
    if (carousel.style.getPropertyValue('--sp-active-media-height') !== cssValue) {
      carousel.style.setProperty('--sp-active-media-height', cssValue);
    }
  }

  function syncPackageFallback(thumb) {
    if (!thumb) {
      return;
    }

    const image = thumb.querySelector('.sp-pkg-mini-img');
    const fallback = thumb.querySelector('.sp-pkg-mini-img-fallback');
    const imageVisible =
      image &&
      !image.hidden &&
      window.getComputedStyle(image).display !== 'none' &&
      window.getComputedStyle(image).visibility !== 'hidden';
    const fallbackVisible =
      fallback &&
      !fallback.hidden &&
      window.getComputedStyle(fallback).display !== 'none' &&
      window.getComputedStyle(fallback).visibility !== 'hidden';

    thumb.classList.toggle(
      'sp-pkg-mini-thumb--fallback',
      Boolean(fallbackVisible || !imageVisible)
    );

    requestAnimationFrame(() => syncCarouselMediaHeight(thumb.closest('.sp-pkg-carousel')));
  }

  function getDescriptionToggle(description) {
    const sibling = description?.nextElementSibling;
    return sibling?.classList.contains('sp-description-toggle') ? sibling : null;
  }

  function syncDescriptionToggle(description) {
    if (!description || !description.parentElement) {
      return;
    }

    requestAnimationFrame(() => {
      if (!description.isConnected) {
        return;
      }

      let toggle = getDescriptionToggle(description);
      const expanded = description.classList.contains('is-expanded');
      const isClipped = description.scrollHeight > description.clientHeight + 2;

      if (!expanded && !isClipped) {
        if (toggle) {
          toggle.remove();
        }
        return;
      }

      if (!description.id) {
        const supplierId = description.closest('.sp-card')?.dataset.supplierId || 'supplier';
        description.id = `sp-description-${supplierId}-${Math.random().toString(36).slice(2, 8)}`;
      }

      if (!toggle) {
        toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'sp-description-toggle';
        description.insertAdjacentElement('afterend', toggle);
      }

      toggle.textContent = expanded ? 'Show less' : 'Show more';
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      toggle.setAttribute('aria-controls', description.id);
    });
  }

  function enhanceRenderedCards(root) {
    const scope = root && root.querySelectorAll ? root : document;

    if (scope.matches?.('.sp-pkg-mini-price')) {
      enhancePackagePrice(scope);
    }
    scope.querySelectorAll?.('.sp-pkg-mini-price').forEach(enhancePackagePrice);

    if (scope.matches?.('.sp-pkg-mini-thumb')) {
      syncPackageFallback(scope);
    }
    scope.querySelectorAll?.('.sp-pkg-mini-thumb').forEach(syncPackageFallback);

    if (scope.matches?.('.sp-card-description')) {
      syncDescriptionToggle(scope);
    }
    scope.querySelectorAll?.('.sp-card-description').forEach(syncDescriptionToggle);

    if (scope.matches?.('.sp-pkg-carousel')) {
      syncCarouselMediaHeight(scope);
    }
    scope.querySelectorAll?.('.sp-pkg-carousel').forEach(syncCarouselMediaHeight);
  }

  function initRenderedCardPolish() {
    const results = document.getElementById('results');
    if (!results) {
      return;
    }

    if (results.dataset.spPolishInitialised === 'true') {
      enhanceRenderedCards(results);
      return;
    }
    results.dataset.spPolishInitialised = 'true';

    enhanceRenderedCards(results);

    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              enhanceRenderedCards(node);
            }
          });
        }

        if (mutation.type === 'attributes') {
          const target = mutation.target;
          if (target.closest) {
            const thumb = target.closest('.sp-pkg-mini-thumb');
            if (thumb) {
              syncPackageFallback(thumb);
            }
            syncCarouselMediaHeight(target.closest('.sp-pkg-carousel'));
          }
        }
      });
    });

    observer.observe(results, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'hidden'],
    });

    document.addEventListener('click', event => {
      const toggle = event.target.closest('.sp-description-toggle');
      if (!toggle) {
        return;
      }

      const descriptionId = toggle.getAttribute('aria-controls');
      const description = descriptionId ? document.getElementById(descriptionId) : null;
      if (!description) {
        return;
      }

      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      description.classList.toggle('is-expanded', !expanded);
      toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      toggle.textContent = expanded ? 'Show more' : 'Show less';

      if (expanded) {
        syncDescriptionToggle(description);
      }
    });

    let resizeTimer;
    window.addEventListener(
      'resize',
      () => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          results.querySelectorAll('.sp-pkg-mini-thumb').forEach(syncPackageFallback);
          results.querySelectorAll('.sp-card-description').forEach(syncDescriptionToggle);
          results.querySelectorAll('.sp-pkg-carousel').forEach(syncCarouselMediaHeight);
        }, 120);
      },
      { passive: true }
    );
  }

  /* ────────────────────────────────────────────────────────
     Advanced filter panel toggle
  ──────────────────────────────────────────────────────── */

  function initAdvancedFilterToggle() {
    const toggle = document.getElementById('sp-adv-toggle');
    const panel = document.getElementById('sp-advanced-filters');
    const badge = document.getElementById('sp-adv-badge');

    if (!toggle || !panel) {
      return; /* panel not in DOM — nothing to do */
    }

    let isOpen = false;

    /* ── Badge: count active advanced filters ── */

    function countActiveAdvanced() {
      let count = 0;
      ADVANCED_FILTER_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) {
          return;
        }
        if (el.type === 'checkbox') {
          if (el.checked) {
            count++;
          }
        } else if (el.value && el.value !== '' && el.value !== 'relevance') {
          count++;
        }
      });
      return count;
    }

    function refreshBadge() {
      if (!badge) {
        return;
      }
      const n = countActiveAdvanced();
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
      const labelEl = toggle.querySelector('.sp-adv-toggle-label');
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
        setTimeout(() => {
          const firstControl = panel.querySelector('select, input');
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
    let animationEnabled = false;
    function enableAnimation() {
      if (!animationEnabled) {
        panel.classList.add('sp-advanced-filters--animate');
        animationEnabled = true;
      }
    }

    /* ── Toggle on button click ── */

    toggle.addEventListener('click', () => {
      enableAnimation();
      setOpen(!isOpen, true);
    });

    /* ── Badge refresh on every filter change ── */

    ADVANCED_FILTER_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', refreshBadge);
        el.addEventListener('input', refreshBadge);
      }
    });

    /* ── Handle viewport resize across the mobile breakpoint ── */

    let wasMobile = isMobile();

    window.addEventListener(
      'resize',
      () => {
        const nowMobile = isMobile();
        if (nowMobile === wasMobile) {
          return;
        }
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
          const stored = readStorage();
          setOpen(stored, false);
        }
      },
      { passive: true }
    );

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

    let touchStartX = 0;
    let touchStartY = 0;
    let activeCarousel = null;

    /** Minimum horizontal distance (px) to count as a swipe */
    const SWIPE_THRESHOLD_X = 40;
    /** Maximum vertical drift allowed — prevents conflict with page scroll */
    const SWIPE_MAX_Y = 60;

    document.addEventListener(
      'touchstart',
      e => {
        const carousel = e.target.closest('.sp-pkg-carousel');
        if (!carousel) {
          return;
        }
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        activeCarousel = carousel;
      },
      { passive: true }
    );

    document.addEventListener(
      'touchend',
      e => {
        if (!activeCarousel) {
          return;
        }

        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;

        /* Reset regardless of whether we act */
        const carousel = activeCarousel;
        activeCarousel = null;

        /* Ignore mostly-vertical swipes (user is likely scrolling the page) */
        if (Math.abs(dy) > SWIPE_MAX_Y) {
          return;
        }

        if (Math.abs(dx) < SWIPE_THRESHOLD_X) {
          return;
        }

        /* Left-swipe → advance to next card; right-swipe → go back */
        const arrowSelector =
          dx < 0 ? '.sp-pkg-arrow--next:not([disabled])' : '.sp-pkg-arrow--prev:not([disabled])';

        const btn = carousel.querySelector(arrowSelector);
        if (btn) {
          btn.click();
        }
      },
      { passive: true }
    );
  }

  /* ────────────────────────────────────────────────────────
     Initialise
  ──────────────────────────────────────────────────────── */

  function init() {
    initAdvancedFilterToggle();
    initCarouselSwipe();
    initRenderedCardPolish();
    loadPolishStylesheet(() => {
      const results = document.getElementById('results');
      if (results) {
        enhanceRenderedCards(results);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
