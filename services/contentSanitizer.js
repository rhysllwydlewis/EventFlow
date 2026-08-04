/**
 * Content Sanitization Service
 * Sanitizes user-generated content to prevent XSS attacks
 */

'use strict';

let purifier = null;
let purifierInitAttempted = false;

// Configure DOMPurify to allow safe HTML
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'b',
    'i',
    'u',
    'strong',
    'em',
    'p',
    'br',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'code',
    'pre',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel'],
  ALLOW_DATA_ATTR: false,
  KEEP_CONTENT: true,
};

// Strict config for untrusted content (strips all HTML)
const STRICT_CONFIG = {
  ALLOWED_TAGS: [],
  ALLOWED_ATTR: [],
  KEEP_CONTENT: true,
};

/**
 * Remove every `<...>` tag from a string, keeping the text between them.
 *
 * Written as a scan rather than `content.replace(/<[^>]*>/g, '')`: against a
 * run of many unclosed `<` characters, that pattern's `[^>]*` scans forward
 * to the end of the string from every `<` it tries, which is quadratic in the
 * number of `<` characters (CodeQL: "may run slow on strings starting with
 * '<' and with many repetitions of '<'", 184ms measured on 16,000 characters
 * here). `indexOf` only moves forward, so this cannot backtrack.
 * @param {string} content Raw content, potentially attacker-controlled.
 * @returns {string} Content with tags removed.
 */
function stripTags(content) {
  let out = '';
  let index = 0;
  for (;;) {
    const open = content.indexOf('<', index);
    if (open === -1) {
      break;
    }
    out += content.slice(index, open);
    const close = content.indexOf('>', open + 1);
    if (close === -1) {
      // An unterminated tag consumes the rest of the string, matching what
      // `/<[^>]*>/g` would do once it finally reached the end without a `>`.
      index = content.length;
      break;
    }
    index = close + 1;
  }
  return out + content.slice(index);
}

/**
 * Whether the character at `position` is a valid boundary after a bare tag
 * name — whitespace, `/`, `>`, or end of string — so "<script" inside
 * "<scripter>" is not mistaken for a real tag.
 * @param {string} text Text being scanned.
 * @param {number} position Index immediately after the tag name.
 * @returns {boolean} True when this is a genuine tag start.
 */
function isTagBoundary(text, position) {
  if (position >= text.length) {
    return true;
  }
  const ch = text.charAt(position);
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '/' || ch === '>';
}

/**
 * Remove `<script>…</script>` and `<style>…</style>` blocks, including their
 * content, case-insensitively and tolerant of whitespace around the tag name.
 *
 * This was a single regular expression, `<\s*script[^>]*>[\s\S]*?<\/\s*script\s*>`.
 * Its lazy `[\s\S]*?` re-scans from every `<script` it finds looking for a
 * closing tag, so on a run of unclosed "<script" repetitions the cost is
 * quadratic — 89ms measured on 4,000 repetitions here. An intermediate
 * version of this fix still called a regex per iteration on a shrinking
 * slice, which measured fine on complete blocks but took 9.8 seconds on
 * 40,000 unclosed "<script" repetitions, because the regex engine itself
 * tries matching from every position when no closing '>' ever appears. This
 * version uses only `indexOf`, which can only move forward, so no input
 * shape can make it re-scan the same ground twice.
 * @param {string} content Raw content, potentially attacker-controlled.
 * @param {string} tagName Either "script" or "style".
 * @returns {string} Content with the named tag's blocks removed.
 */
function stripTagBlocks(content, tagName) {
  const lower = content.toLowerCase();
  const openToken = `<${tagName}`;
  const closeToken = `</${tagName}`;
  let out = '';
  let index = 0;

  for (;;) {
    const openStart = lower.indexOf(openToken, index);
    if (openStart === -1) {
      break;
    }
    if (!isTagBoundary(lower, openStart + openToken.length)) {
      // Not a real tag ("<scripter"): keep scanning past this occurrence.
      out += content.slice(index, openStart + openToken.length);
      index = openStart + openToken.length;
      continue;
    }

    const openTagEnd = lower.indexOf('>', openStart + openToken.length);
    if (openTagEnd === -1) {
      // An opening tag that is never closed with '>' consumes the rest of
      // the string — an unterminated <script is never safe to keep.
      index = content.length;
      break;
    }

    out += content.slice(index, openStart);
    const closeStart = lower.indexOf(closeToken, openTagEnd + 1);
    if (closeStart === -1) {
      index = content.length;
      break;
    }
    const closeEnd = lower.indexOf('>', closeStart);
    index = closeEnd === -1 ? content.length : closeEnd + 1;
  }

  return out + content.slice(index);
}

function basicSanitize(content, strict = false) {
  if (!content || typeof content !== 'string') {
    return '';
  }

  if (strict) {
    return stripTags(content);
  }

  // Conservative fallback if DOMPurify is unavailable in current runtime:
  // remove script/style tags and event handler attributes.
  return stripTagBlocks(stripTagBlocks(content, 'script'), 'style')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/javascript:/gi, '');
}

function getPurifier() {
  if (purifier || purifierInitAttempted) {
    return purifier;
  }

  purifierInitAttempted = true;

  try {
    const { JSDOM } = require('jsdom');
    const createDOMPurify = require('dompurify');
    const window = new JSDOM('').window;
    purifier = createDOMPurify(window);
  } catch (error) {
    purifier = null;
  }

  return purifier;
}

/**
 * Sanitize HTML content
 * @param {string} content - Raw HTML content
 * @param {boolean} strict - Use strict mode (no HTML allowed)
 * @returns {string} Sanitized content
 */
function sanitizeContent(content, strict = false) {
  if (!content || typeof content !== 'string') {
    return '';
  }

  const config = strict ? STRICT_CONFIG : SANITIZE_CONFIG;
  const safePurifier = getPurifier();

  if (!safePurifier) {
    return basicSanitize(content, strict);
  }

  return safePurifier.sanitize(content, config);
}

/**
 * Sanitize message object
 * Sanitizes all text fields in a message
 * @param {Object} message - Message object
 * @param {boolean} strict - Use strict mode
 * @returns {Object} Sanitized message
 */
function sanitizeMessage(message, strict = false) {
  if (!message || typeof message !== 'object') {
    return message;
  }

  const sanitized = { ...message };

  // Sanitize content field
  if (sanitized.content) {
    sanitized.content = sanitizeContent(sanitized.content, strict);
  }

  // Sanitize attachment filenames
  if (Array.isArray(sanitized.attachments)) {
    sanitized.attachments = sanitized.attachments.map(attachment => ({
      ...attachment,
      filename: sanitizeContent(attachment.filename || '', true),
    }));
  }

  // Sanitize metadata
  if (sanitized.metadata && typeof sanitized.metadata === 'object') {
    if (sanitized.metadata.subject) {
      sanitized.metadata.subject = sanitizeContent(sanitized.metadata.subject, true);
    }
  }

  return sanitized;
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };

  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Strip all HTML tags
 * @param {string} html - HTML content
 * @returns {string} Plain text
 */
function stripHtml(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }

  return sanitizeContent(html, true);
}

module.exports = {
  sanitizeContent,
  sanitizeMessage,
  escapeHtml,
  stripHtml,
  SANITIZE_CONFIG,
  STRICT_CONFIG,
};
