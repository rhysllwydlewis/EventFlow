/**
 * Suppliers Page Enhancements
 * Applies P3 features to supplier listings and upgrades legacy supplier links.
 */

(function () {
  'use strict';

  function slugifySupplierName(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70);
  }

  async function supplierSlugToken(supplierId) {
    if (!window.crypto?.subtle || typeof TextEncoder !== 'function') {
      return '';
    }

    const digest = await window.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(String(supplierId || '').trim())
    );

    return Array.from(new Uint8Array(digest))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
  }

  function supplierNameFromCard(card) {
    const nameLink = card.querySelector(
      '.sp-card-name a, .supplier-card__name a, [data-supplier-name]'
    );
    const explicit = card.dataset.supplierName || nameLink?.dataset?.supplierName;
    return String(
      explicit || nameLink?.textContent || card.getAttribute('aria-label') || ''
    ).trim();
  }

  async function upgradeSupplierProfileLinks(card) {
    if (!card || card.dataset.canonicalLinkState === 'ready') {
      return;
    }

    const supplierId = String(card.dataset.supplierId || '').trim();
    const legacyLinks = Array.from(card.querySelectorAll('a[href^="/supplier?id="]'));
    if (!supplierId || legacyLinks.length === 0) {
      card.dataset.canonicalLinkState = 'ready';
      return;
    }

    card.dataset.canonicalLinkState = 'loading';

    try {
      const token = await supplierSlugToken(supplierId);
      const namePart = slugifySupplierName(supplierNameFromCard(card)) || 'supplier';
      if (!token) {
        card.dataset.canonicalLinkState = 'legacy';
        return;
      }

      const canonicalPath = `/supplier/${namePart}--${token}`;
      legacyLinks.forEach(link => {
        link.href = canonicalPath;
      });
      card.dataset.publicProfilePath = canonicalPath;
      card.dataset.canonicalLinkState = 'ready';
    } catch (_error) {
      card.dataset.canonicalLinkState = 'legacy';
    }
  }

  function enhanceCard(card) {
    // Add new badge if supplier is new
    const createdAt = card.dataset.createdAt || card.dataset.supplierCreated;
    if (createdAt && typeof addNewBadgeIfApplicable === 'function') {
      addNewBadgeIfApplicable(card, createdAt);
    }

    // Add photo click handlers for carousel
    const photos = card.querySelectorAll('img[data-supplier-photo]');
    photos.forEach(photo => {
      photo.classList.add('gallery-image');
    });

    upgradeSupplierProfileLinks(card);
  }

  /**
   * Enhance supplier cards with P3 features.
   * Keep observing because filters and pagination replace the result cards.
   */
  function enhanceSupplierCards() {
    const enhanceVisibleCards = () => {
      document
        .querySelectorAll('.supplier-card, [data-supplier-id]')
        .forEach(card => enhanceCard(card));
    };

    const observer = new MutationObserver(enhanceVisibleCards);
    const container = document.querySelector(
      '#results, #suppliers-list, .suppliers-container, #results-container'
    );

    if (container) {
      observer.observe(container, { childList: true, subtree: true });
    }

    enhanceVisibleCards();
    setTimeout(enhanceVisibleCards, 1000);
  }

  /**
   * Add breadcrumbs to suppliers page
   */
  function addBreadcrumbs() {
    // Check if we're on a specific category page
    const params = new URLSearchParams(window.location.search);
    const category = params.get('category');

    const breadcrumbs = [
      { label: 'Home', url: '/' },
      { label: 'Suppliers', url: '/suppliers' },
    ];

    if (category) {
      breadcrumbs.push({ label: category, url: `/suppliers?category=${category}` });
    }

    // Only render if more than 2 items
    if (breadcrumbs.length > 2 && typeof renderBreadcrumbs === 'function') {
      // Create container if it doesn't exist
      let container = document.getElementById('breadcrumb-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'breadcrumb-container';

        const mainContent = document.querySelector('main, #main-content, .container');
        if (mainContent) {
          mainContent.insertBefore(container, mainContent.firstChild);
        }
      }

      renderBreadcrumbs(breadcrumbs);
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      enhanceSupplierCards();
      addBreadcrumbs();
    });
  } else {
    enhanceSupplierCards();
    addBreadcrumbs();
  }
})();
