'use strict';
(function () {
  if (window.__wwPreviewPublishHardenerLoaded) {
    return;
  }
  window.__wwPreviewPublishHardenerLoaded = true;

  const ROOT_SELECTOR = '#wedding-website-dashboard-root';
  const PREVIEW_SELECTOR = '.ww-builder-actions a[href^="/wedding/"]';
  let cachedPlansPromise = null;
  let queued = false;

  function esc(value) {
    return String(value || '').replace(
      /[&<>"']/g,
      ch =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[ch]
    );
  }

  function getRoot(fromElement) {
    return fromElement?.closest?.(ROOT_SELECTOR) || document.querySelector(ROOT_SELECTOR);
  }

  function getStatusEl(root) {
    let el = root?.querySelector('.ww-status-msg');
    if (!el && root) {
      el = document.createElement('div');
      el.className = 'ww-status-msg ww-preview-status';
      root.querySelector('.ww-builder-actions, .ww-actions')?.after(el);
    }
    return el;
  }

  function showStatus(root, message, type = 'info') {
    const el = getStatusEl(root);
    if (!el) {
      return;
    }
    el.dataset.previewHardened = 'true';
    el.dataset.type = type;
    el.innerHTML = `<p>${esc(message)}</p>`;
  }

  function currentSlug(root, previewLink) {
    const formSlug = String(root?.querySelector('[name="slug"]')?.value || '').trim();
    if (formSlug) {
      return formSlug
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .pop();
    }
    const href = previewLink?.getAttribute('href') || '';
    const match = href.match(/\/wedding\/([^?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function currentPlanIdFromDom(root) {
    const direct =
      root?.dataset?.planId || root?.closest?.('[data-plan-id]')?.dataset?.planId || '';
    if (direct) {
      return direct;
    }
    const apiLink = root?.querySelector?.('[href*="/api/me/plans/"], [action*="/api/me/plans/"]');
    const apiUrl = apiLink?.getAttribute('href') || apiLink?.getAttribute('action') || '';
    const match = apiUrl.match(/\/api\/me\/plans\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  async function fetchPlans() {
    if (!cachedPlansPromise) {
      cachedPlansPromise = fetch('/api/me/plans?source=mongodb&wedding=1', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
      })
        .then(res => (res.ok ? res.json() : null))
        .then(data => (Array.isArray(data?.plans) ? data.plans : []))
        .catch(() => []);
    }
    return cachedPlansPromise;
  }

  function isWeddingPlan(plan) {
    const type = String(plan?.eventType || '').toLowerCase();
    const name = String(plan?.name || plan?.eventName || '').toLowerCase();
    return Boolean(plan?.weddingWebsite) || type === 'wedding' || name.includes('wedding');
  }

  async function resolvePlanContext(root, previewLink) {
    const domPlanId = currentPlanIdFromDom(root);
    const slug = currentSlug(root, previewLink);
    if (domPlanId && slug) {
      return { planId: domPlanId, slug };
    }

    const plans = await fetchPlans();
    const weddingPlans = plans.filter(isWeddingPlan);
    const matched =
      weddingPlans.find(plan => String(plan.id) === String(domPlanId)) ||
      weddingPlans.find(plan => String(plan.weddingWebsite?.slug || '') === String(slug)) ||
      weddingPlans.find(plan => plan.weddingWebsite) ||
      weddingPlans[0] ||
      null;

    if (matched?.id && root) {
      root.dataset.planId = matched.id;
    }

    return {
      planId: matched?.id || domPlanId || '',
      slug: slug || matched?.weddingWebsite?.slug || '',
    };
  }

  function previewUrl(context) {
    if (!context.planId || !context.slug) {
      return '';
    }
    const params = new URLSearchParams({ preview: '1', plan: context.planId });
    return `/wedding/${encodeURIComponent(context.slug)}?${params.toString()}`;
  }

  function previewLabel(root) {
    const publishButtonText = String(
      root?.querySelector('#ww-pub')?.textContent || ''
    ).toLowerCase();
    return publishButtonText.includes('unpublish') ? 'Preview live site' : 'Preview draft';
  }

  function isDirty(root) {
    const state = root?.querySelector('#ww-save-state');
    return (
      String(state?.dataset?.state || '').toLowerCase() === 'dirty' ||
      String(state?.textContent || '')
        .toLowerCase()
        .includes('unsaved')
    );
  }

  async function hardenPreviewLink(previewLink) {
    if (!previewLink) {
      return;
    }
    const root = getRoot(previewLink);
    if (!root?.querySelector('#ww-builder')) {
      return;
    }

    previewLink.classList.add('ww-preview-link-hardened');
    previewLink.textContent = previewLabel(root);
    previewLink.setAttribute('aria-label', 'Preview this wedding website safely');

    const context = await resolvePlanContext(root, previewLink);
    const url = previewUrl(context);
    if (url) {
      previewLink.href = url;
      previewLink.dataset.planId = context.planId;
      previewLink.dataset.previewSlug = context.slug;
      previewLink.title =
        'Opens an authenticated preview. Draft sites do not need to be publicly published first.';
    }

    if (previewLink.dataset.previewHardenerBound === 'true') {
      return;
    }
    previewLink.dataset.previewHardenerBound = 'true';
    previewLink.addEventListener(
      'click',
      async event => {
        const activeRoot = getRoot(previewLink);
        const nextContext = await resolvePlanContext(activeRoot, previewLink);
        const nextUrl = previewUrl(nextContext);
        if (!nextUrl) {
          event.preventDefault();
          showStatus(
            activeRoot,
            'Unable to find the saved wedding website. Save the workspace, then preview again.',
            'warn'
          );
          return;
        }

        if (isDirty(activeRoot)) {
          showStatus(
            activeRoot,
            'Preview is opening the latest saved version. Use Save first if you want this preview to include unsaved edits.',
            'info'
          );
        }

        event.preventDefault();
        window.open(nextUrl, '_blank', 'noopener');
      },
      true
    );
  }

  function injectStyles() {
    if (document.getElementById('ww-preview-publish-hardener-styles')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'ww-preview-publish-hardener-styles';
    style.textContent = `
      .ww-preview-link-hardened {
        border-color: rgba(80, 192, 176, 0.3) !important;
      }
      .ww-preview-status[data-type='info'] {
        border-color: rgba(44, 148, 177, 0.22) !important;
        background: rgba(239, 250, 252, 0.74) !important;
        color: #24436f !important;
      }
      .ww-preview-status[data-type='warn'] {
        border-color: rgba(185, 171, 46, 0.28) !important;
        background: rgba(255, 251, 235, 0.82) !important;
        color: #7a6210 !important;
      }
      .ww-preview-status p {
        margin: 0;
      }
    `;
    document.head.appendChild(style);
  }

  function enhance() {
    injectStyles();
    document.querySelectorAll(PREVIEW_SELECTOR).forEach(link => {
      hardenPreviewLink(link).catch(() => {
        const root = getRoot(link);
        showStatus(
          root,
          'Preview setup could not complete. Save the website and try again.',
          'warn'
        );
      });
    });
  }

  function schedule() {
    if (queued) {
      return;
    }
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      enhance();
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('input', event => {
    if (event.target instanceof Element && event.target.matches('[name="slug"], #ww-save-state')) {
      schedule();
    }
  });
  document.addEventListener('click', event => {
    if (
      event.target instanceof Element &&
      event.target.closest('.ww-app-tabs button, #ww-save, #ww-pub')
    ) {
      window.setTimeout(schedule, 300);
      window.setTimeout(schedule, 1200);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }
})();
