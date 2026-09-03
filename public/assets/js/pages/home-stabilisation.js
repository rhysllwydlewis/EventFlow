/*
 * Homepage stabilisation layer
 *
 * Keeps launch-state content honest when production data is empty, delayed or
 * unavailable. This file intentionally runs after home-init.js so it can correct
 * legacy static fallbacks without disrupting the existing homepage components.
 */
'use strict';
(function () {
  const STATS_ENDPOINT = '/api/v1/public/stats';
  const MARKETPLACE_ENDPOINT = '/api/v1/marketplace/listings?limit=12';
  const REVIEWS_ENDPOINT = '/api/v1/reviews?limit=3&sort=rating';

  let hasInitialised = false;

  function isDebugEnabled() {
    try {
      return window.DEBUG === true || new URLSearchParams(window.location.search).has('debug');
    } catch (_) {
      return false;
    }
  }

  function debugLog(...args) {
    if (isDebugEnabled()) {
      console.log('[Homepage Stabilisation]', ...args);
    }
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value === null || value === undefined ? '' : String(value);
    return div.innerHTML;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  function getStatValue(stats, key) {
    const raw = Number(stats && stats[key]);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  }

  function updateStats(stats) {
    const section = document.getElementById('stats-section');
    if (!section) {
      return;
    }

    const config = [
      // This counts suppliers whose listing has been approved for publication —
      // EventFlow does not perform identity, insurance or capability verification
      // (see /terms), so the public label must say "Approved", never "Verified".
      { key: 'suppliersVerified', label: 'Approved Suppliers' },
      { key: 'packagesApproved', label: 'Packages Available' },
      { key: 'marketplaceListingsActive', label: 'Marketplace Items' },
      { key: 'reviewsApproved', label: 'Customer Reviews' },
    ];

    const values = config.map(item => ({ ...item, value: getStatValue(stats, item.key) }));
    const hasAnyRealStats = values.some(item => item.value > 0);

    if (!hasAnyRealStats) {
      section.style.display = 'none';
      section.setAttribute('aria-hidden', 'true');
      debugLog('Stats hidden because all public stats are zero');
      return;
    }

    section.style.display = '';
    section.removeAttribute('aria-hidden');

    const statCards = section.querySelectorAll('.ef-stat');
    values.forEach((item, index) => {
      const card = statCards[index];
      if (!card) {
        return;
      }

      if (item.value <= 0) {
        card.style.display = 'none';
        card.setAttribute('aria-hidden', 'true');
        return;
      }

      card.style.display = '';
      card.removeAttribute('aria-hidden');

      const number = card.querySelector('.ef-stat__number');
      const label = card.querySelector('.ef-stat__label');
      if (number) {
        number.dataset.counter = String(item.value);
        number.dataset.suffix = '+';
        number.dataset.counted = 'true';
        number.textContent = `${item.value.toLocaleString('en-GB')}+`;
      }
      if (label) {
        label.textContent = item.label;
      }
    });
  }

  async function stabiliseStats() {
    const section = document.getElementById('stats-section');
    if (!section) {
      return;
    }

    // Prevent inflated fallback counters from animating before the real API result arrives.
    section.querySelectorAll('.ef-stat__number').forEach(number => {
      number.dataset.counter = '0';
      number.dataset.suffix = '';
      number.textContent = '0';
    });

    try {
      const stats = await fetchJson(STATS_ENDPOINT);
      updateStats(stats);
    } catch (error) {
      section.style.display = 'none';
      section.setAttribute('aria-hidden', 'true');
      debugLog('Stats unavailable; section hidden', error.message);
    }
  }

  function renderMarketplaceComingSoon(container) {
    container.innerHTML = `
      <div class="ef-card ef-card--center" style="max-width: 760px; margin: 0 auto;">
        <div class="ef-card__icon" aria-hidden="true">🛍️</div>
        <h3 class="ef-card__title">Marketplace launching soon</h3>
        <p class="ef-card__text" style="max-width: 560px; margin: 0 auto;">
          Buy and sell pre-loved event items safely. Live listings will appear here once the marketplace is open.
        </p>
      </div>
    `;
  }

  function updateMarketplaceHeader(hasListings) {
    const section = document.getElementById('marketplace-preview-section');
    if (!section) {
      return;
    }

    const title = section.querySelector('.ef-section__title');
    const subtitle = section.querySelector('.ef-section__subtitle');
    const button = section.querySelector('a.ef-btn');

    if (hasListings) {
      if (title) {
        title.textContent = 'Latest Items for Sale';
      }
      if (subtitle) {
        subtitle.textContent =
          'Buy and sell pre-loved event items — dresses, décor, AV gear and more';
      }
      if (button) {
        button.textContent = 'View All Marketplace Items';
        button.href = '/marketplace';
      }
      return;
    }

    if (title) {
      title.textContent = 'Marketplace launching soon';
    }
    if (subtitle) {
      subtitle.textContent =
        'Pre-loved event items will appear here once marketplace listings are open.';
    }
    if (button) {
      button.textContent = 'View Marketplace Updates';
      button.href = '/marketplace';
    }
  }

  async function stabiliseMarketplace() {
    const container = document.getElementById('marketplace-preview');
    if (!container) {
      return;
    }

    try {
      const data = await fetchJson(MARKETPLACE_ENDPOINT);
      const listings = Array.isArray(data && data.listings) ? data.listings : [];
      if (listings.length === 0) {
        updateMarketplaceHeader(false);
        renderMarketplaceComingSoon(container);
      } else {
        updateMarketplaceHeader(true);
      }
    } catch (error) {
      updateMarketplaceHeader(false);
      renderMarketplaceComingSoon(container);
      debugLog('Marketplace unavailable; showing launch state', error.message);
    }
  }

  function hideTestimonials() {
    const section = document.getElementById('testimonials-section');
    if (section) {
      section.style.display = 'none';
      section.setAttribute('aria-hidden', 'true');
    }
  }

  function renderTestimonials(reviews) {
    const section = document.getElementById('testimonials-section');
    const container = document.getElementById('ef-testimonials-carousel');
    if (!section || !container) {
      return;
    }

    const displayed = reviews.slice(0, 3);
    if (displayed.length === 0) {
      hideTestimonials();
      return;
    }

    section.style.display = '';
    section.removeAttribute('aria-hidden');
    const subtitle = section.querySelector('.ef-section__subtitle');
    if (subtitle) {
      subtitle.textContent = 'Verified feedback from approved EventFlow reviews';
    }

    container.innerHTML = displayed
      .map((review, index) => {
        const rating = Math.max(1, Math.min(5, Number(review.rating) || 5));
        const comment = String(review.comment || '').trim();
        const truncated = comment.length > 200 ? `${comment.slice(0, 200)}…` : comment;
        return `
          <div class="ef-testimonial${index === 0 ? ' active' : ''}" aria-hidden="${index === 0 ? 'false' : 'true'}">
            <div class="ef-testimonial-content">
              <div class="ef-testimonial-stars" aria-label="${rating} out of 5 stars">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</div>
              <p class="ef-testimonial-quote">&quot;${escapeHtml(truncated)}&quot;</p>
              <div class="ef-testimonial-author">
                <strong>${escapeHtml(review.customerName || 'Anonymous customer')}</strong>
                <span class="ef-testimonial-event">${escapeHtml(review.supplierName || 'EventFlow review')}</span>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    const dots = section.querySelector('.ef-testimonials-dots');
    if (dots) {
      dots.innerHTML = displayed
        .map(
          (_, index) =>
            `<button type="button" role="tab" aria-selected="${index === 0 ? 'true' : 'false'}" aria-label="View testimonial ${index + 1}" data-testimonial="${index}" class="ef-testimonial-dot${index === 0 ? ' active' : ''}"></button>`
        )
        .join('');
    }
  }

  async function stabiliseTestimonials() {
    try {
      const data = await fetchJson(REVIEWS_ENDPOINT);
      const reviews = Array.isArray(data && data.reviews) ? data.reviews : [];
      renderTestimonials(reviews.filter(review => review && review.comment));
    } catch (error) {
      hideTestimonials();
      debugLog('Reviews unavailable; testimonials hidden', error.message);
    }
  }

  function stabiliseSupplierClaim() {
    const supplierCta = document.querySelector('.ef-section--supplier-cta');
    if (!supplierCta) {
      return;
    }
    const claim = Array.from(supplierCta.querySelectorAll('p')).find(p =>
      /Join over 500\+ verified suppliers/i.test(p.textContent || '')
    );
    if (claim) {
      // Must not swap one unsupported claim for another — EventFlow does not
      // verify supplier identity, insurance or capability (see /terms).
      claim.textContent = 'Join EventFlow as we grow our approved supplier network';
    }
  }

  function stabiliseVersionLabels() {
    document.querySelectorAll('.version').forEach(version => {
      if (!isDebugEnabled()) {
        version.style.display = 'none';
        version.setAttribute('aria-hidden', 'true');
      }
    });
  }

  function runStabilisation() {
    if (hasInitialised) {
      return;
    }
    hasInitialised = true;

    stabiliseSupplierClaim();
    stabiliseVersionLabels();
    stabiliseStats();
    stabiliseMarketplace();
    stabiliseTestimonials();

    // The legacy homepage initialisers also fetch marketplace/review data. Run a
    // short second pass so honest empty states win if those async fallbacks finish
    // after this layer.
    window.setTimeout(() => {
      stabiliseMarketplace();
      stabiliseTestimonials();
    }, 750);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runStabilisation, { once: true });
  } else {
    runStabilisation();
  }
})();
