/**
 * EventFlow UK locations — analytics for the hub and city pages
 *
 * The pages themselves are fully server-rendered; this script adds measurement
 * only. Nothing here is required for the content to be readable, and nothing
 * here writes a visitor's postcode anywhere: the location dimension is always
 * the published city slug, never the text someone typed into a search box.
 */

(function () {
  'use strict';

  /**
   * Read a meta tag's content.
   * @param {string} name Meta name.
   * @returns {string} Content, or an empty string.
   */
  function metaContent(name) {
    const tag = document.querySelector(`meta[name="${name}"]`);
    return tag ? tag.getAttribute('content') || '' : '';
  }

  const pageType = metaContent('ef-page-type');
  if (!pageType) {
    return;
  }

  const locationSlug = metaContent('ef-location-slug');
  const categorySlug = metaContent('ef-category-slug');

  /**
   * Send an event to the analytics layer, if one is present and consented.
   * @param {string} name Event name.
   * @param {Object} params Event parameters.
   * @returns {void} Nothing.
   */
  function track(name, params) {
    if (typeof window.gtag !== 'function') {
      return;
    }
    const payload = { page_type: pageType };
    if (locationSlug) {
      payload.location_slug = locationSlug;
    }
    if (categorySlug) {
      payload.category_slug = categorySlug;
    }
    Object.keys(params || {}).forEach(key => {
      payload[key] = params[key];
    });
    window.gtag('event', name, payload);
  }

  track('location_page_view', {});

  const cards = document.querySelectorAll('[data-supplier-id]');

  // Impressions are counted once each, when the card actually reaches the
  // viewport, so a long city page does not report twenty views nobody saw.
  if (cards.length && typeof window.IntersectionObserver === 'function') {
    const seen = new WeakSet();
    const observer = new window.IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting || seen.has(entry.target)) {
            return;
          }
          seen.add(entry.target);
          observer.unobserve(entry.target);
          track('location_supplier_impression', {
            supplier_id: entry.target.getAttribute('data-supplier-id'),
            relationship: entry.target.getAttribute('data-relationship'),
          });
        });
      },
      { threshold: 0.5 }
    );
    cards.forEach(card => observer.observe(card));
  }

  document.addEventListener('click', event => {
    const link = event.target.closest ? event.target.closest('[data-supplier-id] a[href]') : null;
    if (!link) {
      return;
    }
    const card = link.closest('[data-supplier-id]');
    track('location_supplier_click', {
      supplier_id: card.getAttribute('data-supplier-id'),
      relationship: card.getAttribute('data-relationship'),
      destination: link.getAttribute('href'),
    });
  });
})();
