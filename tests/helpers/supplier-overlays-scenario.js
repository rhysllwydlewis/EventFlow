'use strict';

/**
 * Loads the supplier dashboard's markup (without its scripts) in jsdom, adds the editor scripts
 * under test and runs a scenario against them, printing what it found as JSON. Run in a child
 * process like the other jsdom scenarios here (jsdom's dependencies are ES modules).
 *
 * usage: node supplier-overlays-scenario.js <name> <base64 json options>
 *
 * Scenarios: overlays, banner. `confirm` is the answer the confirmation dialog will give.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

/** The page's own markup, without its scripts. */
const pageHtml = () => {
  const html = read('public/dashboard-supplier.html');
  const body = html.slice(html.indexOf('<body'), html.indexOf('</body>'));
  return `<!doctype html><html><head></head>${body.replace(/<script[\s\S]*?<\/script>/g, '')}</body></html>`;
};

/** Waits a few turns of the event loop. */
const settle = async (turns = 4) => {
  for (let turn = 0; turn < turns; turn += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

/** A jsdom window with <dialog> methods, which jsdom does not implement. */
function makeWindow(options) {
  const dom = new JSDOM(pageHtml(), {
    url: 'http://localhost/dashboard/supplier',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.console.error = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  window.HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new window.Event('close'));
  };
  window.Element.prototype.scrollIntoView = () => {};
  window.matchMedia = () => ({ matches: false });
  const asked = [];
  const calls = [];
  window.SupplierDashboardHome = {
    confirm: async settings => {
      asked.push(settings);
      return options.confirm !== false;
    },
    sendJson: async (url, method, body) => {
      calls.push({ url, method, body });
      const reply = options.replies && options.replies[`${method} ${url}`];
      return reply || { ok: true, status: 200, data: { ok: true, url: '/api/photos/new-banner' } };
    },
  };
  window._efCachedSuppliers = options.suppliers || [];
  return { window, asked, calls };
}

const field = (window, id) => window.document.getElementById(id);

/** Sets a text field the way typing does. */
function type(window, id, value) {
  const node = field(window, id);
  node.value = value;
  node.dispatchEvent(new window.Event('input', { bubbles: true }));
}

async function overlays(options) {
  const { window, asked } = makeWindow(options);
  window.eval(read('public/assets/js/pages/supplier-dashboard-overlays.js'));
  await settle();
  const api = window.SupplierDashboardOverlays;
  const events = [];
  window.document.addEventListener('sdh:overlay-opened', e =>
    events.push(`opened:${e.detail.name}`)
  );
  window.document.addEventListener('sdh:overlay-closed', e =>
    events.push(`closed:${e.detail.name}`)
  );
  const dialog = () => field(window, 'sdh-profile-dialog');
  const log = {};

  api.open('profile', { focusId: 'sup-name' });
  log.openedDialog = dialog().hasAttribute('open');
  log.expandedClass = field(window, 'profile-form-section').classList.contains('expanded');
  log.scrollLocked = window.document.body.classList.contains('sdh-modal-open');
  log.focusedId = window.document.activeElement && window.document.activeElement.id;
  log.dirtyAtStart = api.isDirty('profile');

  // Close without edits: no question.
  const closedWithoutEdits = await api.requestClose('profile');
  log.closedWithoutEdits = closedWithoutEdits;
  log.askedWithoutEdits = asked.length;
  log.scrollLockedAfter = window.document.body.classList.contains('sdh-modal-open');
  log.expandedAfter = field(window, 'profile-form-section').classList.contains('expanded');

  // Edit, then Cancel: asks; keep editing leaves it open.
  api.open('profile');
  type(window, 'sup-name', 'Changed');
  log.dirtyAfterEdit = api.isDirty('profile');
  options.confirm = false;
  const keep = await api.requestClose('profile');
  log.keepResult = keep;
  log.stillOpenAfterKeep = dialog().hasAttribute('open');
  log.valueAfterKeep = field(window, 'sup-name').value;
  log.askedTitle = asked[asked.length - 1] && asked[asked.length - 1].title;
  log.askedConfirmLabel = asked[asked.length - 1] && asked[asked.length - 1].confirmLabel;
  log.askedCancelLabel = asked[asked.length - 1] && asked[asked.length - 1].cancelLabel;

  // Escape asks as well.
  const keydown = new window.KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  dialog().dispatchEvent(keydown);
  await settle();
  log.escapeAsked = asked.length;
  log.escapeDefaultPrevented = keydown.defaultPrevented;
  log.stillOpenAfterEscape = dialog().hasAttribute('open');

  // markClean (after a save) means closing needs no question.
  api.markClean('profile');
  log.dirtyAfterMarkClean = api.isDirty('profile');

  // Discard: confirm true closes.
  type(window, 'sup-name', 'Changed again');
  window.SupplierDashboardHome.confirm = async () => true;
  const discarded = await api.requestClose('profile');
  log.discarded = discarded;
  log.closedAfterDiscard = !dialog().hasAttribute('open');

  // The browser closing the dialog by itself with unsaved edits puts it back.
  api.open('profile');
  type(window, 'sup-name', 'Unsaved');
  dialog().removeAttribute('open');
  dialog().dispatchEvent(new window.Event('close'));
  log.reopenedAfterRogueClose = dialog().hasAttribute('open');
  log.valueAfterRogueClose = field(window, 'sup-name').value;
  api.markClean('profile');
  api.close('profile');

  // A flagged field is unflagged when typed in.
  api.open('package');
  const title = field(window, 'pkg-title');
  title.setAttribute('aria-invalid', 'true');
  const status = field(window, 'pkg-status');
  status.setAttribute('data-tone', 'error');
  status.textContent = 'Please give the package a title.';
  type(window, 'pkg-title', 'x');
  log.flagCleared = !title.hasAttribute('aria-invalid');
  log.statusCleared = status.textContent === '';
  api.close('package');
  log.events = events;
  process.stdout.write(JSON.stringify(log));
}

async function banner(options) {
  const { window, calls } = makeWindow(options);
  window.eval(read('public/assets/js/pages/supplier-dashboard-banner.js'));
  await settle();
  const log = {};
  const label = () => field(window, 'sdh-banner-upload').textContent.trim();
  const removeVisible = () => !field(window, 'sdh-banner-remove').hidden;
  const render = () => window.SupplierDashboardBanner.render();

  // No profile yet.
  window._efCachedSuppliers = [];
  render();
  log.noProfile = {
    label: label(),
    disabled: field(window, 'sdh-banner-upload').disabled,
    message: field(window, 'sdh-banner-empty').textContent,
    removeVisible: removeVisible(),
  };

  // A profile without a banner.
  window._efCachedSuppliers = [{ id: 's1', name: 'A' }];
  render();
  log.noBanner = {
    label: label(),
    disabled: field(window, 'sdh-banner-upload').disabled,
    removeVisible: removeVisible(),
  };

  // Upload through the file input.
  const input = field(window, 'sdh-banner-input');
  const file = new window.File(['abc'], 'banner.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 30));
  log.upload = {
    call: calls[0] && {
      url: calls[0].url,
      method: calls[0].method,
      hasImage: /^data:image\/png;base64,/.test(calls[0].body.image),
    },
    status: field(window, 'sdh-banner-status').textContent,
    label: label(),
    removeVisible: removeVisible(),
    imgSrc: field(window, 'sdh-banner-img').getAttribute('src'),
    cached: window._efCachedSuppliers[0].bannerUrl,
  };

  // Wrong type and too big are refused without a request.
  const before = calls.length;
  const gif = new window.File(['abc'], 'banner.gif', { type: 'image/gif' });
  Object.defineProperty(input, 'files', { value: [gif], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
  log.wrongType = {
    status: field(window, 'sdh-banner-status').textContent,
    requests: calls.length - before,
  };
  const big = new window.File(['abc'], 'banner.png', { type: 'image/png' });
  Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
  Object.defineProperty(input, 'files', { value: [big], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
  log.tooBig = {
    status: field(window, 'sdh-banner-status').textContent,
    requests: calls.length - before,
  };

  // Remove clears it with a PATCH after asking.
  field(window, 'sdh-banner-remove').dispatchEvent(
    new window.MouseEvent('click', { bubbles: true })
  );
  await new Promise(resolve => setTimeout(resolve, 30));
  const patch = calls.find(call => call.method === 'PATCH');
  log.remove = {
    call: patch && { url: patch.url, body: patch.body },
    status: field(window, 'sdh-banner-status').textContent,
    label: label(),
    removeVisible: removeVisible(),
  };

  // A failed upload says why and keeps the old state.
  window._efCachedSuppliers = [{ id: 's1', bannerUrl: '/api/photos/old' }];
  render();
  options.replies = {};
  window.SupplierDashboardHome.sendJson = async () => ({
    ok: false,
    status: 400,
    data: { error: 'Invalid image' },
  });
  const png = new window.File(['abc'], 'banner.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [png], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 30));
  log.failed = {
    status: field(window, 'sdh-banner-status').textContent,
    imgSrc: field(window, 'sdh-banner-img').getAttribute('src'),
    uploadEnabled: !field(window, 'sdh-banner-upload').disabled,
  };

  // Unsafe addresses are never shown.
  const safe = window.SupplierDashboardBanner.safeImageUrl;
  log.safe = {
    path: safe('/api/photos/abc'),
    https: safe('https://cdn.example.com/a.jpg'),
    dataUrl: safe('data:image/png;base64,AAAA'),
    script: safe('javascript:alert(1)'),
    protocolRelative: safe('//evil.example/a.jpg'),
    empty: safe(''),
  };
  process.stdout.write(JSON.stringify(log));
}

async function guide(options) {
  const { window } = makeWindow(options);
  const context = options.context;
  window.SupplierDashboardHome.getContext = () => context;
  window.SupplierDashboardHome.stepAction = stepItem =>
    /package/.test(stepItem.key)
      ? { action: 'new-package' }
      : { action: 'edit-profile', focus: 'sup-name' };
  window.eval(read('public/assets/js/pages/supplier-dashboard-onboarding.js'));
  await settle();
  const dialog = field(window, 'sdh-guide-dialog');
  const text = id => field(window, id).textContent.trim();
  const click = id =>
    field(window, id).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const log = {};
  const stored = () => {
    const entry = Object.entries(window.localStorage).find(([key]) =>
      key.startsWith('ef.supplierGuide.v1.')
    );
    return entry ? JSON.parse(entry[1]) : null;
  };

  log.openedBefore = dialog.hasAttribute('open');
  window.document.dispatchEvent(new window.Event('sdh:rendered'));
  await settle();
  log.autoOpened = dialog.hasAttribute('open');
  log.count1 = text('sdh-guide-count');
  log.title1 = text('sdh-guide-title');
  log.backHidden1 = field(window, 'sdh-guide-back').hidden;
  log.linkHidden = field(window, 'sdh-guide-open').hidden;
  click('sdh-guide-next');
  log.count2 = text('sdh-guide-count');
  log.cta2 = field(window, 'sdh-guide-action').hidden ? '' : text('sdh-guide-action');
  log.ctaAction2 = field(window, 'sdh-guide-action').dataset.sdhAction;
  log.barNow = field(window, 'sdh-guide-bar').getAttribute('aria-valuenow');
  click('sdh-guide-skip');
  log.closedAfterSkip = !dialog.hasAttribute('open');
  log.storedAfterSkip = stored() && { status: stored().status, step: stored().step };

  // A new page view: the same user, the guide stays away.
  window.document.dispatchEvent(new window.Event('sdh:rendered'));
  await settle();
  log.reopenedByItself = dialog.hasAttribute('open');

  // The link resumes where it was left.
  click('sdh-guide-open');
  log.resumedCount = text('sdh-guide-count');
  click('sdh-guide-next');
  click('sdh-guide-next');
  log.lastNext = text('sdh-guide-next');
  click('sdh-guide-next');
  log.closedAfterFinish = !dialog.hasAttribute('open');
  log.storedAfterFinish = stored() && stored().status;
  process.stdout.write(JSON.stringify(log));
}

/** The source of one function declaration in app.js, from its marker to the next marker. */
function sliceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from === -1 || to === -1) {
    throw new Error(`could not slice ${start}`);
  }
  return source.slice(from, to);
}

/** Runs the real package and profile card renderers from app.js on awkward data. */
async function cards() {
  const { window } = makeWindow({});
  const app = read('public/assets/js/app.js');
  const code = [
    sliceBetween(app, 'function escapeHtml(', '// Supplier avatar initials/color'),
    sliceBetween(app, '  const PKG_CARD_PLACEHOLDER_PATHS', '  /**\n   * Package allowance'),
    sliceBetween(
      app,
      '  function supplierTierLabel(',
      "  /** The profile card's body for a supplier who has no profile yet"
    ),
    sliceBetween(
      app,
      '  function packageCardHtml(',
      '  /**\n   * A short message in the packages card'
    ),
  ].join('\n');
  window.eval(
    `${code}\nwindow.__cards = { packageCardHtml, packageListHtml, supplierCardHtml, packagePriceText, escapeAttr };`
  );
  const { packageCardHtml, supplierCardHtml, packagePriceText } = window.__cards;
  const wrap = html => {
    const holder = window.document.createElement('div');
    holder.innerHTML = html;
    return holder;
  };
  const log = {};
  const quoted = wrap(
    packageCardHtml({
      id: 'k"1',
      title: '6" round cake',
      price: '£120',
      approved: true,
      slug: 'six"cake',
      image: '/img/a.jpg"x',
    })
  );
  const edit = quoted.querySelector('[data-action="edit-package"]');
  const del = quoted.querySelector('[data-action="delete-package"]');
  log.quoted = {
    editLabel: edit.getAttribute('aria-label'),
    deleteLabel: del.getAttribute('aria-label'),
    editAttributes: Array.from(edit.attributes).map(attribute => attribute.name),
    packageId: edit.getAttribute('data-package-id'),
    price: quoted.querySelector('.sdh-pkg__price').textContent,
    title: quoted.querySelector('.sdh-pkg__title').textContent,
    imgSrc: quoted.querySelector('img').getAttribute('src'),
    viewHref: quoted.querySelector('a[href^="/package"]').getAttribute('href'),
    imgAttributes: Array.from(quoted.querySelector('img').attributes).map(
      attribute => attribute.name
    ),
  };
  log.priceNames = {
    typed: packagePriceText({ price: '£850 pp' }),
    older: packagePriceText({ price_display: '£1,000' }),
    both: packagePriceText({ price_display: '£1,000', price: '£5' }),
    number: packagePriceText({ price: 500 }),
    none: packagePriceText({}),
  };
  const many = items =>
    Array.from({ length: items }, (_, index) => ({
      id: `p${index}`,
      title: `Package ${index}`,
      approved: true,
    }));
  const folded = wrap(window.__cards.packageListHtml(many(12), false));
  log.list = {
    shown: folded.querySelectorAll('.sdh-pkgs')[0].querySelectorAll('.sdh-pkg').length,
    folded: folded.querySelectorAll('details .sdh-pkg').length,
    summary: folded.querySelector('summary') && folded.querySelector('summary').textContent,
    open: folded.querySelector('details').hasAttribute('open'),
    few: wrap(window.__cards.packageListHtml(many(5), false)).querySelectorAll('details').length,
    keptOpen: wrap(window.__cards.packageListHtml(many(8), true))
      .querySelector('details')
      .hasAttribute('open'),
    one: wrap(window.__cards.packageListHtml(many(6), false)).querySelector('summary').textContent,
  };
  log.noPrice = !wrap(packageCardHtml({ id: 'a', title: 'A' })).querySelector('.sdh-pkg__price');
  const profile = wrap(
    supplierCardHtml(
      {
        id: 's"1',
        name: 'Barn "Two" & Sons',
        approved: true,
        location: 'Bath',
        category: 'Venues',
      },
      '/api/photos/a.jpg',
      'B'
    )
  );
  log.profile = {
    cardClasses: profile.firstElementChild.className,
    name: profile.querySelector('.sdh-profile__name').textContent,
    supplierId: profile.firstElementChild.getAttribute('data-supplier-id'),
    fallbackText: profile.querySelector('.sdh-avatar img').getAttribute('data-fallback-text'),
  };
  process.stdout.write(JSON.stringify(log));
}

/** The enquiries card and drawer against a scripted API. */
async function enquiries(options) {
  const { window } = makeWindow(options);
  const requests = [];
  const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
  const list = [
    {
      id: 'qr_1',
      source: 'quote_request',
      createdAt: '2026-07-16T07:00:00.000Z',
      status: 'new',
      customerName: "Alice O'Brien",
      preview: evil,
      eventType: 'Wedding',
      eventDate: null,
    },
    {
      id: 'enq_1',
      source: 'contact_form',
      createdAt: '2026-07-16T10:00:00.000Z',
      status: 'read',
      customerName: 'Carol',
      preview: 'Do you cover Swansea?',
      eventType: null,
      eventDate: null,
    },
  ];
  const detail = {
    id: 'qr_1',
    source: 'quote_request',
    createdAt: '2026-07-16T07:00:00.000Z',
    customerName: "Alice O'Brien",
    email: 'alice@example.com',
    phone: '07123 456789',
    message: `${evil}\nsecond line`,
    eventType: 'Wedding',
    eventDate: '2027-06-12T00:00:00.000Z',
    location: 'Cardiff',
    budget: '2000',
    status: 'new',
  };
  const scripted = options.script || {};
  window.SupplierDashboardHome.getContext = () => ({
    loaded: true,
    noProfile: false,
    model: { verification: { approved: options.approved !== false } },
  });
  window.SupplierDashboardHome.toast = (message, tone) => requests.push(`toast:${tone}:${message}`);
  window.SupplierDashboardHome.getJson = async url => {
    requests.push(`GET ${url}`);
    if (scripted.listStatus && /enquiries\?/.test(url)) {
      return { status: scripted.listStatus, data: scripted.listData || null };
    }
    if (/enquiries\?/.test(url)) {
      const wanted = new URL(url, 'http://x').searchParams;
      const rows = list.filter(row => !wanted.get('source') || row.source === wanted.get('source'));
      return {
        status: 200,
        data: {
          success: true,
          enquiries: rows,
          counts: { total: 2, new: 1, bySource: { quoteRequests: 1, contactForm: 1 } },
          pagination: { page: 1, limit: 20, total: rows.length, totalPages: scripted.pages || 1 },
        },
      };
    }
    return { status: 200, data: { success: true, enquiry: detail } };
  };
  window.SupplierDashboardHome.sendJson = async (url, method, body) => {
    requests.push(`${method} ${url} ${JSON.stringify(body)}`);
    if (scripted.patchFails) {
      return { ok: false, status: 500, data: { error: 'Could not update' } };
    }
    return {
      ok: true,
      status: 200,
      data: { success: true, enquiry: { ...detail, status: body.status } },
    };
  };
  window.eval(read('public/assets/js/pages/supplier-dashboard-enquiries.js'));
  await settle();
  window.document.dispatchEvent(new window.Event('sdh:rendered'));
  await settle(6);
  const text = id => field(window, id).textContent.replace(/\s+/g, ' ').trim();
  const click = node => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const log = { requestsAfterRender: requests.slice() };
  log.card = text('sdh-enquiries-body');
  log.cardRows = field(window, 'sdh-enquiries-body').querySelectorAll('.sdh-enq').length;
  log.openHidden = field(window, 'sdh-enquiries-open').hidden;
  log.noInjectedNodes = field(window, 'sdh-enquiries-body').querySelectorAll('img, script').length;
  if (options.openDrawer !== false) {
    window.document.dispatchEvent(new window.Event('sdh:open-enquiries'));
    await settle(6);
    log.drawerOpen = field(window, 'sdh-enquiries-dialog').hasAttribute('open');
    log.listRows = field(window, 'sdh-enquiries-list').querySelectorAll('.sdh-enq').length;
    log.list = text('sdh-enquiries-list');
    log.listInjected = field(window, 'sdh-enquiries-list').querySelectorAll('img, script').length;
    log.counts = text('sdh-enquiries-counts');
    log.moreHidden = field(window, 'sdh-enquiries-more').hidden;
    const first = field(window, 'sdh-enquiries-list').querySelector('.sdh-enq');
    if (first) {
      click(first);
      await settle(6);
      log.detail = text('sdh-enquiries-detail');
      log.detailInjected = field(window, 'sdh-enquiries-detail').querySelectorAll(
        'img, script'
      ).length;
      log.pwned = window.__pwned || 0;
      log.mailto =
        (field(window, 'sdh-enquiries-detail').querySelector('a[href^="mailto:"]') || {}).href ||
        '';
      log.tel =
        (field(window, 'sdh-enquiries-detail').querySelector('a[href^="tel:"]') || {}).href || '';
      log.messageText = field(window, 'sdh-enquiries-detail').querySelector(
        '.sdh-enq__message'
      ).textContent;
      log.replyControls = field(window, 'sdh-enquiries-detail').querySelectorAll(
        'textarea, input, form'
      ).length;
      log.statusButtons = Array.from(
        field(window, 'sdh-enquiries-detail').querySelectorAll('[data-status]')
      ).map(button => button.textContent);
      const handled = field(window, 'sdh-enquiries-detail').querySelector(
        '[data-status="handled"]'
      );
      click(handled);
      await settle(8);
      log.afterPatch = requests.filter(entry => entry.startsWith('PATCH'));
      log.statusAfter = text('sdh-enquiries-detail').match(/Status: \w+/)[0];
      log.toasts = requests.filter(entry => entry.startsWith('toast'));
    }
    const source = field(window, 'sdh-enquiries-source');
    source.value = 'contact_form';
    source.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle(6);
    log.filteredRequest = requests.filter(entry => /source=contact_form/.test(entry)).length;
    log.filteredRows = field(window, 'sdh-enquiries-list').querySelectorAll('.sdh-enq').length;
  }
  log.allRequests = requests;
  process.stdout.write(JSON.stringify(log));
}

/** Delete, pause and resume a package against a scripted API: success, refusal and a thrown error. */
async function packageActions(options) {
  const { window } = makeWindow({ confirm: options.confirm });
  const app = read('public/assets/js/app.js');
  const code = [
    sliceBetween(app, 'function efSay(', '/** Message shown in #pkg-status'),
    `${sliceBetween(app, 'function notifyDashboardChanged(', '\n}\n')}\n}`,
    sliceBetween(app, 'async function packageRequest(', 'async function deletePackagePhoto('),
  ].join('\n');
  const events = [];
  window.SupplierDashboardHome.toast = (message, tone) => events.push(`toast:${tone}:${message}`);
  window.SupplierDashboardHome.sendJson = async (url, method) => {
    events.push(`${method} ${url}`);
    if (options.throws) {
      throw new Error('network down');
    }
    if (options.status && options.status !== 200) {
      return { ok: false, status: options.status, data: { error: options.error || 'Refused' } };
    }
    return { ok: true, status: 200, data: { ok: true } };
  };
  window._efLoadPackages = async () => {
    events.push('reloaded');
  };
  window.document.addEventListener('sdh:changed', () => events.push('changed-event'));
  window.eval(`${code}\nwindow.__actions = { deletePackage, togglePackagePause };`);
  const heading = window.document.getElementById('packages-heading');
  await window.__actions[options.action](options.id || 'k1', options.pause);
  process.stdout.write(
    JSON.stringify({
      events,
      focused: window.document.activeElement === heading,
    })
  );
}

const name = process.argv[2];
const options = JSON.parse(Buffer.from(process.argv[3] || 'e30=', 'base64').toString('utf8'));
const scenarios = { overlays, banner, guide, cards, enquiries, packageActions };
scenarios[name](options).catch(error => {
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exit(1);
});
