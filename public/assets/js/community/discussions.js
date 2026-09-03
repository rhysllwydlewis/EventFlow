/**
 * EventFlow Community — discussion index, category pages and search
 *
 * One filter, sort and pagination implementation serving three routes. All
 * state is URL-backed so a filtered view can be bookmarked and shared.
 */

'use strict';
(function () {
  const EFC = window.EFCommunity;
  const root = document.getElementById('efc-discussions');
  if (!EFC || !root) {
    return;
  }

  const mode = root.dataset.mode || 'index';
  // The category slug lives in the URL, not in the static shell, so the same
  // HTML file serves every category page.
  const categorySlug =
    root.dataset.category || decodeURIComponent(window.location.pathname.split('/').pop() || '');
  let meta = null;
  let state = EFC.queryState();
  // `queryState` already returns a null-prototype object; keep that property
  // when the state is reset.

  /**
   * Build the endpoint for the current mode and filter state.
   * @returns {string} API path with query string.
   */
  function endpoint() {
    const params = new URLSearchParams();
    Object.entries(state).forEach(([key, value]) => {
      if (value !== '' && value !== null && value !== undefined) {
        params.set(key, value);
      }
    });
    if (mode === 'category') {
      return `categories/${encodeURIComponent(categorySlug)}?${params.toString()}`;
    }
    if (mode === 'search') {
      return `search?${params.toString()}`;
    }
    return `discussions?${params.toString()}`;
  }

  /**
   * Render a labelled select control.
   * @param {string} id Element id.
   * @param {string} label Visible label.
   * @param {Array<{key: string, label: string}>} options Options.
   * @param {string} value Current value.
   * @returns {string} HTML.
   */
  function select(id, label, options, value) {
    const items = options
      .map(
        option =>
          `<option value="${EFC.esc(option.key)}"${option.key === value ? ' selected' : ''}>${EFC.esc(
            option.label
          )}</option>`
      )
      .join('');
    return `<div class="efc-field">
      <label for="${id}">${EFC.esc(label)}</label>
      <select id="${id}" data-filter="${id.replace('efc-filter-', '')}">${items}</select>
    </div>`;
  }

  /**
   * Render the filter panel.
   * @returns {string} HTML.
   */
  function filters() {
    const categories = [{ key: '', label: 'All categories' }].concat(
      (meta.categories || []).map(item => ({ key: item.slug, label: item.name }))
    );
    // The taxonomy is remote, so the panel is built from whatever actually
    // arrived rather than assuming the shape of a payload it has not seen.
    const eventTypes = [{ key: '', label: 'All event types' }].concat(meta.eventTypes || []);
    const regions = [{ key: '', label: 'All of the UK' }].concat(meta.regions || []);
    const answers = [
      { key: 'all', label: 'Any' },
      { key: 'solved', label: 'Solved' },
      { key: 'unanswered', label: 'Unanswered' },
      { key: 'official', label: 'Has an official answer' },
      { key: 'supplier', label: 'Has a supplier reply' },
    ];
    const freshness = [
      { key: 'all', label: 'Any age' },
      { key: 'recent', label: 'Active in the last 3 months' },
      { key: 'current', label: 'Active in the last year' },
      { key: 'archive', label: 'Older than a year' },
    ];
    const sorts = [
      { key: 'latest-activity', label: 'Latest activity' },
      { key: 'newest', label: 'Newest' },
      { key: 'most-replies', label: 'Most replies' },
      { key: 'most-viewed', label: 'Most viewed' },
      { key: 'popular', label: 'Popular' },
      { key: 'unanswered', label: 'Unanswered' },
    ];

    return `<button type="button" class="efc-action efc-filters-toggle" data-filters-toggle aria-expanded="true" aria-controls="efc-filters">Filters</button>
    <form class="efc-filters" id="efc-filters" aria-label="Filter discussions">
      <div class="efc-filters__grid">
        ${mode === 'category' ? '' : select('efc-filter-category', 'Category', categories, state.category || '')}
        ${select('efc-filter-eventType', 'Event type', eventTypes, state.eventType || '')}
        ${select('efc-filter-region', 'UK region', regions, state.region || '')}
        ${select('efc-filter-answer', 'Answers', answers, state.answer || 'all')}
        ${select('efc-filter-freshness', 'Freshness', freshness, state.freshness || 'all')}
        ${select('efc-filter-sort', 'Sort by', sorts, state.sort || 'latest-activity')}
      </div>
      <div class="efc-filters__actions">
        <button type="submit" class="btn btn-primary">Apply filters</button>
        <button type="button" class="efc-action" data-clear>Clear filters</button>
      </div>
    </form>`;
  }

  /**
   * Build the href for a page of results.
   * @param {number} page Page number.
   * @returns {string} URL.
   */
  function hrefForPage(page) {
    const params = new URLSearchParams(window.location.search);
    params.set('page', String(page));
    return `${window.location.pathname}?${params.toString()}`;
  }

  /**
   * Render the results area.
   * @param {Object} payload API payload.
   * @returns {void} Nothing.
   */
  function renderResults(payload) {
    const results = payload.discussions || payload.results || [];
    const list = document.getElementById('efc-results');
    if (!list) {
      return;
    }

    const heading =
      mode === 'search'
        ? `<p class="efc-meta" role="status">${payload.pagination.total} ${
            payload.pagination.total === 1 ? 'result' : 'results'
          } for “${EFC.esc(payload.query || '')}”</p>`
        : `<p class="efc-meta" role="status">${payload.pagination.total} ${
            payload.pagination.total === 1 ? 'discussion' : 'discussions'
          }</p>`;

    const empty =
      mode === 'search'
        ? {
            title: 'No matching discussions',
            body: 'Try fewer words, or start a discussion and ask the community directly.',
            action: { href: '/community/new', label: 'Start a discussion' },
          }
        : {
            title: 'No discussions match these filters',
            body: 'Clear a filter to widen your search, or start the discussion yourself.',
            action: { href: '/community/new', label: 'Start a discussion' },
          };

    list.innerHTML = `${heading}${EFC.discussionList(results, empty)}${EFC.pagination(
      payload.pagination,
      hrefForPage
    )}`;
  }

  /**
   * Load and render the current view.
   * @returns {Promise<void>} Resolves when rendered.
   */
  async function load() {
    const list = document.getElementById('efc-results');
    if (list) {
      list.innerHTML = EFC.skeleton(4);
    }
    try {
      const payload = await EFC.api(endpoint());
      EFC.hideFallback();
      if (mode === 'category' && payload.category) {
        const header = document.getElementById('efc-category-header');
        if (header) {
          header.innerHTML = `
            <h1>${EFC.esc(payload.category.icon || '')} ${EFC.esc(payload.category.name)}</h1>
            <p>${EFC.esc(payload.category.description || '')}</p>
            ${
              payload.category.rules
                ? `<div class="efc-notice efc-notice--info"><strong>Category rules:</strong> ${EFC.esc(
                    payload.category.rules
                  )}</div>`
                : ''
            }
            ${
              payload.category.marketplaceSafetyNotice
                ? '<div class="efc-notice"><strong>Buying or selling?</strong> Use the <a href="/marketplace">EventFlow marketplace</a> so you keep its protections. Do not arrange private sales in a thread.</div>'
                : ''
            }
            <p class="efc-meta">${payload.category.discussionCount} discussions · ${
              payload.category.followerCount
            } followers</p>
            <p><button type="button" class="efc-action" data-follow-category="${EFC.esc(
              payload.category.id
            )}" aria-pressed="${payload.category.following}">${
              payload.category.following ? 'Following' : 'Follow this category'
            }</button></p>`;
          wireFollow();
        }
      }
      renderResults(payload);
    } catch (error) {
      EFC.hideFallback();
      if (list) {
        list.innerHTML = EFC.errorState('We could not load these discussions.');
        const retry = list.querySelector('[data-efc-retry]');
        if (retry) {
          retry.addEventListener('click', load);
        }
      }
    }
  }

  /**
   * Wire the follow/unfollow button on a category page.
   * @returns {void} Nothing.
   */
  function wireFollow() {
    const button = document.querySelector('[data-follow-category]');
    if (!button) {
      return;
    }
    button.addEventListener('click', async () => {
      const following = button.getAttribute('aria-pressed') === 'true';
      try {
        await EFC.api(`categories/${button.dataset.followCategory}/follow`, {
          method: following ? 'DELETE' : 'POST',
        });
        button.setAttribute('aria-pressed', String(!following));
        button.textContent = following ? 'Follow this category' : 'Following';
        EFC.announce(
          following
            ? 'You are no longer following this category.'
            : 'You are now following this category.'
        );
      } catch (error) {
        if (error.status === 401) {
          window.location.href = `/auth?next=${encodeURIComponent(window.location.pathname)}`;
          return;
        }
        EFC.announce(error.message, 'error');
      }
    });
  }

  /**
   * Wire the filter form.
   * @returns {void} Nothing.
   */
  function wireFilters() {
    const form = document.getElementById('efc-filters');
    if (!form) {
      return;
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      form.querySelectorAll('[data-filter]').forEach(control => {
        // Only keys the community understands are written, so a stray or
        // crafted data-filter attribute cannot introduce an arbitrary property.
        const key = control.dataset.filter;
        if (EFC.ALLOWED_QUERY_KEYS.includes(key)) {
          state[key] = control.value;
        }
      });
      state.page = '1';
      EFC.setQueryState(state);
      load();
    });

    const clear = form.querySelector('[data-clear]');
    if (clear) {
      clear.addEventListener('click', () => {
        state = Object.assign(Object.create(null), state.q ? { q: state.q } : {});
        EFC.setQueryState(state);
        window.location.reload();
      });
    }

    const toggle = document.querySelector('[data-filters-toggle]');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const hidden = form.hasAttribute('hidden');
        if (hidden) {
          form.removeAttribute('hidden');
        } else {
          form.setAttribute('hidden', '');
        }
        toggle.setAttribute('aria-expanded', String(hidden));
      });
      if (window.matchMedia('(max-width: 767px)').matches) {
        form.setAttribute('hidden', '');
        toggle.setAttribute('aria-expanded', 'false');
      }
    }
  }

  /**
   * Boot the page.
   * @returns {Promise<void>} Resolves when ready.
   */
  async function boot() {
    try {
      const [metaPayload, categories] = await Promise.all([EFC.api('meta'), EFC.api('categories')]);
      meta = { ...metaPayload, categories: categories.categories };
    } catch (error) {
      meta = { eventTypes: [], regions: [], categories: [] };
    }

    const panel = document.getElementById('efc-filters-slot');
    if (panel) {
      panel.innerHTML = filters();
      wireFilters();
    }
    // Put the query back in the box. Arriving from a link or a shared URL, a
    // reader could see "2 results for marquee" above an empty search field and
    // had to retype the term before they could narrow it.
    const searchInput = document.getElementById('efc-search-input');
    if (searchInput && state.q) {
      searchInput.value = state.q;
    }
    await load();
  }

  window.addEventListener('popstate', () => {
    state = EFC.queryState();
    load();
  });

  boot();
})();
