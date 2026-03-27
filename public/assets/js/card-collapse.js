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

  /* ─── DOM helpers ────────────────────────────────────────────── */

  /**
   * Wraps everything inside `card` AFTER the first element child in a
   * `.card-body-collapsible` div. The first element child acts as the
   * visible "header" when the card is collapsed.
   * Idempotent — skips if wrapper already exists.
   */
  function wrapCardBody(card) {
    if (card.querySelector(':scope > .card-body-collapsible')) {return;}

    const children = Array.from(card.childNodes);
    let headerFound = false;
    const toWrap = [];

    for (const node of children) {
      /* Skip the injected button */
      if (node.classList && node.classList.contains('card-collapse-btn')) {continue;}

      if (!headerFound) {
        /* Skip leading whitespace/text nodes */
        if (node.nodeType !== 1) {continue;}
        /* First real element = header — keep it outside the wrapper */
        headerFound = true;
        continue;
      }

      toWrap.push(node);
    }

    if (toWrap.length === 0) {return;}

    const wrapper = document.createElement('div');
    wrapper.className = 'card-body-collapsible';
    card.insertBefore(wrapper, toWrap[0]);
    toWrap.forEach((n) => wrapper.appendChild(n));
  }

  /* ─── Height-driven animation helpers ────────────────────────── */

  /**
   * Animate a wrapper to zero height and then set display:none so
   * it is fully removed from grid/flex layout (no empty column artifact).
   */
  function collapseWrapper(wrapper) {
    /* Capture actual rendered height as the start value */
    wrapper.style.maxHeight = `${wrapper.scrollHeight}px`;
    wrapper.style.display = '';
    /* Force reflow so the browser sees the start value */
    void wrapper.offsetHeight;
    /* Animate toward zero */
    wrapper.style.maxHeight = '0';
    wrapper.style.opacity = '0';

    const onEnd = (e) => {
      if (e.propertyName !== 'max-height') {return;}
      wrapper.style.display = 'none';
      wrapper.removeEventListener('transitionend', onEnd);
    };
    wrapper.addEventListener('transitionend', onEnd);
  }

  /**
   * Remove display:none, measure content height, then animate in.
   */
  function expandWrapper(wrapper) {
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

    const onEnd = (e) => {
      if (e.propertyName !== 'max-height') {return;}
      /* Remove the inline max-height so the wrapper can grow naturally
         if its content changes (images load, accordions open, etc.) */
      wrapper.style.maxHeight = '';
      wrapper.removeEventListener('transitionend', onEnd);
    };
    wrapper.addEventListener('transitionend', onEnd);
  }

  /* ─── Per-card initialisation ─────────────────────────────────── */
  function initCard(card, index, state) {
    /* Idempotent guard */
    if (card.querySelector(':scope > .card-collapse-btn')) {return;}

    /* Skip cards nested inside another already-collapsible card */
    const ancestor = card.parentElement && card.parentElement.closest('.card-collapsible');
    if (ancestor) {return;}

    /* Assign a stable ID for state persistence */
    if (!card.id) {
      card.id = `ef-card-${index}`;
    }
    const id = card.id;

    /* Mark as collapsible + positioning context */
    card.classList.add('card-collapsible');
    card.style.position = 'relative';

    /* Wrap body content (everything after first element) */
    wrapCardBody(card);

    const wrapper = card.querySelector(':scope > .card-body-collapsible');
    if (!wrapper) {return;} /* only one child — nothing to collapse */

    /* Create toggle button */
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-collapse-btn';
    btn.setAttribute('aria-label', 'Toggle card');
    btn.setAttribute('aria-expanded', 'true');
    btn.innerHTML = '<span aria-hidden="true">▾</span>';

    /* Prepend; absolute positioning places it at top-right visually */
    card.insertBefore(btn, card.firstChild);

    /* Restore persisted collapse state (no animation on page load) */
    if (state[id]) {
      card.classList.add('card--collapsed');
      btn.setAttribute('aria-expanded', 'false');
      wrapper.style.maxHeight = '0';
      wrapper.style.opacity = '0';
      wrapper.style.display = 'none';
    }

    /* Click handler */
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const collapsed = card.classList.toggle('card--collapsed');
      btn.setAttribute('aria-expanded', String(!collapsed));

      if (collapsed) {
        collapseWrapper(wrapper);
      } else {
        expandWrapper(wrapper);
      }

      const current = loadState();
      if (collapsed) {
        current[id] = true;
      } else {
        delete current[id];
      }
      saveState(current);
    });
  }

  /* ─── Bulk initialisation ─────────────────────────────────────── */
  let _cardCounter = 0;

  function initAllCards() {
    if (window.innerWidth > BREAKPOINT) {return;}
    const state = loadState();
    document.querySelectorAll(CARD_SELECTORS).forEach((card) => {
      initCard(card, _cardCounter++, state);
    });
  }

  /* ─── Teardown when viewport grows above breakpoint ──────────── */
  function teardownAllCards() {
    document.querySelectorAll('.card-collapsible').forEach((card) => {
      const btn = card.querySelector(':scope > .card-collapse-btn');
      if (btn) {btn.remove();}

      const wrapper = card.querySelector(':scope > .card-body-collapsible');
      if (wrapper) {
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

      card.classList.remove('card-collapsible', 'card--collapsed');
      card.style.position = '';
    });
  }

  /* ─── MutationObserver: catch dynamically added cards ─────────── */
  function observeDynamicCards() {
    if (typeof MutationObserver === 'undefined') {return;}

    const mo = new MutationObserver((mutations) => {
      if (window.innerWidth > BREAKPOINT) {return;}
      const state = loadState();
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) {return;}
          if (node.matches && node.matches(CARD_SELECTORS)) {
            initCard(node, _cardCounter++, state);
          }
          if (node.querySelectorAll) {
            node.querySelectorAll(CARD_SELECTORS).forEach((card) => {
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
