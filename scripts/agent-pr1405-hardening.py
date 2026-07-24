#!/usr/bin/env python3
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text()


def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def replace_once(content, old, new, label):
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return content.replace(old, new, 1)


def harden_supplier_route():
    content = subprocess.check_output(
        ['git', 'show', 'origin/main:routes/supplier-management.js'],
        cwd=ROOT,
        text=True,
    )
    content = replace_once(
        content,
        "const { supplierApprovalDefaults } = require('../services/supplierProfileProvisioning.service');\n",
        "const { supplierApprovalDefaults } = require('../services/supplierProfileProvisioning.service');\nconst { buildSupplierThemeMutation } = require('../utils/supplierTheme');\n",
        'theme utility import',
    )
    content = replace_once(content, '  heroPreset: 40,\n', '', 'remove generic hero preset handling')
    content = replace_once(
        content,
        """    // Validate and set theme color (must be valid hex color)
    if (b.themeColor && typeof b.themeColor === 'string') {
      const hexColorRegex = /^#[0-9A-F]{6}$/i;
      if (hexColorRegex.test(b.themeColor.trim())) {
        supplierPatch.themeColor = b.themeColor.trim();
      }
    }
""",
        """    const themeMutation = buildSupplierThemeMutation(b, s);
    if (themeMutation.error) {
      return res.status(400).json({ error: themeMutation.error });
    }
    Object.assign(supplierPatch, themeMutation.set);
""",
        'theme mutation validation',
    )
    content = replace_once(
        content,
        """    // NOTE: do NOT touch approved here — supplier edits must never revoke approval.
    await dbUnified.updateOne('suppliers', { id: req.params.id }, { $set: supplierPatch });

    // Bust catalog cache — profile edit means the supplier data may have changed
    catalogCache
      .invalidate()
      .catch(e => logger.warn('[catalogCache] invalidate error:', e.message));

    res.json({ ok: true, supplier: { ...s, ...supplierPatch } });
""",
        """    // NOTE: do NOT touch approved here — supplier edits must never revoke approval.
    supplierPatch.updatedAt = new Date().toISOString();
    const update = { $set: supplierPatch };
    if (Object.keys(themeMutation.unset).length > 0) {
      update.$unset = themeMutation.unset;
    }
    await dbUnified.updateOne('suppliers', { id: req.params.id }, update);

    // Bust catalog cache — profile edit means the supplier data may have changed
    catalogCache
      .invalidate()
      .catch(e => logger.warn('[catalogCache] invalidate error:', e.message));

    const updatedSupplier = { ...s, ...supplierPatch };
    Object.keys(themeMutation.unset).forEach(key => delete updatedSupplier[key]);
    res.json({ ok: true, supplier: updatedSupplier });
""",
        'atomic theme update',
    )
    write('routes/supplier-management.js', content)


def harden_authoritative_renderer():
    path = 'public/assets/js/supplier-profile.js'
    content = read(path)
    additions = {
        "  'wedding planner': 'wedding',\n": "  'wedding planner': 'wedding',\n    'event planner': 'wedding',\n    planning: 'wedding',\n    'wedding fayre': 'wedding',\n    stationery: 'wedding',\n    celebrant: 'wedding',\n",
        "    photographer: 'photography',\n": "    photographer: 'photography',\n    videography: 'photography',\n    videographer: 'photography',\n",
        "    food: 'catering',\n": "    food: 'catering',\n    cake: 'catering',\n",
        "    music: 'music',\n": "    music: 'music',\n    'music/dj': 'music',\n",
        "    floral: 'flowers',\n": "    floral: 'flowers',\n    decor: 'flowers',\n",
        "    chauffeur: 'transport',\n": "    chauffeur: 'transport',\n    beauty: 'beauty',\n    'hair & makeup': 'beauty',\n    bridalwear: 'beauty',\n    jewellery: 'beauty',\n",
        "    transport: '#1a3a4a',\n": "    transport: '#1a6b8a',\n    beauty: '#9d174d',\n",
    }
    for old, new in additions.items():
        if new not in content:
            content = replace_once(content, old, new, f'canonical category mapping {old.strip()}')
    content = content.replace("    venue: '#374151',", "    venue: '#4a5568',")

    start = content.index('    if (heroBanner) {', content.index('function renderHeroSection'))
    end = content.index('    // ── Badges', start)
    replacement = """    if (heroBanner) {
      const themeMode = ['automatic', 'preset', 'custom'].includes(supplier.themeMode)
        ? supplier.themeMode
        : null;
      const preset = supplier.heroPreset && PRESET_GRADIENTS_V2[supplier.heroPreset];
      const catKey = (supplier.category || '').toLowerCase().trim();
      const catPreset = CATEGORY_PRESETS[catKey];
      const validThemeColor =
        supplier.themeColor && /^#[0-9A-F]{6}$/i.test(supplier.themeColor)
          ? supplier.themeColor
          : null;

      heroSection?.removeAttribute('data-category-preset');
      heroMedia?.style.removeProperty('--supplier-theme');

      if (bannerUrl) {
        heroBanner.src = bannerUrl;
        heroBanner.alt = `${supplier.name} banner`;
        heroBanner.style.display = '';
        if (heroMedia) {
          heroMedia.style.backgroundImage = '';
        }
      } else {
        heroBanner.removeAttribute('src');
        heroBanner.style.display = 'none';
        if (heroMedia) {
          const usePreset = themeMode === 'preset' || (!themeMode && preset);
          const useCustom = themeMode === 'custom' || (!themeMode && !preset && validThemeColor);
          if (usePreset && preset) {
            heroMedia.style.backgroundImage = preset;
          } else if (useCustom && validThemeColor) {
            heroMedia.style.backgroundImage = '';
            heroMedia.style.setProperty('--supplier-theme', validThemeColor);
          } else if (catPreset && heroSection) {
            heroSection.setAttribute('data-category-preset', catPreset);
            heroMedia.style.backgroundImage = '';
          } else {
            heroMedia.style.backgroundImage = '';
          }
        }
      }
    }

"""
    content = content[:start] + replacement + content[end:]
    write(path, content)


def harden_owner_theme_dialog():
    path = 'public/assets/js/supplier-profile-theme-owner.js'
    content = read(path)
    content = replace_once(
        content,
        """function closeModal(overlay) {
  overlay.style.opacity = '0';
  setTimeout(() => overlay.remove(), 180);
}
""",
        """function getFocusableElements(container) {
  return [...container.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')].filter(
    element => !element.disabled && element.getAttribute('tabindex') !== '-1'
  );
}
""",
        'dialog focus helper',
    )
    content = replace_once(
        content,
        """  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Edit profile theme');
""",
        """  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'spThemeEditorTitle');
""",
        'dialog labelling',
    )
    content = replace_once(
        content,
        '<div class="sp-modal__title">Edit profile theme</div>',
        '<div class="sp-modal__title" id="spThemeEditorTitle">Edit profile theme</div>',
        'dialog title id',
    )
    marker = """  const hexInput = overlay.querySelector('#spThemeColorHexV2');

  const renderSelection = () => {
"""
    insertion = """  const hexInput = overlay.querySelector('#spThemeColorHexV2');
  const previouslyFocused = document.activeElement;
  const previousBodyOverflow = document.body.style.overflow;
  let dismissed = false;

  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    document.removeEventListener('keydown', handleDialogKeydown);
    document.body.style.overflow = previousBodyOverflow;
    overlay.remove();
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
  };

  const handleDialogKeydown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getFocusableElements(overlay);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', handleDialogKeydown);

  const renderSelection = () => {
"""
    content = replace_once(content, marker, insertion, 'dialog lifecycle')
    content = replace_once(
        content,
        """      button.classList.toggle('is-selected', selected);
""",
        """      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
""",
        'pressed state',
    )
    content = content.replace("closeModal(overlay)", "dismiss()")
    marker = """    customRow.classList.toggle('is-selected', selectedMode === 'custom');
  };

  modeGrid.addEventListener('click', event => {
"""
    insertion = """    customRow.classList.toggle('is-selected', selectedMode === 'custom');
  };

  renderSelection();
  setTimeout(() => {
    const selected = overlay.querySelector('[aria-pressed="true"]');
    (selected || overlay.querySelector('.sp-modal__close'))?.focus();
  }, 0);

  modeGrid.addEventListener('click', event => {
"""
    content = replace_once(content, marker, insertion, 'initial focus and selection')
    write(path, content)


def add_avatar_lightbox():
    path = 'public/assets/js/public-supplier-avatar.js'
    content = read(path)
    content = replace_once(
        content,
        'let activeRequestId = 0;\n',
        "let activeRequestId = 0;\nlet activeLightbox = null;\n",
        'lightbox state',
    )
    marker = 'function showAvatarImage(img, initialsEl, avatarUrl) {'
    lightbox = r'''function ensureAvatarLightboxStyles() {
  if (!document?.head || document.getElementById('sp-avatar-lightbox-styles')) return;
  const style = document.createElement('style');
  style.id = 'sp-avatar-lightbox-styles';
  style.textContent = `
    .hero-avatar.is-lightbox-trigger { cursor: zoom-in; }
    .hero-avatar.is-lightbox-trigger:focus-visible {
      outline: 3px solid var(--sp-profile-accent, #0b8073);
      outline-offset: 4px;
    }
    .sp-avatar-lightbox {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: grid;
      place-items: center;
      padding: 1.25rem;
      background: rgba(2, 6, 23, 0.88);
      backdrop-filter: blur(8px);
    }
    .sp-avatar-lightbox__dialog {
      position: relative;
      display: grid;
      gap: 0.75rem;
      max-width: min(92vw, 760px);
      max-height: 92vh;
      margin: 0;
    }
    .sp-avatar-lightbox__image {
      display: block;
      max-width: 100%;
      max-height: 78vh;
      margin: auto;
      border-radius: 22px;
      background: #fff;
      box-shadow: 0 30px 90px rgba(0, 0, 0, 0.45);
      object-fit: contain;
    }
    .sp-avatar-lightbox__caption {
      margin: 0;
      color: #fff;
      text-align: center;
      font-weight: 700;
    }
    .sp-avatar-lightbox__close {
      position: absolute;
      top: 0.75rem;
      right: 0.75rem;
      width: 44px;
      height: 44px;
      border: 0;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.82);
      color: #fff;
      font-size: 1.75rem;
      line-height: 1;
      cursor: pointer;
    }
    .sp-avatar-lightbox__close:focus-visible {
      outline: 3px solid #fff;
      outline-offset: 3px;
    }
  `;
  document.head.appendChild(style);
}

function closeAvatarLightbox() {
  if (!activeLightbox) return;
  const { overlay, trigger, previousBodyOverflow, onKeydown } = activeLightbox;
  document.removeEventListener('keydown', onKeydown);
  if (document.body) document.body.style.overflow = previousBodyOverflow;
  overlay.remove();
  activeLightbox = null;
  if (trigger && typeof trigger.focus === 'function') trigger.focus();
}

function openAvatarLightbox(avatarUrl, supplierName = 'Supplier', trigger = null) {
  if (!isUsableSupplierImageUrl(avatarUrl) || !document?.body || !document.createElement) {
    return null;
  }
  closeAvatarLightbox();
  ensureAvatarLightboxStyles();

  const overlay = document.createElement('div');
  overlay.className = 'sp-avatar-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'sp-avatar-lightbox-caption');

  const dialog = document.createElement('figure');
  dialog.className = 'sp-avatar-lightbox__dialog';
  const image = document.createElement('img');
  image.className = 'sp-avatar-lightbox__image';
  image.src = avatarUrl;
  image.alt = `${supplierName} profile photo`;
  const caption = document.createElement('figcaption');
  caption.id = 'sp-avatar-lightbox-caption';
  caption.className = 'sp-avatar-lightbox__caption';
  caption.textContent = `${supplierName} profile photo`;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'sp-avatar-lightbox__close';
  closeButton.setAttribute('aria-label', 'Close larger profile photo');
  closeButton.textContent = '×';

  dialog.append(image, caption, closeButton);
  overlay.appendChild(dialog);
  const previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.body.appendChild(overlay);

  const onKeydown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAvatarLightbox();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      closeButton.focus();
    }
  };
  activeLightbox = { overlay, trigger, previousBodyOverflow, onKeydown };
  document.addEventListener('keydown', onKeydown);
  closeButton.addEventListener('click', closeAvatarLightbox);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeAvatarLightbox();
  });
  closeButton.focus();
  return overlay;
}

function disableAvatarLightbox(avatarEl) {
  if (!avatarEl) return;
  avatarEl.classList?.remove('is-lightbox-trigger');
  avatarEl.removeAttribute?.('role');
  avatarEl.removeAttribute?.('tabindex');
  avatarEl.removeAttribute?.('aria-label');
  if (avatarEl.dataset) delete avatarEl.dataset.avatarLightboxUrl;
}

function enableAvatarLightbox(avatarEl, img, avatarUrl) {
  if (!avatarEl || !img || !isUsableSupplierImageUrl(avatarUrl)) return;
  ensureAvatarLightboxStyles();
  const supplierName = String(window.__supplierData?.name || 'Supplier').trim() || 'Supplier';
  avatarEl.classList?.add('is-lightbox-trigger');
  avatarEl.setAttribute?.('role', 'button');
  avatarEl.setAttribute?.('tabindex', '0');
  avatarEl.setAttribute?.('aria-label', `View larger profile photo for ${supplierName}`);
  if (avatarEl.dataset) avatarEl.dataset.avatarLightboxUrl = avatarUrl;
  if (avatarEl.dataset?.avatarLightboxReady === 'true' || !avatarEl.addEventListener) return;

  const activate = event => {
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    const url = avatarEl.dataset?.avatarLightboxUrl;
    if (!url || !avatarEl.classList?.contains('has-profile-photo')) return;
    event.preventDefault();
    openAvatarLightbox(url, String(window.__supplierData?.name || 'Supplier'), avatarEl);
  };
  avatarEl.addEventListener('click', activate);
  avatarEl.addEventListener('keydown', activate);
  avatarEl.dataset.avatarLightboxReady = 'true';
}

'''
    if 'function openAvatarLightbox' not in content:
        content = replace_once(content, marker, lightbox + marker, 'avatar lightbox helpers')
    content = replace_once(
        content,
        """    avatarEl.removeAttribute('data-avatar-url');
  }
""",
        """    avatarEl.removeAttribute('data-avatar-url');
    disableAvatarLightbox(avatarEl);
  }
""",
        'disable placeholder lightbox',
    )
    content = replace_once(
        content,
        """    avatarEl.dataset.avatarUrl = avatarUrl;
  }
""",
        """    avatarEl.dataset.avatarUrl = avatarUrl;
    enableAvatarLightbox(avatarEl, img, avatarUrl);
  }
""",
        'enable loaded avatar lightbox',
    )
    content = replace_once(
        content,
        """    findSupplierInSearchPayload,
    getSupplierProfileImage,
""",
        """    closeAvatarLightbox,
    enableAvatarLightbox,
    findSupplierInSearchPayload,
    getSupplierProfileImage,
""",
        'export lightbox helpers start',
    )
    content = replace_once(
        content,
        """    loadPublicSupplierAvatar,
    setPlaceholder,
""",
        """    loadPublicSupplierAvatar,
    openAvatarLightbox,
    setPlaceholder,
""",
        'export lightbox helpers end',
    )
    write(path, content)


def write_route_test():
    write(
        'tests/integration/supplier-theme-route.test.js',
        r'''/**
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/catalogCache', () => ({
  invalidate: jest.fn(() => Promise.resolve()),
}));

function createApp(existingSupplier) {
  jest.resetModules();
  const catalogCache = require('../../services/catalogCache');
  const router = require('../../routes/supplier-management');
  const dbUnified = {
    findOne: jest.fn(async () => ({ ...existingSupplier })),
    updateOne: jest.fn(async () => true),
  };
  const pass = (_req, _res, next) => next();
  const authRequired = (req, _res, next) => {
    req.user = { id: existingSupplier.ownerUserId, role: 'supplier' };
    next();
  };
  router.initializeDependencies({
    dbUnified,
    authRequired,
    roleRequired: () => pass,
    requireVerifiedUser: pass,
    csrfProtection: pass,
    writeLimiter: pass,
    uid: prefix => `${prefix}_test`,
    geocoding: {
      isValidUKPostcode: () => true,
      geocodePostcode: async () => null,
    },
    supplierAnalytics: { getSupplierAnalytics: jest.fn() },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/me/suppliers', router);
  return { app, dbUnified, catalogCache };
}

describe('supplier theme PATCH route', () => {
  test('stores preset mode and atomically removes a stale custom colour', async () => {
    const existing = {
      id: 'sup_1',
      ownerUserId: 'user_1',
      category: 'Photography',
      themeMode: 'custom',
      themeColor: '#EC4899',
      approved: true,
    };
    const { app, dbUnified, catalogCache } = createApp(existing);
    const response = await request(app)
      .patch('/api/me/suppliers/sup_1')
      .send({ themeMode: 'preset', heroPreset: 'midnight' })
      .expect(200);

    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_1' },
      expect.objectContaining({
        $set: expect.objectContaining({ themeMode: 'preset', heroPreset: 'midnight' }),
        $unset: { themeColor: 1 },
      })
    );
    expect(response.body.supplier).toMatchObject({
      themeMode: 'preset',
      heroPreset: 'midnight',
    });
    expect(response.body.supplier.themeColor).toBeUndefined();
    expect(catalogCache.invalidate).toHaveBeenCalled();
  });

  test('supports automatic mode by clearing both competing fields', async () => {
    const existing = {
      id: 'sup_2',
      ownerUserId: 'user_2',
      category: 'Music/DJ',
      themeMode: 'preset',
      heroPreset: 'ocean',
      themeColor: '#123456',
      approved: true,
    };
    const { app, dbUnified } = createApp(existing);
    const response = await request(app)
      .patch('/api/me/suppliers/sup_2')
      .send({ themeMode: 'automatic' })
      .expect(200);

    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_2' },
      expect.objectContaining({
        $set: expect.objectContaining({ themeMode: 'automatic' }),
        $unset: { themeColor: 1, heroPreset: 1 },
      })
    );
    expect(response.body.supplier).toMatchObject({ themeMode: 'automatic' });
    expect(response.body.supplier.heroPreset).toBeUndefined();
    expect(response.body.supplier.themeColor).toBeUndefined();
  });

  test('rejects an invalid explicit mode without writing', async () => {
    const existing = { id: 'sup_3', ownerUserId: 'user_3', approved: true };
    const { app, dbUnified } = createApp(existing);
    await request(app)
      .patch('/api/me/suppliers/sup_3')
      .send({ themeMode: 'preset', heroPreset: 'not-real' })
      .expect(400);
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });
});
''',
    )


def write_lightbox_test():
    write(
        'tests/unit/supplier-profile-photo-lightbox.test.js',
        r'''/**
 * @jest-environment node
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

function loadClient() {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
      <div id="hero-avatar" class="hero-avatar">
        <img id="hero-avatar-img" hidden>
        <span id="hero-avatar-initials">ES</span>
      </div>
    </body></html>`,
    { url: 'https://event-flow.co.uk/supplier?id=sup_1' }
  );
  dom.window.__supplierData = { id: 'sup_1', name: 'Example Supplier' };
  const code = fs.readFileSync(
    path.join(__dirname, '../../public/assets/js/public-supplier-avatar.js'),
    'utf8'
  );
  const sandbox = {
    window: dom.window,
    document: dom.window.document,
    URLSearchParams: dom.window.URLSearchParams,
    fetch: jest.fn(),
    module: { exports: {} },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(code, sandbox);
  return { dom, client: sandbox.module.exports };
}

describe('supplier profile photo lightbox', () => {
  test('opens the loaded avatar on click and closes with Escape', () => {
    const { dom, client } = loadClient();
    const avatar = dom.window.document.getElementById('hero-avatar');
    const image = dom.window.document.getElementById('hero-avatar-img');
    const initials = dom.window.document.getElementById('hero-avatar-initials');

    client.showAvatarImage(image, initials, '/uploads/example.jpg');
    expect(avatar.getAttribute('role')).toBe('button');
    expect(avatar.getAttribute('tabindex')).toBe('0');
    expect(avatar.getAttribute('aria-label')).toContain('Example Supplier');

    avatar.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const dialog = dom.window.document.querySelector('.sp-avatar-lightbox');
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.querySelector('img').getAttribute('src')).toContain('/uploads/example.jpg');
    expect(dom.window.document.body.style.overflow).toBe('hidden');

    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    expect(dom.window.document.querySelector('.sp-avatar-lightbox')).toBeNull();
    expect(dom.window.document.body.style.overflow).toBe('');
  });

  test('supports keyboard activation and disables enlargement for placeholders', () => {
    const { dom, client } = loadClient();
    const avatar = dom.window.document.getElementById('hero-avatar');
    const image = dom.window.document.getElementById('hero-avatar-img');
    const initials = dom.window.document.getElementById('hero-avatar-initials');

    client.showAvatarImage(image, initials, '/uploads/example.jpg');
    avatar.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    expect(dom.window.document.querySelector('.sp-avatar-lightbox')).not.toBeNull();
    client.closeAvatarLightbox();

    client.setPlaceholder(image, initials, 'ES');
    expect(avatar.getAttribute('role')).toBeNull();
    expect(avatar.getAttribute('tabindex')).toBeNull();
    avatar.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(dom.window.document.querySelector('.sp-avatar-lightbox')).toBeNull();
  });
});
''',
    )


def extend_source_contracts():
    path = 'tests/unit/supplier-profile-theme-owner.test.js'
    content = read(path)
    old = """  test('merges the canonical server response and reapplies the full profile theme', () => {
"""
    new = """  test('keeps the theme dialog keyboard accessible', () => {
    const editor = read('public/assets/js/supplier-profile-theme-owner.js');
    expect(editor).toContain("event.key === 'Escape'");
    expect(editor).toContain("event.key !== 'Tab'");
    expect(editor).toContain("aria-labelledby', 'spThemeEditorTitle'");
    expect(editor).toContain("button.setAttribute('aria-pressed'");
    expect(editor).toContain('previousBodyOverflow');
  });

  test('merges the canonical server response and reapplies the full profile theme', () => {
"""
    content = replace_once(content, old, new, 'owner dialog accessibility contract')
    write(path, content)


def main():
    harden_supplier_route()
    harden_authoritative_renderer()
    harden_owner_theme_dialog()
    add_avatar_lightbox()
    write_route_test()
    write_lightbox_test()
    extend_source_contracts()


if __name__ == '__main__':
    main()
