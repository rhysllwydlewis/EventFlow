'use strict';
(function () {
  const originalInit = window.initWeddingWebsiteDashboard;
  let enhanceQueued = false;

  const isWeddingPlan = plan => {
    const eventType = String(plan?.eventType || '').toLowerCase();
    const eventName = String(plan?.name || plan?.eventName || '').toLowerCase();
    return eventType === 'wedding' || eventName.includes('wedding');
  };

  function injectStyles() {
    if (document.getElementById('ww-polish-enhancer-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'ww-polish-enhancer-styles';
    style.textContent = `
      .ww-stat-card {
        display: grid;
        gap: 0.35rem;
        border-radius: 18px !important;
        padding: 0.85rem !important;
      }

      .ww-stat-card strong {
        color: var(--ww-navy, #24436f);
        font-size: 1.125rem;
      }

      .ww-section-nav {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        margin-bottom: 0.75rem;
        padding: 0.65rem;
        border: 1px solid rgba(80, 192, 176, 0.16);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.64);
      }

      .ww-section-nav .ww-kicker {
        flex: 1 1 100%;
      }

      .ww-section-nav a {
        border: 1px solid rgba(80, 192, 176, 0.18);
        border-radius: 999px;
        color: var(--ww-navy, #24436f);
        font-size: 0.75rem;
        font-weight: 800;
        padding: 0.38rem 0.65rem;
        text-decoration: none;
      }

      .ww-sticky-actions {
        position: sticky;
        top: 0;
        z-index: 4;
        padding: 0.55rem;
        border: 1px solid rgba(80, 192, 176, 0.14);
        border-radius: 16px;
        background: rgba(249, 254, 253, 0.9);
        backdrop-filter: blur(14px);
      }
    `;
    document.head.appendChild(style);
  }

  function enhanceStats(root) {
    root.querySelectorAll('.ww-tiles > div:not(.ww-stat-card)').forEach(card => {
      card.classList.add('ww-stat-card');
    });
  }

  function enhanceWorkspace(root) {
    const form = root.querySelector('#ww-builder');
    const panel = root.querySelector('.ww-app-panel');
    if (!form || panel?.querySelector('.ww-section-nav')) {
      return;
    }

    const nav = document.createElement('aside');
    nav.className = 'ww-section-nav';
    nav.innerHTML = `
      <p class="ww-kicker">Build sections</p>
      <a href="#ww-essentials">Essentials</a>
      <a href="#ww-travel">Travel</a>
      <a href="#ww-party">Wedding party</a>
      <a href="#ww-rsvp-form">RSVP form</a>
    `;

    const labels = ['ww-essentials', 'ww-travel', 'ww-party', 'ww-rsvp-form'];
    form.querySelectorAll('details').forEach((details, index) => {
      if (labels[index]) {
        details.id = labels[index];
      }
    });

    panel.classList.add('ww-workspace-panel');
    panel.prepend(nav);
    root.querySelector('.ww-builder-actions')?.classList.add('ww-sticky-actions');
  }

  function enhanceDialog(dialog) {
    enhanceStats(dialog);
    enhanceWorkspace(dialog);
  }

  function enhanceOpenDialogs() {
    document.querySelectorAll('.ww-app-dialog').forEach(enhanceDialog);
  }

  function scheduleEnhance() {
    if (enhanceQueued) {
      return;
    }
    enhanceQueued = true;
    window.requestAnimationFrame(() => {
      enhanceQueued = false;
      enhanceOpenDialogs();
    });
  }

  function observeWidgetDialogs() {
    const observer = new MutationObserver(mutations => {
      const dialogAdded = mutations.some(mutation =>
        Array.from(mutation.addedNodes).some(
          node =>
            node instanceof Element &&
            (node.matches('.ww-app-dialog') || node.querySelector?.('.ww-app-dialog'))
        )
      );
      if (dialogAdded) {
        scheduleEnhance();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener(
    'click',
    event => {
      if (
        event.target instanceof Element &&
        event.target.closest('.ww-app-tabs button,[data-tab]')
      ) {
        window.setTimeout(scheduleEnhance, 0);
      }
    },
    true
  );

  window.initWeddingWebsiteDashboard = async function patchedWeddingWebsiteDashboard(plans) {
    await originalInit?.(plans);
    if ((plans || []).some(isWeddingPlan)) {
      scheduleEnhance();
    }
  };

  injectStyles();
  scheduleEnhance();
  observeWidgetDialogs();
})();
