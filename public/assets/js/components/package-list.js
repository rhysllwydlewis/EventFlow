/**
 * PackageList Component
 * Displays a list of packages with featured-first sorting
 */

class PackageList {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.warn(`PackageList: Container ${containerId} not found`);
      return;
    }
    this.options = {
      sortFeaturedFirst: true,
      showSupplierInfo: true,
      cardLayout: 'grid', // 'grid' or 'list'
      ...options,
    };
    this.packages = [];
    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById('package-list-styles')) {
      return;
    }

    // Ensure badges CSS is loaded
    if (!document.getElementById('badges-css')) {
      const link = document.createElement('link');
      link.id = 'badges-css';
      link.rel = 'stylesheet';
      link.href = '/assets/css/badges.css';
      document.head.appendChild(link);
    }

    const style = document.createElement('style');
    style.id = 'package-list-styles';
    style.textContent = `
      /* Mobile-first approach: base styles for mobile */
      .package-list-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: clamp(16px, 3vw, 24px);
        margin-top: 0;
        contain: layout style;
      }

      .package-card {
        background-color: var(--color-card-bg, #ffffff);
        border: 1px solid var(--color-border, #dee2e6);
        border-radius: clamp(8px, 2vw, 12px);
        overflow: hidden;
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        position: relative;
        display: flex;
        flex-direction: column;
        contain: layout style paint;
        /* Ensure minimum touch target */
        min-height: 48px;
      }

      .package-card:hover,
      .package-card:focus {
        transform: translateY(-2px);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
        outline: 2px solid var(--accent, #13B6A2);
        outline-offset: 2px;
      }

      .package-card:active {
        transform: translateY(0);
      }

      .package-card-featured-badge {
        position: absolute;
        top: clamp(8px, 2vw, 12px);
        right: clamp(8px, 2vw, 12px);
        background-color: var(--accent, #13B6A2);
        color: white;
        padding: clamp(6px, 1.5vw, 8px) clamp(10px, 2vw, 12px);
        border-radius: 20px;
        font-size: clamp(0.7rem, 2vw, 0.75rem);
        font-weight: 600;
        z-index: 2;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      }

      .package-card-badge-test {
        background: #fef3c7 !important;
        color: #92400e !important;
        border: 1px solid #f59e0b !important;
        top: clamp(48px, 10vw, 52px) !important;
      }

      .package-card-image {
        width: 100%;
        height: clamp(180px, 40vw, 220px);
        object-fit: cover;
        display: block;
        background-color: var(--color-bg-secondary, #f8f9fa);
      }

      .package-card-content {
        padding: clamp(16px, 3vw, 20px);
        display: flex;
        flex-direction: column;
        flex: 1;
      }

      .package-card-categories {
        display: flex;
        flex-wrap: wrap;
        gap: clamp(6px, 1.5vw, 8px);
        margin-bottom: clamp(10px, 2vw, 12px);
      }

      .package-card-category-badge {
        background-color: var(--color-bg-secondary, #f8f9fa);
        color: var(--color-text-secondary, #6c757d);
        padding: 4px 10px;
        border-radius: 12px;
        font-size: clamp(0.7rem, 1.8vw, 0.75rem);
        font-weight: 500;
      }

      .package-card-title {
        font-size: clamp(1.1rem, 4vw, 1.25rem);
        font-weight: 600;
        margin: 0 0 clamp(6px, 1.5vw, 8px) 0;
        color: var(--color-text-primary, #212529);
        line-height: 1.3;
        /* Better text wrapping */
        word-wrap: break-word;
        overflow-wrap: break-word;
        hyphens: auto;
      }

      .package-card-description {
        font-size: clamp(0.875rem, 2.2vw, 0.9rem);
        color: var(--color-text-secondary, #6c757d);
        margin: 0 0 clamp(10px, 2vw, 12px) 0;
        line-height: 1.6;
        /* Improved text truncation */
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
        word-wrap: break-word;
      }

      .package-card-supplier {
        display: flex;
        align-items: center;
        gap: clamp(8px, 2vw, 10px);
        margin-bottom: clamp(10px, 2vw, 12px);
        padding: clamp(8px, 2vw, 10px);
        background-color: var(--color-bg-secondary, #f8f9fa);
        border-radius: 8px;
        /* Ensure clickable area meets WCAG AA */
        min-height: 48px;
      }

      .package-card-supplier-link {
        display: flex;
        align-items: center;
        gap: clamp(8px, 2vw, 10px);
        text-decoration: none;
        color: inherit;
        flex: 1;
        /* Ensure touch target */
        min-height: 48px;
        padding: 4px 0;
      }

      .package-card-supplier-link:hover,
      .package-card-supplier-link:focus {
        text-decoration: underline;
        color: var(--accent, #13B6A2);
      }

      .package-card-supplier-avatar {
        width: clamp(32px, 8vw, 40px);
        height: clamp(32px, 8vw, 40px);
        border-radius: 50%;
        object-fit: cover;
        background-color: var(--color-border, #dee2e6);
        flex-shrink: 0;
      }

      .package-card-supplier-name {
        font-size: clamp(0.8rem, 2vw, 0.85rem);
        font-weight: 500;
        color: var(--color-text-primary, #212529);
      }

      .package-card-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: clamp(8px, 2vw, 12px);
        margin-top: auto;
        padding-top: clamp(10px, 2vw, 12px);
        border-top: 1px solid var(--color-border, #dee2e6);
      }

      .package-card-price {
        font-size: clamp(1rem, 2.5vw, 1.1rem);
        font-weight: 600;
        color: var(--accent, #13B6A2);
        white-space: nowrap;
      }

      .package-card-price .price-not-set {
        color: var(--color-text-secondary, #6c757d);
        font-weight: 400;
        font-style: italic;
      }

      .package-card-location {
        font-size: clamp(0.8rem, 2vw, 0.85rem);
        color: var(--color-text-secondary, #6c757d);
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .package-empty-state {
        text-align: center;
        padding: clamp(32px, 8vw, 48px) clamp(16px, 4vw, 24px);
        color: var(--color-text-secondary, #6c757d);
      }

      /* Tablet and larger screens */
      @media (min-width: 600px) {
        .package-list-grid {
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        }
      }

      /* Desktop screens */
      @media (min-width: 1024px) {
        .package-list-grid {
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        }

        .package-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
        }
      }

      /* Reduce motion for accessibility */
      @media (prefers-reduced-motion: reduce) {
        .package-card {
          transition: none;
        }

        .package-card:hover {
          transform: none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  setPackages(packages) {
    this.packages = packages;
    if (this.options.sortFeaturedFirst) {
      this.sortFeaturedFirst();
    }
    this.render();
  }

  sortFeaturedFirst() {
    this.packages.sort((a, b) => {
      const aFeatured = a.featured === true || a.isFeatured === true;
      const bFeatured = b.featured === true || b.isFeatured === true;
      if (aFeatured && !bFeatured) {
        return -1;
      }
      if (!aFeatured && bFeatured) {
        return 1;
      }
      return 0;
    });
  }

  render() {
    if (this.packages.length === 0) {
      this.container.innerHTML = `
        <div class="package-empty-state">
          <p>No packages available in this category yet.</p>
          <p class="small">Check back soon for new offerings!</p>
        </div>
      `;
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'package-list-grid';

    this.packages.forEach(pkg => {
      const card = this.createPackageCard(pkg);
      grid.appendChild(card);
    });

    this.container.innerHTML = '';
    this.container.appendChild(grid);
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
   * Sanitize image URL to replace blocked sources with placeholder
   */
  sanitizeImageUrl(url) {
    if (!url || typeof url !== 'string') {
      return '/assets/images/placeholders/package-event.svg';
    }

    // Check if URL is from a blocked or problematic source
    const blockedDomains = ['source.unsplash.com', 'unsplash.com'];
    try {
      const urlObj = new URL(url);
      if (blockedDomains.some(domain => urlObj.hostname.includes(domain))) {
        return '/assets/images/placeholders/package-event.svg';
      }
    } catch (e) {
      // Invalid URL or relative path - if it starts with /, keep it
      if (url.startsWith('/')) {
        return url;
      }
      return '/assets/images/placeholders/package-event.svg';
    }

    return url;
  }

  createPackageCard(pkg) {
    const card = document.createElement('div');
    card.className = 'package-card';
    card.setAttribute('role', 'article');
    card.setAttribute('tabindex', '0');
    if (pkg.title) {
      card.setAttribute('aria-label', `View ${pkg.title} package details`);
    }

    // Navigate to package detail page
    function navigateToPackage() {
      if (pkg.slug) {
        window.location.href = `/package?slug=${encodeURIComponent(pkg.slug)}`;
      } else if (pkg.id) {
        // Fallback: package.html supports ?id= lookup via the backend
        window.location.href = `/package?id=${encodeURIComponent(String(pkg.id))}`;
      }
      // If neither slug nor id is available, don't navigate
    }

    // Make card clickable
    card.addEventListener('click', e => {
      // Don't navigate if clicking on supplier link
      if (e.target.closest('.package-card-supplier-link')) {
        return;
      }
      navigateToPackage();
    });

    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        navigateToPackage();
      }
    });

    const isFeatured = pkg.featured || pkg.isFeatured || false;
    const isTest = pkg.isTest || false;

    // Build badges with specific classes for styling
    const badges = [];
    if (isFeatured) {
      badges.push(
        '<div class="package-card-featured-badge package-card-badge-featured">Featured</div>'
      );
    }
    if (isTest) {
      badges.push(
        '<div class="package-card-featured-badge package-card-badge-test">🧪 Test data</div>'
      );
    }
    const badgesHtml = badges.join('');

    // Escape HTML to prevent XSS
    const escapeHtml = str => {
      if (!str) {
        return '';
      }
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    };

    // Resolve the best available image: prefer pkg.image, fall back to gallery.
    // Uses resolvePackageImage() from package-image-resolver.js when available,
    // otherwise applies the same inline strategy for safety.
    const rawImageUrl =
      typeof resolvePackageImage === 'function'
        ? resolvePackageImage(pkg)
        : (() => {
            const placeholder = '/assets/images/placeholders/package-event.svg';
            if (pkg.image && pkg.image !== placeholder) {
              return pkg.image;
            }
            if (Array.isArray(pkg.gallery) && pkg.gallery.length > 0) {
              for (const img of pkg.gallery) {
                const url =
                  typeof img === 'string' ? img : img.url || img.src || img.path || img.image;
                if (url && url !== placeholder) {
                  return url;
                }
              }
            }
            return placeholder;
          })();
    const sanitizedImageUrl = this.sanitizeImageUrl(rawImageUrl);
    // Emit debug info when debug mode is active (?debugImages=1 or localStorage)
    if (typeof debugPackageImage === 'function') {
      debugPackageImage(pkg, sanitizedImageUrl);
    }
    const imageUrl = escapeHtml(sanitizedImageUrl);
    const title = escapeHtml(pkg.title);
    const description = escapeHtml(pkg.description || '');
    // Use price_display as primary source, fallback to price for consistency across all views
    const priceValue = pkg.price_display || pkg.price;
    const price = priceValue
      ? escapeHtml(priceValue)
      : '<span class="price-not-set">Price not set</span>';
    const location = pkg.location ? escapeHtml(pkg.location) : '';

    // Build supplier info section if available
    let supplierHtml = '';
    if (this.options.showSupplierInfo && pkg.supplier) {
      const supplierName = escapeHtml(pkg.supplier.name || pkg.supplierName || 'Unknown Supplier');
      const rawSupplierId = pkg.supplier.id || pkg.supplierId;
      const supplierId = rawSupplierId ? encodeURIComponent(String(rawSupplierId)) : '';

      // Sanitize supplier avatar URL
      const rawSupplierAvatar =
        pkg.supplier.avatar ||
        pkg.supplier.logo ||
        pkg.supplierAvatar ||
        '/assets/images/placeholders/avatar.svg';
      const sanitizedSupplierAvatar = this.sanitizeImageUrl(rawSupplierAvatar);
      const supplierAvatar = escapeHtml(sanitizedSupplierAvatar);

      // Build supplier badges (using same logic as SupplierCard component)
      const supplierBadges = [];
      const supplier = pkg.supplier;

      // Test data badge
      if (supplier.isTest) {
        supplierBadges.push(
          '<span class="badge badge-test-data" style="font-size: 0.65rem; padding: 2px 6px;">Test data</span>'
        );
      }

      // Founding supplier badge
      if (supplier.isFounding) {
        supplierBadges.push(
          '<span class="badge badge-founding" style="font-size: 0.65rem; padding: 2px 6px;">Founding</span>'
        );
      }

      // Pro/Pro Plus/Featured tier badges
      const tier =
        supplier.subscriptionTier || supplier.subscription?.tier || (supplier.isPro ? 'pro' : null);

      if (tier === 'featured') {
        supplierBadges.push(
          '<span class="badge badge-featured" style="font-size: 0.65rem; padding: 2px 6px;">Featured</span>'
        );
      } else if (tier === 'pro_plus') {
        supplierBadges.push(
          '<span class="badge badge-pro-plus" style="font-size: 0.65rem; padding: 2px 6px;">Pro Plus</span>'
        );
      } else if (tier === 'pro') {
        supplierBadges.push(
          '<span class="badge badge-pro" style="font-size: 0.65rem; padding: 2px 6px;">Pro</span>'
        );
      }

      // Verification badges
      if (supplier.verifications?.email?.verified) {
        supplierBadges.push(
          '<span class="badge badge-email-verified" style="font-size: 0.65rem; padding: 2px 6px;">✓ Email</span>'
        );
      }
      if (supplier.verifications?.phone?.verified) {
        supplierBadges.push(
          '<span class="badge badge-phone-verified" style="font-size: 0.65rem; padding: 2px 6px;">✓ Phone</span>'
        );
      }
      if (supplier.verifications?.business?.verified) {
        supplierBadges.push(
          '<span class="badge badge-business-verified" style="font-size: 0.65rem; padding: 2px 6px;">✓ Business</span>'
        );
      }

      const supplierBadgesHtml =
        supplierBadges.length > 0
          ? `<div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;">${supplierBadges.join('')}</div>`
          : '';

      // Inline tier icon — use shared EFTierIcon helper if available (tier-icon.js)
      const tierIcon = typeof EFTierIcon !== 'undefined' ? EFTierIcon.render(supplier) : '';

      if (supplierId) {
        supplierHtml = `
          <div class="package-card-supplier">
            <a href="/supplier?id=${supplierId}" class="package-card-supplier-link" data-supplier-link>
              <img src="${supplierAvatar}" alt="${supplierName}" class="package-card-supplier-avatar" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
              <div style="display: none; width: clamp(32px, 8vw, 40px); height: clamp(32px, 8vw, 40px); border-radius: 50%; background: ${PackageList.generateGradient(pkg.supplier.name || supplierName)}; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 1rem;">${supplierName.charAt(0).toUpperCase()}</div>
              <div style="flex: 1;">
                <span class="package-card-supplier-name">${supplierName}</span>${tierIcon}
                ${supplierBadgesHtml}
              </div>
            </a>
          </div>
        `;
      } else {
        supplierHtml = `
          <div class="package-card-supplier">
            <div class="package-card-supplier-link">
              <img src="${supplierAvatar}" alt="${supplierName}" class="package-card-supplier-avatar" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
              <div style="display: none; width: clamp(32px, 8vw, 40px); height: clamp(32px, 8vw, 40px); border-radius: 50%; background: ${PackageList.generateGradient(pkg.supplier.name || supplierName)}; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 1rem;">${supplierName.charAt(0).toUpperCase()}</div>
              <div style="flex: 1;">
                <span class="package-card-supplier-name">${supplierName}</span>${tierIcon}
                ${supplierBadgesHtml}
              </div>
            </div>
          </div>
        `;
      }
    }

    card.innerHTML = `
      ${badgesHtml}
      <img class="package-card-image" src="${imageUrl}" alt="${title}" loading="lazy"
           onerror="this.onerror=null;this.src='/assets/images/placeholders/package-event.svg';">
      <div class="package-card-content">
        <h3 class="package-card-title">${title}</h3>
        <p class="package-card-description">${description}</p>
        ${supplierHtml}
        <div class="package-card-meta">
          <div class="package-card-price">${price}</div>
          ${location ? `<div class="package-card-location"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${location}</div>` : ''}
        </div>
      </div>
    `;

    // Add event listener to supplier link to stop propagation
    const supplierLink = card.querySelector('[data-supplier-link]');
    if (supplierLink) {
      supplierLink.addEventListener('click', e => {
        e.stopPropagation();
      });
    }

    return card;
  }
}

// Export to window
if (typeof window !== 'undefined') {
  window.PackageList = PackageList;
}
