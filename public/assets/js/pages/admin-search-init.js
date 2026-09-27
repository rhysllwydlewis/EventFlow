'use strict';
(function () {
  const activeFilters = new Set(['users', 'suppliers', 'packages', 'tickets', 'reports']);
  let searchToken = 0;
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
      renderResults(data.results, q);
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

  function renderResults(results, query) {
    const container = document.getElementById('searchResultsContainer');
    const sections = [];
    const count = Object.values(results || {}).reduce(
      (sum, items) => sum + (Array.isArray(items) ? items.length : 0),
      0
    );
    status.textContent = `${count} result${count === 1 ? '' : 's'} for “${query}”${Object.values(results || {}).some(items => Array.isArray(items) && items.length === 10) ? ' · up to 10 per category shown' : ''}`;

    if (results.users && results.users.length > 0) {
      sections.push(`
        <div class="card search-results-section">
          <h3>👥 Users (${results.users.length})</h3>
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
        </div>`);
    }

    if (results.suppliers && results.suppliers.length > 0) {
      sections.push(`
        <div class="card search-results-section">
          <h3>🏢 Suppliers (${results.suppliers.length})</h3>
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
        </div>`);
    }

    if (results.packages && results.packages.length > 0) {
      sections.push(`
        <div class="card search-results-section">
          <h3>📦 Packages (${results.packages.length})</h3>
          ${results.packages
            .map(
              p => `
            <div class="search-result-item">
              <div>
                <div class="search-result-primary">${AdminShared.escapeHtml(p.title || 'Unknown')}</div>
                <div class="search-result-secondary">${AdminShared.escapeHtml(p.supplierName || '')} ${Number.isFinite(Number(p.price)) && p.price !== '' && p.price !== null ? `· £${AdminShared.escapeHtml(Number(p.price).toFixed(2))}` : ''}</div>
              </div>
              <div class="search-result-meta">
                <span class="badge">${AdminShared.escapeHtml(p.status || 'active')}</span>
              </div>
            </div>`
            )
            .join('')}
        </div>`);
    }

    if (results.tickets && results.tickets.length > 0) {
      sections.push(`
        <div class="card search-results-section">
          <h3>🎫 Tickets (${results.tickets.length})</h3>
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
        </div>`);
    }

    if (results.reports && results.reports.length > 0) {
      sections.push(`
        <div class="card search-results-section">
          <h3>📈 Reports (${results.reports.length})</h3>
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

  document.getElementById('globalSearchForm').addEventListener('submit', e => {
    e.preventDefault();
    performSearch();
  });
  document.getElementById('backToDashboard')?.addEventListener('click', () => {
    window.location.href = '/admin';
  });
})();
