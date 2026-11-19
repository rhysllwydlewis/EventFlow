'use strict';

/**
 * #1408: the public supplier profile had two overlapping hero/theme editors and a
 * hand-kept copy of the category list.
 *
 * - `supplier-profile-owner-edit.js` carried an "Edit hero" modal with presets and a
 *   colour but no Automatic mode, and it wrote `heroPreset` / `themeColor` without a
 *   `themeMode`. `supplier-profile-theme-owner.js` (loaded through
 *   supplier-profile-polish.js) already removed that button at runtime, so the modal
 *   could never be opened and only contradicted the maintained editor.
 * - The owner-edit category dropdown was a copy of models/Supplier.js VALID_CATEGORIES.
 */

const fs = require('fs');
const path = require('path');
const { VALID_CATEGORIES } = require('../../models/Supplier');
const { CATEGORY_DEFINITIONS } = require('../../public/assets/js/utils/category-link.js');

const ROOT = path.join(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('supplier profile owner editing', () => {
  const ownerEdit = read('public/assets/js/supplier-profile-owner-edit.js');
  const themeOwner = read('public/assets/js/supplier-profile-theme-owner.js');

  describe('one hero and theme editor', () => {
    test('the legacy hero modal and its helpers are gone', () => {
      expect(ownerEdit).not.toMatch(/openHeroModal|addHeroEditButton|HERO_PRESETS|checkSvg/);
      expect(ownerEdit).not.toContain('Edit hero banner');
      expect(ownerEdit).not.toContain('spPresetGrid');
    });

    test('owner-edit no longer writes a hero preset or theme colour', () => {
      expect(ownerEdit).not.toMatch(/heroPreset|themeColor/);
    });

    test('the maintained editor offers automatic, preset and custom modes', () => {
      expect(themeOwner).toContain("selectedMode === 'preset'");
      expect(themeOwner).toContain("selectedMode === 'custom'");
      expect(themeOwner).toContain('themeMode: selectedMode');
    });

    test('the maintained editor is still loaded by the profile page', () => {
      expect(read('public/assets/js/supplier-profile-polish.js')).toContain(
        "import './supplier-profile-theme-owner.js"
      );
    });

    test('the only remaining hero-media control created by owner-edit is the name editor', () => {
      const classes = [...ownerEdit.matchAll(/className = '([^']*sp-hero-edit-btn[^']*)'/g)].map(
        match => match[1]
      );
      expect(classes).toEqual(['sp-hero-edit-btn sp-name-edit-btn']);
    });
  });

  describe('category list', () => {
    test('is read from the shared registry, not copied', () => {
      expect(ownerEdit).toContain('window.EventFlowCategoryLink.CATEGORY_DEFINITIONS');
      for (const category of VALID_CATEGORIES) {
        expect(ownerEdit).not.toContain(`'${category}'`);
      }
    });

    test('the registry it reads equals what the server accepts', () => {
      expect(CATEGORY_DEFINITIONS.map(category => category.name)).toEqual(VALID_CATEGORIES);
    });

    test('the profile page loads the registry before the script that reads it', () => {
      const html = read('public/supplier.html');
      const registry = html.search(/<script[^>]*utils\/category-link\.js/);
      const editor = html.search(/<script[^>]*supplier-profile-owner-edit\.js/);
      expect(registry).toBeGreaterThan(-1);
      expect(editor).toBeGreaterThan(registry);
      // Both are deferred, which keeps document order between them.
      expect(html.match(/<script[^>]*utils\/category-link\.js[^>]*>/)[0]).toContain('defer');
      expect(html.match(/<script[^>]*supplier-profile-owner-edit\.js[^>]*>/)[0]).toContain('defer');
    });
  });
});
