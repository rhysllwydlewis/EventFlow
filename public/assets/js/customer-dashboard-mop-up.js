/*
 * Customer Dashboard Desktop Mop-up
 * Fixes aesthetic/layout issues without disturbing the existing dashboard feature modules.
 */
(function () {
  'use strict';

  const CUSTOMER_PATHS = new Set(['/dashboard/customer', '/dashboard-customer.html']);
  if (!CUSTOMER_PATHS.has(window.location.pathname)) {
    return;
  }

  const STYLE_ID = 'customer-dashboard-mop-up-styles';
  const COLLAPSE_KEY = 'ef_customer_wedding_card_collapsed';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .customer-welcome-card > .customer-welcome-dismiss:first-child {
        display: none !important;
      }

      .customer-welcome-card {
        padding-top: clamp(1.35rem, 2.5vw, 2rem) !important;
      }

      #wedding-website-dashboard-card.customer-wedding-card--collapsible .sd-card-header {
        cursor: pointer;
        user-select: none;
      }

      #wedding-website-dashboard-card .customer-wedding-collapse-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: .35rem;
        min-height: 2.35rem;
        padding: .48rem .72rem;
        border-radius: 999px;
        border: 1px solid rgba(11, 128, 115, .2);
        background: rgba(255, 255, 255, .78);
        color: #0b8073;
        font-weight: 800;
        font-size: .82rem;
        box-shadow: 0 8px 20px rgba(15, 23, 42, .06);
      }

      #wedding-website-dashboard-card .customer-wedding-collapse-toggle:hover,
      #wedding-website-dashboard-card .customer-wedding-collapse-toggle:focus-visible {
        background: #ecfdf5;
        outline: 2px solid rgba(11, 128, 115, .25);
        outline-offset: 2px;
      }

      #wedding-website-dashboard-card.customer-wedding-card--collapsed .cd-card-body {
        display: none !important;
      }

      #wedding-website-dashboard-card.customer-wedding-card--collapsed {
        margin-bottom: 1rem;
      }

      #wedding-website-dashboard-card.customer-wedding-card--collapsed .sd-card-header {
        border-bottom-left-radius: inherit;
        border-bottom-right-radius: inherit;
      }

      #wedding-website-status-pill[data-status="not-started"] {
        background: #f8fafc;
        border-color: rgba(148, 163, 184, .35);
        color: #334155;
      }

      #wedding-website-status-pill[data-status="in-progress"] {
        background: #fffbeb;
        border-color: rgba(245, 158, 11, .34);
        color: #92400e;
      }

      #wedding-website-status-pill[data-status="ready"] {
        background: #ecfeff;
        border-color: rgba(6, 182, 212, .28);
        color: #0e7490;
      }

      #wedding-website-status-pill[data-status="published"],
      #wedding-website-status-pill[data-status="complete"] {
        background: #dcfce7;
        border-color: rgba(22, 163, 74, .28);
        color: #166534;
      }

      .recommendations-widget .recommendations-widget__header,
      .recommendations-widget [class*="recommendations"]:has(> h2),
      .recommendations-widget [class*="recommendations"]:has(> h3) {
        align-items: center;
      }

      .recommendations-widget h2,
      .recommendations-widget h3 {
        margin-bottom: 0 !important;
        line-height: 1.25 !important;
      }

      .recommendations-widget .recommendations-widget__subtitle,
      .recommendations-widget p.small,
      .recommendations-widget [data-recommendations-subtitle] {
        display: none !important;
      }

      .recommendations-widget .recommendations-widget__header,
      .recommendations-widget .section-header,
      .recommendations-widget .card-header {
        display: flex !important;
        justify-content: space-between !important;
        gap: 1rem !important;
      }

      .recommendations-widget .recommendations-view-all,
      .recommendations-widget a[href*="/suppliers"] {
        white-space: nowrap;
      }

      @media (min-width: 900px) {
        #wedding-website-dashboard-card .sd-card-header__actions {
          gap: .65rem;
          flex-wrap: nowrap;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function removeDuplicateWelcomeDismissButton() {
    const welcome = document.getElementById('welcome-section');
    if (!welcome) {
      return;
    }

    const dismissButtons = Array.from(welcome.querySelectorAll('#welcome-dismiss-btn'));
    if (dismissButtons.length <= 1) {
      return;
    }

    dismissButtons.forEach(button => {
      const label = String(button.textContent || '').trim().toLowerCase();
      if (!label.includes('got it')) {
        button.remove();
      }
    });
  }

  function getWeddingPlan(plans) {
    return (plans || []).find(plan => {
      const type = String(plan.eventType || '').toLowerCase();
      const name = String(plan.name || plan.eventName || '').toLowerCase();
      return type === 'wedding' || name.includes('wedding');
    });
  }

  function hasMeaningfulSiteContent(site) {
    if (!site) {
      return false;
    }

    const stringFields = [
      'coupleNames',
      'welcomeMessage',
      'rsvpIntroText',
      'rsvpDeadline',
      'slug',
    ];
    const arrayFields = [
      'accommodationRecommendations',
      'taxiRecommendations',
      'localInfo',
      'weddingParty',
      'faq',
      'mealOptions',
      'customRsvpQuestions',
    ];

    return stringFields.some(key => String(site[key] || '').trim()) ||
      arrayFields.some(key => Array.isArray(site[key]) && site[key].length > 0);
  }

  function isReadyToPublish(site) {
    if (!site) {
      return false;
    }
    return Boolean(
      String(site.coupleNames || '').trim() &&
      String(site.slug || '').trim() &&
      (String(site.welcomeMessage || '').trim() || String(site.rsvpIntroText || '').trim())
    );
  }

  function setWeddingStatus(label, status) {
    const pill = document.getElementById('wedding-website-status-pill');
    if (!pill) {
      return;
    }
    pill.textContent = label;
    pill.dataset.status = status;
    pill.setAttribute('aria-label', `Wedding website status: ${label}`);
  }

  async function updateWeddingStatus(plans) {
    const plan = getWeddingPlan(plans);
    if (!plan) {
      setWeddingStatus('Not started', 'not-started');
      return;
    }

    try {
      const response = await fetch(`/api/me/plans/${encodeURIComponent(plan.id)}/wedding-website`, {
        credentials: 'include',
      });
      if (response.status === 404) {
        setWeddingStatus('Not started', 'not-started');
        return;
      }
      if (!response.ok) {
        setWeddingStatus('In progress', 'in-progress');
        return;
      }
      const data = await response.json().catch(() => ({}));
      const site = data.website || data.site || data.weddingWebsite || data;

      if (site.status === 'published') {
        setWeddingStatus('Published', 'published');
      } else if (isReadyToPublish(site)) {
        setWeddingStatus('Ready to publish', 'ready');
      } else if (hasMeaningfulSiteContent(site)) {
        setWeddingStatus('In progress', 'in-progress');
      } else {
        setWeddingStatus('Draft started', 'in-progress');
      }
    } catch (error) {
      console.warn('Unable to resolve wedding website status:', error);
      if (plan) {
        setWeddingStatus('In progress', 'in-progress');
      }
    }
  }

  function setupWeddingCollapse() {
    const card = document.getElementById('wedding-website-dashboard-card');
    if (!card || card.dataset.mopUpCollapseReady === '1') {
      return;
    }

    const header = card.querySelector('.sd-card-header');
    const actions = card.querySelector('.sd-card-header__actions');
    const body = card.querySelector('.cd-card-body');
    if (!header || !actions || !body) {
      return;
    }

    card.dataset.mopUpCollapseReady = '1';
    card.classList.add('customer-wedding-card--collapsible');
    body.id = body.id || 'wedding-website-card-body';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'customer-wedding-collapse-toggle';
    toggle.setAttribute('aria-controls', body.id);
    actions.appendChild(toggle);

    function applyState(collapsed) {
      card.classList.toggle('customer-wedding-card--collapsed', collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.textContent = collapsed ? 'Expand' : 'Minimise';
      try {
        localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
      } catch (_) {
        /* ignore storage failures */
      }
    }

    let collapsed = false;
    try {
      collapsed = localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch (_) {
      collapsed = false;
    }
    applyState(collapsed);

    toggle.addEventListener('click', event => {
      event.stopPropagation();
      applyState(!card.classList.contains('customer-wedding-card--collapsed'));
    });

    header.addEventListener('click', event => {
      if (event.target.closest('button, a, input, select, textarea')) {
        return;
      }
      applyState(!card.classList.contains('customer-wedding-card--collapsed'));
    });
  }

  function compactRecommendationsHeader() {
    const widgets = Array.from(document.querySelectorAll('.recommendations-widget, #recommendations-widget, [data-recommendations-widget]'));
    widgets.forEach(widget => {
      if (widget.dataset.mopUpRecommendationsReady === '1') {
        return;
      }
      widget.dataset.mopUpRecommendationsReady = '1';

      const headings = Array.from(widget.querySelectorAll('h2, h3'));
      const heading = headings.find(el => /recommended/i.test(el.textContent || '')) || headings[0];
      if (!heading) {
        return;
      }

      const header = heading.closest('.recommendations-widget__header, .section-header, .card-header, div') || widget;
      header.classList.add('recommendations-widget__header');

      const existingViewAll = Array.from(widget.querySelectorAll('a')).find(a => /view all/i.test(a.textContent || ''));
      if (!existingViewAll) {
        const link = document.createElement('a');
        link.href = '/suppliers';
        link.className = 'recommendations-view-all';
        link.textContent = 'View All →';
        header.appendChild(link);
      }
    });
  }

  async function getPlans() {
    try {
      const response = await fetch('/api/me/plans', { credentials: 'include' });
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      return data.plans || [];
    } catch (_) {
      return [];
    }
  }

  async function init() {
    injectStyles();
    removeDuplicateWelcomeDismissButton();
    setupWeddingCollapse();
    compactRecommendationsHeader();

    const plans = await getPlans();
    await updateWeddingStatus(plans);

    const observer = new MutationObserver(() => {
      removeDuplicateWelcomeDismissButton();
      setupWeddingCollapse();
      compactRecommendationsHeader();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
