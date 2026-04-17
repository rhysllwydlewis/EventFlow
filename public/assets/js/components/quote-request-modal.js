/**
 * Quote Request Modal Component
 * Form for requesting quotes from suppliers
 */

import { trackQuoteRequestSubmitted } from '../utils/analytics.js';

class QuoteRequestModal {
  constructor() {
    this.isOpen = false;
    this.container = null;
    this.suppliers = [];
    this.init();
  }

  /**
   * Get CSRF token from cookie
   */
  getCsrfToken() {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'csrf') {
        return value;
      }
    }
    return null;
  }

  /**
   * Initialize the modal
   */
  init() {
    this.createModal();
    this.attachEventListeners();

    // Listen for custom event to open modal
    window.addEventListener('openQuoteRequestModal', e => {
      this.open(e.detail.items || []);
    });
  }

  /**
   * Create modal element
   */
  createModal() {
    const modal = document.createElement('div');
    modal.id = 'quote-request-modal';
    modal.className = 'quote-modal';
    modal.innerHTML = `
      <div class="quote-modal-overlay"></div>
      <div class="quote-modal-content">
        <div class="quote-modal-header">
          <h2>Request Quotes</h2>
          <button class="ef-cta quote-modal-close-btn" aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="quote-modal-body">
          <form id="quote-request-form">
            <div class="quote-suppliers-list" id="quote-suppliers-list">
              <!-- Suppliers will be listed here -->
            </div>

            <div class="form-group">
              <label for="quote-name">Your Name *</label>
              <input type="text" id="quote-name" name="name" required />
            </div>

            <div class="form-group">
              <label for="quote-email">Email *</label>
              <input type="email" id="quote-email" name="email" required />
            </div>

            <div class="form-group">
              <label for="quote-phone">Phone (optional)</label>
              <input type="tel" id="quote-phone" name="phone" />
            </div>

            <div class="form-group">
              <label for="quote-event-type">Event Type *</label>
              <select id="quote-event-type" name="eventType" required>
                <option value="">Select event type</option>
                <option value="Wedding">Wedding</option>
                <option value="Corporate Event">Corporate Event</option>
                <option value="Birthday Party">Birthday Party</option>
                <option value="Anniversary">Anniversary</option>
                <option value="Engagement">Engagement</option>
                <option value="Conference">Conference</option>
                <option value="Festival">Festival</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div class="form-group">
              <label for="quote-event-date">Event Date (optional)</label>
              <input type="date" id="quote-event-date" name="eventDate" />
            </div>

            <div class="form-group">
              <label for="quote-location">Event Location *</label>
              <input type="text" id="quote-location" name="location" required placeholder="e.g., London, Manchester" />
            </div>

            <div class="form-group">
              <label for="quote-budget">Budget *</label>
              <select id="quote-budget" name="budget" required>
                <option value="">Select budget range</option>
                <option value="Under £1,000">Under £1,000</option>
                <option value="£1,000 - £2,000">£1,000 - £2,000</option>
                <option value="£2,000 - £5,000">£2,000 - £5,000</option>
                <option value="£5,000 - £10,000">£5,000 - £10,000</option>
                <option value="Over £10,000">Over £10,000</option>
                <option value="Flexible">Flexible</option>
              </select>
            </div>

            <div class="form-group">
              <label for="quote-notes">Additional Notes (optional)</label>
              <textarea id="quote-notes" name="notes" rows="4" placeholder="Tell suppliers about your requirements..."></textarea>
            </div>

            <div class="quote-modal-actions">
              <button type="button" class="ef-cta btn btn-secondary" id="quote-cancel-btn">Cancel</button>
              <button type="submit" class="ef-cta btn btn-primary" id="quote-submit-btn">
                <span id="quote-submit-text">Send Requests</span>
                <span id="quote-submit-spinner" class="spinner" style="display: none;"></span>
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.container = modal;
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Close button
    const closeBtn = this.container.querySelector('.quote-modal-close-btn');
    closeBtn.addEventListener('click', () => this.close());

    // Cancel button
    const cancelBtn = this.container.querySelector('#quote-cancel-btn');
    cancelBtn.addEventListener('click', () => this.close());

    // Overlay click
    const overlay = this.container.querySelector('.quote-modal-overlay');
    overlay.addEventListener('click', () => this.close());

    // Form submit
    const form = this.container.querySelector('#quote-request-form');
    form.addEventListener('submit', e => {
      e.preventDefault();
      this.submitRequest();
    });

    // ESC key to close
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }

  /**
   * Render suppliers list
   */
  renderSuppliers() {
    const listContainer = this.container.querySelector('#quote-suppliers-list');

    if (this.suppliers.length === 0) {
      listContainer.innerHTML = '<p>No suppliers selected</p>';
      return;
    }

    listContainer.innerHTML = `
      <p class="quote-suppliers-count">Requesting quotes from ${this.suppliers.length} supplier${this.suppliers.length > 1 ? 's' : ''}:</p>
      <ul class="quote-suppliers">
        ${this.suppliers
          .map(
            s => `
          <li class="quote-supplier-item">
            <strong>${s.name}</strong>
            ${s.category ? `<span class="quote-supplier-category">${s.category}</span>` : ''}
          </li>
        `
          )
          .join('')}
      </ul>
    `;
  }

  /**
   * Submit quote request
   */
  async submitRequest() {
    const form = this.container.querySelector('#quote-request-form');
    const formData = new FormData(form);

    const submitBtn = this.container.querySelector('#quote-submit-btn');
    const submitText = this.container.querySelector('#quote-submit-text');
    const submitSpinner = this.container.querySelector('#quote-submit-spinner');

    // Disable submit button
    submitBtn.disabled = true;
    submitText.style.display = 'none';
    submitSpinner.style.display = 'inline-block';

    try {
      const requestData = {
        name: formData.get('name'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        eventType: formData.get('eventType'),
        eventDate: formData.get('eventDate'),
        location: formData.get('location'),
        budget: formData.get('budget'),
        notes: formData.get('notes'),
        suppliers: this.suppliers.map(s => ({
          supplierId: s.id,
          supplierName: s.name,
          category: s.category,
        })),
      };

      const token = this.getCsrfToken();
      const response = await fetch('/api/v1/quote-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'X-CSRF-Token': token }),
        },
        credentials: 'include',
        body: JSON.stringify(requestData),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Track success
        trackQuoteRequestSubmitted(this.suppliers.length, requestData.eventType);

        // Show success message
        this.showSuccess(result.data.suppliersCount);
      } else {
        throw new Error(result.error || 'Failed to submit request');
      }
    } catch (error) {
      console.error('Quote request error:', error);
      this.showError(error.message || 'Failed to submit quote request. Please try again.');

      // Re-enable submit button
      submitBtn.disabled = false;
      submitText.style.display = 'inline';
      submitSpinner.style.display = 'none';
    }
  }

  /**
   * Show error message
   */
  showError(message) {
    const modalBody = this.container.querySelector('.quote-modal-body');

    // Create error message element
    const errorDiv = document.createElement('div');
    errorDiv.className = 'quote-error';
    errorDiv.innerHTML = `
      <div class="quote-error-icon">⚠️</div>
      <p>${message}</p>
    `;
    errorDiv.style.cssText =
      'padding: 16px; margin-bottom: 16px; background: #ffebee; border: 1px solid #f44336; border-radius: 6px; color: #c62828; text-align: center;';

    // Insert at top of modal body
    modalBody.insertBefore(errorDiv, modalBody.firstChild);

    // Remove after 5 seconds
    setTimeout(() => {
      if (errorDiv.parentNode) {
        errorDiv.parentNode.removeChild(errorDiv);
      }
    }, 5000);
  }

  /**
   * Show success message
   */
  showSuccess(supplierCount) {
    const modalBody = this.container.querySelector('.quote-modal-body');
    modalBody.innerHTML = `
      <div class="quote-success">
        <div class="quote-success-icon">✓</div>
        <h3>Quote Requests Sent!</h3>
        <p>Your quote request has been sent to ${supplierCount} supplier${supplierCount > 1 ? 's' : ''}.</p>
        <p>You'll receive responses via email within 24-48 hours.</p>
        <div class="quote-success-actions">
          <button class="ef-cta btn btn-secondary" id="quote-success-close">Close</button>
          <a href="/suppliers" class="btn btn-primary">Back to Search</a>
        </div>
      </div>
    `;

    // Attach close button
    const closeBtn = modalBody.querySelector('#quote-success-close');
    closeBtn.addEventListener('click', () => this.close());
  }

  /**
   * Open modal
   */
  open(items = []) {
    // Convert items to suppliers format
    this.suppliers = items.map(item => ({
      id: item.id,
      name: item.name,
      category: item.category,
    }));

    this.isOpen = true;
    this.container.classList.add('open');
    this.renderSuppliers();
    document.body.style.overflow = 'hidden';
  }

  /**
   * Close modal
   */
  close() {
    this.isOpen = false;
    this.container.classList.remove('open');
    document.body.style.overflow = '';

    // Reset form
    const form = this.container.querySelector('#quote-request-form');
    if (form) {
      form.reset();
    }
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new QuoteRequestModal();
  });
} else {
  new QuoteRequestModal();
}

export default QuoteRequestModal;
