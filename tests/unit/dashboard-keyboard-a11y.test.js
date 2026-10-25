/**
 * Keyboard and screen-reader behaviour of the customer and supplier dashboards, from the
 * keyboard-only audit (owner backlog V-7). Real keyboard behaviour is checked by running
 * overlay-focus.js under jsdom; the wiring and markup fixes are checked in the source.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const SCRIPT = `
const fs = require('fs');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><body><button id="opener">Open</button></body>', { runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync('public/assets/js/utils/overlay-focus.js', 'utf8'));
const doc = dom.window.document;
const F = dom.window.EFOverlayFocus;
// jsdom has no layout: model "visible" as not inside a [hidden] ancestor.
dom.window.Element.prototype.getClientRects = function () {
  return this.closest('[hidden]') ? [] : [{}];
};
const out = {};
const opener = doc.getElementById('opener');
opener.focus();
const overlay = doc.createElement('div');
overlay.innerHTML = '<button id="a">A</button><input id="b"><div hidden><button id="h">hidden</button></div><button id="c">C</button>';
doc.body.appendChild(overlay);
F.trap(overlay);
doc.getElementById('b').focus();
const tab = shiftKey => {
  const ev = new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
  doc.activeElement.dispatchEvent(ev);
  return ev;
};
doc.getElementById('c').focus();
const fwd = tab(false);
out.wrapForward = fwd.defaultPrevented && doc.activeElement.id === 'a';
const back = tab(true);
out.wrapBackward = back.defaultPrevented && doc.activeElement.id === 'c';
// Focus that has slipped outside is pulled back in.
opener.focus();
const stray = tab(false);
out.pullsStrayFocusIn = stray.defaultPrevented && overlay.contains(doc.activeElement);
// A second trap() must not stack a second listener.
const original = overlay._efFocusTrap;
F.trap(overlay);
out.listenerReused = overlay._efFocusTrap === original;
doc.getElementById('a').focus();
F.release(overlay);
out.focusReturned = doc.activeElement === opener;
// release() with an opener that has gone falls back.
const fb = doc.createElement('button');
fb.id = 'fb';
doc.body.appendChild(fb);
const gone = doc.createElement('button');
doc.body.appendChild(gone);
gone.focus();
const o2 = doc.createElement('div');
o2.innerHTML = '<button id="x">x</button>';
doc.body.appendChild(o2);
F.trap(o2);
doc.getElementById('x').focus();
gone.remove();
F.release(o2, fb);
out.fallbackUsed = doc.activeElement === fb;
// Focus the person moved elsewhere on purpose is left alone.
const o3 = doc.createElement('div');
o3.innerHTML = '<button id="y">y</button>';
doc.body.appendChild(o3);
opener.focus();
F.trap(o3);
fb.focus();
F.release(o3);
out.leavesDeliberateFocus = doc.activeElement === fb;
console.log(JSON.stringify(out));
`;

const HEADER_SCRIPT = `
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = '<!doctype html><body>' +
  '<button id="ef-notification-btn" aria-label="View notifications"><span id="ef-notification-badge" style="display:none"></span></button>' +
  '<a id="ef-bottom-dashboard" href="/d" aria-label="Go to dashboard"><span id="ef-bottom-dashboard-badge" style="display:none"></span></a>' +
  '<div id="notification-dropdown"><button id="mark">Mark all</button><a href="/n" id="all">View all</a></div>' +
  '<section id="card" aria-live="polite"><button id="retry">Try again</button></section>' +
  '<section id="card2" aria-live="polite"><button id="retry2">Try again</button></section></body>';
const dom = new JSDOM(html, { runScripts: 'outside-only' });
const doc = dom.window.document;
dom.window.eval(fs.readFileSync('public/assets/js/utils/keyboard-a11y.js', 'utf8'));
const out = {};
const tick = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const bell = doc.getElementById('ef-notification-btn');
  const badge = doc.getElementById('ef-notification-badge');
  out.plainLabel = bell.getAttribute('aria-label');
  badge.textContent = '3';
  badge.style.display = '';
  await tick(10);
  out.countLabel = bell.getAttribute('aria-label');
  const bottom = doc.getElementById('ef-bottom-dashboard-badge');
  bottom.textContent = '99+';
  bottom.style.display = 'inline-flex';
  await tick(10);
  out.bottomLabel = doc.getElementById('ef-bottom-dashboard').getAttribute('aria-label');
  badge.textContent = '';
  badge.style.display = 'none';
  await tick(10);
  out.clearedLabel = bell.getAttribute('aria-label');
  // keyboard open: focus moves into the list; a pointer click leaves it alone
  const dropdown = doc.getElementById('notification-dropdown');
  dropdown.classList.add('notification-dropdown--open');
  bell.focus();
  bell.dispatchEvent(new dom.window.MouseEvent('click', { detail: 1, bubbles: true }));
  await tick(120);
  out.pointerOpenKeepsFocus = doc.activeElement === bell;
  bell.dispatchEvent(new dom.window.MouseEvent('click', { detail: 0, bubbles: true }));
  await tick(120);
  out.keyboardOpenFocusesList = doc.activeElement.id === 'mark';
  // Escape inside the list gives focus back to the bell
  doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  out.escapeReturnsToBell = doc.activeElement === bell;
  // "Try again" by keyboard: the redraw deletes the button, so focus goes to its card, not <body>
  const retry = doc.getElementById('retry');
  retry.focus();
  retry.dispatchEvent(new dom.window.MouseEvent('click', { detail: 0, bubbles: true }));
  doc.getElementById('card').innerHTML = '<p>Still failing</p><button id="again">Try again</button>';
  await tick(300);
  out.retryFocusesCard = doc.activeElement === doc.getElementById('card');
  // ...but a mouse click, or a person who has moved on, is left alone
  const retry2 = doc.getElementById('retry2');
  retry2.focus();
  retry2.dispatchEvent(new dom.window.MouseEvent('click', { detail: 1, bubbles: true }));
  doc.getElementById('card2').innerHTML = '<p>Still failing</p>';
  await tick(300);
  out.mouseRetryLeftAlone = doc.activeElement !== doc.getElementById('card2');
  console.log(JSON.stringify(out));
})();
`;

describe('keyboard-a11y.js (header bell, bottom-bar link, Try again)', () => {
  const out = JSON.parse(execFileSync('node', ['-e', HEADER_SCRIPT], { cwd: ROOT }).toString());

  test("the unread count is part of each control's name, and goes when the count does", () => {
    expect(out.plainLabel).toBe('View notifications');
    expect(out.countLabel).toBe('View notifications, 3 unread');
    expect(out.bottomLabel).toBe('Go to dashboard, 99+ unread');
    expect(out.clearedLabel).toBe('View notifications');
  });

  test('opening the bell with the keyboard moves focus into the list; a click does not', () => {
    expect(out.pointerOpenKeepsFocus).toBe(true);
    expect(out.keyboardOpenFocusesList).toBe(true);
  });

  test('Escape from inside the list gives focus back to the bell', () => {
    expect(out.escapeReturnsToBell).toBe(true);
  });

  test('after a keyboard "Try again" focus stays in the card; a mouse click is left alone', () => {
    expect(out.retryFocusesCard).toBe(true);
    expect(out.mouseRetryLeftAlone).toBe(true);
  });

  test('the four signed-in pages load it', () => {
    for (const page of ['dashboard-customer', 'dashboard-supplier', 'budget', 'guests']) {
      expect(read(`public/${page}.html`)).toContain('/assets/js/utils/keyboard-a11y.js?v=');
    }
  });
});

describe('overlay-focus.js (hand-built modal overlays)', () => {
  const out = JSON.parse(execFileSync('node', ['-e', SCRIPT], { cwd: ROOT }).toString());

  test('Tab and Shift+Tab wrap inside the overlay, skipping hidden controls', () => {
    expect(out.wrapForward).toBe(true);
    expect(out.wrapBackward).toBe(true);
  });

  test('focus that has left the overlay is pulled back in on the next Tab', () => {
    expect(out.pullsStrayFocusIn).toBe(true);
  });

  test('trapping twice does not stack listeners', () => {
    expect(out.listenerReused).toBe(true);
  });

  test('release gives focus back to the opener, or the fallback when it has gone', () => {
    expect(out.focusReturned).toBe(true);
    expect(out.fallbackUsed).toBe(true);
  });

  test('release does not steal focus the person moved elsewhere', () => {
    expect(out.leavesDeliberateFocus).toBe(true);
  });
});

describe('the calendar overlays use it', () => {
  const customer = read('public/assets/js/calendar-view.js');
  const supplier = read('public/assets/js/pages/dashboard-supplier-calendar.js');
  const customerHtml = read('public/dashboard-customer.html');
  const supplierHtml = read('public/dashboard-supplier.html');

  test('both dashboards load overlay-focus.js before their calendar script', () => {
    const before = (html, calendar) =>
      html.indexOf('/assets/js/utils/overlay-focus.js') !== -1 &&
      html.indexOf('/assets/js/utils/overlay-focus.js') < html.indexOf(calendar);
    expect(before(customerHtml, '/assets/js/calendar-view.js')).toBe(true);
    expect(before(supplierHtml, '/assets/js/pages/dashboard-supplier-calendar.js')).toBe(true);
  });

  test('the customer entry modal traps focus on open and hands it back on close', () => {
    expect(customer).toMatch(/EFOverlayFocus\.trap\(overlay, returnFocusTo\)/);
    expect(customer).toMatch(/EFOverlayFocus\.release\(overlay,/);
  });

  test('the supplier entry modal, event modal, popovers and confirm all trap focus', () => {
    expect(supplier).toMatch(/function holdFocus\(overlay, opener\)/);
    expect(supplier).toMatch(/function returnFocus\(overlay, fallbackId\)/);
    for (const fn of [
      'openEntryModal',
      'openPublicEventModal',
      'showDeletePopover',
      'showPublicEventPopover',
      'showDeletePublicEventConfirm',
    ]) {
      const start = supplier.indexOf(`function ${fn}(`);
      expect(start).toBeGreaterThan(-1);
      expect(supplier.slice(start, start + 4500)).toMatch(/holdFocus\(/);
    }
    // The popovers announce themselves as modal, so they must also close on Escape.
    expect(supplier.slice(supplier.indexOf('function showDeletePopover('))).toMatch(
      /e\.key === 'Escape'/
    );
    expect(supplier.slice(supplier.indexOf('function showPublicEventPopover('))).toMatch(
      /e\.key === 'Escape'/
    );
  });
});

describe('calendar day buttons', () => {
  test('are named for their day, not "undefined", and are not 42 tab stops', () => {
    for (const file of [
      'public/assets/js/calendar-view.js',
      'public/assets/js/pages/dashboard-supplier-calendar.js',
    ]) {
      const src = read(file);
      const start = src.indexOf('dayCellDidMount(info)');
      expect(start).toBeGreaterThan(-1);
      const block = src.slice(start, start + 1600);
      // A day cell has a Date, never a dateStr (only click callbacks do): that was "undefined".
      expect(block).not.toMatch(/info\.dateStr/);
      expect(block).toMatch(/info\.date/);
      expect(block).toMatch(/addBtn\.tabIndex = -1/);
    }
  });
});

describe('live regions are announced', () => {
  test('the slow-load and sign-in notices go in empty and are filled after', () => {
    const src = read('public/assets/js/dashboard-guard.js');
    const slow = src.slice(
      src.indexOf('function showSlowNotice'),
      src.indexOf('function hideSlowNotice')
    );
    expect(slow.indexOf('document.body.appendChild(notice)')).toBeGreaterThan(-1);
    expect(slow.indexOf('document.body.appendChild(notice)')).toBeLessThan(
      slow.indexOf('Taking longer than usual')
    );
    const auth = src.slice(
      src.indexOf('function showAuthNotice'),
      src.indexOf('function hideAuthNotice')
    );
    expect(auth.indexOf('appendChild(notice)')).toBeLessThan(auth.indexOf('Still checking'));
  });

  test('calendar toasts are filled after they are on the page', () => {
    for (const file of [
      'public/assets/js/calendar-view.js',
      'public/assets/js/pages/dashboard-supplier-calendar.js',
    ]) {
      const src = read(file);
      const toast = src.slice(
        src.indexOf('function showToast'),
        src.indexOf('function showToast') + 900
      );
      expect(toast.indexOf('document.body.appendChild(toast)')).toBeLessThan(
        toast.indexOf('toast.textContent = message')
      );
    }
  });

  test('"Could not refresh your plans" is filled after it is on the page', () => {
    const src = read('public/assets/js/pages/dashboard-customer-init.js');
    const fn = src.slice(
      src.indexOf('function showPageNotice'),
      src.indexOf('function showPageNotice') + 1200
    );
    expect(fn.indexOf('document.body.appendChild(notice)')).toBeLessThan(
      fn.indexOf('strong.textContent = title')
    );
  });
});

describe('forms and names', () => {
  test('the plan editor ties its error to the field it is about', () => {
    const src = read('public/assets/js/pages/dashboard-customer-init.js');
    expect(src).toMatch(/nameInput\.setAttribute\('aria-describedby', 'cdh-pf-status'\)/);
    expect(src).toMatch(/guestsInput\.setAttribute\('aria-describedby', 'cdh-pf-status'\)/);
    expect(src).toMatch(/event\.target\.removeAttribute\('aria-describedby'\)/);
  });

  test('visible text is inside the accessible name (WCAG 2.5.3 Label in Name)', () => {
    const html = read('public/dashboard-customer.html');
    expect(html).toContain('aria-label="Open app, Wedding Website and RSVPs"');
    expect(html).toContain('aria-label="Add entry to calendar"');
    const widget = read('public/messenger/js/MessengerWidgetV4.js');
    // The conversation button is named by what is on it (name, preview, time, unread), not by a
    // label that replaced all of that.
    expect(widget).not.toMatch(/aria-label="Open conversation with/);
    expect(widget).toMatch(/> unread<\/span>/);
  });

  test('aria-label is only used where it is read: not on plain spans and divs', () => {
    const wedding = read('public/assets/js/pages/customer-wedding-website.js');
    expect(wedding).not.toContain('Wedding website status:');
    const reviews = read('public/assets/js/pages/supplier-reviews-init.js');
    expect(reviews).not.toMatch(/<span class="sr-review-rating-num" aria-label=/);
    expect(reviews).toContain('<div class="sr-distribution" role="group" aria-label=');
    expect(reviews).toContain(
      '<div class="sr-big-rating" role="img" aria-label="No star rating yet">'
    );
  });
});

describe('keyboard users', () => {
  test('every page has a skip link as its first element, to a focusable <main>', () => {
    for (const page of ['dashboard-customer', 'dashboard-supplier', 'budget', 'guests']) {
      const html = read(`public/${page}.html`);
      expect(html).toMatch(
        /<body[^>]*>\s*<a class="ef-skip-link" href="#main-content">Skip to main content<\/a>/
      );
      expect(html).toMatch(/<main id="main-content"[^>]*tabindex="-1"/);
    }
    const css = read('public/assets/css/signed-in-mobile-fixes.css');
    expect(css).toMatch(/\.ef-skip-link:focus/);
    expect(css).toMatch(/scroll-padding-top: 88px/);
    expect(css).toMatch(/scroll-padding-bottom: 96px/);
  });
});

describe('supplier dashboard', () => {
  test('redrawing the enquiries card does not hide the button that opened the drawer', () => {
    const src = read('public/assets/js/pages/supplier-dashboard-enquiries.js');
    const render = src.slice(
      src.indexOf('function renderCard()'),
      src.indexOf('function drawCard(')
    );
    // Hiding the focused button, even for an instant, drops focus to <body> after the drawer closes.
    expect(render).not.toMatch(/open\.hidden = true;/);
    expect(render).toMatch(/open\.hidden === showOpen/);
  });
});
