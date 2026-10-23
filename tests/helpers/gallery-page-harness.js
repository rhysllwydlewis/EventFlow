'use strict';

/**
 * Runs the real /gallery page (public/gallery.html and gallery-init.js) in jsdom against a scripted
 * API, so a test can drive it like a person: pick files, press Upload, press Delete, open the viewer.
 *
 * jsdom has no <dialog> methods, URL.createObjectURL or upload progress, so the harness supplies
 * small stand-ins for them. Everything else is the page's own code.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'public/gallery.html'), 'utf8');
const script = fs.readFileSync(path.join(ROOT, 'public/assets/js/pages/gallery-init.js'), 'utf8');

/** Lets pending promises and zero-length timers run, as the page awaits several requests. */
const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

/**
 * @param {Object} options
 * @param {string} [options.url] page address, including the query
 * @param {Function} options.api (path, init) => { status, body } for every fetch the page makes
 * @param {Function} [options.upload] (url, headers, formData) => { status, body } for the upload
 */
async function openGalleryPage(options) {
  const dom = new JSDOM(html, {
    url: options.url || 'https://event-flow.co.uk/gallery',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const { document } = window;

  const calls = [];
  const uploads = [];

  window.fetch = async (url, init = {}) => {
    const record = {
      url: String(url),
      method: (init.method || 'GET').toUpperCase(),
      headers: init.headers || {},
      body: init.body,
    };
    calls.push(record);
    const reply = (await options.api(record.url, record)) || { status: 404, body: {} };
    const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {});
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  };

  window.XMLHttpRequest = class FakeXhr {
    constructor() {
      this.upload = { addEventListener: (name, fn) => (this.progress = fn) };
      this.listeners = {};
      this.requestHeaders = {};
    }

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name, value) {
      this.requestHeaders[name] = value;
    }

    addEventListener(name, fn) {
      this.listeners[name] = fn;
    }

    send(body) {
      const record = { url: this.url, method: this.method, headers: this.requestHeaders, body };
      uploads.push(record);
      Promise.resolve().then(async () => {
        if (this.progress) {
          this.progress({ lengthComputable: true, loaded: 1, total: 2 });
        }
        const reply = options.upload
          ? await options.upload(record.url, record.headers, record.body)
          : { status: 200, body: { success: true, uploaded: 1 } };
        if (reply.networkError) {
          this.listeners.error();
          return;
        }
        this.status = reply.status;
        this.responseText =
          typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
        this.listeners.load();
      });
    }
  };

  // <dialog> methods and object URLs, which jsdom does not have.
  window.HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  window.HTMLDialogElement.prototype.close = function close() {
    if (this.hasAttribute('open')) {
      this.removeAttribute('open');
      this.dispatchEvent(new window.Event('close'));
    }
  };
  window.URL.createObjectURL = file => `blob:test/${file.name}`;
  window.URL.revokeObjectURL = () => {};

  window.eval(script);
  await settle();

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const text = id => (document.getElementById(id).textContent || '').replace(/\s+/g, ' ').trim();

  /** Gives the file input a list of files and fires its change event, as picking them would. */
  const pickFiles = async files => {
    const input = document.getElementById('gallery-file-input');
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle();
  };

  const click = async target => {
    (typeof target === 'string' ? $(target) : target).dispatchEvent(
      new window.MouseEvent('click', { bubbles: true })
    );
    await settle();
  };

  const makeFile = (name, type = 'image/jpeg', size = 1000) => {
    const file = new window.File(['x'], name, { type, lastModified: 1 });
    Object.defineProperty(file, 'size', { value: size });
    return file;
  };

  return { window, document, calls, uploads, settle, $, $$, text, pickFiles, click, makeFile };
}

/** The usual signed-in supplier: one profile, two packages, a plan allowing ten photos. */
function supplierApi(overrides = {}) {
  const photos = overrides.photos || [
    { id: 'photo_a', url: '/a.jpg', thumbnail: '/a-t.jpg', approved: true },
    { id: 'photo_b', url: '/b.jpg', thumbnail: '/b-t.jpg', approved: true },
  ];
  return async (url, request) => {
    const { pathname } = new URL(url, 'https://event-flow.co.uk');
    if (overrides.handle) {
      const handled = await overrides.handle(pathname, request);
      if (handled) {
        return handled;
      }
    }
    if (pathname === '/api/csrf-token') {
      return { status: 200, body: { csrfToken: 'token-1' } };
    }
    if (pathname === '/api/v1/auth/me') {
      return { status: 200, body: { user: { id: 'u1', role: 'supplier' } } };
    }
    if (pathname === '/api/me/suppliers') {
      return { status: 200, body: { items: [{ id: 's1', name: 'Romeo Venues' }] } };
    }
    if (pathname === '/api/me/packages') {
      return {
        status: 200,
        body: {
          items: [
            { id: 'p1', name: 'Wedding day' },
            { id: 'p2', name: 'Evening' },
          ],
        },
      };
    }
    if (pathname === '/api/v2/subscriptions/me') {
      return { status: 200, body: { limits: { maxPhotos: 10 } } };
    }
    if (
      /\/api\/me\/(suppliers|packages)\/[^/]+\/photos$/.test(pathname) &&
      request.method === 'GET'
    ) {
      return { status: 200, body: { success: true, photos } };
    }
    return { status: 404, body: { error: 'Not found' } };
  };
}

module.exports = { openGalleryPage, supplierApi, settle };
