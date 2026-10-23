/**
 * The shared Modal class (public/assets/js/components.js), driven through a real DOM.
 * The scenarios are in tests/helpers/modal-scenarios.js (plain Node: jsdom cannot be loaded through
 * Jest's transform here).
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '../..');
const results = JSON.parse(
  execFileSync(process.execPath, [path.join(root, 'tests/helpers/modal-scenarios.js')], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
);

describe('Escape handling', () => {
  test('every Escape listener a dialog adds is removed when it closes', () => {
    expect(results.listeners.added).toBe(3);
    expect(results.listeners.removed).toBe(results.listeners.added);
    expect(results.listeners.overlaysLeft).toBe(0);
  });

  test('Escape closes the open dialog, and pressing it again or closing twice is harmless', () => {
    expect(results.escape).toEqual({ before: true, afterEscape: false, threw: false });
  });
});

describe('the confirm button', () => {
  test('a handler that returns false keeps the dialog open', () => {
    expect(results.confirm.confirms).toBe(1);
    expect(results.confirm.stayedOpen).toBe(true);
  });

  test('any other result, and no handler at all, still close it as before', () => {
    expect(results.confirm.closed).toBe(true);
    expect(results.confirm.closedWithoutHandler).toBe(true);
  });
});

describe('focus', () => {
  test('moves into the dialog, and returns to the button that opened it', () => {
    expect(results.focus).toEqual({ insideWhileOpen: true, restored: true });
  });

  test('Tab wraps from the last control to the first', () => {
    expect(results.tab).toEqual({ prevented: true, wrappedToFirst: true });
  });
});

describe('the accessible name', () => {
  test('the dialog is labelled by its (escaped) title and ids are not shared', () => {
    expect(results.name).toEqual({
      labelledby: true,
      titleText: 'First <b>',
      escaped: true,
      distinctIds: true,
    });
  });
});
