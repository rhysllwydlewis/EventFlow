'use strict';

/**
 * Server-side supplier theme helpers. The theme definitions and the effective-
 * theme resolver live in the environment-neutral shared module so the public
 * profile, the inline owner editor and the Profile Customisation page resolve
 * themes identically; this file adds the PATCH mutation builder on top.
 */
const core = require('../public/assets/js/shared/supplier-theme-core');

const {
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
  resolveSupplierTheme,
} = core;

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

function buildSupplierThemeMutation(body = {}, existing = {}) {
  const set = {};
  const unset = {};
  const requestedMode = hasOwn(body, 'themeMode') ? normaliseThemeMode(body.themeMode) : null;

  if (hasOwn(body, 'themeMode') && !requestedMode) {
    return { error: 'Invalid theme mode', set, unset };
  }

  const requestedPreset = hasOwn(body, 'heroPreset') ? normaliseHeroPreset(body.heroPreset) : null;
  const requestedColor = hasOwn(body, 'themeColor') ? normaliseThemeColor(body.themeColor) : null;

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
    const presetWasCleared = body.heroPreset === null || String(body.heroPreset).trim() === '';
    if (!presetWasCleared) {
      if (!requestedPreset) {
        return { error: 'Invalid hero preset', set, unset };
      }
      set.themeMode = 'preset';
      set.heroPreset = requestedPreset;
      unset.themeColor = 1;
      return { set, unset };
    }

    // The inline owner editor sends heroPreset: '' together with themeColor when
    // a custom colour or banner is selected. Let the colour branch below decide
    // the effective mode instead of discarding the newly selected colour.
    if (!hasOwn(body, 'themeColor')) {
      unset.heroPreset = 1;
      set.themeMode = normaliseThemeColor(existing.themeColor) ? 'custom' : 'automatic';
      return { set, unset };
    }
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
  HERO_PRESETS,
  HERO_PRESET_ACCENTS,
  HERO_PRESET_GRADIENTS,
  VALID_THEME_MODES,
  buildSupplierThemeMutation,
  normaliseHeroPreset,
  normaliseStoredSupplierTheme,
  normaliseThemeColor,
  normaliseThemeMode,
  resolveCategoryTheme,
  resolveSupplierTheme,
};
