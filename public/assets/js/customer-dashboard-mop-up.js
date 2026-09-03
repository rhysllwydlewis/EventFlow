/*
 * Customer Dashboard Desktop Mop-up
 * Handles welcome cleanup, wedding website status and the specialist wedding card launcher.
 * Recommendation layout is intentionally handled in customer-dashboard-polish.js to avoid double-normalising cards.
 */
'use strict';
(function () {
  const CUSTOMER_PATHS = new Set(['/dashboard/customer', '/dashboard-customer.html']);
  if (!CUSTOMER_PATHS.has(window.location.pathname)) {
    return;
  }

  const STYLE_ID = 'customer-dashboard-mop-up-styles';
  const REFRESH_EVENT = 'eventflow:customer-dashboard-mop-up-ready';
  let observer;
  let observerQueued = false;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .customer-dashboard-page .container { max-width: 1420px; }
      .customer-welcome-card > .customer-welcome-dismiss:first-child { display: none !important; }
      .customer-welcome-card { padding-top: clamp(1.35rem, 2.5vw, 2rem) !important; }
      .customer-welcome-card .customer-welcome-footer { box-shadow: inset 0 1px 0 rgba(255, 255, 255, .85); }

      #wedding-website-dashboard-card.customer-wedding-card--open-app-only {
        overflow: hidden;
      }
      #wedding-website-dashboard-card .customer-wedding-collapse-toggle,
      #wedding-website-dashboard-card .ef-dashboard-collapse-toggle,
      #wedding-website-dashboard-card .card-collapse-btn {
        display: none !important;
      }
      #wedding-website-dashboard-card > .cd-card-body,
      #wedding-website-dashboard-card > .card-body-collapsible {
        display: none !important;
      }

      #wedding-website-status-pill.customer-wedding-status-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 2.15rem;
        padding: .42rem .78rem;
        border: 1px solid transparent;
        border-radius: 999px;
        font-size: 0.8125rem;
        font-weight: 850;
        line-height: 1;
        white-space: nowrap;
      }
      #wedding-website-status-pill[data-status="not-started"] { background: #f8fafc; border-color: rgba(148, 163, 184, .38); color: #334155; }
      #wedding-website-status-pill[data-status="in-progress"] { background: #fffbeb; border-color: rgba(245, 158, 11, .38); color: #92400e; }
      #wedding-website-status-pill[data-status="ready"] { background: #ecfeff; border-color: rgba(6, 182, 212, .32); color: #0e7490; }
      #wedding-website-status-pill[data-status="published"],
      #wedding-website-status-pill[data-status="complete"] { background: #dcfce7; border-color: rgba(22, 163, 74, .32); color: #166534; }

      @media (min-width: 900px) {
        #wedding-website-dashboard-card .sd-card-header__actions { align-items: center; gap: .65rem; flex-wrap: nowrap; }
      }
      @media (max-width: 700px) {
        #wedding-website-dashboard-card .sd-card-header__actions { justify-content: flex-start; width: 100%; }
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
      const label = String(button.textContent || '')
        .trim()
        .toLowerCase();
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

  function getSitePayload(data) {
    if (!data || typeof data !== 'object') {
      return null;
    }
    return (
      data.website ||
      data.site ||
      data.weddingWebsite ||
      data.data?.website ||
      data.data?.site ||
      data
    );
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
      'venueName',
      'venueAddress',
      'ceremonyTime',
      'receptionTime',
      'ceremonyVenueName',
      'receptionVenueName',
      'ceremonyVenueAddress',
      'receptionVenueAddress',
      'eventDate',
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
    return (
      stringFields.some(key => String(site[key] || '').trim()) ||
      arrayFields.some(key => Array.isArray(site[key]) && site[key].length > 0)
    );
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

  function setWeddingStatusFromRenderedState(force = false) {
    const root = document.getElementById('wedding-website-dashboard-root');
    const pill = document.getElementById('wedding-website-status-pill');
    if (!root || !pill || (!force && pill.dataset.status)) {
      return;
    }

    const rootText = String(root.textContent || '').toLowerCase();
    if (
      rootText.includes('your wedding website is live') ||
      root.querySelector('a[href^="/wedding/"], input[value*="/wedding/"]')
    ) {
      setWeddingStatus('Published', 'published');
      return;
    }
    if (root.querySelector('#ww-builder, .ww-builder, #ww-save, #ww-pub')) {
      setWeddingStatus('In progress', 'in-progress');
      return;
    }
    if (root.querySelector('#ww-create, #ww-quick-start, .ww-choice-panel')) {
      setWeddingStatus('Not started', 'not-started');
    }
  }

  async function updateWeddingStatus(plans) {
    const plan = getWeddingPlan(plans);
    if (!plan) {
      setWeddingStatusFromRenderedState(true);
      if (!document.getElementById('wedding-website-status-pill')?.dataset.status) {
        setWeddingStatus('Not started', 'not-started');
      }
      return;
    }

    try {
      const response = await fetch(`/api/me/plans/${encodeURIComponent(plan.id)}/wedding-website`, {
        credentials: 'include',
      });
      if (response.status === 404) {
        setWeddingStatusFromRenderedState(true);
        if (!document.getElementById('wedding-website-status-pill')?.dataset.status) {
          setWeddingStatus('Not started', 'not-started');
        }
        return;
      }
      if (!response.ok) {
        setWeddingStatusFromRenderedState(true);
        if (!document.getElementById('wedding-website-status-pill')?.dataset.status) {
          setWeddingStatus('In progress', 'in-progress');
        }
        return;
      }
      const site = getSitePayload(await response.json().catch(() => ({})));
      if (site?.status === 'published') {
        setWeddingStatus('Published', 'published');
      } else if (isReadyToPublish(site)) {
        setWeddingStatus('Ready to publish', 'ready');
      } else if (hasMeaningfulSiteContent(site)) {
        setWeddingStatus('In progress', 'in-progress');
      } else {
        setWeddingStatusFromRenderedState(true);
        if (!document.getElementById('wedding-website-status-pill')?.dataset.status) {
          setWeddingStatus('Draft started', 'in-progress');
        }
      }
    } catch (error) {
      console.warn('Unable to resolve wedding website status:', error);
      setWeddingStatusFromRenderedState(true);
      if (!document.getElementById('wedding-website-status-pill')?.dataset.status && plan) {
        setWeddingStatus('In progress', 'in-progress');
      }
    }
  }

  function setupWeddingCollapse() {
    const card = document.getElementById('wedding-website-dashboard-card');
    if (!card) {
      return;
    }
    const body = card.querySelector('.cd-card-body');
    const wrapper = card.querySelector(':scope > .card-body-collapsible');

    card.dataset.mopUpCollapseReady = '1';
    card.classList.remove('customer-wedding-card--collapsible', 'customer-wedding-card--collapsed');
    card.classList.add('customer-wedding-card--open-app-only', 'no-collapse');
    card.querySelectorAll('.customer-wedding-collapse-toggle').forEach(toggle => toggle.remove());

    if (wrapper) {
      while (wrapper.firstChild) {
        card.insertBefore(wrapper.firstChild, wrapper);
      }
      wrapper.remove();
    }
    if (body) {
      body.hidden = false;
      body.style.removeProperty('display');
      body.style.removeProperty('max-height');
      body.style.removeProperty('opacity');
    }
  }

  function runLightweightPass() {
    removeDuplicateWelcomeDismissButton();
    setupWeddingCollapse();
    setWeddingStatusFromRenderedState();
  }

  function queueLightweightPass() {
    if (observerQueued) {
      return;
    }
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
