(function () {
  'use strict';

  if (window.__weddingPublishMopUpLoaded) return;
  window.__weddingPublishMopUpLoaded = true;

  const rootSelector = '#wedding-website-dashboard-root';
  const readiness = {
    coupleNames: { label: 'Couple Names', selector: '[name="coupleNames"]', help: 'Add the couple names shown on the public wedding website.' },
    eventDate: { label: 'Event Date', selector: '[name="eventDate"]', help: 'Add the date of the wedding or main celebration.' },
    venue: { label: 'Venue Details', selector: '[name="ceremonyVenueName"], [name="receptionVenueName"]', help: 'Add at least one venue name so guests know where to go.' },
    rsvpEnabled: { label: 'RSVP Settings', selector: '[name="rsvpEnabled"]', help: 'Enable RSVPs before publishing the guest website.' },
    slug: { label: 'Website Link', selector: '.ww-share-card input, a[href^="/wedding/"]', help: 'Generate or save a valid public website link.' },
    password: { label: 'Website Password', selector: '[name="password"]', help: 'Set a password before publishing a password-protected website.' },
  };
  const requiredKeys = ['coupleNames', 'eventDate', 'venue'];
  let lastPlanId = '';
  let lastWebsitePromise = null;

  function esc(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    const tokenFromMeta = meta?.getAttribute('content');
    if (tokenFromMeta) return tokenFromMeta;
    const cookieMatch = document.cookie.match(/(?:^|; )csrfToken=([^;]+)/);
    return cookieMatch ? decodeURIComponent(cookieMatch[1]) : '';
  }

  async function api(path, options = {}) {
    const opts = { ...options, credentials: options.credentials || 'same-origin' };
    const method = String(opts.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      opts.headers = { ...(opts.headers || {}) };
      const csrfToken = getCsrfToken();
      if (csrfToken && !opts.headers['X-CSRF-Token']) opts.headers['X-CSRF-Token'] = csrfToken;
    }
    const res = await fetch(path, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || 'Request failed');
      err.payload = json;
      throw err;
    }
    return json;
  }

  function findPlanId(root) {
    const exportLink = root.querySelector("a[href*='/api/me/plans/'][href$='/guests/export.csv']");
    const match = exportLink?.getAttribute('href')?.match(/\/api\/me\/plans\/([^/]+)\/guests\/export\.csv/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function getStatusEl(root) {
    let el = root.querySelector('.ww-status-msg');
    if (!el) {
      el = document.createElement('div');
      el.className = 'ww-status-msg';
      const actions = root.querySelector('.ww-builder-actions, .ww-actions');
      actions?.after(el);
    }
    return el;
  }

  function focusTarget(key) {
    const root = document.querySelector(rootSelector);
    const config = readiness[key] || readiness[String(key || '').trim()];
    if (!root || !config) return;
    let target = root.querySelector(config.selector);
    if (!target && key === 'venue') {
      target = root.querySelector('[name="ceremonyVenueName"]') || root.querySelector('[name="receptionVenueName"]');
    }
    if (!target) return;
    const details = target.closest('details');
    if (details) details.open = true;
    setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.focus?.({ preventScroll: true });
      target.classList.add('ww-field-pulse');
      setTimeout(() => target.classList.remove('ww-field-pulse'), 1200);
    }, 60);
  }

  function valueOf(root, selector) {
    return String(root.querySelector(selector)?.value || '').trim();
  }

  function collectEssentials(root) {
    return {
      coupleNames: valueOf(root, '[name="coupleNames"]'),
      eventDate: valueOf(root, '[name="eventDate"]'),
      ceremonyVenueName: valueOf(root, '[name="ceremonyVenueName"]'),
      ceremonyVenueAddress: valueOf(root, '[name="ceremonyVenueAddress"]'),
      receptionVenueName: valueOf(root, '[name="receptionVenueName"]'),
      receptionVenueAddress: valueOf(root, '[name="receptionVenueAddress"]'),
    };
  }

  function getMissingKeys(root) {
    const data = collectEssentials(root);
    const missing = [];
    if (!data.coupleNames) missing.push('coupleNames');
    if (!data.eventDate) missing.push('eventDate');
    if (!data.ceremonyVenueName && !data.receptionVenueName) missing.push('venue');
    return missing;
  }

  function renderMissingStatus(root, missing) {
    const statusEl = getStatusEl(root);
    const cards = missing
      .map(key => {
        const config = readiness[key] || { label: key, help: 'Complete this item before publishing.' };
        return `<button type="button" class="ww-checklist-link" data-target="${esc(key)}"><span>${esc(config.label)}</span><small>${esc(config.help)}</small></button>`;
      })
      .join('');
    statusEl.dataset.enhancedChecklist = 'true';
    statusEl.innerHTML = `<div class="ww-publish-guidance"><strong>Before publishing, please complete:</strong><div class="ww-checklist-grid">${cards}</div></div>`;
    statusEl.querySelectorAll('.ww-checklist-link').forEach(button => {
      button.addEventListener('click', () => focusTarget(button.dataset.target));
    });
  }

  function renderReadinessCard(root) {
    const actions = root.querySelector('.ww-builder-actions');
    if (!actions) return;
    let card = root.querySelector('.ww-readiness-card');
    if (!card) {
      card = document.createElement('section');
      card.className = 'ww-readiness-card';
      actions.after(card);
    }
    const missing = getMissingKeys(root);
    const states = requiredKeys.map(key => ({ key, ok: !missing.includes(key), ...readiness[key] }));
    const complete = states.filter(item => item.ok).length;
    const total = states.length;
    const ready = complete === total;
    card.innerHTML = `<div class="ww-readiness-card__head"><div><p class="ww-readiness-kicker">Publish readiness</p><h4>${ready ? 'Ready to save and publish' : `${total - complete} item${total - complete === 1 ? '' : 's'} left before publishing`}</h4></div><span class="ww-readiness-score ${ready ? 'ww-readiness-score--ready' : ''}">${complete}/${total}</span></div><div class="ww-readiness-list">${states.map(item => `<button type="button" class="ww-readiness-item ${item.ok ? 'is-complete' : ''}" data-target="${esc(item.key)}"><span aria-hidden="true">${item.ok ? '✓' : '•'}</span><strong>${esc(item.label)}</strong><small>${item.ok ? 'Completed' : esc(item.help)}</small></button>`).join('')}</div>${ready ? '<p class="ww-publish-helper">These essentials are complete. Publish will now save these details first, then publish the website.</p>' : ''}`;
    card.querySelectorAll('[data-target]').forEach(button => {
      button.addEventListener('click', () => focusTarget(button.dataset.target));
    });
  }

  function enhanceStatusMessage(statusEl) {
    if (!statusEl || statusEl.dataset.enhancedChecklist === 'true') return;
    const items = Array.from(statusEl.querySelectorAll('li'));
    if (!items.length) return;
    renderMissingStatus(document.querySelector(rootSelector), items.map(li => String(li.textContent || '').trim()).filter(Boolean));
  }

  async function fetchWebsite(planId) {
    if (!planId) return null;
    if (lastPlanId === planId && lastWebsitePromise) return lastWebsitePromise;
    lastPlanId = planId;
    lastWebsitePromise = fetch(`/api/me/plans/${encodeURIComponent(planId)}/wedding-website`, {
      credentials: 'same-origin',
      headers: { 'Cache-Control': 'no-cache' },
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => data?.website || null)
      .catch(() => null);
    return lastWebsitePromise;
  }

  function ensureEssentialsFields(root, website) {
    const form = root.querySelector('#ww-builder');
    if (!form || form.querySelector('.ww-publish-essentials')) return;
    const essentials = Array.from(form.querySelectorAll('details')).find(d =>
      String(d.querySelector('summary')?.textContent || '').trim().toLowerCase().includes('essentials')
    );
    if (!essentials) return;
    const panel = document.createElement('div');
    panel.className = 'ww-publish-essentials';
    panel.innerHTML = `
      <div class="ww-form-grid ww-form-grid--publish">
        <label>Event Date<input name="eventDate" type="date" value="${esc(String(website?.eventDate || '').slice(0, 10))}"></label>
        <label>Ceremony Venue Name<input name="ceremonyVenueName" value="${esc(website?.ceremonyVenueName || '')}" placeholder="e.g. Cardiff Church"></label>
        <label>Ceremony Venue Address<input name="ceremonyVenueAddress" value="${esc(website?.ceremonyVenueAddress || '')}" placeholder="Address guests can use for directions"></label>
        <label>Reception Venue Name<input name="receptionVenueName" value="${esc(website?.receptionVenueName || '')}" placeholder="e.g. The Manor House"></label>
        <label>Reception Venue Address<input name="receptionVenueAddress" value="${esc(website?.receptionVenueAddress || '')}" placeholder="Address guests can use for directions"></label>
      </div>
      <p class="small ww-publish-helper">Publishing needs an event date and at least one venue name. These details also improve the public schedule, venue cards and map links.</p>`;
    essentials.querySelector('summary').insertAdjacentElement('afterend', panel);
    panel.addEventListener('input', () => {
      renderReadinessCard(root);
      const currentMissing = getMissingKeys(root);
      if (!currentMissing.length) {
        const statusEl = root.querySelector('.ww-status-msg');
        if (statusEl?.textContent?.includes('Before publishing')) statusEl.remove();
      }
    });
    panel.addEventListener('change', () => renderReadinessCard(root));
  }

  function enhancePreviewLink(root) {
    const preview = root.querySelector('.ww-builder-actions a[href^="/wedding/"]');
    if (!preview || preview.dataset.publishMopUp === 'true') return;
    preview.dataset.publishMopUp = 'true';
    preview.addEventListener('click', event => {
      const shareCard = root.querySelector('.ww-share-card');
      const isDraft = shareCard?.textContent?.toLowerCase().includes('not live yet');
      if (isDraft) {
        event.preventDefault();
        shareCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        shareCard.classList.add('ww-field-pulse');
        setTimeout(() => shareCard.classList.remove('ww-field-pulse'), 1200);
      }
    });
  }

  async function syncEssentialsBeforePublish(root) {
    const planId = findPlanId(root);
    if (!planId) return;
    const payload = collectEssentials(root);
    await api(`/api/me/plans/${encodeURIComponent(planId)}/wedding-website`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    lastWebsitePromise = null;
  }

  async function enhance(root) {
    const form = root.querySelector('#ww-builder');
    if (!form || root.dataset.publishMopUpReady === 'true') return;
    root.dataset.publishMopUpReady = 'true';
    const website = await fetchWebsite(findPlanId(root));
    ensureEssentialsFields(root, website);
    enhancePreviewLink(root);
    renderReadinessCard(root);
    form.addEventListener('input', event => {
      if (event.target?.matches?.('[name="coupleNames"], [name="eventDate"], [name="ceremonyVenueName"], [name="receptionVenueName"]')) {
        renderReadinessCard(root);
      }
    });
    root.querySelectorAll('.ww-status-msg').forEach(enhanceStatusMessage);
  }

  document.addEventListener(
    'click',
    async event => {
      const publishButton = event.target.closest('#ww-pub');
      if (!publishButton || publishButton.dataset.mopUpBypass === 'true') return;
      if (String(publishButton.textContent || '').toLowerCase().includes('unpublish')) return;
      const root = document.querySelector(rootSelector);
      if (!root?.querySelector('#ww-builder')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const missing = getMissingKeys(root);
      renderReadinessCard(root);
      if (missing.length) {
        renderMissingStatus(root, missing);
        focusTarget(missing[0]);
        return;
      }
      publishButton.disabled = true;
      publishButton.textContent = 'Saving…';
      try {
        await syncEssentialsBeforePublish(root);
        const statusEl = root.querySelector('.ww-status-msg');
        if (statusEl?.textContent?.includes('Before publishing')) statusEl.remove();
        publishButton.dataset.mopUpBypass = 'true';
        publishButton.disabled = false;
        publishButton.textContent = 'Publish';
        publishButton.click();
        setTimeout(() => delete publishButton.dataset.mopUpBypass, 800);
      } catch (_err) {
        publishButton.disabled = false;
        publishButton.textContent = 'Publish';
        getStatusEl(root).textContent = 'Unable to save publish details. Please try Save, then Publish again.';
      }
    },
    true
  );

  function waitForRoot() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const root = document.querySelector(rootSelector);
      if (root?.querySelector('#ww-builder')) {
        clearInterval(timer);
        enhance(root);
      } else if (attempts > 80) {
        clearInterval(timer);
      }
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForRoot);
  } else {
    waitForRoot();
  }
})();
