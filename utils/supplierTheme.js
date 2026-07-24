'use strict';

const DEFAULT_THEME_COLOR = '#0B8073';
const VALID_THEME_MODES = Object.freeze(['automatic', 'preset', 'custom']);

const HERO_PRESET_ACCENTS = Object.freeze({
  'ef-teal': '#0B8073',
  midnight: '#0F3460',
  'rose-gold': '#B76E79',
  forest: '#40916C',
  ocean: '#0077B6',
  sunset: '#D62828',
  purple: '#7E22CE',
  charcoal: '#374151',
  blush: '#C2185B',
  champagne: '#9C7C38',
});

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

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

function normaliseThemeColor(value) {
  const candidate = String(value || '').trim();
  return /^#[0-9A-F]{6}$/i.test(candidate) ? candidate.toUpperCase() : null;
}

function normaliseHeroPreset(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return HERO_PRESET_ACCENTS[candidate] ? candidate : null;
}

function normaliseThemeMode(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return VALID_THEME_MODES.includes(candidate) ? candidate : null;
}

function resolveCategoryTheme(category) {
  const key = String(category || '').trim().toLowerCase();
  const family = CATEGORY_THEME_FAMILIES[key] || 'default';
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

function buildSupplierThemeMutation(body = {}, existing = {}) {
  const set = {};
  const unset = {};
  const requestedMode = hasOwn(body, 'themeMode') ? normaliseThemeMode(body.themeMode) : null;

  if (hasOwn(body, 'themeMode') && !requestedMode) {
    return { error: 'Invalid theme mode', set, unset };
  }

  const requestedPreset = hasOwn(body, 'heroPreset')
    ? normaliseHeroPreset(body.heroPreset)
    : null;
  const requestedColor = hasOwn(body, 'themeColor')
    ? normaliseThemeColor(body.themeColor)
    : null;

  if (requestedMode === 'automatic') {
    set.themeMode = 'automatic';
    unset.themeColor = 1;
    unset.heroPreset = 1;
    return { set, unset };
  }

  if (requestedMode === 'preset') {
    if (!requestedPreset) {
      return { error: 'A valid hero preset is required for preset theme mode', set, unset };
    }
    set.themeMode = 'preset';
    set.heroPreset = requestedPreset;
    unset.themeColor = 1;
    return { set, unset };
  }

  if (requestedMode === 'custom') {
    if (!requestedColor) {
      return {
        error: 'A valid six-digit hex colour is required for custom theme mode',
        set,
        unset,
      };
    }
    set.themeMode = 'custom';
    set.themeColor = requestedColor;
    unset.heroPreset = 1;
    return { set, unset };
  }

  // Backwards-compatible inference for existing clients that do not send themeMode.
  if (hasOwn(body, 'heroPreset')) {
    if (body.heroPreset === null || String(body.heroPreset).trim() === '') {
      unset.heroPreset = 1;
      set.themeMode = normaliseThemeColor(existing.themeColor) ? 'custom' : 'automatic';
      return { set, unset };
    }
    if (!requestedPreset) {
      return { error: 'Invalid hero preset', set, unset };
    }
    set.themeMode = 'preset';
    set.heroPreset = requestedPreset;
    unset.themeColor = 1;
    return { set, unset };
  }

  if (hasOwn(body, 'themeColor')) {
    if (body.themeColor === null || String(body.themeColor).trim() === '') {
      unset.themeColor = 1;
      set.themeMode = normaliseHeroPreset(existing.heroPreset) ? 'preset' : 'automatic';
      return { set, unset };
    }
    if (!requestedColor) {
      return { error: 'Invalid theme colour', set, unset };
    }

    // The legacy customisation page always submits EF teal, even when the supplier
    // did not edit their theme. Preserve an existing preset, or category-driven
    // automatic mode, instead of silently turning an unrelated save into custom teal.
    const existingMode = normaliseThemeMode(existing.themeMode);
    const existingPreset = normaliseHeroPreset(existing.heroPreset);
    const isLegacyImplicitDefault =
      requestedColor === DEFAULT_THEME_COLOR &&
      !normaliseThemeColor(existing.themeColor) &&
      existingMode !== 'custom';
    if (isLegacyImplicitDefault) {
      if (existingPreset) {
        set.themeMode = 'preset';
      } else {
        set.themeMode = 'automatic';
        unset.heroPreset = 1;
      }
      unset.themeColor = 1;
      return { set, unset };
    }

    set.themeMode = 'custom';
    set.themeColor = requestedColor;
    unset.heroPreset = 1;
  }

  return { set, unset };
}

module.exports = {
  CATEGORY_ACCENTS,
  CATEGORY_THEME_FAMILIES,
  DEFAULT_THEME_COLOR,
  HERO_PRESET_ACCENTS,
  VALID_THEME_MODES,
  buildSupplierThemeMutation,
  normaliseHeroPreset,
  normaliseStoredSupplierTheme,
  normaliseThemeColor,
  normaliseThemeMode,
  resolveCategoryTheme,
  resolveSupplierTheme,
};
