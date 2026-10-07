const OWNER_THEME_EDITOR_CLASS = 'sp-theme-edit-btn-v2';
// Presets, defaults and the stored-mode rules come from the shared theme module
// (shared/supplier-theme-core.js, loaded as a classic script before this one).
const sharedTheme = globalThis.EFSupplierTheme;
const DEFAULT_COLOR = sharedTheme.DEFAULT_THEME_COLOR;
const HEX_RE = /^#[0-9A-F]{6}$/i;
const HERO_PRESETS = sharedTheme.HERO_PRESETS;

const escapeHtml = value =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function resolveStoredMode(supplier = {}) {
  return sharedTheme.normaliseStoredSupplierTheme(supplier).themeMode;
}

function readCookie(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

async function ensureCsrfToken() {
  const existing =
    readCookie('csrf') ||
    readCookie('csrfToken') ||
    window.EventFlowCsrf?.get?.() ||
    window.__CSRF_TOKEN__ ||
    window.csrfToken ||
    '';
  if (existing) {
    return existing;
  }

  for (const endpoint of ['/api/csrf-token', '/api/v1/csrf-token']) {
    try {
      const response = await fetch(endpoint, { credentials: 'include' });
      if (!response.ok) {
        continue;
      }
      const data = await response.json();
      const token = data.csrfToken || data.token;
      if (token) {
        window.__CSRF_TOKEN__ = token;
        window.csrfToken = token;
        return token;
      }
    } catch (_) {
      // Try the compatibility endpoint.
    }
  }
  throw new Error('Could not verify this save. Please refresh and try again.');
}

function getFocusableElements(container) {
  return [
    ...container.querySelectorAll('button, input, select, textarea, a[href], [tabindex]'),
  ].filter(element => !element.disabled && element.getAttribute('tabindex') !== '-1');
}

function showToast(message, type = 'success') {
  const existing = document.querySelector('.sp-save-toast');
  if (existing) {
    existing.remove();
  }
  const toast = document.createElement('div');
  toast.className = `sp-save-toast sp-save-toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2800);
}

function mergeCanonicalSupplier(nextSupplier) {
  if (!window.__supplierData || !nextSupplier) {
    return;
  }
  for (const key of ['themeMode', 'themeColor', 'heroPreset']) {
    delete window.__supplierData[key];
  }
  Object.assign(window.__supplierData, nextSupplier);
}

async function saveSupplierTheme(supplierId, patch) {
  const csrfToken = await ensureCsrfToken();
  const response = await fetch(`/api/me/suppliers/${encodeURIComponent(supplierId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify(patch),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Save failed (${response.status})`);
  }
  mergeCanonicalSupplier(data.supplier || patch);
  return data;
}

function openThemeEditor(supplierId) {
  const supplier = window.__supplierData || {};
  let selectedMode = resolveStoredMode(supplier);
  let selectedPreset = supplier.heroPreset || 'ef-teal';
  const currentColor = HEX_RE.test(String(supplier.themeColor || ''))
    ? supplier.themeColor
    : DEFAULT_COLOR;

  const presetButtons = HERO_PRESETS.map(
    ({ id, label, gradient }) => `
      <button type="button" class="sp-preset-swatch${selectedMode === 'preset' && selectedPreset === id ? ' is-selected' : ''}"
        data-theme-mode="preset" data-preset="${escapeHtml(id)}" style="background:${gradient}"
        aria-label="${escapeHtml(label)} theme">
        <span class="sp-preset-swatch__check">✓</span>
        <span class="sp-preset-swatch__label">${escapeHtml(label)}</span>
      </button>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'sp-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'spThemeEditorTitle');
  overlay.innerHTML = `
    <div class="sp-modal sp-modal--wide">
      <div class="sp-modal__header">
        <div class="sp-modal__icon" aria-hidden="true">🎨</div>
        <div>
          <div class="sp-modal__title" id="spThemeEditorTitle">Edit profile theme</div>
          <div class="sp-modal__subtitle">Choose profile colours and optionally add a banner image</div>
        </div>
        <button type="button" class="sp-modal__close" aria-label="Close">×</button>
      </div>
      <div class="sp-modal__body">
        <p class="sp-preset-section-label">Colour mode</p>
        <div class="sp-preset-grid" id="spThemeModeGrid">
          <button type="button" class="sp-preset-swatch${selectedMode === 'automatic' ? ' is-selected' : ''}"
            data-theme-mode="automatic"
            style="background:linear-gradient(135deg,#f8fafc,#dbeafe);color:#0f172a"
            aria-label="Automatic category theme">
            <span class="sp-preset-swatch__check">✓</span>
            <span class="sp-preset-swatch__label">Automatic</span>
          </button>
          ${presetButtons}
        </div>
        <p class="sp-field__hint">Automatic follows the supplier category. A preset applies one named palette across the profile.</p>

        <div class="sp-color-row${selectedMode === 'custom' ? ' is-selected' : ''}" id="spCustomColourRow" style="margin-top:16px">
          <label for="spThemeColorV2">Custom colour</label>
          <input type="color" id="spThemeColorV2" class="sp-color-input" value="${escapeHtml(currentColor)}">
          <input type="text" id="spThemeColorHexV2" class="sp-color-hex-input" value="${escapeHtml(currentColor)}" maxlength="7" placeholder="#0B8073">
        </div>

        <p class="sp-preset-section-label" style="margin-top:20px">Optional banner image</p>
        <div class="sp-field">
          <input type="url" id="spBannerUrlV2" class="sp-field__input" value="${escapeHtml(supplier.bannerUrl || '')}"
            placeholder="https://your-image-url.com/banner.jpg">
          <p class="sp-field__hint">The banner changes the hero image only; your selected colour mode still themes buttons, cards and accents.</p>
        </div>

        <p class="sp-preset-section-label" style="margin-top:20px">Tagline</p>
        <div class="sp-field">
          <input type="text" id="spTaglineV2" class="sp-field__input" value="${escapeHtml(supplier.tagline || '')}"
            maxlength="200" placeholder="A short, catchy description of what you do">
        </div>
      </div>
      <div class="sp-modal__footer">
        <button type="button" class="sp-btn sp-btn--ghost js-theme-cancel">Cancel</button>
        <button type="button" class="sp-btn sp-btn--primary js-theme-save">Save changes</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const modeGrid = overlay.querySelector('#spThemeModeGrid');
  const customRow = overlay.querySelector('#spCustomColourRow');
  const colorInput = overlay.querySelector('#spThemeColorV2');
  const hexInput = overlay.querySelector('#spThemeColorHexV2');
  const previouslyFocused = document.activeElement;
  const previousBodyOverflow = document.body.style.overflow;
  let dismissed = false;

  const dismiss = () => {
    if (dismissed) {
      return;
    }
    dismissed = true;
    document.removeEventListener('keydown', handleDialogKeydown);
    document.body.style.overflow = previousBodyOverflow;
    overlay.remove();
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
  };

  function handleDialogKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
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
  }

  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', handleDialogKeydown);

  const renderSelection = () => {
    modeGrid.querySelectorAll('[data-theme-mode]').forEach(button => {
      const selected =
        button.dataset.themeMode === selectedMode &&
        (selectedMode !== 'preset' || button.dataset.preset === selectedPreset);
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    customRow.classList.toggle('is-selected', selectedMode === 'custom');
  };

  renderSelection();
  setTimeout(() => {
    const selected = overlay.querySelector('[aria-pressed="true"]');
    (selected || overlay.querySelector('.sp-modal__close'))?.focus();
  }, 0);

  modeGrid.addEventListener('click', event => {
    const button = event.target.closest('[data-theme-mode]');
    if (!button) {
      return;
    }
    selectedMode = button.dataset.themeMode;
    if (selectedMode === 'preset') {
      selectedPreset = button.dataset.preset;
    }
    renderSelection();
  });

  colorInput.addEventListener('input', () => {
    hexInput.value = colorInput.value.toUpperCase();
    selectedMode = 'custom';
    renderSelection();
  });
  hexInput.addEventListener('input', () => {
    if (HEX_RE.test(hexInput.value.trim())) {
      colorInput.value = hexInput.value.trim();
      selectedMode = 'custom';
      renderSelection();
    }
  });

  overlay.querySelector('.sp-modal__close').addEventListener('click', () => dismiss());
  overlay.querySelector('.js-theme-cancel').addEventListener('click', () => dismiss());
  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      dismiss();
    }
  });

  overlay.querySelector('.js-theme-save').addEventListener('click', async event => {
    const button = event.currentTarget;
    const customColor = hexInput.value.trim();
    if (selectedMode === 'custom' && !HEX_RE.test(customColor)) {
      showToast('Enter a valid six-digit hex colour.', 'error');
      return;
    }

    const patch = {
      bannerUrl: overlay.querySelector('#spBannerUrlV2').value.trim(),
      tagline: overlay.querySelector('#spTaglineV2').value.trim(),
      themeMode: selectedMode,
      heroPreset: selectedMode === 'preset' ? selectedPreset : null,
      themeColor: selectedMode === 'custom' ? customColor : null,
    };

    button.disabled = true;
    try {
      await saveSupplierTheme(supplierId, patch);
      window.__spRerender?.hero();
      window.SupplierProfileTheme?.applySupplierProfileTheme(window.__supplierData);
      ensureOwnerThemeButton(window.__supplierData);
      showToast('Profile theme updated ✓');
      dismiss();
    } catch (error) {
      showToast(error.message, 'error');
      button.disabled = false;
    }
  });
}

function ensureOwnerThemeButton(supplier = window.__supplierData) {
  if (!supplier?.isOwner || !supplier.id) {
    return;
  }
  const heroMedia = document.querySelector('#supplier-hero .hero-media');
  if (!heroMedia) {
    return;
  }

  heroMedia
    .querySelectorAll(`.sp-hero-edit-btn:not(.sp-name-edit-btn):not(.${OWNER_THEME_EDITOR_CLASS})`)
    .forEach(button => button.remove());

  let button = heroMedia.querySelector(`.${OWNER_THEME_EDITOR_CLASS}`);
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = `sp-hero-edit-btn ${OWNER_THEME_EDITOR_CLASS}`;
    button.setAttribute('aria-label', 'Edit profile theme and banner');
    button.innerHTML = '🎨 Edit theme';
    button.addEventListener('click', () => openThemeEditor(supplier.id));
    heroMedia.appendChild(button);
  }
}

function activateOwnerThemeEditor(supplier) {
  if (!supplier?.isOwner) {
    return;
  }
  ensureOwnerThemeButton(supplier);
  const hero = document.getElementById('supplier-hero');
  if (hero && hero.dataset.spThemeOwnerObserved !== 'true') {
    hero.dataset.spThemeOwnerObserved = 'true';
    new MutationObserver(() => ensureOwnerThemeButton(window.__supplierData)).observe(hero, {
      childList: true,
      subtree: true,
    });
  }
}

window.addEventListener('sp:dataReady', event => {
  activateOwnerThemeEditor(event.detail?.supplier);
});

if (window.__supplierData) {
  activateOwnerThemeEditor(window.__supplierData);
}

export { activateOwnerThemeEditor, openThemeEditor, resolveStoredMode };
