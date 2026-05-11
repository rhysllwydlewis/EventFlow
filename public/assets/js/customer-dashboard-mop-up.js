/*
 * Customer Dashboard Desktop Mop-up
 * Focused visual and layout polish for the customer dashboard.
 */
(function () {
  'use strict';

  const CUSTOMER_PATHS = new Set(['/dashboard/customer', '/dashboard-customer.html']);
  if (!CUSTOMER_PATHS.has(window.location.pathname)) return;

  const STYLE_ID = 'customer-dashboard-mop-up-styles';
  const COLLAPSE_KEY = 'ef_customer_wedding_card_collapsed';
  const REFRESH_EVENT = 'eventflow:customer-dashboard-mop-up-ready';
  const MAX_RECOMMENDATIONS_DESKTOP = 5;
  let observer;
  let observerQueued = false;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .customer-dashboard-page .container { max-width: 1420px; }
      .customer-dashboard-page .customer-hero { box-shadow: 0 22px 54px rgba(11, 128, 115, .16); }
      .customer-welcome-card > .customer-welcome-dismiss:first-child { display: none !important; }
      .customer-welcome-card { padding-top: clamp(1.35rem, 2.5vw, 2rem) !important; }
      .customer-welcome-card .customer-welcome-footer { box-shadow: inset 0 1px 0 rgba(255, 255, 255, .85); }

      .customer-wedding-card--collapsible {
        border-color: rgba(13, 148, 136, .16) !important;
        box-shadow: 0 18px 45px rgba(15, 23, 42, .08) !important;
        overflow: hidden;
      }
      #wedding-website-dashboard-card.customer-wedding-card--collapsible .sd-card-header {
        cursor: pointer;
        user-select: none;
        transition: background .18s ease, box-shadow .18s ease;
      }
      #wedding-website-dashboard-card.customer-wedding-card--collapsible .sd-card-header:hover {
        box-shadow: inset 0 -1px 0 rgba(13, 148, 136, .16);
      }
      #wedding-website-dashboard-card .customer-wedding-collapse-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: .45rem;
        min-height: 2.45rem;
        padding: .52rem .84rem;
        border-radius: 999px;
        border: 1px solid rgba(11, 128, 115, .18);
        background: linear-gradient(135deg, rgba(255, 255, 255, .96), rgba(240, 253, 250, .92));
        color: #0b8073;
        cursor: pointer;
        font-family: inherit;
        font-weight: 850;
        font-size: .82rem;
        line-height: 1;
        box-shadow: 0 10px 24px rgba(15, 23, 42, .07), inset 0 1px 0 rgba(255,255,255,.85);
        transition: transform .16s ease, background .16s ease, box-shadow .16s ease, border-color .16s ease;
      }
      #wedding-website-dashboard-card .customer-wedding-collapse-toggle:hover,
      #wedding-website-dashboard-card .customer-wedding-collapse-toggle:focus-visible {
        background: linear-gradient(135deg, #fff, #ecfdf5);
        border-color: rgba(11, 128, 115, .36);
        box-shadow: 0 14px 28px rgba(13, 148, 136, .14), inset 0 1px 0 rgba(255,255,255,.92);
        transform: translateY(-1px);
        outline: 2px solid rgba(11, 128, 115, .25);
        outline-offset: 2px;
      }
      #wedding-website-dashboard-card .customer-wedding-collapse-toggle__icon { width: 16px; height: 16px; transition: transform .16s ease; }
      #wedding-website-dashboard-card:not(.customer-wedding-card--collapsed) .customer-wedding-collapse-toggle__icon { transform: rotate(180deg); }
      #wedding-website-dashboard-card.customer-wedding-card--collapsed .cd-card-body { display: none !important; }
      #wedding-website-dashboard-card.customer-wedding-card--collapsed { margin-bottom: 1rem; }
      #wedding-website-dashboard-card.customer-wedding-card--collapsed .sd-card-header { border-bottom-left-radius: inherit; border-bottom-right-radius: inherit; }

      #wedding-website-status-pill.customer-wedding-status-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 2.15rem;
        padding: .42rem .78rem;
        border: 1px solid transparent;
        border-radius: 999px;
        font-size: .82rem;
        font-weight: 850;
        line-height: 1;
        white-space: nowrap;
      }
      #wedding-website-status-pill[data-status="not-started"] { background: #f8fafc; border-color: rgba(148, 163, 184, .38); color: #334155; }
      #wedding-website-status-pill[data-status="in-progress"] { background: #fffbeb; border-color: rgba(245, 158, 11, .38); color: #92400e; }
      #wedding-website-status-pill[data-status="ready"] { background: #ecfeff; border-color: rgba(6, 182, 212, .32); color: #0e7490; }
      #wedding-website-status-pill[data-status="published"],
      #wedding-website-status-pill[data-status="complete"] { background: #dcfce7; border-color: rgba(22, 163, 74, .32); color: #166534; }

      .customer-dashboard-page .recommendations-widget {
        border-radius: 18px;
        box-shadow: 0 18px 42px rgba(15, 23, 42, .07);
        overflow: hidden;
      }
      .customer-dashboard-page .recommendations-widget__header,
      .customer-dashboard-page .recommendations-header {
        display: flex !important;
        align-items: center !important;
        justify-content: flex-start !important;
        gap: .85rem !important;
        margin-bottom: 1rem !important;
      }
      .customer-dashboard-page .recommendations-widget__header h2,
      .customer-dashboard-page .recommendations-widget__header h3,
      .customer-dashboard-page .recommendations-header h2,
      .customer-dashboard-page .recommendations-header h3 {
        margin: 0 !important;
        line-height: 1.25 !important;
      }
      .customer-dashboard-page .recommendations-widget__subtitle,
      .customer-dashboard-page [data-recommendations-subtitle] { display: none !important; }
      .customer-dashboard-page .recommendations-view-all {
        color: #0b8073;
        font-weight: 850;
        font-size: .92rem;
        text-decoration: none;
        white-space: nowrap;
      }
      .customer-dashboard-page .recommendations-view-all:hover,
      .customer-dashboard-page .recommendations-view-all:focus-visible { text-decoration: underline; outline: none; }
      .customer-dashboard-page .recommendations-widget .ef-rec-hidden { display: none !important; }
      .customer-dashboard-page .recommendations-widget img[src=""],
      .customer-dashboard-page .recommendations-widget img:not([src]) { display: none !important; }

      .customer-dashboard-page .ef-recommendations-row,
      .customer-dashboard-page #recommendations-widget .recommendations-grid,
      .customer-dashboard-page .recommendations-widget .recommendations-grid--single-row {
        display: flex !important;
        flex-direction: row !important;
        flex-wrap: nowrap !important;
        align-items: stretch !important;
        gap: 1rem !important;
        width: 100% !important;
        max-width: 100% !important;
        overflow: hidden !important;
      }
      .customer-dashboard-page .ef-recommendations-row > .recommendation-card,
      .customer-dashboard-page .ef-recommendations-row > .supplier-card,
      .customer-dashboard-page .ef-recommendations-row > article,
      .customer-dashboard-page #recommendations-widget .recommendations-grid > .recommendation-card,
      .customer-dashboard-page .recommendations-widget .recommendations-grid--single-row > .recommendation-card {
        flex: 1 1 0 !important;
        min-width: 0 !important;
        width: auto !important;
        max-width: none !important;
        display: block !important;
        border-radius: 14px !important;
      }
      .customer-dashboard-page .ef-recommendations-row > *:nth-child(n+6),
      .customer-dashboard-page #recommendations-widget .recommendations-grid > *:nth-child(n+6),
      .customer-dashboard-page .recommendations-widget .recommendations-grid--single-row > *:nth-child(n+6) {
        display: none !important;
      }

      @media (min-width: 900px) {
        #wedding-website-dashboard-card .sd-card-header__actions { align-items: center; gap: .65rem; flex-wrap: nowrap; }
      }
      @media (max-width: 900px) {
        .customer-dashboard-page .ef-recommendations-row,
        .customer-dashboard-page #recommendations-widget .recommendations-grid,
        .customer-dashboard-page .recommendations-widget .recommendations-grid--single-row {
          overflow-x: auto !important;
          padding-bottom: .25rem;
          scroll-snap-type: x proximity;
        }
        .customer-dashboard-page .ef-recommendations-row > .recommendation-card,
        .customer-dashboard-page .ef-recommendations-row > .supplier-card,
        .customer-dashboard-page .ef-recommendations-row > article,
        .customer-dashboard-page #recommendations-widget .recommendations-grid > .recommendation-card,
        .customer-dashboard-page .recommendations-widget .recommendations-grid--single-row > .recommendation-card {
          flex: 0 0 min(78vw, 260px) !important;
          scroll-snap-align: start;
        }
      }
      @media (max-width: 700px) {
        #wedding-website-dashboard-card .sd-card-header__actions { justify-content: flex-start; width: 100%; }
      }
    `;
    document.head.appendChild(style);
  }

  function removeDuplicateWelcomeDismissButton() {
    const welcome = document.getElementById('welcome-section');
    if (!welcome) return;
    const dismissButtons = Array.from(welcome.querySelectorAll('#welcome-dismiss-btn'));
    if (dismissButtons.length <= 1) return;
    dismissButtons.forEach(button => {
      const label = String(button.textContent || '').trim().toLowerCase();
      if (!label.includes('got it')) button.remove();
    });
  }

  function getWeddingPlan(plans) {
    return (plans || []).find(plan => {
      const type = String(plan.eventType || '').toLowerCase();
      const name = String(plan.name || plan.eventName || '').toLowerCase();
      return type === 'wedding' || name.includes('wedding');
    });
  }

  function getSitePayload(data) {
    if (!data || typeof data !== 'object') return null;
    return data.website || data.site || data.weddingWebsite || data.data?.website || data.data?.site || data;
  }

  function hasMeaningfulSiteContent(site) {
    if (!site) return false;
    const stringFields = [
      'coupleNames', 'welcomeMessage', 'rsvpIntroText', 'rsvpDeadline', 'slug', 'venueName',
      'venueAddress', 'ceremonyTime', 'receptionTime', 'ceremonyVenueName', 'receptionVenueName',
      'ceremonyVenueAddress', 'receptionVenueAddress', 'eventDate',
    ];
    const arrayFields = [
      'accommodationRecommendations', 'taxiRecommendations', 'localInfo', 'weddingParty',
      'faq', 'mealOptions', 'customRsvpQuestions',
    ];
    return stringFields.some(key => String(site[key] || '').trim()) ||
      arrayFields.some(key => Array.isArray(site[key]) && site[key].length > 0);
  }

  function isReadyToPublish(site) {
    if (!site) return false;
    return Boolean(
      String(site.coupleNames || '').trim() &&
      String(site.slug || '').trim() &&
      (String(site.welcomeMessage || '').trim() || String(site.rsvpIntroText || '').trim())
    );
  }

  function setWeddingStatus(label, status) {
    const pill = document.getElementById('wedding-website-status-pill');
    if (!pill) return;
    pill.textContent = label;
    pill.dataset.status = status;
    pill.setAttribute('aria-label', `Wedding website status: ${label}`);
  }

  function setWeddingStatusFromRenderedState(force = false) {
    const root = document.getElementById('wedding-website-dashboard-root');
    const pill = document.getElementById('wedding-website-status-pill');
    if (!root || !pill || (!force && pill.dataset.status)) return;

    const rootText = String(root.textContent || '').toLowerCase();
    if (rootText.includes('your wedding website is live') || root.querySelector('a[href^="/wedding/"], input[value*="/wedding/"]')) {
      setWeddingStatus('Published', 'published');
      return;
    }
    if (root.querySelector('#ww-builder, .ww-builder, #ww-save, #ww-pub')) {
      setWeddingStatus('In progress', 'in-progress');
      return;
    }
    if (root.querySelector('#ww-create, #ww-quick-start, .ww-choice-panel')) setWeddingStatus('Not started', 'not-started');
  }

  async function updateWeddingStatus(plans) {
    const plan = getWeddingPlan(plans);
    if (!plan) {
      setWeddingStatusFromRenderedState(true);
      if (!document.getElementById('wedding-website-status-pill')?.dataset.status) setWeddingStatus('Not started', 'not-started');
      return;
    }

    try {
      const response = await fetch(`/api/me/plans/${encodeURIComponent(plan.id)}/wedding-website`, { credentials: 'include' });
      if (response.status === 404) {
        setWeddingStatusFromRenderedState(true);
        if (!document.getElementById('wedding-website-status-pill')?.dataset.status) setWeddingStatus('Not started', 'not-started');
        return;
      }
      if (!response.ok) {
        setWeddingStatusFromRenderedState(true);
        if (!document.getElementById('wedding-website-status-pill')?.dataset.status) setWeddingStatus('In progress', 'in-progress');
        return;
      }
      const site = getSitePayload(await response.json().catch(() => ({})));
      if (site?.status === 'published') setWeddingStatus('Published', 'published');
      else if (isReadyToPublish(site)) setWeddingStatus('Ready to publish', 'ready');
      else if (hasMeaningfulSiteContent(site)) setWeddingStatus('In progress', 'in-progress');
      else {
        setWeddingStatusFromRenderedState(true);
        if (!document.getElementById('wedding-website-status-pill')?.dataset.status) setWeddingStatus('Draft started', 'in-progress');
      }
    } catch (error) {
      console.warn('Unable to resolve wedding website status:', error);
      setWeddingStatusFromRenderedState(true);
      if (!document.getElementById('wedding-website-status-pill')?.dataset.status && plan) setWeddingStatus('In progress', 'in-progress');
    }
  }

  function collapseIconSvg() {
    return '<svg class="customer-wedding-collapse-toggle__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function setCardCollapsed(card, toggle, collapsed) {
    card.classList.toggle('customer-wedding-card--collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Expand Wedding Website and RSVPs' : 'Minimise Wedding Website and RSVPs');
    toggle.innerHTML = `<span>${collapsed ? 'Expand' : 'Minimise'}</span>${collapseIconSvg()}`;
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (_) { /* ignore */ }
  }

  function setupWeddingCollapse() {
    const card = document.getElementById('wedding-website-dashboard-card');
    if (!card || card.dataset.mopUpCollapseReady === '1') return;
    const header = card.querySelector('.sd-card-header');
    const actions = card.querySelector('.sd-card-header__actions');
    const body = card.querySelector('.cd-card-body');
    if (!header || !actions || !body) return;

    card.dataset.mopUpCollapseReady = '1';
    card.classList.add('customer-wedding-card--collapsible');
    body.id = body.id || 'wedding-website-card-body';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'customer-wedding-collapse-toggle';
    toggle.setAttribute('aria-controls', body.id);
    actions.appendChild(toggle);

    let collapsed = false;
    try { collapsed = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (_) { collapsed = false; }
    setCardCollapsed(card, toggle, collapsed);

    toggle.addEventListener('click', event => {
      event.stopPropagation();
      setCardCollapsed(card, toggle, !card.classList.contains('customer-wedding-card--collapsed'));
    });
    header.addEventListener('click', event => {
      if (event.target.closest('button, a, input, select, textarea')) return;
      setCardCollapsed(card, toggle, !card.classList.contains('customer-wedding-card--collapsed'));
    });
  }

  function isLikelyRecommendationWidget(element) {
    if (!element) return false;
    if (element.matches('.recommendations-widget, #recommendations-widget, [data-recommendations-widget]')) return true;
    return /recommended/i.test(element.textContent || '') && Boolean(element.querySelector('h2, h3'));
  }

  function getRecommendationWidgets() {
    const explicit = Array.from(document.querySelectorAll('.recommendations-widget, #recommendations-widget, [data-recommendations-widget]'));
    const cards = Array.from(document.querySelectorAll('.card, section')).filter(isLikelyRecommendationWidget);
    return Array.from(new Set([...explicit, ...cards]));
  }

  function getRecommendationItems(widget) {
    const selectors = [
      '.recommendation-card', '.supplier-card', '[class*="supplier-card"]', '[class*="recommendation-card"]', 'article'
    ];
    return Array.from(widget.querySelectorAll(selectors.join(','))).filter(card =>
      !card.closest('.recommendations-widget__header, .recommendations-header') &&
      !card.classList.contains('recommendations-widget')
    );
  }

  function normaliseRecommendationRow(widget) {
    const items = getRecommendationItems(widget);
    if (!items.length) return;

    items.forEach((item, index) => {
      item.classList.toggle('ef-rec-hidden', index >= MAX_RECOMMENDATIONS_DESKTOP);
      item.classList.add('ef-rec-item');
    });

    const visibleItems = items.slice(0, MAX_RECOMMENDATIONS_DESKTOP);
    const parents = new Set(visibleItems.map(item => item.parentElement).filter(Boolean));
    if (parents.size === 1) {
      const parent = visibleItems[0].parentElement;
      if (parent && !parent.matches('.recommendations-widget__header, .recommendations-header')) {
        parent.classList.add('ef-recommendations-row');
        return;
      }
    }

    let header = widget.querySelector('.recommendations-widget__header, .recommendations-header');
    if (!header) {
      const heading = Array.from(widget.querySelectorAll('h2, h3')).find(el => /recommended/i.test(el.textContent || ''));
      if (heading) {
        header = document.createElement('div');
        header.className = 'recommendations-widget__header';
        heading.parentNode.insertBefore(header, heading);
        header.appendChild(heading);
      }
    }

    let row = widget.querySelector(':scope > .ef-recommendations-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'ef-recommendations-row';
      if (header?.parentElement === widget) header.after(row);
      else widget.appendChild(row);
    }
    items.forEach(item => row.appendChild(item));
  }

  function compactRecommendationsHeader() {
    getRecommendationWidgets().forEach(widget => {
      const headings = Array.from(widget.querySelectorAll('h2, h3'));
      const heading = headings.find(el => /recommended/i.test(el.textContent || '')) || headings[0];
      if (!heading) return;

      widget.classList.add('recommendations-widget');
      let header = heading.closest('.recommendations-widget__header, .recommendations-header, .section-header, .card-header');
      if (!header) {
        header = document.createElement('div');
        header.className = 'recommendations-widget__header';
        heading.parentNode.insertBefore(header, heading);
        header.appendChild(heading);
      } else {
        header.classList.add('recommendations-widget__header');
      }

      const existingViewAll = Array.from(header.querySelectorAll('a')).find(a => /view all/i.test(a.textContent || '')) ||
        Array.from(widget.querySelectorAll('a')).find(a => /view all/i.test(a.textContent || ''));
      if (existingViewAll) {
        existingViewAll.classList.add('recommendations-view-all');
        if (existingViewAll.parentElement !== header) header.appendChild(existingViewAll);
      } else {
        const link = document.createElement('a');
        link.href = '/suppliers';
        link.className = 'recommendations-view-all';
        link.textContent = 'View All →';
        header.appendChild(link);
      }

      normaliseRecommendationRow(widget);
    });
  }

  async function getPlans() {
    try {
      const response = await fetch('/api/me/plans', { credentials: 'include' });
      if (!response.ok) return [];
      const data = await response.json();
      return data.plans || [];
    } catch (_) {
      return [];
    }
  }

  function runLightweightPass() {
    removeDuplicateWelcomeDismissButton();
    setupWeddingCollapse();
    compactRecommendationsHeader();
    setWeddingStatusFromRenderedState();
  }

  function queueLightweightPass() {
    if (observerQueued) return;
    observerQueued = true;
    window.requestAnimationFrame(() => {
      observerQueued = false;
      runLightweightPass();
    });
  }

  async function init() {
    injectStyles();
    runLightweightPass();
    const plans = await getPlans();
    await updateWeddingStatus(plans);
    observer = new MutationObserver(queueLightweightPass);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
  }

  window.addEventListener('beforeunload', () => { if (observer) observer.disconnect(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
