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

// Dangerous URL schemes the fallback strips wherever they appear. CodeQL
// flagged the previous version, which only handled "javascript:", as an
// "incomplete URL scheme check" — data: and vbscript: URLs execute content
// just as readily and were untouched.
const DANGEROUS_SCHEMES_LOWER = ['javascript:', 'data:', 'vbscript:'];

/**
 * Remove every occurrence of any string in `targetsLower` from `text`,
 * cascading: if deleting one occurrence causes the characters now adjacent to
 * spell out another occurrence, that is removed too.
 *
 * This is what `.replace(/javascript:/gi, '')` does not do. A single
 * `String.replace` pass scans left to right once and never re-examines text
 * it has already emitted, so `"java" + "javascript:" + "script:"` has its one
 * matched span cut out and the untouched neighbours — "java" and "script:" —
 * are left touching, spelling "javascript:" again. CodeQL's "incomplete
 * multi-character sanitization" query is exactly this class of bug. Verified
 * directly: the old code turned that adversarial input back into
 * "javascript:", unremoved.
 *
 * The fix builds the output one character at a time and re-checks the tail
 * of what has been emitted so far after every append, so a newly-formed
 * match is caught immediately rather than surviving because the scan had
 * already moved past it. Cost is O(text length × number of targets ×
 * longest target), which for three ~11-character literals is linear in
 * practice.
 * @param {string} text Source text, potentially attacker-controlled.
 * @param {string[]} targetsLower Lower-cased substrings to remove.
 * @returns {string} Text with every occurrence, including cascaded ones, removed.
 */
function removeSubstringsCascading(text, targetsLower) {
  const out = [];
  for (let index = 0; index < text.length; index += 1) {
    out.push(text.charAt(index));
    let shrunk = true;
    while (shrunk) {
      shrunk = false;
      for (const target of targetsLower) {
        if (out.length < target.length) {
          continue;
        }
        const tail = out
          .slice(out.length - target.length)
          .join('')
          .toLowerCase();
        if (tail === target) {
          out.length -= target.length;
          shrunk = true;
          break;
        }
      }
    }
  }
  return out.join('');
}

/**
 * Whether the character at `position` could continue an unquoted HTML
 * attribute value (anything but whitespace or the tag's closing '>').
 * @param {string} text Text being scanned.
 * @param {number} position Index to test.
 * @returns {boolean} True when the character extends an unquoted value.
 */
function isUnquotedAttributeValueChar(text, position) {
  if (position >= text.length) {
    return false;
  }
  const ch = text.charAt(position);
  return ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r' && ch !== '>';
}

/**
 * Remove every inline event-handler attribute (onclick=, onerror=, ...) from
 * a block of HTML in one linear pass.
 *
 * This replaces `/\son\w+\s*=\s*(['"]).*?\1/gi`, which CodeQL flagged twice:
 * as a polynomial regex (measured: 20+ seconds on strings starting with
 * 'on0=' and many repetitions of it — the lazy `.*?` bound to a backreference
 * backtracks badly when the closing quote it is hunting for never arrives),
 * and separately as incomplete multi-character sanitization, the same
 * cascading-bypass class as the scheme check above (`.replace` with `/g`
 * still only does one left-to-right pass; deleting one match can leave
 * neighbours that spell out a new one).
 *
 * This scan finds each whitespace-preceded `on<name>=<value>` unit with
 * `indexOf`/character checks — never backtracking — and removes the whole
 * unit, name and value together, as a single splice. Because every removal
 * consumes a complete, self-contained attribute (there is never a partial
 * removal that could leave a fragment to rejoin with its neighbour into a
 * new match), a second pass over the result can only find event-handler
 * attributes that were not adjacent to the first pass's removals — so this
 * is run to a fixed point (bounded to a handful of iterations) rather than
 * once, closing the cascading class definitively rather than by argument.
 * @param {string} html HTML text, potentially attacker-controlled.
 * @returns {string} HTML with every event-handler attribute removed.
 */
function stripEventHandlerAttributesOnce(html) {
  const lower = html.toLowerCase();
  let out = '';
  let index = 0;

  while (index < html.length) {
    const onIndex = lower.indexOf('on', index);
    if (onIndex === -1) {
      out += html.slice(index);
      break;
    }
    const precededByWhitespace = onIndex > 0 && /\s/.test(html.charAt(onIndex - 1));
    if (!precededByWhitespace) {
      out += html.slice(index, onIndex + 2);
      index = onIndex + 2;
      continue;
    }

    let nameEnd = onIndex + 2;
    while (nameEnd < html.length && /[a-z0-9_-]/i.test(html.charAt(nameEnd))) {
      nameEnd += 1;
    }
    let eqIndex = nameEnd;
    while (eqIndex < html.length && /\s/.test(html.charAt(eqIndex))) {
      eqIndex += 1;
    }
    if (html.charAt(eqIndex) !== '=') {
      // "on" followed by letters but no assignment (e.g. the word "onward"
      // as ordinary text): not an attribute, leave it untouched.
      out += html.slice(index, nameEnd);
      index = nameEnd;
      continue;
    }

    let valueStart = eqIndex + 1;
    while (valueStart < html.length && /\s/.test(html.charAt(valueStart))) {
      valueStart += 1;
    }
    const quote = html.charAt(valueStart);
    let valueEnd;
    if (quote === '"' || quote === "'") {
      const closeQuote = html.indexOf(quote, valueStart + 1);
      valueEnd = closeQuote === -1 ? html.length : closeQuote + 1;
    } else {
      valueEnd = valueStart;
      while (isUnquotedAttributeValueChar(html, valueEnd)) {
        valueEnd += 1;
      }
    }

    // Drop the whitespace immediately before "on" (matching the original
    // regex's single leading \s) through the end of the attribute's value.
    out += html.slice(index, onIndex - 1);
    index = valueEnd;
  }

  return out;
}

/**
 * Run {@link stripEventHandlerAttributesOnce} to a fixed point.
 * @param {string} html HTML text, potentially attacker-controlled.
 * @returns {string} HTML with every event-handler attribute removed,
 *   including any exposed by a previous pass's removals.
 */
function stripEventHandlerAttributes(html) {
  let current = html;
  for (let pass = 0; pass < 5; pass += 1) {
    const next = stripEventHandlerAttributesOnce(current);
    if (next === current) {
      return next;
    }
    current = next;
  }
  return current;
}

function basicSanitize(content, strict = false) {
  if (!content || typeof content !== 'string') {
    return '';
  }

  if (strict) {
    return stripTags(content);
  }

  // Conservative fallback if DOMPurify is unavailable in current runtime:
  // remove script/style tags, event handler attributes and dangerous URL
  // schemes.
  const withoutScripts = stripTagBlocks(stripTagBlocks(content, 'script'), 'style');
  const withoutHandlers = stripEventHandlerAttributes(withoutScripts);
  return removeSubstringsCascading(withoutHandlers, DANGEROUS_SCHEMES_LOWER);
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
