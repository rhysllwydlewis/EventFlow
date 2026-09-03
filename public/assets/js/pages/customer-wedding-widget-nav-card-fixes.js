'use strict';
(function () {
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
        border-color: rgba(167, 139, 250, 0.34) !important;
        background:
          radial-gradient(circle at 5% -12%, rgba(251, 207, 232, 0.55), transparent 38%),
          radial-gradient(circle at 96% 8%, rgba(186, 230, 253, 0.62), transparent 34%),
          linear-gradient(135deg, rgba(255, 247, 237, 0.94), rgba(236, 253, 245, 0.88) 52%, rgba(239, 246, 255, 0.9)) !important;
        box-shadow: 0 22px 60px rgba(91, 63, 135, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.82) !important;
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
      #wedding-website-dashboard-card.ww-open-app-card .card-collapse-btn,
      #wedding-website-dashboard-card.ww-open-app-card .customer-wedding-collapse-toggle,
      #wedding-website-dashboard-card.ww-open-app-card .ef-dashboard-collapse-toggle,
      .customer-wedding-card.ww-open-app-card .customer-wedding-collapse-toggle,
      .customer-wedding-card.ww-open-app-card .ef-dashboard-collapse-toggle {
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
        position: relative;
        isolation: isolate;
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        gap: 0.42rem;
        min-height: 2.45rem;
        padding: 0.55rem 0.9rem !important;
        border: 1px solid rgba(14, 165, 233, 0.28) !important;
        border-radius: 999px !important;
        background: linear-gradient(135deg, #bae6fd, #bbf7d0 52%, #fde68a) !important;
        color: #075985 !important;
        box-shadow: 0 12px 28px rgba(14, 116, 144, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.74);
        cursor: pointer;
        font-weight: 900 !important;
        overflow: hidden;
        line-height: 1;
        text-decoration: none !important;
        transition: box-shadow 0.18s ease, transform 0.18s ease;
      }

      .customer-wedding-card.ww-open-app-card .ww-card-open-app-btn::after,
      #wedding-website-dashboard-card.ww-open-app-card .ww-card-open-app-btn::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: -1;
        background: linear-gradient(120deg, transparent 0 24%, rgba(255, 255, 255, 0.56) 42%, transparent 60%);
        transform: translateX(-120%);
        transition: transform 0.45s ease;
      }

      .customer-wedding-card.ww-open-app-card .ww-card-open-app-btn:hover,
      #wedding-website-dashboard-card.ww-open-app-card .ww-card-open-app-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 14px 30px rgba(36, 67, 111, 0.12);
      }

      .customer-wedding-card.ww-open-app-card .ww-card-open-app-btn:hover::after,
      #wedding-website-dashboard-card.ww-open-app-card .ww-card-open-app-btn:hover::after {
        transform: translateX(120%);
      }

      .customer-wedding-card.ww-open-app-card .ww-card-open-app-btn:focus-visible,
      #wedding-website-dashboard-card.ww-open-app-card .ww-card-open-app-btn:focus-visible {
        outline: 3px solid rgba(14, 165, 233, 0.34);
        outline-offset: 3px;
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
    return (
      document.getElementById(CARD_ID) ||
      document.getElementById(ROOT_ID)?.closest('.customer-wedding-card, .card')
    );
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
      previous.push([
        el,
        el.style.getPropertyValue('display'),
        el.style.getPropertyPriority('display'),
        el.style.getPropertyValue('max-height'),
        el.style.getPropertyPriority('max-height'),
        el.style.getPropertyValue('opacity'),
        el.style.getPropertyPriority('opacity'),
      ]);
      el.style.setProperty('display', 'block', 'important');
      el.style.setProperty('max-height', 'none', 'important');
      el.style.setProperty('opacity', '1', 'important');
    });

    root?.removeAttribute('hidden');

    return () => {
      previous.forEach(
        ([
          el,
          display,
          displayPriority,
          maxHeight,
          maxHeightPriority,
          opacity,
          opacityPriority,
        ]) => {
          if (display) {
            el.style.setProperty('display', display, displayPriority);
          } else {
            el.style.removeProperty('display');
          }
          if (maxHeight) {
            el.style.setProperty('max-height', maxHeight, maxHeightPriority);
          } else {
            el.style.removeProperty('max-height');
          }
          if (opacity) {
            el.style.setProperty('opacity', opacity, opacityPriority);
          } else {
            el.style.removeProperty('opacity');
          }
        }
      );
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
    const header = card.querySelector(
      ':scope > .customer-wedding-card-header, :scope > .sd-card-header'
    );
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

  function bindOpenApp(button) {
    if (button.dataset.wwOpenBound === 'true') {
      return;
    }
    button.dataset.wwOpenBound = 'true';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openWidgetApp();
    });
  }

  function cardButtonClassName(source) {
    const safeSourceClasses = String(source?.className || '')
      .split(/\s+/)
      .filter(Boolean)
      .filter(className => !/collapse|expand|minimi[sz]e/i.test(className));
    safeSourceClasses.push('cta', 'ww-card-open-app-btn');
    return Array.from(new Set(safeSourceClasses)).join(' ');
  }

  function buildOpenAppButton(source) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = cardButtonClassName(source);
    button.textContent = 'Open app';
    button.setAttribute('aria-label', 'Open Wedding Website and RSVPs app');
    bindOpenApp(button);
    return button;
  }

  function convertExpandButton(card) {
    const actions = ensureActions(card);
    if (!actions) {
      return;
    }

    const existing = actions.querySelector('.ww-card-open-app-btn');
    const actionControls = Array.from(actions.querySelectorAll('button, a'));
    const collapseControls = actionControls.filter(
      control => control !== existing && isCollapseControl(control)
    );

    if (existing) {
      collapseControls.forEach(control => control.remove());
      existing.textContent = 'Open app';
      existing.setAttribute('aria-label', 'Open Wedding Website and RSVPs app');
      existing.onclick = null;
      bindOpenApp(existing);
      return;
    }

    const [firstCollapse, ...extraCollapseControls] = collapseControls;
    extraCollapseControls.forEach(control => control.remove());
    if (firstCollapse) {
      firstCollapse.replaceWith(buildOpenAppButton(firstCollapse));
      return;
    }

    actions.appendChild(buildOpenAppButton(null));
  }

  function disableGenericCollapseForWeddingCard(card) {
    card.classList.remove(
      'ef-dashboard-card--collapsible',
      'ef-dashboard-card--collapsed',
      'card-collapsible',
      'card--collapsed',
      'customer-wedding-card--collapsible',
      'customer-wedding-card--collapsed'
    );
    card.classList.add('no-collapse');
    card.dataset.efPolishCollapseReady = '1';

    card
      .querySelectorAll(
        ':scope > .card-collapse-btn, .customer-wedding-collapse-toggle, .ef-dashboard-collapse-toggle'
      )
      .forEach(button => button.remove());

    const wrapper = card.querySelector(':scope > .card-body-collapsible');
    if (wrapper) {
      while (wrapper.firstChild) {
        card.insertBefore(wrapper.firstChild, wrapper);
      }
      wrapper.remove();
    }
  }

  function polishDashboardCopy(card) {
    const subtitle = card.querySelector(
      '.customer-wedding-card-header .sd-card-header__subtitle, .sd-card-header__subtitle'
    );
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
  observer.observe(document.body, { childList: true, subtree: true });

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
