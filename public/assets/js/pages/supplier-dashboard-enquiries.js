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
 *   POST  /api/supplier/enquiries/:id/reply   { message }  (emails the customer; marks it handled)
 *
 * Only an approved supplier can read them (the server answers 403 SUPPLIER_NOT_APPROVED and 404 for
 * another supplier's record). Customer text arrives as plain text, so every piece of it is put on
 * the page with textContent, never as markup. Suppliers are notified when an enquiry arrives
 * (services/supplierEnquiryNotifier.js). The drawer shows the customer's contact details and a form
 * to reply by email; the reply is sent from EventFlow with the supplier's address as Reply-To.
 */
'use strict';

(function () {
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
    quality: 'sdh-enquiries-quality',
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
    cardItems: [],
    cardCounts: null,
    cardProblem: '',
    listTicket: 0,
    cardRequested: false,
    loading: false,
    items: [],
    counts: null,
    page: 1,
    totalPages: 1,
    total: 0,
    selectedId: '',
    // Reply text typed but not sent, per enquiry, so changing a status or moving between enquiries
    // does not lose it.
    drafts: {},
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

  /** The query string for the list: window, page, size and the filters. */
  function listUrl(page, limit) {
    const params = new URLSearchParams({
      days: String(DAYS),
      page: String(page),
      limit: String(limit),
    });
    const status = byId(ids.status);
    const source = byId(ids.source);
    if (status?.value) {
      params.set('status', status.value);
    }
    if (source?.value) {
      params.set('source', source.value);
    }
    const quality = byId(ids.quality);
    if (quality?.value) {
      params.set('quality', quality.value);
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
    if (item.quality) {
      button.appendChild(el('span', 'sdh-enq__meta', `${item.quality} quality`));
    }
    return button;
  }

  /** The note on the card: how a supplier hears about an enquiry and where to answer it. */
  const NOTE =
    'You are notified when an enquiry arrives (and emailed, once your email address is verified). Open one to reply to the customer by email.';
  const MAX_REPLY = 2000;

  /** Draws the card body for the current state: loading, unapproved, error, empty or the latest rows. */
  function renderCard() {
    const body = byId(ids.body);
    if (!body) {
      return;
    }
    // Redrawing the card must not drop keyboard focus. Closing the drawer redraws it, so the
    // button that opened the drawer (or the row in the card) would otherwise lose the focus the
    // drawer had just given back.
    const active = document.activeElement;
    const focusInside = Boolean(active && body.contains(active));
    const focusedRow = focusInside ? active.closest('[data-enquiry-id]') : null;
    const rowId = focusedRow ? focusedRow.dataset.enquiryId : '';
    const open = byId(ids.open);
    const showOpen = drawCard(body);
    // Only change the button when it needs to change: hiding it, even for an instant, blurs it.
    if (open && open.hidden === showOpen) {
      open.hidden = !showOpen;
    }
    if (rowId) {
      const again = Array.from(body.querySelectorAll('[data-enquiry-id]')).find(
        item => item.dataset.enquiryId === rowId
      );
      (again || (open && !open.hidden ? open : null))?.focus({ preventScroll: true });
    } else if (focusInside && !body.contains(document.activeElement)) {
      // A button in the card (Try again) was replaced: keep focus in the card, not on the page.
      body.tabIndex = -1;
      body.focus({ preventScroll: true });
    }
  }

  /** Fills the card body for the current state; true when the card has enquiries to open. */
  function drawCard(body) {
    body.textContent = '';
    if (!view.cardLoaded) {
      body.appendChild(el('div', 'sdh-skel sdh-skel--row'));
      return false;
    }
    if (view.cardProblem === 'unapproved') {
      body.appendChild(
        el(
          'p',
          'sdh-note',
          'Enquiries open once your profile has been approved. Customers can only find you after that.'
        )
      );
      return false;
    }
    if (view.cardProblem) {
      const wrap = el('div', 'sdh-empty');
      wrap.appendChild(el('p', 'sdh-empty__title', 'Your enquiries could not be loaded'));
      wrap.appendChild(el('p', 'sdh-empty__text', 'Check your connection and try again.'));
      const retry = el('button', 'sdh-btn sdh-btn--secondary sdh-btn--sm', 'Try again');
      retry.type = 'button';
      retry.dataset.enquiriesAction = 'reload-card';
      wrap.appendChild(retry);
      body.appendChild(wrap);
      return false;
    }
    if (!view.cardCounts || view.cardCounts.total === 0) {
      body.appendChild(
        el(
          'p',
          'sdh-note',
          `No quote requests or contact messages in the last ${DAYS} days. They appear here when a customer sends one from your public profile.`
        )
      );
      body.appendChild(el('p', 'sdh-note sdh-note--foot', NOTE));
      return false;
    }
    body.appendChild(el('p', 'sdh-enquiries__counts', countsText(view.cardCounts)));
    const list = el('div', 'sdh-enq-list');
    view.cardItems.slice(0, CARD_ROWS).forEach(item => list.appendChild(rowButton(item, false)));
    body.appendChild(list);
    body.appendChild(el('p', 'sdh-note sdh-note--foot', NOTE));
    return true;
  }

  /** Loads the first rows for the card (and the counts for the page). */
  async function loadCard() {
    const api = home();
    if (!api || typeof api.getJson !== 'function') {
      return;
    }
    const context = api.getContext ? api.getContext() : null;
    if (context?.model?.verification?.approved === false) {
      view.cardProblem = 'unapproved';
      view.cardLoaded = true;
      renderCard();
      return;
    }
    const result = await api.getJson(
      `/api/supplier/enquiries?days=${DAYS}&page=1&limit=${CARD_ROWS}`
    );
    view.cardLoaded = true;
    if (!result.data || result.status >= 400 || result.status === 0) {
      view.cardProblem = problemFor(result);
    } else {
      view.cardProblem = '';
      view.cardItems = Array.isArray(result.data.enquiries) ? result.data.enquiries : [];
      view.cardCounts = result.data.counts || null;
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
      const filtered = [ids.status, ids.source, ids.quality].some(id =>
        Boolean((byId(id) || {}).value)
      );
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
    // Only the newest request may draw: a slower, older answer is dropped.
    view.listTicket += 1;
    const ticket = view.listTicket;
    if (page === 1) {
      view.items = [];
    }
    renderList();
    const result = await api.getJson(listUrl(page, PAGE_SIZE));
    if (ticket !== view.listTicket) {
      return;
    }
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
    view.page = result.data.pagination?.page || page;
    view.totalPages = result.data.pagination?.totalPages || 1;
    view.total = result.data.pagination?.total || rows.length;
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
    if (item.unavailable) {
      // Nothing was loaded, so there is nothing to mark: say why and stop.
      pane.appendChild(el('p', 'sdh-enq__message', item.message));
      return;
    }
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
    renderQuality(pane, item.quality);
    pane.appendChild(el('p', 'sdh-plan__head', 'Message'));
    pane.appendChild(el('p', 'sdh-enq__message', item.message || 'No message was left.'));
    renderReplies(pane, item);
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

  /** How likely the enquiry is to be a real one, and why: an estimate, said as one. */
  function renderQuality(pane, quality) {
    if (!quality || !quality.rating) {
      return;
    }
    pane.appendChild(
      el(
        'p',
        'sdh-note',
        `Enquiry quality: ${quality.rating} (an estimate from what was filled in).`
      )
    );
    if (Array.isArray(quality.reasons) && quality.reasons.length) {
      const reasons = el('ul', 'sdh-enq__reasons');
      quality.reasons.forEach(reason => reasons.appendChild(el('li', '', reason)));
      pane.appendChild(reasons);
    }
  }

  /** The replies already sent, and the form for another (when the customer left an address). */
  function renderReplies(pane, item) {
    const replies = Array.isArray(item.replies) ? item.replies : [];
    if (replies.length) {
      pane.appendChild(el('p', 'sdh-plan__head', 'Your replies'));
      const list = el('ul', 'sdh-enq__replies');
      replies.forEach(reply => {
        const row = el('li', 'sdh-enq__reply');
        row.appendChild(el('span', 'sdh-enq__reply-when', `Sent ${formatWhen(reply.sentAt)}`));
        row.appendChild(el('span', 'sdh-enq__message', reply.message));
        list.appendChild(row);
      });
      pane.appendChild(list);
    }
    if (!item.email) {
      pane.appendChild(
        el(
          'p',
          'sdh-note',
          'This customer did not leave an email address, so there is nobody to reply to here.'
        )
      );
      return;
    }
    const form = el('form', 'sdh-enq__reply-form');
    form.id = 'sdh-enquiry-reply-form';
    form.noValidate = true;
    const label = el('label', 'sdh-label', `Reply to ${item.customerName || 'the customer'}`);
    label.htmlFor = 'sdh-enquiry-reply';
    const area = el('textarea', 'sdh-input sdh-input--area');
    area.id = 'sdh-enquiry-reply';
    area.name = 'message';
    area.rows = 5;
    area.maxLength = MAX_REPLY;
    area.setAttribute('aria-describedby', 'sdh-enquiry-reply-help');
    area.value = view.drafts[item.id] || '';
    area.addEventListener('input', () => {
      view.drafts[item.id] = area.value;
    });
    const help = el(
      'p',
      'sdh-note',
      'Sent by email from EventFlow. Their answer comes to your account email address.'
    );
    help.id = 'sdh-enquiry-reply-help';
    const send = el('button', 'sdh-btn sdh-btn--primary sdh-btn--sm', 'Send reply');
    send.type = 'submit';
    form.append(label, area, help, send);
    pane.appendChild(form);
  }

  /** Sends the reply typed in the form, then shows it in the detail and marks the row handled. */
  async function sendReply(form) {
    const api = home();
    const id = view.selectedId;
    const area = form.elements.message;
    const send = form.querySelector('button[type="submit"]');
    const message = area.value.trim();
    if (!api || !id) {
      return;
    }
    if (!message) {
      api.toast('Write a reply first.', 'error');
      area.focus();
      return;
    }
    send.disabled = true;
    area.disabled = true;
    let result = null;
    try {
      result = await api.sendJson(
        `/api/supplier/enquiries/${encodeURIComponent(id)}/reply`,
        'POST',
        {
          message,
        }
      );
    } catch {
      result = { ok: false, status: 0, data: {} };
    }
    if (view.selectedId !== id) {
      return;
    }
    if (!result.ok || !result.data || !result.data.enquiry) {
      send.disabled = false;
      area.disabled = false;
      api.toast(
        result.data?.error || 'The reply could not be sent. Check your connection and try again.',
        'error'
      );
      area.focus();
      return;
    }
    delete view.drafts[id];
    view.detail = result.data.enquiry;
    const row = view.items.find(item => item.id === id);
    if (row) {
      row.status = result.data.enquiry.status;
    }
    if (result.data.warning) {
      // The email went, but a step after it did not save (the server's warning says which, and
      // already says the reply was sent): show that once, do not claim the enquiry was handled.
      api.toast(result.data.warning, 'info');
      announce(result.data.warning);
    } else {
      api.toast('Reply sent.', 'success');
      announce('Reply sent. The enquiry is marked as handled.');
    }
    renderDetail();
    byId('sdh-enquiry-title')?.focus({ preventScroll: true });
    renderList();
    loadCard();
    document.dispatchEvent(new CustomEvent('sdh:changed'));
    loadList(1);
  }

  /** Opens one enquiry in the detail pane. Opening it does not change its status; the buttons do. */
  async function select(id) {
    const api = home();
    if (!api) {
      return;
    }
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
        unavailable: true,
        customerName: 'This enquiry could not be opened',
        message:
          result.status === 404
            ? 'It is no longer available.'
            : 'Check your connection and try again.',
      };
      renderDetail();
      return;
    }
    view.detail = result.data.enquiry;
    renderDetail();
    byId('sdh-enquiry-title')?.focus({ preventScroll: true });
  }

  /**
   * Asks the server to change an enquiry's status. A dropped connection throws; it is treated like a
   * refusal so the buttons come back and it is said.
   */
  async function patchStatus(api, id, status) {
    try {
      return await api.sendJson(`/api/supplier/enquiries/${encodeURIComponent(id)}`, 'PATCH', {
        status,
      });
    } catch {
      return { ok: false, status: 0, data: {} };
    }
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
    const result = await patchStatus(api, id, status);
    if (!result.ok || !result.data || !result.data.enquiry) {
      buttons.forEach(button => {
        button.disabled = false;
      });
      api.toast(
        result.data?.error
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
    // The buttons were rebuilt: put keyboard focus on the heading so it is not lost to the page.
    byId('sdh-enquiry-title')?.focus({ preventScroll: true });
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
    if (dialog?.open && typeof dialog.close === 'function') {
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
    [ids.status, ids.source, ids.quality].forEach(id =>
      byId(id)?.addEventListener('change', () => loadList(1))
    );
    dialog.addEventListener('close', afterClose);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && dialog.open && !event.defaultPrevented) {
        event.preventDefault();
        closeDrawer();
      }
    });
    dialog.addEventListener('submit', event => {
      if (event.target && event.target.id === 'sdh-enquiry-reply-form') {
        event.preventDefault();
        sendReply(event.target);
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
