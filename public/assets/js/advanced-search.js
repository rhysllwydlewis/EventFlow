/**
 * EventFlow Advanced Search - Phase 2
 * Advanced message search with operators and autocomplete
 *
 * Features:
 * - 17+ search operators (from:, to:, subject:, etc.)
 * - Boolean logic (AND, OR, NOT)
 * - Autocomplete suggestions
 * - Saved searches
 * - Query validation
 */

'use strict';
(function () {
  // ==========================================
  // STATE
  // ==========================================

  const state = {
    currentQuery: '',
    searchResults: [],
    savedSearches: JSON.parse(localStorage.getItem('ef_saved_searches') || '[]'),
    isSearching: false,
    operators: [],
    autocompleteSuggestions: [],
    showAutocomplete: false,
  };

  // ==========================================
  // CONSTANTS
  // ==========================================

  const API_BASE = '/api/v2/search/advanced';

  const SEARCH_OPERATORS = {
    'from:': 'Search by sender email',
    'to:': 'Search by recipient email',
    'subject:': 'Search in subject line',
    'body:': 'Search in message body',
    'before:': 'Messages before date (YYYY-MM-DD)',
    'after:': 'Messages after date (YYYY-MM-DD)',
    'is:': 'Filter by status (read, unread, starred, archived)',
    'has:': 'Messages with attachment, link, or image',
    'folder:': 'Search in specific folder',
    'label:': 'Search by label',
    'larger:': 'Messages larger than size (e.g., 10mb)',
    'smaller:': 'Messages smaller than size (e.g., 1mb)',
    'filename:': 'Search attachment filenames',
  };

  const STATUS_VALUES = ['read', 'unread', 'starred', 'archived', 'draft'];
  const HAS_VALUES = ['attachment', 'link', 'image'];

  // ==========================================
  // API CALLS
  // ==========================================

  async function apiFetch(url, options = {}) {
    // Check if CSRF handler is available
    if (!window.csrfHandler) {
      throw new Error('CSRF handler not available');
    }

    // Add Content-Type header if not present
    const fetchOptions = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    };

    // Use CSRF handler's fetch method (includes automatic token handling and retry)
    const response = await window.csrfHandler.fetch(url, fetchOptions);

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
      }));
      throw new Error(error.error || error.message || `Request failed: ${response.status}`);
    }

    return await response.json();
  }

  async function executeSearch(query, retries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        state.isSearching = true;
        state.currentQuery = query;
        updateSearchUI();

        // Ensure CSRF token before search
        if (window.csrfHandler) {
          await window.csrfHandler.ensureToken();
        }

        const encodedQuery = encodeURIComponent(query);
        const data = await apiFetch(`${API_BASE}?q=${encodedQuery}`);

        if (data.success && Array.isArray(data.results)) {
          state.searchResults = data.results;
          displaySearchResults(data.results, data.totalCount);
          showSuccess(`Found ${data.totalCount} message(s)`);
        }

        // Success - break out of retry loop
        state.isSearching = false;
        updateSearchUI();
        return;
      } catch (error) {
        if (attempt < retries) {
          // Exponential backoff: delay * 2^(attempt-1)
          await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt - 1)));
        } else {
          // All retries exhausted
          showError('Search failed. Please try again.');
          displaySearchResults([], 0);
        }
      } finally {
        if (attempt === retries) {
          state.isSearching = false;
          updateSearchUI();
        }
      }
    }
  }

  async function loadOperators() {
    try {
      const data = await apiFetch(`${API_BASE}/operators`);

      if (data.success && Array.isArray(data.operators)) {
        state.operators = data.operators;
      }
    } catch (error) {
      // Use fallback operators
      state.operators = Object.entries(SEARCH_OPERATORS).map(([op, desc]) => ({
        operator: op,
        description: desc,
      }));
    }
  }

  // ==========================================
  // SEARCH UI
  // ==========================================

  function updateSearchUI() {
    const searchBox = document.getElementById('advanced-search-input');
    const searchBtn = document.getElementById('advanced-search-btn');
    const spinner = document.getElementById('search-spinner');

    if (searchBox) {
      searchBox.disabled = state.isSearching;
    }

    if (searchBtn) {
      searchBtn.disabled = state.isSearching;
      searchBtn.textContent = state.isSearching ? 'Searching...' : 'Search';
    }

    if (spinner) {
      spinner.style.display = state.isSearching ? 'block' : 'none';
    }
  }

  function displaySearchResults(results, totalCount = 0) {
    const container = document.getElementById('search-results');
    if (!container) {
      // Trigger event for external handler
      const event = new CustomEvent('searchResultsReady', {
        detail: { results, totalCount, query: state.currentQuery },
      });
      document.dispatchEvent(event);
      return;
    }

    if (results.length === 0) {
      container.innerHTML = `
        <div class="search-no-results">
          <div class="no-results-icon">🔍</div>
          <h3>No messages found</h3>
          <p>Try different keywords or adjust your search filters</p>
        </div>
      `;
      return;
    }

    const html = `
      <div class="search-results-header">
        <h3>Search Results (${totalCount})</h3>
        <button onclick="window.EF_Search.clearSearch()" class="ef-cta btn-secondary">Clear</button>
      </div>
      <div class="search-results-list">
        ${results.map(result => renderSearchResult(result)).join('')}
      </div>
    `;

    container.innerHTML = html;
  }

  function renderSearchResult(result) {
    return `
      <div class="search-result-item" onclick="window.EF_Search.openMessage('${result._id}')">
        <div class="search-result-header">
          <span class="search-result-from">${escapeHtml(result.from || 'Unknown')}</span>
          <span class="search-result-date">${formatDate(result.createdAt)}</span>
        </div>
        <div class="search-result-subject">${escapeHtml(result.subject || '(No subject)')}</div>
        ${result.preview ? `<div class="search-result-preview">${escapeHtml(result.preview)}</div>` : ''}
        ${
          result.labels?.length > 0
            ? `
          <div class="search-result-labels">
            ${result.labels.map(label => `<span class="result-label">${escapeHtml(label)}</span>`).join('')}
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  // ==========================================
  // AUTOCOMPLETE
  // ==========================================

  function showAutocompleteSuggestions(suggestions) {
    const dropdown = document.getElementById('search-autocomplete');
    if (!dropdown) {
      return;
    }

    if (!suggestions || suggestions.length === 0) {
      dropdown.style.display = 'none';
      state.showAutocomplete = false;
      return;
    }

    const html = suggestions
      .map(
        suggestion => `
      <div 
        class="autocomplete-item" 
        data-suggestion="${escapeHtml(suggestion.text)}"
        onclick="window.EF_Search.applySuggestion('${escapeHtml(suggestion.text)}')"
      >
        <div class="autocomplete-operator">${escapeHtml(suggestion.operator || '')}</div>
        <div class="autocomplete-description">${escapeHtml(suggestion.description || suggestion.text)}</div>
      </div>
    `
      )
      .join('');

    dropdown.innerHTML = html;
    dropdown.style.display = 'block';
    state.showAutocomplete = true;
  }

  function hideAutocomplete() {
    const dropdown = document.getElementById('search-autocomplete');
    if (dropdown) {
      dropdown.style.display = 'none';
    }
    state.showAutocomplete = false;
  }

  function applySuggestion(suggestion) {
    const searchBox = document.getElementById('advanced-search-input');
    if (!searchBox) {
      return;
    }

    // Insert suggestion at cursor position or append
    const cursorPos = searchBox.selectionStart;
    const currentValue = searchBox.value;

    // Find the start of the current word
    let wordStart = cursorPos;
    while (wordStart > 0 && !/\s/.test(currentValue[wordStart - 1])) {
      wordStart--;
    }

    const newValue =
      currentValue.substring(0, wordStart) +
      suggestion +
      (suggestion.endsWith(':') ? '' : ' ') +
      currentValue.substring(cursorPos);

    searchBox.value = newValue;
    searchBox.focus();

    // Set cursor position after suggestion
    const newCursorPos = wordStart + suggestion.length + (suggestion.endsWith(':') ? 0 : 1);
    searchBox.setSelectionRange(newCursorPos, newCursorPos);

    hideAutocomplete();
  }

  // ==========================================
  // SAVED SEARCHES
  // ==========================================

  function saveSearch(query, name) {
    if (!query || !name) {
      return;
    }

    const savedSearch = {
      id: Date.now().toString(),
      name,
      query,
      createdAt: new Date().toISOString(),
    };

    state.savedSearches.push(savedSearch);
    localStorage.setItem('ef_saved_searches', JSON.stringify(state.savedSearches));
    renderSavedSearches();
    showSuccess('Search saved');
  }

  function deleteSavedSearch(id) {
    state.savedSearches = state.savedSearches.filter(s => s.id !== id);
    localStorage.setItem('ef_saved_searches', JSON.stringify(state.savedSearches));
    renderSavedSearches();
    showSuccess('Search deleted');
  }

  function loadSavedSearch(id) {
    const saved = state.savedSearches.find(s => s.id === id);
    if (!saved) {
      return;
    }

    const searchBox = document.getElementById('advanced-search-input');
    if (searchBox) {
      searchBox.value = saved.query;
      executeSearch(saved.query);
    }
  }

  function renderSavedSearches() {
    const container = document.getElementById('saved-searches-list');
    if (!container) {
      return;
    }

    if (state.savedSearches.length === 0) {
      container.innerHTML = `
        <div class="saved-searches-empty">
          <p>No saved searches yet</p>
        </div>
      `;
      return;
    }

    const html = state.savedSearches
      .map(
        saved => `
      <div class="saved-search-item">
        <div class="saved-search-content" onclick="window.EF_Search.loadSavedSearch('${saved.id}')">
          <div class="saved-search-name">${escapeHtml(saved.name)}</div>
          <div class="saved-search-query">${escapeHtml(saved.query)}</div>
        </div>
        <button 
          class="ef-cta saved-search-delete" 
          onclick="event.stopPropagation(); window.EF_Search.deleteSavedSearch('${saved.id}')"
          title="Delete"
        >
          ×
        </button>
      </div>
    `
      )
      .join('');

    container.innerHTML = html;
  }

  function showSaveSearchModal() {
    const currentQuery = document.getElementById('advanced-search-input')?.value;
    if (!currentQuery) {
      showError('Please enter a search query first');
      return;
    }

    createModal(
      'Save Search',
      `
      <form id="save-search-form" class="search-form">
        <div class="form-group">
          <label for="search-name">Search Name *</label>
          <input type="text" id="search-name" name="name" required maxlength="100" placeholder="e.g., Unread from Boss">
        </div>
        
        <div class="form-group">
          <label>Query</label>
          <div class="search-query-display">${escapeHtml(currentQuery)}</div>
        </div>
        
        <div class="modal-actions">
          <button type="button" onclick="window.EF_Search.closeModal()" class="ef-cta btn-secondary">Cancel</button>
          <button type="submit" class="ef-cta btn-primary">Save Search</button>
        </div>
      </form>
    `
    );

    document.getElementById('save-search-form').addEventListener('submit', e => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const name = formData.get('name');

      saveSearch(currentQuery, name);
      closeModal();
    });
  }

  // ==========================================
  // SEARCH HELP
  // ==========================================

  function showSearchHelp() {
    createModal(
      'Search Operators',
      `
      <div class="search-help">
        <p class="search-help-intro">Use these operators to refine your search:</p>
        
        <div class="operators-list">
          ${Object.entries(SEARCH_OPERATORS)
            .map(
              ([op, desc]) => `
            <div class="operator-item">
              <code class="operator-code">${op}</code>
              <span class="operator-desc">${desc}</span>
            </div>
          `
            )
            .join('')}
        </div>
        
        <div class="search-help-examples">
          <h4>Examples:</h4>
          <ul>
            <li><code>from:john@example.com is:unread</code></li>
            <li><code>subject:invoice after:2025-01-01</code></li>
            <li><code>has:attachment larger:5mb</code></li>
            <li><code>(from:alice OR from:bob) is:starred</code></li>
          </ul>
        </div>
        
        <div class="modal-actions">
          <button onclick="window.EF_Search.closeModal()" class="ef-cta btn-primary">Got it</button>
        </div>
      </div>
    `
    );
  }

  // ==========================================
  // EVENT HANDLERS
  // ==========================================

  function handleSearchInput(event) {
    const query = event.target.value;
    const cursorPos = event.target.selectionStart;

    // Get current word being typed
    let wordStart = cursorPos;
    while (wordStart > 0 && !/\s/.test(query[wordStart - 1])) {
      wordStart--;
    }

    const currentWord = query.substring(wordStart, cursorPos);

    // Show autocomplete for operators
    if (currentWord.length > 0 && !currentWord.includes(':')) {
      const suggestions = Object.entries(SEARCH_OPERATORS)
        .filter(([op]) => op.startsWith(currentWord.toLowerCase()))
        .map(([op, desc]) => ({
          text: op,
          operator: op,
          description: desc,
        }));

      if (suggestions.length > 0) {
        showAutocompleteSuggestions(suggestions);
      } else {
        hideAutocomplete();
      }
    } else if (currentWord.includes(':')) {
      // Show value suggestions based on operator
      const [operator] = currentWord.split(':');
      const operatorKey = `${operator}:`;

      if (operatorKey === 'is:') {
        const suggestions = STATUS_VALUES.map(value => ({
          text: operatorKey + value,
          description: value,
        }));
        showAutocompleteSuggestions(suggestions);
      } else if (operatorKey === 'has:') {
        const suggestions = HAS_VALUES.map(value => ({
          text: operatorKey + value,
          description: value,
        }));
        showAutocompleteSuggestions(suggestions);
      } else {
        hideAutocomplete();
      }
    } else {
      hideAutocomplete();
    }
  }

  function handleSearchKeydown(event) {
    // Submit search on Enter
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const query = event.target.value.trim();
      if (query) {
        executeSearch(query);
      }
    }

    // Hide autocomplete on Escape
    if (event.key === 'Escape') {
      hideAutocomplete();
    }
  }

  // ==========================================
  // UTILITIES
  // ==========================================

  function clearSearch() {
    const searchBox = document.getElementById('advanced-search-input');
    if (searchBox) {
      searchBox.value = '';
    }

    state.currentQuery = '';
    state.searchResults = [];

    const container = document.getElementById('search-results');
    if (container) {
      container.innerHTML = '';
    }

    // Trigger clear event
    const event = new CustomEvent('searchCleared');
    document.dispatchEvent(event);

    // Reload all messages if handler exists
    if (typeof window.loadMessages === 'function') {
      window.loadMessages();
    }
  }

  function openMessage(messageId) {
    // Trigger message open event
    const event = new CustomEvent('openMessage', { detail: { messageId } });
    document.dispatchEvent(event);

    // Call global handler if exists
    if (typeof window.openMessageById === 'function') {
      window.openMessageById(messageId);
    }
  }

  function createModal(title, content) {
    const existingModal = document.querySelector('.modal-overlay');
    if (existingModal) {
      existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>${escapeHtml(title)}</h3>
          <button onclick="window.EF_Search.closeModal()" class="ef-cta modal-close">&times;</button>
        </div>
        <div class="modal-body">
          ${content}
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Close on overlay click
    modal.addEventListener('click', e => {
      if (e.target === modal) {
        closeModal();
      }
    });

    // Close on Escape key
    const escapeHandler = e => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    document.addEventListener('keydown', escapeHandler);

    return modal;
  }

  function closeModal() {
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
      modal.remove();
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function formatDate(dateString) {
    if (!dateString) {
      return '';
    }
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return 'Today';
    }
    if (days === 1) {
      return 'Yesterday';
    }
    if (days < 7) {
      return `${days} days ago`;
    }

    return date.toLocaleDateString();
  }

  function showSuccess(message) {
    showToast(message, 'success');
  }

  function showError(message) {
    showToast(message, 'error');
  }

  function showToast(message, type = 'info') {
    // Use existing toast system if available
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
      return;
    }

    // Fallback simple toast
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6'};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ==========================================
  // INITIALIZATION
  // ==========================================

  function init() {
    // Load operators
    loadOperators();

    // Render saved searches
    renderSavedSearches();

    // Setup event listeners
    const searchBox = document.getElementById('advanced-search-input');
    if (searchBox) {
      searchBox.addEventListener('input', handleSearchInput);
      searchBox.addEventListener('keydown', handleSearchKeydown);
    }

    const searchBtn = document.getElementById('advanced-search-btn');
    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        const query = searchBox?.value.trim();
        if (query) {
          executeSearch(query);
        }
      });
    }

    // Close autocomplete when clicking outside
    document.addEventListener('click', e => {
      const dropdown = document.getElementById('search-autocomplete');
      const searchBox = document.getElementById('advanced-search-input'); // skipcq: JS-0123 - local to this click handler, unrelated to the outer setup-scope searchBox

      if (dropdown && searchBox && !dropdown.contains(e.target) && e.target !== searchBox) {
        hideAutocomplete();
      }
    });
  }

  // ==========================================
  // PUBLIC API
  // ==========================================

  window.EF_Search = {
    init,
    executeSearch,
    clearSearch,
    openMessage,
    applySuggestion,
    saveSearch,
    deleteSavedSearch,
    loadSavedSearch,
    showSaveSearchModal,
    showSearchHelp,
    closeModal,
    getState: () => ({ ...state }),
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
