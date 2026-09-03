'use strict';
(function () {
  let cachedPlans = [];
  let planPromise = null;
  let sitePromise = null;
  let qrPromise = null;
  let enhanceQueued = false;

  const esc = value =>
    String(value || '').replace(
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

  const isWeddingPlan = plan =>
    String(plan?.eventType || '').toLowerCase() === 'wedding' ||
    String(plan?.name || plan?.eventName || '')
      .toLowerCase()
      .includes('wedding');

  const normalizeSlug = value =>
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80);

  const csrf = () =>
    document.querySelector('meta[name="csrf-token"]')?.content ||
    decodeURIComponent((document.cookie.match(/(?:^|; )csrfToken=([^;]+)/) || [])[1] || '');

  async function api(path, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    const headers = { ...(opts.headers || {}) };
    if (method !== 'GET' && method !== 'HEAD' && !headers['X-CSRF-Token']) {
      const token = csrf();
      if (token) {
        headers['X-CSRF-Token'] = token;
      }
    }
    const res = await fetch(path, { credentials: 'same-origin', ...opts, headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error || json.message || 'Request failed');
    }
    return json;
  }

  function toast(message, type = 'ok') {
    const el = document.createElement('div');
    el.className = `ww-toast ww-toast--${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 240);
    }, 2400);
  }

  function getPlan() {
    if (cachedPlans.length) {
      return cachedPlans.find(isWeddingPlan) || null;
    }
    if (!planPromise) {
      planPromise = fetch('/api/me/plans', { credentials: 'include' })
        .then(res => (res.ok ? res.json() : { plans: [] }))
        .then(data => {
          cachedPlans = data.plans || [];
          return cachedPlans.find(isWeddingPlan) || null;
        })
        .catch(() => null);
    }
    return planPromise;
  }

  function getSite(force = false) {
    if (sitePromise && !force) {
      return sitePromise;
    }
    sitePromise = (async () => {
      const plan = await getPlan();
      if (!plan?.id) {
        return { plan: null, site: null };
      }
      const data = await api(`/api/me/plans/${encodeURIComponent(plan.id)}/wedding-website`).catch(
        () => ({})
      );
      return { plan, site: data.website || null };
    })();
    return sitePromise;
  }

  function injectStyles() {
    if (document.getElementById('ww-advanced-widget-styles')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'ww-advanced-widget-styles';
    style.textContent = `
      .ww-advanced-panel,.ww-seat-toolbox{margin-top:.85rem;padding:.85rem;border:1px solid rgba(80,192,176,.16);border-radius:18px;background:linear-gradient(135deg,rgba(255,255,255,.78),rgba(247,253,252,.68));box-shadow:0 12px 28px rgba(36,67,111,.06)}
      .ww-advanced-panel__head{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;margin-bottom:.65rem}.ww-advanced-panel__head h4{margin:0;color:var(--ww-ink,#172033)}
      .ww-advanced-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.7rem}.ww-advanced-grid label{display:grid;gap:.25rem;color:var(--ww-navy,#24436f);font-weight:800}
      .ww-advanced-grid input,.ww-advanced-grid select,.ww-advanced-grid textarea{width:100%;box-sizing:border-box;padding:.55rem;border:1px solid rgba(80,192,176,.22);border-radius:12px;background:rgba(255,255,255,.92)}.ww-advanced-grid textarea{min-height:82px;resize:vertical}
      .ww-share-status-card{display:grid;gap:.35rem;border:1px solid rgba(80,192,176,.14);border-radius:14px;padding:.65rem;background:rgba(255,255,255,.64)}.ww-link-preview{display:block;margin-top:.35rem;color:var(--ww-teal,#2c94b1);font-weight:800;overflow-wrap:anywhere}
      .ww-qr-card canvas{width:132px!important;height:132px!important;border:10px solid #fff;border-radius:16px;box-shadow:0 12px 28px rgba(36,67,111,.08)}.ww-qr-fallback{display:grid;place-items:center;width:132px;height:132px;border-radius:16px;background:#fff;color:var(--ww-navy,#24436f);font-weight:800;text-align:center}
      .ww-seat-toolbox{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.65rem}.ww-seat-toolbox strong{color:var(--ww-navy,#24436f)}.ww-capacity-warning,.ww-seating-warning{color:#991b1b!important;font-weight:800}.ww-move-select{margin-left:.4rem;max-width:160px}.ww-unsaved-note{display:inline-flex;margin:.35rem 0 .7rem;padding:.35rem .6rem;border-radius:999px;background:#fef3c7;color:#92400e;font-weight:800}
      @media (max-width:720px){.ww-seat-toolbox,.ww-advanced-panel__head{align-items:stretch;flex-direction:column}.ww-move-select{width:100%;max-width:none;margin:.35rem 0 0}}
    `;
    document.head.appendChild(style);
  }

  function markUnsaved(root, form) {
    if (root.querySelector('.ww-unsaved-note')) {
      return;
    }
    form.insertAdjacentHTML(
      'beforebegin',
      '<p class="ww-unsaved-note">Unsaved changes — remember to press Save.</p>'
    );
  }

  function enhanceUniqueLinkWording(root) {
    root.querySelectorAll('.ww-share-card label').forEach(label => {
      const text = Array.from(label.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
      if (text && /guest link/i.test(text.textContent)) {
        text.textContent = 'Your unique guest link';
      }
    });
    root
      .querySelector('#ww-copy-link')
      ?.replaceChildren(document.createTextNode('Copy wedding website link'));
  }

  function enhanceBuilder(root) {
    const form = root.querySelector('#ww-builder');
    if (!form || form.dataset.wwAdvancedEnhanced === 'true') {
      return;
    }
    form.dataset.wwAdvancedEnhanced = 'true';
    const first = form.querySelector('details');
    const details = document.createElement('details');
    details.id = 'ww-extra-details';
    details.className = 'ww-advanced-panel';
    details.innerHTML = `
      <summary>Guest information, style and timings</summary>
      <div class="ww-advanced-grid">
        <label>Arrival time<input name="arrivalTime" type="time"></label>
        <label>Ceremony time<input name="ceremonyTime" type="time"></label>
        <label>Reception time<input name="receptionTime" type="time"></label>
        <label>Finish time<input name="finishTime" type="time"></label>
        <label>Dress code<input name="dressCode" placeholder="Formal, colourful, black tie…"></label>
        <label>Children policy<input name="childrenPolicy" placeholder="Children welcome / adults only"></label>
        <label>Plus-one policy<input name="plusOnePolicy" placeholder="Named guests only / plus ones welcome"></label>
        <label>Template<select name="template"><option value="classic">Classic</option><option value="modern">Modern</option><option value="romantic">Romantic</option></select></label>
        <label>Accent colour<input name="accentColor" type="color" value="#0B8073"></label>
        <label>Parking information<textarea name="parkingInfo" placeholder="Parking, drop-off, taxi and access details"></textarea></label>
        <label>Accessibility information<textarea name="accessibilityInfo" placeholder="Step-free access, quiet spaces, seating support"></textarea></label>
        <label>Gift information<textarea name="giftInfo" placeholder="Gift list, honeymoon fund or no-gifts message"></textarea></label>
        <label>How we met<textarea name="loveStory" placeholder="Tell guests your story"></textarea></label>
        <label>The proposal<textarea name="proposalStory" placeholder="Tell guests about the proposal"></textarea></label>
      </div>`;
    first?.after(details);
    hydrateBuilder(form);
    form.addEventListener('input', () => markUnsaved(root, form), { passive: true });
  }

  async function hydrateBuilder(form) {
    const { site } = await getSite();
    if (!site || !form.isConnected) {
      return;
    }
    [
      'arrivalTime',
      'ceremonyTime',
      'receptionTime',
      'finishTime',
      'dressCode',
      'childrenPolicy',
      'plusOnePolicy',
      'template',
      'accentColor',
      'parkingInfo',
      'accessibilityInfo',
      'giftInfo',
      'loveStory',
      'proposalStory',
    ].forEach(name => {
      const field = form.querySelector(`[name="${name}"]`);
      if (field && site[name] !== undefined && site[name] !== null) {
        field.value = site[name];
      }
    });
  }

  function loadQrLibrary() {
    if (window.QRCode?.toCanvas) {
      return Promise.resolve(window.QRCode);
    }
    if (qrPromise) {
      return qrPromise;
    }
    qrPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById('ww-qrcode-lib');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.QRCode), { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.id = 'ww-qrcode-lib';
      script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js';
      script.async = true;
      script.onload = () => resolve(window.QRCode);
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return qrPromise;
  }

  async function renderQr(target, url) {
    if (!target || target.dataset.wwQrStarted === 'true') {
      return;
    }
    target.dataset.wwQrStarted = 'true';
    try {
      const qr = await loadQrLibrary();
      if (!target.isConnected) {
        return;
      }
      const canvas = document.createElement('canvas');
      await qr.toCanvas(canvas, url, { width: 132, margin: 1, errorCorrectionLevel: 'M' });
      target.replaceWith(canvas);
    } catch (_err) {
      if (target.isConnected) {
        target.textContent = 'QR unavailable';
      }
    }
  }

  function buildVisibilityText(site) {
    if (site.visibility === 'password') {
      return site.passwordSet ? 'Password protected' : 'Password needed before publishing';
    }
    if (site.visibility === 'public') {
      return 'Public and shareable';
    }
    return 'Private link only';
  }

  async function enhanceShare(root) {
    const input = root.querySelector('.ww-share-card input[readonly]');
    const actions = root.querySelector('.ww-share-card .ww-actions');
    if (!input || !actions || root.querySelector('#ww-share-admin')) {
      return;
    }
    const { plan, site } = await getSite();
    if (!plan?.id || !site || !root.isConnected || root.querySelector('#ww-share-admin')) {
      return;
    }

    enhanceUniqueLinkWording(root);
    const url = input.value;
    const slug = String(site.slug || '').replace(/^\/+|\/+$/g, '');
    const admin = document.createElement('div');
    admin.id = 'ww-share-admin';
    admin.className = 'ww-advanced-panel';
    admin.innerHTML = `
      <div class="ww-advanced-panel__head"><div><p class="ww-kicker">Share settings</p><h4>Your unique wedding website link</h4><p>Control the public link, privacy mode and guest sharing tools.</p></div><div class="ww-share-status-card"><span>Status</span><strong>${esc(site.status || 'draft')}</strong><small>${esc(buildVisibilityText(site))}</small></div></div>
      <div class="ww-advanced-grid"><label>Custom website link<input id="ww-custom-slug" value="${esc(slug)}" placeholder="our-wedding"></label><label>Privacy<select id="ww-visibility"><option value="private_link">Private link</option><option value="public">Public</option><option value="password">Password protected</option></select></label><label>Website password<input id="ww-site-pass" type="password" placeholder="${site.passwordSet ? 'Leave blank to keep existing' : 'Set password'}"></label></div>
      <span class="ww-link-preview">${esc(window.location.origin)}/wedding/<strong id="ww-slug-preview">${esc(slug)}</strong></span>
      <div class="ww-actions"><button type="button" class="cta secondary small" id="ww-save-share">Save share settings</button><a class="cta secondary small" href="https://wa.me/?text=${encodeURIComponent(url)}" target="_blank" rel="noopener">Share to WhatsApp</a><a class="cta secondary small" href="mailto:?subject=Wedding%20details&body=${encodeURIComponent(url)}">Share by email</a><button type="button" class="cta secondary small" id="ww-download-qr">Download QR code</button></div>
      <div class="ww-qr-card"><div id="ww-qr-target" class="ww-qr-fallback">QR loading…</div><p>Scannable QR code for your unique guest link.</p></div><p class="small" id="ww-share-status" role="status" aria-live="polite"></p>`;
    actions.after(admin);

    const visibilitySelect = admin.querySelector('#ww-visibility');
    const slugInput = admin.querySelector('#ww-custom-slug');
    const passwordInput = admin.querySelector('#ww-site-pass');
    visibilitySelect.value = site.visibility || 'private_link';
    const togglePassword = () => {
      passwordInput.closest('label').style.display =
        visibilitySelect.value === 'password' ? 'grid' : 'none';
    };
    togglePassword();
    visibilitySelect.addEventListener('change', togglePassword);
    slugInput.addEventListener('input', event => {
      admin.querySelector('#ww-slug-preview').textContent =
        normalizeSlug(event.target.value) || 'our-wedding';
    });
    admin.querySelector('#ww-save-share').addEventListener('click', async event => {
      const button = event.currentTarget;
      const status = admin.querySelector('#ww-share-status');
      button.disabled = true;
      status.textContent = 'Saving…';
      try {
        const payload = {
          slug: normalizeSlug(slugInput.value),
          visibility: visibilitySelect.value,
        };
        if (passwordInput.value) {
          payload.password = passwordInput.value;
        }
        await api(`/api/me/plans/${encodeURIComponent(plan.id)}/wedding-website`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        status.textContent = 'Saved — reopen the app to see the updated link.';
        sitePromise = null;
        toast('Share settings saved');
      } catch (err) {
        status.textContent = err.message;
        toast(err.message, 'warn');
      } finally {
        button.disabled = false;
      }
    });
    renderQr(admin.querySelector('#ww-qr-target'), url);
    admin.querySelector('#ww-download-qr').addEventListener('click', () => {
      const canvas = admin.querySelector('canvas');
      if (!canvas) {
        toast('QR code is still loading', 'warn');
        return;
      }
      const a = document.createElement('a');
      a.download = `${slug || 'wedding'}-qr.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    });
  }

  async function assignGuest(planId, tableId, guestId) {
    await api(
      `/api/me/plans/${encodeURIComponent(planId)}/tables/${encodeURIComponent(tableId)}/assign-guest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId }),
      }
    );
  }

  async function unassignGuest(planId, guestId) {
    await api(`/api/me/plans/${encodeURIComponent(planId)}/tables/unassign-guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestId }),
    });
  }

  function refreshSeatingTab(root) {
    root.closest('.ww-app-dialog')?.querySelector('.ww-app-tabs [data-tab="seating"]')?.click();
  }

  async function enhanceSeating(root) {
    const panel = root.querySelector('.ww-app-panel');
    const grid = root.querySelector('.seat-grid');
    const unseated = root.querySelector('.ww-unseated');
    if (!panel || !grid || !unseated || panel.dataset.wwAdvancedSeating === 'true') {
      return;
    }
    panel.dataset.wwAdvancedSeating = 'true';
    const { plan } = await getSite();
    if (!plan?.id || !panel.isConnected) {
      return;
    }

    const tables = Array.from(grid.querySelectorAll('.seat-card'))
      .map(card => {
        const id = card.querySelector('.edit-table,.del-table')?.dataset.id;
        const name = card.querySelector('.seat-card__head h5')?.textContent?.trim() || 'Table';
        const [used, cap] = (card.querySelector('.seat-cap')?.textContent || '0/0')
          .split('/')
          .map(value => Number(value.trim()) || 0);
        return { id, name, used, cap, card };
      })
      .filter(table => table.id);

    const toolbox = document.createElement('div');
    toolbox.className = 'ww-seat-toolbox';
    toolbox.innerHTML =
      '<strong>Seating tools</strong><div class="ww-actions"><button class="cta secondary small" id="ww-auto-seat" type="button">Auto-seat remaining</button><button class="cta secondary small ww-btn-danger-soft" id="ww-clear-seats" type="button">Clear seating</button></div>';
    panel.querySelector('.ww-actions')?.after(toolbox);

    async function assign(tableId, guestId) {
      if (!tableId || !guestId) {
        return;
      }
      await assignGuest(plan.id, tableId, guestId);
      toast('Guest seating updated');
      await refreshSeatingTab(root);
    }

    unseated.querySelectorAll('.seat-row').forEach(row => {
      const guestId = row.querySelector('.assign-select')?.dataset.guest;
      if (!guestId || row.dataset.wwAdvancedDrag === 'true') {
        return;
      }
      row.dataset.wwAdvancedDrag = 'true';
      row.draggable = true;
      row.classList.add('ww-draggable-guest');
      row.addEventListener('dragstart', event => event.dataTransfer.setData('text/plain', guestId));
    });

    tables.forEach(table => {
      const pct = table.cap ? Math.min(100, Math.round((table.used / table.cap) * 100)) : 0;
      table.card.classList.add('ww-table-card');
      if (!table.card.querySelector('.ww-capacity-bar')) {
        table.card.insertAdjacentHTML(
          'beforeend',
          `<div class="ww-capacity-bar"><span style="width:${pct}%"></span></div>${table.used > table.cap ? '<p class="ww-capacity-warning">Over capacity — move a guest or increase capacity.</p>' : ''}`
        );
      }
      if (table.card.dataset.wwAdvancedDrop !== 'true') {
        table.card.dataset.wwAdvancedDrop = 'true';
        table.card.addEventListener('dragover', event => {
          event.preventDefault();
          table.card.classList.add('is-drop-target');
        });
        table.card.addEventListener('dragleave', () =>
          table.card.classList.remove('is-drop-target')
        );
        table.card.addEventListener('drop', async event => {
          event.preventDefault();
          table.card.classList.remove('is-drop-target');
          await assign(table.id, event.dataTransfer.getData('text/plain'));
        });
      }
      table.card.querySelectorAll('.unassign').forEach(button => {
        if (button.dataset.wwAdvancedMove === 'true') {
          return;
        }
        button.dataset.wwAdvancedMove = 'true';
        const move = document.createElement('select');
        move.className = 'ww-move-select';
        move.innerHTML = `<option value="">Move to…</option>${tables
          .filter(option => option.id !== table.id)
          .map(option => `<option value="${esc(option.id)}">${esc(option.name)}</option>`)
          .join('')}`;
        move.addEventListener('change', async () => {
          if (move.value) {
            await assign(move.value, button.dataset.id);
          }
        });
        button.after(move);
      });
    });

    toolbox.querySelector('#ww-auto-seat')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      const guestIds = Array.from(unseated.querySelectorAll('.assign-select')).map(
        select => select.dataset.guest
      );
      const slots = tables.flatMap(table =>
        Array(Math.max(0, table.cap - table.used)).fill(table.id)
      );
      if (!guestIds.length) {
        return toast('No unseated guests to auto-seat');
      }
      if (!slots.length) {
        return toast('Add more table capacity first', 'warn');
      }
      button.disabled = true;
      try {
        for (let i = 0; i < guestIds.slice(0, slots.length).length; i += 1) {
          await assignGuest(plan.id, slots[i], guestIds[i]);
        }
        toast('Auto-seating complete');
        await refreshSeatingTab(root);
      } catch (err) {
        toast(err.message || 'Unable to auto-seat guests', 'warn');
      } finally {
        button.disabled = false;
      }
    });

    toolbox.querySelector('#ww-clear-seats')?.addEventListener('click', async event => {
      if (!window.confirm('Clear all current seating assignments?')) {
        return;
      }
      const button = event.currentTarget;
      const guestIds = Array.from(grid.querySelectorAll('.unassign'))
        .map(btn => btn.dataset.id)
        .filter(Boolean);
      button.disabled = true;
      try {
        for (const guestId of guestIds) {
          await unassignGuest(plan.id, guestId);
        }
        toast('Seating cleared');
        await refreshSeatingTab(root);
      } catch (err) {
        toast(err.message || 'Unable to clear seating', 'warn');
      } finally {
        button.disabled = false;
      }
    });

    if (
      tables.some(table => table.used > table.cap) &&
      !panel.querySelector('.ww-seating-warning')
    ) {
      toolbox.insertAdjacentHTML(
        'afterend',
        '<p class="ww-seating-warning">One or more tables is over capacity.</p>'
      );
    }
  }

  function enhanceDialog(dialog) {
    enhanceBuilder(dialog);
    enhanceShare(dialog);
    enhanceSeating(dialog);
    enhanceUniqueLinkWording(dialog);
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

  function observe() {
    const obs = new MutationObserver(mutations => {
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
    obs.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener(
    'click',
    event => {
      if (
        event.target instanceof Element &&
        event.target.closest('.ww-app-tabs button,[data-tab],.ww-app-dialog .ww-tile button')
      ) {
        window.setTimeout(scheduleEnhance, 0);
      }
    },
    true
  );

  const previousInit = window.initWeddingWebsiteDashboard;
  window.initWeddingWebsiteDashboard =
    async function initWeddingWebsiteDashboardWithAdvancedWeddingPolish(plans) {
      cachedPlans = plans || [];
      await previousInit?.(plans);
    };

  injectStyles();
  scheduleEnhance();
  observe();
})();
