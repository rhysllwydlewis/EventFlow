/**
 * EventFlow homepage — real featured cities
 *
 * The "explore by city" grid ships with four static, always-working links to
 * filtered supplier search, so the section never breaks if this script fails
 * to run. When it succeeds, it replaces those with links straight to the real
 * city guide pages — but only for cities the platform has actually published,
 * fetched live rather than hardcoded, so a homepage link can never point at a
 * page that does not exist yet.
 */

(function () {
  'use strict';

  if (typeof window.fetch !== 'function') {
    return;
  }

  const grid = document.getElementById('ef-home-locations-city-grid');
  if (!grid) {
    return;
  }

  /**
   * Escape text for insertion into markup.
   * @param {string} value Raw value.
   * @returns {string} Escaped value.
   */
  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const PIN_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 10c0 5.5-8 12-8 12S4 15.5 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg>';

  /**
   * Build one city link, in the same markup the static fallback already used.
   * @param {Object} city Featured city.
   * @returns {string} Anchor HTML.
   */
  function renderCity(city) {
    return `<a href="/locations/${encodeURIComponent(city.slug)}"><span class="ef-home-locations__city-pin">${PIN_SVG}</span><span><strong>${escapeHtml(
      city.name
    )}</strong><small>${escapeHtml(city.region || '')}</small></span><b aria-hidden="true">&#8599;</b></a>`;
  }

  window
    .fetch('/api/v1/locations/featured?limit=4', { credentials: 'same-origin' })
    .then(response => (response.ok ? response.json() : null))
    .then(payload => {
      const cities = payload && payload.success && payload.data && payload.data.cities;
      // An empty or failed response is not an error state worth surfacing —
      // the static fallback already covers it, so this simply does nothing.
      if (!Array.isArray(cities) || !cities.length) {
        return;
      }
      grid.innerHTML = cities.map(renderCity).join('');
    })
    .catch(() => {
      // Leave the static fallback exactly as rendered.
    });
})();
