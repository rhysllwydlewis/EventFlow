(function () {
  function isWeddingPlan(plan) {
    const type = String(plan?.eventType || '').toLowerCase();
    const name = String(plan?.name || plan?.eventName || '').toLowerCase();
    return type === 'wedding' || name.includes('wedding');
  }
  const esc = s =>
    String(s || '').replace(
      /[&<>"']/g,
      m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]
    );
  const uid = p => `${p}_${Math.random().toString(36).slice(2, 9)}`;
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    const tokenFromMeta = meta?.getAttribute('content');
    if (tokenFromMeta) {
      return tokenFromMeta;
    }
    const cookieMatch = document.cookie.match(/(?:^|; )csrfToken=([^;]+)/);
    return cookieMatch ? decodeURIComponent(cookieMatch[1]) : '';
  }
  async function api(path, opts) {
    const options = { ...(opts || {}) };
    options.credentials = options.credentials || 'same-origin';
    const method = String(options.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      options.headers = { ...(options.headers || {}) };
      if (!options.headers['X-CSRF-Token']) {
        const csrfToken = getCsrfToken();
        if (csrfToken) {
          options.headers['X-CSRF-Token'] = csrfToken;
        }
      }
    }
    const r = await fetch(path, options);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(j.error || 'Request failed');
      err.payload = j;
      throw err;
    }
    return j;
  }
  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = `ww-toast ww-toast--${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 250);
    }, 2200);
  }
  const filters = {
    all: () => true,
    attending: g => g.rsvpStatus === 'attending',
    declined: g => g.rsvpStatus === 'declined',
    awaiting: g => !g.rsvpStatus || g.rsvpStatus === 'pending',
    dietary: g => !!(g.dietaryRequirements || g.dietary),
    unseated: g => g.rsvpStatus === 'attending' && !(g.tableId || g.tableName || g.table),
    manual: g => !g.source || g.source === 'manual',
    public_rsvp: g => g.source === 'public_rsvp',
    attention: g =>
      !!(g.dietaryRequirements || g.dietary || g.accessibilityRequirements) ||
      (g.rsvpStatus === 'attending' && !(g.tableId || g.tableName || g.table)),
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
    return `<span class='ww-badge ww-badge--${esc(normalized)}'>${esc(normalized)}</span>`;
  }

  function renderRepeater(host, name, fields, items) {
    const list = items || [];
    host.innerHTML = `<div class='rep-list'></div><button type='button' class='cta secondary small rep-add'>Add ${name}</button>`;
    const listEl = host.querySelector('.rep-list');
    const draw = () => {
      if (!list.length) {
        listEl.innerHTML = `<p class='small'>No ${name.toLowerCase()} added yet.</p>`;
        return;
      }
      listEl.innerHTML = list
        .map(
          (it, i) =>
            `<div class='rep-item'>${fields.map(f => `<label>${f.label}<input data-k='${f.key}' data-i='${i}' value='${esc(it[f.key] || '')}'></label>`).join('')}<button type='button' data-i='${i}' class='cta secondary small ww-btn-danger-soft rep-del'>Delete</button></div>`
        )
        .join('');
      listEl.querySelectorAll('input').forEach(
        inp =>
          (inp.oninput = () => {
            list[Number(inp.dataset.i)][inp.dataset.k] = inp.value;
          })
      );
      listEl.querySelectorAll('.rep-del').forEach(
        btn =>
          (btn.onclick = () => {
            list.splice(Number(btn.dataset.i), 1);
            draw();
          })
      );
    };
    host.querySelector('.rep-add').onclick = () => {
      const obj = { id: uid(name.toLowerCase()) };
      fields.forEach(f => {
        obj[f.key] = '';
      });
      list.push(obj);
      draw();
    };
    draw();
    return list;
  }

  async function renderGuests(planId, root) {
    const [g, s] = await Promise.all([
      api(`/api/me/plans/${planId}/guests`),
      api(`/api/me/plans/${planId}/rsvp-summary`),
    ]);
    const guests = g.guests || [];
    const sum = s.summary || {};
    const filter = root.dataset.guestFilter || 'all';
    const q = String(root.dataset.guestSearch || '').toLowerCase();
    const sort = root.dataset.guestSort || 'updated_desc';
    const pageSize = 25;
    const page = Math.max(1, Number(root.dataset.guestPage || 1));
    const filtered = guests.filter(filters[filter] || filters.all).filter(
      g =>
        !q ||
        [g.name, g.email, g.householdName, g.plusOneName].some(v =>
          String(v || '')
            .toLowerCase()
            .includes(q)
        )
    );
    const sorted = [...filtered].sort((a, b) => {
      if (sort === 'name_asc') {
        return String(a.name || '').localeCompare(String(b.name || ''));
      }
      if (sort === 'status') {
        return String(a.rsvpStatus || 'pending').localeCompare(String(b.rsvpStatus || 'pending'));
      }
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const currentPage = Math.min(page, totalPages);
    const shown = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    root.querySelector('.ww-rsvp').innerHTML =
      `<div class='ww-tiles'><div>Total <strong>${sum.totalGuests || 0}</strong></div><div>Responses <strong>${sum.responsesReceived || 0}</strong></div><div>Attending <strong>${sum.attending || 0}</strong></div><div>Declined <strong>${sum.declined || 0}</strong></div><div>Awaiting <strong>${sum.pending || 0}</strong></div><div>Dietary <strong>${sum.dietaryRequirementCount || 0}</strong></div><div>Unseated <strong>${sum.unseatedAttending || 0}</strong></div></div>
    <div class='ww-actions ww-actions--rsvp'>${Object.keys(filters)
      .map(
        f =>
          `<button class='cta secondary small ww-filter ${filter === f ? 'ww-filter--active' : ''}' data-f='${f}'>${filterLabels[f] || f}</button>`
      )
      .join(
        ''
      )}<input class='ww-search' id='ww-guest-search' placeholder='Search guests' value='${esc(root.dataset.guestSearch || '')}'><select id='ww-guest-sort'><option value='updated_desc'>Recently updated</option><option value='name_asc'>Name A-Z</option><option value='status'>RSVP status</option></select><button class='cta secondary small' id='ww-add-guest'>Add guest</button><a class='cta secondary small' href='/api/me/plans/${planId}/guests/export.csv'>Export CSV</a></div>
    <table class='ww-table'><thead><tr><th>Name</th><th>RSVP</th><th>Party</th><th>Meal</th><th>Dietary/Access</th><th>Table</th><th>Source</th><th>Updated</th><th>Actions</th></tr></thead><tbody>${shown.map(x => `<tr><td>${esc(x.name)}</td><td>${statusBadge(x.rsvpStatus)}</td><td>${x.partySize || 1}</td><td>${esc(x.mealChoice || '')}</td><td>${esc([x.dietaryRequirements || x.dietary, x.accessibilityRequirements].filter(Boolean).join(' • '))}</td><td>${esc(x.tableName || x.table || '')}</td><td>${esc(x.source || 'manual')}</td><td>${esc((x.updatedAt || '').slice(0, 10))}</td><td><button class='cta secondary small ww-edit' data-id='${x.id}'>Edit</button><button class='cta secondary small ww-btn-danger-soft ww-del' data-id='${x.id}'>Delete</button></td></tr>`).join('')}</tbody></table><div class='ww-pagination'><button class='cta secondary small' id='ww-prev-page' ${currentPage <= 1 ? 'disabled' : ''}>Prev</button><span>Page ${currentPage} of ${totalPages} (${sorted.length} guests)</span><button class='cta secondary small' id='ww-next-page' ${currentPage >= totalPages ? 'disabled' : ''}>Next</button></div>`;
    root.querySelectorAll('.ww-filter').forEach(
      b =>
        (b.onclick = async () => {
          root.dataset.guestFilter = b.dataset.f;
          await renderGuests(planId, root);
        })
    );
    root.querySelector('#ww-add-guest').onclick = async () => editGuest(planId, root, null);
    root.querySelector('#ww-guest-search').oninput = async e => {
      root.dataset.guestSearch = e.target.value || '';
      root.dataset.guestPage = '1';
      await renderGuests(planId, root);
    };
    root.querySelector('#ww-guest-sort').value = sort;
    root.querySelector('#ww-guest-sort').onchange = async e => {
      root.dataset.guestSort = e.target.value;
      await renderGuests(planId, root);
    };
    root.querySelector('#ww-prev-page').onclick = async () => {
      root.dataset.guestPage = String(Math.max(1, currentPage - 1));
      await renderGuests(planId, root);
    };
    root.querySelector('#ww-next-page').onclick = async () => {
      root.dataset.guestPage = String(Math.min(totalPages, currentPage + 1));
      await renderGuests(planId, root);
    };
    root.querySelectorAll('.ww-edit').forEach(
      b =>
        (b.onclick = async () =>
          editGuest(
            planId,
            root,
            guests.find(x => x.id === b.dataset.id)
          ))
    );
    root.querySelectorAll('.ww-del').forEach(
      b =>
        (b.onclick = async () => {
          await api(`/api/me/plans/${planId}/guests/${b.dataset.id}`, { method: 'DELETE' });
          await renderGuests(planId, root);
        })
    );
  }

  async function editGuest(planId, root, guest) {
    const g = guest || {
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
    const dlg = document.createElement('dialog');
    dlg.className = 'ww-modal';
    dlg.innerHTML = `<form method='dialog' class='ww-modal__form'><h4>${guest ? 'Edit guest' : 'Add guest'}</h4>
      <label>Name<input name='name' value='${esc(g.name)}' required></label>
      <label>Email<input name='email' value='${esc(g.email || '')}'></label>
      <label>Phone<input name='phone' value='${esc(g.phone || '')}'></label>
      <label>RSVP<select name='rsvpStatus'><option ${g.rsvpStatus === 'pending' ? 'selected' : ''}>pending</option><option ${g.rsvpStatus === 'attending' ? 'selected' : ''}>attending</option><option ${g.rsvpStatus === 'declined' ? 'selected' : ''}>declined</option><option ${g.rsvpStatus === 'maybe' ? 'selected' : ''}>maybe</option></select></label>
      <label>Party size<input name='partySize' type='number' min='1' max='20' value='${Number(g.partySize || 1)}'></label>
      <label>Plus one name<input name='plusOneName' value='${esc(g.plusOneName || '')}'></label>
      <label>Children count<input name='childrenCount' type='number' min='0' max='10' value='${Number(g.childrenCount || 0)}'></label>
      <label>Meal choice<input name='mealChoice' value='${esc(g.mealChoice || '')}'></label>
      <label>Dietary<textarea name='dietaryRequirements'>${esc(g.dietaryRequirements || g.dietary || '')}</textarea></label>
      <label>Accessibility<textarea name='accessibilityRequirements'>${esc(g.accessibilityRequirements || '')}</textarea></label>
      <label>Song request<input name='songRequest' value='${esc(g.songRequest || '')}'></label>
      <label>Notes<textarea name='notes'>${esc(g.notes || '')}</textarea></label>
      <div class='ww-actions'><button value='cancel'>Cancel</button><button id='ww-guest-save' value='default' class='cta'>Save</button></div></form>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('#ww-guest-save').onclick = async e => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(dlg.querySelector('form')).entries());
      if (!payload.name) {
        return;
      }
      if (guest) {
        await api(`/api/me/plans/${planId}/guests/${guest.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await api(`/api/me/plans/${planId}/guests`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      dlg.close();
      dlg.remove();
      await renderGuests(planId, root);
      await renderSeating(planId, root);
    };
    dlg.addEventListener('close', () => dlg.remove());
  }

  async function editTableModal(table) {
    return new Promise(resolve => {
      const dlg = document.createElement('dialog');
      dlg.className = 'ww-modal';
      dlg.innerHTML = `<form method='dialog' class='ww-modal__form'><h4>${table.id ? 'Edit table' : 'Add table'}</h4>
      <label>Name<input name='name' value='${esc(table.name || '')}' required></label>
      <label>Type<select name='type'><option value='round'>round</option><option value='long'>long</option><option value='top_table'>top_table</option><option value='custom'>custom</option></select></label>
      <label>Capacity<input name='capacity' type='number' min='1' max='30' value='${Number(table.capacity || 10)}'></label>
      <label>Notes<textarea name='notes'>${esc(table.notes || '')}</textarea></label>
      <div class='ww-actions'><button value='cancel'>Cancel</button><button class='cta' id='save-table'>Save</button></div></form>`;
      document.body.appendChild(dlg);
      dlg.querySelector("select[name='type']").value = table.type || 'round';
      dlg.showModal();
      dlg.querySelector('#save-table').onclick = e => {
        e.preventDefault();
        const payload = Object.fromEntries(new FormData(dlg.querySelector('form')).entries());
        payload.capacity = Number(payload.capacity) || 10;
        dlg.close();
        dlg.remove();
        resolve(payload);
      };
      dlg.addEventListener('close', () => {
        if (document.body.contains(dlg)) {
          dlg.remove();
        }
        resolve(null);
      });
    });
  }

  async function renderSeating(planId, root) {
    const [tablesRes, guestsRes, seatingRes] = await Promise.all([
      api(`/api/me/plans/${planId}/tables`),
      api(`/api/me/plans/${planId}/guests`),
      api(`/api/me/plans/${planId}/seating-summary`),
    ]);
    const tables = tablesRes.tables || [];
    const guests = guestsRes.guests || [];
    const candidates = guests.filter(g => g.rsvpStatus === 'attending');
    const unseated = candidates.filter(g => !(g.tableId || g.tableName || g.table));
    root.querySelector('.ww-seating').innerHTML =
      `<h4>Seating</h4><p class='small'>Tables: ${seatingRes.summary.tables} • Seated: ${seatingRes.summary.seated} • Unseated: ${seatingRes.summary.unseated}</p>${unseated.length === 0 && candidates.length ? "<p class='ww-success'>All attending guests are seated.</p>" : ''}<div class='ww-actions'><button class='cta secondary small' id='ww-add-table'>Add table</button></div><div class='seat-grid'>${tables
        .map(
          t =>
            `<div class='seat-card'><div class='seat-card__head'><h5>${esc(t.name)}</h5><span class='seat-cap ${(t.guestIds || []).length > t.capacity ? 'seat-cap--warn' : ''}'>${(t.guestIds || []).length}/${t.capacity}</span></div><p>${esc(t.type)}</p>${(t.guestIds || []).length > t.capacity ? '<p class="warn">Over capacity</p>' : ''}<div>${(
              t.guestIds || []
            )
              .map(id => {
                const g = guests.find(x => x.id === id);
                return g
                  ? `<div class='seat-row'>${esc(g.name)} <button class='unassign' data-id='${g.id}'>Unassign</button></div>`
                  : '';
              })
              .join(
                ''
              )}</div><button class='cta secondary small edit-table' data-id='${t.id}'>Edit</button><button class='cta secondary small ww-btn-danger-soft del-table' data-id='${t.id}'>Delete</button></div>`
        )
        .join(
          ''
        )}</div><h5>Unseated attending guests</h5><div class='ww-unseated'>${unseated.map(g => `<div class='seat-row'>${esc(g.name)} <select data-guest='${g.id}' class='assign-select'><option value=''>Assign to table</option>${tables.map(t => `<option value='${t.id}'>${esc(t.name)}</option>`).join('')}</select></div>`).join('') || '<p class="small">None</p>'}</div>`;
    root.querySelector('#ww-add-table').onclick = async () => {
      const payload = await editTableModal({
        name: `Table ${tables.length + 1}`,
        capacity: 10,
        type: 'round',
      });
      if (!payload) {
        return;
      }
      await api(`/api/me/plans/${planId}/tables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await renderSeating(planId, root);
      await renderGuests(planId, root);
    };
    root.querySelectorAll('.del-table').forEach(
      b =>
        (b.onclick = async () => {
          await api(`/api/me/plans/${planId}/tables/${b.dataset.id}`, { method: 'DELETE' });
          await renderSeating(planId, root);
          await renderGuests(planId, root);
        })
    );
    root.querySelectorAll('.edit-table').forEach(
      b =>
        (b.onclick = async () => {
          const t = tables.find(x => x.id === b.dataset.id);
          const payload = await editTableModal(t);
          if (!payload) {
            return;
          }
          await api(`/api/me/plans/${planId}/tables/${t.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          await renderSeating(planId, root);
        })
    );
    root.querySelectorAll('.assign-select').forEach(
      s =>
        (s.onchange = async () => {
          if (!s.value) {
            return;
          }
          await api(`/api/me/plans/${planId}/tables/${s.value}/assign-guest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guestId: s.dataset.guest }),
          });
          await renderSeating(planId, root);
          await renderGuests(planId, root);
        })
    );
    root.querySelectorAll('.unassign').forEach(
      b =>
        (b.onclick = async () => {
          await api(`/api/me/plans/${planId}/tables/unassign-guest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guestId: b.dataset.id }),
          });
          await renderSeating(planId, root);
          await renderGuests(planId, root);
        })
    );
  }

  async function renderModule(plan, site, root) {
    if (!site) {
      root.innerHTML = `<section class='ww-glass-card'><h4>Create your free wedding website</h4><p>Start your draft, then refine content, RSVPs, and seating in one workspace.</p><button class='cta' id='ww-create'>Create Website</button></section>`;
      root.querySelector('#ww-create').onclick = async () => {
        try {
          await api(`/api/me/plans/${plan.id}/wedding-website`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          location.reload();
        } catch (err) {
          toast(err.message || 'Unable to create website draft right now.', 'warn');
        }
      };
      return;
    }
    root.innerHTML = `<div class='ww-actions ww-builder-actions ww-glass-card'><button class='cta' id='ww-save'>Save</button><button class='cta secondary' id='ww-pub'>${site.status === 'published' ? 'Unpublish' : 'Publish'}</button><a class='cta secondary' target='_blank' href='/wedding/${site.slug}'>Preview</a></div>
    <form id='ww-builder' class='ww-builder'><details open><summary>Essentials</summary><label>Couple names<input name='coupleNames' value='${esc(site.coupleNames || '')}'></label><label>Welcome<textarea name='welcomeMessage'>${esc(site.welcomeMessage || '')}</textarea></label></details>
    <details><summary>Travel & Accommodation</summary><div id='rep-acc'></div><div id='rep-taxi'></div><div id='rep-local'></div></details>
    <details><summary>Wedding Party</summary><div id='rep-party'></div></details>
    <details><summary>FAQs & RSVP settings</summary><div id='rep-faq'></div><div id='rep-meal'></div><div id='rep-questions'></div><label class='ww-checkbox-row'><input class='ww-toggle' type='checkbox' name='rsvpEnabled' ${site.rsvpEnabled === false ? '' : 'checked'}><span>RSVP Enabled</span></label><label>RSVP deadline<input type='date' name='rsvpDeadline' value='${esc((site.rsvpDeadline || '').slice(0, 10))}'></label><label>RSVP intro<textarea name='rsvpIntroText'>${esc(site.rsvpIntroText || '')}</textarea></label></details></form>
    <section class='ww-rsvp ww-module-block'></section><section class='ww-seating ww-module-block'></section>`;
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
      (site.mealOptions || []).map(v => ({ id: uid('meal'), value: v }))
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
      (site.customRsvpQuestions || []).map(q => ({
        id: q.id || uid('question'),
        label: q.label || '',
        type: q.type || 'text',
        required: String(!!q.required),
        optionsCsv: (q.options || []).join(', '),
      }))
    );
    root.querySelector('#ww-save').onclick = async () => {
      const payload = Object.fromEntries(new FormData(form).entries());
      payload.rsvpEnabled = !!form.querySelector('[name=rsvpEnabled]').checked;
      payload.accommodationRecommendations = acc;
      payload.taxiRecommendations = taxi;
      payload.localInfo = local;
      payload.weddingParty = party;
      payload.faq = faq;
      payload.mealOptions = meal.map(m => m.value).filter(Boolean);
      payload.customRsvpQuestions = questions
        .filter(q => q.label)
        .map(q => ({
          id: q.id || uid('question'),
          label: q.label,
          type: q.type || 'text',
          required: String(q.required).toLowerCase() === 'true',
          options: String(q.optionsCsv || '')
            .split(',')
            .map(x => x.trim())
            .filter(Boolean),
        }));
      await api(`/api/me/plans/${plan.id}/wedding-website`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      toast('Saved successfully');
    };
    root.querySelector('#ww-pub').onclick = async () => {
      const statusEl =
        root.querySelector('.ww-status-msg') ||
        (() => {
          const el = document.createElement('div');
          el.className = 'ww-status-msg';
          root.querySelector('.ww-actions').after(el);
          return el;
        })();
      statusEl.textContent = '';
      try {
        await api(
          `/api/me/plans/${plan.id}/wedding-website/${site.status === 'published' ? 'unpublish' : 'publish'}`,
          { method: 'POST' }
        );
        toast(site.status === 'published' ? 'Website unpublished' : 'Website published');
        location.reload();
      } catch (err) {
        const missing = err?.payload?.checklist?.missing;
        if (Array.isArray(missing) && missing.length) {
          statusEl.innerHTML = `<strong>Before publishing, please complete:</strong> <ul>${missing
            .map(item => `<li>${esc(item)}</li>`)
            .join('')}</ul>`;
        } else {
          statusEl.textContent = err.message || 'Unable to publish right now.';
        }
      }
    };
    await renderGuests(plan.id, root);
    await renderSeating(plan.id, root);
  }

  async function initWeddingWebsiteDashboard(plans) {
    const root = document.getElementById('wedding-website-dashboard-root');
    if (!root) {
      return;
    }
    const weddingPlans = (plans || []).filter(isWeddingPlan);
    if (!weddingPlans.length) {
      root.innerHTML = `<section class="ww-choice-panel">
        <h3>Wedding Website & RSVPs</h3>
        <p>Create a beautiful guest website, collect RSVPs, manage your guest list and organise seating — with or without building a full EventFlow plan.</p>
        <div class="ww-choice-grid">
          <article class="ww-choice-card ww-glass-card ww-choice-card--primary"><span class='ww-choice-card__icon' aria-hidden='true'>✨</span><h4>Start with a free wedding website</h4><p>Best if you want to quickly create a guest website, RSVP form, guest list and seating plan.</p><button class="cta" id="ww-quick-start">Create Wedding Website</button></article>
          <article class="ww-choice-card ww-glass-card"><span class='ww-choice-card__icon' aria-hidden='true'>🧭</span><h4>Build a full EventFlow plan</h4><p>Best if you also want to manage budget, suppliers, packages and planning tasks.</p><a class="cta secondary" href="/start">Create Full Event Plan</a></article>
          ${(plans || []).length ? `<article class="ww-choice-card ww-glass-card"><span class='ww-choice-card__icon' aria-hidden='true'>🔗</span><h4>Use an existing plan</h4><p>If a wedding/event plan exists, select it and attach the wedding website.</p><select id="ww-existing-plan"><option value="">Select plan</option>${(plans || []).map(p => `<option value="${esc(p.id)}">${esc(p.name || p.eventName || 'Untitled plan')}</option>`).join('')}</select><button class="cta secondary" id="ww-use-existing">Use Existing Plan</button></article>` : ''}
        </div></section>`;
      root.querySelector('#ww-quick-start').onclick = async () => {
        try {
          const res = await api('/api/me/plans/wedding-workspace', { method: 'POST' });
          const p = res.plan;
          const siteRes = await api(
            `/api/me/plans/${encodeURIComponent(p.id)}/wedding-website`
          ).catch(() => ({ website: null }));
          await renderModule(p, siteRes.website, root);
        } catch (err) {
          toast(err?.message || 'Unable to create wedding website right now.', 'warn');
        }
      };
      root.querySelector('#ww-use-existing') &&
        (root.querySelector('#ww-use-existing').onclick = async () => {
          const selected = root.querySelector('#ww-existing-plan').value;
          if (!selected) {
            return toast('Choose a plan first', 'warn');
          }
          const chosen = (plans || []).find(p => p.id === selected);
          const data = await api(
            `/api/me/plans/${encodeURIComponent(chosen.id)}/wedding-website`
          ).catch(() => ({ website: null }));
          await renderModule(chosen, data.website, root);
        });
      return;
    }
    const plan = weddingPlans[0];
    const data = await api(`/api/me/plans/${encodeURIComponent(plan.id)}/wedding-website`).catch(
      () => ({ website: null })
    );
    await renderModule(plan, data.website, root);
  }
  window.initWeddingWebsiteDashboard = initWeddingWebsiteDashboard;
})();
