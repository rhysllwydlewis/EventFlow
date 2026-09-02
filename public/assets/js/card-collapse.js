/**
 * Card Collapse — Mobile toggle logic
 * Injects a collapse button into eligible cards on viewports ≤ 1024 px.
 * Companion CSS: /assets/css/card-collapse.css
 */
(function () {
  'use strict';

  const DEFAULT_CARD_SELECTORS = [
    '.card',
    '.ef-card',
    '.admin-card',
    '.sp-card',
    '.listing-card',
    '.stat-card',
    '.package-card',
  ].join(', ');

  const CUSTOMER_DASHBOARD_CARD_SELECTORS = [
    '[data-collapsible="true"]',
    '.js-collapsible-card',
  ].join(', ');

  function getCardSelectors() {
    if (document.body && document.body.classList.contains('customer-dashboard-page')) {
      return CUSTOMER_DASHBOARD_CARD_SELECTORS;
    }
    return DEFAULT_CARD_SELECTORS;
  }

  function isCollapseCandidate(card) {
    if (!card || !card.matches) {
      return false;
    }

    if (card.classList.contains('no-collapse') || card.dataset.collapse === 'false') {
      return false;
    }

    if (document.body && document.body.classList.contains('customer-dashboard-page')) {
      return card.matches(CUSTOMER_DASHBOARD_CARD_SELECTORS);
    }

    return card.matches(DEFAULT_CARD_SELECTORS);
  }

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
    '.dashboard-hero__header',
  ].join(', ');

  const BREAKPOINT = 1024;
  const STORAGE_KEY = 'ef-collapsed-cards';

  const CHEVRON_SVG =
    '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5l3 3 3-3"/></svg>';

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

  const _usedIds = new Set();

  function makeCardId(card, fallbackIndex) {
    if (card.id) {
      return card.id;
    }
    try {
      const text = (card.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50);
      const path = (window.location && window.location.pathname) || '';
      let hash = 5381;
      const str = `${path}|${text}`;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
        hash = hash >>> 0;
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

  function wrapCardBody(card) {
    if (card.querySelector(':scope > .card-body-collapsible')) {
      return true;
    }

    const elementChildren = Array.from(card.children).filter(
      el => !el.classList.contains('card-collapse-btn')
    );
    if (elementChildren.length < 2) {
      return false;
    }

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

  function collapseWrapper(wrapper, onDone) {
    if (wrapper._animationTimer) {
      clearTimeout(wrapper._animationTimer);
      wrapper._animationTimer = null;
    }
    if (wrapper._animationHandler) {
      wrapper.removeEventListener('transitionend', wrapper._animationHandler);
      wrapper._animationHandler = null;
    }

    wrapper.style.maxHeight = `${wrapper.scrollHeight}px`;
    wrapper.style.display = '';
    void wrapper.offsetHeight;
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

    function handler(e) {
      if (e.propertyName !== 'max-height') {
        return;
      }
      finish();
    }
    wrapper._animationHandler = handler;
    wrapper.addEventListener('transitionend', handler);
    wrapper._animationTimer = setTimeout(finish, 350);
  }

  function expandWrapper(wrapper, onDone) {
    if (wrapper._animationTimer) {
      clearTimeout(wrapper._animationTimer);
      wrapper._animationTimer = null;
    }
    if (wrapper._animationHandler) {
      wrapper.removeEventListener('transitionend', wrapper._animationHandler);
      wrapper._animationHandler = null;
    }

    wrapper.style.display = '';
    void wrapper.offsetHeight;

    const targetH = wrapper.scrollHeight;

    wrapper.style.maxHeight = '0';
    wrapper.style.opacity = '0';
    void wrapper.offsetHeight;

    wrapper.style.maxHeight = `${targetH}px`;
    wrapper.style.opacity = '1';

    const finish = () => {
      clearTimeout(wrapper._animationTimer);
      wrapper._animationTimer = null;
      wrapper.removeEventListener('transitionend', handler);
      wrapper.style.maxHeight = '';
      if (onDone) {
        onDone();
      }
    };

    function handler(e) {
      if (e.propertyName !== 'max-height') {
        return;
      }
      finish();
    }
    wrapper._animationHandler = handler;
    wrapper.addEventListener('transitionend', handler);
    wrapper._animationTimer = setTimeout(finish, 350);
  }

  function initCard(card, index, state) {
    if (!isCollapseCandidate(card)) {
      return;
    }

    if (card.querySelector(':scope > .card-collapse-btn')) {
      return;
    }

    if (card.closest('.modal, .modal-dialog')) {
      return;
    }

    if (card.classList.contains('no-collapse')) {
      return;
    }

    const ancestor = card.parentElement && card.parentElement.closest('.card-collapsible');
    if (ancestor) {
      return;
    }

    const rect = card.getBoundingClientRect();
    if (rect.height > 0 && rect.height < 100) {
      return;
    }

    card.classList.add('card-collapsible');
    card.style.position = 'relative';

    const wrapped = wrapCardBody(card);
    if (!wrapped) {
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

    const id = makeCardId(card, index);
    if (!card.id) {
      card.id = id;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-collapse-btn';
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = CHEVRON_SVG;
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

    card.insertBefore(btn, card.firstChild);

    // Priority cards (data-default-expanded="true") start open on a page the
    // user hasn't touched yet, so the highest-priority content on a
    // task-ordered page isn't hidden behind a tap on first visit — collapsing
    // every card equally would undo the point of ordering them by priority.
    // A stored preference always wins over the default, in either direction:
    // true = the user collapsed it, false = the user expanded it.
    const storedPref = state[id];
    const initiallyCollapsed =
      storedPref === undefined ? card.dataset.defaultExpanded !== 'true' : storedPref === true;

    // Chevron rest state (0deg) points down, rotating 180deg to point up when
    // active — the same convention .accordion-icon and .article-toc's <summary>
    // marker already use elsewhere on the site (down = closed, up = open). This
    // used to be inverted here specifically, which read as backwards next to
    // every other disclosure control on the page.
    if (!initiallyCollapsed) {
      card.classList.remove('card--collapsed');
      btn.setAttribute('aria-expanded', 'true');
      btn.setAttribute('aria-label', 'Collapse card');
      btn.style.rotate = '180deg';
      wrapper.style.maxHeight = '';
      wrapper.style.opacity = '';
      wrapper.style.display = '';
    } else {
      card.classList.add('card--collapsed');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', 'Expand card');
      btn.style.rotate = '0deg';
      wrapper.style.maxHeight = '0';
      wrapper.style.opacity = '0';
      wrapper.style.display = 'none';
      btn.dataset.throb = '1';
    }

    const clickHandler = e => {
      e.stopPropagation();
      if (card._animating) {
        return;
      }
      card._animating = true;

      const collapsed = card.classList.toggle('card--collapsed');
      btn.setAttribute('aria-expanded', String(!collapsed));
      btn.setAttribute('aria-label', collapsed ? 'Expand card' : 'Collapse card');
      btn.style.rotate = collapsed ? '0deg' : '180deg';

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

      // Store the choice explicitly in both directions now that "no entry"
      // no longer means "collapsed" for every card — some default open.
      const current = loadState();
      current[id] = collapsed;
      saveState(current);
      updateBulkToggleButton();
    };

    btn._clickHandler = clickHandler;
    btn.addEventListener('click', clickHandler);
  }

  let _cardCounter = 0;

  function initAllCards() {
    if (window.innerWidth > BREAKPOINT) {
      return;
    }
    const state = loadState();
    document.querySelectorAll(getCardSelectors()).forEach(card => {
      initCard(card, _cardCounter++, state);
    });
  }

  // True only when every collapsible card on the page is currently open —
  // a single mixed or fully-collapsed card is enough to call the aggregate
  // state "not expanded", which is what decides what the bulk button offers
  // to do next.
  function allCardsExpanded() {
    const cards = document.querySelectorAll('.card-collapsible');
    return (
      cards.length > 0 &&
      Array.from(cards).every(card => !card.classList.contains('card--collapsed'))
    );
  }

  // Keeps the single bulk button's label/aria-expanded in sync with the
  // actual aggregate state, whether that state changed via the bulk button
  // itself, an individual card's own toggle, or cards appearing/disappearing.
  function updateBulkToggleButton() {
    const btn = document.querySelector('.card-collapse-bulk-btn[data-bulk-action="toggle"]');
    if (!btn) {
      return;
    }
    const expanded = allCardsExpanded();
    const label = btn.querySelector('.card-collapse-bulk-btn__label');
    const target = label || btn;
    const text = expanded ? 'Collapse all' : 'Expand all';
    // Guard against a no-op write: `textContent = text` replaces child text
    // nodes even when the value is unchanged, which is itself a childList
    // mutation. observeDynamicCards() below calls this function on every
    // observed mutation, so an unconditional write here would have this
    // function's own DOM write re-trigger the observer forever.
    if (target.textContent !== text) {
      target.textContent = text;
    }
    if (btn.getAttribute('aria-expanded') !== String(expanded)) {
      btn.setAttribute('aria-expanded', String(expanded));
    }
  }

  // Drives every visible card to the same state by clicking its existing
  // toggle button when needed, rather than duplicating the collapse/expand/
  // persist logic — one code path stays the source of truth for what
  // "collapsed" means for a card.
  function setAllCollapsed(collapsed) {
    document.querySelectorAll('.card-collapsible').forEach(card => {
      const isCollapsed = card.classList.contains('card--collapsed');
      if (isCollapsed === collapsed) {
        return;
      }
      const btn = card.querySelector(':scope > .card-collapse-btn');
      if (btn) {
        btn.click();
      }
    });
    updateBulkToggleButton();
  }

  function initBulkActions() {
    const container = document.querySelector('.card-collapse-bulk-actions');
    if (!container || container.dataset.bound === 'true') {
      return;
    }
    container.dataset.bound = 'true';
    const toggleBtn = container.querySelector('[data-bulk-action="toggle"]');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        setAllCollapsed(allCardsExpanded());
      });
    }
    updateBulkToggleButton();
  }

  window.cardCollapseSetAll = setAllCollapsed;

  function teardownAllCards() {
    document.querySelectorAll('.card-collapsible').forEach(card => {
      const btn = card.querySelector(':scope > .card-collapse-btn');
      if (btn) {
        if (btn._clickHandler) {
          btn.removeEventListener('click', btn._clickHandler);
          btn._clickHandler = null;
        }
        btn.remove();
      }

      const wrapper = card.querySelector(':scope > .card-body-collapsible');
      if (wrapper) {
        if (wrapper._animationTimer) {
          clearTimeout(wrapper._animationTimer);
          wrapper._animationTimer = null;
        }
        if (wrapper._animationHandler) {
          wrapper.removeEventListener('transitionend', wrapper._animationHandler);
          wrapper._animationHandler = null;
        }
        wrapper.style.maxHeight = '';
        wrapper.style.opacity = '';
        wrapper.style.display = '';
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
        if (m.type !== 'childList') {
          return;
        }
        m.addedNodes.forEach(node => {
          if (node.nodeType !== 1) {
            return;
          }
          const selectors = getCardSelectors();
          const isCard = node.matches && node.matches(selectors);
          const hasCards = node.querySelectorAll && node.querySelector(selectors);
          if (!isCard && !hasCards) {
            return;
          }
          if (isCard) {
            initCard(node, _cardCounter++, state);
          }
          if (hasCards) {
            node.querySelectorAll(selectors).forEach(card => {
              initCard(card, _cardCounter++, state);
            });
          }
        });
      });
      updateBulkToggleButton();
    });

    mo.observe(document.body, { childList: true, subtree: true });
  }

  let _resizeTimer = null;
  let _mobileActive = window.innerWidth <= BREAKPOINT;

  function onResize() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      const nowMobile = window.innerWidth <= BREAKPOINT;
      if (nowMobile && !_mobileActive) {
        _mobileActive = true;
        initAllCards();
        updateBulkToggleButton();
      } else if (!nowMobile && _mobileActive) {
        _mobileActive = false;
        teardownAllCards();
      }
    }, 150);
  }

  window.cardCollapseInit = initAllCards;
  window.cardCollapseTeardown = teardownAllCards;

  function bootstrap() {
    initAllCards();
    initBulkActions();
    observeDynamicCards();
    window.addEventListener('resize', onResize);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
