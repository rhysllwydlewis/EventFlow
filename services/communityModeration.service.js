/**
 * EventFlow Community — moderation and anti-spam engine
 *
 * The functions here are deliberately pure and synchronous wherever possible so
 * the rules can be unit tested without a database. The route layer supplies the
 * account facts (age, verification, standing, recent posts) and this module
 * decides what happens to a piece of content.
 *
 * The design targets the specific failure mode observed on comparable UK
 * wedding forums: dormant threads revived years later by low-trust accounts
 * posting promotional links. See
 * docs/research/eventflow-community-hitched-audit.md.
 */

'use strict';

const { sanitizeContent, stripHtml } = require('./contentSanitizer');
const {
  TRUST_TIERS,
  TRUST_POLICY,
  CONTENT_STATES,
  FRESHNESS,
  LIMITS,
} = require('../models/CommunityContent');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Tokens that are unambiguous anywhere in a hostname. Spam domains routinely
 * bury the keyword mid-label (`bigcasino777.com`, `mega-casino.net`), so
 * anchoring these to a label boundary would miss most real cases, and none of
 * them plausibly appear in a legitimate event-supplier domain.
 */
const HIGH_RISK_DOMAIN_TOKENS = Object.freeze([
  'casino',
  'poker',
  'roulette',
  'blackjack',
  'sportsbook',
  'betting',
  'gambl',
  'porn',
  'escort',
  'camgirl',
  'onlyfans',
  'warez',
  'keygen',
  'nulled',
  'torrent',
  'kratom',
]);

/**
 * Tokens that are only meaningful at a label boundary, because they otherwise
 * appear inside ordinary words — `bet` in `betterevents.com`, `crack` in
 * `crackerbarrel.com`, `slot` in `slotting.com`.
 */
const HIGH_RISK_DOMAIN_PATTERNS = Object.freeze([
  /(^|[.-])bet\d*[.-]/i,
  /(^|[.-])bet\d*\.(com|net|org|co|io|uk)$/i,
  /(^|[.-])slots?[.-]/i,
  /(^|[.-])xxx[.-]?/i,
  /(^|[.-])crack(ed)?[.-]/i,
  /(^|[.-])apk-?downloads?[.-]?/i,
  /(^|[.-])(vape|ecig)[.-]?/i,
  /\.(zip|review|country|gq|cf|tk|ml)$/i,
]);

/**
 * Phrases typical of drive-by promotion rather than genuine advice. A single hit
 * is not enough to block anything; the score is combined with link count,
 * account trust and thread age before any decision is taken.
 */
const PROMOTIONAL_PATTERNS = Object.freeze([
  /\bbuy\s+now\b/i,
  /\bclick\s+here\b/i,
  /\blimited\s+time\s+offer\b/i,
  /\b(best|cheapest)\s+price\s+guaranteed\b/i,
  // Each optional group carries its own leading whitespace and requires a
  // literal, so no two whitespace quantifiers are ever adjacent. Written as
  // `\s*(me|us)?\s*(on|at)?\s*` this ran for 20 seconds on 4,000 spaces — the
  // engine partitioned the run between three quantifiers, and a body of
  // "whatsapp" plus whitespace would have hung the event loop outright.
  /\bwhatsapp\b(?:\s*(?:me|us)\b)?(?:\s*(?:on|at)\b)?\s*\+?\d/i,
  /\btelegram\s*[:@]/i,
  /\bdm\s+me\s+for\s+(price|details|info)/i,
  /\b(guaranteed|instant)\s+(win|profit|returns?)\b/i,
  /\b(seo|backlink|traffic)\s+(services?|packages?)\b/i,
  /\bearn\s+\p{Sc}?\d+\s*(per|a)\s*(day|week|month)\b/iu,
  /\bcontact\s+us\s+on\s+\+?\d[\d\s-]{7,}/i,
]);

const UNSAFE_URL_SCHEMES = Object.freeze([
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'blob:',
  'about:',
]);

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')]+/gi;
// Bare domains are found by tokenising rather than by one large expression.
// A pattern of the shape /(?:label\.)+tld/ nests a quantifier inside a
// quantifier, so a body such as "a.a.a.a…" thousands of labels long forces
// catastrophic backtracking. This runs on every submitted post, where the body
// is attacker-controlled and up to LIMITS.bodyMax characters, so the scan is
// kept strictly linear: split on characters that cannot occur in a hostname,
// then validate each candidate label by label.
const NON_HOST_CHARACTERS = /[^a-z0-9.-]+/i;
const MAX_LABEL_LENGTH = 63;

/**
 * Whether a single dot-separated segment is a legal hostname label.
 * @param {string} label Candidate label, already lower-cased.
 * @returns {boolean} True when the label could appear in a hostname.
 */
function isHostLabel(label) {
  if (!label || label.length > MAX_LABEL_LENGTH) {
    return false;
  }
  if (label.startsWith('-') || label.endsWith('-')) {
    return false;
  }
  for (let index = 0; index < label.length; index += 1) {
    const code = label.charCodeAt(index);
    const isDigit = code >= 48 && code <= 57;
    const isLetter = code >= 97 && code <= 122;
    const isHyphen = code === 45;
    if (!isDigit && !isLetter && !isHyphen) {
      return false;
    }
  }
  return true;
}

/**
 * Trim leading and trailing `.` and `-` characters from a string.
 *
 * CodeQL flags `.replace(/^[.-]+/, '').replace(/[.-]+$/, '')` as a possible
 * polynomial regular expression on strings with many repetitions of '-'.
 * Measured directly in this runtime it is linear — 8ms at 5,000,000
 * characters — so the alert does not describe an exploitable behaviour here.
 * It is rewritten anyway: a direct character scan carries no ambiguity for a
 * static analyser to flag, needs no re-verification if the engine ever
 * changes, and costs nothing extra to write.
 * @param {string} value Candidate token, already lower-cased.
 * @returns {string} Value with leading/trailing '.' and '-' removed.
 */
function trimDotsAndHyphens(value) {
  let start = 0;
  let end = value.length;
  while (start < end && (value.charAt(start) === '.' || value.charAt(start) === '-')) {
    start += 1;
  }
  while (end > start && (value.charAt(end - 1) === '.' || value.charAt(end - 1) === '-')) {
    end -= 1;
  }
  return value.slice(start, end);
}

/**
 * Find bare domains (hosts typed without a scheme) in a block of text.
 * @param {string} text Raw or sanitised content.
 * @returns {string[]} Lower-cased hostnames in order of appearance.
 */
function extractBareDomains(text) {
  const matches = [];
  String(text || '')
    .toLowerCase()
    .split(NON_HOST_CHARACTERS)
    .forEach(rawToken => {
      const token = trimDotsAndHyphens(rawToken);
      if (!token.includes('.')) {
        return;
      }
      const labels = token.split('.');
      if (labels.length < 2 || !labels.every(isHostLabel)) {
        return;
      }
      const tld = labels[labels.length - 1];
      if (tld.length < 2 || /[^a-z]/.test(tld)) {
        return;
      }
      matches.push(token);
    });
  return matches;
}

// ─── Link handling ───────────────────────────────────────────────────────────

/**
 * Extract every http(s) URL from a block of text or HTML.
 * @param {string} text Raw or sanitised content.
 * @returns {string[]} URLs in order of appearance, duplicates preserved.
 */
function extractUrls(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  return text.match(URL_PATTERN) || [];
}

/**
 * Extract the hostname of a URL, lower-cased and without a leading `www.`.
 * @param {string} url Candidate URL.
 * @returns {string} Hostname, or an empty string when the URL cannot be parsed.
 */
function domainOf(url) {
  try {
    const parsed = new URL(String(url).trim());
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

/**
 * Whether a URL uses a scheme we are willing to render.
 * @param {string} url Candidate URL.
 * @returns {boolean} True for http and https only.
 */
function isSafeUrl(url) {
  const value = String(url || '')
    .trim()
    .toLowerCase();
  if (UNSAFE_URL_SCHEMES.some(scheme => value.startsWith(scheme))) {
    return false;
  }
  return /^https?:\/\//.test(value);
}

/**
 * Decide whether a domain is blocked, using both the built-in high-risk
 * patterns and the operator-managed blocklist.
 * @param {string} domain Hostname to test.
 * @param {Object} settings Community settings containing allow/block lists.
 * @returns {boolean} True when the domain must not be linked.
 */
function isBlockedDomain(domain, settings = {}) {
  const host = String(domain || '').toLowerCase();
  if (!host) {
    return false;
  }

  const allowed = Array.isArray(settings.allowedDomains) ? settings.allowedDomains : [];
  if (allowed.some(entry => matchesDomain(host, entry))) {
    return false;
  }

  const blocked = Array.isArray(settings.blockedDomains) ? settings.blockedDomains : [];
  if (blocked.some(entry => matchesDomain(host, entry))) {
    return true;
  }

  if (HIGH_RISK_DOMAIN_TOKENS.some(token => host.includes(token))) {
    return true;
  }

  return HIGH_RISK_DOMAIN_PATTERNS.some(pattern => pattern.test(host));
}

/**
 * Match a hostname against a configured domain entry, allowing subdomains.
 * @param {string} host Hostname under test.
 * @param {string} entry Configured domain.
 * @returns {boolean} True when host is the entry or a subdomain of it.
 */
function matchesDomain(host, entry) {
  const target = String(entry || '')
    .toLowerCase()
    .replace(/^www\./, '')
    .trim();
  if (!target) {
    return false;
  }
  return host === target || host.endsWith(`.${target}`);
}

/**
 * Rewrite anchors in sanitised HTML so external links can never be used to pass
 * ranking signal, open a tab with window access, or leak a referrer. Links from
 * accounts without link privileges are downgraded to plain text.
 * @param {string} html Sanitised HTML body.
 * @param {Object} options Behaviour switches.
 * @param {boolean} options.clickable Whether external links stay clickable.
 * @param {Object} options.settings Community settings for domain lists.
 * @returns {string} HTML with safe anchors.
 */
function rewriteAnchor(attrs, inner, clickable, settings) {
  const hrefMatch = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
  const href = hrefMatch ? hrefMatch[2] || hrefMatch[3] || '' : '';
  const text = inner || href;

  if (!isSafeUrl(href)) {
    return text;
  }

  const domain = domainOf(href);
  const internal = isInternalDomain(domain, settings);

  if (isBlockedDomain(domain, settings)) {
    return stripHtml(text);
  }

  if (!clickable && !internal) {
    // Show the destination as text so readers keep the information without the
    // post gaining a clickable outbound link.
    return `${stripHtml(text)} (${escapeAttribute(href)})`;
  }

  if (internal) {
    return `<a href="${escapeAttribute(href)}">${text}</a>`;
  }

  return `<a href="${escapeAttribute(href)}" target="_blank" rel="ugc nofollow noopener noreferrer">${text}</a>`;
}

function applyLinkPolicy(html, options = {}) {
  const { clickable = true, settings = {} } = options;
  if (!html || typeof html !== 'string') {
    return '';
  }

  // Anchors are located by scanning rather than by /<a\b([^>]*)>([\s\S]*?)<\/a>/.
  // That expression is quadratic on a body the author controls: against a run of
  // "<a " with no closing bracket, `[^>]*` runs to the end of the string and
  // backtracks once per opening tag. Measured on the 20,000-character body limit
  // it cost over 100ms of event-loop time for a single submission, and doubling
  // the input quadrupled it. indexOf only moves forward, so this is linear.
  //
  // Bounding the quantifiers instead would have been worse than the disease: an
  // anchor that failed to match would pass through unrewritten, which is exactly
  // how an external link would escape the rel="ugc nofollow" policy.
  const lower = html.toLowerCase();
  let out = '';
  let index = 0;

  for (;;) {
    const open = lower.indexOf('<a', index);
    if (open === -1) {
      break;
    }
    // `\b` in the original: "<abbr" is not an anchor, "<a " and "<a>" are.
    if (/[a-z0-9]/.test(lower.charAt(open + 2))) {
      out += html.slice(index, open + 2);
      index = open + 2;
      continue;
    }
    const tagEnd = html.indexOf('>', open + 2);
    if (tagEnd === -1) {
      break;
    }
    // The original matched `<\/a>` exactly, and its lazy inner group stopped at
    // the first one; indexOf finds precisely that.
    const close = lower.indexOf('</a>', tagEnd + 1);
    if (close === -1) {
      break;
    }

    out += html.slice(index, open);
    out += rewriteAnchor(
      html.slice(open + 2, tagEnd),
      html.slice(tagEnd + 1, close),
      clickable,
      settings
    );
    index = close + 4;
  }

  return out + html.slice(index);
}

/**
 * Whether a domain belongs to EventFlow itself.
 * @param {string} domain Hostname.
 * @param {Object} settings Community settings (unused today, kept for parity).
 * @returns {boolean} True for EventFlow-owned hosts.
 */
function isInternalDomain(domain, settings = {}) {
  void settings;
  const host = String(domain || '').toLowerCase();
  if (!host) {
    return true; // relative link
  }
  return host === 'event-flow.co.uk' || host.endsWith('.event-flow.co.uk');
}

/**
 * Escape a value for safe use inside a double-quoted HTML attribute.
 * @param {string} value Raw value.
 * @returns {string} Escaped value.
 */
function escapeAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Body sanitisation ───────────────────────────────────────────────────────

// The published length limits (LIMITS.BODY_MAX, LIMITS.REPLY_MAX) are only
// checked against the *sanitised* text, after sanitizeContent has already run
// — every route validates length that way round, presumably so markup never
// eats into a member's word count. That leaves raw input completely unbounded
// going into the sanitiser itself. DOMPurify's underlying jsdom HTML parser is
// not linear on adversarial markup: a body of many small alternating tags
// measured at ~900ms at exactly LIMITS.BODY_MAX (20,000 characters, the app's
// own declared ceiling) and 11.3 seconds at 160,000 characters — and the
// global JSON body limit is 2MB, more than an order of magnitude larger
// again, which would extrapolate to minutes. Truncating raw input to a
// generous multiple of the eventual limit before it reaches the sanitiser
// bounds the worst case to a small, fixed number of seconds regardless of how
// large the attacker's payload is, without touching third-party parsing
// internals. No legitimate post approaches this ratio of markup to text; the
// residual ~1s floor even at the app's own content limit is the sanitiser's
// baseline cost on this input shape and is not something a request-time
// length check can remove.
const RAW_INPUT_MULTIPLIER = 2;

/**
 * Turn an untrusted body into safe stored HTML plus a plain-text copy for
 * search and duplicate detection. Arbitrary HTML is never stored.
 * @param {string} raw Untrusted body from the composer.
 * @param {Object} options Link policy options.
 * @param {boolean} [options.isReply] Whether this is a reply body, which has
 *   a shorter published limit than a discussion body.
 * @returns {{html: string, text: string, urls: string[]}} Prepared body.
 */
function prepareBody(raw, options = {}) {
  const ceiling = (options.isReply ? LIMITS.REPLY_MAX : LIMITS.BODY_MAX) * RAW_INPUT_MULTIPLIER;
  const bounded = String(raw || '').slice(0, ceiling);
  const sanitised = sanitizeContent(bounded, false);
  const withLinkPolicy = applyLinkPolicy(sanitised, options);
  const text = stripHtml(withLinkPolicy).replace(/\s+/g, ' ').trim();
  return { html: withLinkPolicy, text, urls: extractUrls(sanitised) };
}

// ─── Duplicate detection ─────────────────────────────────────────────────────

/**
 * Normalise text for comparison: lower-case, strip punctuation, collapse space.
 * @param {string} text Input text.
 * @returns {string} Normalised text.
 */
function normaliseForComparison(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a stable set of word trigrams used for near-duplicate comparison.
 * @param {string} text Input text.
 * @returns {Set<string>} Trigram set.
 */
function shingles(text) {
  const words = normaliseForComparison(text).split(' ').filter(Boolean);
  const set = new Set();
  if (words.length < 3) {
    words.forEach(word => set.add(word));
    return set;
  }
  for (let i = 0; i + 2 < words.length; i += 1) {
    set.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  return set;
}

/**
 * Jaccard similarity between two blocks of text, in the range 0–1.
 * @param {string} a First text.
 * @param {string} b Second text.
 * @returns {number} Similarity score.
 */
function similarity(a, b) {
  const left = shingles(a);
  const right = shingles(b);
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  left.forEach(item => {
    if (right.has(item)) {
      intersection += 1;
    }
  });
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * A short, stable fingerprint of a body, used to spot the exact same text being
 * pasted across many threads without storing the text twice.
 * @param {string} text Body text.
 * @returns {string} Hex fingerprint.
 */
function fingerprint(text) {
  const normalised = normaliseForComparison(text);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < normalised.length; i += 1) {
    const code = normalised.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code + i, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

// ─── Trust ───────────────────────────────────────────────────────────────────

/**
 * Derive a member's trust tier from authoritative account facts.
 *
 * Trust is never taken from the client and never influences supplier ranking.
 * @param {Object} input Account facts.
 * @param {Object} input.user User record (createdAt, verified, role).
 * @param {Object} [input.stats] Community stats (posts, helpfulAnswers, upheldReports).
 * @param {Object} [input.restriction] Active restriction, if any.
 * @param {boolean} [input.isStaff] True for admins and community moderators.
 * @param {Date} [input.now] Clock injection for tests.
 * @returns {string} One of TRUST_TIERS.
 */
function computeTrustTier(input = {}) {
  const { user = {}, stats = {}, restriction = null, isStaff = false, now = new Date() } = input;

  if (isStaff) {
    return TRUST_TIERS.STAFF;
  }

  if (restriction && restriction.active) {
    return TRUST_TIERS.RESTRICTED;
  }

  if (!user.verified) {
    return TRUST_TIERS.RESTRICTED;
  }

  const upheld = Number(stats.upheldReports || 0);
  if (upheld >= 2) {
    return TRUST_TIERS.RESTRICTED;
  }

  const createdAt = user.createdAt ? new Date(user.createdAt) : null;
  const ageDays =
    createdAt && !Number.isNaN(createdAt.getTime())
      ? Math.floor((now.getTime() - createdAt.getTime()) / DAY_MS)
      : 0;
  const posts = Number(stats.discussions || 0) + Number(stats.replies || 0);
  const helpful = Number(stats.helpfulAnswers || 0);

  if (ageDays >= 90 && posts >= 40 && helpful >= 8 && upheld === 0) {
    return TRUST_TIERS.TRUSTED;
  }
  if (ageDays >= 14 && posts >= 5 && upheld === 0) {
    return TRUST_TIERS.ESTABLISHED;
  }
  return TRUST_TIERS.NEW;
}

/**
 * Look up the posting policy attached to a trust tier.
 * @param {string} tier Trust tier key.
 * @returns {{maxLinks: number, linksClickable: boolean, requiresReview: boolean}} Policy.
 */
function policyFor(tier) {
  return TRUST_POLICY[tier] || TRUST_POLICY[TRUST_TIERS.NEW];
}

// ─── Thread freshness ────────────────────────────────────────────────────────

/**
 * Classify a discussion by age so the UI can warn readers and the moderation
 * engine can apply stricter rules to dormant threads.
 * @param {Object} discussion Discussion document.
 * @param {Date} [now] Clock injection for tests.
 * @returns {{ageDays: number, dormantDays: number, isOld: boolean, isDormant: boolean, freshness: string}} Verdict.
 */
function assessFreshness(discussion = {}, now = new Date()) {
  const created = discussion.createdAt ? new Date(discussion.createdAt) : null;
  const lastActivity = discussion.lastActivityAt ? new Date(discussion.lastActivityAt) : created;

  const ageDays =
    created && !Number.isNaN(created.getTime())
      ? Math.floor((now.getTime() - created.getTime()) / DAY_MS)
      : 0;
  const dormantDays =
    lastActivity && !Number.isNaN(lastActivity.getTime())
      ? Math.floor((now.getTime() - lastActivity.getTime()) / DAY_MS)
      : ageDays;

  let freshness = 'current';
  if (dormantDays > FRESHNESS.CURRENT_ADVICE_DAYS) {
    freshness = 'archive';
  } else if (dormantDays <= FRESHNESS.RECENT_ADVICE_DAYS) {
    freshness = 'recent';
  }

  return {
    ageDays,
    dormantDays,
    isOld: ageDays >= FRESHNESS.OLD_THREAD_DAYS,
    isDormant: dormantDays >= FRESHNESS.DORMANT_THREAD_DAYS,
    freshness,
  };
}

// ─── Content assessment ──────────────────────────────────────────────────────

/**
 * Score promotional language in a body.
 * @param {string} text Plain-text body.
 * @returns {string[]} Matched pattern descriptions.
 */
function detectPromotionalLanguage(text) {
  const value = String(text || '');
  return PROMOTIONAL_PATTERNS.filter(pattern => pattern.test(value)).map(pattern =>
    pattern.source.slice(0, 40)
  );
}

/**
 * Count distinct external domains referenced by a body, including bare domains
 * typed without a scheme (a common way to sidestep naive link counting).
 * @param {string} text Plain-text body.
 * @param {Object} settings Community settings.
 * @returns {{domains: string[], blocked: string[]}} Domain summary.
 */
function summariseDomains(text, settings = {}) {
  const value = String(text || '');
  const found = new Set();

  extractUrls(value).forEach(url => {
    const domain = domainOf(url);
    if (domain && !isInternalDomain(domain, settings)) {
      found.add(domain);
    }
  });

  extractBareDomains(value).forEach(candidate => {
    const domain = candidate.replace(/^www\./, '');
    if (!domain.includes('.')) {
      return;
    }
    if (isInternalDomain(domain, settings)) {
      return;
    }
    // Avoid treating sentence-ending words such as "e.g" or file names as hosts.
    if (/^[a-z0-9-]+\.(js|css|png|jpg|jpeg|gif|svg|md|txt|pdf)$/i.test(domain)) {
      return;
    }
    found.add(domain);
  });

  const domains = Array.from(found);
  return { domains, blocked: domains.filter(domain => isBlockedDomain(domain, settings)) };
}

/**
 * The core decision function. Given a prepared body and the surrounding
 * context, decide whether content is published immediately, held for review or
 * rejected outright.
 *
 * Signals are transparent and returned to the caller so moderators can see why
 * a decision was taken. They are never exposed to the public API.
 *
 * @param {Object} input Assessment input.
 * @param {string} input.text Plain-text body.
 * @param {string} [input.title] Discussion title, when applicable.
 * @param {string} input.trustTier Trust tier of the author.
 * @param {Object} [input.settings] Community settings.
 * @param {Object} [input.thread] Discussion being replied to, when applicable.
 * @param {Array<{text: string, createdAt: string}>} [input.recentPosts] The
 *   author's recent posts, newest first, for duplicate and velocity checks.
 * @param {Date} [input.now] Clock injection for tests.
 * @returns {{decision: string, state: string, signals: string[], score: number, linkPolicy: Object}} Verdict.
 */
// skipcq: JS-R1005 -- One readable decision table is clearer than several indirections.
function assessContent(input = {}) {
  const {
    text = '',
    title = '',
    trustTier = TRUST_TIERS.NEW,
    settings = {},
    thread = null,
    recentPosts = [],
    now = new Date(),
  } = input;

  const policy = policyFor(trustTier);
  const signals = [];
  let score = 0;

  const combined = `${title} ${text}`.trim();
  const { domains, blocked } = summariseDomains(combined, settings);

  if (blocked.length > 0) {
    signals.push(`blocked_domain:${blocked.join(',')}`);
    score += 100;
  }

  if (domains.length > policy.maxLinks) {
    signals.push(`link_count:${domains.length}>${policy.maxLinks}`);
    score += 40;
  }

  const promotional = detectPromotionalLanguage(combined);
  if (promotional.length > 0) {
    signals.push(`promotional_language:${promotional.length}`);
    score += 15 * promotional.length;
  }

  const mentions = (combined.match(/@[a-z0-9_-]{3,}/gi) || []).length;
  if (mentions > 5) {
    signals.push(`excessive_mentions:${mentions}`);
    score += 20;
  }

  // Near-duplicate of something the same author posted recently.
  const duplicate = recentPosts.find(post => similarity(post.text || '', text) >= 0.85);
  if (duplicate) {
    signals.push('duplicate_content');
    score += 50;
  }

  // Posting velocity — many posts in a short window from a low-trust account.
  const hourAgo = now.getTime() - 60 * 60 * 1000;
  const postsInLastHour = recentPosts.filter(post => {
    const created = post.createdAt ? new Date(post.createdAt).getTime() : 0;
    return created >= hourAgo;
  }).length;
  if (postsInLastHour >= 10 && trustTier === TRUST_TIERS.NEW) {
    signals.push(`velocity:${postsInLastHour}`);
    score += 25;
  }

  // The headline protection: a low-trust account replying to a dormant thread
  // with any external link at all is held for review before public display.
  if (thread) {
    const freshness = assessFreshness(thread, now);
    if (freshness.isDormant) {
      signals.push(`dormant_thread:${freshness.dormantDays}d`);
      const lowTrust = trustTier === TRUST_TIERS.NEW || trustTier === TRUST_TIERS.RESTRICTED;
      if (lowTrust && domains.length > 0 && settings.quarantineLowTrustLinks !== false) {
        signals.push('dormant_thread_link_from_low_trust');
        score += 60;
      } else if (lowTrust) {
        score += 10;
      }
    }
  }

  if (trustTier === TRUST_TIERS.RESTRICTED) {
    signals.push('restricted_account');
    score += 45;
  }

  let decision = 'publish';
  let state = CONTENT_STATES.PUBLISHED;

  if (blocked.length > 0) {
    decision = 'reject';
    state = CONTENT_STATES.QUARANTINED;
  } else if (score >= 45 || policy.requiresReview) {
    decision = 'review';
    state = CONTENT_STATES.QUARANTINED;
  }

  return {
    decision,
    state,
    signals,
    score,
    linkPolicy: { clickable: policy.linksClickable, maxLinks: policy.maxLinks },
    domains,
  };
}

/**
 * Validate a title and body against the published limits.
 * @param {Object} input Candidate content.
 * @param {string} [input.title] Title, for discussions.
 * @param {string} input.text Plain-text body.
 * @param {boolean} [input.isReply] Apply the shorter reply limits.
 * @returns {{valid: boolean, errors: string[]}} Validation result.
 */
function validateLength(input = {}) {
  const { title, text = '', isReply = false } = input;
  const errors = [];

  if (!isReply) {
    const trimmedTitle = String(title || '').trim();
    if (trimmedTitle.length < LIMITS.TITLE_MIN) {
      errors.push(`Title must be at least ${LIMITS.TITLE_MIN} characters.`);
    }
    if (trimmedTitle.length > LIMITS.TITLE_MAX) {
      errors.push(`Title must be ${LIMITS.TITLE_MAX} characters or fewer.`);
    }
  }

  const min = isReply ? LIMITS.REPLY_MIN : LIMITS.BODY_MIN;
  const max = isReply ? LIMITS.REPLY_MAX : LIMITS.BODY_MAX;
  const length = String(text || '').trim().length;

  if (length < min) {
    errors.push(`Message must be at least ${min} characters.`);
  }
  if (length > max) {
    errors.push(`Message must be ${max} characters or fewer.`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Detect personal information a member may not have meant to publish, so the
 * composer can warn before posting and moderators can redact after the fact.
 * @param {string} text Plain-text body.
 * @returns {string[]} Kinds of personal data detected.
 */
function detectPersonalInformation(text) {
  const value = String(text || '');
  const found = [];

  if (/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(value)) {
    found.push('postcode');
  }
  if (/\b(?:0|\+44)\s?\d[\d\s-]{8,}\b/.test(value)) {
    found.push('phone_number');
  }
  if (/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/.test(value)) {
    found.push('email_address');
  }
  if (/\b\d{2}-\d{2}-\d{2}\b/.test(value) || /\bsort\s*code\b/i.test(value)) {
    found.push('bank_details');
  }

  return found;
}

module.exports = {
  extractUrls,
  extractBareDomains,
  domainOf,
  isSafeUrl,
  isBlockedDomain,
  matchesDomain,
  isInternalDomain,
  applyLinkPolicy,
  prepareBody,
  normaliseForComparison,
  similarity,
  fingerprint,
  computeTrustTier,
  policyFor,
  assessFreshness,
  detectPromotionalLanguage,
  summariseDomains,
  assessContent,
  validateLength,
  detectPersonalInformation,
  HIGH_RISK_DOMAIN_TOKENS,
  HIGH_RISK_DOMAIN_PATTERNS,
  PROMOTIONAL_PATTERNS,
};
