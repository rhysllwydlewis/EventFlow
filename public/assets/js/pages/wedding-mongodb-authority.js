(function () {
  'use strict';

  if (window.__weddingMongoAuthorityLoaded) return;
  window.__weddingMongoAuthorityLoaded = true;

  const rootSelector = '#wedding-website-dashboard-root';
  const MAX_ATTEMPTS = 80;

  function isWeddingPlan(plan) {
    const type = String(plan && plan.eventType || '').toLowerCase();
    const name = String(plan && (plan.name || plan.eventName) || '').toLowerCase();
    return Boolean(plan && plan.weddingWebsite) || type === 'wedding' || name.includes('wedding');
  }

  function normalisePlan(plan) {
    if (!plan || !plan.weddingWebsite) return plan;
    return {
      ...plan,
      eventType: plan.eventType || 'wedding',
      name: plan.name || plan.eventName || plan.weddingWebsite.coupleNames || 'Wedding Website',
      eventDate: plan.eventDate || plan.date || plan.weddingWebsite.eventDate || null,
      date: plan.date || plan.eventDate || plan.weddingWebsite.eventDate || null,
    };
  }

  function rootLooksCacheDependent(root) {
    if (!root) return false;
    const text = String(root.textContent || '').toLowerCase();
    return (
      text.includes('create wedding website') ||
      text.includes('start with a free wedding website') ||
      text.includes('use an existing plan') ||
      !root.querySelector('#ww-builder')
    );
  }

  async function fetchServerPlans() {
    const response = await fetch('/api/me/plans?source=mongodb&wedding=1', {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    });
    if (!response.ok) throw new Error('Unable to load server plans');
    const data = await response.json().catch(() => ({}));
    return Array.isArray(data.plans) ? data.plans : [];
  }

  async function refreshFromMongo() {
    const root = document.querySelector(rootSelector);
    if (!root || typeof window.initWeddingWebsiteDashboard !== 'function') return;
    const plans = (await fetchServerPlans()).map(normalisePlan);
    const weddingPlans = plans.filter(isWeddingPlan);
    if (!weddingPlans.length) return;

    // Keep a server-backed marker for the enhancement scripts that currently infer the plan id from the DOM.
    root.dataset.planId = weddingPlans[0].id || '';
    root.dataset.mongodbBacked = 'true';
    root.dataset.cacheIndependent = 'true';

    // Re-render from the authoritative server payload when the current view appears to be a cache/local-state fallback.
    if (rootLooksCacheDependent(root) || root.dataset.authorityRefreshed !== 'true') {
      root.dataset.authorityRefreshed = 'true';
      await window.initWeddingWebsiteDashboard(plans);
      const refreshedRoot = document.querySelector(rootSelector);
      if (refreshedRoot && weddingPlans[0]?.id) {
        refreshedRoot.dataset.planId = weddingPlans[0].id;
        refreshedRoot.dataset.mongodbBacked = 'true';
        refreshedRoot.dataset.cacheIndependent = 'true';
      }
    }
  }

  function scheduleRefresh() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const root = document.querySelector(rootSelector);
      if (root && typeof window.initWeddingWebsiteDashboard === 'function') {
        clearInterval(timer);
        refreshFromMongo().catch(err => {
          if (window.__EF_DEBUG__) console.warn('[wedding-mongodb-authority]', err);
        });
      } else if (attempts >= MAX_ATTEMPTS) {
        clearInterval(timer);
      }
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleRefresh);
  } else {
    scheduleRefresh();
  }

  window.addEventListener('focus', () => {
    const root = document.querySelector(rootSelector);
    if (root && root.dataset.cacheIndependent !== 'true') {
      refreshFromMongo().catch(() => {});
    }
  });
})();
