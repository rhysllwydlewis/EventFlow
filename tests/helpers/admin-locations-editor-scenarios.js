#!/usr/bin/env node
/**
 * Behavioural scenarios for the location pages admin editor.
 *
 * jsdom cannot be loaded inside Jest's transform in this repository, so the
 * editor is driven in a plain Node process — the same approach the FAQ page
 * regression suite takes — and the outcome of each scenario is printed as JSON
 * for the Jest suite to assert on.
 *
 * Run directly to debug: `node tests/helpers/admin-locations-editor-scenarios.js`
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '../..');
const pageHtml = fs.readFileSync(path.join(root, 'public/admin-locations.html'), 'utf8');
const script = fs.readFileSync(
  path.join(root, 'public/assets/js/pages/admin-locations.js'),
  'utf8'
);
const { LIMITS } = require(path.join(root, 'models/LocationContent'));

/**
 * A city record as the admin API returns it.
 * @param {Object} overrides Field overrides.
 * @returns {Object} Record.
 */
function record(overrides = {}) {
  return {
    slug: 'cardiff',
    name: 'Cardiff',
    nation: 'Wales',
    status: 'draft',
    indexingRequested: false,
    indexable: false,
    lastReviewedAt: null,
    reviewedBy: null,
    supplierCount: 8,
    categoryCount: 4,
    limits: LIMITS,
    gate: { score: 40, passMark: 60, blockers: ['page is not published'] },
    warnings: ['No local introduction has been written'],
    seo: { title: 'Cardiff suppliers', metaDescription: 'What to know.' },
    content: {
      heroImageUrl: null,
      heroImageAlt: null,
      heroImageCredit: null,
      heroImageSourceUrl: null,
      intro: 'An existing introduction.',
      planningSections: [
        { title: 'First', body: 'a', sourceName: null, sourceUrl: null, sourceDate: null },
        { title: 'Second', body: 'b', sourceName: null, sourceUrl: null, sourceDate: null },
      ],
      faqs: [{ question: 'Q1', answer: 'A1' }],
    },
    ...overrides,
  };
}

/**
 * Boot the admin screen with a stubbed API.
 * @param {Object} options `{item}`.
 * @returns {Promise<Object>} Test context.
 */
async function boot(options = {}) {
  const item = options.item || record();
  const calls = [];
  const confirmations = [];
  const alerts = [];
  const opened = [];
  const pexelsSearches = [];

  const dom = new JSDOM(pageHtml, {
    url: 'https://event-flow.co.uk/admin-locations',
    runScripts: 'outside-only',
  });
  const { window } = dom;

  // Native dialogs are banned on admin screens, so anything reaching these is
  // itself a failure the scenarios should catch.
  window.confirm = message => {
    confirmations.push(`NATIVE: ${message}`);
    return true;
  };
  window.alert = message => alerts.push(`NATIVE: ${message}`);
  window.open = url => {
    opened.push(url);
    return null;
  };
  window.EventFlowCsrf = { get: () => 'csrf-token' };
  window.PexelsSelector = class PexelsSelectorStub {
    open(callback, selectorOptions) {
      pexelsSearches.push(selectorOptions.searchTerm);
      callback('https://images.pexels.com/photos/5743996/pexels-photo-5743996.jpeg', {
        alt: 'Cardiff Bay waterfront',
        photographer: 'Balazs Bezeczky',
        url: 'https://www.pexels.com/photo/cardiff-bay-5743996/',
      });
    }
  };

  window.fetch = async (url, init = {}) => {
    calls.push({
      url,
      method: init.method || 'GET',
      body: init.body ? JSON.parse(init.body) : null,
      headers: init.headers || {},
    });

    if (url.startsWith('/api/v1/admin/locations?') || url === '/api/v1/admin/locations') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            items: [item],
            limits: LIMITS,
            summary: { total: 1, published: 0, pilot: 0, indexable: 0 },
          },
        }),
      };
    }
    if (init.method === 'PATCH') {
      return { ok: true, json: async () => ({ success: true, data: item }) };
    }
    return { ok: true, json: async () => ({ success: true, data: item }) };
  };

  window.eval(script);
  await settle(window);

  return {
    document: window.document,
    window,
    calls,
    confirmations,
    alerts,
    opened,
    pexelsSearches,
  };
}

/**
 * Let pending promise chains and timers run.
 * @param {Object} window JSDOM window.
 * @returns {Promise<void>} Resolves when settled.
 */
async function settle(window) {
  for (let index = 0; index < 4; index += 1) {
    await new Promise(resolve => window.setTimeout(resolve, 0));
  }
}

/**
 * Click an element and let its handler settle.
 * @param {Object} window JSDOM window.
 * @param {Object} element Element to click.
 * @returns {Promise<void>} Resolves when settled.
 */
async function click(window, element) {
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle(window);
}

/**
 * Fire an input event so the dirty flag and counters update.
 * @param {Object} window JSDOM window.
 * @param {Object} element Field element.
 * @returns {void} Nothing.
 */
function type(window, element, value) {
  element.value = value;
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/**
 * Open the editor for the first card.
 * @param {Object} context Test context.
 * @returns {Promise<void>} Resolves when open.
 */
async function openEditor(context) {
  await click(context.window, context.document.querySelector('[data-action="edit"]'));
}

/**
 * The question the in-page confirm dialog is currently asking, if any.
 * @param {Object} context Test context.
 * @returns {string|null} Question text.
 */
function pendingQuestion(context) {
  const dialog = context.document.getElementById('efl-confirm');
  return dialog.open ? context.document.getElementById('efl-confirm-message').textContent : null;
}

/**
 * Answer the in-page confirm dialog.
 * @param {Object} context Test context.
 * @param {boolean} answer Whether to confirm.
 * @returns {Promise<void>} Resolves when answered and settled.
 */
async function answer(context, value) {
  const dialog = context.document.getElementById('efl-confirm');
  await click(context.window, dialog.querySelector(`[data-confirm="${value ? 'yes' : 'no'}"]`));
}

/**
 * Section titles currently in the editor, in order.
 * @param {Object} document DOM document.
 * @returns {string[]} Titles.
 */
function sectionTitles(document) {
  return [...document.getElementById('efl-sections').children].map(
    row => row.querySelector('[data-field="title"]').value
  );
}

/**
 * The PATCH call the editor made, if any.
 * @param {Object} context Test context.
 * @returns {Object|null} Call.
 */
function patchCall(context) {
  return context.calls.find(call => call.method === 'PATCH') || null;
}

const scenarios = {
  async listsCitiesWithAnEditAction() {
    const { document } = await boot();
    return {
      hasCard: Boolean(document.querySelector('[data-slug="cardiff"]')),
      hasEdit: Boolean(document.querySelector('[data-action="edit"]')),
      hasDraftPreview: Boolean(document.querySelector('[data-action="draft-preview"]')),
      workflowActions: [...document.querySelectorAll('[data-action]')].map(button =>
        button.getAttribute('data-action')
      ),
    };
  },

  async fillsEveryFieldFromTheRecord() {
    const context = await boot();
    await openEditor(context);
    const { document } = context;
    return {
      title: document.getElementById('efl-seo-title').value,
      description: document.getElementById('efl-seo-description').value,
      intro: document.getElementById('efl-intro').value,
      sections: document.getElementById('efl-sections').children.length,
      faqs: document.getElementById('efl-faqs').children.length,
      loadedFrom: context.calls.map(call => call.url),
      introMaxLength: document.getElementById('efl-intro').getAttribute('maxlength'),
      sectionBodyMaxLength: document
        .getElementById('efl-sections')
        .children[0].querySelector('[data-field="body"]')
        .getAttribute('maxlength'),
    };
  },

  async showsGateAndWarnings() {
    const context = await boot();
    await openEditor(context);
    return { gate: context.document.getElementById('efl-editor-gate').textContent };
  },

  async explainsPilotState() {
    const context = await boot({ item: record({ status: 'pilot' }) });
    await openEditor(context);
    return { state: context.document.getElementById('efl-editor-state').textContent };
  },

  async addsASection() {
    const context = await boot();
    await openEditor(context);
    await click(
      context.window,
      context.document.querySelector('[data-editor-action="add-section"]')
    );
    return { sections: context.document.getElementById('efl-sections').children.length };
  },

  async refusesToExceedTheSectionLimit() {
    const context = await boot();
    await openEditor(context);
    const button = context.document.querySelector('[data-editor-action="add-section"]');
    for (let index = 0; index < LIMITS.maxSections + 2; index += 1) {
      await click(context.window, button);
    }
    return {
      sections: context.document.getElementById('efl-sections').children.length,
      error: context.document.getElementById('efl-editor-errors').textContent,
    };
  },

  async movesASectionUp() {
    const context = await boot();
    await openEditor(context);
    const second = context.document.getElementById('efl-sections').children[1];
    await click(context.window, second.querySelector('[data-move="up"]'));
    return { titles: sectionTitles(context.document) };
  },

  async movesASectionDown() {
    const context = await boot();
    await openEditor(context);
    const first = context.document.getElementById('efl-sections').children[0];
    await click(context.window, first.querySelector('[data-move="down"]'));
    return { titles: sectionTitles(context.document) };
  },

  async disablesMoveControlsAtTheEnds() {
    const context = await boot();
    await openEditor(context);
    const rows = [...context.document.getElementById('efl-sections').children];
    return {
      firstUpDisabled: rows[0].querySelector('[data-move="up"]').disabled,
      lastDownDisabled: rows[rows.length - 1].querySelector('[data-move="down"]').disabled,
    };
  },

  async removesASection() {
    const context = await boot();
    await openEditor(context);
    const first = context.document.getElementById('efl-sections').children[0];
    await click(context.window, first.querySelector('[data-remove]'));
    return { titles: sectionTitles(context.document) };
  },

  async addsAFaqWithoutTouchingSections() {
    const context = await boot();
    await openEditor(context);
    await click(context.window, context.document.querySelector('[data-editor-action="add-faq"]'));
    return {
      faqs: context.document.getElementById('efl-faqs').children.length,
      sections: context.document.getElementById('efl-sections').children.length,
    };
  },

  async savesOnlyEditorialFields() {
    const context = await boot();
    await openEditor(context);
    const second = context.document.getElementById('efl-sections').children[1];
    await click(context.window, second.querySelector('[data-move="up"]'));
    type(context.window, context.document.getElementById('efl-intro'), 'A rewritten introduction.');
    await click(context.window, context.document.querySelector('[data-editor-action="save"]'));

    const patch = patchCall(context);
    return {
      url: patch.url,
      keys: Object.keys(patch.body).sort(),
      intro: patch.body.content.intro,
      order: patch.body.content.planningSections.map(section => section.title),
      csrf: patch.headers['X-CSRF-Token'],
    };
  },

  async savesTheFullSourceTriple() {
    const context = await boot();
    await openEditor(context);
    const row = context.document.getElementById('efl-sections').children[0];
    type(context.window, row.querySelector('[data-field="sourceName"]'), 'Cardiff Council');
    type(context.window, row.querySelector('[data-field="sourceUrl"]'), 'https://cardiff.gov.uk');
    type(context.window, row.querySelector('[data-field="sourceDate"]'), 'March 2026');
    await click(context.window, context.document.querySelector('[data-editor-action="save"]'));

    return { section: patchCall(context).body.content.planningSections[0] };
  },

  async savesHeroFields() {
    const context = await boot();
    await openEditor(context);
    type(
      context.window,
      context.document.getElementById('efl-hero-url'),
      'https://cdn.example.com/cardiff.jpg'
    );
    type(context.window, context.document.getElementById('efl-hero-alt'), 'Cardiff Bay at dusk');
    await click(context.window, context.document.querySelector('[data-editor-action="save"]'));

    return { content: patchCall(context).body.content };
  },

  async choosesACitySpecificPexelsPhoto() {
    const context = await boot();
    await openEditor(context);
    await click(
      context.window,
      context.document.querySelector('[data-editor-action="choose-pexels"]')
    );

    return {
      query: context.pexelsSearches[0],
      imageUrl: context.document.getElementById('efl-hero-url').value,
      alt: context.document.getElementById('efl-hero-alt').value,
      credit: context.document.getElementById('efl-hero-credit').value,
      sourceUrl: context.document.getElementById('efl-hero-source-url').value,
      previewHidden: context.document.getElementById('efl-hero-picker-preview').hidden,
      dirty: context.document.getElementById('efl-editor-dirty').textContent,
    };
  },

  async clearsStaleAttributionWhenTheHeroUrlChanges() {
    const context = await boot();
    await openEditor(context);
    await click(
      context.window,
      context.document.querySelector('[data-editor-action="choose-pexels"]')
    );
    type(
      context.window,
      context.document.getElementById('efl-hero-url'),
      'https://cdn.example.com/different-cardiff.jpg'
    );

    return {
      credit: context.document.getElementById('efl-hero-credit').value,
      sourceUrl: context.document.getElementById('efl-hero-source-url').value,
      previewCredit: context.document.getElementById('efl-hero-picker-credit').textContent,
    };
  },

  async blocksHeroWithoutAltText() {
    const context = await boot();
    await openEditor(context);
    type(
      context.window,
      context.document.getElementById('efl-hero-url'),
      'https://cdn.example.com/a.jpg'
    );
    await click(context.window, context.document.querySelector('[data-editor-action="save"]'));

    return {
      patched: Boolean(patchCall(context)),
      error: context.document.getElementById('efl-editor-errors').textContent,
    };
  },

  async blocksANonWebSourceUrl() {
    const context = await boot();
    await openEditor(context);
    const row = context.document.getElementById('efl-sections').children[0];
    type(context.window, row.querySelector('[data-field="sourceUrl"]'), 'javascript:alert(1)');
    await click(context.window, context.document.querySelector('[data-editor-action="save"]'));

    return {
      patched: Boolean(patchCall(context)),
      error: context.document.getElementById('efl-editor-errors').textContent,
    };
  },

  async warnsBeforeSavingADiscardedRow() {
    const context = await boot();
    await openEditor(context);
    await click(context.window, context.document.querySelector('[data-editor-action="add-faq"]'));
    await click(context.window, context.document.querySelector('[data-editor-action="save"]'));

    const question = pendingQuestion(context);
    await answer(context, false);

    return {
      question,
      nativeDialogs: context.confirmations.concat(context.alerts),
      patched: Boolean(patchCall(context)),
    };
  },

  async savesTheDiscardedRowWarningWhenConfirmed() {
    const context = await boot();
    await openEditor(context);
    await click(context.window, context.document.querySelector('[data-editor-action="add-faq"]'));
    await click(context.window, context.document.querySelector('[data-editor-action="save"]'));
    await answer(context, true);

    return { patched: Boolean(patchCall(context)) };
  },

  async surfacesAServerError() {
    const context = await boot();
    await openEditor(context);
    context.window.fetch = async () => ({
      ok: false,
      json: async () => ({ success: false, error: 'Failed to update location page' }),
    });
    await click(context.window, context.document.querySelector('[data-editor-action="save"]'));

    return { error: context.document.getElementById('efl-editor-errors').textContent };
  },

  async asksBeforeDiscardingUnsavedWork() {
    const context = await boot();
    await openEditor(context);
    type(context.window, context.document.getElementById('efl-intro'), 'changed');
    await click(context.window, context.document.querySelector('[data-editor-action="close"]'));

    const question = pendingQuestion(context);
    await answer(context, false);

    return {
      question,
      nativeDialogs: context.confirmations.concat(context.alerts),
      stillOpen: context.document.getElementById('efl-editor').open,
    };
  },

  async closesOnceTheDiscardIsConfirmed() {
    const context = await boot();
    await openEditor(context);
    type(context.window, context.document.getElementById('efl-intro'), 'changed');
    await click(context.window, context.document.querySelector('[data-editor-action="close"]'));
    await answer(context, true);

    return { stillOpen: context.document.getElementById('efl-editor').open };
  },

  async closesWithoutAskingWhenClean() {
    const context = await boot();
    await openEditor(context);
    await click(context.window, context.document.querySelector('[data-editor-action="close"]'));

    return {
      question: pendingQuestion(context),
      stillOpen: context.document.getElementById('efl-editor').open,
    };
  },

  async flagsUnsavedWork() {
    const context = await boot();
    await openEditor(context);
    const before = context.document.getElementById('efl-editor-dirty').textContent;
    type(context.window, context.document.getElementById('efl-intro'), 'changed');
    return {
      before,
      after: context.document.getElementById('efl-editor-dirty').textContent,
    };
  },

  async refusesToPreviewUnsavedWork() {
    const context = await boot();
    await openEditor(context);
    type(context.window, context.document.getElementById('efl-intro'), 'changed');
    await click(context.window, context.document.querySelector('[data-editor-action="preview"]'));

    return {
      error: context.document.getElementById('efl-editor-errors').textContent,
      nativeDialogs: context.confirmations.concat(context.alerts),
      opened: context.opened,
    };
  },

  async opensTheDraftPreviewFromTheCard() {
    const context = await boot();
    await click(context.window, context.document.querySelector('[data-action="draft-preview"]'));
    return { opened: context.opened };
  },

  async countsCharactersAgainstTheLimit() {
    const context = await boot();
    await openEditor(context);
    const note = context.document.querySelector('[data-counter-for="efl-seo-title"]');
    const before = note.textContent;
    type(context.window, context.document.getElementById('efl-seo-title'), 'x'.repeat(80));
    return {
      before,
      after: note.textContent,
      over: note.classList.contains('efl-field-note--over'),
    };
  },
};

/**
 * Run every scenario and print the results as JSON.
 * @returns {Promise<void>} Resolves when printed.
 */
async function main() {
  const results = {};
  for (const [name, scenario] of Object.entries(scenarios)) {
    try {
      results[name] = { ok: true, value: await scenario() };
    } catch (error) {
      results[name] = { ok: false, error: error.message, stack: error.stack };
    }
  }
  process.stdout.write(JSON.stringify(results));
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(String(error && error.stack));
    process.exit(1);
  });
}

module.exports = { scenarios };
