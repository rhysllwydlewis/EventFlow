/**
 * @jest-environment node
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createClassList(element) {
  const values = new Set();
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    remove: (...names) => names.forEach(name => values.delete(name)),
    contains: name => values.has(name),
    toString: () => [...values].join(' '),
    sync: () => {
      values.clear();
      String(element.className || '')
        .split(/\s+/)
        .filter(Boolean)
        .forEach(name => values.add(name));
    },
  };
}

function createFixture() {
  const ids = new Map();
  const documentListeners = new Map();
  const document = {
    readyState: 'loading',
    activeElement: null,
    createElement(tagName) {
      const listeners = new Map();
      const element = {
        tagName: String(tagName).toUpperCase(),
        children: [],
        parentNode: null,
        attributes: {},
        dataset: {},
        style: {},
        className: '',
        hidden: false,
        disabled: false,
        textContent: '',
        classList: null,
        setAttribute(name, value) {
          this.attributes[name] = String(value);
          if (name === 'id') {
            ids.set(String(value), this);
          }
        },
        getAttribute(name) {
          return Object.prototype.hasOwnProperty.call(this.attributes, name)
            ? this.attributes[name]
            : null;
        },
        removeAttribute(name) {
          delete this.attributes[name];
        },
        append(...nodes) {
          nodes.forEach(node => this.appendChild(node));
        },
        appendChild(node) {
          node.parentNode = this;
          this.children.push(node);
          return node;
        },
        remove() {
          if (!this.parentNode) {
            return;
          }
          this.parentNode.children = this.parentNode.children.filter(child => child !== this);
          this.parentNode = null;
        },
        addEventListener(type, listener) {
          const current = listeners.get(type) || [];
          current.push(listener);
          listeners.set(type, current);
        },
        dispatchEvent(event) {
          event.target = event.target || this;
          event.currentTarget = this;
          event.preventDefault = event.preventDefault || (() => {});
          (listeners.get(event.type) || []).forEach(listener => listener(event));
        },
        focus() {
          document.activeElement = this;
        },
        closest(selector) {
          if (
            selector === '.hero-avatar' &&
            (this.parentNode?.classList?.contains('hero-avatar') ||
              String(this.parentNode?.className || '')
                .split(/\s+/)
                .includes('hero-avatar'))
          ) {
            return this.parentNode;
          }
          return this.parentNode?.closest?.(selector) || null;
        },
        querySelector(selector) {
          const className = selector.startsWith('.') ? selector.slice(1) : null;
          const match = node =>
            (className &&
              (node.classList?.contains(className) ||
                String(node.className || '')
                  .split(/\s+/)
                  .includes(className))) ||
            (selector.startsWith('#') && node.getAttribute?.('id') === selector.slice(1)) ||
            (!selector.startsWith('.') &&
              !selector.startsWith('#') &&
              node.tagName === selector.toUpperCase());
          const queue = [...this.children];
          while (queue.length > 0) {
            const node = queue.shift();
            if (match(node)) {
              return node;
            }
            queue.push(...(node.children || []));
          }
          return null;
        },
      };
      element.classList = createClassList(element);
      Object.defineProperty(element, 'id', {
        get: () => element.getAttribute('id') || '',
        set: value => {
          element.setAttribute('id', value);
        },
      });
      Object.defineProperty(element, 'src', {
        get: () => element.getAttribute('src') || '',
        set: value => {
          element.setAttribute('src', value);
        },
      });
      return element;
    },
    getElementById(id) {
      return ids.get(id) || null;
    },
    addEventListener(type, listener) {
      const current = documentListeners.get(type) || [];
      current.push(listener);
      documentListeners.set(type, current);
    },
    removeEventListener(type, listener) {
      documentListeners.set(
        type,
        (documentListeners.get(type) || []).filter(item => item !== listener)
      );
    },
    dispatchEvent(event) {
      event.preventDefault = event.preventDefault || (() => {});
      (documentListeners.get(event.type) || []).forEach(listener => listener(event));
    },
  };
  document.head = document.createElement('head');
  document.body = document.createElement('body');
  document.body.style.overflow = '';
  const avatar = document.createElement('div');
  avatar.id = 'hero-avatar';
  avatar.className = 'hero-avatar';
  avatar.classList.sync();
  const image = document.createElement('img');
  image.id = 'hero-avatar-img';
  const initials = document.createElement('span');
  initials.id = 'hero-avatar-initials';
  initials.textContent = 'ES';
  avatar.append(image, initials);
  document.body.appendChild(avatar);
  const window = {
    location: { search: '?id=sup_1' },
    __supplierData: { id: 'sup_1', name: 'Example Supplier' },
    addEventListener: () => {},
  };
  return { document, window, avatar, image, initials };
}

function loadClient(fixture) {
  const code = fs.readFileSync(
    path.join(__dirname, '../../public/assets/js/public-supplier-avatar.js'),
    'utf8'
  );
  const sandbox = {
    window: fixture.window,
    document: fixture.document,
    URLSearchParams,
    fetch: jest.fn(),
    module: { exports: {} },
  };
  vm.runInNewContext(code, sandbox);
  return sandbox.module.exports;
}

describe('supplier profile photo lightbox', () => {
  test('opens the loaded avatar on click and closes with Escape', () => {
    const fixture = createFixture();
    const client = loadClient(fixture);
    client.showAvatarImage(fixture.image, fixture.initials, '/uploads/example.jpg');

    expect(fixture.avatar.getAttribute('role')).toBe('button');
    expect(fixture.avatar.getAttribute('tabindex')).toBe('0');
    expect(fixture.avatar.getAttribute('aria-label')).toContain('Example Supplier');

    fixture.avatar.dispatchEvent({ type: 'click' });
    const dialog = fixture.document.body.querySelector('.sp-avatar-lightbox');
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.querySelector('img').getAttribute('src')).toBe('/uploads/example.jpg');
    expect(fixture.document.body.style.overflow).toBe('hidden');

    fixture.document.dispatchEvent({ type: 'keydown', key: 'Escape' });
    expect(fixture.document.body.querySelector('.sp-avatar-lightbox')).toBeNull();
    expect(fixture.document.body.style.overflow).toBe('');
    expect(fixture.document.activeElement).toBe(fixture.avatar);
  });

  test('supports keyboard activation and disables enlargement for placeholders', () => {
    const fixture = createFixture();
    const client = loadClient(fixture);
    client.showAvatarImage(fixture.image, fixture.initials, '/uploads/example.jpg');
    fixture.avatar.dispatchEvent({ type: 'keydown', key: 'Enter' });
    expect(fixture.document.body.querySelector('.sp-avatar-lightbox')).not.toBeNull();
    client.closeAvatarLightbox();

    client.setPlaceholder(fixture.image, fixture.initials, 'ES');
    expect(fixture.avatar.getAttribute('role')).toBeNull();
    expect(fixture.avatar.getAttribute('tabindex')).toBeNull();
    fixture.avatar.dispatchEvent({ type: 'click' });
    expect(fixture.document.body.querySelector('.sp-avatar-lightbox')).toBeNull();
  });
});
