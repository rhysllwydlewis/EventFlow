/**
 * EventFlow UK locations — analytics for the hub and city pages
 *
 * The pages themselves are fully server-rendered; this script adds measurement
 * only. Nothing here is required for the content to be readable, and nothing
 * here writes a visitor's postcode anywhere: the location dimension is always
 * the published city slug, never the text someone typed into a search box.
 */

'use strict';
(function () {
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

  // A hero photograph is hosted off-site, so it can fail for reasons that have
  // nothing to do with us: an image CDN outage, a content blocker, a corporate
  // proxy, or a URL that has since been withdrawn. A broken <img> sprays its
  // alt text across the hero in whatever colour the heading uses, which looks
  // far worse than no photograph at all. Fall back to the placeholder treatment
  // the page already has for a city with no hero.
  const heroMedia = document.querySelector('.efl-hero__media');
  if (heroMedia) {
    const dropHero = () => {
      const visual = heroMedia.closest('.efl-hero__visual');
      heroMedia.remove();
      if (!visual) {
        return;
      }
      visual.classList.add('efl-hero__visual--placeholder');
      // Everything that belonged to the photograph goes with it, so the result
      // is the same markup the server renders for a city that has no hero at
      // all. Leaving the coverage note behind put its label under the
      // placeholder's own `strong` rule, which absolutely positions it — the
      // label then escaped its badge and was clipped at the screen edge.
      visual
        .querySelectorAll('.efl-hero__credit, .efl-hero__image-note')
        .forEach(el => el.remove());
      // Rebuild the same pin-and-city-name treatment the server renders for a
      // city that has no hero at all.
      const pin = document.createElement('span');
      pin.className = 'efl-hero__map-pin';
      pin.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20 10c0 5.5-8 12-8 12S4 15.5 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg>';
      const name = document.createElement('strong');
      name.textContent = visual.getAttribute('data-city-name') || '';
      visual.prepend(pin, name);
    };
    heroMedia.addEventListener('error', dropHero);
    // The image may already have failed before this script ran.
    if (heroMedia.complete && heroMedia.naturalWidth === 0) {
      dropHero();
    }
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
