/**
 * EventFlow Global Search (Cmd+K)
 * Quick search overlay with keyboard shortcuts
 */

class GlobalSearch {
  constructor(options = {}) {
    this.options = {
      placeholder: options.placeholder || 'Search suppliers, venues, services...',
      shortcuts: options.shortcuts !== false,
      categories: options.categories || [
        'All',
        'Venues',
        'Catering',
        'Photography',
        'Entertainment',
        'Florists',
      ],
      onSearch: options.onSearch || null,
      onSelect: options.onSelect || null,
    };

    this.isOpen = false;
    this.currentCategory = 'All';
    this.searchResults = [];
    this.selectedIndex = 0;
    this.searchTimeout = null;

    this.init();
  }

  init() {
    this.createOverlay();
    this.attachEventListeners();
    this.injectStyles();
  }

  createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'global-search-overlay';
    overlay.className = 'global-search-overlay';
    overlay.innerHTML = `
      <div class="global-search-modal">
        <div class="global-search-header">
          <div class="search-input-container">
            <span class="search-icon">🔍</span>
            <input type="text" 
                   id="global-search-input" 
                   class="global-search-input" 
                   placeholder="${this.options.placeholder}"
                   autocomplete="off"
                   spellcheck="false">
            <button class="search-close-btn" id="global-search-close">
              <span>ESC</span>
            </button>
          </div>
        </div>
        
        <div class="global-search-categories">
          ${this.options.categories
            .map(
              cat => `
            <button class="category-btn ${cat === this.currentCategory ? 'active' : ''}" 
                    data-category="${cat}">
              ${cat}
            </button>
          `
            )
            .join('')}
        </div>
        
        <div class="global-search-results" id="global-search-results">
          <div class="search-empty">
            <div class="empty-icon">🔎</div>
            <p>Start typing to search</p>
            <div class="search-tips">
              <p><strong>Tips:</strong></p>
              <ul>
                <li>Search by name, location, or category</li>
                <li>Use ↑↓ arrows to navigate</li>
                <li>Press Enter to select</li>
              </ul>
            </div>
          </div>
        </div>
        
        <div class="global-search-footer">
          <div class="keyboard-shortcuts">
            <span class="shortcut"><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
            <span class="shortcut"><kbd>↵</kbd> Select</span>
            <span class="shortcut"><kbd>ESC</kbd> Close</span>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.overlay = overlay;
  }

  attachEventListeners() {
    // Keyboard shortcut (Cmd+K or Ctrl+K)
    if (this.options.shortcuts) {
      document.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          this.toggle();
        }
      });
    }

    // Close button
    const closeBtn = document.getElementById('global-search-close');
    closeBtn.addEventListener('click', () => this.close());

    // Close on overlay click
    this.overlay.addEventListener('click', e => {
      if (e.target === this.overlay) {
        this.close();
      }
    });

    // Close on ESC key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });

    // Search input
    const searchInput = document.getElementById('global-search-input');
    searchInput.addEventListener('input', e => {
      clearTimeout(this.searchTimeout);
      const query = e.target.value.trim();

      if (query.length < 2) {
        this.showEmpty();
        return;
      }

      this.searchTimeout = setTimeout(() => {
        this.performSearch(query);
      }, 300);
    });

    // Keyboard navigation
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectNext();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectPrevious();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.selectCurrent();
      }
    });

    // Category filters
    this.overlay.addEventListener('click', e => {
      const categoryBtn = e.target.closest('.category-btn');
      if (categoryBtn) {
        this.setCategory(categoryBtn.dataset.category);
      }
    });

    // Result clicks
    this.overlay.addEventListener('click', e => {
      const resultItem = e.target.closest('.search-result-item');
      if (resultItem) {
        const index = parseInt(resultItem.dataset.index);
        this.select(this.searchResults[index]);
      }
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
    this.isOpen = true;
    this.overlay.classList.add('active');

    // Focus input after animation
    setTimeout(() => {
      document.getElementById('global-search-input').focus();
    }, 100);

    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  }

  close() {
    this.isOpen = false;
    this.overlay.classList.remove('active');

    // Clear search
    document.getElementById('global-search-input').value = '';
    this.showEmpty();
    this.selectedIndex = 0;

    // Restore body scroll
    document.body.style.overflow = '';
  }

  setCategory(category) {
    this.currentCategory = category;

    // Update active state
    this.overlay.querySelectorAll('.category-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.category === category);
    });

    // Re-run search with new category
    const query = document.getElementById('global-search-input').value.trim();
    if (query.length >= 2) {
      this.performSearch(query);
    }
  }

  async performSearch(query) {
    const resultsContainer = document.getElementById('global-search-results');
    resultsContainer.innerHTML =
      '<div class="search-loading"><div class="spinner"></div> Searching...</div>';

    try {
      const categoryFilter =
        this.currentCategory !== 'All'
          ? `&category=${encodeURIComponent(this.currentCategory)}`
          : '';
      const response = await fetch(
        `/api/search/suppliers?q=${encodeURIComponent(query)}${categoryFilter}&perPage=20`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      this.searchResults = data.suppliers || [];
      this.selectedIndex = 0;

      if (this.searchResults.length === 0) {
        resultsContainer.innerHTML = `
          <div class="search-empty">
            <div class="empty-icon">😔</div>
            <p>No results found for "${this.escapeHtml(query)}"</p>
            <p class="small">Try a different search term or category</p>
          </div>
        `;
        return;
      }

      this.renderResults();

      if (this.options.onSearch) {
        this.options.onSearch(query, this.searchResults);
      }
    } catch (error) {
      console.error('Search error:', error);
      resultsContainer.innerHTML = `
        <div class="search-error">
          <p>Unable to perform search. Please try again.</p>
        </div>
      `;
    }
  }

  renderResults() {
    const resultsContainer = document.getElementById('global-search-results');
    resultsContainer.innerHTML = `
      <div class="search-results-list">
        ${this.searchResults
          .map(
            (result, index) => `
          <div class="search-result-item ${index === this.selectedIndex ? 'selected' : ''}" 
               data-index="${index}">
            ${
              result.photoUrl
                ? `
              <img src="${result.photoUrl}" alt="${this.escapeHtml(result.name)}" class="result-thumbnail">
            `
                : `
              <div class="result-thumbnail-placeholder">${result.name.charAt(0)}</div>
            `
            }
            <div class="result-content">
              <h4>${this.highlightQuery(result.name)}</h4>
              <div class="result-meta">
                <span class="result-category">${this.escapeHtml(result.category || '')}</span>
                ${result.location ? `<span class="result-location">📍 ${this.escapeHtml(result.location)}</span>` : ''}
              </div>
              ${
                result.rating
                  ? `
                <div class="result-rating">
                  ${'★'.repeat(Math.floor(result.rating))}${'☆'.repeat(5 - Math.floor(result.rating))}
                  <span class="rating-count">${result.rating.toFixed(1)}</span>
                </div>
              `
                  : ''
              }
            </div>
            <div class="result-arrow">→</div>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  showEmpty() {
    const resultsContainer = document.getElementById('global-search-results');
    resultsContainer.innerHTML = `
      <div class="search-empty">
        <div class="empty-icon">🔎</div>
        <p>Start typing to search</p>
        <div class="search-tips">
          <p><strong>Tips:</strong></p>
          <ul>
            <li>Search by name, location, or category</li>
            <li>Use ↑↓ arrows to navigate</li>
            <li>Press Enter to select</li>
          </ul>
        </div>
      </div>
    `;
  }

  selectNext() {
    if (this.searchResults.length === 0) {
      return;
    }
    this.selectedIndex = (this.selectedIndex + 1) % this.searchResults.length;
    this.renderResults();
    this.scrollToSelected();
  }

  selectPrevious() {
    if (this.searchResults.length === 0) {
      return;
    }
    this.selectedIndex =
      (this.selectedIndex - 1 + this.searchResults.length) % this.searchResults.length;
    this.renderResults();
    this.scrollToSelected();
  }

  selectCurrent() {
    if (this.searchResults.length > 0) {
      this.select(this.searchResults[this.selectedIndex]);
    }
  }

  select(result) {
    if (this.options.onSelect) {
      this.options.onSelect(result);
    } else {
      // Default: navigate to supplier page
      window.location.href = `/supplier?id=${result.id}`;
    }
    this.close();
  }

  scrollToSelected() {
    const selectedElement = this.overlay.querySelector('.search-result-item.selected');
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  highlightQuery(text) {
    const query = document.getElementById('global-search-input').value.trim();
    if (!query) {
      return this.escapeHtml(text);
    }

    const escapedText = this.escapeHtml(text);
    const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
    return escapedText.replace(regex, '<mark>$1</mark>');
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  injectStyles() {
    if (document.getElementById('global-search-styles')) {
      return;
    }

    const styles = document.createElement('style');
    styles.id = 'global-search-styles';
    styles.textContent = `
      .global-search-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(15, 23, 42, 0.75);
        backdrop-filter: blur(8px);
        z-index: 9999;
        display: none;
        align-items: flex-start;
        justify-content: center;
        padding: 60px 20px;
        overflow-y: auto;
      }

      .global-search-overlay.active {
        display: flex;
        animation: fadeIn 0.2s ease-out;
      }

      .global-search-modal {

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes slideInDown {
        from {
          transform: translateY(-20px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }

      .global-search-header {

      .search-input-container {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .search-icon {
        font-size: 1.5rem;
        color: #94A3B8;
      }

      .global-search-input {

      .global-search-input::placeholder {
        color: #94A3B8;
      }

      .search-close-btn {
        background: #F1F5F9;
        border: none;
        padding: 6px 12px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.75rem;
        color: #64748B;
        font-weight: 500;
        transition: all 0.2s;
      }

      .search-close-btn:hover {
        background: #E2E8F0;
      }

      .global-search-categories {

      .category-btn {

      .category-btn:hover {
        border-color: var(--ink, #0B8073);
        background: rgba(11, 128, 115, 0.05);
      }

      .category-btn.active {
        background: var(--ink, #0B8073);
        color: white;
        border-color: var(--ink, #0B8073);
      }

      .global-search-results {
        max-height: 500px;
        overflow-y: auto;
      }

      .search-results-list {
        padding: 8px;
      }

      .search-result-item {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 16px;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .search-result-item:hover,
      .search-result-item.selected {

      .result-thumbnail {
        width: 48px;
        height: 48px;
        border-radius: 8px;
        object-fit: cover;
      }

      .result-thumbnail-placeholder {
        width: 48px;
        height: 48px;
        border-radius: 8px;
        background: var(--ink, #0B8073);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.25rem;
        font-weight: bold;
      }

      .result-content {
        flex: 1;
      }

      .result-content h4 {

      .result-content mark {
        background: #FEF3C7;
        color: #92400E;
        padding: 0 2px;
      }

      .result-meta {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 0.875rem;
        color: #64748B;
        margin-bottom: 4px;
      }

      .result-category {
        padding: 2px 8px;
        background: rgba(11, 128, 115, 0.1);
        color: var(--ink, #0B8073);
        border-radius: 4px;
        font-size: 0.75rem;
      }

      .result-rating {
        font-size: 0.875rem;
        color: #FCD34D;
      }

      .rating-count {
        color: #64748B;
        margin-left: 4px;
      }

      .result-arrow {
        color: #CBD5E1;
        font-size: 1.25rem;
      }

      .search-empty,
      .search-loading,
      .search-error {
        text-align: center;
        padding: 60px 20px;
        color: #64748B;
      }

      .empty-icon {
        font-size: 3rem;
        margin-bottom: 16px;
      }

      .search-tips {
        margin-top: 24px;
        text-align: left;
        max-width: 300px;
        margin-left: auto;
        margin-right: auto;
      }

      .search-tips p {
        margin: 0 0 8px 0;
      }

      .search-tips ul {
        margin: 0;
        padding-left: 20px;
      }

      .search-tips li {
        margin: 4px 0;
      }

      .global-search-footer {

      .keyboard-shortcuts {
        display: flex;
        gap: 16px;
        justify-content: center;
        font-size: 0.875rem;
        color: #64748B;
      }

      kbd {

      @media (max-width: 768px) {
        .global-search-overlay {
          padding: 20px;
        }

        .global-search-modal {
          border-radius: 12px;
        }

        .global-search-header {
          padding: 16px;
        }

        .global-search-input {
          font-size: 1rem;
        }

        .keyboard-shortcuts {
          flex-wrap: wrap;
          gap: 8px;
        }
      }
    `;
    document.head.appendChild(styles);
  }

  destroy() {
    if (this.overlay) {
      this.overlay.remove();
    }
  }
}

// Auto-initialize on load
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    window.globalSearch = new GlobalSearch();
  });
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GlobalSearch;
}
