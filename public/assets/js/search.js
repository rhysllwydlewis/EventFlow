/**
 * EventFlow Global Search
 * Keyboard-accessible search modal with autocomplete and history
 */

class GlobalSearch {
  constructor() {
    this.isOpen = false;
    this.searchHistory = [];
    this.storageKey = 'ef_search_history';
    this.maxHistory = 10;
    this.modal = null;
    this.input = null;
    this.autocompleteTimeout = null;
    this.autocompleteCache = new Map();

    this.loadHistory();
    this.init();
  }

  init() {
    this.createModal();
    this.setupKeyboardShortcut();
    this.initAutocomplete();
  }

  /**
   * Initialize autocomplete for search inputs
   */
  initAutocomplete() {
    const searchInputs = document.querySelectorAll(
      'input[type="search"], .search-input, [data-search-autocomplete]'
    );

    searchInputs.forEach(input => {
      this.attachAutocomplete(input);
    });
  }

  /**
   * Attach autocomplete to a search input
   */
  attachAutocomplete(input) {
    if (input.dataset.autocompleteAttached) {
      return;
    }

    input.dataset.autocompleteAttached = 'true';

    const dropdown = document.createElement('div');
    dropdown.className = 'search-autocomplete-dropdown';
    dropdown.style.display = 'none';

    input.parentElement.style.position = 'relative';
    input.parentElement.appendChild(dropdown);

    const debouncedSearch = this.debounce(query => {
      this.fetchSuggestions(query, input, dropdown);
    }, 300);

    input.addEventListener('input', e => {
      const query = e.target.value.trim();

      if (query.length >= 2) {
        debouncedSearch(query);
      } else {
        dropdown.style.display = 'none';
      }
    });

    input.addEventListener('keydown', e => {
      this.handleAutocompleteKeyboard(e, dropdown);
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        dropdown.style.display = 'none';
      }, 200);
    });

    document.addEventListener('click', e => {
      if (!input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });

    if (!document.getElementById('autocomplete-styles')) {
      this.addAutocompleteStyles();
    }
  }

  /**
   * Fetch suggestions from API
   */
  async fetchSuggestions(query, input, dropdown) {
    if (this.autocompleteCache.has(query)) {
      this.renderSuggestions(this.autocompleteCache.get(query), input, dropdown);
      return;
    }

    try {
      const endpoints = [
        `/api/search/suggestions?q=${encodeURIComponent(query)}`,
        `/api/v2/search/autocomplete?q=${encodeURIComponent(query)}`,
      ];

      let suggestions = null;

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, {
            credentials: 'include',
            headers: {
              Accept: 'application/json',
            },
          });

          if (response.ok) {
            const data = await response.json();
            suggestions = data.suggestions || data.items || data.results || [];
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!suggestions) {
        suggestions = this.generateMockSuggestions(query);
      }

      this.autocompleteCache.set(query, suggestions);

      if (this.autocompleteCache.size > 50) {
        const firstKey = this.autocompleteCache.keys().next().value;
        this.autocompleteCache.delete(firstKey);
      }

      this.renderSuggestions(suggestions, input, dropdown);
    } catch (error) {
      console.error('Autocomplete error:', error);
      dropdown.style.display = 'none';
    }
  }

  /**
   * Generate mock suggestions for fallback
   */
  generateMockSuggestions(query) {
    const lowerQuery = query.toLowerCase();
    const mockData = [
      { text: 'Wedding venues', type: 'category', url: '/suppliers.html?category=venues' },
      {
        text: 'Photography services',
        type: 'category',
        url: '/suppliers.html?category=photography',
      },
      { text: 'Catering services', type: 'category', url: '/suppliers.html?category=catering' },
      { text: 'Entertainment', type: 'category', url: '/suppliers.html?category=entertainment' },
      { text: 'Flowers & décor', type: 'category', url: '/suppliers.html?category=flowers' },
    ];

    return mockData.filter(item => item.text.toLowerCase().includes(lowerQuery));
  }

  /**
   * Render suggestions dropdown
   */
  renderSuggestions(suggestions, input, dropdown) {
    if (!suggestions || suggestions.length === 0) {
      dropdown.style.display = 'none';
      return;
    }

    const html = suggestions
      .map((item, index) => {
        const text = item.text || item.name || item.title || '';
        const icon = this.getSuggestionIcon(item.type);

        return `
        <div class="autocomplete-item" data-index="${index}" data-url="${item.url || ''}" data-value="${this.escapeHtml(text)}">
          <span class="autocomplete-icon">${icon}</span>
          <span class="autocomplete-text">${this.escapeHtml(text)}</span>
          ${item.type ? `<span class="autocomplete-type">${this.escapeHtml(item.type)}</span>` : ''}
        </div>
      `;
      })
      .join('');

    dropdown.innerHTML = html;
    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        const value = item.dataset.value;
        const url = item.dataset.url;

        input.value = value;
        dropdown.style.display = 'none';

        if (url) {
          window.location.href = url;
        } else {
          input.form?.submit();
        }
      });
    });
  }

  /**
   * Handle keyboard navigation in autocomplete
   */
  handleAutocompleteKeyboard(e, dropdown) {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (items.length === 0) {
      return;
    }

    const current = dropdown.querySelector('.autocomplete-item.active');
    let index = current ? parseInt(current.dataset.index) : -1;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        index = Math.min(index + 1, items.length - 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        index = Math.max(index - 1, 0);
        break;
      case 'Enter':
        if (current) {
          e.preventDefault();
          current.click();
        }
        return;
      case 'Escape':
        dropdown.style.display = 'none';
        return;
      default:
        return;
    }

    items.forEach((item, i) => {
      if (i === index) {
        item.classList.add('active');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('active');
      }
    });
  }

  /**
   * Get icon for suggestion type
   */
  getSuggestionIcon(type) {
    const icons = {
      supplier: '🏢',
      category: '📂',
      location: '📍',
      package: '📦',
      page: '📄',
      help: '❓',
    };

    return icons[type] || '🔍';
  }

  /**
   * Add autocomplete styles
   */
  addAutocompleteStyles() {
    const style = document.createElement('style');
    style.id = 'autocomplete-styles';
    style.textContent = `
      .search-autocomplete-dropdown {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: white;
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        max-height: 300px;
        overflow-y: auto;
        z-index: 1000;
        margin-top: 4px;
      }
      
      .autocomplete-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      
      .autocomplete-item:hover,
      .autocomplete-item.active {
        background: rgba(11, 128, 115, 0.08);
      }
      
      .autocomplete-icon {
        font-size: 1.25rem;
        flex-shrink: 0;
      }
      
      .autocomplete-text {
        flex: 1;
        color: var(--text, #333);
      }
      
      .autocomplete-type {
        font-size: 0.75rem;
        color: var(--muted, #6b7280);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      
      .autocomplete-item:first-child {
        border-top-left-radius: 8px;
        border-top-right-radius: 8px;
      }
      
      .autocomplete-item:last-child {
        border-bottom-left-radius: 8px;
        border-bottom-right-radius: 8px;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Debounce utility
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  setupKeyboardShortcut() {
    document.addEventListener('keydown', e => {
      // Check for Ctrl+K (Windows/Linux) or Cmd+K (Mac)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.toggle();
      }

      // Close on Escape
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }

  createModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.id = 'search-modal';
    overlay.style.cssText = `
      opacity: 0;
      visibility: hidden;
    `;

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '600px';

    modal.innerHTML = `
      <div class="modal-header" style="border-bottom: none; padding-bottom: 0;">
        <input 
          type="search" 
          id="global-search-input"
          class="focus-ring"
          placeholder="Search suppliers, packages, help articles..."
          style="width: 100%; font-size: 1.125rem; border: none; background: transparent; padding: 0.5rem 0;"
          autocomplete="off"
        >
        <button class="ef-cta modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body" style="padding-top: 1rem; max-height: 400px; overflow-y: auto;">
        <div id="search-results"></div>
        <div id="search-recent" style="display: none;">
          <div class="small mb-2" style="color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em;">Recent Searches</div>
          <div id="recent-searches-list"></div>
        </div>
        <div id="search-suggestions">
          <div class="small mb-2" style="color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em;">Quick Links</div>
          <a href="/suppliers" class="search-result-item">
            <span>Browse All Suppliers</span>
            <span style="color: var(--muted);">→</span>
          </a>
          <a href="/start" class="search-result-item">
            <span>Start Planning</span>
            <span style="color: var(--muted);">→</span>
          </a>
          <a href="/budget" class="search-result-item">
            <span>Budget Tracker</span>
            <span style="color: var(--muted);">→</span>
          </a>
          <a href="/guests" class="search-result-item">
            <span>Guest List Manager</span>
            <span style="color: var(--muted);">→</span>
          </a>
          <a href="/faq" class="search-result-item">
            <span>Help & FAQ</span>
            <span style="color: var(--muted);">→</span>
          </a>
        </div>
      </div>
      <div class="modal-footer" style="border-top: 1px solid var(--border); padding: 0.75rem 1.5rem; background: rgba(148, 163, 184, 0.05);">
        <div class="flex items-center justify-between">
          <div class="small" style="color: var(--muted);">
            <kbd style="padding: 0.125rem 0.375rem; background: var(--border); border-radius: 4px;">↑↓</kbd> to navigate
            <kbd style="padding: 0.125rem 0.375rem; background: var(--border); border-radius: 4px; margin-left: 0.5rem;">↵</kbd> to select
            <kbd style="padding: 0.125rem 0.375rem; background: var(--border); border-radius: 4px; margin-left: 0.5rem;">esc</kbd> to close
          </div>
          <div class="small" style="color: var(--muted);">
            <kbd style="padding: 0.125rem 0.375rem; background: var(--border); border-radius: 4px;">ctrl</kbd>+<kbd style="padding: 0.125rem 0.375rem; background: var(--border); border-radius: 4px;">K</kbd> to open
          </div>
        </div>
      </div>
    `;

    // Add styles for search result items
    const style = document.createElement('style');
    style.textContent = `
      .search-result-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem;
        border-radius: 8px;
        margin-bottom: 0.25rem;
        cursor: pointer;
        transition: background 0.15s ease-out;
        color: var(--text);
        text-decoration: none;
      }
      .search-result-item:hover {
        background: rgba(11, 128, 115, 0.08);
        text-decoration: none;
      }
      .search-result-item.active {
        background: rgba(11, 128, 115, 0.12);
      }
    `;
    document.head.appendChild(style);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    this.modal = overlay;
    this.input = modal.querySelector('#global-search-input');

    // Close on overlay click
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        this.close();
      }
    });

    // Close button
    modal.querySelector('.modal-close').addEventListener('click', () => {
      this.close();
    });

    // Search input handler
    this.input.addEventListener('input', e => {
      this.handleSearch(e.target.value);
    });

    // Keyboard navigation
    this.input.addEventListener('keydown', e => {
      this.handleKeyNavigation(e);
    });
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    this.modal.classList.add('active');
    this.modal.style.opacity = '1';
    this.modal.style.visibility = 'visible';
    this.isOpen = true;

    // Focus input
    setTimeout(() => {
      this.input.focus();
    }, 100);

    // Show recent searches if available
    this.renderRecentSearches();
  }

  close() {
    this.modal.classList.remove('active');
    this.modal.style.opacity = '0';
    this.modal.style.visibility = 'hidden';
    this.isOpen = false;
    this.input.value = '';

    // Reset view
    document.getElementById('search-results').innerHTML = '';
    document.getElementById('search-suggestions').style.display = 'block';
  }

  handleSearch(query) {
    const trimmed = query.trim();

    if (!trimmed) {
      document.getElementById('search-results').innerHTML = '';
      document.getElementById('search-suggestions').style.display = 'block';
      document.getElementById('search-recent').style.display =
        this.searchHistory.length > 0 ? 'block' : 'none';
      return;
    }

    // Hide suggestions, show results
    document.getElementById('search-suggestions').style.display = 'none';
    document.getElementById('search-recent').style.display = 'none';

    // Simulate search results (in production, this would call an API)
    const results = this.performSearch(trimmed);
    this.renderResults(results, trimmed);
  }

  performSearch(query) {
    const lowerQuery = query.toLowerCase();

    // Mock search data - in production, this would search the actual database
    const mockData = [
      {
        type: 'supplier',
        title: 'Garden Venue & Events',
        category: 'Venues',
        url: '/supplier.html?id=1',
      },
      {
        type: 'supplier',
        title: 'Elite Catering Services',
        category: 'Catering',
        url: '/supplier.html?id=2',
      },
      {
        type: 'supplier',
        title: 'Professional Photography',
        category: 'Photography',
        url: '/supplier.html?id=3',
      },
      {
        type: 'page',
        title: 'Budget Tracker',
        description: 'Manage your event budget',
        url: '/budget',
      },
      {
        type: 'page',
        title: 'Guest List Manager',
        description: 'Track RSVPs and guests',
        url: '/guests',
      },
      {
        type: 'help',
        title: 'How to find suppliers?',
        description: 'Browse and filter suppliers',
        url: '/faq.html#suppliers',
      },
      {
        type: 'help',
        title: 'How to create an account?',
        description: 'Sign up process',
        url: '/faq.html#account',
      },
    ];

    // Simple fuzzy search
    return mockData.filter(item => {
      const titleMatch = item.title.toLowerCase().includes(lowerQuery);
      const categoryMatch = item.category && item.category.toLowerCase().includes(lowerQuery);
      const descMatch = item.description && item.description.toLowerCase().includes(lowerQuery);
      return titleMatch || categoryMatch || descMatch;
    });
  }

  renderResults(results, query) {
    const container = document.getElementById('search-results');

    if (results.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--muted);">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
          <div class="small">No results found for "${this.escapeHtml(query)}"</div>
        </div>
      `;
      return;
    }

    const html = results
      .map((result, index) => {
        const icon =
          {
            supplier: '🏢',
            page: '📄',
            help: '❓',
          }[result.type] || '📄';

        return `
        <a href="${result.url}" class="search-result-item" data-index="${index}">
          <div>
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
              <span>${icon}</span>
              <span class="font-medium">${this.highlightMatch(result.title, query)}</span>
              ${result.category ? `<span class="badge subtle">${result.category}</span>` : ''}
            </div>
            ${result.description ? `<div class="small" style="color: var(--muted); margin-left: 1.75rem;">${this.escapeHtml(result.description)}</div>` : ''}
          </div>
          <span style="color: var(--muted);">→</span>
        </a>
      `;
      })
      .join('');

    container.innerHTML = html;

    // Add click handlers to save to history
    container.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        this.addToHistory(query);
        this.close();
      });
    });
  }

  renderRecentSearches() {
    const container = document.getElementById('search-recent');
    const listContainer = document.getElementById('recent-searches-list');

    if (this.searchHistory.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';

    const html = this.searchHistory
      .map(
        query => `
      <div class="search-result-item" onclick="document.getElementById('global-search-input').value = '${this.escapeHtml(query)}'; document.getElementById('global-search-input').dispatchEvent(new Event('input'));">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span style="color: var(--muted);">🕐</span>
          <span>${this.escapeHtml(query)}</span>
        </div>
      </div>
    `
      )
      .join('');

    listContainer.innerHTML = html;
  }

  handleKeyNavigation(e) {
    const results = document.querySelectorAll('.search-result-item');
    if (results.length === 0) {
      return;
    }

    const current = document.querySelector('.search-result-item.active');
    let index = current ? parseInt(current.dataset.index) || 0 : -1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      index = Math.min(index + 1, results.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      index = Math.max(index - 1, 0);
    } else if (e.key === 'Enter' && current) {
      e.preventDefault();
      current.click();
      return;
    } else {
      return;
    }

    // Update active state
    results.forEach((item, i) => {
      if (i === index) {
        item.classList.add('active');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('active');
      }
    });
  }

  addToHistory(query) {
    if (!query || this.searchHistory.includes(query)) {
      return;
    }

    this.searchHistory.unshift(query);
    if (this.searchHistory.length > this.maxHistory) {
      this.searchHistory = this.searchHistory.slice(0, this.maxHistory);
    }

    this.saveHistory();
  }

  loadHistory() {
    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        this.searchHistory = JSON.parse(data);
      }
    } catch (e) {
      console.error('Failed to load search history:', e);
    }
  }

  saveHistory() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.searchHistory));
    } catch (e) {
      console.error('Failed to save search history:', e);
    }
  }

  highlightMatch(text, query) {
    // Escape special regex characters to prevent ReDoS attacks
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return this.escapeHtml(text).replace(
      regex,
      '<mark style="background: rgba(11, 128, 115, 0.2); padding: 0 2px; border-radius: 2px;">$1</mark>'
    );
  }

  escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
      return '';
    }
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Initialize global search
let globalSearch;

document.addEventListener('DOMContentLoaded', () => {
  globalSearch = new GlobalSearch();
  window.GlobalSearch = globalSearch;
});
