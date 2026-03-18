/**
 * EventFlow Supplier Comparison Tool
 * Side-by-side supplier comparison component
 */

class SupplierComparison {
  constructor(options = {}) {
    this.options = {
      container: options.container || '#supplier-comparison',
      suppliers: options.suppliers || [],
      maxSuppliers: options.maxSuppliers || 3,
      onSupplierAdd: options.onSupplierAdd || null,
      onSupplierRemove: options.onSupplierRemove || null,
      onCompare: options.onCompare || null,
    };

    this.container = null;
    this.suppliers = this.options.suppliers;

    this.init();
  }

  init() {
    const containerEl =
      typeof this.options.container === 'string'
        ? document.querySelector(this.options.container)
        : this.options.container;

    if (!containerEl) {
      console.error('Comparison container not found');
      return;
    }

    this.container = containerEl;
    this.render();
    this.injectStyles();
  }

  render() {
    this.container.innerHTML = `
      <div class="supplier-comparison">
        <div class="comparison-header">
          <h2>Compare Suppliers</h2>
          <button class="btn btn-secondary" id="add-supplier-btn" ${this.suppliers.length >= this.options.maxSuppliers ? 'disabled' : ''}>
            + Add Supplier (${this.suppliers.length}/${this.options.maxSuppliers})
          </button>
        </div>
        
        <div class="comparison-container">
          ${this.suppliers.length === 0 ? this.renderEmpty() : this.renderComparison()}
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  renderEmpty() {
    return `
      <div class="comparison-empty">
        <div class="empty-icon">📊</div>
        <h3>No suppliers selected</h3>
        <p>Add suppliers to compare their services, pricing, and ratings side by side</p>
        <button class="btn btn-primary" id="add-first-supplier">Add Your First Supplier</button>
      </div>
    `;
  }

  renderComparison() {
    return `
      <div class="comparison-grid" style="grid-template-columns: 200px repeat(${this.suppliers.length}, 1fr)">
        <!-- Header Row -->
        <div class="comparison-cell comparison-header-cell"></div>
        ${this.suppliers
          .map(
            (supplier, index) => `
          <div class="comparison-cell comparison-supplier-header">
            <div class="supplier-header-content">
              ${
                supplier.photoUrl
                  ? `
                <img src="${supplier.photoUrl}" alt="${this.escapeHtml(supplier.name)}" class="supplier-avatar">
              `
                  : `
                <div class="supplier-avatar-placeholder">${supplier.name.charAt(0)}</div>
              `
              }
              <h3>${this.escapeHtml(supplier.name)}</h3>
              <div class="supplier-rating">
                ${this.renderStars(supplier.rating || 0)}
                <span class="rating-text">${supplier.rating?.toFixed(1) || 'N/A'}</span>
              </div>
              <button class="btn-remove" data-action="remove" data-index="${index}">×</button>
            </div>
          </div>
        `
          )
          .join('')}

        <!-- Price Row -->
        <div class="comparison-cell comparison-label-cell">
          <strong>Starting Price</strong>
        </div>
        ${this.suppliers
          .map(
            supplier => `
          <div class="comparison-cell">
            <div class="comparison-value comparison-price">
              ${supplier.startingPrice ? `£${supplier.startingPrice.toLocaleString()}` : 'Contact for quote'}
            </div>
          </div>
        `
          )
          .join('')}

        <!-- Category Row -->
        <div class="comparison-cell comparison-label-cell">
          <strong>Category</strong>
        </div>
        ${this.suppliers
          .map(
            supplier => `
          <div class="comparison-cell">
            <div class="comparison-value">
              <span class="category-badge">${this.escapeHtml(supplier.category || 'N/A')}</span>
            </div>
          </div>
        `
          )
          .join('')}

        <!-- Location Row -->
        <div class="comparison-cell comparison-label-cell">
          <strong>Location</strong>
        </div>
        ${this.suppliers
          .map(
            supplier => `
          <div class="comparison-cell">
            <div class="comparison-value">${this.escapeHtml(supplier.location || 'N/A')}</div>
          </div>
        `
          )
          .join('')}

        <!-- Reviews Row -->
        <div class="comparison-cell comparison-label-cell">
          <strong>Reviews</strong>
        </div>
        ${this.suppliers
          .map(
            supplier => `
          <div class="comparison-cell">
            <div class="comparison-value">${supplier.reviewCount || 0} reviews</div>
          </div>
        `
          )
          .join('')}

        <!-- Experience Row -->
        <div class="comparison-cell comparison-label-cell">
          <strong>Years Experience</strong>
        </div>
        ${this.suppliers
          .map(
            supplier => `
          <div class="comparison-cell">
            <div class="comparison-value">${supplier.yearsExperience || 'N/A'}</div>
          </div>
        `
          )
          .join('')}

        <!-- Capacity Row -->
        <div class="comparison-cell comparison-label-cell">
          <strong>Guest Capacity</strong>
        </div>
        ${this.suppliers
          .map(
            supplier => `
          <div class="comparison-cell">
            <div class="comparison-value">
              ${supplier.minGuests || 0} - ${supplier.maxGuests || 'Unlimited'}
            </div>
          </div>
        `
          )
          .join('')}

        <!-- Amenities Row -->
        <div class="comparison-cell comparison-label-cell">
          <strong>Key Amenities</strong>
        </div>
        ${this.suppliers
          .map(
            supplier => `
          <div class="comparison-cell">
            <div class="comparison-value">
              ${
                supplier.amenities && supplier.amenities.length > 0
                  ? supplier.amenities
                      .slice(0, 3)
                      .map(a => `<span class="amenity-tag">${this.escapeHtml(a)}</span>`)
                      .join('')
                  : '<span class="text-muted">None listed</span>'
              }
            </div>
          </div>
        `
          )
          .join('')}

        <!-- Availability Row -->
        <div class="comparison-cell comparison-label-cell">
          <strong>Availability</strong>
        </div>
        ${this.suppliers
          .map(
            supplier => `
          <div class="comparison-cell">
            <div class="comparison-value ${supplier.available ? 'text-success' : 'text-warning'}">
              ${supplier.available ? '✓ Available' : '⚠ Limited'}
            </div>
          </div>
        `
          )
          .join('')}

        <!-- Response Time Row -->
        <div class="comparison-cell comparison-label-cell">
          <strong>Avg. Response</strong>
        </div>
        ${this.suppliers
          .map(
            supplier => `
          <div class="comparison-cell">
            <div class="comparison-value">${supplier.responseTime || 'N/A'}</div>
          </div>
        `
          )
          .join('')}

        <!-- Action Row -->
        <div class="comparison-cell comparison-label-cell"></div>
        ${this.suppliers
          .map(
            (supplier, index) => `
          <div class="comparison-cell">
            <div class="comparison-actions">
              <button class="btn btn-primary btn-sm" onclick="location.href='/supplier?id=${supplier.id}'">
                View Details
              </button>
              <button class="btn btn-secondary btn-sm" data-action="contact" data-index="${index}">
                Contact
              </button>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  renderStars(rating) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

    return `
      <span class="star-rating">
        ${'★'.repeat(fullStars)}${hasHalfStar ? '⯨' : ''}${'☆'.repeat(emptyStars)}
      </span>
    `;
  }

  attachEventListeners() {
    const addBtn = this.container.querySelector('#add-supplier-btn');
    const addFirstBtn = this.container.querySelector('#add-first-supplier');

    if (addBtn) {
      addBtn.addEventListener('click', () => this.showSupplierSearch());
    }

    if (addFirstBtn) {
      addFirstBtn.addEventListener('click', () => this.showSupplierSearch());
    }

    this.container.addEventListener('click', e => {
      const removeBtn = e.target.closest('[data-action="remove"]');
      if (removeBtn) {
        const index = parseInt(removeBtn.dataset.index);
        this.removeSupplier(index);
      }

      const contactBtn = e.target.closest('[data-action="contact"]');
      if (contactBtn) {
        const index = parseInt(contactBtn.dataset.index);
        this.contactSupplier(this.suppliers[index]);
      }
    });
  }

  showSupplierSearch() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>Add Supplier to Compare</h2>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        </div>
        <div class="modal-body">
          <div class="search-bar">
            <input type="text" id="supplier-search" placeholder="Search suppliers by name..." class="search-input">
          </div>
          <div id="supplier-search-results" class="search-results">
            <p class="text-muted">Type to search for suppliers...</p>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const searchInput = modal.querySelector('#supplier-search');
    const resultsContainer = modal.querySelector('#supplier-search-results');

    let searchTimeout;
    searchInput.addEventListener('input', e => {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();

      if (query.length < 2) {
        resultsContainer.innerHTML =
          '<p class="text-muted">Type at least 2 characters to search...</p>';
        return;
      }

      searchTimeout = setTimeout(() => {
        this.searchSuppliers(query, resultsContainer, modal);
      }, 300);
    });

    modal.addEventListener('click', e => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  async searchSuppliers(query, resultsContainer, modal) {
    resultsContainer.innerHTML = '<div class="loading">Searching...</div>';

    try {
      const response = await fetch(
        `/api/search/suppliers?q=${encodeURIComponent(query)}&perPage=10`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (!data.suppliers || data.suppliers.length === 0) {
        resultsContainer.innerHTML = '<p class="text-muted">No suppliers found.</p>';
        return;
      }

      // Filter out already added suppliers
      const availableSuppliers = data.suppliers.filter(
        s => !this.suppliers.find(existing => existing.id === s.id)
      );

      if (availableSuppliers.length === 0) {
        resultsContainer.innerHTML =
          '<p class="text-muted">All matching suppliers are already added.</p>';
        return;
      }

      resultsContainer.innerHTML = `
        <div class="supplier-results">
          ${availableSuppliers
            .map(
              supplier => `
            <div class="supplier-result-item" data-supplier='${JSON.stringify(supplier)}'>
              ${
                supplier.photoUrl
                  ? `
                <img src="${supplier.photoUrl}" alt="${this.escapeHtml(supplier.name)}" class="result-avatar">
              `
                  : `
                <div class="result-avatar-placeholder">${supplier.name.charAt(0)}</div>
              `
              }
              <div class="result-info">
                <h4>${this.escapeHtml(supplier.name)}</h4>
                <p>${this.escapeHtml(supplier.category || '')}</p>
                <div class="result-meta">
                  ${this.renderStars(supplier.rating || 0)}
                  <span>${supplier.location || ''}</span>
                </div>
              </div>
              <button class="btn btn-primary btn-sm" data-action="add-to-compare">Add</button>
            </div>
          `
            )
            .join('')}
        </div>
      `;

      resultsContainer.addEventListener('click', e => {
        const addBtn = e.target.closest('[data-action="add-to-compare"]');
        if (addBtn) {
          const item = addBtn.closest('.supplier-result-item');
          const supplier = JSON.parse(item.dataset.supplier);
          this.addSupplier(supplier);
          modal.remove();
        }
      });
    } catch (error) {
      console.error('Error searching suppliers:', error);
      resultsContainer.innerHTML =
        '<p class="text-danger">Error searching suppliers. Please try again.</p>';
    }
  }

  addSupplier(supplier) {
    if (this.suppliers.length >= this.options.maxSuppliers) {
      if (typeof showToast === 'function') {
        showToast(
          `Maximum ${this.options.maxSuppliers} suppliers can be compared at once`,
          'warning'
        );
      }
      return;
    }

    this.suppliers.push(supplier);
    this.render();

    if (this.options.onSupplierAdd) {
      this.options.onSupplierAdd(supplier);
    }

    if (typeof showToast === 'function') {
      showToast(`${supplier.name} added to comparison`, 'success');
    }
  }

  removeSupplier(index) {
    if (confirm('Remove this supplier from comparison?')) {
      const removed = this.suppliers.splice(index, 1)[0];
      this.render();

      if (this.options.onSupplierRemove) {
        this.options.onSupplierRemove(removed);
      }
    }
  }

  contactSupplier(supplier) {
    const params = new URLSearchParams({
      new: 'true',
      recipientId: supplier.ownerUserId || '',
      contextType: 'supplier',
      contextId: supplier.id,
      contextTitle: supplier.name || 'Supplier',
    });
    window.location.href = `/messenger/?${params.toString()}`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  injectStyles() {
    if (document.getElementById('supplier-comparison-styles')) {
      return;
    }

    const styles = document.createElement('style');
    styles.id = 'supplier-comparison-styles';
    styles.textContent = `
      .supplier-comparison {
        max-width: 1400px;
        margin: 0 auto;
        padding: 20px;
      }

      .comparison-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 30px;
      }

      .comparison-header h2 {
        margin: 0;
      }

      .comparison-empty {
        text-align: center;
        padding: 80px 20px;
      }

      .empty-icon {
        font-size: 4rem;
        margin-bottom: 20px;
      }

      .comparison-empty h3 {
        margin: 0 0 12px 0;
        color: var(--ink-dark, #0F172A);
      }

      .comparison-empty p {
        color: #64748B;
        margin-bottom: 24px;
      }

      .comparison-grid {

      .comparison-cell {

      .comparison-header-cell {

      .comparison-label-cell {

      .comparison-supplier-header {
        background: var(--ink, #0B8073);
        color: white;
        flex-direction: column;
        padding: 24px 16px;
      }

      .supplier-header-content {
        position: relative;
        text-align: center;
        width: 100%;
      }

      .supplier-avatar {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        object-fit: cover;
        margin-bottom: 12px;
        border: 3px solid white;
      }

      .supplier-avatar-placeholder {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: white;
        color: var(--ink, #0B8073);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2rem;
        font-weight: bold;
        margin: 0 auto 12px;
      }

      .supplier-header-content h3 {
        margin: 0 0 8px 0;
        font-size: 1.125rem;
      }

      .supplier-rating {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      .star-rating {
        color: #FCD34D;
      }

      .rating-text {
        font-size: 0.875rem;
      }

      .btn-remove {
        position: absolute;
        top: -8px;
        right: -8px;
        background: white;
        color: #EF4444;
        border: none;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 1.25rem;
        line-height: 1;
        transition: all 0.2s;
      }

      .btn-remove:hover {
        background: #FEE2E2;
        transform: scale(1.1);
      }

      .comparison-value {
        text-align: center;
      }

      .comparison-price {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--ink, #0B8073);
      }

      .category-badge {
        display: inline-block;
        padding: 4px 12px;
        background: rgba(11, 128, 115, 0.1);
        color: var(--ink, #0B8073);
        border-radius: 12px;
        font-size: 0.875rem;
        font-weight: 500;
      }

      .amenity-tag {

      .text-success {
        color: #10B981;
      }

      .text-warning {
        color: #F59E0B;
      }

      .text-muted {
        color: #94A3B8;
      }

      .text-danger {
        color: #EF4444;
      }

      .comparison-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
      }

      .supplier-results {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .supplier-result-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        border: 1px solid #E2E8F0;
        border-radius: 8px;
        transition: all 0.2s;
      }

      .supplier-result-item:hover {
        border-color: var(--ink, #0B8073);
        background: #F8FAFC;
      }

      .result-avatar {
        width: 50px;
        height: 50px;
        border-radius: 50%;
        object-fit: cover;
      }

      .result-avatar-placeholder {
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: var(--ink, #0B8073);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.25rem;
        font-weight: bold;
      }

      .result-info {
        flex: 1;
      }

      .result-info h4 {
        margin: 0 0 4px 0;
        font-size: 1rem;
      }

      .result-info p {
        margin: 0;
        font-size: 0.875rem;
        color: #64748B;
      }

      .result-meta {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 4px;
        font-size: 0.875rem;
      }

      @media (max-width: 1024px) {
        .comparison-grid {
          overflow-x: auto;
          display: block;
        }

        .comparison-grid > * {
          display: inline-block;
          vertical-align: top;
        }
      }
    `;
    document.head.appendChild(styles);
  }

  getSuppliers() {
    return this.suppliers;
  }

  setSuppliers(suppliers) {
    this.suppliers = suppliers;
    this.render();
  }

  destroy() {
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SupplierComparison;
}
