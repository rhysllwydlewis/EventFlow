'use strict';

/**
 * Serve the site's own stylesheets minified.
 *
 * The CSS under public/assets is hand-written and heavily commented, about 2.6 MB
 * across 111 files, and a page loads 20-30 of them before it can paint. Minified
 * it is about a third smaller on the wire (Brotli: 530 -> 351 KiB across the
 * site, about 50 KiB less on the homepage). About 85% of that is the comments,
 * which compress poorly (removing only them gives 530 -> 378 KiB); the rest is
 * whitespace, which also takes 17% off the raw CSS the browser has to parse.
 *
 * This repo has no build step, so the minifying is done on the way out and cached
 * in memory, keyed by the file's mtime and size. There are no generated files to
 * commit or to drift out of step with their sources, an edited stylesheet is
 * picked up on the next request, and every URL (including its `?v=`) stays the
 * same, so no HTML changes.
 *
 * The rule that makes it safe to apply sitewide: **only comments and whitespace
 * change**. It re-prints what PostCSS parsed, so selectors, properties, values,
 * order and `!important` are exactly what is in the source. Deliberately not done,
 * though a general-purpose minifier would: colour shortening, `0%` -> `0`,
 * merging or sorting rules and selectors, dropping declarations it thinks are
 * invalid. Those save almost nothing over Brotli and are where a rewrite that is
 * right on one page can be wrong on another.
 *
 *  - `/*! ... *\/` licence comments are kept; every other comment goes.
 *  - Whitespace outside quoted strings collapses to one space and is dropped
 *    around commas. Strings, and the value of a `--custom-property` (which
 *    JavaScript can read back verbatim), are left alone.
 *  - IE hack prefixes (`*zoom`, `_height`) are kept.
 *  - A file PostCSS cannot parse, or output that is not smaller, is served exactly
 *    as it is on disk, and only /assets/**.css is touched (not vendor/ or *.min.css).
 *
 * Set EF_MINIFY_CSS=false to switch it off without a code change.
 */

const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const logger = require('../utils/logger');

const MAX_ENTRIES = 400;

// Text whose whitespace must be left exactly as it is: a double- or single-quoted
// string (with escapes), or a CSS escape. An escape is a backslash followed by up
// to six hex digits and ONE optional whitespace character that terminates it
// (`\31 0` is "10"), or by any single character (`\,` is a literal comma, `\ ` a
// literal space). Collapsing or trimming around either would change what the
// selector or value means, so they are matched first and passed through untouched.
const STRING = '"(?:\\\\[\\s\\S]|[^"\\\\])*"|\'(?:\\\\[\\s\\S]|[^\'\\\\])*\'';
const ESCAPE = '\\\\(?:[0-9a-fA-F]{1,6}\\s?|[\\s\\S])';
const COLLAPSE = new RegExp(`(${STRING}|${ESCAPE})|\\s+`, 'g');
const AROUND_COMMA = new RegExp(`(${STRING}|${ESCAPE})|\\s*,\\s*`, 'g');

/**
 * Collapse whitespace outside strings and escapes to one space, and drop it around
 * commas.
 * @param {string} text Selector, value or at-rule parameters.
 * @returns {string} Tightened text.
 */
function tighten(text) {
  return text
    .replace(COLLAPSE, (match, string) => (string === undefined ? ' ' : string))
    .trim()
    .replace(AROUND_COMMA, (match, string) => (string === undefined ? ',' : string));
}

/**
 * Minify a stylesheet by removing comments and whitespace only, or return null
 * when it should be served unchanged.
 * @param {string} source CSS source.
 * @returns {{css: string|null, reason: string|null}} The minified CSS, or null
 *   with the reason it was not used.
 */
function minifyCss(source) {
  try {
    const root = postcss.parse(source);

    // Keep `/*! ... */` licence comments only. PostCSS trims a comment's text, so
    // `/* !important ... */` also starts with "!"; `raws.left` tells them apart.
    root.walkComments(comment => {
      if (!(comment.text.startsWith('!') && comment.raws.left === '')) {
        comment.remove();
      }
    });

    root.walk(node => {
      if (node.type === 'comment') {
        node.raws.before = '\n';
        return;
      }
      // For a declaration `before` also carries an IE hack prefix (`*zoom`,
      // `_height`); drop the whitespace only.
      node.raws.before = (node.raws.before || '').replace(/\s+/g, '');
      node.raws.after = '';
      if (node.nodes) {
        node.raws.semicolon = false;
      }
      if (node.type === 'rule') {
        node.selector = tighten(node.selector);
        delete node.raws.selector;
        node.raws.between = '';
      } else if (node.type === 'atrule') {
        node.params = tighten(node.params);
        delete node.raws.params;
        node.raws.afterName = node.params ? ' ' : '';
        node.raws.between = '';
      } else if (node.type === 'decl') {
        node.raws.between = ':';
        if (node.important) {
          node.raws.important = '!important';
        }
        // A custom property's value is readable from script exactly as written.
        if (!node.prop.startsWith('--')) {
          node.value = tighten(node.value);
          delete node.raws.value;
        }
      }
    });
    root.raws.after = '';

    const css = root.toString();
    if (!css || css.length >= source.length) {
      return { css: null, reason: 'not smaller' };
    }
    return { css, reason: null };
  } catch (error) {
    return { css: null, reason: `exception: ${error.message}` };
  }
}

/**
 * Percent-decode a request path.
 * @param {string} urlPath Request path.
 * @returns {string|null} The decoded path, or null if it is malformed.
 */
function safeDecode(urlPath) {
  try {
    return decodeURIComponent(urlPath);
  } catch {
    return null;
  }
}

/**
 * Map a request path to a stylesheet inside `base`, or null if it is not one we
 * minify (not CSS, vendor/minified already, or outside the directory).
 * @param {string} base Absolute public directory.
 * @param {string} urlPath Request path.
 * @returns {string|null} Absolute file path.
 */
function resolveCssFile(base, urlPath) {
  const relative = safeDecode(urlPath);
  if (
    relative === null ||
    relative.includes('\0') ||
    relative.includes('\\') ||
    !/^\/assets\/.+\.css$/i.test(relative) ||
    /\.min\.css$/i.test(relative)
  ) {
    return null;
  }
  const segments = relative.split('/');
  if (segments.includes('..') || segments.includes('.') || segments.includes('vendor')) {
    return null;
  }
  const file = path.join(base, relative);
  return file.startsWith(base + path.sep) ? file : null;
}

/**
 * Express middleware serving minified stylesheets from `root`.
 * @param {{root: string, enabled?: boolean}} options Public directory, and
 *   whether to minify at all (default: unless EF_MINIFY_CSS=false).
 * @returns {Function} Express middleware; the returned function also carries a
 *   `resetCache()` for tests.
 */
function createCssMinifyMiddleware({ root, enabled } = {}) {
  const base = path.resolve(root);
  const active = enabled === undefined ? process.env.EF_MINIFY_CSS !== 'false' : enabled;
  // file -> { mtimeMs, size, css }. `css: null` means "serve the file as it is",
  // remembered so a stylesheet that cannot be minified is not retried per request.
  const cache = new Map();
  const inflight = new Map();

  const remember = (file, entry) => {
    cache.delete(file);
    cache.set(file, entry);
    if (cache.size > MAX_ENTRIES) {
      cache.delete(cache.keys().next().value);
    }
  };

  // Resolves to the minified CSS, or null when the file should be served as it is.
  const load = (file, stat) => {
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
      remember(file, hit);
      return Promise.resolve(hit.css);
    }
    const key = `${file}:${stat.mtimeMs}:${stat.size}`;
    if (!inflight.has(key)) {
      inflight.set(
        key,
        (async () => {
          const source = await fs.promises.readFile(file, 'utf8');
          const { css, reason } = minifyCss(source);
          if (reason) {
            logger.warn('CSS served unminified', { file: path.relative(base, file), reason });
          }
          remember(file, { mtimeMs: stat.mtimeMs, size: stat.size, css });
          return css;
        })().finally(() => inflight.delete(key))
      );
    }
    return inflight.get(key);
  };

  const middleware = async function cssMinify(req, res, next) {
    if (!active || (req.method !== 'GET' && req.method !== 'HEAD')) {
      return next();
    }
    const file = resolveCssFile(base, req.path);
    if (!file) {
      return next();
    }

    let stat = null;
    let css = null;
    try {
      stat = await fs.promises.stat(file);
      css = stat.isFile() ? await load(file, stat) : null;
    } catch {
      // Missing file, or a read error (not remembered, so a later request retries):
      // let express.static answer, which is a 404 or the file as it is.
      css = null;
    }
    if (css === null) {
      return next();
    }

    try {
      res.set('Last-Modified', stat.mtime.toUTCString());
      res.type('text/css');
      return res.send(css);
    } catch (error) {
      // Express 4 does not route a rejection from an async handler anywhere, which
      // would leave the request hanging; hand it to the error handler instead.
      return next(error);
    }
  };
  middleware.resetCache = () => {
    cache.clear();
    inflight.clear();
  };
  return middleware;
}

module.exports = { createCssMinifyMiddleware, minifyCss, resolveCssFile, tighten };
