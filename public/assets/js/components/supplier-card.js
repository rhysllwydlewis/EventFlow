/**
 * SupplierCard Component
 * Displays supplier information card
 */

class SupplierCard {
  constructor(containerId, supplier = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.warn(`SupplierCard: Container ${containerId} not found`);
      return;
    }
    this.supplier = supplier;
    this.injectStyles();
    // Render is now async, so we call it without awaiting in constructor
    this.render().catch(err => console.error('SupplierCard render error:', err));
  }

  injectStyles() {
    if (document.getElementById('supplier-card-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'supplier-card-styles';
    style.textContent = `
      .supplier-card {
        background-color: var(--color-card-bg, #ffffff) !important;
        border: 1px solid var(--color-border, #dee2e6) !important;
        border-radius: 12px !important;
        padding: 32px !important;
        margin-top: 24px !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05) !important;
        display: block !important;
        grid-template-columns: unset !important;
      }

      .supplier-card-header {
        display: flex !important;
        align-items: flex-start !important;
        gap: 24px !important;
        margin-bottom: 24px !important;
        width: 100% !important;
      }

      .supplier-card-logo {
        width: 100px !important;
        height: 100px !important;
        border-radius: 50% !important;
        object-fit: cover !important;
        border: 2px solid var(--color-border, #dee2e6) !important;
        flex-shrink: 0 !important;
        background-color: var(--color-bg-secondary, #f8f9fa) !important;
      }

      .supplier-card-info {
        flex: 1 !important;
        min-width: 0 !important;
        width: 100% !important;
        display: block !important;
      }

      .supplier-card-name {
        font-size: 1.75rem !important;
        font-weight: 700 !important;
        margin: 0 0 8px 0 !important;
        color: var(--color-text-primary, #212529) !important;
        line-height: 1.3 !important;
        word-wrap: break-word !important;
        overflow-wrap: break-word !important;
        white-space: normal !important;
        display: block !important;
        width: 100% !important;
      }

      .supplier-card-blurb {
        font-size: 1rem !important;
        color: var(--color-text-secondary, #6c757d) !important;
        margin: 0 0 12px 0 !important;
        line-height: 1.5 !important;
        word-wrap: break-word !important;
        overflow-wrap: break-word !important;
        white-space: normal !important;
        display: block !important;
        width: 100% !important;
      }

      .supplier-badges {
        display: flex !important;
        flex-wrap: wrap !important;
        gap: 0.5rem !important;
        margin-top: 0.5rem !important;
        width: 100% !important;
      }

      .supplier-card-description {
        font-size: 0.95rem !important;
        color: var(--color-text-primary, #212529) !important;
        line-height: 1.7 !important;
        margin-bottom: 20px !important;
        word-wrap: break-word !important;
        overflow-wrap: break-word !important;
        display: block !important;
      }

      .supplier-card-meta {
        display: grid !important;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)) !important;
        gap: 16px !important;
        margin-top: 20px !important;
        padding: 20px 0 !important;
        border-top: 1px solid var(--color-border, #dee2e6) !important;
        border-bottom: 1px solid var(--color-border, #dee2e6) !important;
      }

      .supplier-card-meta-item {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        font-size: 0.95rem !important;
        color: var(--color-text-secondary, #6c757d) !important;
        word-wrap: break-word !important;
        overflow-wrap: break-word !important;
      }

      .supplier-card-meta-icon {
        font-size: 1.3rem !important;
        flex-shrink: 0 !important;
      }

      .supplier-card-actions {
        margin-top: 24px !important;
        display: flex !important;
        gap: 12px !important;
        flex-wrap: wrap !important;
        align-items: center !important;
      }

      .supplier-card-btn {
        padding: 12px 24px !important;
        border-radius: 8px !important;
        font-size: 1rem !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        border: none !important;
        transition: all 0.2s ease !important;
        text-decoration: none !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        white-space: nowrap !important;
        /* Ensure focusable for accessibility */
        outline-offset: 2px !important;
      }
      
      .supplier-card-btn:focus {
        outline: 2px solid var(--accent, #13B6A2) !important;
      }

      .supplier-card-btn.primary {
        background-color: var(--accent, #13B6A2) !important;
        color: white !important;
        box-shadow: 0 2px 4px rgba(19, 182, 162, 0.2) !important;
      }

      .supplier-card-btn.primary:hover {
        background-color: var(--ink, #0B8073) !important;
        transform: translateY(-2px) !important;
        box-shadow: 0 4px 8px rgba(19, 182, 162, 0.3) !important;
      }

      .supplier-card-btn.secondary {
        background-color: var(--color-bg-secondary, #f8f9fa) !important;
        color: var(--color-text-primary, #212529) !important;
        border: 1px solid var(--color-border, #dee2e6) !important;
      }

      .supplier-card-btn.secondary:hover {
        background-color: #e2e6ea !important;
        transform: translateY(-1px) !important;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1) !important;
      }

      /* Desktop-specific improvements */
      @media (min-width: 769px) {
        .supplier-card {
          padding: 40px !important;
        }

        .supplier-card-header {
          gap: 32px !important;
        }

        .supplier-card-logo {
          width: 120px !important;
          height: 120px !important;
        }
      }

      @media (max-width: 768px) {
        .supplier-card {
          padding: 20px !important;
        }

        .supplier-card-header {
          flex-direction: column !important;
          align-items: center !important;
          text-align: center !important;
          gap: 16px !important;
        }

        .supplier-card-logo {
          width: 90px !important;
          height: 90px !important;
        }

        .supplier-card-meta {
          grid-template-columns: 1fr !important;
          gap: 12px !important;
        }

        .supplier-card-actions {
          flex-direction: column !important;
          width: 100% !important;
        }

        .supplier-card-btn {
          width: 100% !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  renderBadges() {
    const badges = [];

    // Test data badge (show first for visibility)
    if (this.supplier.isTest) {
      badges.push('<span class="badge badge-test-data">Test data</span>');
    }

    // Founding supplier badge (check both founding and isFounding properties)
    if (this.supplier.isFounding || this.supplier.founding) {
      badges.push('<span class="badge badge-founding">Founding Supplier</span>');
    }

    // Pro/Pro Plus/Featured tier badges
    // Check subscriptionTier field first (new), then fall back to subscription.tier or isPro
    const tier =
      this.supplier.subscriptionTier ||
      this.supplier.subscription?.tier ||
      (this.supplier.isPro ? 'pro' : null);

    if (tier === 'featured') {
      badges.push('<span class="badge badge-featured">Featured</span>');
    } else if (tier === 'pro_plus') {
      badges.push('<span class="badge badge-pro-plus">Professional Plus</span>');
    } else if (tier === 'pro') {
      badges.push('<span class="badge badge-pro">Professional</span>');
    }

    // Featured supplier badge (check both featured boolean and featuredSupplier properties)
    if (this.supplier.featured || this.supplier.featuredSupplier) {
      badges.push('<span class="badge badge-featured">⭐ Featured</span>');
    }

    // Verification badges
    if (this.supplier.verifications) {
      if (this.supplier.verifications.email && this.supplier.verifications.email.verified) {
        badges.push('<span class="badge badge-email-verified">Email Verified</span>');
      }
      if (this.supplier.verifications.phone && this.supplier.verifications.phone.verified) {
        badges.push('<span class="badge badge-phone-verified">Phone Verified</span>');
      }
      if (this.supplier.verifications.business && this.supplier.verifications.business.verified) {
        badges.push('<span class="badge badge-business-verified">Business Verified</span>');
      }
    }

    return badges.length > 0 ? `<div class="supplier-badges">${badges.join('')}</div>` : '';
  }

  /**
   * Sanitize image URL to replace blocked sources with fallback
   */
  sanitizeImageUrl(url) {
    if (!url || typeof url !== 'string') {
      return null;
    }

    // Check if URL is from a blocked or problematic source
    const blockedDomains = ['source.unsplash.com', 'unsplash.com'];
    try {
      const urlObj = new URL(url);
      if (blockedDomains.some(domain => urlObj.hostname.includes(domain))) {
        return null; // Return null to trigger fallback rendering
      }
    } catch (e) {
      // Invalid URL - if it starts with /, keep it
      if (url.startsWith('/')) {
        return url;
      }
      return null;
    }

    return url;
  }

  /**
   * Generate gradient based on supplier name for consistent avatar colors
   */
  static generateGradient(name) {
    const colors = [
      ['#13B6A2', '#0B8073'],
      ['#8B5CF6', '#6D28D9'],
      ['#F59E0B', '#D97706'],
      ['#10B981', '#059669'],
      ['#3B82F6', '#2563EB'],
      ['#EC4899', '#DB2777'],
    ];
    const index = name ? name.charCodeAt(0) % colors.length : 0;
    return `linear-gradient(135deg, ${colors[index][0]} 0%, ${colors[index][1]} 100%)`;
  }

  /**
   * Get fallback image for test suppliers using Pexels
   */
  async getTestSupplierFallback(category) {
    // Only fetch Pexels for test suppliers
    if (!this.supplier.isTest) {
      return null;
    }

    // Check if pexelsClient is available
    if (typeof window.pexelsClient === 'undefined') {
      return null;
    }

    try {
      const photoUrl = await window.pexelsClient.getPhotoForCategory(category, 'small');
      return photoUrl;
    } catch (error) {
      console.warn('Failed to get Pexels fallback:', error);
      return null;
    }
  }

  async render() {
    // Ensure badges CSS is loaded
    if (!document.getElementById('badges-css')) {
      const link = document.createElement('link');
      link.id = 'badges-css';
      link.rel = 'stylesheet';
      link.href = '/assets/css/badges.css';
      document.head.appendChild(link);
    }

    const card = document.createElement('div');
    card.className = 'supplier-card';

    // Sanitize logo URL
    let rawLogo = this.supplier.logo;

    // For test suppliers without a logo, try to get Pexels photo
    if (!rawLogo && this.supplier.isTest && this.supplier.category) {
      rawLogo = await this.getTestSupplierFallback(this.supplier.category);
    }

    const sanitizedLogo = rawLogo ? this.sanitizeImageUrl(rawLogo) : null;
    const hasLogo = sanitizedLogo && sanitizedLogo.trim() !== '';

    const logoHtml = hasLogo
      ? `<img class="supplier-card-logo" src="${sanitizedLogo}" alt="${this.supplier.name} logo">`
      : `<div class="supplier-card-logo" style="background: ${SupplierCard.generateGradient(this.supplier.name)}; display: flex; align-items: center; justify-content: center; color: white; font-size: 2rem; font-weight: 600;">${this.supplier.name ? this.supplier.name.charAt(0).toUpperCase() : 'S'}</div>`;

    const badgesHtml = this.renderBadges();

    // Build inline tier icon (small symbol) for next to the name via shared EFTierIcon helper
    const tierIcon = typeof EFTierIcon !== 'undefined' ? EFTierIcon.render(this.supplier) : '';

    card.innerHTML = `
      <div class="supplier-card-header">
        ${logoHtml}
        <div class="supplier-card-info">
          <h2 class="supplier-card-name">${this.supplier.name || 'Supplier'}${tierIcon}</h2>
          <p class="supplier-card-blurb">${this.supplier.blurb || this.supplier.description_short || ''}</p>
          ${badgesHtml}
        </div>
      </div>

      ${this.supplier.description_long ? `<p class="supplier-card-description">${this.supplier.description_long}</p>` : ''}

      <div class="supplier-card-meta">
        ${this.supplier.category ? `<div class="supplier-card-meta-item"><span class="supplier-card-meta-icon">📂</span> ${this.supplier.category}</div>` : ''}
        ${this.supplier.location ? `<div class="supplier-card-meta-item"><span class="supplier-card-meta-icon">📍</span> ${this.supplier.location}</div>` : ''}
        ${this.supplier.price_display ? `<div class="supplier-card-meta-item"><span class="supplier-card-meta-icon">💰</span> ${this.supplier.price_display}</div>` : ''}
        ${this.supplier.phone ? `<div class="supplier-card-meta-item"><span class="supplier-card-meta-icon">📞</span> ${this.supplier.phone}</div>` : ''}
        ${this.supplier.website ? `<div class="supplier-card-meta-item"><span class="supplier-card-meta-icon">🌐</span> <a href="${this.supplier.website}" target="_blank" rel="noopener">Website</a></div>` : ''}
      </div>

      <div class="supplier-card-actions">
        ${this.supplier.id ? `<a href="/supplier?id=${this.supplier.id}" class="supplier-card-btn primary" data-supplier-id="${this.supplier.id}" data-action="view-profile">View Profile</a>` : ''}
      </div>
    `;

    this.container.innerHTML = '';
    this.container.appendChild(card);
  }
}

// Export to window
if (typeof window !== 'undefined') {
  window.SupplierCard = SupplierCard;
}
