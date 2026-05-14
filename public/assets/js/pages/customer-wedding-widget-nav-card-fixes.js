(function () {
  'use strict';

  const ROOT_ID = 'wedding-website-dashboard-root';

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
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.9), rgba(244, 252, 250, 0.84));
        backdrop-filter: blur(16px);
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
      }

      .ww-app-tabs::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
      }

      .ww-app-tabs button {
        flex: 0 0 auto;
      }

      .ww-app-body {
        scrollbar-gutter: stable;
      }

      .customer-wedding-card.ww-open-app-card .sd-card-header__subtitle {
        max-width: 760px;
      }

      .customer-wedding-card.ww-open-app-card .ww-card-open-app-btn,
      .customer-wedding-card.ww-open-app-card .sd-card-header__actions .ww-card-open-app-btn {
        min-height: 2.45rem;
        border: 1px solid rgba(80, 192, 176, 0.38) !important;
        border-radius: 999px !important;
        background: linear-gradient(135deg, rgba(80, 192, 176, 0.18), rgba(44, 148, 177, 0.14)) !important;
        color: #0f766e !important;
        box-shadow: 0 10px 24px rgba(36, 67, 111, 0.08);
        cursor: pointer;
        font-weight: 900 !important;
      }

      .customer-wedding-card.ww-open-app-card .ww-card-open-app-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 14px 30px rgba(36, 67, 111, 0.12);
      }
    `;
    document.head.appendChild(style);
  }

  function findWeddingCard() {
    return document.getElementById('wedding-website-dashboard-card') ||
      document.getElementById(ROOT_ID)?.closest('.customer-wedding-card');
  }

  function openWidgetApp() {
    const launcherButton = document.getElementById(ROOT_ID)?.querySelector('#ww-open-app');
    launcherButton?.click();
  }

  function convertExpandButton(card) {
    const actions = card.querySelector('.sd-card-header__actions');
    if (!actions) {
      return;
    }

    const existing = actions.querySelector('.ww-card-open-app-btn');
    if (existing) {
      existing.textContent = 'Open app';
      return;
    }

    const candidates = Array.from(actions.querySelectorAll('button, a'));
    const expandButton = candidates.find(button => /expand|minimise|minimize/i.test(button.textContent || ''));
    if (!expandButton) {
      return;
    }

    const replacement = expandButton.cloneNode(false);
    replacement.className = `${expandButton.className || ''} ww-card-open-app-btn`.trim();
    replacement.type = 'button';
    replacement.textContent = 'Open app';
    replacement.setAttribute('aria-label', 'Open Wedding Website and RSVPs app');
    replacement.removeAttribute('aria-expanded');
    replacement.removeAttribute('aria-controls');
    replacement.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openWidgetApp();
    });
    expandButton.replaceWith(replacement);
  }

  function polishDashboardCopy(card) {
    const subtitle = card.querySelector('.customer-wedding-card-header .sd-card-header__subtitle');
    if (subtitle && !subtitle.dataset.wwOpenAppCopy) {
      subtitle.textContent = 'Open your wedding mini app to manage your guest website, RSVPs, guest list, seating plan and share tools.';
      subtitle.dataset.wwOpenAppCopy = 'true';
    }
  }

  function enhanceDashboardCard() {
    injectStyles();
    const card = findWeddingCard();
    if (!card) {
      return;
    }
    card.classList.add('ww-open-app-card');
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

  const observer = new MutationObserver(run);
  observer.observe(document.body, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
