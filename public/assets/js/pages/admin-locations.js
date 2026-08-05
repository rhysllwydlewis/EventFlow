/**
 * EventFlow UK locations — admin publishing screen
 *
 * Lists every registry city with its editorial state, quality gate and
 * warnings, and lets an admin move a page through the workflow. The gate is
 * shown as the reasons a page is being held back, not just a score, so a
 * refusal to index is actionable.
 */

(function () {
  'use strict';

  const listEl = document.getElementById('efl-admin-list');
  const summaryEl = document.getElementById('efl-admin-summary');
  const filterEl = document.getElementById('efl-admin-filter');

  if (!listEl) {
    return;
  }

  /**
   * Escape text for insertion into markup.
   * @param {string} value Raw value.
   * @returns {string} Escaped value.
   */
  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Call the admin API.
   * @param {string} url Endpoint.
   * @param {Object} [options] Fetch options.
   * @returns {Promise<Object>} Response payload data.
   */
  async function api(url, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (options.method && options.method !== 'GET' && window.EventFlowCsrf) {
      headers['X-CSRF-Token'] = window.EventFlowCsrf.get();
    }
    const response = await fetch(url, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      throw new Error((payload && payload.error) || 'Request failed');
    }
    return payload.data;
  }

  /**
   * Render a details block, or nothing when the list is empty.
   * @param {string} summary Summary text.
   * @param {string[]} items List items.
   * @returns {string} HTML.
   */
  function renderDetails(summary, items) {
    if (!items || !items.length) {
      return '';
    }
    const listItems = items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
    return `<details><summary>${escapeHtml(summary)}</summary><ul>${listItems}</ul></details>`;
  }

  /**
   * Render one city card.
   * @param {Object} item Admin row.
   * @returns {string} Card HTML.
   */
  function renderCard(item) {
    const reviewed = item.lastReviewedAt ? String(item.lastReviewedAt).slice(0, 10) : 'never';
    return `<div class="efl-card" data-slug="${escapeHtml(item.slug)}">
      <h3>${escapeHtml(item.name)}</h3>
      <p class="efl-card__meta">
        <span class="efl-relationship">${escapeHtml(item.status)}</span>
        <span>Score ${escapeHtml(item.gate.score)}/${escapeHtml(item.gate.passMark)}</span>
        <span>${item.indexable ? 'Indexable' : 'Not indexable'}</span>
      </p>
      <p>${escapeHtml(item.supplierCount)} suppliers · ${escapeHtml(item.categoryCount)} categories · reviewed ${escapeHtml(reviewed)}</p>
      ${renderDetails('Why it cannot be indexed', item.gate.blockers)}
      ${renderDetails('Editorial warnings', item.warnings)}
      <p class="efl-actions">
        <button type="button" class="efl-btn efl-btn--ghost" data-action="pilot">Pilot</button>
        <button type="button" class="efl-btn efl-btn--ghost" data-action="publish">Publish</button>
        <button type="button" class="efl-btn efl-btn--ghost" data-action="index">${
          item.indexingRequested ? 'Stop requesting indexing' : 'Request indexing'
        }</button>
        <button type="button" class="efl-btn efl-btn--ghost" data-action="review">Mark reviewed</button>
        <a class="efl-btn efl-btn--ghost" href="/locations/${escapeHtml(item.slug)}">Preview</a>
      </p>
    </div>`;
  }

  /**
   * Load and render the list.
   * @returns {Promise<void>} Resolves when rendered.
   */
  async function load() {
    const query = filterEl && filterEl.value ? `?status=${encodeURIComponent(filterEl.value)}` : '';
    try {
      const data = await api(`/api/v1/admin/locations${query}`);
      const unmapped = data.summary.unmappedSuppliers
        ? ` · ${data.summary.unmappedSuppliers} suppliers not yet placed on a city`
        : '';
      summaryEl.textContent = `${data.summary.total} cities · ${data.summary.published} published · ${data.summary.pilot} in pilot · ${data.summary.indexable} indexable${unmapped}`;
      listEl.innerHTML = data.items.map(renderCard).join('');
    } catch (error) {
      summaryEl.textContent = `Could not load location pages: ${error.message}`;
    }
  }

  const ACTIONS = {
    pilot: { status: 'pilot' },
    publish: { status: 'published' },
    review: { markReviewed: true },
  };

  listEl.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button) {
      return;
    }
    const slug = button.closest('[data-slug]').getAttribute('data-slug');
    const action = button.getAttribute('data-action');
    const body =
      action === 'index'
        ? { indexingRequested: button.textContent.indexOf('Stop') === -1 }
        : ACTIONS[action];
    if (!body) {
      return;
    }

    button.disabled = true;
    try {
      await api(`/api/v1/admin/locations/${encodeURIComponent(slug)}`, { method: 'PATCH', body });
      await load();
    } catch (error) {
      summaryEl.textContent = `Update failed: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });

  if (filterEl) {
    filterEl.addEventListener('change', load);
  }

  load();
})();
