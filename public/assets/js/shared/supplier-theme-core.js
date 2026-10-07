/**
 * Supplier profile theme definitions and resolver — the single source of truth.
 *
 * Environment-neutral on purpose: the server requires it (utils/supplierTheme.js,
 * which adds the PATCH mutation builder on top) and browsers load it as a
 * classic script that publishes `window.EFSupplierTheme`, so the public profile,
 * the inline owner editor and the Profile Customisation page all resolve a
 * supplier's effective theme the same way. Adding a preset or a category family
 * is one edit here.
 *
 * Accents are stored upper-case; callers that compare or emit lower-case colours
 * lower-case them at their own boundary.
 */
'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.EFSupplierTheme = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const DEFAULT_THEME_COLOR = '#0B8073';
  const VALID_THEME_MODES = Object.freeze(['automatic', 'preset', 'custom']);

  /** Named hero presets, in the order editors show them. */
  const HERO_PRESETS = Object.freeze(
    [
      ['ef-teal', 'EventFlow', '#0B8073', 'linear-gradient(135deg,#0B8073 0%,#13B6A2 100%)'],
      ['midnight', 'Midnight', '#0F3460', 'linear-gradient(135deg,#1a1a2e 0%,#0f3460 100%)'],
      ['rose-gold', 'Rose Gold', '#B76E79', 'linear-gradient(135deg,#b76e79 0%,#f9c8c8 100%)'],
      ['forest', 'Forest', '#40916C', 'linear-gradient(135deg,#1b4332 0%,#40916c 100%)'],
      ['ocean', 'Ocean', '#0077B6', 'linear-gradient(135deg,#03045e 0%,#00b4d8 100%)'],
      ['sunset', 'Sunset', '#D62828', 'linear-gradient(135deg,#f77f00 0%,#d62828 100%)'],
      ['purple', 'Purple', '#7E22CE', 'linear-gradient(135deg,#3d0066 0%,#a855f7 100%)'],
      ['charcoal', 'Charcoal', '#374151', 'linear-gradient(135deg,#1a1a1a 0%,#4a5568 100%)'],
      ['blush', 'Blush', '#C2185B', 'linear-gradient(135deg,#c2185b 0%,#ff80ab 100%)'],
      ['champagne', 'Champagne', '#9C7C38', 'linear-gradient(135deg,#9c7c38 0%,#e8d5a3 100%)'],
    ].map(([id, label, accent, gradient]) => Object.freeze({ id, label, accent, gradient }))
  );

  const HERO_PRESET_ACCENTS = Object.freeze(
    Object.fromEntries(HERO_PRESETS.map(preset => [preset.id, preset.accent]))
  );
  const HERO_PRESET_GRADIENTS = Object.freeze(
    Object.fromEntries(HERO_PRESETS.map(preset => [preset.id, preset.gradient]))
  );

  const CATEGORY_THEME_FAMILIES = Object.freeze({
    wedding: 'wedding',
    weddings: 'wedding',
    'wedding planner': 'wedding',
    'event planner': 'wedding',
    planning: 'wedding',
    'wedding fayre': 'wedding',
    stationery: 'wedding',
    celebrant: 'wedding',
    photography: 'photography',
    photographer: 'photography',
    videography: 'photography',
    videographer: 'photography',
    catering: 'catering',
    caterer: 'catering',
    food: 'catering',
    cake: 'catering',
    music: 'music',
    'music/dj': 'music',
    dj: 'music',
    band: 'music',
    musicians: 'music',
    entertainment: 'entertainment',
    flowers: 'flowers',
    florist: 'flowers',
    floral: 'flowers',
    decor: 'flowers',
    venue: 'venue',
    venues: 'venue',
    transport: 'transport',
    cars: 'transport',
    chauffeur: 'transport',
    beauty: 'beauty',
    'hair & makeup': 'beauty',
    bridalwear: 'beauty',
    jewellery: 'beauty',
    other: 'default',
  });

  const CATEGORY_ACCENTS = Object.freeze({
    wedding: '#B76E79',
    photography: '#1A3A5C',
    catering: '#7F5539',
    music: '#6A0DAD',
    entertainment: '#C2185B',
    flowers: '#386641',
    venue: '#4A5568',
    transport: '#1A6B8A',
    beauty: '#9D174D',
    default: DEFAULT_THEME_COLOR,
  });

  function normaliseThemeColor(value) {
    const candidate = String(value || '').trim();
    return /^#[0-9A-F]{6}$/i.test(candidate) ? candidate.toUpperCase() : null;
  }

  function normaliseHeroPreset(value) {
    const candidate = String(value || '')
      .trim()
      .toLowerCase();
    return Object.prototype.hasOwnProperty.call(HERO_PRESET_ACCENTS, candidate) ? candidate : null;
  }

  function normaliseThemeMode(value) {
    const candidate = String(value || '')
      .trim()
      .toLowerCase();
    return VALID_THEME_MODES.includes(candidate) ? candidate : null;
  }

  function resolveCategoryTheme(category) {
    const key = String(category || '')
      .trim()
      .toLowerCase();
    const family = Object.prototype.hasOwnProperty.call(CATEGORY_THEME_FAMILIES, key)
      ? CATEGORY_THEME_FAMILIES[key]
      : 'default';
    return { family, accent: CATEGORY_ACCENTS[family] || DEFAULT_THEME_COLOR };
  }

  function normaliseStoredSupplierTheme(supplier = {}) {
    const storedMode = normaliseThemeMode(supplier.themeMode);
    const themeColor = normaliseThemeColor(supplier.themeColor);
    const heroPreset = normaliseHeroPreset(supplier.heroPreset);

    if (storedMode === 'automatic') {
      return { themeMode: 'automatic', themeColor: null, heroPreset: null };
    }
    if (storedMode === 'preset' && heroPreset) {
      return { themeMode: 'preset', themeColor: null, heroPreset };
    }
    if (storedMode === 'custom' && themeColor) {
      return { themeMode: 'custom', themeColor, heroPreset: null };
    }

    // Legacy records had no explicit mode. Preserve their effective historical priority.
    if (themeColor) {
      return { themeMode: 'custom', themeColor, heroPreset: null };
    }
    if (heroPreset) {
      return { themeMode: 'preset', themeColor: null, heroPreset };
    }
    return { themeMode: 'automatic', themeColor: null, heroPreset: null };
  }

  /**
   * The theme a supplier's profile actually renders with.
   * @param {Object} [supplier] Supplier record (themeMode/themeColor/heroPreset/category).
   * @returns {{themeMode: string, themeColor: ?string, heroPreset: ?string, accent: string, source: string, categoryFamily?: string}}
   *   `source` is 'themeColor', 'heroPreset', 'category' or 'default'.
   */
  function resolveSupplierTheme(supplier = {}) {
    const stored = normaliseStoredSupplierTheme(supplier);
    if (stored.themeMode === 'custom') {
      return { ...stored, accent: stored.themeColor, source: 'themeColor' };
    }
    if (stored.themeMode === 'preset') {
      return {
        ...stored,
        accent: HERO_PRESET_ACCENTS[stored.heroPreset],
        source: 'heroPreset',
      };
    }
    const category = resolveCategoryTheme(supplier.category);
    return {
      ...stored,
      accent: category.accent,
      source: category.family === 'default' ? 'default' : 'category',
      categoryFamily: category.family,
    };
  }

  /**
   * What the profile hero shows when there is no uploaded banner. This is
   * deliberately not the same precedence as the accent: for a legacy record that
   * stores both a preset and a colour, the hero keeps the preset's artwork while
   * the colour drives the accent used across the rest of the page.
   * @param {Object} [supplier] Supplier record.
   * @returns {{kind: 'preset'|'color'|'category'|'default', heroPreset: ?string, themeColor: ?string, categoryFamily: ?string}}
   */
  function resolveHeroVisual(supplier = {}) {
    const mode = normaliseThemeMode(supplier.themeMode);
    const heroPreset = normaliseHeroPreset(supplier.heroPreset);
    const themeColor = normaliseThemeColor(supplier.themeColor);
    const family = resolveCategoryTheme(supplier.category).family;
    const fallback =
      family === 'default'
        ? { kind: 'default', heroPreset: null, themeColor: null, categoryFamily: null }
        : { kind: 'category', heroPreset: null, themeColor: null, categoryFamily: family };

    if (mode === 'preset') {
      return heroPreset
        ? { kind: 'preset', heroPreset, themeColor: null, categoryFamily: null }
        : fallback;
    }
    if (mode === 'custom') {
      return themeColor
        ? { kind: 'color', heroPreset: null, themeColor, categoryFamily: null }
        : fallback;
    }
    if (mode === 'automatic') {
      return fallback;
    }
    // Legacy records had no explicit mode: preset artwork first, then colour.
    if (heroPreset) {
      return { kind: 'preset', heroPreset, themeColor: null, categoryFamily: null };
    }
    if (themeColor) {
      return { kind: 'color', heroPreset: null, themeColor, categoryFamily: null };
    }
    return fallback;
  }

  return Object.freeze({
    CATEGORY_ACCENTS,
    CATEGORY_THEME_FAMILIES,
    DEFAULT_THEME_COLOR,
    HERO_PRESETS,
    HERO_PRESET_ACCENTS,
    HERO_PRESET_GRADIENTS,
    VALID_THEME_MODES,
    normaliseHeroPreset,
    normaliseStoredSupplierTheme,
    normaliseThemeColor,
    normaliseThemeMode,
    resolveCategoryTheme,
    resolveHeroVisual,
    resolveSupplierTheme,
  });
});
