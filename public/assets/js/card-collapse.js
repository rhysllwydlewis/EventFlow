/**
 * Card Collapse — Mobile toggle logic
 * Injects a collapse button into every card on viewports ≤ 1024 px.
 * Companion CSS: /assets/css/card-collapse.css
 */
(function () {
  'use strict';

  const CARD_SELECTORS = [
    '.card',
    '.ef-card',
    '.admin-card',
    '.sp-card',
    '.listing-card',
    '.stat-card',
    '.package-card',
  ].join(', ');

  const BREAKPOINT = 1024;
  const STORAGE_KEY = 'ef-collapsed-cards';

  /* ─── sessionStorage helpers ─────────────────────────────────── */
  function loadState() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[card-collapse] Failed to load state:', err);
      return {};
    }
  }

  function saveState(state) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[card-collapse] Failed to save state:', err);
    }
  }

  /* ─── DOM helpers ────────────────────────────────────────────── */

  /**
   * Returns true if `el` is a heading-like element that should stay
   * visible as the card "title" when collapsed.
   */
  function isTitleElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) return true;
    const cls = el.className || '';
    return (
      cls.includes('card-title') ||
      cls.includes('card-header') ||
      cls.includes('ef-card-header') ||
      cls.includes('admin-card-header') ||
      cls.includes('sp-card-title') ||
      cls.includes('stat-card-value') ||
      cls.includes('stat-card-label') ||
      cls.includes('package-card-title') ||
      cls.includes('listing-card-title')
    );
  }

  /**
   * Wraps everything inside `card` that is NOT the first title element
   * and NOT the collapse button itself in a `.card-body-collapsible` div.
   * Idempotent — skips if wrapper already exists.
   */
  function wrapCardBody(card) {
    if (card.querySelector('.card-body-collapsible')) return;

    const children = Array.from(card.childNodes);
    let titleFound = false;
    const toWrap = [];

    for (const node of children) {
      /* Skip the injected button */
      if (node.classList && node.classList.contains('card-collapse-btn')) continue;

      if (!titleFound && isTitleElement(node)) {
        titleFound = true;
        continue; /* keep title outside wrapper */
      }

      /* Wrap everything after the title (or everything if no title found) */
      if (titleFound || !isTitleElement(node)) {
        toWrap.push(node);
      }
    }

    if (toWrap.length === 0) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'card-body-collapsible';

    /* Insert wrapper before the first node to wrap */
    card.insertBefore(wrapper, toWrap[0]);
    toWrap.forEach((n) => wrapper.appendChild(n));
  }

  /* ─── Initialisation ─────────────────────────────────────────── */
  function initCard(card, index, state) {
    if (card.querySelector('.card-collapse-btn')) return; /* already done */

    /* Provide a stable key */
    if (!card.id) {
      card.id = 'ef-card-' + index;
    }
    const id = card.id;

    /* Make card a positioning context */
    card.classList.add('card-collapsible');
    card.style.position = 'relative';

    /* Wrap body content */
    wrapCardBody(card);

    /* Create button */
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-collapse-btn';
    btn.setAttribute('aria-label', 'Toggle card');
    btn.setAttribute('aria-expanded', 'true');
    btn.innerHTML = '<span aria-hidden="true">▾</span>';

    /* Prepend so it sits at the top of the card (absolute positioning
       takes it visually to top-right regardless of DOM order) */
    card.insertBefore(btn, card.firstChild);

    /* Restore persisted state */
    if (state[id]) {
      card.classList.add('card--collapsed');
      btn.setAttribute('aria-expanded', 'false');
    }

    /* Click handler */
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      const collapsed = card.classList.toggle('card--collapsed');
      btn.setAttribute('aria-expanded', String(!collapsed));

      const current = loadState();
      if (collapsed) {
        current[id] = true;
      } else {
        delete current[id];
      }
      saveState(current);
    });
  }

  function initAllCards() {
    if (window.innerWidth > BREAKPOINT) return;

    const state = loadState();
    const cards = document.querySelectorAll(CARD_SELECTORS);
    cards.forEach(function (card, index) {
      initCard(card, index, state);
    });
  }

  /* ─── Teardown (when viewport grows above breakpoint) ────────── */
  function teardownAllCards() {
    document.querySelectorAll('.card-collapsible').forEach(function (card) {
      /* Remove button */
      const btn = card.querySelector('.card-collapse-btn');
      if (btn) btn.remove();

      /* Unwrap body content */
      const wrapper = card.querySelector('.card-body-collapsible');
      if (wrapper) {
        while (wrapper.firstChild) {
          card.insertBefore(wrapper.firstChild, wrapper);
        }
        wrapper.remove();
      }

      /* Clean up classes / inline style */
      card.classList.remove('card-collapsible', 'card--collapsed');
      card.style.position = '';
    });
  }

  /* ─── Responsive re-check (debounced) ───────────────────────── */
  var _resizeTimer = null;
  var _mobileActive = window.innerWidth <= BREAKPOINT;

  function onResize() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function () {
      const nowMobile = window.innerWidth <= BREAKPOINT;
      if (nowMobile && !_mobileActive) {
        _mobileActive = true;
        initAllCards();
      } else if (!nowMobile && _mobileActive) {
        _mobileActive = false;
        teardownAllCards();
      }
    }, 150);
  }

  /* ─── Bootstrap ─────────────────────────────────────────────── */
  function bootstrap() {
    initAllCards();
    window.addEventListener('resize', onResize);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
