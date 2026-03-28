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
    '.sd-availability-section',
  ].join(', ');

  /* Selectors that identify the "header" portion of a card */
  const HEADER_SELECTORS = [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    '.card-header',
    '.card-title',
    '.ef-card-header',
    '.admin-card-header',
    '.sp-card-header',
    '.supplier-card-header',
    '.sd-card-header',
    '.sd-availability-header',
    '.dashboard-hero__header',
  ].join(', ');

  const BREAKPOINT = 1024;
  const STORAGE_KEY = 'ef-collapsed-cards';

  /* Inline SVG chevron — rendered at 12×12px inside the 24px button.
     The viewBox stays at "0 0 10 10" (the path coordinate space); setting
     width/height larger scales it uniformly — same 1:1 aspect ratio, no distortion. */
  const CHEVRON_SVG =
    '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5l3 3 3-3"/></svg>';

  /* ─── sessionStorage helpers ─────────────────────────────────── */
  function loadState() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn('[card-collapse] Failed to load state:', err);
      }
      return {};
    }
  }

  function saveState(state) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn('[card-collapse] Failed to save state:', err);
      }
    }
  }

  /* ─── Stable ID generation ───────────────────────────────────── */
  /* Track IDs already assigned on this page to prevent hash collisions */
  const _usedIds = new Set();

  /**
   * Generate a stable card ID from its text content + page pathname
   * rather than a fragile counter, so IDs survive page navigation
   * and card reordering.  Appends a numeric suffix on collision.
   */
  function makeCardId(card, fallbackIndex) {
    if (card.id) {
      return card.id;
    }
    try {
      const text = (card.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50);
      const path = (window.location && window.location.pathname) || '';
      /* Simple djb2-style hash */
      let hash = 5381;
      const str = `${path}|${text}`;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
        hash = hash >>> 0; /* keep unsigned 32-bit */
      }
      const base = `ef-card-${hash.toString(36)}`;
      let candidate = base;
      let suffix = 2;
      while (_usedIds.has(candidate)) {
        candidate = `${base}-${suffix++}`;
      }
      _usedIds.add(candidate);
      return candidate;
    } catch (e) {
      return `ef-card-${fallbackIndex}`;
    }
  }

  /* ─── DOM helpers ────────────────────────────────────────────── */

  /**
   * Wraps everything inside `card` AFTER the detected header element in a
   * `.card-body-collapsible` div.  Header detection order:
   *   1. First direct child matching HEADER_SELECTORS
   *   2. First element child (original fallback)
   * Idempotent — skips if wrapper already exists.
   * Returns false when there is nothing meaningful to wrap.
   */
  function wrapCardBody(card) {
    if (card.querySelector(':scope > .card-body-collapsible')) {
      return true;
    }

    /* Count real element children (exclude the injected button) */
    const elementChildren = Array.from(card.children).filter(
      el => !el.classList.contains('card-collapse-btn')
    );
    if (elementChildren.length < 2) {
      return false;
    }

    /* Identify header: prefer explicit header selectors, fall back to first child */
    let headerEl = null;
    for (const el of elementChildren) {
      if (el.matches(HEADER_SELECTORS)) {
        headerEl = el;
        break;
      }
    }
    if (!headerEl) {
      headerEl = elementChildren[0];
    }

    /* Collect all siblings that come after the header (across all childNodes) */
    const toWrap = [];
    let pastHeader = false;
    for (const node of Array.from(card.childNodes)) {
      if (node.classList && node.classList.contains('card-collapse-btn')) {
        continue;
      }
      if (node === headerEl) {
        pastHeader = true;
        continue;
      }
      if (pastHeader) {
        toWrap.push(node);
      }
    }

    if (toWrap.length === 0) {
      return false;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'card-body-collapsible';
    card.insertBefore(wrapper, toWrap[0]);
    toWrap.forEach(n => wrapper.appendChild(n));
    return true;
  }

  /* ─── Height-driven animation helpers ────────────────────────── */

  /**
   * Animate a wrapper to zero height and then set display:none so
   * it is fully removed from grid/flex layout (no empty column artifact).
   * A fallback timeout ensures the final state is applied even if
   * transitionend fails to fire (e.g. hidden element, interrupted transition).
   */
  function collapseWrapper(wrapper, onDone) {
    /* Cancel any pending fallback from a previous animation */
    if (wrapper._animationTimer) {
      clearTimeout(wrapper._animationTimer);
      wrapper._animationTimer = null;
    }
    if (wrapper._animationHandler) {
      wrapper.removeEventListener('transitionend', wrapper._animationHandler);
      wrapper._animationHandler = null;
    }

    /* Capture actual rendered height as the start value */
    wrapper.style.maxHeight = `${wrapper.scrollHeight}px`;
    wrapper.style.display = '';
    /* Force reflow so the browser sees the start value */
    void wrapper.offsetHeight;
    /* Animate toward zero */
    wrapper.style.maxHeight = '0';
    wrapper.style.opacity = '0';

    const finish = () => {
      clearTimeout(wrapper._animationTimer);
      wrapper._animationTimer = null;
      wrapper.removeEventListener('transitionend', handler);
      wrapper.style.display = 'none';
      if (onDone) {
        onDone();
      }
    };

    const handler = e => {
      if (e.propertyName !== 'max-height') {
        return;
      }
      finish();
    };
    wrapper._animationHandler = handler;
    wrapper.addEventListener('transitionend', handler);
    /* Fallback: 350ms > 300ms CSS transition */
    wrapper._animationTimer = setTimeout(finish, 350);
  }

  /**
   * Remove display:none, measure content height, then animate in.
   * Fallback timeout ensures max-height is cleared even if transitionend
   * doesn't fire.
   */
  function expandWrapper(wrapper, onDone) {
    /* Cancel any pending fallback */
    if (wrapper._animationTimer) {
      clearTimeout(wrapper._animationTimer);
      wrapper._animationTimer = null;
    }
    if (wrapper._animationHandler) {
      wrapper.removeEventListener('transitionend', wrapper._animationHandler);
      wrapper._animationHandler = null;
    }

    /* Make the element participate in layout again */
    wrapper.style.display = '';
    /* Force layout so scrollHeight is accurate */
    void wrapper.offsetHeight;

    const targetH = wrapper.scrollHeight;

    /* Start from invisible */
    wrapper.style.maxHeight = '0';
    wrapper.style.opacity = '0';
    /* Another reflow to establish the start state for CSS transition */
    void wrapper.offsetHeight;

    /* Animate to full height */
    wrapper.style.maxHeight = `${targetH}px`;
    wrapper.style.opacity = '1';

    const finish = () => {
      clearTimeout(wrapper._animationTimer);
      wrapper._animationTimer = null;
      wrapper.removeEventListener('transitionend', handler);
      /* Remove the inline max-height so the wrapper can grow naturally
         if its content changes (images load, accordions open, etc.) */
      wrapper.style.maxHeight = '';
      if (onDone) {
        onDone();
      }
    };

    const handler = e => {
      if (e.propertyName !== 'max-height') {
        return;
      }
      finish();
    };
    wrapper._animationHandler = handler;
    wrapper.addEventListener('transitionend', handler);
    /* Fallback: 350ms > 300ms CSS transition */
    wrapper._animationTimer = setTimeout(finish, 350);
  }

  /* ─── Per-card initialisation ─────────────────────────────────── */
  function initCard(card, index, state) {
    /* Idempotent guard */
    if (card.querySelector(':scope > .card-collapse-btn')) {
      return;
    }

    /* Skip cards inside modals — they're not candidates for collapsing */
    if (card.closest('.modal, .modal-dialog')) {
      return;
    }

    /* Skip cards with explicit opt-out */
    if (card.classList.contains('no-collapse')) {
      return;
    }

    /* Skip cards nested inside another already-collapsible card */
    const ancestor = card.parentElement && card.parentElement.closest('.card-collapsible');
    if (ancestor) {
      return;
    }

    /* Skip very small cards — not worth collapsing */
    const rect = card.getBoundingClientRect();
    if (rect.height > 0 && rect.height < 100) {
      return;
    }

    /* Mark as collapsible + positioning context */
    card.classList.add('card-collapsible');
    card.style.position = 'relative';

    /* Wrap body content (everything after header element) */
    const wrapped = wrapCardBody(card);
    if (!wrapped) {
      /* Nothing to collapse — undo the class we just added */
      card.classList.remove('card-collapsible');
      card.style.position = '';
      return;
    }

    const wrapper = card.querySelector(':scope > .card-body-collapsible');
    if (!wrapper) {
      card.classList.remove('card-collapsible');
      card.style.position = '';
      return;
    }

    /* Assign a stable ID for state persistence */
    const id = makeCardId(card, index);
    if (!card.id) {
      card.id = id;
    }

    /* Create toggle button */
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-collapse-btn';
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = CHEVRON_SVG;
    /* Inline style fallbacks — CSS can be overridden by page-level specificity,
       but inline styles guarantee the button is correctly sized, positioned, and
       stacked even in edge cases (e.g. a stylesheet with higher specificity sets
       width/position/z-index on buttons inside a specific card type).
       minHeight/maxHeight clamp overrides from `button { min-height: 44px }`
       rules in ui-ux-fixes.css and admin-enhanced.css.
       top/right/zIndex are repeated inline so the button stays in the correct
       top-right position and on top even if card-collapse.css fails to load or
       is overridden by a later-loaded stylesheet. */
    btn.style.position = 'absolute';
    btn.style.top = '8px';
    btn.style.right = '8px';
    btn.style.zIndex = '10';
    btn.style.width = '24px';
    btn.style.height = '24px';
    btn.style.minHeight = '24px';
    btn.style.maxHeight = '24px';
    btn.style.minWidth = '24px';
    btn.style.maxWidth = '24px';
    btn.style.padding = '0';

    /* Prepend; absolute positioning places it at top-right visually */
    card.insertBefore(btn, card.firstChild);

    /* Restore persisted expand state (no animation on page load).
     *
     * State encoding (counter-intuitive but intentional):
     *   state[id] === false  → user explicitly EXPANDED this card in the current session
     *   state[id] undefined  → no override; use the DEFAULT = collapsed
     *
     * Why `false` for "expanded"?
     *   Using `false` (rather than `true`) as the "expanded" sentinel means any
     *   legacy sessionStorage values written as `true` (from a previous version of
     *   this code) are automatically ignored, giving a clean all-collapsed reset on
     *   the first load after deploy.  Subsequent sessions within the same tab remember
     *   user-expanded cards via `false`, while the collapsed (default) state is stored
     *   by simply deleting the key. */
    if (state[id] === false) {
      /* User previously expanded this card — show it open */
      card.classList.remove('card--collapsed');
      btn.setAttribute('aria-expanded', 'true');
      btn.setAttribute('aria-label', 'Collapse card');
      wrapper.style.maxHeight = '';
      wrapper.style.opacity = '';
      wrapper.style.display = '';
    } else {
      /* No persisted state (or any non-false value) — start collapsed (the default) */
      card.classList.add('card--collapsed');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', 'Expand card');
      wrapper.style.maxHeight = '0';
      wrapper.style.opacity = '0';
      wrapper.style.display = 'none';
      /* Throb breadcrumb: animate button to hint the card is expandable.
       * Only on the initial page-load collapse (no saved expanded state). */
      btn.dataset.throb = '1';
    }

    /* Click handler — guarded against rapid clicks via _animating flag */
    const clickHandler = e => {
      e.stopPropagation();
      if (card._animating) {
        return;
      }
      card._animating = true;

      const collapsed = card.classList.toggle('card--collapsed');
      btn.setAttribute('aria-expanded', String(!collapsed));
      btn.setAttribute('aria-label', collapsed ? 'Expand card' : 'Collapse card');

      /* Remove throb as soon as the user expands the card — they now
       * know the card is interactive; no need to hint again. */
      if (!collapsed) {
        delete btn.dataset.throb;
      }

      const onDone = () => {
        card._animating = false;
      };

      if (collapsed) {
        collapseWrapper(wrapper, onDone);
      } else {
        expandWrapper(wrapper, onDone);
      }

      const current = loadState();
      if (collapsed) {
        /* Collapsed = default state; delete key so absent entry → collapsed */
        delete current[id];
      } else {
        /* Expanded = exception to default; store false as the "user opened this" marker */
        current[id] = false;
      }
      saveState(current);
    };

    /* Store reference so teardown can remove it cleanly */
    btn._clickHandler = clickHandler;
    btn.addEventListener('click', clickHandler);
  }

  /* ─── Bulk initialisation ─────────────────────────────────────── */
  let _cardCounter = 0;

  function initAllCards() {
    if (window.innerWidth > BREAKPOINT) {
      return;
    }
    const state = loadState();
    document.querySelectorAll(CARD_SELECTORS).forEach(card => {
      initCard(card, _cardCounter++, state);
    });
  }

  /* ─── Teardown when viewport grows above breakpoint ──────────── */
  function teardownAllCards() {
    document.querySelectorAll('.card-collapsible').forEach(card => {
      const btn = card.querySelector(':scope > .card-collapse-btn');
      if (btn) {
        /* Clean up event listener before removal */
        if (btn._clickHandler) {
          btn.removeEventListener('click', btn._clickHandler);
          btn._clickHandler = null;
        }
        btn.remove();
      }

      const wrapper = card.querySelector(':scope > .card-body-collapsible');
      if (wrapper) {
        /* Cancel any pending animation timers */
        if (wrapper._animationTimer) {
          clearTimeout(wrapper._animationTimer);
          wrapper._animationTimer = null;
        }
        if (wrapper._animationHandler) {
          wrapper.removeEventListener('transitionend', wrapper._animationHandler);
          wrapper._animationHandler = null;
        }
        /* Ensure wrapper is visible before unwrapping */
        wrapper.style.maxHeight = '';
        wrapper.style.opacity = '';
        wrapper.style.display = '';
        /* Move children back into card */
        while (wrapper.firstChild) {
          card.insertBefore(wrapper.firstChild, wrapper);
        }
        wrapper.remove();
      }

      card._animating = false;
      card.classList.remove('card-collapsible', 'card--collapsed');
      card.style.position = '';
    });
  }

  /* ─── MutationObserver: catch dynamically added cards ─────────── */
  function observeDynamicCards() {
    if (typeof MutationObserver === 'undefined') {
      return;
    }

    const mo = new MutationObserver(mutations => {
      if (window.innerWidth > BREAKPOINT) {
        return;
      }
      const state = loadState();
      mutations.forEach(m => {
        /* Only process mutations that add element nodes */
        if (m.type !== 'childList') {
          return;
        }
        m.addedNodes.forEach(node => {
          if (node.nodeType !== 1) {
            return;
          }
          /* Only process nodes that are or contain card elements */
          const isCard = node.matches && node.matches(CARD_SELECTORS);
          const hasCards = node.querySelectorAll && node.querySelector(CARD_SELECTORS);
          if (!isCard && !hasCards) {
            return;
          }
          if (isCard) {
            initCard(node, _cardCounter++, state);
          }
          if (hasCards) {
            node.querySelectorAll(CARD_SELECTORS).forEach(card => {
              initCard(card, _cardCounter++, state);
            });
          }
        });
      });
    });

    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ─── Responsive re-check (debounced) ───────────────────────── */
  let _resizeTimer = null;
  let _mobileActive = window.innerWidth <= BREAKPOINT;

  function onResize() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
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

  /* ─── Public API ─────────────────────────────────────────────── */
  window.cardCollapseInit = initAllCards;
  window.cardCollapseTeardown = teardownAllCards;

  /* ─── Bootstrap ─────────────────────────────────────────────── */
  function bootstrap() {
    initAllCards();
    observeDynamicCards();
    window.addEventListener('resize', onResize);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
