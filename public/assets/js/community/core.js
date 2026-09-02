/**
 * EventFlow Community — shared client helpers
 *
 * Progressive enhancement only. Every public page is server-rendered and
 * readable without JavaScript; this module replaces that fallback with the
 * interactive view once it has data.
 */

'use strict';
(function () {
  const API = '/api/v1/community';

  /** The only query parameters the community reads from the URL. */
  const ALLOWED_QUERY_KEYS = [
    'q',
    'page',
    'limit',
    'sort',
    'category',
    'eventType',
    'region',
    'tag',
    'answer',
    'freshness',
    'media',
    'since',
  ];

  /**
   * Escape untrusted text for HTML interpolation.
   * @param {*} value Raw value.
   * @returns {string} Escaped string.
   */
  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Read the CSRF token, fetching one if the navbar has not already.
   * @returns {Promise<string>} CSRF token.
   */
  async function csrfToken() {
    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }
    try {
      const response = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        window.__CSRF_TOKEN__ = data.csrfToken;
        return data.csrfToken;
      }
    } catch (_) {
      /* the request below will surface the failure */
    }
    return '';
  }

  /**
   * Call the community API.
   * @param {string} path Path below /api/v1/community.
   * @param {Object} [options] Fetch options; `body` is JSON-encoded.
   * @returns {Promise<Object>} Parsed response body.
   */
  async function api(path, options = {}) {
    const init = {
      method: options.method || 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    };

    if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    if (init.method !== 'GET') {
      init.headers['X-CSRF-Token'] = await csrfToken();
    }

    const response = await fetch(path.startsWith('/') ? path : `${API}/${path}`, init);
    let data = {};
    let parsed = true;
    try {
      data = await response.json();
    } catch (_) {
      data = {};
      parsed = false;
    }
    if (!response.ok) {
      const error = new Error(data.message || data.error || 'Something went wrong.');
      error.status = response.status;
      error.data = data;
      throw error;
    }
    // A proxy interstitial, a maintenance page or an SPA fallback answers 200
    // with HTML. Returning an empty object here read as a successful but empty
    // payload, and callers then walked properties that were never there, so the
    // whole view threw instead of showing its error state.
    if (!parsed) {
      const error = new Error('The community is unavailable right now. Please try again.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  /**
   * Format a timestamp as a short relative description.
   * @param {string} value ISO timestamp.
   * @returns {string} Relative time.
   */
  function timeAgo(value) {
    if (!value) {
      return '';
    }
    const then = new Date(value).getTime();
    if (Number.isNaN(then)) {
      return '';
    }
    const seconds = Math.max(1, Math.floor((Date.now() - then) / 1000));
    const units = [
      [31536000, 'year'],
      [2592000, 'month'],
      [604800, 'week'],
      [86400, 'day'],
      [3600, 'hour'],
      [60, 'minute'],
    ];
    for (const [size, name] of units) {
      if (seconds >= size) {
        const count = Math.floor(seconds / size);
        return `${count} ${name}${count === 1 ? '' : 's'} ago`;
      }
    }
    return 'just now';
  }

  /**
   * Format a count compactly: 1234 becomes "1.2k".
   *
   * Category tiles sit in a fixed-width strip, and a five-digit count wraps the
   * label onto a second line and knocks the whole row out of alignment. Counts
   * below a thousand are left exactly as they are — rounding "847" to "0.8k"
   * would lose precision a reader can actually use.
   * @param {number} value Raw count.
   * @returns {string} Display string.
   */
  function compactCount(value) {
    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) {
      return '0';
    }
    if (count < 1000) {
      return String(Math.round(count));
    }
    if (count < 1000000) {
      const thousands = count / 1000;
      // 9.95k would render as "10.0k", which is wider than the "9.9k" the
      // strip is sized for, so anything that rounds up to a whole unit drops
      // the decimal instead.
      const rounded = Math.round(thousands * 10) / 10;
      return rounded >= 1000 ? '1m' : `${rounded % 1 === 0 ? rounded : rounded.toFixed(1)}k`;
    }
    const millions = Math.round((count / 1000000) * 10) / 10;
    return `${millions % 1 === 0 ? millions : millions.toFixed(1)}m`;
  }

  /**
   * Line-art icon paths for the seeded categories, keyed by slug.
   *
   * Operators can create their own categories, and those carry an emoji rather
   * than a slug this map knows, so `categoryIcon` falls back to the stored
   * emoji instead of leaving a hole in the strip.
   */
  const CATEGORY_ICON_PATHS = Object.freeze({
    'planning-and-budgets':
      '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 2v4M15 2v4M4 10h16M8 15h4"/>',
    venues: '<path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/>',
    'catering-and-cakes':
      '<path d="M4 21h16v-6a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v6ZM12 7V3M8 11V8M16 11V8"/>',
    'photography-and-video':
      '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/>',
    'entertainment-and-music':
      '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    'styling-decor-and-flowers':
      '<circle cx="12" cy="9" r="2.5"/><path d="M12 6.5A2.75 2.75 0 1 1 14.5 9 2.75 2.75 0 1 1 12 11.5 2.75 2.75 0 1 1 9.5 9 2.75 2.75 0 1 1 12 6.5ZM12 12v9"/>',
    'fashion-and-beauty': '<path d="M9 3h6l-1 4 4 6-6 8-6-8 4-6-1-4Z"/>',
    'invitations-and-stationery':
      '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    'event-websites-and-technology':
      '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    transport:
      '<path d="M3 16V8a1 1 0 0 1 1-1h9l4 4h3a1 1 0 0 1 1 1v4"/><path d="M3 16h2M9 16h6M21 16h-2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
    'travel-and-accommodation':
      '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
    'parties-and-pre-events': '<path d="M6 3h12l-5 8v7h3M11 18H8M11 18v-7"/>',
    'etiquette-and-advice':
      '<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z"/><path d="M10 9h6M10 12h4"/>',
    'accessibility-and-inclusive-events':
      '<circle cx="12" cy="4.5" r="1.8"/><path d="M5 9h14M12 9v5M12 14l-3 7M12 14l3 7"/>',
    'diy-and-inspiration':
      '<path d="M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3Z"/><path d="M10 20h4"/>',
    'recommendations-wanted':
      '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v3.5l2.2 1.3"/>',
    'real-events': '<path d="M3 19V7l6-3 6 3 6-3v12l-6 3-6-3-6 3Z"/><path d="M9 4v12M15 7v12"/>',
    'ask-verified-suppliers':
      '<path d="M12 3 5 6v5.5c0 4 3 7.4 7 8.5 4-1.1 7-4.5 7-8.5V6Z"/><path d="m9.2 11.8 2 2 3.6-3.8"/>',
    'marketplace-help-and-wanted': '<path d="M4 8h16l-1 12H5Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    'corporate-and-charity-events':
      '<path d="M3 21h18M5 21V8h7v13M12 21V4h7v17"/><path d="M8 12h1M8 16h1M15 9h1M15 13h1M15 17h1"/>',
    'feedback-to-eventflow':
      '<path d="M7 14V9.5a3 3 0 0 1 3-3l1-3.5a2 2 0 0 1 2 2V8h4.5a2 2 0 0 1 2 2.3l-1 6A2 2 0 0 1 16.5 18H10Z"/><rect x="3" y="13" width="4" height="8" rx="1"/>',
    'general-event-chat':
      '<path d="M17 12a5 5 0 0 1-5 5H8l-4 3v-4.6A5 5 0 0 1 3 12V9a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5Z"/><path d="M20 8a4 4 0 0 1 1 2.6V14a4 4 0 0 1-2 3.4"/>',
  });

  /**
   * Render a category's icon.
   * @param {Object} category Category with a slug and optional emoji icon.
   * @returns {string} HTML, already escaped.
   */
  function categoryIcon(category) {
    const item = category || {};
    const paths = CATEGORY_ICON_PATHS[item.slug];
    if (paths) {
      return `<svg class="efc-caticon__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    }
    return `<span class="efc-caticon__emoji" aria-hidden="true">${esc(item.icon || '💬')}</span>`;
  }

  /**
   * Format a timestamp as a plain UK date.
   * @param {string} value ISO timestamp.
   * @returns {string} Formatted date.
   */
  function shortDate(value) {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /**
   * Render the badge row for an author.
   * @param {Object} author Author card.
   * @returns {string} HTML.
   */
  function authorBadges(author) {
    if (!author) {
      return '';
    }
    const badges = [];
    if (author.isOfficial) {
      badges.push('<span class="efc-badge efc-badge--official">EventFlow team</span>');
    }
    if (author.isModerator && !author.isOfficial) {
      badges.push('<span class="efc-badge efc-badge--moderator">Moderator</span>');
    }
    if (author.isSupplier && author.supplierApproved) {
      badges.push('<span class="efc-badge efc-badge--supplier">Approved supplier</span>');
    } else if (author.isSupplier) {
      badges.push('<span class="efc-badge efc-badge--supplier">Supplier</span>');
    }
    if (author.levelLabel) {
      badges.push(`<span class="efc-badge">${esc(author.levelLabel)}</span>`);
    }
    return badges.join(' ');
  }

  /**
   * Render a member's avatar, falling back to their initial.
   *
   * Most members have no photo, and a page of identical grey silhouettes gives
   * a reader nothing to navigate by. The initial is tinted deterministically
   * from the handle, so the same person looks the same everywhere without the
   * colour carrying any meaning of its own.
   * @param {Object} author Public author card.
   * @param {number} [size] Pixel size of the square avatar.
   * @returns {string} HTML.
   */
  function avatar(author, size = 40) {
    const person = author || {};
    if (person.avatarUrl) {
      return `<img class="efc-avatar" src="${esc(person.avatarUrl)}" alt="" width="${size}" height="${size}" loading="lazy" />`;
    }
    const name = String(person.displayName || person.handle || '?').trim();
    const initial = name ? name.charAt(0).toUpperCase() : '?';
    const seed = String(person.handle || name);
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash = (hash * 31 + seed.charCodeAt(index)) % 360;
    }
    return `<span class="efc-avatar efc-avatar--initial" style="--efc-avatar-hue:${hash}" aria-hidden="true">${esc(initial)}</span>`;
  }

  /**
   * Render one discussion card.
   * @param {Object} card Discussion card from the API.
   * @returns {string} HTML list item.
   */
  function discussionCard(card) {
    const flags = [
      card.solved ? '<span class="efc-badge efc-badge--solved">Solved</span>' : '',
      card.hasOfficialAnswer
        ? '<span class="efc-badge efc-badge--official">Official answer</span>'
        : '',
      card.hasSupplierReply
        ? '<span class="efc-badge efc-badge--supplier">Supplier replied</span>'
        : '',
      card.isOld ? '<span class="efc-badge efc-badge--age">Older discussion</span>' : '',
      card.pinned ? '<span class="efc-badge">Pinned</span>' : '',
      card.locked ? '<span class="efc-badge">Locked</span>' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const context = [
      card.category && card.category.name ? esc(card.category.name) : '',
      card.eventTypeLabel ? esc(card.eventTypeLabel) : '',
      card.regionLabel ? esc(card.regionLabel) : '',
    ].filter(Boolean);

    // A thread nobody has answered is the one a reader can most usefully act
    // on, so it says so in words rather than leaving "0 replies" to be decoded.
    const unanswered = !card.replyCount;
    const replies = unanswered
      ? '<span class="efc-discussion__cue">No replies yet</span>'
      : `${card.replyCount} ${card.replyCount === 1 ? 'reply' : 'replies'}`;

    // Same signal previewCard already uses for the hero rails: a discussion
    // with a genuine photo attachment shows it. Cards without one render no
    // thumbnail at all rather than a placeholder, matching the rest of the
    // page's rule against decorative empty boxes.
    const thumb = card.heroImage
      ? `<img class="efc-discussion__thumb" src="${esc(card.heroImage.url)}" alt="" width="84" height="84" loading="lazy" decoding="async" />`
      : '';

    return `<li class="efc-discussion${unanswered ? ' efc-discussion--unanswered' : ''}">
      ${avatar(card.author, 40)}
      <div class="efc-discussion__main">
        <h3 class="efc-discussion__title"><a href="${esc(card.url)}">${esc(card.title)}</a></h3>
        ${flags ? `<p class="efc-meta">${flags}</p>` : ''}
        <p class="efc-discussion__excerpt">${esc(card.excerpt)}</p>
        <p class="efc-meta">
          <span>${esc(card.author.displayName)}</span>
          ${context.map(item => `<span class="efc-meta__dot">${item}</span>`).join('')}
        </p>
        <p class="efc-meta efc-meta--stats">
          <span>${replies}</span>
          <span class="efc-meta__dot">${card.uniqueViews} views</span>
          <span class="efc-meta__dot">Active ${esc(timeAgo(card.lastActivityAt))}</span>
        </p>
      </div>
      ${thumb}
    </li>`;
  }

  /**
   * Render the compact preview card used by the homepage hero rails.
   *
   * This is a deliberately thinner view than `discussionCard`: it drops the
   * excerpt, badges and view count, because the rails sit beside the hero and
   * are there to show that the community is alive, not to be read in depth.
   * The full card is still what the feed below uses.
   * @param {Object} card Discussion card from the API.
   * @returns {string} HTML list item.
   */
  function previewCard(card) {
    const thumb = card.heroImage
      ? `<img class="efc-preview__thumb" src="${esc(card.heroImage.url)}" alt="" width="56" height="56" loading="lazy" decoding="async" />`
      : `<span class="efc-preview__thumb efc-preview__thumb--icon">${categoryIcon(card.category)}</span>`;

    // "Active" here means a reply or the original post landed inside the last
    // week. It is a real signal read from the data, not decoration: a card
    // without it is simply quiet, and says so to a screen reader.
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const activeAt = new Date(card.lastActivityAt || card.createdAt).getTime();
    const isActive = Number.isFinite(activeAt) && Date.now() - activeAt < weekMs;

    return `<li class="efc-preview">
      <a class="efc-preview__link" href="${esc(card.url)}">
        ${thumb}
        <span class="efc-preview__body">
          <span class="efc-preview__title">${esc(card.title)}</span>
          <span class="efc-preview__meta">${esc(card.author.displayName)}</span>
          <span class="efc-preview__stats">
            <span class="efc-preview__time">${esc(timeAgo(card.lastActivityAt || card.createdAt))}</span>
            <span class="efc-preview__replies">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 9 9 0 0 1-3.9-.9L3 21l1.9-4.9A8.4 8.4 0 0 1 4 11.5 8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5Z"/></svg>
              ${card.replyCount} ${card.replyCount === 1 ? 'reply' : 'replies'}
            </span>
          </span>
        </span>
        ${isActive ? '<span class="efc-preview__dot"><span class="efc-sr-only">Active this week</span></span>' : ''}
      </a>
    </li>`;
  }

  /**
   * Render a list of discussion cards, or a useful empty state.
   * @param {Object[]} cards Discussion cards.
   * @param {Object} [empty] Empty-state copy.
   * @returns {string} HTML.
   */
  function discussionList(cards, empty = {}) {
    if (!cards || cards.length === 0) {
      return emptyState(
        empty.title || 'Nothing here yet',
        empty.body || 'Be the first to start a discussion in this part of the community.',
        empty.action || { href: '/community/new', label: 'Start a discussion' }
      );
    }
    return `<ul class="efc-list">${cards.map(discussionCard).join('')}</ul>`;
  }

  /**
   * Render an empty state. Empty modules are never rendered as decorative
   * boxes: they either say something useful or are omitted entirely.
   * @param {string} title Heading.
   * @param {string} body Explanation.
   * @param {Object} [action] Optional call to action.
   * @returns {string} HTML.
   */
  function emptyState(title, body, action) {
    return `<div class="efc-empty">
      <h3>${esc(title)}</h3>
      <p>${esc(body)}</p>
      ${action ? `<p><a class="btn btn-primary" href="${esc(action.href)}">${esc(action.label)}</a></p>` : ''}
    </div>`;
  }

  /**
   * Render a loading skeleton.
   * @param {number} [rows] Number of placeholder rows.
   * @param {string} [shape] Layout to match: 'row' (default list rows),
   *   'profile' (avatar + name header above rows), 'sidebar' (stacked cards)
   *   or 'page' (two-column feed + sidebar, matching `.efc-grid--sidebar`).
   * @returns {string} HTML.
   */
  function skeleton(rows = 3, shape = 'row') {
    const row = () => '<div class="efc-skeleton__row"></div>';
    const card = () => '<div class="efc-skeleton__card"></div>';

    if (shape === 'profile') {
      return `<div class="efc-skeleton efc-skeleton--profile" aria-hidden="true">
        <div class="efc-skeleton__head">
          <span class="efc-skeleton__avatar"></span>
          <div class="efc-skeleton__lines">
            <span class="efc-skeleton__bar efc-skeleton__bar--title"></span>
            <span class="efc-skeleton__bar efc-skeleton__bar--short"></span>
          </div>
        </div>
        ${row().repeat(rows)}
      </div>`;
    }

    if (shape === 'sidebar') {
      return `<div class="efc-skeleton efc-skeleton__sidebar" aria-hidden="true">${card().repeat(rows)}</div>`;
    }

    if (shape === 'page') {
      return `<div class="efc-skeleton--page" aria-hidden="true">
        <div class="efc-skeleton efc-skeleton__main">${row().repeat(rows)}</div>
        <div class="efc-skeleton efc-skeleton__sidebar">${card().repeat(3)}</div>
      </div>`;
    }

    return `<div class="efc-skeleton" aria-hidden="true">${row().repeat(rows)}</div>`;
  }

  /**
   * Render an error state with a retry affordance.
   * @param {string} message Human-readable message.
   * @returns {string} HTML.
   */
  function errorState(message) {
    return `<div class="efc-notice efc-notice--danger" role="alert">
      <p>${esc(message)}</p>
      <p><button type="button" class="efc-action" data-efc-retry>Try again</button></p>
    </div>`;
  }

  /**
   * Render accessible pagination controls.
   * @param {Object} pagination Pagination payload.
   * @param {Function} hrefFor Builds the href for a page number.
   * @returns {string} HTML.
   */
  function pagination(paging, hrefFor) {
    if (!paging || paging.totalPages <= 1) {
      return '';
    }
    const parts = [];
    if (paging.page > 1) {
      parts.push(
        `<a class="efc-action" rel="prev" href="${esc(hrefFor(paging.page - 1))}">Previous</a>`
      );
    }
    parts.push(
      `<span class="efc-pagination__status" role="status">Page ${paging.page} of ${paging.totalPages} · ${paging.total} discussions</span>`
    );
    if (paging.page < paging.totalPages) {
      parts.push(
        `<a class="efc-action" rel="next" href="${esc(hrefFor(paging.page + 1))}">Next</a>`
      );
    }
    return `<nav class="efc-pagination" aria-label="Pagination">${parts.join('')}</nav>`;
  }

  /**
   * Announce a message to assistive technology and show a toast.
   * @param {string} message Message text.
   * @param {string} [tone] 'info' or 'error'.
   * @returns {void} Nothing.
   */
  function announce(message, tone = 'info') {
    let live = document.getElementById('efc-live');
    if (!live) {
      live = document.createElement('div');
      live.id = 'efc-live';
      live.className = 'efc-sr-only';
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      document.body.appendChild(live);
    }
    live.textContent = message;

    if (window.showToast) {
      window.showToast(message, tone === 'error' ? 'error' : 'success');
    }
  }

  /**
   * Read the current query string as an object.
   * @returns {Object} Query parameters.
   */
  function queryState() {
    const params = new URLSearchParams(window.location.search);
    // Only the parameters the community actually understands are read, and the
    // object has a null prototype, so a crafted query string cannot reach
    // Object.prototype or introduce a key the rest of the code will act on.
    const state = Object.create(null);
    ALLOWED_QUERY_KEYS.forEach(key => {
      const value = params.get(key);
      if (value !== null) {
        state[key] = value;
      }
    });
    return state;
  }

  /**
   * Write filter state to the URL so a filtered view can be shared and the
   * browser's back button behaves as expected.
   * @param {Object} state Query parameters.
   * @param {boolean} [replace] Replace rather than push.
   * @returns {string} The new query string.
   */
  function setQueryState(state, replace = false) {
    const params = new URLSearchParams();
    ALLOWED_QUERY_KEYS.forEach(key => {
      const value = state[key];
      if (value !== '' && value !== null && value !== undefined && value !== 'all') {
        params.set(key, value);
      }
    });
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
    if (replace) {
      window.history.replaceState(state, '', url);
    } else {
      window.history.pushState(state, '', url);
    }
    return query;
  }

  /**
   * Hide the server-rendered fallback once the interactive view has content.
   * @returns {void} Nothing.
   */
  function hideFallback() {
    const fallback = document.getElementById('efc-noscript');
    if (fallback) {
      fallback.hidden = true;
    }
  }

  /**
   * Upload an image attachment for a discussion draft. Returns the stored
   * attachment descriptor ({ kind: 'image', url, alt }) which the composer
   * includes verbatim in the discussion's `attachments` array on submit.
   * @param {File} file Image file selected by the member.
   * @returns {Promise<Object>} Attachment descriptor.
   */
  async function uploadAttachment(file) {
    const formData = new FormData();
    formData.append('image', file);
    const response = await fetch(`${API}/attachments`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': await csrfToken() },
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'Could not upload image.');
      error.status = response.status;
      throw error;
    }
    return data.attachment;
  }

  /**
   * Fetch the signed-in member's community state, or null when logged out.
   * @returns {Promise<Object|null>} Member state.
   */
  async function me() {
    try {
      const viewer = await api('me');
      // The endpoint answers anonymously rather than with 401, so an explicit
      // `authenticated: false` is the logged-out signal callers expect as null.
      return viewer && viewer.authenticated === false ? null : viewer;
    } catch (_) {
      return null;
    }
  }

  window.EFCommunity = {
    API,
    api,
    esc,
    csrfToken,
    ALLOWED_QUERY_KEYS,
    timeAgo,
    shortDate,
    compactCount,
    categoryIcon,
    CATEGORY_ICON_PATHS,
    authorBadges,
    avatar,
    discussionCard,
    previewCard,
    discussionList,
    emptyState,
    errorState,
    skeleton,
    pagination,
    announce,
    queryState,
    setQueryState,
    hideFallback,
    me,
    uploadAttachment,
  };

  document.dispatchEvent(new CustomEvent('efcommunity:ready'));
})();
