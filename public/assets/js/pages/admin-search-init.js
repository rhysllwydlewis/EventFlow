'use strict';
(function () {
  const activeFilters = new Set(['users', 'suppliers', 'packages', 'tickets', 'reports']);
  let searchToken = 0;
  // What is on screen now, so "Show more" can add the next 10 of one category
  let currentResults = {};
  let currentTotals = {};
  let currentQuery = '';
  // Categories whose "Show more" is still loading; their buttons stay disabled across re-draws
  const loadingMore = new Set();
  const PAGE = 10;
  const status = document.getElementById('adminSearchStatus');
  const searchButton = document.getElementById('globalSearchBtn');
  const badgeClass = value => String(value || '').replace(/[^a-z0-9_-]/gi, '');

  // Toggle filter chips
  document.querySelectorAll('.search-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const type = chip.dataset.type;
      if (activeFilters.has(type)) {
        activeFilters.delete(type);
        chip.classList.remove('active');
      } else {
        activeFilters.add(type);
        chip.classList.add('active');
      }
      chip.setAttribute('aria-pressed', String(activeFilters.has(type)));
      if (!activeFilters.size) {
        searchToken++;
        loadingMore.clear();
        searchButton.disabled = false;
        status.textContent = 'Select at least one category to search.';
        document.getElementById('searchResultsContainer').innerHTML = '';
      }
      if (
        document.getElementById('globalSearchInput').value.trim().length >= 2 &&
        activeFilters.size
      ) {
        performSearch();
      }
    });
  });

  async function performSearch() {
    const q = document.getElementById('globalSearchInput').value.trim();
    if (q.length < 2) {
      AdminShared.showToast('Please enter at least 2 characters to search', 'warning');
      return;
    }
    if (activeFilters.size === 0) {
      AdminShared.showToast('Please select at least one category to search', 'warning');
      return;
    }

    const container = document.getElementById('searchResultsContainer');
    const token = ++searchToken;
    loadingMore.clear();
    searchButton.disabled = true;
    status.textContent = 'Searching…';
    container.innerHTML = '<div class="search-empty-state"><p>Searching...</p></div>';

    try {
      const types = Array.from(activeFilters).join(',');
      const data = await AdminShared.api(
        `/api/admin/search?q=${encodeURIComponent(q)}&types=${encodeURIComponent(types)}`
      );
      if (token !== searchToken) {
        return;
      }
      renderResults(data.results, q, data.totals);
    } catch (err) {
      if (token !== searchToken) {
        return;
      }
      status.textContent = 'Search failed. Please try again.';
      container.innerHTML = `<div class="card"><p style="color:#ef4444;">Search failed: ${AdminShared.escapeHtml(err.message)}</p></div>`;
    } finally {
      if (token === searchToken) {
        searchButton.disabled = false;
      }
    }
  }

  function countLabel(type) {
    const shown = (currentResults[type] || []).length;
    const total = currentTotals[type];
    return total > shown ? `${shown} of ${total}` : String(shown);
  }

  function moreButton(type) {
    const shown = (currentResults[type] || []).length;
    const total = currentTotals[type] || 0;
    if (total <= shown) {
      return '';
    }
    const busy = loadingMore.has(type) ? ' disabled' : '';
    const next = Math.min(PAGE, total - shown);
    return `<button type="button" class="btn btn-secondary btn-sm search-show-more" data-more="${type}"${busy}>Show ${next} more (${total - shown} not shown)</button>`;
  }

  function renderResults(results, query, totals) {
    currentResults = results || {};
    currentTotals = totals || {};
    currentQuery = query;
    const container = document.getElementById('searchResultsContainer');
    const sections = [];
    const count = Object.values(results || {}).reduce(
      (sum, items) => sum + (Array.isArray(items) ? items.length : 0),
      0
    );
    const matches = Object.keys(currentResults).reduce(
      (sum, type) => sum + (currentTotals[type] ?? (currentResults[type] || []).length),
      0
    );
    status.textContent =
      matches > count
        ? `Showing ${count} of ${matches} matches for “${query}”`
        : `${count} result${count === 1 ? '' : 's'} for “${query}”`;

    if (results.users && results.users.length > 0) {
      sections.push(`
        <div class="card search-results-section">
          <h3>👥 Users (${countLabel('users')})</h3>
          ${results.users
            .map(
              u => `
            <div class="search-result-item">
              <div>
                <div class="search-result-primary">${AdminShared.escapeHtml(u.name || 'Unknown')}</div>
                <div class="search-result-secondary" style="display:flex;align-items:center;gap:0.4rem;">${AdminShared.escapeHtml(u.email)} ${AdminShared.getRoleBadge(u.role)}</div>
              </div>
              <div class="search-result-meta">
                <a href="/admin-user-detail?id=${encodeURIComponent(u.id)}" class="btn-sm btn-secondary">View</a>
              </div>
            </div>`
            )
            .join('')}
          ${moreButton('users')}
        </div>`);
    }

    if (results.suppliers && results.suppliers.length > 0) {
      sections.push(`
        <div class="card search-results-section">
          <h3>🏢 Suppliers (${countLabel('suppliers')})</h3>
          ${results.suppliers
            .map(
              s => `
            <div class="search-result-item">
              <div>
                <div class="search-result-primary">${AdminShared.escapeHtml(s.businessName || 'Unknown')}</div>
                <div class="search-result-secondary">${AdminShared.escapeHtml(s.email || '')} · ${AdminShared.escapeHtml(s.category || '')} · ${AdminShared.escapeHtml(s.verificationStatus || 'unverified')}</div>
              </div>
              <div class="search-result-meta">
                <a href="/admin-supplier-detail?id=${encodeURIComponent(s.id)}" class="btn-sm btn-secondary">View</a>
              </div>
            </div>`
            )
            .join('')}
          ${moreButton('suppliers')}
        </div>`);
    }

    if (results.packages && results.packages.length > 0) {
      sections.push(`
        <div class="card search-results-section">
          <h3>📦 Packages (${countLabel('packages')})</h3>
          ${results.packages
            .map(
              p => `
            <div class="search-result-item">
              <div>
                <div class="search-result-primary">${AdminShared.escapeHtml(p.title || 'Unknown')}</div>
                <div class="search-result-secondary">${AdminShared.escapeHtml(p.supplierName || '')} ${window.EFPackagePrice && EFPackagePrice.label(p) ? `· ${AdminShared.escapeHtml(EFPackagePrice.label(p))}` : ''}</div>
              </div>
              <div class="search-result-meta">
                <span class="badge">${AdminShared.escapeHtml(p.status || 'active')}</span>
              </div>
            </div>`
            )
            .join('')}
          ${moreButton('packages')}
        </div>`);
    }

    if (results.tickets && results.tickets.length > 0) {
      sections.push(`
        <div class="card search-results-section">
          <h3>🎫 Tickets (${countLabel('tickets')})</h3>
          ${results.tickets
            .map(
              t => `
            <div class="search-result-item">
              <div>
                <div class="search-result-primary">${AdminShared.escapeHtml(t.subject || 'No subject')}</div>
                <div class="search-result-secondary">${AdminShared.escapeHtml(t.senderEmail || '')} · ${AdminShared.formatDate ? AdminShared.formatDate(t.createdAt) : t.createdAt || ''}</div>
              </div>
              <div class="search-result-meta">
                <span class="badge badge-${badgeClass(t.status || 'open')}">${AdminShared.escapeHtml(t.status || 'open')}</span>
                <span class="badge badge-${badgeClass(t.priority || 'medium')}">${AdminShared.escapeHtml(t.priority || 'medium')}</span>
                <a href="/admin-tickets" class="btn-sm btn-secondary">View Tickets</a>
              </div>
            </div>`
            )
            .join('')}
          ${moreButton('tickets')}
        </div>`);
    }

    if (results.reports && results.reports.length > 0) {
      sections.push(`
        <div class="card search-results-section">
          <h3>📈 Reports (${countLabel('reports')})</h3>
          ${results.reports
            .map(
              r => `
            <div class="search-result-item">
              <div>
                <div class="search-result-primary">${AdminShared.escapeHtml(r.type || 'unknown')} — ${AdminShared.escapeHtml(r.reason || '')}</div>
                <div class="search-result-secondary">Reporter: ${AdminShared.escapeHtml(r.reporterEmail || 'unknown')}</div>
              </div>
              <div class="search-result-meta">
                <span class="badge badge-${badgeClass(r.status || 'pending')}">${AdminShared.escapeHtml(r.status || 'pending')}</span>
                <a href="/admin-reports" class="btn-sm btn-secondary">View Reports</a>
              </div>
            </div>`
            )
            .join('')}
          ${moreButton('reports')}
        </div>`);
    }

    if (sections.length === 0) {
      container.innerHTML = `
        <div class="search-empty-state">
          <div style="font-size:3rem;margin-bottom:1rem;">🔍</div>
          <p>No results found for <strong>"${AdminShared.escapeHtml(query)}"</strong>. Try a different search term.</p>
        </div>`;
    } else {
      container.innerHTML = sections.join('');
    }
  }

  // "Show more": ask for the next 10 of one category and add them to what is on screen
  document.getElementById('searchResultsContainer').addEventListener('click', async event => {
    const button = event.target.closest('[data-more]');
    if (!button) {
      return;
    }
    const type = button.getAttribute('data-more');
    if (loadingMore.has(type)) {
      return;
    }
    // A new search, or a change to the chosen categories, makes this answer out of date
    const token = searchToken;
    const query = currentQuery;
    const offset = (currentResults[type] || []).length;
    loadingMore.add(type);
    button.disabled = true;
    try {
      const data = await AdminShared.api(
        `/api/admin/search?q=${encodeURIComponent(query)}&types=${type}&limit=${PAGE}&offset=${offset}`
      );
      if (token !== searchToken) {
        return;
      }
      const results = {
        ...currentResults,
        [type]: [...currentResults[type], ...(data.results[type] || [])],
      };
      loadingMore.delete(type);
      renderResults(results, query, { ...currentTotals, ...data.totals });
    } catch (err) {
      if (token === searchToken) {
        AdminShared.showToast(`Could not load more: ${err.message}`, 'error');
      }
    } finally {
      loadingMore.delete(type);
      if (token === searchToken) {
        const again = document.querySelector(`[data-more="${type}"]`);
        if (again) {
          again.disabled = false;
        }
      }
    }
  });

  document.getElementById('globalSearchForm').addEventListener('submit', e => {
    e.preventDefault();
    performSearch();
  });
  document.getElementById('backToDashboard')?.addEventListener('click', () => {
    window.location.href = '/admin';
  });
})();
