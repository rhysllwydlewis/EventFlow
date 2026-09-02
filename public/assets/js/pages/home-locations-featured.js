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

'use strict';
(function () {
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

  /**
   * Keep only an https Pexels CDN URL — the one host this card is allowed to
   * paint into inline `style`, so a malformed or unexpected API value can
   * never inject something else through `background-image`.
   * @param {unknown} value Candidate image URL.
   * @returns {string|null} Safe URL, or null.
   */
  function safePexelsImageUrl(value) {
    try {
      const parsed = new URL(String(value || ''));
      return parsed.protocol === 'https:' && parsed.hostname === 'images.pexels.com'
        ? parsed.toString()
        : null;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Build one city card, in the same markup the static fallback already
   * used. The supplier count is real, live data — it is what turns
   * "Manchester" from a bare place name into a reason to click. The photo is
   * the same curated-or-Pexels hero the city's own page uses, so a card here
   * never shows a photo the city page itself wouldn't stand behind.
   * @param {Object} city Featured city.
   * @returns {string} Anchor HTML.
   */
  function renderCity(city) {
    const meta =
      Number.isFinite(city.supplierCount) && city.supplierCount > 0
        ? `${city.supplierCount.toLocaleString()} supplier${city.supplierCount === 1 ? '' : 's'}`
        : city.region || '';
    const image = safePexelsImageUrl(city.imageUrl);
    // The URL is already host-restricted above; it is still run through
    // escapeHtml before landing inside the style attribute so a stray quote
    // in a query string can never end the attribute or the url(...) early.
    const mediaStyle = image ? ` style="background-image:url('${escapeHtml(image)}')"` : '';
    return `<a class="ef-home-locations__city-card" href="/locations/${encodeURIComponent(city.slug)}"><span class="ef-home-locations__city-card-media" aria-hidden="true"${mediaStyle}></span><b class="ef-home-locations__city-card-arrow" aria-hidden="true">&#8599;</b><span class="ef-home-locations__city-card-body"><strong>${escapeHtml(
      city.name
    )}</strong><small>${escapeHtml(meta)}</small></span></a>`;
  }

  window
    .fetch('/api/v1/locations/featured?limit=6', { credentials: 'same-origin' })
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
