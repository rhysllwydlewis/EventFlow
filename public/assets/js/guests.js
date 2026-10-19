'use strict';
/**
 * Guest list manager (/guests).
 *
 * One module for the whole page: pure helpers first (counting, filtering, sorting, CSV), then the
 * app that renders from them. State lives in `state`; every view is drawn from it, so nothing
 * here depends on other scripts patching the DOM. Styles: /assets/css/guests.css (all scoped
 * under `.gm`).
 *
 * Data: GET/POST/PATCH/DELETE /api/me/plans/:planId/guests. This is the same `guestList` the
 * Wedding Website & RSVPs app reads, so the guest records are used as the server returns them
 * (name, email, phone, rsvpStatus, partySize, dietaryRequirements, tableName, notes).
 *
 * Exports (for unit tests): the pure helpers and `createGuestApp(root)`. In the browser the
 * app starts itself on DOMContentLoaded.
 */
(function () {
  const STATUSES = ['pending', 'attending', 'maybe', 'declined'];
  const STATUS_LABELS = {
    pending: 'Awaiting',
    attending: 'Attending',
    maybe: 'Maybe',
    declined: 'Declined',
  };
  const SORTS = [
    ['name', 'Name A–Z'],
    ['recent', 'Recently added'],
    ['status', 'Reply status'],
  ];
  const PAGE_SIZE = 25;
  // The write limiter allows 80 writes per 10 minutes, and a CSV import is one write per guest.
  const MAX_IMPORT = 50;
  const MAX_PARTY = 20;

  /* ------------------------------------------------------------------ *
   * Pure helpers
   * ------------------------------------------------------------------ */

  /** Escapes a value for safe use in HTML text and attribute values. */
  function esc(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
    );
  }

  /** "1 guest" / "3 guests". */
  function plural(count, one, many) {
    return `${count} ${count === 1 ? one : many || `${one}s`}`;
  }

  function clampParty(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.max(1, Math.min(MAX_PARTY, n)) : 1;
  }

  /** A server guest record in the shape the UI reads. Tolerates legacy field names. */
  function normalizeGuest(g) {
    const status = String(g?.rsvpStatus || 'pending').toLowerCase();
    return {
      id: String(g?.id ?? ''),
      name: String(g?.name || '').trim(),
      email: String(g?.email || ''),
      phone: String(g?.phone || ''),
      status: STATUSES.includes(status) ? status : 'pending',
      partySize: clampParty(g?.partySize || 1),
      dietary: String(g?.dietaryRequirements || g?.dietary || ''),
      table: String(g?.tableName || g?.table || ''),
      seated: Boolean(g?.tableId),
      notes: String(g?.notes || ''),
      source: String(g?.source || ''),
      createdAt: String(g?.createdAt || ''),
      updatedAt: String(g?.updatedAt || ''),
    };
  }

  /** Counts for the summary: guest records per reply, people attending, dietary needs. */
  function summarise(guests) {
    const out = {
      total: guests.length,
      attending: 0,
      pending: 0,
      maybe: 0,
      declined: 0,
      attendingPeople: 0,
      totalPeople: 0,
      replied: 0,
      dietary: [],
    };
    const dietary = new Map();
    guests.forEach(g => {
      out[g.status] += 1;
      out.totalPeople += g.partySize;
      if (g.status !== 'pending') {
        out.replied += 1;
      }
      if (g.status === 'attending') {
        out.attendingPeople += g.partySize;
        g.dietary
          .split(',')
          .map(part => part.trim())
          .filter(Boolean)
          .forEach(label => {
            const key = label.toLowerCase();
            const entry = dietary.get(key) || { label, count: 0 };
            entry.count += 1;
            dietary.set(key, entry);
          });
      }
    });
    out.dietary = [...dietary.values()].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label)
    );
    return out;
  }

  /** Guests matching a search term (name, email, phone, table, dietary) and a reply status. */
  function filterGuests(guests, { query = '', status = '' } = {}) {
    const q = String(query).trim().toLowerCase();
    return guests.filter(g => {
      if (status && g.status !== status) {
        return false;
      }
      if (!q) {
        return true;
      }
      return [g.name, g.email, g.phone, g.table, g.dietary].some(value =>
        value.toLowerCase().includes(q)
      );
    });
  }

  /** "Jane Q Smith" sorts as "smith jane q". */
  function surnameKey(name) {
    const parts = String(name).trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      return parts.join('');
    }
    return `${parts[parts.length - 1]} ${parts.slice(0, -1).join(' ')}`;
  }

  /** A sorted copy: by surname, newest first, or by reply (attending, maybe, awaiting, declined). */
  function sortGuests(guests, key = 'name') {
    const order = { attending: 0, maybe: 1, pending: 2, declined: 3 };
    const byName = (a, b) => surnameKey(a.name).localeCompare(surnameKey(b.name));
    const list = [...guests];
    if (key === 'recent') {
      return list.sort(
        (a, b) =>
          String(b.createdAt || b.updatedAt).localeCompare(String(a.createdAt || a.updatedAt)) ||
          byName(a, b)
      );
    }
    if (key === 'status') {
      return list.sort((a, b) => order[a.status] - order[b.status] || byName(a, b));
    }
    return list.sort(byName);
  }

  /** One CSV cell. Cells that a spreadsheet would run as a formula get a leading apostrophe. */
  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) {
      text = `'${text}`;
    }
    return `"${text.replace(/"/g, '""')}"`;
  }

  const CSV_HEADERS = ['Name', 'Email', 'Phone', 'RSVP', 'Party size', 'Dietary', 'Table', 'Notes'];

  /** CSV text for a list of normalised guests. */
  function buildCsv(guests) {
    const rows = guests.map(g => [
      g.name,
      g.email,
      g.phone,
      STATUS_LABELS[g.status],
      g.partySize,
      g.dietary,
      g.table,
      g.notes,
    ]);
    return [CSV_HEADERS, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  }

  /** RFC 4180 parser: quoted cells, doubled quotes, commas and line breaks inside quotes. */
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const src = String(text).replace(/^\uFEFF/, '');
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"' && src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') {
          i += 1;
        }
        row.push(cell);
        cell = '';
        rows.push(row);
        row = [];
      } else {
        cell += ch;
      }
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter(r => r.some(c => c.trim() !== ''));
  }

  /** Reverses the apostrophe guard that csvCell adds. */
  const unguardCell = value => String(value).replace(/^'(?=[=+\-@\t\r])/, '');

  const STATUS_WORDS = {
    attending: 'attending',
    accepted: 'attending',
    yes: 'attending',
    confirmed: 'attending',
    declined: 'declined',
    no: 'declined',
    maybe: 'maybe',
    awaiting: 'pending',
    pending: 'pending',
  };

  const COLUMN_ALIASES = {
    name: ['name', 'fullname', 'guest', 'guestname'],
    firstName: ['firstname', 'first', 'givenname'],
    lastName: ['lastname', 'last', 'surname', 'familyname'],
    email: ['email', 'emailaddress'],
    phone: ['phone', 'phonenumber', 'mobile', 'telephone'],
    status: ['rsvp', 'rsvpstatus', 'status', 'reply'],
    partySize: ['partysize', 'party', 'numberofguests'],
    plusOne: ['plusone', 'plus1'],
    dietary: ['dietary', 'dietaryrequirements', 'diet'],
    table: ['table', 'tablename', 'tableassignment'],
    notes: ['notes', 'note', 'comments'],
  };

  /**
   * Turns parsed CSV rows into guest payloads. Columns are matched by header name, so both this
   * page's export and the older FirstName/LastName/PlusOne layout import. Rows without a name are
   * reported in `skipped` (with their line number) instead of being dropped silently.
   */
  function guestsFromCsv(rows) {
    if (!rows.length) {
      return { guests: [], skipped: [], error: 'The file is empty.' };
    }
    const headers = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const col = {};
    Object.entries(COLUMN_ALIASES).forEach(([key, names]) => {
      const index = headers.findIndex(h => names.includes(h));
      if (index >= 0) {
        col[key] = index;
      }
    });
    if (col.name === undefined && col.firstName === undefined) {
      return {
        guests: [],
        skipped: [],
        error: 'Add a Name column (or FirstName and LastName) to the first row.',
      };
    }
    const guests = [];
    const skipped = [];
    rows.slice(1).forEach((row, i) => {
      const get = key => (col[key] === undefined ? '' : unguardCell((row[col[key]] || '').trim()));
      const name =
        col.name !== undefined ? get('name') : [get('firstName'), get('lastName')].join(' ').trim();
      if (!name) {
        skipped.push({ line: i + 2, reason: 'No name' });
        return;
      }
      const word = get('status').toLowerCase();
      let partySize = get('partySize') ? clampParty(get('partySize')) : 1;
      if (!get('partySize') && /^(yes|y|true|1)$/i.test(get('plusOne'))) {
        partySize = 2;
      }
      guests.push({
        name,
        email: get('email'),
        phone: get('phone'),
        rsvpStatus: STATUS_WORDS[word] || 'pending',
        partySize,
        dietary: get('dietary'),
        table: get('table'),
        notes: get('notes'),
      });
    });
    return { guests, skipped, error: '' };
  }

  /** The request body for a guest created from the form or a CSV row. Empty fields are null. */
  function toPayload(values, { includeTable = true } = {}) {
    const text = v => String(v ?? '').trim() || null;
    const payload = {
      name: String(values.name || '').trim(),
      email: text(values.email),
      phone: text(values.phone),
      rsvpStatus: STATUSES.includes(values.rsvpStatus) ? values.rsvpStatus : 'pending',
      partySize: clampParty(values.partySize),
      dietary: text(values.dietary),
      notes: text(values.notes),
    };
    if (includeTable) {
      payload.table = text(values.table);
    }
    return payload;
  }

  /** True for plans that are weddings or already have a wedding website. */
  function isWeddingPlan(plan) {
    const type = String(plan?.eventType || '').toLowerCase();
    const name = String(plan?.name || plan?.eventName || '').toLowerCase();
    return Boolean(plan?.weddingWebsite) || type === 'wedding' || name.includes('wedding');
  }

  function formatDate(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const planTitle = plan => plan?.name || plan?.eventName || plan?.eventType || 'Your plan';

  /* ------------------------------------------------------------------ *
   * Icons
   * ------------------------------------------------------------------ */

  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    users:
      '<path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="8" r="3.5"/><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.36M15.5 4.64a3.5 3.5 0 0 1 0 6.72"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    heart:
      '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  };

  function icon(name, size = 16) {
    return `<svg class="gm-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
  }

  /* ------------------------------------------------------------------ *
   * The app
   * ------------------------------------------------------------------ */

  function createGuestApp(root) {
    const $ = selector => root.querySelector(selector);
    const state = {
      phase: 'loading', // loading | ready | error | signin | noplans
      error: '',
      plans: [],
      plan: null,
      guests: [],
      query: '',
      status: '',
      sort: 'name',
      page: 1,
    };
    const stage = $('#gm-stage');
    const toasts = $('#gm-toasts');

    /* ---- network ---- */

    async function csrfToken() {
      if (window.__CSRF_TOKEN__) {
        return window.__CSRF_TOKEN__;
      }
      try {
        const res = await fetch('/api/csrf-token', { credentials: 'same-origin' });
        if (res.ok) {
          const data = await res.json();
          const token = data.csrfToken || data.token || '';
          if (token) {
            window.__CSRF_TOKEN__ = token;
          }
          return token;
        }
      } catch (_) {
        /* fall through to the cookie */
      }
      const match = document.cookie.match(/(?:^|;\s*)(?:csrf|csrfToken)=([^;]+)/);
      return match ? decodeURIComponent(match[1]) : '';
    }

    /** fetch wrapper: JSON in and out, throws an Error carrying the server message and status. */
    async function api(path, { method = 'GET', body } = {}) {
      const headers = {};
      if (method !== 'GET') {
        headers['Content-Type'] = 'application/json';
        headers['X-CSRF-Token'] = await csrfToken();
      }
      const res = await fetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(
          json.error || json.message || 'Something went wrong. Please try again.'
        );
        err.status = res.status;
        throw err;
      }
      return json;
    }

    const guestsPath = suffix =>
      `/api/me/plans/${encodeURIComponent(state.plan.id)}/guests${suffix}`;

    /* ---- small UI helpers ---- */

    function toast(message, type = 'ok') {
      const el = document.createElement('div');
      el.className = `gm-toast gm-toast--${type}`;
      if (type === 'warn') {
        el.setAttribute('role', 'alert');
      }
      el.innerHTML = `${icon(type === 'warn' ? 'info' : 'check')}<span>${esc(message)}</span>`;
      toasts.querySelectorAll('.gm-toast').forEach(old => old.remove());
      toasts.appendChild(el);
      window.setTimeout(() => el.remove(), 4000);
    }

    function setBusy(button, busy) {
      if (button) {
        button.disabled = Boolean(busy);
        button.setAttribute('aria-busy', String(Boolean(busy)));
      }
    }

    function focusList(selector) {
      const target = (selector && $(selector)) || $('#gm-list-title');
      target?.focus({ preventScroll: false });
    }

    /** Appends a dialog inside the page root (so the page styles apply) and shows it modally. */
    function openDialog(dialog, { opener, returnSelector } = {}) {
      root.appendChild(dialog);
      dialog.addEventListener('close', () => {
        dialog.remove();
        if (opener?.isConnected) {
          opener.focus();
        } else {
          focusList(returnSelector);
        }
      });
      dialog.addEventListener('click', event => {
        if (event.target.closest('[data-dialog-close]')) {
          dialog.close();
        }
      });
      try {
        dialog.showModal();
      } catch (_) {
        dialog.setAttribute('open', '');
      }
    }

    /* ---- plans and guests ---- */

    async function load() {
      state.phase = 'loading';
      renderStage();
      try {
        if (!state.plans.length) {
          const data = await api('/api/me/plans');
          state.plans = data.plans || [];
          if (!state.plans.length) {
            state.phase = 'noplans';
            renderChrome();
            renderStage();
            return;
          }
          const wanted = new URLSearchParams(window.location.search).get('plan');
          state.plan = state.plans.find(p => p.id === wanted) || state.plans[0];
        }
        const data = await api(guestsPath(''));
        state.guests = (data.guests || []).map(normalizeGuest);
        state.phase = 'ready';
      } catch (err) {
        state.phase = err.status === 401 || err.status === 403 ? 'signin' : 'error';
        state.error =
          state.phase === 'error' ? err.message || 'Something went wrong. Please try again.' : '';
      }
      renderChrome();
      renderStage();
    }

    /* ---- rendering: page chrome ---- */

    function renderChrome() {
      const ready = state.phase === 'ready';
      root.querySelectorAll('[data-needs-plan]').forEach(el => {
        el.hidden = !ready;
      });
      const sub = $('#gm-sub');
      const date = formatDate(state.plan?.eventDate || state.plan?.date);
      sub.textContent = state.plan
        ? [planTitle(state.plan), date].filter(Boolean).join(' · ')
        : 'Track replies and keep everyone in one place.';
      const picker = $('#gm-plan-picker');
      picker.hidden = state.plans.length < 2;
      if (state.plans.length > 1) {
        picker.querySelector('select').innerHTML = state.plans
          .map(
            p =>
              `<option value="${esc(p.id)}" ${p.id === state.plan?.id ? 'selected' : ''}>${esc(planTitle(p))}</option>`
          )
          .join('');
      }
    }

    function emptyState({ iconName, title, body, actions = '' }) {
      return `<div class="gm-empty"><span class="gm-empty__icon">${icon(iconName, 24)}</span><h2 class="gm-empty__title">${esc(title)}</h2><p class="gm-empty__body">${body}</p>${actions ? `<div class="gm-empty__actions">${actions}</div>` : ''}</div>`;
    }

    function renderStage() {
      stage.removeAttribute('aria-busy');
      if (state.phase === 'ready') {
        if (!$('#gm-results')) {
          stage.innerHTML = readyShell();
        }
        renderSummary();
        renderResults();
        return;
      }
      if (state.phase === 'loading') {
        stage.setAttribute('aria-busy', 'true');
        stage.innerHTML =
          '<div class="gm-skeleton" aria-hidden="true"><i></i><i></i><i></i><i></i></div><span class="gm-sr" role="status">Loading your guest list</span>';
        return;
      }
      const views = {
        error: emptyState({
          iconName: 'info',
          title: 'We could not load your guests',
          body: esc(state.error),
          actions:
            '<button type="button" class="gm-btn gm-btn--primary" data-action="retry">Try again</button>',
        }),
        signin: emptyState({
          iconName: 'users',
          title: 'Sign in to manage your guests',
          body: 'Your guest list is private to your account.',
          actions: '<a class="gm-btn gm-btn--primary" href="/auth">Sign in</a>',
        }),
        noplans: emptyState({
          iconName: 'users',
          title: 'Start a plan first',
          body: 'Guest lists belong to an event plan. Create one and your guests will live here.',
          actions: '<a class="gm-btn gm-btn--primary" href="/start">Create a plan</a>',
        }),
      };
      stage.innerHTML = `<div class="gm-panel">${views[state.phase] || ''}</div>`;
    }

    function readyShell() {
      const filterOptions = [['', 'All replies'], ...STATUSES.map(s => [s, STATUS_LABELS[s]])]
        .map(
          ([v, l]) => `<option value="${v}" ${v === state.status ? 'selected' : ''}>${l}</option>`
        )
        .join('');
      const sortOptions = SORTS.map(
        ([v, l]) => `<option value="${v}" ${v === state.sort ? 'selected' : ''}>${l}</option>`
      ).join('');
      return `<section class="gm-summary" id="gm-summary" aria-label="Guest summary"></section>
        <div id="gm-note"></div>
        <section class="gm-panel" aria-labelledby="gm-list-title">
          <h2 class="gm-sr" id="gm-list-title" tabindex="-1">Guests</h2>
          <div class="gm-toolbar" role="search">
            <label class="gm-search">${icon('search')}<input type="search" id="gm-search" class="gm-input" placeholder="Search guests" aria-label="Search guests" autocomplete="off" value="${esc(state.query)}"></label>
            <select id="gm-filter" class="gm-input gm-select" aria-label="Filter by reply">${filterOptions}</select>
            <select id="gm-sort" class="gm-input gm-select" aria-label="Sort guests">${sortOptions}</select>
          </div>
          <div id="gm-results"></div>
        </section>`;
    }

    function renderSummary() {
      const s = summarise(state.guests);
      const host = $('#gm-summary');
      if (!s.total) {
        host.hidden = true;
      } else {
        host.hidden = false;
        const stat = (label, value, note) =>
          `<li class="gm-stat"><span class="gm-stat__label">${label}</span><strong class="gm-stat__value">${value}</strong><span class="gm-stat__note">${note}</span></li>`;
        const bar = ['attending', 'maybe', 'declined', 'pending']
          .filter(k => s[k])
          .map(
            k =>
              `<i class="gm-bar__seg gm-bar__seg--${k}" style="width:${(s[k] / s.total) * 100}%"></i>`
          )
          .join('');
        const summaryLabel = `${s.attending} attending, ${s.maybe} maybe, ${s.declined} declined, ${s.pending} awaiting a reply`;
        const dietary = s.dietary.length
          ? `<div class="gm-dietary"><span class="gm-dietary__label">Dietary needs (attending)</span><ul class="gm-tags">${s.dietary
              .map(d => `<li class="gm-tag">${esc(d.label)} <b>${d.count}</b></li>`)
              .join('')}</ul></div>`
          : '';
        host.innerHTML = `<ul class="gm-stats">
            ${stat('Guests', s.total, `${plural(s.totalPeople, 'person', 'people')} invited`)}
            ${stat('Attending', s.attending, `${plural(s.attendingPeople, 'person', 'people')}`)}
            ${stat('Awaiting reply', s.pending, s.maybe ? `${s.maybe} maybe` : 'No maybes')}
            ${stat('Declined', s.declined, s.declined ? 'Not coming' : 'None so far')}
          </ul>
          <div class="gm-progress"><div class="gm-bar" role="img" aria-label="${esc(summaryLabel)}">${bar}</div><p class="gm-progress__text">${s.replied} of ${s.total} have replied</p></div>
          ${dietary}`;
      }
      const note = $('#gm-note');
      note.innerHTML = isWeddingPlan(state.plan)
        ? `<p class="gm-note">${icon('heart')}<span>This is the same guest list your Wedding Website &amp; RSVPs uses. Replies from your website appear here; seating is arranged there. <a href="/dashboard/customer">Open Wedding Website &amp; RSVPs</a></span></p>`
        : '';
    }

    function visibleGuests() {
      return sortGuests(
        filterGuests(state.guests, { query: state.query, status: state.status }),
        state.sort
      );
    }

    function badge(status) {
      return `<span class="gm-badge gm-badge--${esc(status)}">${esc(STATUS_LABELS[status])}</span>`;
    }

    function rowHtml(g) {
      const contact = [g.email, g.phone].filter(Boolean);
      const sub = [...contact, g.source === 'public_rsvp' ? 'Replied via your website' : '']
        .filter(Boolean)
        .map(line => `<span>${esc(line)}</span>`)
        .join('');
      const dash = '<span class="gm-muted">—</span>';
      return `<tr data-id="${esc(g.id)}">
        <td class="gm-cell-guest" data-label="Guest"><strong class="gm-name">${esc(g.name)}</strong>${sub ? `<span class="gm-sub-lines">${sub}</span>` : ''}</td>
        <td data-label="Reply">${badge(g.status)}</td>
        <td data-label="Party">${g.partySize}</td>
        <td data-label="Dietary"${g.dietary ? '' : ' class="gm-is-empty"'}>${g.dietary ? esc(g.dietary) : dash}</td>
        <td data-label="Table"${g.table ? '' : ' class="gm-is-empty"'}>${g.table ? esc(g.table) : dash}</td>
        <td class="gm-cell-actions"><button type="button" class="gm-btn gm-btn--ghost gm-btn--sm" data-action="edit" data-id="${esc(g.id)}" aria-label="Edit ${esc(g.name)}">Edit</button><button type="button" class="gm-btn gm-btn--ghost gm-btn--sm gm-btn--danger" data-action="delete" data-id="${esc(g.id)}" aria-label="Delete ${esc(g.name)}">Delete</button></td>
      </tr>`;
    }

    function renderResults() {
      const host = $('#gm-results');
      if (!host) {
        return;
      }
      $('.gm-toolbar').hidden = !state.guests.length;
      if (!state.guests.length) {
        host.innerHTML = emptyState({
          iconName: 'users',
          title: 'No guests yet',
          body: 'Add guests one at a time, or import a CSV from a spreadsheet you already have.',
          actions: `<button type="button" class="gm-btn gm-btn--primary" data-action="add">${icon('plus')}Add your first guest</button><button type="button" class="gm-btn gm-btn--secondary" data-action="import">${icon('upload')}Import CSV</button>`,
        });
        return;
      }
      const list = visibleGuests();
      if (!list.length) {
        host.innerHTML = emptyState({
          iconName: 'search',
          title: 'No guests match',
          body: 'Try a different search or reply filter.',
          actions:
            '<button type="button" class="gm-btn gm-btn--secondary" data-action="clear">Clear filters</button>',
        });
        return;
      }
      const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      state.page = Math.min(Math.max(1, state.page), pages);
      const shown = list.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
      const count =
        list.length === state.guests.length
          ? plural(list.length, 'guest')
          : `${list.length} of ${state.guests.length} guests`;
      host.innerHTML = `<div class="gm-table-wrap"><table class="gm-table">
          <thead><tr><th scope="col">Guest</th><th scope="col">Reply</th><th scope="col">Party</th><th scope="col">Dietary</th><th scope="col">Table</th><th scope="col"><span class="gm-sr">Actions</span></th></tr></thead>
          <tbody>${shown.map(rowHtml).join('')}</tbody></table></div>
        <div class="gm-pager"><span role="status">${count}</span>${
          pages > 1
            ? `<div class="gm-pager__nav"><button type="button" class="gm-btn gm-btn--ghost gm-btn--sm" data-action="page" data-dir="-1" ${state.page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${state.page} of ${pages}</span><button type="button" class="gm-btn gm-btn--ghost gm-btn--sm" data-action="page" data-dir="1" ${state.page >= pages ? 'disabled' : ''}>Next</button></div>`
            : ''
        }</div>`;
    }

    /* ---- add / edit ---- */

    function guestDialog(guest, opener) {
      const g = guest || {
        name: '',
        email: '',
        phone: '',
        status: 'pending',
        partySize: 1,
        dietary: '',
        table: '',
        seated: false,
        notes: '',
      };
      const field = (name, label, control, wide = false, hint = '') =>
        `<div class="gm-field${wide ? ' gm-field--wide' : ''}"><label class="gm-label" for="gm-f-${name}">${label}</label>${control}${hint ? `<small class="gm-hint" id="gm-h-${name}">${hint}</small>` : ''}</div>`;
      const input = (name, type, value, extra = '') =>
        `<input class="gm-input" id="gm-f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}>`;
      const dialog = document.createElement('dialog');
      dialog.className = 'gm-dialog';
      dialog.setAttribute('aria-labelledby', 'gm-dialog-title');
      dialog.innerHTML = `<form class="gm-form" novalidate>
        <div class="gm-dialog__head"><h2 class="gm-dialog__title" id="gm-dialog-title">${guest ? 'Edit guest' : 'Add guest'}</h2><button type="button" class="gm-icon-btn" data-dialog-close aria-label="Close">${icon('close', 20)}</button></div>
        <div class="gm-dialog__body">
          <div class="gm-grid">
            ${field('name', 'Name <span class="gm-req">Required</span>', `${input('name', 'text', g.name, 'required maxlength="200" autocomplete="off" aria-describedby="gm-name-error"')}<small class="gm-error" id="gm-name-error" hidden>Enter the guest’s name.</small>`, true)}
            ${field('rsvpStatus', 'Reply', `<select class="gm-input gm-select" id="gm-f-rsvpStatus" name="rsvpStatus">${STATUSES.map(s => `<option value="${s}" ${g.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select>`)}
            ${field('partySize', 'Party size', input('partySize', 'number', g.partySize, `min="1" max="${MAX_PARTY}" inputmode="numeric" aria-describedby="gm-h-partySize"`), false, 'People in this booking, including the guest.')}
            ${field('email', 'Email', input('email', 'email', g.email, 'maxlength="200" autocomplete="off"'))}
            ${field('phone', 'Phone', input('phone', 'tel', g.phone, 'maxlength="30" autocomplete="off"'))}
            ${field('dietary', 'Dietary needs', input('dietary', 'text', g.dietary, 'maxlength="500" placeholder="e.g. Vegetarian, nut allergy"'))}
            ${field('table', 'Table', input('table', 'text', g.table, `maxlength="100" ${g.seated ? 'disabled aria-describedby="gm-h-table"' : ''}`), false, g.seated ? 'Seated in your seating plan. Change it there.' : '')}
            ${field('notes', 'Notes', `<textarea class="gm-input" id="gm-f-notes" name="notes" rows="2" maxlength="200">${esc(g.notes)}</textarea>`, true)}
          </div>
          <p class="gm-error gm-form-error" role="alert" hidden></p>
          <p class="gm-form-status" role="status"></p>
        </div>
        <div class="gm-dialog__foot">
          <button type="button" class="gm-btn gm-btn--ghost" data-dialog-close>Cancel</button>
          ${guest ? '' : '<button type="submit" class="gm-btn gm-btn--secondary" value="another">Save and add another</button>'}
          <button type="submit" class="gm-btn gm-btn--primary" value="done">${guest ? 'Save changes' : 'Add guest'}</button>
        </div>
      </form>`;
      const form = dialog.querySelector('form');
      const nameInput = form.elements.name;
      const nameError = form.querySelector('#gm-name-error');
      const formError = form.querySelector('.gm-form-error');
      nameInput.addEventListener('input', () => {
        nameError.hidden = true;
        nameInput.removeAttribute('aria-invalid');
      });
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const again = event.submitter?.value === 'another';
        const values = Object.fromEntries(new FormData(form).entries());
        if (!String(values.name || '').trim()) {
          nameError.hidden = false;
          nameInput.setAttribute('aria-invalid', 'true');
          nameInput.focus();
          return;
        }
        formError.hidden = true;
        const buttons = [...form.querySelectorAll('[type="submit"]')];
        buttons.forEach(b => setBusy(b, true));
        try {
          const payload = toPayload(values, { includeTable: !g.seated });
          if (guest) {
            const res = await api(guestsPath(`/${encodeURIComponent(guest.id)}`), {
              method: 'PATCH',
              body: payload,
            });
            const i = state.guests.findIndex(x => x.id === guest.id);
            if (i >= 0) {
              state.guests[i] = normalizeGuest(res.guest);
            }
            toast('Guest updated');
          } else {
            const res = await api(guestsPath(''), { method: 'POST', body: payload });
            state.guests.push(normalizeGuest(res.guest));
            toast(`${payload.name} added`);
          }
          renderSummary();
          renderResults();
          if (again) {
            form.reset();
            form.querySelector('.gm-form-status').textContent =
              `${payload.name} added. Add the next guest.`;
            buttons.forEach(b => setBusy(b, false));
            nameInput.focus();
            return;
          }
          dialog.close();
        } catch (err) {
          buttons.forEach(b => setBusy(b, false));
          formError.textContent = err.message;
          formError.hidden = false;
        }
      });
      openDialog(dialog, {
        opener,
        returnSelector: guest
          ? `[data-action="edit"][data-id="${guest.id.replace(/["\\]/g, '\\$&')}"]`
          : '',
      });
      nameInput.focus();
    }

    /* ---- delete ---- */

    function confirmDelete(guest, opener) {
      const dialog = document.createElement('dialog');
      dialog.className = 'gm-dialog gm-dialog--narrow';
      dialog.setAttribute('aria-labelledby', 'gm-confirm-title');
      dialog.setAttribute('aria-describedby', 'gm-confirm-text');
      dialog.innerHTML = `<div class="gm-dialog__body"><h2 class="gm-dialog__title" id="gm-confirm-title">Remove ${esc(guest.name)}?</h2><p class="gm-dialog__text" id="gm-confirm-text">They will be taken off your guest list${guest.seated ? ' and their seat in the seating plan' : ''}. This can’t be undone.</p><p class="gm-error gm-form-error" role="alert" hidden></p></div>
        <div class="gm-dialog__foot"><button type="button" class="gm-btn gm-btn--ghost" data-dialog-close>Cancel</button><button type="button" class="gm-btn gm-btn--danger-solid" data-confirm>Remove guest</button></div>`;
      const confirm = dialog.querySelector('[data-confirm]');
      const error = dialog.querySelector('.gm-form-error');
      confirm.addEventListener('click', async () => {
        setBusy(confirm, true);
        error.hidden = true;
        try {
          await api(guestsPath(`/${encodeURIComponent(guest.id)}`), { method: 'DELETE' });
          state.guests = state.guests.filter(x => x.id !== guest.id);
          toast(`${guest.name} removed`);
          renderSummary();
          renderResults();
          dialog.close();
        } catch (err) {
          setBusy(confirm, false);
          error.textContent = err.message;
          error.hidden = false;
        }
      });
      openDialog(dialog, { opener });
      dialog.querySelector('[data-dialog-close].gm-btn').focus();
    }

    /* ---- CSV import / export ---- */

    function download(filename, text) {
      const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    function exportGuests() {
      if (!state.guests.length) {
        toast('There are no guests to export yet', 'warn');
        return;
      }
      download(
        `eventflow-guests-${new Date().toISOString().slice(0, 10)}.csv`,
        buildCsv(state.guests)
      );
      toast('Guest list exported');
    }

    function importDialog(opener) {
      const dialog = document.createElement('dialog');
      dialog.className = 'gm-dialog';
      dialog.setAttribute('aria-labelledby', 'gm-dialog-title');
      dialog.innerHTML = `<form class="gm-form" novalidate>
        <div class="gm-dialog__head"><h2 class="gm-dialog__title" id="gm-dialog-title">Import guests from CSV</h2><button type="button" class="gm-icon-btn" data-dialog-close aria-label="Close">${icon('close', 20)}</button></div>
        <div class="gm-dialog__body">
          <p class="gm-dialog__text">Use a file with a header row. Name is required; Email, Phone, RSVP, Party size, Dietary, Table and Notes are optional. FirstName and LastName columns work too. Up to ${MAX_IMPORT} guests per import.</p>
          <p class="gm-dialog__text"><button type="button" class="gm-link" data-template>Download a template</button></p>
          <div class="gm-field gm-field--wide"><label class="gm-label" for="gm-csv">CSV file</label><input class="gm-input gm-file" id="gm-csv" type="file" accept=".csv,text/csv" aria-describedby="gm-import-status"></div>
          <p class="gm-import-status" id="gm-import-status" role="status"></p>
          <ul class="gm-import-skipped" hidden></ul>
        </div>
        <div class="gm-dialog__foot"><button type="button" class="gm-btn gm-btn--ghost" data-dialog-close>Cancel</button><button type="submit" class="gm-btn gm-btn--primary" disabled>Import guests</button></div>
      </form>`;
      const form = dialog.querySelector('form');
      const fileInput = form.querySelector('#gm-csv');
      const status = form.querySelector('#gm-import-status');
      const skippedList = form.querySelector('.gm-import-skipped');
      const submit = form.querySelector('[type="submit"]');
      let parsed = null;
      form
        .querySelector('[data-template]')
        .addEventListener('click', () =>
          download(
            'eventflow-guest-template.csv',
            [
              CSV_HEADERS,
              [
                'Jane Smith',
                'jane@example.com',
                '07700 900123',
                'Attending',
                2,
                'Vegetarian',
                'Table 1',
                '',
              ],
            ]
              .map(row => row.map(csvCell).join(','))
              .join('\r\n')
          )
        );
      fileInput.addEventListener('change', async () => {
        parsed = null;
        submit.disabled = true;
        skippedList.hidden = true;
        const file = fileInput.files[0];
        if (!file) {
          status.textContent = '';
          return;
        }
        const result = guestsFromCsv(parseCsv(await file.text()));
        if (result.error) {
          status.textContent = result.error;
          status.className = 'gm-import-status gm-error';
          return;
        }
        if (!result.guests.length) {
          status.textContent = 'No guests with a name were found in that file.';
          status.className = 'gm-import-status gm-error';
          return;
        }
        if (result.guests.length > MAX_IMPORT) {
          status.textContent = `That file has ${result.guests.length} guests. Import up to ${MAX_IMPORT} at a time.`;
          status.className = 'gm-import-status gm-error';
          return;
        }
        parsed = result;
        status.className = 'gm-import-status';
        status.textContent = `${plural(result.guests.length, 'guest')} ready to import${result.skipped.length ? `, ${plural(result.skipped.length, 'row')} without a name will be skipped` : ''}.`;
        submit.disabled = false;
      });
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!parsed) {
          return;
        }
        setBusy(submit, true);
        fileInput.disabled = true;
        let added = 0;
        const failed = [];
        for (const [i, row] of parsed.guests.entries()) {
          status.textContent = `Importing ${i + 1} of ${parsed.guests.length}…`;
          try {
            const res = await api(guestsPath(''), { method: 'POST', body: toPayload(row) });
            state.guests.push(normalizeGuest(res.guest));
            added += 1;
          } catch (err) {
            failed.push(`${row.name}: ${err.message}`);
            if (err.status === 429) {
              failed.push('Too many requests. Wait a few minutes and import the rest.');
              break;
            }
          }
        }
        renderSummary();
        renderResults();
        status.textContent = `Imported ${plural(added, 'guest')}${failed.length ? `. ${plural(failed.length, 'row')} could not be added:` : '.'}`;
        if (failed.length) {
          status.className = 'gm-import-status gm-error';
          skippedList.innerHTML = failed.map(line => `<li>${esc(line)}</li>`).join('');
          skippedList.hidden = false;
          submit.hidden = true;
        } else {
          toast(`Imported ${plural(added, 'guest')}`);
          dialog.close();
        }
      });
      openDialog(dialog, { opener });
      fileInput.focus();
    }

    /* ---- events ---- */

    const actions = {
      add: el => guestDialog(null, el),
      import: el => importDialog(el),
      export: () => exportGuests(),
      retry: () => load(),
      edit: el => {
        const guest = state.guests.find(g => g.id === el.dataset.id);
        if (guest) {
          guestDialog(guest, el);
        }
      },
      delete: el => {
        const guest = state.guests.find(g => g.id === el.dataset.id);
        if (guest) {
          confirmDelete(guest, el);
        }
      },
      clear: () => {
        state.query = '';
        state.status = '';
        state.page = 1;
        $('#gm-search').value = '';
        $('#gm-filter').value = '';
        renderResults();
        $('#gm-search').focus();
      },
      page: el => {
        state.page += Number(el.dataset.dir) || 0;
        renderResults();
        focusList();
      },
    };

    root.addEventListener('click', event => {
      const el = event.target.closest('[data-action]');
      if (el && root.contains(el) && actions[el.dataset.action]) {
        actions[el.dataset.action](el);
      }
    });
    root.addEventListener('input', event => {
      if (event.target.id === 'gm-search') {
        state.query = event.target.value;
        state.page = 1;
        renderResults();
      }
    });
    root.addEventListener('change', event => {
      const { id, value } = event.target;
      if (id === 'gm-filter') {
        state.status = value;
        state.page = 1;
        renderResults();
      } else if (id === 'gm-sort') {
        state.sort = value;
        state.page = 1;
        renderResults();
      } else if (id === 'gm-plan-select') {
        state.plan = state.plans.find(p => p.id === value) || state.plan;
        state.query = '';
        state.status = '';
        state.page = 1;
        stage.innerHTML = '';
        load();
      }
    });

    const ready = load();
    return { state, load, ready };
  }

  const exported = {
    esc,
    normalizeGuest,
    summarise,
    filterGuests,
    sortGuests,
    csvCell,
    buildCsv,
    parseCsv,
    guestsFromCsv,
    toPayload,
    isWeddingPlan,
    createGuestApp,
    MAX_IMPORT,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      const root = document.getElementById('gm-root');
      if (root) {
        createGuestApp(root);
      }
    });
  }
})();
