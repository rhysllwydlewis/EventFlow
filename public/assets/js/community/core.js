/**
 * EventFlow Community — shared client helpers
 *
 * Progressive enhancement only. Every public page is server-rendered and
 * readable without JavaScript; this module replaces that fallback with the
 * interactive view once it has data.
 */

(function () {
  'use strict';

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
   * @returns {string} HTML.
   */
  function skeleton(rows = 3) {
    return `<div class="efc-skeleton" aria-hidden="true">${'<div class="efc-skeleton__row"></div>'.repeat(
      rows
    )}</div>`;
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
    authorBadges,
    avatar,
    discussionCard,
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
  };

  document.dispatchEvent(new CustomEvent('efcommunity:ready'));
})();
