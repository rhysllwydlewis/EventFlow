(function () {
  'use strict';

  const ROOT_ID = 'wedding-website-dashboard-root';
  const STATUS_ID = 'wedding-website-status-pill';
  let cachedPlans = [];
  let openerButton = null;

  const esc = value => String(value || '').replace(/[&<>\"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' })[ch]);
  const isWeddingPlan = plan => String(plan?.eventType || '').toLowerCase() === 'wedding' || String(plan?.name || plan?.eventName || '').toLowerCase().includes('wedding');
  const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || decodeURIComponent((document.cookie.match(/(?:^|; )csrfToken=([^;]+)/) || [])[1] || '');

  async function api(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const opts = { credentials: 'same-origin', ...options, headers: { ...(options.headers || {}) } };
    if (method !== 'GET' && method !== 'HEAD' && !opts.headers['X-CSRF-Token']) {
      const token = csrf();
      if (token) opts.headers['X-CSRF-Token'] = token;
    }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || data.message || 'Request failed');
      err.payload = data;
      throw err;
    }
    return data;
  }

  function toast(message, type = 'ok') {
    const el = document.createElement('div');
    el.className = `ww-toast ww-toast--${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 2400);
  }

  function siteUrl(site) {
    return site?.slug ? `${window.location.origin}/wedding/${site.slug}` : '';
  }

  function status(site, plan) {
    if (!plan) return { key: 'not-started', label: 'Not started', text: 'Create your wedding website workspace.' };
    if (!site) return { key: 'draft', label: 'Draft', text: 'Create your wedding website draft.' };
    if (site.status === 'published') return { key: 'published', label: 'Published', text: 'Your guest website is live.' };
    return { key: 'draft', label: 'Draft', text: 'Finish your details and publish when ready.' };
  }

  function setStatus(meta) {
    const pill = document.getElementById(STATUS_ID);
    if (pill) {
      pill.textContent = meta.label;
      pill.dataset.status = meta.key;
    }
  }

  async function getSite(plan) {
    if (!plan?.id) return null;
    const data = await api(`/api/me/plans/${encodeURIComponent(plan.id)}/wedding-website`).catch(() => ({}));
    return data.website || data.site || data.data?.website || null;
  }

  async function initWeddingWebsiteDashboard(plans) {
    cachedPlans = plans || [];
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const plan = cachedPlans.filter(isWeddingPlan)[0] || null;
    renderLauncher(root, plan, await getSite(plan));
  }

  function renderLauncher(root, plan, site) {
    const meta = status(site, plan);
    const url = siteUrl(site);
    setStatus(meta);
    root.innerHTML = `<section class="ww-launcher"><div class="ww-launcher__main"><span class="ww-launcher__orb" aria-hidden="true">💍</span><div><p class="ww-launcher__eyebrow">Guest website mini app</p><h4>Wedding Website & RSVPs</h4><p>${esc(meta.text)} Manage your details, RSVP form, guest list and seating tools in one pop-out workspace.</p>${url ? `<a class="ww-launcher__link" href="${esc(url)}" target="_blank" rel="noopener">${esc(url.replace(/^https?:\/\//, ''))}</a>` : ''}</div></div><div class="ww-launcher__actions"><span class="customer-wedding-status-pill" data-status="${esc(meta.key)}">${esc(meta.label)}</span><button id="ww-open-app" class="cta ww-open-app" type="button">Open app</button></div></section>`;
    root.querySelector('#ww-open-app')?.addEventListener('click', () => { openerButton = root.querySelector('#ww-open-app'); openApp(plan, site); });
  }

  function openApp(plan, site) {
    const meta = status(site, plan);
    const dialog = document.createElement('dialog');
    dialog.className = 'ww-app-dialog';
    dialog.setAttribute('aria-labelledby', 'ww-app-title');
    dialog.innerHTML = `<div class="ww-app-shell"><header class="ww-app-header"><div class="ww-app-title-group"><span class="ww-app-icon" aria-hidden="true">💍</span><div><p class="ww-kicker">EventFlow widget app</p><h2 id="ww-app-title">Wedding Website & RSVPs</h2><p>Manage your website, RSVPs, guest list, seating and share link in one place.</p></div></div><div class="ww-app-header-actions"><span class="customer-wedding-status-pill" data-status="${esc(meta.key)}">${esc(meta.label)}</span><button class="ww-app-close" type="button" aria-label="Close Wedding Website app">×</button></div></header><nav class="ww-app-tabs" aria-label="Wedding Website app sections"><button data-tab="overview" aria-selected="true" type="button">Overview</button><button data-tab="website" type="button">Website</button><button data-tab="guests" type="button">RSVPs & Guests</button><button data-tab="seating" type="button">Seating</button><button data-tab="share" type="button">Share</button></nav><div class="ww-app-body"><section class="ww-app-pane" data-pane="overview"></section><section class="ww-app-pane" data-pane="website" hidden></section><section class="ww-app-pane" data-pane="guests" hidden></section><section class="ww-app-pane" data-pane="seating" hidden></section><section class="ww-app-pane" data-pane="share" hidden></section></div></div>`;
    document.body.appendChild(dialog);
    document.body.classList.add('ww-app-open');
    const pane = name => dialog.querySelector(`[data-pane="${name}"]`);
    const switchTab = name => {
      dialog.querySelectorAll('.ww-app-tabs button').forEach(btn => btn.setAttribute('aria-selected', String(btn.dataset.tab === name)));
      dialog.querySelectorAll('.ww-app-pane').forEach(item => (item.hidden = item.dataset.pane !== name));
    };
    const refresh = async (nextPlan = plan, nextSite = site) => {
      plan = nextPlan;
      site = nextSite;
      setStatus(status(site, plan));
      await renderOverview(pane('overview'), plan, site, switchTab);
      await renderWebsite(pane('website'), plan, site, refresh);
      await renderGuests(pane('guests'), plan, () => renderSeating(pane('seating'), plan));
      await renderSeating(pane('seating'), plan);
      renderShare(pane('share'), plan, site, switchTab);
    };
    dialog.querySelector('.ww-app-close').addEventListener('click', () => dialog.close());
    dialog.querySelectorAll('.ww-app-tabs button').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    dialog.addEventListener('close', async () => {
      document.body.classList.remove('ww-app-open');
      dialog.remove();
      const root = document.getElementById(ROOT_ID);
      const nextSite = await getSite(plan);
      if (root) renderLauncher(root, plan || cachedPlans.filter(isWeddingPlan)[0] || null, nextSite);
      openerButton?.focus?.();
    }, { once: true });
    dialog.showModal();
    refresh().then(() => switchTab('overview'));
  }

  async function renderStart(host, onReady) {
    host.innerHTML = `<div class="ww-app-panel ww-choice-panel"><p class="ww-kicker">Start here</p><h3>Create your wedding website workspace</h3><p>Create a beautiful guest website, collect RSVPs, manage guests and organise seating.</p><div class="ww-choice-grid"><article class="ww-choice-card ww-choice-card--primary ww-glass-card"><h4>Start with a free wedding website</h4><p>Best for a quick website, RSVP form, guest list and seating plan.</p><button class="cta" id="ww-quick-start" type="button">Create Wedding Website</button></article><article class="ww-choice-card ww-glass-card"><h4>Build a full EventFlow plan</h4><p>Best if you also want budget, suppliers, packages and planning tasks.</p><a class="cta secondary" href="/start">Create Full Event Plan</a></article>${cachedPlans.length ? `<article class="ww-choice-card ww-glass-card"><h4>Use an existing plan</h4><select id="ww-existing-plan"><option value="">Select plan</option>${cachedPlans.map(p => `<option value="${esc(p.id)}">${esc(p.name || p.eventName || 'Untitled plan')}</option>`).join('')}</select><button class="cta secondary" id="ww-use-existing" type="button">Use Existing Plan</button></article>` : ''}</div></div>`;
    host.querySelector('#ww-quick-start')?.addEventListener('click', async () => { const res = await api('/api/me/plans/wedding-workspace', { method: 'POST' }); const nextPlan = res.plan; onReady(nextPlan, await getSite(nextPlan)); toast('Wedding workspace created'); });
    host.querySelector('#ww-use-existing')?.addEventListener('click', async () => { const selected = host.querySelector('#ww-existing-plan')?.value; const nextPlan = cachedPlans.find(p => String(p.id) === String(selected)); if (!nextPlan) return toast('Choose a plan first', 'warn'); onReady(nextPlan, await getSite(nextPlan)); });
  }

  async function renderOverview(host, plan, site, switchTab) {
    if (!plan) {
      host.innerHTML = `<div class="ww-app-panel ww-empty-state"><p class="ww-kicker">Overview</p><h3>No wedding workspace yet</h3><p>Create a wedding workspace to unlock the website, RSVPs, guest list and seating tools.</p><button type="button" class="cta small" data-tab="website">Start setup</button></div>`;
      host.querySelector('[data-tab]')?.addEventListener('click', e => switchTab(e.currentTarget.dataset.tab));
      return;
    }
    const [guests, rsvp, seating] = await Promise.all([api(`/api/me/plans/${encodeURIComponent(plan.id)}/guests`).catch(() => ({ guests: [] })), api(`/api/me/plans/${encodeURIComponent(plan.id)}/rsvp-summary`).catch(() => ({ summary: {} })), api(`/api/me/plans/${encodeURIComponent(plan.id)}/seating-summary`).catch(() => ({ summary: {} }))]);
    host.innerHTML = `<div class="ww-app-panel"><p class="ww-kicker">Overview</p><h3>Your wedding website workspace</h3><p>${esc(status(site, plan).text)}</p><div class="ww-overview-grid"><article><span>Website</span><strong>${esc(status(site, plan).label)}</strong><button type="button" class="cta secondary small" data-tab="website">Edit website</button></article><article><span>RSVPs</span><strong>${rsvp.summary?.responsesReceived || 0}/${rsvp.summary?.totalGuests || 0}</strong><button type="button" class="cta secondary small" data-tab="guests">Manage RSVPs</button></article><article><span>Guests</span><strong>${guests.guests?.length || 0}</strong><button type="button" class="cta secondary small" data-tab="guests">Open guests</button></article><article><span>Seating</span><strong>${seating.summary?.seated || 0} seated</strong><button type="button" class="cta secondary small" data-tab="seating">Open seating</button></article></div>${siteUrl(site) ? `<div class="ww-share-mini"><span>${esc(siteUrl(site))}</span><button class="cta secondary small" id="ww-copy-overview" type="button">Copy link</button></div>` : ''}</div>`;
    host.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    host.querySelector('#ww-copy-overview')?.addEventListener('click', () => copy(siteUrl(site)));
  }

  async function renderWebsite(host, plan, site, refresh) {
    if (!plan) return renderStart(host, refresh);
    if (!site) {
      host.innerHTML = `<div class="ww-app-panel ww-empty-state"><p class="ww-kicker">Website draft</p><h3>Create your free wedding website</h3><p>Start a draft, then add your details, RSVPs and guest information.</p><button class="cta" id="ww-create" type="button">Create Website</button></div>`;
      host.querySelector('#ww-create').addEventListener('click', async () => { await api(`/api/me/plans/${encodeURIComponent(plan.id)}/wedding-website`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); refresh(plan, await getSite(plan)); toast('Website draft created'); });
      return;
    }
    host.innerHTML = `<div class="ww-app-panel"><div class="ww-actions ww-builder-actions ww-glass-card"><button class="cta" id="ww-save" type="button">Save</button><button class="cta secondary" id="ww-pub" type="button">${site.status === 'published' ? 'Unpublish' : 'Publish'}</button><a class="cta secondary" target="_blank" rel="noopener" href="/wedding/${esc(site.slug)}">Preview</a></div><form id="ww-builder" class="ww-builder"><details open><summary>Essentials</summary><label>Couple names<input name="coupleNames" value="${esc(site.coupleNames || '')}"></label><label>Event date<input type="date" name="eventDate" value="${esc((site.eventDate || '').slice(0, 10))}"></label><label>Ceremony venue<input name="ceremonyVenueName" value="${esc(site.ceremonyVenueName || site.venueName || '')}"></label><label>Venue address<input name="ceremonyVenueAddress" value="${esc(site.ceremonyVenueAddress || site.venueAddress || '')}"></label><label>Welcome<textarea name="welcomeMessage">${esc(site.welcomeMessage || '')}</textarea></label></details><details><summary>FAQs & RSVP settings</summary><label class="ww-checkbox-row"><input class="ww-toggle" type="checkbox" name="rsvpEnabled" ${site.rsvpEnabled === false ? '' : 'checked'}><span>RSVP Enabled</span></label><label>RSVP deadline<input type="date" name="rsvpDeadline" value="${esc((site.rsvpDeadline || '').slice(0, 10))}"></label><label>RSVP intro<textarea name="rsvpIntroText">${esc(site.rsvpIntroText || '')}</textarea></label></details></form></div>`;
    host.querySelector('#ww-save').addEventListener('click', async () => { const form = host.querySelector('#ww-builder'); const payload = Object.fromEntries(new FormData(form).entries()); payload.rsvpEnabled = !!form.querySelector('[name=rsvpEnabled]').checked; await api(`/api/me/plans/${encodeURIComponent(plan.id)}/wedding-website`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); toast('Saved successfully'); refresh(plan, await getSite(plan)); });
    host.querySelector('#ww-pub').addEventListener('click', async () => { try { await api(`/api/me/plans/${encodeURIComponent(plan.id)}/wedding-website/${site.status === 'published' ? 'unpublish' : 'publish'}`, { method: 'POST' }); toast(site.status === 'published' ? 'Website unpublished' : 'Website published'); refresh(plan, await getSite(plan)); } catch (err) { const missing = err?.payload?.checklist?.missing; toast(Array.isArray(missing) ? `Before publishing: ${missing.join(', ')}` : err.message, 'warn'); } });
  }

  async function renderGuests(host, plan, afterChange) {
    if (!plan) { host.innerHTML = '<div class="ww-empty-state"><h3>Create a workspace first</h3><p>Guests and RSVPs will appear here.</p></div>'; return; }
    const [g, s] = await Promise.all([api(`/api/me/plans/${encodeURIComponent(plan.id)}/guests`), api(`/api/me/plans/${encodeURIComponent(plan.id)}/rsvp-summary`)]);
    const guests = g.guests || [];
    const sum = s.summary || {};
    host.innerHTML = `<div class="ww-app-panel"><p class="ww-kicker">RSVP command centre</p><h3>Guests & responses</h3><div class="ww-tiles"><div>Total <strong>${sum.totalGuests || 0}</strong></div><div>Responses <strong>${sum.responsesReceived || 0}</strong></div><div>Attending <strong>${sum.attending || 0}</strong></div><div>Declined <strong>${sum.declined || 0}</strong></div><div>Awaiting <strong>${sum.pending || 0}</strong></div><div>Dietary <strong>${sum.dietaryRequirementCount || 0}</strong></div></div><div class="ww-actions"><button class="cta secondary small" id="ww-add-guest" type="button">Add guest</button><a class="cta secondary small" href="/api/me/plans/${encodeURIComponent(plan.id)}/guests/export.csv">Export CSV</a></div><div class="ww-table-wrap"><table class="ww-table"><thead><tr><th>Name</th><th>RSVP</th><th>Meal</th><th>Dietary</th><th>Table</th><th>Actions</th></tr></thead><tbody>${guests.map(guest => `<tr><td>${esc(guest.name)}</td><td>${esc(guest.rsvpStatus || 'pending')}</td><td>${esc(guest.mealChoice || '')}</td><td>${esc(guest.dietaryRequirements || guest.dietary || '')}</td><td>${esc(guest.tableName || guest.table || '')}</td><td><button class="cta secondary small ww-edit" data-id="${esc(guest.id)}" type="button">Edit</button><button class="cta secondary small ww-btn-danger-soft ww-del" data-id="${esc(guest.id)}" type="button">Delete</button></td></tr>`).join('') || '<tr><td colspan="6">No guests yet.</td></tr>'}</tbody></table></div></div>`;
    const rerender = async () => { await renderGuests(host, plan, afterChange); await afterChange?.(); };
    host.querySelector('#ww-add-guest').addEventListener('click', () => editGuest(plan, null, rerender));
    host.querySelectorAll('.ww-edit').forEach(btn => btn.addEventListener('click', () => editGuest(plan, guests.find(guest => String(guest.id) === String(btn.dataset.id)), rerender)));
    host.querySelectorAll('.ww-del').forEach(btn => btn.addEventListener('click', async () => { await api(`/api/me/plans/${encodeURIComponent(plan.id)}/guests/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' }); rerender(); }));
  }

  function editGuest(plan, guest, rerender) {
    const g = guest || { name: '', email: '', rsvpStatus: 'pending', mealChoice: '', dietaryRequirements: '' };
    const dlg = document.createElement('dialog');
    dlg.className = 'ww-modal';
    dlg.innerHTML = `<form class="ww-modal__form" method="dialog"><h4>${guest ? 'Edit guest' : 'Add guest'}</h4><label>Name<input name="name" value="${esc(g.name)}" required></label><label>Email<input name="email" value="${esc(g.email || '')}"></label><label>RSVP<select name="rsvpStatus"><option ${g.rsvpStatus === 'pending' ? 'selected' : ''}>pending</option><option ${g.rsvpStatus === 'attending' ? 'selected' : ''}>attending</option><option ${g.rsvpStatus === 'declined' ? 'selected' : ''}>declined</option></select></label><label>Meal choice<input name="mealChoice" value="${esc(g.mealChoice || '')}"></label><label>Dietary<textarea name="dietaryRequirements">${esc(g.dietaryRequirements || g.dietary || '')}</textarea></label><div class="ww-actions"><button value="cancel">Cancel</button><button class="cta" id="ww-guest-save">Save</button></div></form>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('#ww-guest-save').addEventListener('click', async e => { e.preventDefault(); const payload = Object.fromEntries(new FormData(dlg.querySelector('form')).entries()); await api(`/api/me/plans/${encodeURIComponent(plan.id)}/guests${guest ? `/${encodeURIComponent(guest.id)}` : ''}`, { method: guest ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); dlg.close(); await rerender(); });
    dlg.addEventListener('close', () => dlg.remove(), { once: true });
  }

  async function renderSeating(host, plan) {
    if (!plan) { host.innerHTML = '<div class="ww-empty-state"><h3>Create a workspace first</h3><p>Seating tools will appear here.</p></div>'; return; }
    const [tablesRes, guestsRes, sumRes] = await Promise.all([api(`/api/me/plans/${encodeURIComponent(plan.id)}/tables`), api(`/api/me/plans/${encodeURIComponent(plan.id)}/guests`), api(`/api/me/plans/${encodeURIComponent(plan.id)}/seating-summary`)]);
    const tables = tablesRes.tables || [];
    const guests = guestsRes.guests || [];
    const unseated = guests.filter(g => g.rsvpStatus === 'attending' && !(g.tableId || g.tableName || g.table));
    host.innerHTML = `<div class="ww-app-panel"><p class="ww-kicker">Seating planner</p><h3>Tables & seating</h3><p>Tables: ${sumRes.summary?.tables || 0} • Seated: ${sumRes.summary?.seated || 0} • Unseated: ${sumRes.summary?.unseated || 0}</p><div class="ww-actions"><button class="cta secondary small" id="ww-add-table" type="button">Add table</button></div><div class="seat-grid">${tables.map(table => `<article class="seat-card"><div class="seat-card__head"><h5>${esc(table.name)}</h5><span class="seat-cap">${(table.guestIds || []).length}/${table.capacity || 0}</span></div>${(table.guestIds || []).map(id => { const guest = guests.find(item => item.id === id); return guest ? `<div class="seat-row">${esc(guest.name)} <button class="unassign" data-id="${esc(guest.id)}" type="button">Unassign</button></div>` : ''; }).join('')}<button class="cta secondary small del-table" data-id="${esc(table.id)}" type="button">Delete</button></article>`).join('') || '<p>No tables yet.</p>'}</div><h5>Unseated attending guests</h5><div class="ww-unseated">${unseated.map(guest => `<div class="seat-row">${esc(guest.name)} <select data-guest="${esc(guest.id)}"><option value="">Assign to table</option>${tables.map(table => `<option value="${esc(table.id)}">${esc(table.name)}</option>`).join('')}</select></div>`).join('') || '<p class="small">None</p>'}</div></div>`;
    const rerender = () => renderSeating(host, plan);
    host.querySelector('#ww-add-table')?.addEventListener('click', async () => { const name = window.prompt('Table name', `Table ${tables.length + 1}`); if (!name) return; await api(`/api/me/plans/${encodeURIComponent(plan.id)}/tables`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, capacity: 10, type: 'round' }) }); rerender(); });
    host.querySelectorAll('.del-table').forEach(btn => btn.addEventListener('click', async () => { await api(`/api/me/plans/${encodeURIComponent(plan.id)}/tables/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' }); rerender(); }));
    host.querySelectorAll('.ww-unseated select').forEach(select => select.addEventListener('change', async () => { if (!select.value) return; await api(`/api/me/plans/${encodeURIComponent(plan.id)}/tables/${encodeURIComponent(select.value)}/assign-guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guestId: select.dataset.guest }) }); rerender(); }));
    host.querySelectorAll('.unassign').forEach(btn => btn.addEventListener('click', async () => { await api(`/api/me/plans/${encodeURIComponent(plan.id)}/tables/unassign-guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guestId: btn.dataset.id }) }); rerender(); }));
  }

  function renderShare(host, plan, site, switchTab) {
    const url = siteUrl(site);
    host.innerHTML = `<div class="ww-app-panel"><p class="ww-kicker">Share</p><h3>${site?.status === 'published' ? 'Your website is published' : 'Your website is not live yet'}</h3><p>${url ? 'Copy or preview your guest link below.' : 'Create and publish your website before sharing.'}</p>${url ? `<div class="ww-share-card"><label>Guest link<input readonly value="${esc(url)}"></label><div class="ww-actions"><button class="cta" id="ww-copy-link" type="button">Copy link</button><a class="cta secondary" href="${esc(url)}" target="_blank" rel="noopener">Preview website</a><button type="button" class="cta secondary small" data-tab="website">Manage publishing</button></div></div>` : '<button type="button" class="cta small" data-tab="website">Create website</button>'}</div>`;
    host.querySelector('#ww-copy-link')?.addEventListener('click', () => copy(url));
    host.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Link copied'); } catch (_err) { window.prompt('Copy your wedding website link:', text); }
  }

  window.initWeddingWebsiteDashboard = initWeddingWebsiteDashboard;
})();
