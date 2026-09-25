/**
 * components.js adds a site-wide `.back-to-top` to every page, including the
 * four legal pages, which also grow their own `.legal-top` (it additionally
 * returns focus to the heading, which the generic button does not). The two
 * used to render almost on top of each other. legal-pages.css hides the
 * generic one with a `:has()` rule, but `:has()` is not supported on every
 * mobile browser this site targets — silently, since an unsupported selector
 * just never matches rather than erroring — so legal-pages.js also removes
 * the generic button outright. This is what actually guarantees only one
 * button renders; the CSS rule is a same-effect fast path for browsers where
 * it works, exercised separately in tests/unit/legal-pages-content.test.js.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

function runNodeSmoke(source) {
  return execFileSync(process.execPath, ['-e', source], {
    cwd: path.join(__dirname, '../..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('legal pages back-to-top button', () => {
  it.each(['terms.html', 'privacy.html', 'legal.html', 'data-rights.html'])(
    'removes the site-wide back-to-top once its own control exists (%s)',
    page => {
      runNodeSmoke(String.raw`
      const assert = require('assert');
      const fs = require('fs');
      const { JSDOM } = require('jsdom');
      const html = fs.readFileSync('public/${page}', 'utf8');
      const dom = new JSDOM(html, {
        url: 'https://event-flow.co.uk/${page.replace('.html', '')}',
        runScripts: 'outside-only',
      });
      const document = dom.window.document;
      const DomEvent = dom.window.Event;

      // components.js loads before legal-pages.js on every one of these
      // pages (confirmed by tests/unit/legal-pages-content.test.js), so
      // evaluating them in this order reproduces the real page exactly.
      dom.window.eval(fs.readFileSync('public/assets/js/components.js', 'utf8'));
      dom.window.eval(fs.readFileSync('public/assets/js/legal-pages.js', 'utf8'));
      document.dispatchEvent(new DomEvent('DOMContentLoaded', { bubbles: true }));

      const legalTop = document.querySelector('.legal-top');
      const backToTop = document.querySelector('.back-to-top');

      if (legalTop) {
        // The page has enough sections for legal-pages.js to build its own
        // control (short pages, like data-rights.html, may not) — when it
        // does, the generic one must be gone, not just hidden, so no stale
        // element is left for a later script or a CSS regression to reveal.
        assert.strictEqual(backToTop, null, 'site-wide .back-to-top should be removed from the DOM');
      } else {
        // No .legal-top means nothing needed removing, so the generic
        // button is exactly what components.js on its own would produce.
        assert.notStrictEqual(backToTop, null, 'the generic back-to-top should still exist on its own');
      }
    `);
    }
  );
});
