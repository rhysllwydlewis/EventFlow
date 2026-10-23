#!/usr/bin/env node
/**
 * Behavioural scenarios for the shared Modal class (public/assets/js/components.js).
 *
 * jsdom cannot be loaded inside Jest's transform in this repository, so the script runs in a plain
 * Node process and prints each scenario's outcome as JSON for tests/unit/modal-component.test.js.
 *
 * Run directly to debug: `node tests/helpers/modal-scenarios.js`
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const source = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/components.js'),
  'utf8'
);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A window with components.js loaded and every document keydown listener counted. */
function freshWindow() {
  const dom = new JSDOM(
    '<!doctype html><html><body><button id="opener">Open</button></body></html>',
    {
      url: 'http://localhost/',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
    }
  );
  const { window } = dom;
  const keydown = { added: 0, removed: 0 };
  const add = window.document.addEventListener.bind(window.document);
  const remove = window.document.removeEventListener.bind(window.document);
  window.document.addEventListener = (type, ...rest) => {
    if (type === 'keydown') {
      keydown.added++;
    }
    return add(type, ...rest);
  };
  window.document.removeEventListener = (type, ...rest) => {
    if (type === 'keydown') {
      keydown.removed++;
    }
    return remove(type, ...rest);
  };
  window.eval(`${source}\n;window.Modal = Modal;`);
  return { window, keydown };
}

const isOpen = window => Boolean(window.document.querySelector('.modal-overlay.active'));
const press = (window, key) =>
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
const buttonNamed = (window, text) =>
  [...window.document.querySelectorAll('.modal-footer button')].find(b => b.textContent === text);

async function main() {
  const out = {};

  {
    // Opening and closing several dialogs leaves no Escape listener behind.
    const { window, keydown } = freshWindow();
    for (let i = 0; i < 3; i++) {
      const modal = new window.Modal({ title: `Dialog ${i}`, content: 'x' });
      modal.show();
      modal.hide();
    }
    await wait(350);
    out.listeners = {
      ...keydown,
      overlaysLeft: window.document.querySelectorAll('.modal-overlay').length,
    };
  }

  {
    // Escape closes the open dialog, and only while it is open.
    const { window } = freshWindow();
    const modal = new window.Modal({ title: 'T', content: 'x' });
    modal.show();
    const before = isOpen(window);
    press(window, 'Escape');
    const afterEscape = isOpen(window);
    let threw = false;
    try {
      press(window, 'Escape');
      modal.hide();
    } catch {
      threw = true;
    }
    out.escape = { before, afterEscape, threw };
  }

  {
    // onConfirm returning false keeps the dialog open; anything else closes it.
    const { window } = freshWindow();
    let confirms = 0;
    const keep = new window.Modal({
      title: 'Keep',
      content: 'x',
      confirmText: 'Go',
      onConfirm: () => {
        confirms++;
        return false;
      },
    });
    keep.show();
    buttonNamed(window, 'Go').click();
    await wait(350);
    const stayedOpen = isOpen(window);
    keep.hide();
    await wait(350);

    const close = new window.Modal({
      title: 'Close',
      content: 'x',
      confirmText: 'Go',
      onConfirm: () => {},
    });
    close.show();
    buttonNamed(window, 'Go').click();
    await wait(350);
    const closed = !isOpen(window);

    const plain = new window.Modal({ title: 'Plain', content: 'x', confirmText: 'Go' });
    plain.show();
    buttonNamed(window, 'Go').click();
    await wait(350);
    out.confirm = { confirms, stayedOpen, closed, closedWithoutHandler: !isOpen(window) };
  }

  {
    // Focus goes back to the control that opened the dialog.
    const { window } = freshWindow();
    const opener = window.document.getElementById('opener');
    opener.focus();
    const modal = new window.Modal({ title: 'T', content: 'x' });
    modal.show();
    const insideWhileOpen = Boolean(window.document.activeElement.closest('.modal'));
    modal.hide();
    out.focus = { insideWhileOpen, restored: window.document.activeElement === opener };
  }

  {
    // The dialog is named by its title; two dialogs never share an id.
    const { window } = freshWindow();
    const first = new window.Modal({ title: 'First <b>', content: 'x' });
    first.show();
    const overlay = window.document.querySelector('.modal-overlay');
    const labelledby = overlay.getAttribute('aria-labelledby');
    const title = window.document.getElementById(labelledby);
    const named = {
      labelledby: Boolean(labelledby),
      titleText: title && title.textContent,
      escaped: !overlay.querySelector('b'),
    };
    first.hide();
    const second = new window.Modal({ title: 'Second', content: 'x' });
    second.show();
    out.name = { ...named, distinctIds: second.titleId !== first.titleId };
  }

  {
    // Tab wraps inside the dialog.
    const { window } = freshWindow();
    const modal = new window.Modal({ title: 'T', content: 'x', confirmText: 'Go' });
    modal.show();
    const go = buttonNamed(window, 'Go');
    go.focus();
    const event = new window.KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    go.dispatchEvent(event);
    out.tab = {
      prevented: event.defaultPrevented,
      wrappedToFirst: window.document.activeElement.classList.contains('modal-close'),
    };
  }

  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

main();
