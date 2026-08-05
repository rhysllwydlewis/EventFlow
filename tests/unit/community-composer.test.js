/**
 * Guards for the composer rework: the site-wide form-control defect that made
 * the 18+ checkbox render detached from its label, and the modal that lets
 * "Start a discussion" open over the page it was pressed on.
 *
 * These are source-level contracts. The visual/a11y suite does not sign in, so
 * it never reaches the composer at all — without these, a regression on
 * /community/new would only surface when somebody looked at it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

/**
 * Read a file from the repository root.
 * @param {string} relative Repo-relative path.
 * @returns {string} File contents.
 */
function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('checkboxes and radios keep their intrinsic size', () => {
  // styles.css sets `width: 100%` on `input, select, textarea` for text-like
  // fields. A checkbox obeys it too: the control stretches to the container
  // width while the glyph stays 13px, and the browser paints that glyph in the
  // centre of the box. On /community/new the 18+ confirmation appeared to
  // float alone in the middle of its notice, a long way from its own label.

  const css = read('public/assets/css/styles.css');

  it('the generic rule is followed by a carve-out for checkboxes and radios', () => {
    const generic = css.indexOf('input,select,textarea{width:100%');
    const carveOut = css.indexOf('input[type="checkbox"],input[type="radio"]{width:auto');
    expect(generic).toBeGreaterThan(-1);
    expect(carveOut).toBeGreaterThan(-1);
    // Equal specificity, so the carve-out only wins by coming later.
    expect(carveOut).toBeGreaterThan(generic);
  });

  it('the composer checkbox is laid out beside its label, not above it', () => {
    // The site-wide `label { display: block }` would otherwise push the text
    // onto its own line even once the control is the right size.
    const community = read('public/assets/css/community.css');
    const block = community.slice(community.indexOf('.efc-check {'));
    const rule = block.slice(0, block.indexOf('}'));
    expect(rule).toContain('display: flex');
    expect(rule).toContain('align-items: flex-start');
  });

  it('the checkbox is square on touch viewports too', () => {
    // mobile-optimizations.css enforces a 20px minimum on both axes. Setting
    // only width there left a 20x18 rectangle.
    const community = read('public/assets/css/community.css');
    const block = community.slice(community.indexOf(".efc-check input[type='checkbox'] {"));
    const rule = block.slice(0, block.indexOf('}'));
    for (const property of ['width: 20px', 'height: 20px', 'min-width: 20px', 'min-height: 20px']) {
      expect(rule).toContain(property);
    }
  });
});

describe('the composer renders into any root, not just its own page', () => {
  const js = read('public/assets/js/community/composer.js');

  it('exposes a mount API and does not hard-bind to #efc-composer', () => {
    expect(js).toContain('window.EFCComposer = { mount, openDialog, closeDialog }');
    // Bailing out on a missing #efc-composer would stop the script dead on
    // every page that only wants the modal.
    expect(js).not.toMatch(
      /const root = document\.getElementById\('efc-composer'\);\s*if \(!EFC \|\| !root\)/
    );
  });

  it('uses a heading level appropriate to where it is mounted', () => {
    // As a page it owns the h1. In a dialog over /community the page already
    // has one, so a second would be a duplicate top-level heading.
    expect(js).toContain("mount(pageRoot, { heading: 'h1'");
    expect(js).toContain("heading: 'h2'");
  });

  it('only hides the server-rendered fallback when it is the page composer', () => {
    // In a modal the page underneath owns its own fallback content.
    expect(js).toContain('if (root === pageRoot)');
  });
});

describe('the modal is an enhancement over a working link', () => {
  const js = read('public/assets/js/community/composer.js');

  it('leaves the link alone without <dialog> support', () => {
    expect(js).toContain("typeof HTMLDialogElement === 'function'");
    expect(js).toContain('HTMLDialogElement.prototype.showModal');
  });

  it('does not intercept modified clicks', () => {
    // Cmd/Ctrl/shift/middle click means "open this somewhere else", and must
    // still reach /community/new as ordinary navigation.
    const block = js.slice(js.indexOf('function isPlainClick'));
    const body = block.slice(0, block.indexOf('\n  }'));
    for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey', 'button === 0']) {
      expect(body).toContain(key);
    }
  });

  it('confirms before discarding typed content on Escape', () => {
    // `cancel` fires before the dialog closes, and is the only place a
    // keyboard dismissal can be intercepted.
    expect(js).toContain("dialog.addEventListener('cancel'");
    expect(js).toContain('function hasUnsavedContent');
  });

  it('tears the dialog down on Escape rather than letting the browser close it', () => {
    // Caught in review. The handler used to preventDefault only when the
    // member declined the confirmation, so an accepted Escape let the browser
    // close the dialog natively and skipped closeDialog() entirely. The
    // discarded form stayed in the DOM with its autosave timer still armed —
    // measured: one draft was saved ~3s after the member chose to discard.
    const handler = js.slice(js.indexOf("dialog.addEventListener('cancel'"));
    const body = handler.slice(0, handler.indexOf('});'));
    // preventDefault must be unconditional, so it cannot sit inside an if.
    expect(body).toMatch(/cancel',\s*event => \{\s*event\.preventDefault\(\);/);
    expect(body).toContain('closeDialog()');
  });

  it('cancels pending timers when the dialog closes', () => {
    const close = js.slice(js.indexOf('function closeDialog'));
    const body = close.slice(0, close.indexOf('\n  }'));
    expect(body).toContain('clearTimeout(draftTimer)');
    expect(body).toContain('clearTimeout(suggestTimer)');
    // Ordered before close() so nothing can fire against a hidden form.
    expect(body.indexOf('clearTimeout(draftTimer)')).toBeLessThan(body.indexOf('dialog.close()'));
  });

  it('returns focus to whatever opened it', () => {
    expect(js).toContain('returnFocusTo');
    expect(js).toContain('returnFocusTo.focus()');
  });

  it('reads the category preselect from the link, not the current page', () => {
    // /community/new?category=venues opened as a modal from /community would
    // otherwise read /community's own (empty) query string.
    expect(js).toContain('openDialog(link, link.search)');
    expect(js).toContain('new URLSearchParams(presetSearch)');
  });
});

describe('the pages that offer "Start a discussion" load the composer', () => {
  it.each([['public/community.html'], ['public/community-discussions.html']])(
    '%s loads composer.js',
    file => {
      const html = read(file);
      expect(html).toContain('/assets/js/community/composer.js');
      expect(html).toContain('href="/community/new"');
    }
  );
});
