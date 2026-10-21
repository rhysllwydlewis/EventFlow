/**
 * Supplier dashboard: enquiries (quote requests and contact-form messages sent to this supplier).
 *
 * A card shows how many came in and the latest few; "Open enquiries" opens a drawer (a native
 * <dialog>: a side panel on desktop, a bottom sheet on a phone) with the full list, filters by
 * status and source, the detail of one enquiry, and Mark read / Mark handled / Mark new.
 *
 *   GET   /api/supplier/enquiries?days&page&limit&status&source
 *   GET   /api/supplier/enquiries/:id
 *   PATCH /api/supplier/enquiries/:id   { status: 'new' | 'read' | 'handled' }
 *
 * Only an approved supplier can read them (the server answers 403 SUPPLIER_NOT_APPROVED and 404 for
 * another supplier's record). Customer text arrives as plain text, so every piece of it is put on
 * the page with textContent, never as markup. Suppliers are not told when an enquiry arrives and
 * cannot reply here; the drawer says so and shows the customer's own contact details so the
 * supplier can answer directly.
 */
(function () {
  'use strict';

  const DAYS = 90;
  const PAGE_SIZE = 20;
  const CARD_ROWS = 3;

  const ids = {
    card: 'sdh-enquiries',
    body: 'sdh-enquiries-body',
    open: 'sdh-enquiries-open',
    dialog: 'sdh-enquiries-dialog',
    close: 'sdh-enquiries-close',
    status: 'sdh-enquiries-status',
    source: 'sdh-enquiries-source',
    list: 'sdh-enquiries-list',
    more: 'sdh-enquiries-more',
    note: 'sdh-enquiries-note',
    detail: 'sdh-enquiries-detail',
    back: 'sdh-enquiries-back',
    counts: 'sdh-enquiries-counts',
    live: 'sdh-enquiries-live',
  };

  const SOURCE_LABEL = { quote_request: 'Quote request', contact_form: 'Contact form' };
  const STATUS_LABEL = { new: 'New', read: 'Read', handled: 'Handled' };

  /** Looks up an element by id. */
  const byId = id => document.getElementById(id);
  /** The home script's helpers, or null when it is not there. */
  const home = () => window.SupplierDashboardHome || null;

  const view = {
    cardLoaded: false,
    cardRequested: false,
    loading: false,
    items: [],
    counts: null,
    page: 1,
    totalPages: 1,
    total: 0,
    selectedId: '',
    detail: null,
    problem: '',
  };

  /** A new element with a class and plain text. Text goes in as text, never as markup. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }
    return node;
  }

  /** "16 July 2026", or '' when the value is not a date. */
  function formatDate(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : '';
  }

  /** "16 Jul, 07:00": when an enquiry arrived. */
  function formatWhen(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime())
      ? date.toLocaleString('en-GB', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
  }

  /** What to say for a failed request: unapproved, no profile, or a plain failure. */
  function problemFor(result) {
    if (result.status === 403 && result.data && result.data.code === 'SUPPLIER_NOT_APPROVED') {
      return 'unapproved';
    }
    if (result.status === 404) {
      return 'missing';
    }
    return 'error';
  }

  /** The query string for the list: window, page, size and the two filters. */
  function listUrl(page, limit) {
    const params = new URLSearchParams({
      days: String(DAYS),
      page: String(page),
      limit: String(limit),
    });
    const status = byId(ids.status);
    const source = byId(ids.source);
    if (status && status.value) {
      params.set('status', status.value);
    }
    if (source && source.value) {
      params.set('source', source.value);
    }
    return `/api/supplier/enquiries?${params.toString()}`;
  }

  /* ------------------------------------------------------------------ *
   * The card
   * ------------------------------------------------------------------ */

  /** One line of the counts: "2 new of 2 in the last 90 days: 1 quote request, 1 contact message". */
  function countsText(counts) {
    if (!counts) {
      return '';
    }
    const part = (number, noun) => `${number} ${noun}${number === 1 ? '' : 's'}`;
    const sources = counts.bySource || {};
    return `${counts.new} new of ${counts.total} in the last ${DAYS} days (${part(sources.quoteRequests || 0, 'quote request')}, ${part(sources.contactForm || 0, 'contact message')}).`;
  }

  /** A row for the card and the drawer list: who, what and when, as one button. */
  function rowButton(item, selected) {
    const button = el('button', `sdh-enq${selected ? ' sdh-enq--selected' : ''}`);
    button.type = 'button';
    button.dataset.enquiryId = item.id;
    const top = el('span', 'sdh-enq__top');
    top.appendChild(el('span', 'sdh-enq__name', item.customerName || 'Customer'));
    top.appendChild(
      el(
        'span',
        `sdh-pill${item.status === 'new' ? ' sdh-pill--accent' : ''}`,
        STATUS_LABEL[item.status] || item.status
      )
    );
    button.appendChild(top);
    button.appendChild(el('span', 'sdh-enq__preview', item.preview || ''));
    const meta = [SOURCE_LABEL[item.source] || '', formatWhen(item.createdAt)]
      .filter(Boolean)
      .join(' · ');
    button.appendChild(el('span', 'sdh-enq__meta', meta));
    return button;
  }

  /** Puts the honest note on the card and in the drawer: no reply here, no alert when one arrives. */
  const NOTE =
    'You are not emailed when an enquiry arrives and you cannot reply here. Open one to see how to reach the customer, then answer them directly.';

  /** Draws the card body for the current state: loading, unapproved, error, empty or the latest rows. */
  function renderCard() {
    const body = byId(ids.body);
    if (!body) {
      return;
    }
    body.textContent = '';
    const open = byId(ids.open);
    if (open) {
      open.hidden = true;
    }
    if (!view.cardLoaded) {
      body.appendChild(el('div', 'sdh-skel sdh-skel--row'));
      return;
    }
    if (view.problem === 'unapproved') {
      body.appendChild(
        el(
          'p',
          'sdh-note',
          'Enquiries open once your profile has been approved. Customers can only find you after that.'
        )
      );
      return;
    }
    if (view.problem) {
      const wrap = el('div', 'sdh-empty');
      wrap.appendChild(el('p', 'sdh-empty__title', 'Your enquiries could not be loaded'));
      wrap.appendChild(el('p', 'sdh-empty__text', 'Check your connection and try again.'));
      const retry = el('button', 'sdh-btn sdh-btn--secondary sdh-btn--sm', 'Try again');
      retry.type = 'button';
      retry.dataset.enquiriesAction = 'reload-card';
      wrap.appendChild(retry);
      body.appendChild(wrap);
      return;
    }
    if (!view.counts || view.counts.total === 0) {
      body.appendChild(
        el(
          'p',
          'sdh-note',
          `No quote requests or contact messages in the last ${DAYS} days. They appear here when a customer sends one from your public profile.`
        )
      );
      body.appendChild(el('p', 'sdh-note sdh-note--foot', NOTE));
      return;
    }
    if (open) {
      open.hidden = false;
    }
    body.appendChild(el('p', 'sdh-enquiries__counts', countsText(view.counts)));
    const list = el('div', 'sdh-enq-list');
    view.items.slice(0, CARD_ROWS).forEach(item => list.appendChild(rowButton(item, false)));
    body.appendChild(list);
    body.appendChild(el('p', 'sdh-note sdh-note--foot', NOTE));
  }

  /** Loads the first rows for the card (and the counts for the page). */
  async function loadCard() {
    const api = home();
    if (!api || typeof api.getJson !== 'function') {
      return;
    }
    const context = api.getContext ? api.getContext() : null;
    if (
      context &&
      context.model &&
      context.model.verification &&
      context.model.verification.approved === false
    ) {
      view.problem = 'unapproved';
      view.cardLoaded = true;
      renderCard();
      return;
    }
    const result = await api.getJson(
      `/api/supplier/enquiries?days=${DAYS}&page=1&limit=${CARD_ROWS}`
    );
    view.cardLoaded = true;
    if (!result.data || result.status >= 400 || result.status === 0) {
      view.problem = problemFor(result);
    } else {
      view.problem = '';
      view.items = Array.isArray(result.data.enquiries) ? result.data.enquiries : [];
      view.counts = result.data.counts || null;
    }
    renderCard();
  }

  /* ------------------------------------------------------------------ *
   * The drawer
   * ------------------------------------------------------------------ */

  /** Tells screen readers something short ("Marked as read"). */
  function announce(message) {
    const live = byId(ids.live);
    if (live) {
      live.textContent = message;
    }
  }

  /** Draws the list pane: rows, a "Show more" button, or the empty / error state. */
  function renderList() {
    const list = byId(ids.list);
    const more = byId(ids.more);
    const counts = byId(ids.counts);
    if (!list) {
      return;
    }
    list.textContent = '';
    if (counts) {
      counts.textContent = view.counts ? countsText(view.counts) : '';
    }
    if (view.loading && !view.items.length) {
      list.appendChild(el('div', 'sdh-skel sdh-skel--row'));
      list.appendChild(el('div', 'sdh-skel sdh-skel--row'));
    } else if (view.problem === 'unapproved') {
      list.appendChild(el('p', 'sdh-note', 'Enquiries open once your profile has been approved.'));
    } else if (view.problem) {
      const wrap = el('div', 'sdh-empty');
      wrap.appendChild(el('p', 'sdh-empty__title', 'Your enquiries could not be loaded'));
      const retry = el('button', 'sdh-btn sdh-btn--secondary sdh-btn--sm', 'Try again');
      retry.type = 'button';
      retry.dataset.enquiriesAction = 'reload-list';
      wrap.appendChild(retry);
      list.appendChild(wrap);
    } else if (!view.items.length) {
      const filtered = Boolean((byId(ids.status) || {}).value || (byId(ids.source) || {}).value);
      list.appendChild(
        el(
          'p',
          'sdh-note',
          filtered
            ? 'No enquiries match these filters.'
            : `No quote requests or contact messages in the last ${DAYS} days.`
        )
      );
    } else {
      view.items.forEach(item => list.appendChild(rowButton(item, item.id === view.selectedId)));
    }
    if (more) {
      more.hidden = view.page >= view.totalPages || Boolean(view.problem);
    }
  }

  /** Loads a page of the list with the current filters; page 1 replaces the rows, later pages add to them. */
  async function loadList(page) {
    const api = home();
    if (!api) {
      return;
    }
    view.loading = true;
    if (page === 1) {
      view.items = [];
    }
    renderList();
    const result = await api.getJson(listUrl(page, PAGE_SIZE));
    view.loading = false;
    if (!result.data || result.status >= 400 || result.status === 0) {
      view.problem = problemFor(result);
      renderList();
      return;
    }
    view.problem = '';
    const rows = Array.isArray(result.data.enquiries) ? result.data.enquiries : [];
    view.items = page === 1 ? rows : view.items.concat(rows);
    view.counts = result.data.counts || view.counts;
    view.page = (result.data.pagination && result.data.pagination.page) || page;
    view.totalPages = (result.data.pagination && result.data.pagination.totalPages) || 1;
    view.total = (result.data.pagination && result.data.pagination.total) || rows.length;
    renderList();
  }

  /** One labelled fact in the detail pane, only when the value is there. */
  function fact(list, label, value, href) {
    if (!value) {
      return;
    }
    list.appendChild(el('dt', 'sdh-facts__label', label));
    const dd = el('dd', 'sdh-facts__value');
    if (href) {
      const link = el('a', 'sdh-link', value);
      link.href = href;
      dd.appendChild(link);
    } else {
      dd.textContent = value;
    }
    list.appendChild(dd);
  }

  /** A mailto: link for an address that looks like one; anything else is shown as text only. */
  function mailHref(email) {
    return typeof email === 'string' && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)
      ? `mailto:${email}`
      : '';
  }

  /** A tel: link for a phone number made of digits and the usual punctuation. */
  function telHref(phone) {
    const digits = typeof phone === 'string' ? phone.replace(/[^\d+]/g, '') : '';
    return typeof phone === 'string' && /^[\d\s()+.-]{6,}$/.test(phone) && digits.length >= 6
      ? `tel:${digits}`
      : '';
  }

  /** Draws the detail pane: who, how to reach them, what they asked, and the status buttons. */
  function renderDetail() {
    const pane = byId(ids.detail);
    const dialog = byId(ids.dialog);
    if (!pane) {
      return;
    }
    pane.textContent = '';
    if (dialog) {
      dialog.classList.toggle('sdh-drawer--detail', Boolean(view.selectedId));
    }
    const item = view.detail;
    if (!view.selectedId) {
      pane.appendChild(el('p', 'sdh-note', 'Choose an enquiry to read it.'));
      return;
    }
    if (!item) {
      pane.appendChild(el('div', 'sdh-skel sdh-skel--row'));
      return;
    }
    const title = el('h3', 'sdh-drawer__subtitle', item.customerName || 'Customer');
    title.id = 'sdh-enquiry-title';
    title.tabIndex = -1;
    pane.appendChild(title);
    pane.appendChild(
      el(
        'p',
        'sdh-note',
        [SOURCE_LABEL[item.source] || '', `received ${formatWhen(item.createdAt)}`]
          .filter(Boolean)
          .join(', ')
      )
    );
    const facts = el('dl', 'sdh-facts-grid');
    fact(facts, 'Email', item.email, mailHref(item.email));
    fact(facts, 'Phone', item.phone, telHref(item.phone));
    fact(facts, 'Event', item.eventType);
    fact(facts, 'Event date', formatDate(item.eventDate));
    fact(facts, 'Location', item.location);
    fact(facts, 'Budget', item.budget);
    pane.appendChild(facts);
    pane.appendChild(el('p', 'sdh-plan__head', 'Message'));
    pane.appendChild(el('p', 'sdh-enq__message', item.message || 'No message was left.'));
    pane.appendChild(el('p', 'sdh-note sdh-note--foot', NOTE));
    const actions = el('div', 'sdh-enq__actions');
    ['read', 'handled', 'new'].forEach(status => {
      if (item.status === status) {
        return;
      }
      const label = status === 'new' ? 'Mark as new' : `Mark as ${status}`;
      const button = el(
        'button',
        `sdh-btn ${status === 'handled' ? 'sdh-btn--primary' : 'sdh-btn--secondary'} sdh-btn--sm`,
        label
      );
      button.type = 'button';
      button.dataset.enquiriesAction = 'set-status';
      button.dataset.status = status;
      actions.appendChild(button);
    });
    pane.appendChild(el('p', 'sdh-note', `Status: ${STATUS_LABEL[item.status] || item.status}`));
    pane.appendChild(actions);
  }

  /** Opens one enquiry in the detail pane. Opening it does not change its status; the buttons do. */
  async function select(id) {
    const api = home();
    view.selectedId = id;
    view.detail = null;
    renderList();
    renderDetail();
    const result = await api.getJson(`/api/supplier/enquiries/${encodeURIComponent(id)}`);
    if (view.selectedId !== id) {
      return;
    }
    if (!result.data || !result.data.enquiry) {
      view.detail = {
        customerName: 'This enquiry could not be opened',
        message:
          result.status === 404
            ? 'It is no longer available.'
            : 'Check your connection and try again.',
        status: 'read',
      };
      renderDetail();
      return;
    }
    view.detail = result.data.enquiry;
    renderDetail();
    byId('sdh-enquiry-title')?.focus({ preventScroll: true });
  }

  /** Sets an enquiry's status through the server, then refreshes the row, the counts and the page. */
  async function setStatus(status) {
    const api = home();
    const id = view.selectedId;
    if (!api || !id) {
      return;
    }
    const buttons = byId(ids.detail).querySelectorAll('[data-enquiries-action="set-status"]');
    buttons.forEach(button => {
      button.disabled = true;
    });
    const result = await api.sendJson(
      `/api/supplier/enquiries/${encodeURIComponent(id)}`,
      'PATCH',
      { status }
    );
    if (!result.ok || !result.data.enquiry) {
      buttons.forEach(button => {
        button.disabled = false;
      });
      api.toast(
        result.data && result.data.error
          ? result.data.error
          : 'The status could not be changed. Please try again.',
        'error'
      );
      return;
    }
    view.detail = result.data.enquiry;
    const row = view.items.find(item => item.id === id);
    if (row) {
      row.status = result.data.enquiry.status;
    }
    announce(`Marked as ${status}.`);
    renderDetail();
    renderList();
    // The counts on the card and the page's summary changed: ask again.
    loadCard();
    document.dispatchEvent(new CustomEvent('sdh:changed'));
    loadList(1);
  }

  /** Opens the drawer, optionally on one enquiry. */
  function openDrawer(id) {
    const dialog = byId(ids.dialog);
    if (!dialog || dialog.open) {
      return;
    }
    view.page = 1;
    view.selectedId = '';
    view.detail = null;
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    document.body.classList.add('sdh-modal-open');
    renderDetail();
    loadList(1).then(() => {
      if (id) {
        select(id);
      }
    });
  }

  /** Closes the drawer. */
  function closeDrawer() {
    const dialog = byId(ids.dialog);
    if (dialog && dialog.open && typeof dialog.close === 'function') {
      dialog.close();
    }
  }

  /** Runs when the drawer has closed: unlock the page and give the card the fresh counts. */
  function afterClose() {
    document.body.classList.remove('sdh-modal-open');
    view.selectedId = '';
    view.detail = null;
    loadCard();
  }

  /** Binds the card, the drawer, the filters and the summary tile's button. */
  function init() {
    const dialog = byId(ids.dialog);
    if (!dialog) {
      return;
    }
    byId(ids.open)?.addEventListener('click', () => openDrawer(''));
    byId(ids.close)?.addEventListener('click', closeDrawer);
    byId(ids.more)?.addEventListener('click', () => loadList(view.page + 1));
    byId(ids.back)?.addEventListener('click', () => {
      view.selectedId = '';
      view.detail = null;
      renderDetail();
      renderList();
    });
    [ids.status, ids.source].forEach(id => byId(id)?.addEventListener('change', () => loadList(1)));
    dialog.addEventListener('close', afterClose);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && dialog.open && !event.defaultPrevented) {
        event.preventDefault();
        closeDrawer();
      }
    });
    dialog.addEventListener('click', event => {
      if (event.target === dialog) {
        closeDrawer();
        return;
      }
      const row = event.target.closest && event.target.closest('[data-enquiry-id]');
      if (row) {
        select(row.dataset.enquiryId);
        return;
      }
      const action = event.target.closest && event.target.closest('[data-enquiries-action]');
      if (action && action.dataset.enquiriesAction === 'set-status') {
        setStatus(action.dataset.status);
      } else if (action && action.dataset.enquiriesAction === 'reload-list') {
        loadList(1);
      }
    });
    byId(ids.card)?.addEventListener('click', event => {
      const row = event.target.closest && event.target.closest('[data-enquiry-id]');
      if (row) {
        openDrawer(row.dataset.enquiryId);
        return;
      }
      const action = event.target.closest && event.target.closest('[data-enquiries-action]');
      if (action && action.dataset.enquiriesAction === 'reload-card') {
        view.cardLoaded = false;
        renderCard();
        loadCard();
      }
    });
    document.addEventListener('sdh:open-enquiries', () => openDrawer(''));
    document.addEventListener('sdh:rendered', () => {
      const context = home() && home().getContext ? home().getContext() : null;
      if (!view.cardRequested && context && !context.noProfile) {
        view.cardRequested = true;
        loadCard();
      }
    });
    renderCard();
  }

  window.SupplierDashboardEnquiries = { countsText, problemFor, mailHref, telHref, listUrl };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
