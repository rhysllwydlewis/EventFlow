/**
 * Supplier Profile — Owner Inline Edit Overlay
 *
 * Activates only when the logged-in user owns the profile.
 * Adds:
 *  • Sticky "You're viewing your own profile" owner bar
 *  • Pencil-on-hover edit button for every section card
 *  • Hero preset picker (10 gradients + custom colour + custom banner)
 *  • Inline text editor for About, tagline, contact details
 *  • Empty-state prompts so new suppliers know what to fill in
 *
 * All saves go to PATCH /api/me/suppliers/:id and rerender
 * only the affected section — no page reload.
 */
'use strict';
(function () {
  if (window.__spOwnerEditLoaded) {
    return;
  }
  window.__spOwnerEditLoaded = true;

  // ── Hero preset definitions ──────────────────────────────────────────────

  const HERO_PRESETS = [
    {
      id: 'ef-teal',
      label: 'EventFlow',
      gradient: 'linear-gradient(135deg,#0B8073 0%,#13B6A2 100%)',
    },
    {
      id: 'midnight',
      label: 'Midnight',
      gradient: 'linear-gradient(135deg,#1a1a2e 0%,#0f3460 100%)',
    },
    {
      id: 'rose-gold',
      label: 'Rose Gold',
      gradient: 'linear-gradient(135deg,#b76e79 0%,#f9c8c8 100%)',
    },
    { id: 'forest', label: 'Forest', gradient: 'linear-gradient(135deg,#1b4332 0%,#40916c 100%)' },
    { id: 'ocean', label: 'Ocean', gradient: 'linear-gradient(135deg,#03045e 0%,#00b4d8 100%)' },
    { id: 'sunset', label: 'Sunset', gradient: 'linear-gradient(135deg,#f77f00 0%,#d62828 100%)' },
    { id: 'purple', label: 'Purple', gradient: 'linear-gradient(135deg,#3d0066 0%,#a855f7 100%)' },
    {
      id: 'charcoal',
      label: 'Charcoal',
      gradient: 'linear-gradient(135deg,#1a1a1a 0%,#4a5568 100%)',
    },
    { id: 'blush', label: 'Blush', gradient: 'linear-gradient(135deg,#c2185b 0%,#ff80ab 100%)' },
    {
      id: 'champagne',
      label: 'Champagne',
      gradient: 'linear-gradient(135deg,#9c7c38 0%,#e8d5a3 100%)',
    },
  ];

  // ── Utilities ────────────────────────────────────────────────────────────

  const esc = str =>
    String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  function pencilSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  }

  function checkSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  }

  function closeSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  }

  // ── Toast notifications ──────────────────────────────────────────────────

  let _toastTimer = null;

  function showToast(msg, type = 'success') {
    const existing = document.querySelector('.sp-save-toast');
    if (existing) {
      existing.remove();
    }
    if (_toastTimer) {
      clearTimeout(_toastTimer);
    }

    const toast = document.createElement('div');
    toast.className = `sp-save-toast sp-save-toast--${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);

    _toastTimer = setTimeout(() => {
      toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => toast.remove(), 320);
    }, 2600);
  }

  // ── Modal helpers ────────────────────────────────────────────────────────

  function buildModal({ iconSvg, title, subtitle = '', wide = false, bodyHtml }) {
    const overlay = document.createElement('div');
    overlay.className = 'sp-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);

    overlay.innerHTML = `
      <div class="sp-modal${wide ? ' sp-modal--wide' : ''}">
        <div class="sp-modal__header">
          <div class="sp-modal__icon">${iconSvg || pencilSvg()}</div>
          <div>
            <div class="sp-modal__title">${esc(title)}</div>
            ${subtitle ? `<div class="sp-modal__subtitle">${esc(subtitle)}</div>` : ''}
          </div>
          <button class="sp-modal__close" aria-label="Close">${closeSvg()}</button>
        </div>
        <div class="sp-modal__body">${bodyHtml}</div>
        <div class="sp-modal__footer">
          <button class="sp-btn sp-btn--ghost js-modal-cancel">Cancel</button>
          <button class="sp-btn sp-btn--primary js-modal-save">
            <span class="sp-btn__spinner"></span>
            <span class="sp-btn__label">Save changes</span>
          </button>
        </div>
      </div>
    `;

    // Dismiss helpers
    const closeModal = () => {
      overlay.style.transition = 'opacity 0.18s ease';
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 190);
    };

    overlay.querySelector('.sp-modal__close').addEventListener('click', closeModal);
    overlay.querySelector('.js-modal-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        closeModal();
      }
    });
    document.addEventListener(
      'keydown',
      function onKey(e) {
        if (e.key === 'Escape') {
          closeModal();
          document.removeEventListener('keydown', onKey);
        }
      },
      { once: true }
    );

    document.body.appendChild(overlay);

    // Focus first input
    setTimeout(() => {
      const first = overlay.querySelector('input, textarea, select');
      if (first) {
        first.focus();
      }
    }, 60);

    return { overlay, closeModal };
  }

  function setSaving(overlay, saving) {
    const btn = overlay.querySelector('.js-modal-save');
    if (!btn) {
      return;
    }
    btn.disabled = saving;
    btn.classList.toggle('sp-btn--loading', saving);
  }

  // ── PATCH helper ─────────────────────────────────────────────────────────

  async function patchSupplier(supplierId, patch) {
    const resp = await fetch(`/api/me/suppliers/${encodeURIComponent(supplierId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
      },
      credentials: 'include',
      body: JSON.stringify(patch),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || `Save failed (${resp.status})`);
    }
    return resp.json();
  }

  // Apply patch result back to the shared supplier data object
  function mergeData(patch) {
    if (!window.__supplierData) {
      return;
    }
    Object.assign(window.__supplierData, patch);
  }

  // ── Owner bar ─────────────────────────────────────────────────────────────

  function injectOwnerBar() {
    if (document.querySelector('.sp-owner-bar')) {
      return;
    }
    const bar = document.createElement('div');
    bar.className = 'sp-owner-bar';
    bar.setAttribute('role', 'banner');
    bar.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <span class="sp-owner-bar__label">You're viewing your own public profile — hover over any section to edit it</span>
      <a href="/dashboard-supplier" class="sp-owner-bar__link">Supplier Dashboard →</a>
    `;
    // Insert just below the nav
    const header = document.querySelector('.ef-header');
    if (header && header.nextSibling) {
      header.parentNode.insertBefore(bar, header.nextSibling);
    } else {
      document.body.prepend(bar);
    }
  }

  // ── Hero edit ─────────────────────────────────────────────────────────────

  function addHeroEditButton(supplierId) {
    const heroMedia = document.querySelector('.hero-media');
    if (!heroMedia || heroMedia.querySelector('.sp-hero-edit-btn')) {
      return;
    }

    const btn = document.createElement('button');
    btn.className = 'sp-hero-edit-btn';
    btn.setAttribute('aria-label', 'Edit hero banner');
    btn.innerHTML = `${pencilSvg()} Edit hero`;
    btn.addEventListener('click', () => openHeroModal(supplierId));
    heroMedia.appendChild(btn);
  }

  function openHeroModal(supplierId) {
    const supplier = window.__supplierData || {};
    const currentPreset = supplier.heroPreset || 'ef-teal';
    const currentBanner = supplier.bannerUrl || '';
    const currentColor = supplier.themeColor || '#0B8073';

    const swatches = HERO_PRESETS.map(
      p => `
      <button
        class="sp-preset-swatch${currentPreset === p.id && !currentBanner ? ' is-selected' : ''}"
        data-preset="${esc(p.id)}"
        style="background:${p.gradient};"
        title="${esc(p.label)}"
        aria-label="${esc(p.label)} theme${currentPreset === p.id && !currentBanner ? ' — currently selected' : ''}"
        type="button"
      >
        <span class="sp-preset-swatch__check">${checkSvg()}</span>
        <span class="sp-preset-swatch__label">${esc(p.label)}</span>
      </button>
    `
    ).join('');

    const bodyHtml = `
      <p class="sp-preset-section-label">Choose a theme</p>
      <div class="sp-preset-grid" id="spPresetGrid">${swatches}</div>

      <div class="sp-color-row" style="margin-top:14px;">
        <label for="spThemeColor">Custom colour</label>
        <input type="color" id="spThemeColor" class="sp-color-input" value="${esc(currentColor)}" />
        <input type="text" id="spThemeColorHex" class="sp-color-hex-input" value="${esc(currentColor)}" maxlength="7" placeholder="#0B8073" />
      </div>

      <p class="sp-preset-section-label" style="margin-top:20px;">Custom banner image</p>
      <div class="sp-field">
        <input
          type="url"
          id="spBannerUrl"
          class="sp-field__input"
          value="${esc(currentBanner)}"
          placeholder="https://your-image-url.com/banner.jpg"
        />
        <p class="sp-field__hint">Paste a direct image URL — JPG, PNG or WebP, min 1200×400px recommended.</p>
      </div>
      <div class="sp-banner-preview${currentBanner ? ' has-image' : ''}" id="spBannerPreview">
        ${currentBanner ? `<img src="${esc(currentBanner)}" alt="Banner preview" id="spBannerImg">` : ''}
        <button class="sp-banner-preview__remove" id="spBannerRemove" title="Remove banner" type="button">✕</button>
      </div>

      <p class="sp-preset-section-label" style="margin-top:20px;">Tagline</p>
      <div class="sp-field">
        <input
          type="text"
          id="spTagline"
          class="sp-field__input"
          value="${esc(supplier.tagline || '')}"
          maxlength="200"
          placeholder="A short, catchy description of what you do"
        />
        <span class="sp-field__char-count" id="spTaglineCount">${(supplier.tagline || '').length}/200</span>
      </div>
    `;

    const { overlay, closeModal } = buildModal({
      title: 'Edit hero banner',
      subtitle: 'Choose a theme, custom colour or upload your own image',
      wide: true,
      bodyHtml,
    });

    // Swatch selection
    let selectedPreset = currentBanner ? null : currentPreset || 'ef-teal';
    const grid = overlay.querySelector('#spPresetGrid');
    grid.querySelectorAll('.sp-preset-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        selectedPreset = sw.dataset.preset;
        // Deselect banner URL when a preset is chosen
        const bannerInput = overlay.querySelector('#spBannerUrl');
        if (bannerInput) {
          bannerInput.value = '';
        }
        const preview = overlay.querySelector('#spBannerPreview');
        if (preview) {
          preview.classList.remove('has-image');
          preview.innerHTML = '';
        }
        grid.querySelectorAll('.sp-preset-swatch').forEach(s => s.classList.remove('is-selected'));
        sw.classList.add('is-selected');
      });
    });

    // Colour picker sync
    const colorInput = overlay.querySelector('#spThemeColor');
    const hexInput = overlay.querySelector('#spThemeColorHex');

    colorInput.addEventListener('input', () => {
      hexInput.value = colorInput.value;
      selectedPreset = null;
      grid.querySelectorAll('.sp-preset-swatch').forEach(s => s.classList.remove('is-selected'));
    });

    hexInput.addEventListener('input', () => {
      if (/^#[0-9A-Fa-f]{6}$/.test(hexInput.value)) {
        colorInput.value = hexInput.value;
      }
    });

    // Banner URL preview
    const bannerInput = overlay.querySelector('#spBannerUrl');
    const bannerPreview = overlay.querySelector('#spBannerPreview');
    const bannerRemove = overlay.querySelector('#spBannerRemove');

    let bannerPreviewTimer;
    bannerInput.addEventListener('input', () => {
      clearTimeout(bannerPreviewTimer);
      bannerPreviewTimer = setTimeout(() => {
        const url = bannerInput.value.trim();
        if (url) {
          selectedPreset = null;
          grid
            .querySelectorAll('.sp-preset-swatch')
            .forEach(s => s.classList.remove('is-selected'));
          bannerPreview.innerHTML = `<img src="${esc(url)}" alt="Banner preview" id="spBannerImg"><button class="sp-banner-preview__remove" id="spBannerRemove" title="Remove" type="button">✕</button>`;
          bannerPreview.classList.add('has-image');
          // Re-wire remove btn after innerHTML replacement
          bannerPreview.querySelector('#spBannerRemove').addEventListener('click', removeBanner);
        } else {
          bannerPreview.classList.remove('has-image');
          bannerPreview.innerHTML = '';
        }
      }, 500);
    });

    function removeBanner() {
      bannerInput.value = '';
      bannerPreview.classList.remove('has-image');
      bannerPreview.innerHTML = '';
      // Re-select the current preset
      const firstSwatch =
        grid.querySelector(`[data-preset="${esc(currentPreset)}"]`) ||
        grid.querySelector('.sp-preset-swatch');
      if (firstSwatch) {
        firstSwatch.classList.add('is-selected');
        selectedPreset = firstSwatch.dataset.preset;
      }
    }

    if (bannerRemove) {
      bannerRemove.addEventListener('click', removeBanner);
    }

    // Tagline char count
    const taglineInput = overlay.querySelector('#spTagline');
    const taglineCount = overlay.querySelector('#spTaglineCount');
    taglineInput.addEventListener('input', () => {
      taglineCount.textContent = `${taglineInput.value.length}/200`;
    });

    // Save
    overlay.querySelector('.js-modal-save').addEventListener('click', async () => {
      setSaving(overlay, true);
      try {
        const patch = {};
        const newBanner = bannerInput.value.trim();
        const newTagline = taglineInput.value.trim();
        const newColor = hexInput.value.trim();

        if (newBanner) {
          patch.bannerUrl = newBanner;
          patch.heroPreset = ''; // custom image — no preset
        } else {
          patch.bannerUrl = '';
          // null means custom colour was chosen (colour picker used), so clear the
          // preset so the renderer falls back to themeColor. Otherwise use the
          // selected preset, defaulting to 'ef-teal' only when nothing was changed.
          patch.heroPreset = selectedPreset !== null ? selectedPreset || 'ef-teal' : '';
        }

        if (/^#[0-9A-Fa-f]{6}$/.test(newColor)) {
          patch.themeColor = newColor;
        }
        patch.tagline = newTagline;

        await patchSupplier(supplierId, patch);
        mergeData(patch);
        window.__spRerender?.hero();
        addHeroEditButton(supplierId); // Re-inject after rerender
        showToast('Hero updated ✓');
        closeModal();
      } catch (err) {
        showToast(err.message, 'error');
        setSaving(overlay, false);
      }
    });
  }

  // ── About section edit ───────────────────────────────────────────────────

  function addAboutEditButton(supplierId) {
    const section = document.getElementById('sp-section-about');
    if (!section) {
      return;
    }

    // Make editable
    section.classList.add('sp-editable');

    // Remove existing btn if present
    const existing = section.querySelector('.sp-edit-btn');
    if (existing) {
      existing.remove();
    }

    const btn = document.createElement('button');
    btn.className = 'sp-edit-btn';
    btn.setAttribute('aria-label', 'Edit about section');
    btn.innerHTML = pencilSvg();
    btn.addEventListener('click', () => openAboutModal(supplierId));
    section.appendChild(btn);

    // Empty state prompt if no description
    const supplier = window.__supplierData || {};
    const hasContent = !!(
      supplier.description_long ||
      supplier.description_short ||
      supplier.description
    );
    if (!hasContent) {
      injectEmptyPrompt(section, {
        icon: '✍️',
        title: 'Tell customers about yourself',
        text: 'Add a description, contact details, and what makes you special.',
        cta: 'Add description',
        onClick: () => openAboutModal(supplierId),
      });
    }
  }

  function openAboutModal(supplierId) {
    const supplier = window.__supplierData || {};

    const bodyHtml = `
      <div class="sp-field">
        <label class="sp-field__label" for="spDescLong">Full description <span class="sp-field__char-count" id="spDescLongCount">${(supplier.description_long || '').length}/5000</span></label>
        <textarea id="spDescLong" class="sp-field__textarea sp-field__textarea--tall" maxlength="5000" placeholder="Describe your services, experience, and what makes you unique…">${esc(supplier.description_long || '')}</textarea>
      </div>
      <div class="sp-field">
        <label class="sp-field__label" for="spDescShort">Short description <span class="sp-field__char-count" id="spDescShortCount">${(supplier.description_short || '').length}/300</span></label>
        <textarea id="spDescShort" class="sp-field__textarea" maxlength="300" placeholder="A brief one-liner shown in search results and cards">${esc(supplier.description_short || '')}</textarea>
      </div>
      <div class="sp-field">
        <label class="sp-field__label" for="spWebsite">Website</label>
        <input type="url" id="spWebsite" class="sp-field__input" value="${esc(supplier.website || '')}" placeholder="https://yourwebsite.com" />
      </div>
      <div class="sp-field">
        <label class="sp-field__label" for="spPhone">Phone number</label>
        <input type="tel" id="spPhone" class="sp-field__input" value="${esc(supplier.phone || '')}" placeholder="+44 7700 000000" />
      </div>
      <div class="sp-field">
        <label class="sp-field__label" for="spLocation">Location</label>
        <input type="text" id="spLocation" class="sp-field__input" value="${esc(supplier.location || '')}" maxlength="200" placeholder="e.g. Greater London" />
      </div>
      <div class="sp-field">
        <label class="sp-field__label" for="spPriceDisplay">Starting price / price display</label>
        <input type="text" id="spPriceDisplay" class="sp-field__input" value="${esc(supplier.price_display || '')}" maxlength="60" placeholder="e.g. From £500" />
      </div>
    `;

    const { overlay, closeModal } = buildModal({
      title: 'Edit about section',
      subtitle: 'Describe your services and how clients can reach you',
      bodyHtml,
    });

    // Char counts
    [
      ['#spDescLong', '#spDescLongCount', 5000],
      ['#spDescShort', '#spDescShortCount', 300],
    ].forEach(([inp, cnt, max]) => {
      const input = overlay.querySelector(inp);
      const count = overlay.querySelector(cnt);
      if (input && count) {
        input.addEventListener('input', () => {
          count.textContent = `${input.value.length}/${max}`;
        });
      }
    });

    overlay.querySelector('.js-modal-save').addEventListener('click', async () => {
      setSaving(overlay, true);
      try {
        const patch = {
          description_long: overlay.querySelector('#spDescLong').value.trim(),
          description_short: overlay.querySelector('#spDescShort').value.trim(),
          website: overlay.querySelector('#spWebsite').value.trim(),
          phone: overlay.querySelector('#spPhone').value.trim(),
          location: overlay.querySelector('#spLocation').value.trim(),
          price_display: overlay.querySelector('#spPriceDisplay').value.trim(),
        };
        await patchSupplier(supplierId, patch);
        mergeData(patch);
        window.__spRerender?.about();
        addAboutEditButton(supplierId);
        window.__spRerender?.sidebar();
        addSidebarEditButton(supplierId);
        showToast('About section updated ✓');
        closeModal();
      } catch (err) {
        showToast(err.message, 'error');
        setSaving(overlay, false);
      }
    });
  }

  // ── Gallery section edit ──────────────────────────────────────────────────

  function addGalleryEditButton() {
    const section = document.getElementById('sp-section-gallery');
    if (!section) {
      return;
    }

    section.classList.add('sp-editable');

    const existing = section.querySelector('.sp-edit-btn');
    if (existing) {
      existing.remove();
    }

    const btn = document.createElement('button');
    btn.className = 'sp-edit-btn';
    btn.setAttribute('aria-label', 'Edit photo gallery');
    btn.innerHTML = pencilSvg();
    btn.addEventListener('click', () => {
      window.location.href = '/dashboard-supplier#photos';
    });
    section.appendChild(btn);

    // Empty state prompt
    const supplier = window.__supplierData || {};
    const hasPhotos = Array.isArray(supplier.photosGallery) && supplier.photosGallery.length > 0;
    if (!hasPhotos) {
      injectEmptyPrompt(section, {
        icon: '📸',
        title: 'Show off your work',
        text: 'Upload photos to your gallery to attract more customers.',
        cta: 'Upload photos',
        onClick: () => {
          window.location.href = '/dashboard-supplier#photos';
        },
      });
    }
  }

  // ── Packages section edit ─────────────────────────────────────────────────

  function addPackagesEditButton() {
    const section = document.getElementById('sp-section-packages');
    if (!section) {
      return;
    }

    section.classList.add('sp-editable');

    const existing = section.querySelector('.sp-edit-btn');
    if (existing) {
      existing.remove();
    }

    const btn = document.createElement('button');
    btn.className = 'sp-edit-btn';
    btn.setAttribute('aria-label', 'Edit packages');
    btn.innerHTML = pencilSvg();
    btn.addEventListener('click', () => {
      window.location.href = '/dashboard-supplier#packages';
    });
    section.appendChild(btn);
  }

  // ── Packages empty state (injected outside the sp-page-main flow) ─────────

  function addPackagesEmptyPrompt() {
    const section = document.getElementById('sp-section-packages');
    if (!section) {
      return;
    }
    // Only show if section is hidden (no packages)
    if (section.style.display !== 'none' && section.innerHTML.trim() !== '') {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.id = 'sp-packages-empty-owner';
    wrapper.className = 'sp-section';
    injectEmptyPrompt(wrapper, {
      icon: '📦',
      title: 'Create your first package',
      text: 'Add service packages with pricing to appear in search results and on your profile.',
      cta: 'Add a package',
      onClick: () => {
        window.location.href = '/dashboard-supplier#packages';
      },
    });
    section.replaceWith(wrapper);
    window.__spPackagesEmptyInjected = wrapper;
  }

  // ── Name edit (hero title inline) ─────────────────────────────────────────

  function addNameEditButton(supplierId) {
    const heroTitle = document.getElementById('hero-title');
    if (!heroTitle || heroTitle.querySelector('.sp-name-edit-btn')) {
      return;
    }

    const btn = document.createElement('button');
    btn.className = 'sp-hero-edit-btn sp-name-edit-btn';
    btn.style.cssText =
      'top:auto;right:auto;position:relative;margin-left:10px;display:inline-flex;vertical-align:middle;font-size:0.75rem;padding:4px 10px 4px 8px;';
    btn.setAttribute('aria-label', 'Edit business name');
    btn.innerHTML = `${pencilSvg()} Name`;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openNameModal(supplierId);
    });
    heroTitle.appendChild(btn);
  }

  function openNameModal(supplierId) {
    const supplier = window.__supplierData || {};

    const bodyHtml = `
      <div class="sp-field">
        <label class="sp-field__label" for="spBizName">Business name <span class="sp-field__char-count" id="spBizNameCount">${(supplier.name || '').length}/120</span></label>
        <input type="text" id="spBizName" class="sp-field__input" value="${esc(supplier.name || '')}" maxlength="120" placeholder="Your business name" />
      </div>
      <div class="sp-field">
        <label class="sp-field__label" for="spCategory">Category</label>
        <input type="text" id="spCategory" class="sp-field__input" value="${esc(supplier.category || '')}" maxlength="80" placeholder="e.g. Photography, Catering, Venues" />
      </div>
    `;

    const { overlay, closeModal } = buildModal({
      title: 'Edit business name',
      subtitle: 'This is the main heading visitors see on your profile',
      bodyHtml,
    });

    overlay.querySelector('#spBizName').addEventListener('input', function () {
      overlay.querySelector('#spBizNameCount').textContent = `${this.value.length}/120`;
    });

    overlay.querySelector('.js-modal-save').addEventListener('click', async () => {
      const name = overlay.querySelector('#spBizName').value.trim();
      if (!name) {
        showToast('Business name cannot be empty', 'error');
        return;
      }
      setSaving(overlay, true);
      try {
        const patch = {
          name,
          category: overlay.querySelector('#spCategory').value.trim(),
        };
        await patchSupplier(supplierId, patch);
        mergeData(patch);
        window.__spRerender?.hero();
        addHeroEditButton(supplierId);
        addNameEditButton(supplierId);
        showToast('Business name updated ✓');
        closeModal();
      } catch (err) {
        showToast(err.message, 'error');
        setSaving(overlay, false);
      }
    });
  }

  // ── Sidebar details edit ──────────────────────────────────────────────────

  function addSidebarEditButton(supplierId) {
    const details = document.getElementById('sp-sidebar-details');
    if (!details) {
      return;
    }

    details.classList.add('sp-editable');

    const existing = details.querySelector('.sp-edit-btn');
    if (existing) {
      existing.remove();
    }

    const btn = document.createElement('button');
    btn.className = 'sp-edit-btn';
    btn.setAttribute('aria-label', 'Edit key details');
    btn.innerHTML = pencilSvg();
    btn.addEventListener('click', () => openAboutModal(supplierId));
    details.appendChild(btn);
  }

  // ── Empty state helper ───────────────────────────────────────────────────

  function injectEmptyPrompt(container, { icon, title, text, cta, onClick }) {
    const el = document.createElement('div');
    el.className = 'sp-owner-empty-prompt';
    el.innerHTML = `
      <div class="sp-owner-empty-prompt__icon">${icon}</div>
      <div class="sp-owner-empty-prompt__title">${esc(title)}</div>
      <p class="sp-owner-empty-prompt__text">${esc(text)}</p>
      <button class="sp-owner-empty-prompt__cta" type="button">${esc(cta)}</button>
    `;
    el.addEventListener('click', onClick);
    el.querySelector('.sp-owner-empty-prompt__cta').addEventListener('click', e => {
      e.stopPropagation();
      onClick();
    });

    // Insert inside the first .sp-card, or append directly
    const card = container.querySelector('.sp-card') || container;
    const existingPrompt = card.querySelector('.sp-owner-empty-prompt');
    if (existingPrompt) {
      existingPrompt.remove();
    }

    if (card !== container) {
      card.appendChild(el);
    } else {
      container.appendChild(el);
    }
  }

  // ── Boot ─────────────────────────────────────────────────────────────────

  async function boot(supplier) {
    // Fetch current user
    let currentUser = null;
    try {
      const resp = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (resp.ok) {
        const data = await resp.json();
        currentUser = data && data.user;
      }
    } catch (_) {
      /* not logged in */
    }

    // Only activate for the profile owner
    if (!currentUser || !supplier || currentUser.id !== supplier.ownerUserId) {
      return;
    }

    const supplierId = supplier.id || window.__supplierId;
    if (!supplierId) {
      return;
    }

    injectOwnerBar();
    addHeroEditButton(supplierId);
    addNameEditButton(supplierId);
    addAboutEditButton(supplierId);
    addGalleryEditButton();
    addPackagesEditButton();
    addPackagesEmptyPrompt();
    addSidebarEditButton(supplierId);
  }

  // Listen for profile data ready event from supplier-profile.js
  function onDataReady(e) {
    const supplier = (e && e.detail && e.detail.supplier) || window.__supplierData;
    if (!supplier) {
      return;
    }
    boot(supplier);
  }

  if (window.__supplierData) {
    // Data already loaded (script ran after supplier-profile.js finished)
    boot(window.__supplierData);
  } else {
    window.addEventListener('sp:dataReady', onDataReady, { once: true });
    // Fallback poll in case the event was missed
    let pollCount = 0;
    const poll = setInterval(() => {
      pollCount++;
      if (window.__supplierData) {
        clearInterval(poll);
        boot(window.__supplierData);
      } else if (pollCount > 40) {
        clearInterval(poll);
      }
    }, 250);
  }
})();
