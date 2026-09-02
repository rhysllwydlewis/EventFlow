'use strict';
(function () {
  if (window.__weddingMongoAuthorityLoaded) {
    return;
  }
  window.__weddingMongoAuthorityLoaded = true;

  const rootSelector = '#wedding-website-dashboard-root';
  const MAX_ATTEMPTS = 80;
  let refreshPromise = null;

  function isWeddingPlan(plan) {
    const type = String((plan && plan.eventType) || '').toLowerCase();
    const name = String((plan && (plan.name || plan.eventName)) || '').toLowerCase();
    return Boolean(plan && plan.weddingWebsite) || type === 'wedding' || name.includes('wedding');
  }

  function normalisePlan(plan) {
    if (!plan || !plan.weddingWebsite) {
      return plan;
    }
    return {
      ...plan,
      eventType: plan.eventType || 'wedding',
      name: plan.name || plan.eventName || plan.weddingWebsite.coupleNames || 'Wedding Website',
      eventDate: plan.eventDate || plan.date || plan.weddingWebsite.eventDate || null,
      date: plan.date || plan.eventDate || plan.weddingWebsite.eventDate || null,
    };
  }

  function rootLooksCacheDependent(root) {
    if (!root) {
      return false;
    }
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
    if (!response.ok) {
      throw new Error('Unable to load server plans');
    }
    const data = await response.json().catch(() => ({}));
    return Array.isArray(data.plans) ? data.plans : [];
  }

  function markRoot(root, plan) {
    if (!root || !plan) {
      return;
    }
    root.dataset.planId = plan.id || '';
    root.dataset.mongodbBacked = 'true';
    root.dataset.cacheIndependent = 'true';
  }

  async function refreshFromMongo() {
    if (refreshPromise) {
      return refreshPromise;
    }

    refreshPromise = (async () => {
      const root = document.querySelector(rootSelector);
      if (!root || typeof window.initWeddingWebsiteDashboard !== 'function') {
        return;
      }

      const plans = (await fetchServerPlans()).map(normalisePlan);
      const weddingPlans = plans.filter(isWeddingPlan);
      if (!weddingPlans.length) {
        return;
      }

      const authoritativePlan = weddingPlans.find(plan => plan.weddingWebsite) || weddingPlans[0];
      markRoot(root, authoritativePlan);

      if (rootLooksCacheDependent(root) || root.dataset.authorityRefreshed !== 'true') {
        root.dataset.authorityRefreshed = 'true';
        await window.initWeddingWebsiteDashboard(plans);
        markRoot(document.querySelector(rootSelector), authoritativePlan);
      }
    })().finally(() => {
      refreshPromise = null;
    });

    return refreshPromise;
  }

  function scheduleRefresh() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const root = document.querySelector(rootSelector);
      if (root && typeof window.initWeddingWebsiteDashboard === 'function') {
        clearInterval(timer);
        refreshFromMongo().catch(err => {
          if (window.__EF_DEBUG__) {
            console.warn('[wedding-mongodb-authority]', err);
          }
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
      refreshFromMongo().catch(() => {
        // Optional background refresh only; never block dashboard usage.
      });
    }
  });
})();
