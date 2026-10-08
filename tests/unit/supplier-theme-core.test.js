/**
 * public/assets/js/shared/supplier-theme-core.js is the single definition of
 * supplier theme presets, category families and the effective-theme resolver.
 * The server (utils/supplierTheme.js) requires it and browsers load it as a
 * classic script, so these tests pin that it works in both, that the server
 * module is a thin layer over it, and that nobody quietly grows a second copy.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const CORE_PATH = 'public/assets/js/shared/supplier-theme-core.js';
const core = require('../../public/assets/js/shared/supplier-theme-core');
const serverTheme = require('../../utils/supplierTheme');
const { VALID_CATEGORIES } = require('../../models/Supplier');

describe('shared supplier theme data', () => {
  test('every preset has a unique id, a label, a hex accent and a gradient', () => {
    const ids = core.HERO_PRESETS.map(preset => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of core.HERO_PRESETS) {
      expect(preset.label).toEqual(expect.any(String));
      expect(preset.accent).toMatch(/^#[0-9A-F]{6}$/);
      expect(preset.gradient).toMatch(/^linear-gradient\(/);
    }
  });

  test('the derived accent and gradient lookups agree with the preset list', () => {
    for (const preset of core.HERO_PRESETS) {
      expect(core.HERO_PRESET_ACCENTS[preset.id]).toBe(preset.accent);
      expect(core.HERO_PRESET_GRADIENTS[preset.id]).toBe(preset.gradient);
    }
    expect(Object.keys(core.HERO_PRESET_ACCENTS)).toHaveLength(core.HERO_PRESETS.length);
  });

  test('every supplier category has a theme family, so adding one forces a theme decision', () => {
    for (const category of VALID_CATEGORIES) {
      expect(core.CATEGORY_THEME_FAMILIES).toHaveProperty([category.toLowerCase()]);
    }
  });

  test('every category family resolves to an accent', () => {
    for (const family of new Set(Object.values(core.CATEGORY_THEME_FAMILIES))) {
      expect(core.CATEGORY_ACCENTS[family]).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  test('rejects prototype keys as presets or categories', () => {
    expect(core.normaliseHeroPreset('__proto__')).toBeNull();
    expect(core.normaliseHeroPreset('constructor')).toBeNull();
    expect(core.resolveCategoryTheme('__proto__').family).toBe('default');
    expect(core.resolveCategoryTheme('constructor').family).toBe('default');
  });
});

describe('shared hero visual', () => {
  const hero = supplier => core.resolveHeroVisual(supplier);

  test('explicit modes decide the hero, falling back to the category then the default', () => {
    expect(hero({ themeMode: 'preset', heroPreset: 'midnight' })).toMatchObject({
      kind: 'preset',
      heroPreset: 'midnight',
    });
    expect(hero({ themeMode: 'custom', themeColor: '#ec4899' })).toMatchObject({
      kind: 'color',
      themeColor: '#EC4899',
    });
    expect(hero({ themeMode: 'automatic', category: 'Photography' })).toMatchObject({
      kind: 'category',
      categoryFamily: 'photography',
    });
    expect(hero({ themeMode: 'preset', heroPreset: 'nope', category: 'Venues' }).kind).toBe(
      'category'
    );
    expect(hero({ themeMode: 'custom', themeColor: 'nope' }).kind).toBe('default');
    expect(hero({ category: 'Other' }).kind).toBe('default');
  });

  test('a legacy record with both keeps the preset artwork while the colour drives the accent', () => {
    const legacy = { themeColor: '#ec4899', heroPreset: 'midnight' };
    expect(hero(legacy)).toMatchObject({ kind: 'preset', heroPreset: 'midnight' });
    expect(core.resolveSupplierTheme(legacy)).toMatchObject({
      accent: '#EC4899',
      source: 'themeColor',
    });
  });
});

describe('shared supplier theme in the browser', () => {
  test('loaded as a classic script it publishes window.EFSupplierTheme with the same behaviour', () => {
    const source = fs.readFileSync(path.join(ROOT, CORE_PATH), 'utf8');
    const sandbox = {};
    sandbox.self = sandbox;
    vm.runInNewContext(source, sandbox);

    expect(sandbox.EFSupplierTheme).toBeDefined();
    const supplier = { themeMode: 'preset', heroPreset: 'rose-gold', category: 'Venues' };
    expect(sandbox.EFSupplierTheme.resolveSupplierTheme(supplier)).toEqual(
      core.resolveSupplierTheme(supplier)
    );
    expect(sandbox.EFSupplierTheme.HERO_PRESETS.map(preset => preset.id)).toEqual(
      core.HERO_PRESETS.map(preset => preset.id)
    );
  });

  test('is frozen, so one page script cannot alter another’s presets', () => {
    expect(Object.isFrozen(core)).toBe(true);
    expect(Object.isFrozen(core.HERO_PRESETS)).toBe(true);
    expect(Object.isFrozen(core.HERO_PRESETS[0])).toBe(true);
  });
});

describe('server theme module', () => {
  test('re-exports the shared definitions rather than keeping its own', () => {
    expect(serverTheme.HERO_PRESETS).toBe(core.HERO_PRESETS);
    expect(serverTheme.HERO_PRESET_ACCENTS).toBe(core.HERO_PRESET_ACCENTS);
    expect(serverTheme.CATEGORY_THEME_FAMILIES).toBe(core.CATEGORY_THEME_FAMILIES);
    expect(serverTheme.CATEGORY_ACCENTS).toBe(core.CATEGORY_ACCENTS);
    expect(serverTheme.resolveSupplierTheme).toBe(core.resolveSupplierTheme);
    expect(serverTheme.normaliseStoredSupplierTheme).toBe(core.normaliseStoredSupplierTheme);
  });
});

describe('no second copy of the theme definitions', () => {
  const SCANNED = ['public/assets/js', 'utils', 'routes', 'models', 'services', 'middleware'];

  function jsFiles(dir) {
    const out = [];
    const absolute = path.join(ROOT, dir);
    if (!fs.existsSync(absolute)) {
      return out;
    }
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const relative = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...jsFiles(relative));
      } else if (/\.(js|mjs)$/.test(entry.name)) {
        out.push(relative);
      }
    }
    return out;
  }

  test('preset names appear only in the shared module', () => {
    const offenders = SCANNED.flatMap(jsFiles).filter(file => {
      if (file === CORE_PATH) {
        return false;
      }
      return /rose-gold|champagne/.test(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    });
    expect(offenders).toEqual([]);
  });
});
