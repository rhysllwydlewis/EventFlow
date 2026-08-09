/**
 * The location pages admin editor.
 *
 * The screen is server-agnostic markup plus one script, so these tests assert
 * the two things that actually break: that every editable field the API accepts
 * has a control, and that the script's save path cannot touch the workflow.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { LIMITS } = require('../../models/LocationContent');

const html = fs.readFileSync(path.join(__dirname, '../../public/admin-locations.html'), 'utf8');
const script = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/pages/admin-locations.js'),
  'utf8'
);
const css = fs.readFileSync(path.join(__dirname, '../../public/assets/css/locations.css'), 'utf8');

describe('editor markup', () => {
  it('has a control for every editable page-level field', () => {
    const ids = [
      'efl-seo-title',
      'efl-seo-description',
      'efl-hero-url',
      'efl-hero-credit',
      'efl-hero-source-url',
      'efl-hero-alt',
      'efl-intro',
    ];
    ids.forEach(id => expect(html).toContain(`id="${id}"`));
  });

  it('has repeatable templates for planning sections and FAQs', () => {
    expect(html).toContain('id="efl-section-template"');
    expect(html).toContain('id="efl-faq-template"');
    ['title', 'body', 'sourceName', 'sourceUrl', 'sourceDate'].forEach(field => {
      expect(html).toContain(`data-field="${field}"`);
    });
    ['question', 'answer'].forEach(field => {
      expect(html).toContain(`data-field="${field}"`);
    });
  });

  it('offers add, reorder and remove controls on repeatable rows', () => {
    expect(html).toContain('data-editor-action="add-section"');
    expect(html).toContain('data-editor-action="add-faq"');
    expect(html).toContain('data-move="up"');
    expect(html).toContain('data-move="down"');
    expect(html).toContain('data-remove="1"');
  });

  it('labels each field and keeps the error region announced', () => {
    expect(html).toContain('for="efl-seo-title"');
    expect(html).toContain('for="efl-hero-alt"');
    expect(html).toContain('id="efl-editor-errors"');
    expect(html).toMatch(/id="efl-editor-errors"[^>]*role="alert"/);
    expect(html).toMatch(/id="efl-editor-errors"[^>]*aria-live="polite"/);
  });

  it('says plainly that a pilot page is public but noindex', () => {
    expect(html).toMatch(/Pilot<\/strong>[\s\S]*publicly visible[\s\S]*noindex/);
  });

  it('loads the CSRF helper the save path needs', () => {
    expect(html).toContain('/assets/js/utils/csrf-token.js');
  });

  it('loads the shared EventFlow brand layer used by its public-style header and footer', () => {
    expect(html).toContain('/assets/css/eventflow-brand.css');
    expect(html).toContain('data-eventflow-brand="true"');
  });

  it('loads the Pexels chooser and offers it from the hero fieldset', () => {
    expect(html).toContain('/assets/js/components/pexels-selector.js');
    expect(html).toContain('data-editor-action="choose-pexels"');
    expect(html).toContain('id="efl-hero-picker-preview"');
  });

  it('keeps the existing workflow controls', () => {
    ['pilot', 'publish', 'index', 'review'].forEach(action => {
      expect(script).toContain(`data-action="${action}"`);
    });
    expect(script).toContain('href="/locations/');
  });
});

describe('editor script', () => {
  it('sends nothing but seo and content when saving copy', () => {
    const start = script.indexOf('function collectPayload()');
    const body = script.slice(start, script.indexOf('function validate(', start));

    expect(body).toContain('seo:');
    expect(body).toContain('content:');
    expect(body).not.toContain('status');
    expect(body).not.toContain('indexingRequested');
    expect(body).not.toContain('markReviewed');
  });

  it('loads the full record from the per-city endpoint before editing', () => {
    expect(script).toMatch(
      /api\(`\/api\/v1\/admin\/locations\/\$\{encodeURIComponent\(slug\)\}`\)/
    );
  });

  it('saves through PATCH with a CSRF token', () => {
    expect(script).toContain("method: 'PATCH'");
    expect(script).toContain("headers['X-CSRF-Token']");
  });

  it('asks before discarding unsaved changes, including on unload', () => {
    expect(script).toContain('Discard your unsaved changes');
    expect(script).toContain('function adminConfirm(');
    expect(script).toContain("window.addEventListener('beforeunload'");
    expect(script).toContain("dialogEl.addEventListener('cancel'");
  });

  it('opens the admin preview rather than promoting a draft to pilot', () => {
    expect(script).toContain('/preview');
    expect(script).toContain('data-action="draft-preview"');
  });

  it('takes its field limits from the API rather than hard-coding a second copy', () => {
    expect(script).toContain('data.limits');
    expect(script).toContain('record.limits');
  });

  it('falls back to limits that match the ones the API enforces', () => {
    const start = script.indexOf('let limits = {');
    const block = script.slice(start, script.indexOf('};', start));

    expect(block).toContain(`introMaxLength: ${LIMITS.introMaxLength}`);
    expect(block).toContain(`sectionBodyMaxLength: ${LIMITS.sectionBodyMaxLength}`);
    expect(block).toContain(`sectionTitleMaxLength: ${LIMITS.sectionTitleMaxLength}`);
    expect(block).toContain(`faqQuestionMaxLength: ${LIMITS.faqQuestionMaxLength}`);
    expect(block).toContain(`faqAnswerMaxLength: ${LIMITS.faqAnswerMaxLength}`);
    expect(block).toContain(`maxSections: ${LIMITS.maxSections}`);
    expect(block).toContain(`maxFaqs: ${LIMITS.maxFaqs}`);
  });

  it('refuses a hero image with no alt text', () => {
    expect(script).toContain('A hero image needs alt text.');
  });

  it('pre-searches Pexels using the city and nation', () => {
    expect(script).toContain('new window.PexelsSelector()');
    expect(script).toContain('`${editingCity.name} ${nation} city skyline landmark`');
  });

  it('escapes everything it injects as markup', () => {
    expect(script).toContain('function escapeHtml(');
    // Card fields all go through escapeHtml; the only raw interpolation is the
    // pre-escaped details block.
    expect(script).not.toMatch(/innerHTML = `[^`]*\$\{(?!renderDetails)/);
  });
});

describe('editor styles', () => {
  it('styles the dialog, fieldsets and repeatable rows', () => {
    [
      '.efl-editor',
      '.efl-fieldset',
      '.efl-repeatable__item',
      '.efl-preview-banner',
      '.efl-hero-picker-preview',
    ].forEach(selector => expect(css).toContain(selector));
  });

  it('stays within the viewport on a phone', () => {
    expect(css).toContain('width: min(860px, calc(100% - 2rem))');
    expect(css).toContain('max-height: 90vh');
  });
});
