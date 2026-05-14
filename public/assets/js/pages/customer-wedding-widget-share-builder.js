(function () {
  'use strict';

  const ROOT_ID = 'wedding-website-dashboard-root';
  let cachedPlans = [];
  let planPromise = null;

  const esc = value => String(value || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const isWeddingPlan = plan => String(plan?.eventType || '').toLowerCase() === 'wedding' || String(plan?.name || plan?.eventName || '').toLowerCase().includes('wedding');
  const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || decodeURIComponent((document.cookie.match(/(?:^|; )csrfToken=([^;]+)/) || [])[1] || '');

  function cssEscape(value) {
    return window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
  }

  async function api(path, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    const headers = { ...(opts.headers || {}) };
    if (method !== 'GET' && method !== 'HEAD' && !headers['X-CSRF-Token']) {
      const token = csrf();
      if (token) headers['X-CSRF-Token'] = token;
    }
    const res = await fetch(path, { credentials: 'same-origin', ...opts, headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || json.message || 'Request failed');
    return json;
  }

  function injectStyles() {
    if (document.getElementById('ww-advanced-widget-styles')) return;
    const s = document.createElement('style');
    s.id = 'ww-advanced-widget-styles';
    s.textContent = `
      .ww-advanced-panel,.ww-seat-toolbox{margin-top:.85rem;padding:.85rem;border:1px solid rgba(80,192,176,.16);border-radius:18px;background:rgba(255,255,255,.68)}
      .ww-advanced-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.7rem}.ww-advanced-grid label{display:grid;gap:.25rem;font-weight:800;color:var(--ww-navy,#24436f)}
      .ww-advanced-grid input,.ww-advanced-grid select,.ww-advanced-grid textarea{width:100%;box-sizing:border-box;padding:.55rem;border:1px solid rgba(80,192,176,.22);border-radius:12px;background:rgba(255,255,255,.9)}.ww-advanced-grid textarea{min-height:82px;resize:vertical}.ww-link-preview{display:block;margin-top:.35rem;color:var(--ww-teal,#2c94b1);font-weight:800;overflow-wrap:anywhere}.ww-qr-card canvas{width:132px!important;height:132px!important;border:10px solid #fff;border-radius:16px;box-shadow:0 12px 28px rgba(36,67,111,.08)}.ww-qr-fallback{display:grid;place-items:center;width:132px;height:132px;border-radius:16px;background:#fff;color:var(--ww-navy,#24436f);font-weight:800;text-align:center}.ww-move-select{margin-left:.4rem;max-width:150px}.ww-seat-toolbox{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.65rem}.ww-capacity-warning{color:#991b1b!important;font-weight:800}.ww-unsaved-note{font-weight:800;color:#92400e}
    `;
    document.head.appendChild(s);
  }

  function toast(message, type) {
    const el = document.createElement('div');
    el.className = `ww-toast ww-toast--${type || 'ok'}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 240); }, 2400);
  }

  async function getPlan() {
    if (cachedPlans.length) return cachedPlans.find(isWeddingPlan) || null;
    if (!planPromise) {
      planPromise = fetch('/api/me/plans', { credentials: 'include' })
        .then(r => r.ok ? r.json() : { plans: [] })
        .then(d => { cachedPlans = d.plans || []; return cachedPlans.find(isWeddingPlan) || null; })
        .catch(() => null);
    }
    return planPromise;
  }

  async function getSite() {
    const plan = await getPlan();
    if (!plan?.id) return { plan: null, site: null };
    const data = await api(`/api/me/plans/${encodeURIComponent(plan.id)}/wedding-website`).catch(() => ({}));
    return { plan, site: data.website || null };
  }

  function enhanceUniqueLinkWording(root) {
    root.querySelectorAll('.ww-share-card label').forEach(label => {
      const text = Array.from(label.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
      if (text && /guest link/i.test(text.textContent)) text.textContent = 'Your unique guest link';
    });
    root.querySelector('#ww-copy-link')?.replaceChildren(document.createTextNode('Copy wedding website link'));
  }

  function enhanceBuilder(root) {
    const form = root.querySelector('#ww-builder');
    if (!form || form.querySelector('#ww-extra-details')) return;
    const first = form.querySelector('details');
    const details = document.createElement('details');
    details.id = 'ww-extra-details';
    details.className = 'ww-advanced-panel';
    details.innerHTML = `<summary>Guest information, style and timings</summary><div class="ww-advanced-grid"><label>Arrival time<input name="arrivalTime" type="time"></label><label>Ceremony time<input name="ceremonyTime" type="time"></label><label>Reception time<input name="receptionTime" type="time"></label><label>Finish time<input name="finishTime" type="time"></label><label>Dress code<input name="dressCode"></label><label>Children policy<input name="childrenPolicy"></label><label>Plus-one policy<input name="plusOnePolicy"></label><label>Template<select name="template"><option value="classic">Classic</option><option value="modern">Modern</option><option value="romantic">Romantic</option></select></label><label>Accent colour<input name="accentColor" type="color" value="#0B8073"></label><label>Parking information<textarea name="parkingInfo"></textarea></label><label>Accessibility information<textarea name="accessibilityInfo"></textarea></label><label>Gift information<textarea name="giftInfo"></textarea></label><label>How we met<textarea name="loveStory"></textarea></label><label>The proposal<textarea name="proposalStory"></textarea></label></div>`;
    first?.after(details);
    hydrateBuilder(form);
    form.addEventListener('input', () => {
      if (!root.querySelector('.ww-unsaved-note')) {
        form.insertAdjacentHTML('beforebegin', '<p class="ww-unsaved-note">Unsaved changes — remember to press Save.</p>');
      }
    });
  }

  async function hydrateBuilder(form) {
    const { site } = await getSite();
    if (!site) return;
    ['arrivalTime','ceremonyTime','receptionTime','finishTime','dressCode','childrenPolicy','plusOnePolicy','template','accentColor','parkingInfo','accessibilityInfo','giftInfo','loveStory','proposalStory'].forEach(name => {
      const field = form.querySelector(`[name="${name}"]`);
      if (field && site[name] !== undefined && site[name] !== null) field.value = site[name];
    });
  }

  async function enhanceShare(root) {
    const input = root.querySelector('.ww-share-card input[readonly]');
    const actions = root.querySelector('.ww-share-card .ww-actions');
    if (!input || !actions || root.querySelector('#ww-share-admin')) return;
    const { plan, site } = await getSite();
    if (!plan?.id || !site) return;
    enhanceUniqueLinkWording(root);
    const url = input.value;
    const slug = String(site.slug || '').replace(/^\/+|\/+$/g, '');
    const admin = document.createElement('div');
    admin.id = 'ww-share-admin';
    admin.className = 'ww-advanced-panel';
    admin.innerHTML = `<p class="ww-kicker">Share settings</p><div class="ww-advanced-grid"><label>Custom website link<input id="ww-custom-slug" value="${esc(slug)}"></label><label>Privacy<select id="ww-visibility"><option value="private_link">Private link</option><option value="public">Public</option><option value="password">Password protected</option></select></label><label>Website password<input id="ww-site-pass" type="password" placeholder="${site.passwordSet ? 'Leave blank to keep existing' : 'Set password'}"></label></div><span class="ww-link-preview">${esc(window.location.origin)}/wedding/<strong id="ww-slug-preview">${esc(slug)}</strong></span><div class="ww-actions"><button type="button" class="cta secondary small" id="ww-save-share">Save share settings</button><a class="cta secondary small" href="https://wa.me/?text=${encodeURIComponent(url)}" target="_blank" rel="noopener">Share to WhatsApp</a><a class="cta secondary small" href="mailto:?subject=Wedding%20details&body=${encodeURIComponent(url)}">Share by email</a><button type="button" class="cta secondary small" id="ww-download-qr">Download QR code</button></div><div class="ww-qr-card"><div id="ww-qr-target" class="ww-qr-fallback">QR loading…</div><p>Scannable QR code for your unique guest link.</p></div><p class="small" id="ww-share-status" role="status" aria-live="polite"></p>`;
    actions.after(admin);
    admin.querySelector('#ww-visibility').value = site.visibility || 'private_link';
    admin.querySelector('#ww-custom-slug').addEventListener('input', e => { admin.querySelector('#ww-slug-preview').textContent = e.target.value || 'our-wedding'; });
    admin.querySelector('#ww-save-share').addEventListener('click', async e => {
      const button = e.currentTarget;
      const status = admin.querySelector('#ww-share-status');
      button.disabled = true; status.textContent = 'Saving…';
      try {
        const payload = { slug: admin.querySelector('#ww-custom-slug').value, visibility: admin.querySelector('#ww-visibility').value };
        const pass = admin.querySelector('#ww-site-pass').value;
        if (pass) payload.password = pass;
        await api(`/api/me/plans/${encodeURIComponent(plan.id)}/wedding-website`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        status.textContent = 'Saved — reopen the app to see the updated link.'; toast('Share settings saved');
      } catch (err) { status.textContent = err.message; toast(err.message, 'warn'); }
      finally { button.disabled = false; }
    });
    renderQr(admin.querySelector('#ww-qr-target'), url);
    admin.querySelector('#ww-download-qr').addEventListener('click', () => {
      const canvas = admin.querySelector('canvas');
      if (!canvas) return toast('QR code is still loading', 'warn');
      const a = document.createElement('a'); a.download = `${slug || 'wedding'}-qr.png`; a.href = canvas.toDataURL('image/png'); a.click();
    });
  }

  function renderQr(target, url) {
    if (!window.QRCode?.toCanvas) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js';
      script.onload = () => renderQr(target, url);
      script.onerror = () => { target.textContent = 'QR unavailable'; };
      document.head.appendChild(script);
      return;
    }
    const canvas = document.createElement('canvas');
    window.QRCode.toCanvas(canvas, url, { width: 132, margin: 1 }, err => {
      if (err) { target.textContent = 'QR unavailable'; return; }
      target.replaceWith(canvas);
    });
  }

  function enhanceSeating(root) {
    const panel = root.querySelector('.ww-app-panel');
    const grid = root.querySelector('.seat-grid');
    const unseated = root.querySelector('.ww-unseated');
    if (!panel || !grid || !unseated || panel.querySelector('.ww-seat-toolbox')) return;
    const tables = Array.from(grid.querySelectorAll('.seat-card')).map(card => {
      const id = card.querySelector('.edit-table,.del-table')?.dataset.id;
      const name = card.querySelector('.seat-card__head h5')?.textContent?.trim() || 'Table';
      const [used, cap] = (card.querySelector('.seat-cap')?.textContent || '0/0').split('/').map(v => Number(v.trim()) || 0);
      return { id, name, used, cap, card };
    }).filter(t => t.id);
    panel.querySelector('.ww-actions')?.after(Object.assign(document.createElement('div'), { className: 'ww-seat-toolbox', innerHTML: '<strong>Seating tools</strong><div class="ww-actions"><button class="cta secondary small" id="ww-auto-seat" type="button">Auto-seat remaining</button><button class="cta secondary small ww-btn-danger-soft" id="ww-clear-seats" type="button">Clear seating</button></div>' }));
    function assign(tableId, guestId) {
      const select = unseated.querySelector(`.assign-select[data-guest="${cssEscape(guestId)}"]`);
      if (select) { select.value = tableId; select.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    unseated.querySelectorAll('.seat-row').forEach(row => {
      const guestId = row.querySelector('.assign-select')?.dataset.guest;
      if (!guestId) return;
      row.draggable = true; row.classList.add('ww-draggable-guest'); row.dataset.guest = guestId;
      row.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', guestId));
    });
    tables.forEach(table => {
      const pct = table.cap ? Math.min(100, Math.round((table.used / table.cap) * 100)) : 0;
      table.card.classList.add('ww-table-card');
      table.card.insertAdjacentHTML('beforeend', `<div class="ww-capacity-bar"><span style="width:${pct}%"></span></div>${table.used > table.cap ? '<p class="ww-capacity-warning">Over capacity — move a guest or increase capacity.</p>' : ''}`);
      table.card.addEventListener('dragover', e => { e.preventDefault(); table.card.classList.add('is-drop-target'); });
      table.card.addEventListener('dragleave', () => table.card.classList.remove('is-drop-target'));
      table.card.addEventListener('drop', e => { e.preventDefault(); table.card.classList.remove('is-drop-target'); assign(table.id, e.dataTransfer.getData('text/plain')); });
      table.card.querySelectorAll('.unassign').forEach(btn => {
        const move = document.createElement('select'); move.className = 'ww-move-select';
        move.innerHTML = `<option value="">Move to…</option>${tables.filter(t => t.id !== table.id).map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}`;
        move.addEventListener('change', () => { if (move.value) assign(move.value, btn.dataset.id); });
        btn.after(move);
      });
    });
    panel.querySelector('#ww-auto-seat')?.addEventListener('click', () => {
      const guests = Array.from(unseated.querySelectorAll('.assign-select')).map(s => s.dataset.guest);
      const slots = tables.flatMap(t => Array(Math.max(0, t.cap - t.used)).fill(t.id));
      guests.slice(0, slots.length).forEach((guestId, i) => assign(slots[i], guestId));
      toast(slots.length ? 'Auto-seating started' : 'Add more table capacity first', slots.length ? 'ok' : 'warn');
    });
    panel.querySelector('#ww-clear-seats')?.addEventListener('click', () => { if (window.confirm('Clear all current seating assignments?')) grid.querySelectorAll('.unassign').forEach(btn => btn.click()); });
  }

  function enhanceOpenDialogs() {
    document.querySelectorAll('.ww-app-dialog').forEach(dialog => {
      enhanceBuilder(dialog); enhanceShare(dialog); enhanceSeating(dialog); enhanceUniqueLinkWording(dialog);
    });
  }

  function observe() {
    const obs = new MutationObserver(() => enhanceOpenDialogs());
    obs.observe(document.body, { childList: true, subtree: true });
  }

  const previousInit = window.initWeddingWebsiteDashboard;
  window.initWeddingWebsiteDashboard = async function initWeddingWebsiteDashboardWithAdvancedWeddingPolish(plans) {
    cachedPlans = plans || [];
    await previousInit?.(plans);
  };

  injectStyles();
  enhanceOpenDialogs();
  observe();
})();
