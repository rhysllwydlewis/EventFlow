/** Canonical supplier-category registry shared by Node and the browser. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.EventFlowCategoryLink = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';
  const CATEGORY_DEFINITIONS = Object.freeze(
    [
      ['Venues', 'venues'],
      ['Catering', 'catering'],
      ['Photography', 'photography'],
      ['Videography', 'videography'],
      ['Entertainment', 'entertainment'],
      ['Music/DJ', 'music-dj'],
      ['Florist', 'florist'],
      ['Decor', 'decor'],
      ['Transport', 'transport'],
      ['Cake', 'cake'],
      ['Stationery', 'stationery'],
      ['Hair & Makeup', 'hair-makeup'],
      ['Beauty', 'beauty'],
      ['Bridalwear', 'bridalwear'],
      ['Jewellery', 'jewellery'],
      ['Celebrant', 'celebrant'],
      ['Event Planner', 'event-planner'],
      ['Wedding Fayre', 'wedding-fayre'],
      ['Planning', 'planning'],
      ['Other', 'other'],
    ].map(([name, slug]) => Object.freeze({ name, slug }))
  );

  function normaliseCategoryToken(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/%26/g, '&')
      .replace(/[\s_/&]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function canonicalCategoryValue(value) {
    const candidate = value && typeof value === 'object' ? value.name || value.slug : value;
    const token = normaliseCategoryToken(candidate);
    if (!token) {
      return '';
    }
    const match = CATEGORY_DEFINITIONS.find(
      category =>
        normaliseCategoryToken(category.name) === token ||
        normaliseCategoryToken(category.slug) === token
    );
    return match ? match.name : '';
  }

  function categoryHref(category) {
    const value = canonicalCategoryValue(category);
    return value ? `/suppliers?category=${encodeURIComponent(value)}` : '/suppliers';
  }

  return { CATEGORY_DEFINITIONS, normaliseCategoryToken, canonicalCategoryValue, categoryHref };
});
