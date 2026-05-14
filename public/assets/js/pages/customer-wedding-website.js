(function () {
  'use strict';

  const ROOT_ID = 'wedding-website-dashboard-root';
  const STATUS_ID = 'wedding-website-status-pill';
  const PAGE_SIZE = 25;
  let cachedPlans = [];
  let activeLauncher = null;

  function esc(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch]);
  }

  function uid(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function isWeddingPlan(plan) {
    const type = String(plan?.eventType || '').toLowerCase();
    const name = String(plan?.name || plan?.eventName || '').toLowerCase();
    return type === 'wedding' || name.includes('wedding');
  }

  function getCsrfToken() {
    const tokenFromMeta = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (tokenFromMeta) {
      return tokenFromMeta;
    }
    const match = document.cookie.match(/(?:^|; )csrfToken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  async function api(path, opts = {}) {
    const options = { credentials: 'same-origin', ...opts, headers: { ...(opts.headers || {}) } };
    const method = String(options.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && !options.headers['X-CSRF-Token']) {
      const token = getCsrfToken();
      if (token) {
        options.headers['X-CSRF-Token'] = token;
      }
    }
    const res = await fetch(path, options);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || json.message || 'Request failed');
      err.payload = json;
      throw err;
    }
    return json;
  }

  function toast(message, type = 'ok') {
    const el = document.createElement('div');
    el.className = `ww-toast ww-toast--${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    window.setTimeout(() => el.classList.add('show'), 10);
    window.setTimeout(() => {
      el.classList.remove('show');
      window.setTimeout(() => el.remove(), 250);
    }, 2400);
  }

  function getStatus(site, plan) {
    if (!plan) {
      return { key: 'not-started', label: 'Not started', text: 'Create your wedding website workspace.' };
    }
    if (!site) {
      return { key: 'draft', label: 'Draft', text: 'Create your website draft.' };
    }
    if (site.status === 'published') {
      return { key: 'published', label: 'Published', text: 'Your guest website is live and ready to share.' };
    }
    return { key: 'draft', label: 'Draft', text: 'Finish your details and publish when ready.' };
  }

  function setHeaderStatus(meta) {
    const pill = document.getElementById(STATUS_ID);
    if (!pill) {
      return;
    }
    pill.textContent = meta.label;
    pill.dataset.status = meta.key;
  }

  function publicUrl(site) {
    return site?.slug ? `${window.location.origin}/wedding/${site.slug}` : '';
  }

  async function getWebsite(plan) {
    if (!plan?.id) {
      return null;
    }
    const data = await api(`/api/me/plans/${encodeURIComponent(plan.id)}/wedding-website`).catch(() => ({}));
    return data.website || data.site || data.data?.website || null;
  }

  const filters = {
    all: () => true,
    attending: guest => guest.rsvpStatus === 'attending',
    declined: guest => guest.rsvpStatus === 'declined',
    awaiting: guest => !guest.rsvpStatus || guest.rsvpStatus === 'pending',
    dietary: guest => Boolean(guest.dietaryRequirements || guest.dietary),
    unseated: guest => guest.rsvpStatus === 'attending' && !(guest.tableId || guest.tableName || guest.table),
    manual: guest => !guest.source || guest.source === 'manual',
    public_rsvp: guest => guest.source === 'public_rsvp',
    attention: guest =>
      Boolean(guest.dietaryRequirements || guest.dietary || guest.accessibilityRequirements) ||
      (guest.rsvpStatus === 'attending' && !(guest.tableId || guest.tableName || guest.table)),
  };

  const filterLabels = {
    all: 'All',
    attending: 'Attending',
    declined: 'Declined',
    awaiting: 'Awaiting',
    dietary: 'Dietary',
    unseated: 'Unseated',
    manual: 'Manual',
    public_rsvp: 'Public RSVP',
    attention: 'Attention',
  };

  function statusBadge(status) {
    const normalized = String(status || 'pending').toLowerCase();
    return `<span class="ww-badge ww-badge--${esc(normalized)}">${esc(normalized)}</span>`;
  }

  function setBusy(button, busy) {
    if (!button) {
      return;
    }
    button.disabled = Boolean(busy);
    button.setAttribute('aria-busy', String(Boolean(busy)));
  }

  function renderRepeater(host, name, fields, items) {
    const list = Array.isArray(items) ? items : [];
    host.innerHTML = `<div class="rep-list"></div><button type="button" class="cta secondary small rep-add">Add ${esc(name)}</button>`;
    const listEl = host.querySelector('.rep-list');
    const draw = () => {
      if (!list.length) {
        listEl.innerHTML = `<p class="small">No ${esc(name.toLowerCase())} added yet.</p>`;
        return;
      }
      listEl.innerHTML = list
        .map(
          (item, index) => `<div class="rep-item">${fields
            .map(
              field =>
                `<label>${esc(field.label)}<input data-k="${esc(field.key)}" data-i="${index}" value="${esc(
                  item[field.key] || ''
                )}"></label>`
            )
            .join('')}<button type="button" data-i="${index}" class="cta secondary small ww-btn-danger-soft rep-del">Delete</button></div>`
        )
        .join('');
      listEl.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', () => {
          list[Number(input.dataset.i)][input.dataset.k] = input.value;
        });
      });
      listEl.querySelectorAll('.rep-del').forEach(button => {
        button.addEventListener('click', () => {
          list.splice(Number(button.dataset.i), 1);
          draw();
        });
      });
    };
    host.querySelector('.rep-add').addEventListener('click', () => {
      const item = { id: uid(name.toLowerCase().replace(/\s+/g, '-')) };
      fields.forEach(field => {
        item[field.key] = '';
      });
      list.push(item);
      draw();
    });
    draw();
    return list;
  }

  function renderLauncher(root, plan, site) {
    const meta = getStatus(site, plan);
    const url = publicUrl(site);
    setHeaderStatus(meta);
    root.innerHTML = `<section class="ww-launcher"><div class="ww-launcher__main"><span class="ww-launcher__orb" aria-hidden="true">💍</span><div><p class="ww-launcher__eyebrow">Guest website mini app</p><h4>Wedding Website & RSVPs</h4><p>${esc(
      meta.text
    )} Manage your website content, RSVP form, guest list, seating and sharing in one workspace.</p>${
      url
        ? `<a class="ww-launcher__link" href="${esc(url)}" target="_blank" rel="noopener">${esc(
            url.replace(/^https?:\/\//, '')
          )}</a>`
        : ''
    }</div></div><div class="ww-launcher__actions"><span class="customer-wedding-status-pill" data-status="${esc(
      meta.key
    )}">${esc(meta.label)}</span><button id="ww-open-app" class="cta ww-open-app" type="button">Open app</button></div></section>`;
    const button = root.querySelector('#ww-open-app');
    button?.addEventListener('click', () => {
      activeLauncher = button;
      openWidgetApp(plan, site);
    });
  }

  async function initWeddingWebsiteDashboard(plans) {
    cachedPlans = plans || [];
    const root = document.getElementById(ROOT_ID);
    if (!root) {
      return;
    }
    const plan = cachedPlans.filter(isWeddingPlan)[0] || null;
    renderLauncher(root, plan, await getWebsite(plan));
  }

  function openWidgetApp(initialPlan, initialSite) {
    let plan = initialPlan;
    let site = initialSite;
    const dialog = document.createElement('dialog');
    dialog.className = 'ww-app-dialog';
    dialog.setAttribute('aria-labelledby', 'ww-app-title');
    dialog.innerHTML = `<div class="ww-app-shell"><header class="ww-app-header"><div class="ww-app-title-group"><span class="ww-app-icon" aria-hidden="true">💍</span><div><p class="ww-kicker">EventFlow widget app</p><h2 id="ww-app-title">Wedding Website & RSVPs</h2><p>Manage your wedding website, RSVPs, guest list, seating and share link in one polished app.</p></div></div><div class="ww-app-header-actions"><span class="customer-wedding-status-pill ww-app-status"></span><button class="ww-app-close" type="button" aria-label="Close Wedding Website app">×</button></div></header><nav class="ww-app-tabs" aria-label="Wedding Website app sections"><button type="button" data-tab="overview" aria-selected="true">Overview</button><button type="button" data-tab="workspace">Workspace</button><button type="button" data-tab="guests">RSVPs & Guests</button><button type="button" data-tab="seating">Seating</button><button type="button" data-tab="share">Share</button></nav><div class="ww-app-body"><section class="ww-app-pane" data-pane="overview"></section><section class="ww-app-pane" data-pane="workspace" hidden></section><section class="ww-app-pane" data-pane="guests" hidden></section><section class="ww-app-pane" data-pane="seating" hidden></section><section class="ww-app-pane" data-pane="share" hidden></section></div></div>`;
    document.body.appendChild(dialog);
    document.body.classList.add('ww-app-open');

    const pane = name => dialog.querySelector(`[data-pane="${name}"]`);
    const switchTab = name => {
      dialog.querySelectorAll('.ww-app-tabs button').forEach(button => {
        button.setAttribute('aria-selected', String(button.dataset.tab === name));
      });
      dialog.querySelectorAll('.ww-app-pane').forEach(section => {
        section.hidden = section.dataset.pane !== name;
      });
    };
    const updateStatus = () => {
      const meta = getStatus(site, plan);
      const status = dialog.querySelector('.ww-app-status');
      status.textContent = meta.label;
      status.dataset.status = meta.key;
      setHeaderStatus(meta);
    };
    const refresh = async (nextPlan = plan, nextSite = site) => {
      plan = nextPlan;
      site = nextSite;
      updateStatus();
      await renderOverviewPane(pane('overview'), plan, site, switchTab);
      await renderWorkspacePane(pane('workspace'), plan, site, refresh);
      await renderGuestsPane(pane('guests'), plan, () => renderSeatingPane(pane('seating'), plan));
      await renderSeatingPane(pane('seating'), plan);
      renderSharePane(pane('share'), site, switchTab);
    };

    dialog.querySelector('.ww-app-close').addEventListener('click', () => dialog.close());
    dialog.querySelectorAll('.ww-app-tabs button').forEach(button => {
      button.addEventListener('click', () => switchTab(button.dataset.tab));
    });
    dialog.addEventListener(
      'close',
      async () => {
        document.body.classList.remove('ww-app-open');
        dialog.remove();
        const root = document.getElementById(ROOT_ID);
        const currentPlan = plan || cachedPlans.filter(isWeddingPlan)[0] || null;
        if (root) {
          renderLauncher(root, currentPlan, await getWebsite(currentPlan));
        }
        activeLauncher?.focus?.();
      },
      { once: true }
    );
    dialog.showModal();
    refresh()
      .then(() => switchTab('overview'))
      .catch(err => toast(err.message || 'Unable to load wedding widget', 'warn'));
  }

  async function renderOverviewPane(host, plan, site, switchTab) {
    if (!plan) {
      host.innerHTML = `<div class="ww-app-panel ww-empty-state"><p class="ww-kicker">Overview</p><h3>No wedding workspace yet</h3><p>Create a quick-start wedding website or attach an existing event plan.</p><button type="button" class="cta" data-tab="workspace">Start setup</button></div>`;
      host.querySelector('[data-tab]').addEventListener('click', () => switchTab('workspace'));
      return;
    }
    const [guestsRes, rsvpRes, seatingRes] = await Promise.all([
      api(`/api/me/plans/${encodeURIComponent(plan.id)}/guests`).catch(() => ({ guests: [] })),
      api(`/api/me/plans/${encodeURIComponent(plan.id)}/rsvp-summary`).catch(() => ({ summary: {} })),
      api(`/api/me/plans/${encodeURIComponent(plan.id)}/seating-summary`).catch(() => ({ summary: {} })),
    ]);
    const meta = getStatus(site, plan);
    const url = publicUrl(site);
    host.innerHTML = `<div class="ww-app-panel"><p class="ww-kicker">Overview</p><h3>Your wedding guest hub</h3><p>${esc(
      meta.text
    )}</p><div class="ww-overview-grid"><article><span>Website</span><strong>${esc(
      meta.label
    )}</strong><button type="button" class="cta secondary small" data-tab="workspace">Edit website</button></article><article><span>RSVPs</span><strong>${
      rsvpRes.summary?.responsesReceived || 0
    }/${rsvpRes.summary?.totalGuests || 0}</strong><button type="button" class="cta secondary small" data-tab="guests">Manage RSVPs</button></article><article><span>Guests</span><strong>${
      guestsRes.guests?.length || 0
    }</strong><button type="button" class="cta secondary small" data-tab="guests">Open guests</button></article><article><span>Seating</span><strong>${
      seatingRes.summary?.seated || 0
    } seated</strong><button type="button" class="cta secondary small" data-tab="seating">Open seating</button></article></div>${
      url
        ? `<div class="ww-share-mini"><span>${esc(url)}</span><button type="button" class="cta secondary small" id="ww-copy-overview">Copy link</button></div>`
        : '<div class="ww-share-mini"><span>Create and publish your website to get a share link.</span><button type="button" class="cta secondary small" data-tab="workspace">Finish setup</button></div>'
    }</div>`;
    host.querySelectorAll('[data-tab]').forEach(button => {
      button.addEventListener('click', () => switchTab(button.dataset.tab));
    });
    host.querySelector('#ww-copy-overview')?.addEventListener('click', () => copyLink(url));
  }

  async function renderWorkspacePane(host, plan, site, refresh) {
    if (!plan) {
      renderStartChoices(host, refresh);
      return;
    }
    await renderModule(plan, site, host, refresh);
  }

  function renderStartChoices(host, onReady) {
    host.innerHTML = `<div class="ww-app-panel ww-choice-panel"><p class="ww-kicker">Start here</p><h3>Create your wedding website workspace</h3><p>Create a guest website, collect RSVPs, manage your guest list and organise seating — with or without a full EventFlow plan.</p><div class="ww-choice-grid"><article class="ww-choice-card ww-glass-card ww-choice-card--primary"><h4>Start with a free wedding website</h4><p>Best if you want a guest website, RSVP form, guest list and seating plan quickly.</p><button class="cta" id="ww-quick-start" type="button">Create Wedding Website</button></article><article class="ww-choice-card ww-glass-card"><h4>Build a full EventFlow plan</h4><p>Best if you also want budget, suppliers, packages and planning tasks.</p><a class="cta secondary" href="/start">Create Full Event Plan</a></article>${
      cachedPlans.length
        ? `<article class="ww-choice-card ww-glass-card"><h4>Use an existing plan</h4><p>Select an existing plan and attach the wedding website to it.</p><select id="ww-existing-plan"><option value="">Select plan</option>${cachedPlans
            .map(item => `<option value="${esc(item.id)}">${esc(item.name || item.eventName || 'Untitled plan')}</option>`)
            .join('')}</select><button class="cta secondary" id="ww-use-existing" type="button">Use Existing Plan</button></article>`
        : ''
    }</div></div>`;
    host.querySelector('#ww-quick-start').addEventListener('click', async event => {
      setBusy(event.currentTarget, true);
      try {
        const res = await api('/api/me/plans/wedding-workspace', { method: 'POST' });
        const nextPlan = res.plan;
        await onReady(nextPlan, await getWebsite(nextPlan));
        toast('Wedding workspace created');
      } finally {
        setBusy(event.currentTarget, false);
      }
    });
    host.querySelector('#ww-use-existing')?.addEventListener('click', async event => {
      const selected = host.querySelector('#ww-existing-plan').value;
      const nextPlan = cachedPlans.find(item => String(item.id) === String(selected));
      if (!nextPlan) {
        toast('Choose a plan first', 'warn');
        return;
      }
      setBusy(event.currentTarget, true);
      await onReady(nextPlan, await getWebsite(nextPlan));
      setBusy(event.currentTarget, false);
    });
  }

  async function renderModule(plan, site, root, refresh) {
    if (!site) {
      root.innerHTML = `<section class="ww-app-panel ww-empty-state"><p class="ww-kicker">Website draft</p><h3>Create your free wedding website</h3><p>Start your draft, then refine content, RSVPs and seating in one workspace.</p><button class="cta" id="ww-create" type="button">Create Website</button></section>`;
      root.querySelector('#ww-create').addEventListener('click', async event => {
        setBusy(event.currentTarget, true);
        await api(`/api/me/plans/${encodeURIComponent(plan.id)}/wedding-website`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        toast('Website draft created');
        await refresh(plan, await getWebsite(plan));
      });
      return;
    }
    root.innerHTML = `<div class="ww-app-panel"><div class="ww-actions ww-builder-actions ww-glass-card"><button class="cta" id="ww-save" type="button">Save</button><button class="cta secondary" id="ww-pub" type="button">${
      site.status === 'published' ? 'Unpublish' : 'Publish'
    }</button><a class="cta secondary" target="_blank" rel="noopener" href="/wedding/${esc(
      site.slug
    )}">Preview</a></div><form id="ww-builder" class="ww-builder"><details open><summary>Essentials</summary><label>Couple names<input name="coupleNames" value="${esc(
      site.coupleNames || ''
    )}"></label><label>Event date<input type="date" name="eventDate" value="${esc(
      (site.eventDate || '').slice(0, 10)
    )}"></label><label>Ceremony venue name<input name="ceremonyVenueName" value="${esc(
      site.ceremonyVenueName || site.venueName || ''
    )}"></label><label>Ceremony venue address<input name="ceremonyVenueAddress" value="${esc(
      site.ceremonyVenueAddress || site.venueAddress || ''
    )}"></label><label>Reception venue name<input name="receptionVenueName" value="${esc(
      site.receptionVenueName || ''
    )}"></label><label>Reception venue address<input name="receptionVenueAddress" value="${esc(
      site.receptionVenueAddress || ''
    )}"></label><label>Welcome<textarea name="welcomeMessage">${esc(
      site.welcomeMessage || ''
    )}</textarea></label></details><details><summary>Travel & Accommodation</summary><div id="rep-acc"></div><div id="rep-taxi"></div><div id="rep-local"></div></details><details><summary>Wedding Party</summary><div id="rep-party"></div></details><details><summary>FAQs & RSVP settings</summary><div id="rep-faq"></div><div id="rep-meal"></div><div id="rep-questions"></div><label class="ww-checkbox-row"><input class="ww-toggle" type="checkbox" name="rsvpEnabled" ${
      site.rsvpEnabled === false ? '' : 'checked'
    }><span>RSVP Enabled</span></label><label>RSVP deadline<input type="date" name="rsvpDeadline" value="${esc(
      (site.rsvpDeadline || '').slice(0, 10)
    )}"></label><label>RSVP intro<textarea name="rsvpIntroText">${esc(
      site.rsvpIntroText || ''
    )}</textarea></label></details></form></div>`;
    const form = root.querySelector('#ww-builder');
    const acc = renderRepeater(
      form.querySelector('#rep-acc'),
      'Accommodation',
      [
        { key: 'name', label: 'Name' },
        { key: 'description', label: 'Description' },
        { key: 'address', label: 'Address' },
        { key: 'phone', label: 'Phone' },
        { key: 'websiteUrl', label: 'Website URL' },
        { key: 'distance', label: 'Distance' },
        { key: 'notes', label: 'Notes' },
      ],
      site.accommodationRecommendations || []
    );
    const taxi = renderRepeater(
      form.querySelector('#rep-taxi'),
      'Taxi',
      [
        { key: 'name', label: 'Name' },
        { key: 'phone', label: 'Phone' },
        { key: 'websiteUrl', label: 'Website URL' },
        { key: 'notes', label: 'Notes' },
      ],
      site.taxiRecommendations || []
    );
    const local = renderRepeater(
      form.querySelector('#rep-local'),
      'Local info',
      [
        { key: 'title', label: 'Title' },
        { key: 'description', label: 'Description' },
        { key: 'url', label: 'URL' },
        { key: 'type', label: 'Type' },
      ],
      site.localInfo || []
    );
    const party = renderRepeater(
      form.querySelector('#rep-party'),
      'Wedding party member',
      [
        { key: 'name', label: 'Name' },
        { key: 'role', label: 'Role' },
        { key: 'bio', label: 'Bio' },
        { key: 'imageUrl', label: 'Image URL' },
      ],
      site.weddingParty || []
    );
    const faq = renderRepeater(
      form.querySelector('#rep-faq'),
      'FAQ',
      [
        { key: 'question', label: 'Question' },
        { key: 'answer', label: 'Answer' },
      ],
      site.faq || []
    );
    const meal = renderRepeater(
      form.querySelector('#rep-meal'),
      'Meal option',
      [{ key: 'value', label: 'Meal option' }],
      (site.mealOptions || []).map(value => ({ id: uid('meal'), value }))
    );
    const questions = renderRepeater(
      form.querySelector('#rep-questions'),
      'Custom RSVP question',
      [
        { key: 'label', label: 'Question label' },
        { key: 'type', label: 'Type (text/textarea/select/checkbox)' },
        { key: 'required', label: 'Required (true/false)' },
        { key: 'optionsCsv', label: 'Options (comma separated)' },
      ],
      (site.customRsvpQuestions || []).map(question => ({
        id: question.id || uid('question'),
        label: question.label || '',
        type: question.type || 'text',
        required: String(Boolean(question.required)),
        optionsCsv: (question.options || []).join(', '),
      }))
    );

    root.querySelector('#ww-save').addEventListener('click', async event => {
      const button = event.currentTarget;
      setBusy(button, true);
      try {
        const payload = Object.fromEntries(new FormData(form).entries());
        payload.rsvpEnabled = Boolean(form.querySelector('[name=rsvpEnabled]').checked);
        payload.accommodationRecommendations = acc;
        payload.taxiRecommendations = taxi;
        payload.localInfo = local;
        payload.weddingParty = party;
        payload.faq = faq;
        payload.mealOptions = meal.map(item => item.value).filter(Boolean);
        payload.customRsvpQuestions = questions
          .filter(question => question.label)
          .map(question => ({
            id: question.id || uid('question'),
            label: question.label,
            type: question.type || 'text',
            required: String(question.required).toLowerCase() === 'true',
            options: String(question.optionsCsv || '')
              .split(',')
              .map(option => option.trim())
              .filter(Boolean),
          }));
        await api(`/api/me/plans/${encodeURIComponent(plan.id)}/wedding-website`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        toast('Saved successfully');
        await refresh(plan, await getWebsite(plan));
      } finally {
        setBusy(button, false);
      }
    });
    root.querySelector('#ww-pub').addEventListener('click', async event => {
      const button = event.currentTarget;
      setBusy(button, true);
      try {
        await api(`/api/me/plans/${encodeURIComponent(plan.id)}/wedding-website/${site.status === 'published' ? 'unpublish' : 'publish'}`, {
          method: 'POST',
        });
        toast(site.status === 'published' ? 'Website unpublished' : 'Website published');
        await refresh(plan, await getWebsite(plan));
      } catch (err) {
        const missing = err?.payload?.checklist?.missing;
        toast(
          Array.isArray(missing) && missing.length ? `Before publishing: ${missing.join(', ')}` : err.message || 'Unable to publish right now.',
          'warn'
        );
      } finally {
        setBusy(button, false);
      }
    });
  }

  function sortGuests(guests, sort) {
    return [...guests].sort((a, b) => {
      if (sort === 'name_asc') {
        return String(a.name || '').localeCompare(String(b.name || ''));
      }
      if (sort === 'status') {
        return String(a.rsvpStatus || 'pending').localeCompare(String(b.rsvpStatus || 'pending'));
      }
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
  }

  async function renderGuestsPane(root, plan, afterChange) {
    if (!plan) {
      root.innerHTML = '<section class="ww-app-panel ww-empty-state"><h3>Create a workspace first</h3><p>Guests and RSVPs will appear here.</p></section>';
      return;
    }
    const [guestsRes, summaryRes] = await Promise.all([
      api(`/api/me/plans/${encodeURIComponent(plan.id)}/guests`),
      api(`/api/me/plans/${encodeURIComponent(plan.id)}/rsvp-summary`),
    ]);
    const guests = guestsRes.guests || [];
    const summary = summaryRes.summary || {};
    const filter = root.dataset.guestFilter || 'all';
    const query = String(root.dataset.guestSearch || '').toLowerCase();
    const sort = root.dataset.guestSort || 'updated_desc';
    const page = Math.max(1, Number(root.dataset.guestPage || 1));
    const filtered = guests
      .filter(filters[filter] || filters.all)
      .filter(guest => !query || [guest.name, guest.email, guest.householdName, guest.plusOneName].some(value => String(value || '').toLowerCase().includes(query)));
    const sorted = sortGuests(filtered, sort);
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const shown = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    root.innerHTML = `<section class="ww-app-panel"><p class="ww-kicker">RSVP command centre</p><h3>Guests & responses</h3><div class="ww-tiles"><div>Total <strong>${
      summary.totalGuests || 0
    }</strong></div><div>Responses <strong>${summary.responsesReceived || 0}</strong></div><div>Attending <strong>${
      summary.attending || 0
    }</strong></div><div>Declined <strong>${summary.declined || 0}</strong></div><div>Awaiting <strong>${
      summary.pending || 0
    }</strong></div><div>Dietary <strong>${summary.dietaryRequirementCount || 0}</strong></div><div>Unseated <strong>${
      summary.unseatedAttending || 0
    }</strong></div></div><div class="ww-actions ww-actions--rsvp">${Object.keys(filters)
      .map(
        key =>
          `<button class="cta secondary small ww-filter ${filter === key ? 'ww-filter--active' : ''}" data-f="${esc(key)}" type="button">${esc(
            filterLabels[key] || key
          )}</button>`
      )
      .join('')}<input class="ww-search" id="ww-guest-search" placeholder="Search guests" value="${esc(
      root.dataset.guestSearch || ''
    )}"><select id="ww-guest-sort"><option value="updated_desc">Recently updated</option><option value="name_asc">Name A-Z</option><option value="status">RSVP status</option></select><button class="cta secondary small" id="ww-add-guest" type="button">Add guest</button><a class="cta secondary small" href="/api/me/plans/${encodeURIComponent(
      plan.id
    )}/guests/export.csv">Export CSV</a></div><div class="ww-table-wrap"><table class="ww-table"><thead><tr><th>Name</th><th>RSVP</th><th>Party</th><th>Meal</th><th>Dietary/Access</th><th>Table</th><th>Source</th><th>Updated</th><th>Actions</th></tr></thead><tbody>${
      shown
        .map(
          guest =>
            `<tr><td>${esc(guest.name)}</td><td>${statusBadge(guest.rsvpStatus)}</td><td>${guest.partySize || 1}</td><td>${esc(
              guest.mealChoice || ''
            )}</td><td>${esc([guest.dietaryRequirements || guest.dietary, guest.accessibilityRequirements].filter(Boolean).join(' • '))}</td><td>${esc(
              guest.tableName || guest.table || ''
            )}</td><td>${esc(guest.source || 'manual')}</td><td>${esc((guest.updatedAt || '').slice(0, 10))}</td><td><button class="cta secondary small ww-edit" data-id="${esc(
              guest.id
            )}" type="button">Edit</button><button class="cta secondary small ww-btn-danger-soft ww-del" data-id="${esc(
              guest.id
            )}" type="button">Delete</button></td></tr>`
        )
        .join('') || '<tr><td colspan="9">No guests yet.</td></tr>'
    }</tbody></table></div><div class="ww-pagination"><button class="cta secondary small" id="ww-prev-page" ${
      currentPage <= 1 ? 'disabled' : ''
    } type="button">Prev</button><span>Page ${currentPage} of ${totalPages} (${sorted.length} guests)</span><button class="cta secondary small" id="ww-next-page" ${
      currentPage >= totalPages ? 'disabled' : ''
    } type="button">Next</button></div></section>`;
    const rerender = async () => {
      await renderGuestsPane(root, plan, afterChange);
      await afterChange?.();
    };
    root.querySelectorAll('.ww-filter').forEach(button => {
      button.addEventListener('click', async () => {
        root.dataset.guestFilter = button.dataset.f;
        root.dataset.guestPage = '1';
        await rerender();
      });
    });
    root.querySelector('#ww-guest-search').addEventListener('input', async event => {
      root.dataset.guestSearch = event.target.value || '';
      root.dataset.guestPage = '1';
      await rerender();
    });
    root.querySelector('#ww-guest-sort').value = sort;
    root.querySelector('#ww-guest-sort').addEventListener('change', async event => {
      root.dataset.guestSort = event.target.value;
      await rerender();
    });
    root.querySelector('#ww-prev-page').addEventListener('click', async () => {
      root.dataset.guestPage = String(Math.max(1, currentPage - 1));
      await rerender();
    });
    root.querySelector('#ww-next-page').addEventListener('click', async () => {
      root.dataset.guestPage = String(Math.min(totalPages, currentPage + 1));
      await rerender();
    });
    root.querySelector('#ww-add-guest').addEventListener('click', () => editGuestModal(plan.id, null, rerender));
    root.querySelectorAll('.ww-edit').forEach(button => {
      button.addEventListener('click', () => editGuestModal(plan.id, guests.find(guest => String(guest.id) === String(button.dataset.id)), rerender));
    });
    root.querySelectorAll('.ww-del').forEach(button => {
      button.addEventListener('click', async () => {
        await api(`/api/me/plans/${encodeURIComponent(plan.id)}/guests/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
        await rerender();
      });
    });
  }

  function openModal(dialog) {
    document.body.appendChild(dialog);
    try {
      dialog.showModal();
    } catch (_err) {
      dialog.show();
    }
  }

  function editGuestModal(planId, guest, onSaved) {
    const defaultGuest = {
      name: '',
      email: '',
      phone: '',
      rsvpStatus: 'pending',
      partySize: 1,
      plusOneName: '',
      childrenCount: 0,
      mealChoice: '',
      dietaryRequirements: '',
      accessibilityRequirements: '',
      songRequest: '',
      notes: '',
    };
    const g = guest || defaultGuest;
    const dialog = document.createElement('dialog');
    dialog.className = 'ww-modal';
    dialog.innerHTML = `<form method="dialog" class="ww-modal__form"><h4>${guest ? 'Edit guest' : 'Add guest'}</h4><label>Name<input name="name" value="${esc(
      g.name
    )}" required></label><label>Email<input name="email" value="${esc(g.email || '')}"></label><label>Phone<input name="phone" value="${esc(
      g.phone || ''
    )}"></label><label>RSVP<select name="rsvpStatus"><option ${g.rsvpStatus === 'pending' ? 'selected' : ''}>pending</option><option ${
      g.rsvpStatus === 'attending' ? 'selected' : ''
    }>attending</option><option ${g.rsvpStatus === 'declined' ? 'selected' : ''}>declined</option><option ${
      g.rsvpStatus === 'maybe' ? 'selected' : ''
    }>maybe</option></select></label><label>Party size<input name="partySize" type="number" min="1" max="20" value="${Number(
      g.partySize || 1
    )}"></label><label>Plus one name<input name="plusOneName" value="${esc(
      g.plusOneName || ''
    )}"></label><label>Children count<input name="childrenCount" type="number" min="0" max="10" value="${Number(
      g.childrenCount || 0
    )}"></label><label>Meal choice<input name="mealChoice" value="${esc(
      g.mealChoice || ''
    )}"></label><label>Dietary<textarea name="dietaryRequirements">${esc(
      g.dietaryRequirements || g.dietary || ''
    )}</textarea></label><label>Accessibility<textarea name="accessibilityRequirements">${esc(
      g.accessibilityRequirements || ''
    )}</textarea></label><label>Song request<input name="songRequest" value="${esc(g.songRequest || '')}"></label><label>Notes<textarea name="notes">${esc(
      g.notes || ''
    )}</textarea></label><div class="ww-actions"><button value="cancel">Cancel</button><button id="ww-guest-save" value="default" class="cta">Save</button></div></form>`;
    openModal(dialog);
    dialog.querySelector('#ww-guest-save').addEventListener('click', async event => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(dialog.querySelector('form')).entries());
      if (!payload.name) {
        return;
      }
      setBusy(event.currentTarget, true);
      await api(`/api/me/plans/${encodeURIComponent(planId)}/guests${guest ? `/${encodeURIComponent(guest.id)}` : ''}`, {
        method: guest ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      dialog.close();
      await onSaved();
    });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
  }

  async function editTableModal(table) {
    return new Promise(resolve => {
      let resolved = false;
      const dialog = document.createElement('dialog');
      dialog.className = 'ww-modal';
      dialog.innerHTML = `<form method="dialog" class="ww-modal__form"><h4>${
        table.id ? 'Edit table' : 'Add table'
      }</h4><label>Name<input name="name" value="${esc(
        table.name || ''
      )}" required></label><label>Type<select name="type"><option value="round">round</option><option value="long">long</option><option value="top_table">top_table</option><option value="custom">custom</option></select></label><label>Capacity<input name="capacity" type="number" min="1" max="30" value="${Number(
        table.capacity || 10
      )}"></label><label>Notes<textarea name="notes">${esc(
        table.notes || ''
      )}</textarea></label><div class="ww-actions"><button value="cancel">Cancel</button><button class="cta" id="save-table">Save</button></div></form>`;
      openModal(dialog);
      dialog.querySelector('select[name="type"]').value = table.type || 'round';
      dialog.querySelector('#save-table').addEventListener('click', event => {
        event.preventDefault();
        const payload = Object.fromEntries(new FormData(dialog.querySelector('form')).entries());
        payload.capacity = Number(payload.capacity) || 10;
        resolved = true;
        dialog.close();
        resolve(payload);
      });
      dialog.addEventListener(
        'close',
        () => {
          if (document.body.contains(dialog)) {
            dialog.remove();
          }
          if (!resolved) {
            resolve(null);
          }
        },
        { once: true }
      );
    });
  }

  async function renderSeatingPane(root, plan) {
    if (!plan) {
      root.innerHTML = '<section class="ww-app-panel ww-empty-state"><h3>Create a workspace first</h3><p>Seating tools will appear here.</p></section>';
      return;
    }
    const [tablesRes, guestsRes, seatingRes] = await Promise.all([
      api(`/api/me/plans/${encodeURIComponent(plan.id)}/tables`),
      api(`/api/me/plans/${encodeURIComponent(plan.id)}/guests`),
      api(`/api/me/plans/${encodeURIComponent(plan.id)}/seating-summary`),
    ]);
    const tables = tablesRes.tables || [];
    const guests = guestsRes.guests || [];
    const attending = guests.filter(guest => guest.rsvpStatus === 'attending');
    const unseated = attending.filter(guest => !(guest.tableId || guest.tableName || guest.table));
    root.innerHTML = `<section class="ww-app-panel"><p class="ww-kicker">Seating planner</p><h3>Tables & seating</h3><p>Tables: ${
      seatingRes.summary?.tables || 0
    } • Seated: ${seatingRes.summary?.seated || 0} • Unseated: ${seatingRes.summary?.unseated || 0}</p>${
      unseated.length === 0 && attending.length ? '<p class="ww-success">All attending guests are seated.</p>' : ''
    }<div class="ww-actions"><button class="cta secondary small" id="ww-add-table" type="button">Add table</button></div><div class="seat-grid">${
      tables
        .map(
          table =>
            `<div class="seat-card"><div class="seat-card__head"><h5>${esc(table.name)}</h5><span class="seat-cap ${
              (table.guestIds || []).length > table.capacity ? 'seat-cap--warn' : ''
            }">${(table.guestIds || []).length}/${table.capacity}</span></div><p>${esc(table.type)}</p>${(table.guestIds || [])
              .map(id => {
                const guest = guests.find(item => item.id === id);
                return guest ? `<div class="seat-row">${esc(guest.name)} <button class="unassign" data-id="${esc(guest.id)}" type="button">Unassign</button></div>` : '';
              })
              .join('')}<button class="cta secondary small edit-table" data-id="${esc(
              table.id
            )}" type="button">Edit</button><button class="cta secondary small ww-btn-danger-soft del-table" data-id="${esc(
              table.id
            )}" type="button">Delete</button></div>`
        )
        .join('') || '<p class="small">No tables yet.</p>'
    }</div><h5>Unseated attending guests</h5><div class="ww-unseated">${
      unseated
        .map(
          guest =>
            `<div class="seat-row">${esc(guest.name)} <select data-guest="${esc(guest.id)}" class="assign-select"><option value="">Assign to table</option>${tables
              .map(table => `<option value="${esc(table.id)}">${esc(table.name)}</option>`)
              .join('')}</select></div>`
        )
        .join('') || '<p class="small">None</p>'
    }</div></section>`;
    const rerender = () => renderSeatingPane(root, plan);
    root.querySelector('#ww-add-table').addEventListener('click', async () => {
      const payload = await editTableModal({ name: `Table ${tables.length + 1}`, capacity: 10, type: 'round' });
      if (!payload) {
        return;
      }
      await api(`/api/me/plans/${encodeURIComponent(plan.id)}/tables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await rerender();
    });
    root.querySelectorAll('.del-table').forEach(button => {
      button.addEventListener('click', async () => {
        await api(`/api/me/plans/${encodeURIComponent(plan.id)}/tables/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
        await rerender();
      });
    });
    root.querySelectorAll('.edit-table').forEach(button => {
      button.addEventListener('click', async () => {
        const table = tables.find(item => String(item.id) === String(button.dataset.id));
        const payload = await editTableModal(table);
        if (!payload) {
          return;
        }
        await api(`/api/me/plans/${encodeURIComponent(plan.id)}/tables/${encodeURIComponent(table.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        await rerender();
      });
    });
    root.querySelectorAll('.assign-select').forEach(select => {
      select.addEventListener('change', async () => {
        if (!select.value) {
          return;
        }
        await api(`/api/me/plans/${encodeURIComponent(plan.id)}/tables/${encodeURIComponent(select.value)}/assign-guest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guestId: select.dataset.guest }),
        });
        await rerender();
      });
    });
    root.querySelectorAll('.unassign').forEach(button => {
      button.addEventListener('click', async () => {
        await api(`/api/me/plans/${encodeURIComponent(plan.id)}/tables/unassign-guest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guestId: button.dataset.id }),
        });
        await rerender();
      });
    });
  }

  function renderSharePane(root, site, switchTab) {
    const url = publicUrl(site);
    root.innerHTML = `<section class="ww-app-panel"><p class="ww-kicker">Share</p><h3>${
      site?.status === 'published' ? 'Your website is published' : 'Your website is not live yet'
    }</h3><p>${url ? 'Copy or preview your guest link below.' : 'Create and publish your website before sharing.'}</p>${
      url
        ? `<div class="ww-share-card"><label>Guest link<input readonly value="${esc(url)}"></label><div class="ww-actions"><button type="button" class="cta" id="ww-copy-link">Copy link</button><a class="cta secondary" href="${esc(url)}" target="_blank" rel="noopener">Preview website</a><button type="button" class="cta secondary small" data-tab="workspace">Manage publishing</button></div></div>`
        : '<button type="button" class="cta" data-tab="workspace">Create website</button>'
    }</section>`;
    root.querySelector('#ww-copy-link')?.addEventListener('click', () => copyLink(url));
    root.querySelectorAll('[data-tab]').forEach(button => {
      button.addEventListener('click', () => switchTab(button.dataset.tab));
    });
  }

  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch (_err) {
      window.prompt('Copy your wedding website link:', url);
    }
  }

  window.initWeddingWebsiteDashboard = initWeddingWebsiteDashboard;
})();
