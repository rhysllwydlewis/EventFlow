'use strict';
(function () {
  if (window.__weddingPasswordDashboardLoaded) {
    return;
  }
  window.__weddingPasswordDashboardLoaded = true;

  const rootSelector = '#wedding-website-dashboard-root';
  let statePromise = null;
  let statePlanId = '';

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

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    const tokenFromMeta = meta?.getAttribute('content');
    if (tokenFromMeta) {
      return tokenFromMeta;
    }
    const cookieMatch = document.cookie.match(/(?:^|; )csrfToken=([^;]+)/);
    return cookieMatch ? decodeURIComponent(cookieMatch[1]) : '';
  }

  async function api(path, options = {}) {
    const opts = { ...options, credentials: options.credentials || 'same-origin' };
    const method = String(opts.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      opts.headers = { ...(opts.headers || {}) };
      const csrfToken = getCsrfToken();
      if (csrfToken && !opts.headers['X-CSRF-Token']) {
        opts.headers['X-CSRF-Token'] = csrfToken;
      }
    }
    const res = await fetch(path, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error || 'Request failed');
    }
    return json;
  }

  function planIdFromDom(root) {
    if (root?.dataset?.planId) {
      return root.dataset.planId;
    }
    const candidates = Array.from(
      root.querySelectorAll("a[href*='/api/me/plans/'], a[href*='/guests/export.csv']")
    );
    for (const link of candidates) {
      const match = link.getAttribute('href')?.match(/\/api\/me\/plans\/([^/]+)/);
      if (match) {
        return decodeURIComponent(match[1]);
      }
    }
    return '';
  }

  function updateVisibilityUi(form) {
    const selected =
      form.querySelector("input[name='visibility']:checked")?.value || 'private_link';
    const passwordFields = form.querySelector('.ww-password-fields');
    const passwordInput = form.querySelector("input[name='password']");
    if (passwordFields) {
      passwordFields.hidden = selected !== 'password';
    }
    if (passwordInput) {
      passwordInput.required = selected === 'password' && form.dataset.passwordSet !== 'true';
    }
  }

  function renderShareCard(root, website) {
    const actions = root.querySelector('.ww-builder-actions, .ww-actions');
    if (!actions || !website || root.querySelector('.ww-share-card')) {
      return;
    }
    const card = document.createElement('section');
    card.className = 'ww-share-card';
    actions.after(card);
    const url = website.slug
      ? `${window.location.origin}/wedding/${encodeURIComponent(website.slug)}`
      : '';
    const isLive = website.shareable || website.status === 'published';
    const modeLabel =
      website.visibility === 'password'
        ? 'Password protected'
        : website.visibility === 'public'
          ? 'Public'
          : 'Anyone with link';
    card.innerHTML = isLive
      ? `<div class="ww-share-card__head"><h4>Your wedding website is live</h4><span class="ww-share-pill">${esc(modeLabel)}</span></div><p class="ww-share-note">Share this link with guests.${website.visibility === 'password' ? ' Send the password separately. EventFlow will never show the saved password again.' : ''}</p><div class="ww-share-link-row"><input readonly value="${esc(url)}" aria-label="Wedding website guest link"><button type="button" class="cta secondary small ww-copy-link">Copy guest link</button></div>`
      : `<div class="ww-share-card__head"><h4>Your wedding website is saved as a draft</h4><span class="ww-share-pill ww-share-pill--draft">Not live yet</span></div><p class="ww-share-note">Publish your wedding website before sharing it with guests. EventFlow will avoid placeholder links such as <strong>/wedding/wedding-website</strong>.</p>${url ? `<div class="ww-share-link-row"><input readonly value="${esc(url)}" aria-label="Draft website link"><button type="button" class="cta secondary small ww-publish-first">Go to Publish</button></div>` : ''}`;
    const copyBtn = card.querySelector('.ww-copy-link');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(url);
          copyBtn.textContent = 'Copied';
          setTimeout(() => (copyBtn.textContent = 'Copy guest link'), 1400);
        } catch (_err) {
          const input = card.querySelector('input');
          input?.select?.();
          copyBtn.textContent = 'Select link';
        }
      });
    }
    const publishFirst = card.querySelector('.ww-publish-first');
    if (publishFirst) {
      publishFirst.addEventListener('click', () => {
        const publishBtn = root.querySelector('#ww-pub');
        publishBtn?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        publishBtn?.focus?.({ preventScroll: true });
      });
    }
  }

  function getWebsiteState(planId) {
    if (!planId) {
      return null;
    }
    if (statePlanId === planId && statePromise) {
      return statePromise;
    }
    statePlanId = planId;
    statePromise = api(`/api/me/plans/${encodeURIComponent(planId)}/wedding-website`)
      .then(data => data.website || {})
      .catch(() => null);
    return statePromise;
  }

  async function refreshState(root, form) {
    const planId = planIdFromDom(root);
    if (!planId) {
      return;
    }
    const website = await getWebsiteState(planId);
    if (!website) {
      const state = form.querySelector('.ww-password-state');
      if (state) {
        state.textContent = 'Privacy settings will be saved with the rest of the website details.';
      }
      return;
    }
    form.dataset.passwordSet = website.passwordSet ? 'true' : 'false';
    const visibility = website.visibility || 'private_link';
    const selected = form.querySelector(
      `input[name='visibility'][value='${window.CSS?.escape ? CSS.escape(visibility) : visibility}']`
    );
    if (selected) {
      selected.checked = true;
    }
    const state = form.querySelector('.ww-password-state');
    if (state) {
      state.textContent = website.passwordSet
        ? 'Password protection is configured. Enter a new password only if you want to change it.'
        : 'No password is stored yet. You must set one before enabling password protection.';
    }
    updateVisibilityUi(form);
    renderShareCard(root, website);
  }

  function injectControls(root) {
    const form = root.querySelector('#ww-builder');
    if (!form || form.dataset.passwordDashboardReady === 'true') {
      return;
    }
    form.dataset.passwordDashboardReady = 'true';
    const preview = root.querySelector("a[href^='/wedding/']");
    const slug = preview ? preview.getAttribute('href').split('/').filter(Boolean).pop() : '';
    const privacyPanel = document.createElement('details');
    privacyPanel.className = 'ww-password-privacy-panel';
    privacyPanel.open = false;
    privacyPanel.innerHTML = `
      <summary>Privacy & password protection</summary>
      <div class="ww-privacy-card">
        <p class="small">Choose how guests access your wedding website. Password protected pages require guests to enter the password before viewing details or submitting an RSVP.</p>
        <label class="ww-radio-row"><input type="radio" name="visibility" value="private_link"> <span><strong>Anyone with link</strong><small>Unlisted guest link. Search engines remain discouraged.</small></span></label>
        <label class="ww-radio-row"><input type="radio" name="visibility" value="public"> <span><strong>Public</strong><small>Accessible to anyone who visits the link.</small></span></label>
        <label class="ww-radio-row"><input type="radio" name="visibility" value="password"> <span><strong>Password protected</strong><small>Guests must enter the password before the page or RSVP form loads.</small></span></label>
        <div class="ww-password-fields" hidden>
          <label>Website password<input type="password" name="password" autocomplete="new-password" minlength="6" placeholder="Set or change password"></label>
          <p class="small ww-password-help">Existing passwords are never displayed. Leave this blank to keep the current password; enter a new value to change it. Minimum 6 characters.</p>
        </div>
        <p class="small ww-password-state" data-slug="${esc(slug)}">Loading privacy settings…</p>
      </div>`;
    form.prepend(privacyPanel);
    Array.from(form.querySelectorAll("input[name='visibility']")).forEach(input =>
      input.addEventListener('change', () => updateVisibilityUi(form))
    );
    const fallback = form.querySelector("input[name='visibility'][value='private_link']");
    if (fallback) {
      fallback.checked = true;
    }
    updateVisibilityUi(form);
    refreshState(root, form);
  }

  document.addEventListener(
    'click',
    event => {
      const saveButton = event.target.closest('#ww-save');
      if (!saveButton) {
        return;
      }
      const root = document.querySelector(rootSelector);
      const form = root?.querySelector('#ww-builder');
      if (!form) {
        return;
      }
      const visibility = form.querySelector("input[name='visibility']:checked")?.value;
      const passwordInput = form.querySelector("input[name='password']");
      if (
        visibility === 'password' &&
        passwordInput &&
        passwordInput.required &&
        !passwordInput.value
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        passwordInput.focus();
        passwordInput.setCustomValidity(
          'Please set a password before enabling password protection.'
        );
        passwordInput.reportValidity();
        setTimeout(() => passwordInput.setCustomValidity(''), 800);
      }
      statePromise = null;
      setTimeout(() => {
        const freshRoot = document.querySelector(rootSelector);
        const freshForm = freshRoot?.querySelector('#ww-builder');
        if (freshRoot && freshForm) {
          refreshState(freshRoot, freshForm);
        }
      }, 900);
    },
    true
  );

  function waitForBuilder() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const root = document.querySelector(rootSelector);
      if (root?.querySelector('#ww-builder') && planIdFromDom(root)) {
        clearInterval(timer);
        injectControls(root);
      } else if (attempts > 120) {
        clearInterval(timer);
      }
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForBuilder);
  } else {
    waitForBuilder();
  }
})();
