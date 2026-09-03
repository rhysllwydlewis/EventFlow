/**
 * Suppliers Page Enhancements
 * Applies P3 features to supplier listings.
 */

'use strict';
(function () {
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
  }

  /**
   * Enhance supplier cards with P3 features.
   * Keep observing because filters and pagination replace the result cards.
   */
  function enhanceSupplierCards() {
    const enhanceVisibleCards = () => {
      document
        .querySelectorAll('.sp-card[data-supplier-id], .supplier-card[data-supplier-id]')
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
