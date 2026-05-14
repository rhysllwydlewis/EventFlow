(function () {
  'use strict';

  const ROOT_ID = 'wedding-website-dashboard-root';
  const CARD_ID = 'wedding-website-dashboard-card';

  function injectStyles() {
    if (document.getElementById('ww-nav-card-fixes-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'ww-nav-card-fixes-styles';
    style.textContent = `
      .ww-app-tabs {
        position: sticky !important;
        top: 0;
        z-index: 8;
        flex-wrap: wrap !important;
        overflow: visible !important;
        overflow-x: visible !important;
        overflow-y: hidden !important;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.92), rgba(244, 252, 250, 0.86));
        backdrop-filter: blur(16px);
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
      }

      .ww-app-tabs::-webkit-scrollbar,
      .ww-app-body::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
      }

      .ww-app-tabs button {
        flex: 0 0 auto;
      }

      .ww-app-body {
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
      }

      .customer-wedding-card.ww-open-app-card,
      #wedding-website-dashboard-card.ww-open-app-card {
        border-color: rgba(80, 192, 176, 0.28) !important;
        background:
          radial-gradient(circle at 4% 0%, rgba(80, 192, 176, 0.12), transparent 34%),
          linear-gradient(135deg, rgba(255, 255, 255, 0.92), rgba(244, 252, 250, 0.84)) !important;
        box-shadow: 0 18px 52px rgba(36, 67, 111, 0.08) !important;
      }

      #wedding-website-dashboard-card.ww-open-app-card > .customer-wedding-card-header,
      #wedding-website-dashboard-card.ww-open-app-card > .sd-card-header,
      .customer-wedding-card.ww-open-app-card > .customer-wedding-card-header,
      .customer-wedding-card.ww-open-app-card > .sd-card-header {
        display: flex !important;
        align-items: center;
        border-bottom: 0 !important;
      }

      #wedding-website-dashboard-card.ww-open-app-card > .card-collapse-btn,
      #wedding-website-dashboard-card.ww-open-app-card .card-collapse-btn {
        display: none !important;
      }

      #wedding-website-dashboard-card.ww-open-app-card > .cd-card-body,
      .customer-wedding-card.ww-open-app-card > .cd-card-body {
        display: none !important;
      }

      #wedding-website-dashboard-card.ww-open-app-card > .card-body-collapsible,
      .customer-wedding-card.ww-open-app-card > .card-body-collapsible {
        display: none !important;
        max-height: 0 !important;
        opacity: 0 !important;
      }

      .customer-wedding-card.ww-open-app-card .sd-card-header__content,
      #wedding-website-dashboard-card.ww-open-app-card .sd-card-header__content {
        min-width: 0;
      }

      .customer-wedding-card.ww-open-app-card .sd-card-header__subtitle,
      #wedding-website-dashboard-card.ww-open-app-card .sd-card-header__subtitle {
        max-width: 760px;
      }

      .customer-wedding-card.ww-open-app-card .ww-card-open-app-btn,
      .customer-wedding-card.ww-open-app-card .sd-card-header__actions .ww-card-open-app-btn,
      #wedding-website-dashboard-card.ww-open-app-card .ww-card-open-app-btn,
      #wedding-website-dashboard-card.ww-open-app-card .sd-card-header__actions .ww-card-open-app-btn {
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        gap: 0.42rem;
        min-height: 2.45rem;
        padding: 0.55rem 0.9rem !important;
        border: 1px solid rgba(80, 192, 176, 0.38) !important;
        border-radius: 999px !important;
        background: linear-gradient(135deg, rgba(80, 192, 176, 0.2), rgba(44, 148, 177, 0.16)) !important;
        color: #0f766e !important;
        box-shadow: 0 10px 24px rgba(36, 67, 111, 0.08);
        cursor: pointer;
        font-weight: 900 !important;
        line-height: 1;
        text-decoration: none !important;
        transition: box-shadow 0.18s ease, transform 0.18s ease;
      }

      .customer-wedding-card.ww-open-app-card .ww-card-open-app-btn:hover,
      #wedding-website-dashboard-card.ww-open-app-card .ww-card-open-app-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 14px 30px rgba(36, 67, 111, 0.12);
      }

      @media (max-width: 720px) {
        #wedding-website-dashboard-card.ww-open-app-card > .customer-wedding-card-header,
        #wedding-website-dashboard-card.ww-open-app-card > .sd-card-header,
        .customer-wedding-card.ww-open-app-card > .customer-wedding-card-header,
        .customer-wedding-card.ww-open-app-card > .sd-card-header {
          align-items: stretch;
          flex-direction: column;
          gap: 0.85rem;
        }

        .customer-wedding-card.ww-open-app-card .sd-card-header__actions,
        #wedding-website-dashboard-card.ww-open-app-card .sd-card-header__actions {
          justify-content: space-between;
        }

        .customer-wedding-card.ww-open-app-card .ww-card-open-app-btn,
        #wedding-website-dashboard-card.ww-open-app-card .ww-card-open-app-btn {
          flex: 1 1 auto;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function findWeddingCard() {
    return document.getElementById(CARD_ID) || document.getElementById(ROOT_ID)?.closest('.customer-wedding-card, .card');
  }

  function findLauncherButton() {
    return document.getElementById(ROOT_ID)?.querySelector('#ww-open-app, .ww-open-app');
  }

  function revealHiddenRootTemporarily(card) {
    const root = document.getElementById(ROOT_ID);
    const directBody = card?.querySelector(':scope > .cd-card-body');
    const wrapper = card?.querySelector(':scope > .card-body-collapsible');
    const previous = [];

    [directBody, wrapper].forEach(el => {
      if (!el) {
        return;
      }
      previous.push([el, el.style.display, el.style.maxHeight, el.style.opacity]);
      el.style.display = '';
      el.style.maxHeight = '';
      el.style.opacity = '';
    });

    root?.removeAttribute('hidden');

    return () => {
      previous.forEach(([el, display, maxHeight, opacity]) => {
        el.style.display = display;
        el.style.maxHeight = maxHeight;
        el.style.opacity = opacity;
      });
    };
  }

  function openWidgetApp() {
    const card = findWeddingCard();
    let cleanup = null;
    let launcherButton = findLauncherButton();

    if (!launcherButton && card) {
      cleanup = revealHiddenRootTemporarily(card);
      launcherButton = findLauncherButton();
    }

    if (launcherButton) {
      launcherButton.click();
      cleanup?.();
      return;
    }

    cleanup?.();
    document.getElementById(ROOT_ID)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function ensureActions(card) {
    const header = card.querySelector(':scope > .customer-wedding-card-header, :scope > .sd-card-header');
    if (!header) {
      return null;
    }
    let actions = header.querySelector(':scope > .sd-card-header__actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'sd-card-header__actions';
      header.appendChild(actions);
    }
    return actions;
  }

  function isCollapseControl(element) {
    const text = String(element.textContent || '').trim();
    const label = String(element.getAttribute('aria-label') || '');
    const classes = String(element.className || '');
    return /expand|minimise|minimize|collapse/i.test(`${text} ${label} ${classes}`);
  }

  function buildOpenAppButton(source) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${source?.className || ''} ww-card-open-app-btn`.trim();
    button.textContent = 'Open app';
    button.setAttribute('aria-label', 'Open Wedding Website and RSVPs app');
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openWidgetApp();
    });
    return button;
  }

  function convertExpandButton(card) {
    const actions = ensureActions(card);
    if (!actions) {
      return;
    }

    const existing = actions.querySelector('.ww-card-open-app-btn');
    if (existing) {
      existing.textContent = 'Open app';
      existing.onclick = null;
      if (existing.dataset.wwOpenBound !== 'true') {
        existing.dataset.wwOpenBound = 'true';
        existing.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          openWidgetApp();
        });
      }
      return;
    }

    const actionControls = Array.from(actions.querySelectorAll('button, a'));
    const actionCollapse = actionControls.find(isCollapseControl);
    if (actionCollapse) {
      actionCollapse.replaceWith(buildOpenAppButton(actionCollapse));
      return;
    }

    const anyCollapse = Array.from(card.querySelectorAll('button, a')).find(el => {
      if (el.closest('.ww-app-dialog')) {
        return false;
      }
      return isCollapseControl(el);
    });

    if (anyCollapse && anyCollapse.closest(actions)) {
      anyCollapse.replaceWith(buildOpenAppButton(anyCollapse));
      return;
    }

    actions.appendChild(buildOpenAppButton(null));
  }

  function disableGenericCollapseForWeddingCard(card) {
    card.classList.remove('ef-dashboard-card--collapsible', 'ef-dashboard-card--collapsed', 'card-collapsible', 'card--collapsed');
    card.classList.add('no-collapse');
    card.dataset.efPolishCollapseReady = '1';

    const injectedButton = card.querySelector(':scope > .card-collapse-btn');
    if (injectedButton) {
      injectedButton.remove();
    }

    const wrapper = card.querySelector(':scope > .card-body-collapsible');
    if (wrapper) {
      while (wrapper.firstChild) {
        card.insertBefore(wrapper.firstChild, wrapper);
      }
      wrapper.remove();
    }
  }

  function polishDashboardCopy(card) {
    const subtitle = card.querySelector('.customer-wedding-card-header .sd-card-header__subtitle, .sd-card-header__subtitle');
    if (subtitle && !subtitle.dataset.wwOpenAppCopy) {
      subtitle.textContent =
        'Open your wedding mini app to manage your guest website, RSVPs, guest list, seating plan and share tools.';
      subtitle.dataset.wwOpenAppCopy = 'true';
    }
  }

  function enhanceDashboardCard() {
    injectStyles();
    const card = findWeddingCard();
    if (!card) {
      return;
    }
    card.id = card.id || CARD_ID;
    card.classList.add('ww-open-app-card', 'no-collapse');
    disableGenericCollapseForWeddingCard(card);
    convertExpandButton(card);
    polishDashboardCopy(card);
  }

  function enhanceTabs() {
    document.querySelectorAll('.ww-app-tabs').forEach(tabbar => {
      tabbar.setAttribute('data-scrollbar-fixed', 'true');
    });
  }

  function run() {
    enhanceDashboardCard();
    enhanceTabs();
  }

  let queued = false;
  function queueRun() {
    if (queued) {
      return;
    }
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      run();
    });
  }

  const observer = new MutationObserver(queueRun);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-expanded'] });

  window.addEventListener('load', run);
  window.setTimeout(run, 0);
  window.setTimeout(run, 500);
  window.setTimeout(run, 1800);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
