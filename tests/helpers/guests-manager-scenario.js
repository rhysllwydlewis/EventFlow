'use strict';

/**
 * Runs the real /guests page (public/guests.html + public/assets/js/guests.js) in jsdom with a
 * mocked API and prints what it rendered as JSON. Run in a child process, like the other
 * jsdom scenarios here, because jsdom's dependencies are ES modules that Jest cannot load.
 *
 * usage: node guests-manager-scenario.js <base64 json {guests, plans, guestsStatus}>
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '../..');

/** Waits long enough for the fetch, render and DOM updates to finish. */
async function settle() {
  for (let i = 0; i < 8; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  await new Promise(resolve => setTimeout(resolve, 30));
}

/** Loads the page in jsdom with the scenario's mock API and prints what it rendered as JSON. */
async function main() {
  const scenario = JSON.parse(Buffer.from(process.argv[2] || 'e30=', 'base64').toString('utf8'));
  const plans = scenario.plans || [{ id: 'p1', name: 'Our wedding', eventType: 'wedding' }];
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'public/guests.html'), 'utf8'), {
    url: 'http://localhost/guests',
    runScripts: 'outside-only',
  });
  if (scenario.search) {
    dom.reconfigure({ url: `http://localhost/guests${scenario.search}` });
  }
  const { window } = dom;
  window.__CSRF_TOKEN__ = 'test-token';
  // jsdom has no <dialog> behaviour; give it the two calls the page makes.
  const dialogProto = window.HTMLDialogElement.prototype;
  dialogProto.showModal =
    dialogProto.showModal ||
    function showModal() {
      this.setAttribute('open', '');
    };
  dialogProto.close =
    dialogProto.close ||
    function close() {
      this.removeAttribute('open');
      this.dispatchEvent(new window.Event('close'));
    };
  const writes = [];
  window.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/csrf-token')) {
      return { ok: true, status: 200, json: async () => ({ csrfToken: 'test-token' }) };
    }
    if (options.method && options.method !== 'GET') {
      writes.push({
        method: options.method,
        url: String(url),
        body: JSON.parse(options.body || '{}'),
      });
      const guest = {
        ...(scenario.guests || [])[0],
        ...JSON.parse(options.body || '{}'),
        ...(scenario.serverChanges || {}),
      };
      return { ok: true, status: 200, json: async () => ({ guest }) };
    }
    if (String(url).endsWith('/api/me/plans')) {
      return { ok: true, status: 200, json: async () => ({ plans }) };
    }
    const status = scenario.guestsStatus || 200;
    return {
      ok: status < 400,
      status,
      json: async () =>
        status < 400 ? { guests: scenario.guests || [] } : { error: 'Internal server error' },
    };
  };
  window.eval(fs.readFileSync(path.join(root, 'public/assets/js/guests.js'), 'utf8'));
  // jsdom fires the real DOMContentLoaded itself while the document is still loading.
  if (window.document.readyState !== 'loading') {
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }
  await settle();

  const doc = window.document;
  /** The whitespace-normalised text of the first element matching `selector`. */
  const text = selector =>
    (doc.querySelector(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
  const result = {
    stats: [...doc.querySelectorAll('.gm-stat')].map(li =>
      [...li.children].map(el => el.textContent.trim()).join('|')
    ),
    rows: doc.querySelectorAll('tbody tr').length,
    emptyTitle: text('.gm-empty__title'),
    summaryHidden: doc.querySelector('.gm-summary')?.hidden ?? null,
    toolbarHidden: doc.querySelector('.gm-toolbar')?.hidden ?? null,
    noteHref: doc.querySelector('.gm-note a')?.getAttribute('href') || null,
    hasNote: Boolean(doc.querySelector('.gm-note')),
    retry: Boolean(doc.querySelector('[data-action="retry"]')),
    addHidden: doc.querySelector('[data-action="add"]').hidden,
    results: {
      imgs: doc.querySelectorAll('#gm-results img, #gm-results script').length,
      text: text('#gm-results'),
      editOnclick: doc.querySelector('[data-action="edit"]')?.getAttribute('onclick') ?? null,
      editId: doc.querySelector('[data-action="edit"]')?.dataset.id ?? null,
    },
  };

  result.selectedPlan = doc.querySelector('#gm-plan-select')?.value ?? null;
  result.urlSearch = window.location.search;

  const edit = doc.querySelector('[data-action="edit"]');
  if (edit && scenario.submitEdit) {
    edit.click();
    const dialog = doc.querySelector('dialog');
    Object.entries(scenario.submitEdit).forEach(([name, value]) => {
      dialog.querySelector(`[name="${name}"]`).value = value;
    });
    dialog.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await settle();
    result.error = (
      dialog.querySelector('.gm-form-error, [role="alert"]')?.textContent || ''
    ).trim();
    result.toast = (doc.querySelector('.gm-toast')?.textContent || '').trim();
    result.invalid = [...dialog.querySelectorAll('[aria-invalid]')].map(field => field.name);
  } else if (edit) {
    edit.click();
    const dialog = doc.querySelector('dialog');
    result.editDialog = {
      imgs: dialog.querySelectorAll('img, script').length,
      nameValue: dialog.querySelector('[name="name"]').value,
    };
    dialog.remove();
    doc.querySelector('[data-action="delete"]').click();
    result.deleteDialog = {
      imgs: doc.querySelectorAll('dialog img, dialog script').length,
      title: [...doc.querySelectorAll('dialog h2')].map(h => h.textContent).join(' // '),
    };
  }
  result.writes = writes;
  result.pwned = window.__pwned === undefined ? null : window.__pwned;
  process.stdout.write(JSON.stringify(result));
}

main().catch(error => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
