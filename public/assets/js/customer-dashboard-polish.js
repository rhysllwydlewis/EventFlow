'use strict';
(function () {
  if (!['/dashboard/customer', '/dashboard-customer.html'].includes(window.location.pathname)) {
    return;
  }

  const MAX_RECOMMENDATIONS = 5;
  const STYLE_ID = 'customer-dashboard-polish-styles';
  const STORE_PREFIX = 'ef_customer_card_collapsed_';
  let queued = false;
  let observer = null;

  function chevronSvg() {
    return '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function slug(value) {
    return (
      String(value || 'card')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'card'
    );
  }

  function cardTitle(card) {
    return String(card.querySelector('.sd-card-header__heading, h2, h3')?.textContent || '').trim();
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .customer-dashboard-page #welcome-section.customer-welcome-card {
        position: relative;
        overflow: hidden;
        border: 1px solid rgba(13, 148, 136, .16) !important;
        border-radius: 22px !important;
        background:
          radial-gradient(circle at 8% 0%, rgba(20, 184, 166, .14), transparent 32%),
          radial-gradient(circle at 92% 12%, rgba(14, 165, 233, .10), transparent 28%),
          linear-gradient(135deg, rgba(255,255,255,.98), rgba(248,253,252,.96)) !important;
        box-shadow: 0 22px 55px rgba(15, 23, 42, .09) !important;
      }
      .customer-dashboard-page #welcome-section .customer-welcome-kicker {
        width: 100%;
        border: 1px solid rgba(13, 148, 136, .22);
        background: rgba(236, 253, 245, .72);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.75);
      }
      .customer-dashboard-page #welcome-section .customer-welcome-heading {
        max-width: 760px;
        letter-spacing: -.04em;
      }
      .customer-dashboard-page #welcome-section .customer-welcome-intro {
        max-width: 760px;
        font-size: 1rem;
        line-height: 1.75;
      }
      .customer-dashboard-page #welcome-section .customer-welcome-actions__grid { gap: .85rem !important; }
      .customer-dashboard-page #welcome-section .customer-welcome-action-card {
        min-height: 76px;
        border-color: rgba(13, 148, 136, .18) !important;
        background: rgba(255,255,255,.82) !important;
        box-shadow: 0 10px 25px rgba(15, 23, 42, .045);
        transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
      }
      .customer-dashboard-page #welcome-section .customer-welcome-action-card:hover,
      .customer-dashboard-page #welcome-section .customer-welcome-action-card:focus-visible {
        transform: translateY(-2px);
        border-color: rgba(13, 148, 136, .34) !important;
        box-shadow: 0 16px 32px rgba(13, 148, 136, .11);
      }
      .customer-dashboard-page #welcome-section .customer-welcome-footer {
        border: 1px solid rgba(16, 185, 129, .2);
        border-radius: 18px;
        background: linear-gradient(135deg, rgba(236,253,245,.9), rgba(240,253,250,.78));
        box-shadow: inset 0 1px 0 rgba(255,255,255,.82);
      }

      .customer-dashboard-page .ef-dashboard-card--collapsible { overflow: hidden; transition: box-shadow .18s ease, border-color .18s ease, transform .18s ease; }
      .customer-dashboard-page .ef-dashboard-card--collapsible > .sd-card-header { cursor: pointer; }
      .customer-dashboard-page .ef-dashboard-card--collapsed > .cd-card-body { display: none !important; }
      .customer-dashboard-page .ef-dashboard-collapse-toggle { display:inline-flex;align-items:center;justify-content:center;gap:.42rem;min-height:2.25rem;padding:.48rem .75rem;border-radius:999px;border:1px solid rgba(11,128,115,.18);background:linear-gradient(135deg,rgba(255,255,255,.96),rgba(240,253,250,.9));color:#0b8073;cursor:pointer;font-family:inherit;font-size: 0.75rem;font-weight:850;line-height:1;box-shadow:0 8px 18px rgba(15,23,42,.06),inset 0 1px 0 rgba(255,255,255,.86);transition:transform .16s ease,background .16s ease,border-color .16s ease,box-shadow .16s ease; }
      .customer-dashboard-page .ef-dashboard-collapse-toggle:hover,
      .customer-dashboard-page .ef-dashboard-collapse-toggle:focus-visible { background:linear-gradient(135deg,#fff,#ecfdf5);border-color:rgba(11,128,115,.36);box-shadow:0 12px 24px rgba(13,148,136,.13),inset 0 1px 0 rgba(255,255,255,.92);outline:2px solid rgba(11,128,115,.24);outline-offset:2px;transform:translateY(-1px); }
      .customer-dashboard-page .ef-dashboard-collapse-toggle svg { width:16px;height:16px;transition:transform .16s ease; }
      .customer-dashboard-page .ef-dashboard-card--collapsible:not(.ef-dashboard-card--collapsed) .ef-dashboard-collapse-toggle svg { transform:rotate(180deg); }

      .customer-dashboard-page .recommendations-widget { overflow:hidden !important; }
      .customer-dashboard-page .recommendations-header,
      .customer-dashboard-page .recommendations-widget__header { display:flex !important;align-items:center !important;justify-content:flex-start !important;gap:.85rem !important;margin-bottom:1rem !important; }
      .customer-dashboard-page .recommendations-header h2,
      .customer-dashboard-page .recommendations-header h3,
      .customer-dashboard-page .recommendations-widget__header h2,
      .customer-dashboard-page .recommendations-widget__header h3 { margin:0 !important;line-height:1.25 !important; }
      .customer-dashboard-page .ef-recommendations-row,
      .customer-dashboard-page #recommendations-widget .recommendations-grid,
      .customer-dashboard-page .recommendations-widget .recommendations-grid { display:flex !important;flex-direction:row !important;flex-wrap:nowrap !important;align-items:stretch !important;gap:1rem !important;overflow:hidden !important;width:100% !important;max-width:100% !important; }
      .customer-dashboard-page .ef-recommendations-row > .recommendation-card,
      .customer-dashboard-page .ef-recommendations-row > .supplier-card,
      .customer-dashboard-page .ef-recommendations-row > article,
      .customer-dashboard-page #recommendations-widget .recommendations-grid > .recommendation-card,
      .customer-dashboard-page .recommendations-widget .recommendations-grid > .recommendation-card { flex:1 1 0 !important;min-width:0 !important;width:auto !important;max-width:none !important;box-sizing:border-box !important; }
      .customer-dashboard-page .ef-recommendations-row > *:nth-child(n+6),
      .customer-dashboard-page #recommendations-widget .recommendations-grid > *:nth-child(n+6),
      .customer-dashboard-page .recommendations-widget .recommendations-grid > *:nth-child(n+6),
      .customer-dashboard-page .recommendations-widget .ef-rec-hidden { display:none !important; }
      .customer-dashboard-page .recommendation-card img:not([src]),
      .customer-dashboard-page .recommendation-card img[src=""] { display:none !important; }
      @media (max-width: 900px) {
        .customer-dashboard-page .ef-recommendations-row,
        .customer-dashboard-page #recommendations-widget .recommendations-grid,
        .customer-dashboard-page .recommendations-widget .recommendations-grid { overflow-x:auto !important;padding-bottom:.3rem;scroll-snap-type:x proximity; }
        .customer-dashboard-page .ef-recommendations-row > .recommendation-card,
        .customer-dashboard-page .ef-recommendations-row > .supplier-card,
        .customer-dashboard-page .ef-recommendations-row > article,
        .customer-dashboard-page #recommendations-widget .recommendations-grid > .recommendation-card,
        .customer-dashboard-page .recommendations-widget .recommendations-grid > .recommendation-card { flex:0 0 min(78vw,265px) !important;scroll-snap-align:start; }
      }
    `;
    document.head.appendChild(style);
  }

  function setCollapsed(card, button, collapsed) {
    const t = cardTitle(card) || 'section';
    card.classList.toggle('ef-dashboard-card--collapsed', collapsed);
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Minimise'} ${t}`);
    button.innerHTML = `<span>${collapsed ? 'Expand' : 'Minimise'}</span>${chevronSvg()}`;
    try {
      localStorage.setItem(STORE_PREFIX + slug(t), collapsed ? '1' : '0');
    } catch (_) {
      /* ignore */
    }
  }

  function setupCollapsibleCards() {
    document.querySelectorAll('.customer-dashboard-page .card.cd-card').forEach(card => {
      if (
        card.dataset.efPolishCollapseReady === '1' ||
        card.id === 'wedding-website-dashboard-card' ||
        card.classList.contains('no-collapse')
      ) {
        return;
      }
      const header = card.querySelector(':scope > .sd-card-header');
      const body = card.querySelector(':scope > .cd-card-body');
      if (!header || !body) {
        return;
      }
      const lowerTitle = cardTitle(card).toLowerCase();
      const allowed = [
        'budget settings',
        'events calendar',
        'your plans',
        'saved suppliers',
        'quick actions',
        'support tickets',
        'conversations',
      ];
      if (!allowed.some(item => lowerTitle.includes(item))) {
        return;
      }
      let actions = header.querySelector(':scope > .sd-card-header__actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'sd-card-header__actions';
        header.appendChild(actions);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ef-dashboard-collapse-toggle';
      body.id = body.id || `${slug(lowerTitle)}-body`;
      button.setAttribute('aria-controls', body.id);
      actions.appendChild(button);
      card.dataset.efPolishCollapseReady = '1';
      card.classList.add('ef-dashboard-card--collapsible');
      setCollapsed(card, button, true);
      button.addEventListener('click', event => {
        event.stopPropagation();
        setCollapsed(card, button, !card.classList.contains('ef-dashboard-card--collapsed'));
      });
      header.addEventListener('click', event => {
        if (event.target.closest('button,a,input,select,textarea')) {
          return;
        }
        setCollapsed(card, button, !card.classList.contains('ef-dashboard-card--collapsed'));
      });
    });
  }

  function recommendationWidgets() {
    const explicit = Array.from(
      document.querySelectorAll(
        '.recommendations-widget, #recommendations-widget, [data-recommendations-widget]'
      )
    );
    const fuzzy = Array.from(
      document.querySelectorAll('.customer-dashboard-page .card, .customer-dashboard-page section')
    ).filter(
      el =>
        /recommended for you/i.test(el.textContent || '') &&
        el.querySelector('.recommendation-card, .supplier-card, article')
    );
    return Array.from(new Set([...explicit, ...fuzzy]));
  }

  function recommendationItems(widget) {
    return Array.from(
      widget.querySelectorAll(':scope .recommendation-card, :scope .supplier-card, :scope article')
    ).filter(
      item =>
        !item.closest('.recommendations-header, .recommendations-widget__header') && item !== widget
    );
  }

  function normaliseRecommendations() {
    recommendationWidgets().forEach(widget => {
      const items = recommendationItems(widget);
      if (!items.length) {
        return;
      }
      items.forEach((item, index) =>
        item.classList.toggle('ef-rec-hidden', index >= MAX_RECOMMENDATIONS)
      );
      const visible = items.slice(0, MAX_RECOMMENDATIONS);
      const parents = new Set(visible.map(item => item.parentElement).filter(Boolean));
      if (parents.size === 1) {
        visible[0].parentElement.classList.add('ef-recommendations-row');
        return;
      }
      const header = widget.querySelector(
        '.recommendations-header, .recommendations-widget__header'
      );
      let row = widget.querySelector(':scope > .ef-recommendations-row');
      if (!row) {
        row = document.createElement('div');
        row.className = 'ef-recommendations-row';
        if (header?.parentElement === widget) {
          header.after(row);
        } else {
          widget.appendChild(row);
        }
      }
      items.forEach(item => row.appendChild(item));
    });
  }

  function run() {
    injectStyles();
    setupCollapsibleCards();
    normaliseRecommendations();
  }
  function queueRun() {
    if (queued) {
      return;
    }
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      run();
    });
  }
  function init() {
    run();
    observer = new MutationObserver(queueRun);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.addEventListener('beforeunload', () => {
    if (observer) {
      observer.disconnect();
    }
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
