/**
 * Profile Customization Page
 * Handles loading, live preview, validation and saving for supplier profile customization.
 */

'use strict';
(function () {
  const DEFAULT_COLOR = '#0B8073';
  const HEX_RE = /^#[0-9A-F]{6}$/i;
  const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok'];
  const SOCIAL_LABELS = {
    facebook: 'Facebook',
    instagram: 'Instagram',
    twitter: 'X / Twitter',
    linkedin: 'LinkedIn',
    youtube: 'YouTube',
    tiktok: 'TikTok',
  };

  let currentEditingSupplierId = null;
  let suppliers = [];
  let dirty = false;
  let initialising = false;
  let themeSelectionChanged = false;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    if (!str) {
      return '';
    }
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function readCookie(name) {
    if (!name || typeof document === 'undefined') {
      return '';
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function getExistingCsrfToken() {
    const cookieToken = readCookie('csrf') || readCookie('csrfToken');
    if (cookieToken) {
      return cookieToken;
    }

    // Double-submit CSRF requires the cookie as well as the header. Avoid
    // trusting stale globals before the readable cookie has been checked.
    return (
      window.EventFlowCsrf?.get?.() ||
      window.__CSRF_TOKEN__ ||
      window.csrfToken ||
      document.querySelector('meta[name="csrf-token"]')?.content ||
      ''
    );
  }

  function storeCsrfToken(token) {
    if (!token) {
      return;
    }
    window.__CSRF_TOKEN__ = token;
    window.csrfToken = token;
  }

  function setStatus(message, type = 'muted') {
    const statusEl = $('sup-status');
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message || '';
    const colours = {
      success: '#0b8073',
      error: '#dc2626',
      muted: '#667085',
      warning: '#b45309',
    };
    statusEl.style.color = colours[type] || colours.muted;
  }

  function notify(type, message) {
    const dispatcher = window.NotificationDispatcher;
    if (dispatcher && typeof dispatcher[type] === 'function') {
      dispatcher[type](message);
      return;
    }
    setStatus(message, type === 'success' ? 'success' : type === 'error' ? 'error' : 'muted');
  }

  async function api(path, opts = {}) {
    const options = {
      ...opts,
      credentials: opts.credentials || 'include',
    };
    const response = await fetch(path, options);
    if (!response.ok) {
      let message = 'Request failed';
      try {
        const errorBody = await response.json();
        message = errorBody.error || errorBody.message || message;
      } catch (_) {
        message = response.statusText || message;
      }
      throw new Error(message);
    }
    if (response.status === 204) {
      return {};
    }
    return response.json();
  }

  async function ensureCsrfToken() {
    const existing = getExistingCsrfToken();
    if (existing) {
      storeCsrfToken(existing);
      return existing;
    }

    const endpoints = ['/api/csrf-token', '/api/v1/csrf-token'];
    const failures = [];
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, { credentials: 'include' });
        if (!response.ok) {
          failures.push(`${endpoint}: ${response.status}`);
          continue;
        }
        const data = await response.json();
        const token = data?.csrfToken || data?.token;
        if (token) {
          storeCsrfToken(token);
          return token;
        }
        failures.push(`${endpoint}: missing token`);
      } catch (error) {
        failures.push(`${endpoint}: ${error.message || 'request failed'}`);
      }
    }
    console.warn('Failed to resolve CSRF token for profile customisation', failures);
    throw new Error('Failed to fetch CSRF token');
  }

  function injectPolishStyles() {
    if ($('pc-customization-runtime-polish')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'pc-customization-runtime-polish';
    style.textContent = `
      #main-content.section { padding-top: 2rem; }
      #main-content > .container { max-width: 1180px; }
      .supplier-breadcrumb { margin-bottom: 1rem; }
      .supplier-breadcrumb-link {
        display: inline-flex;
        align-items: center;
        gap: .35rem;
        min-height: 38px;
        padding: .48rem .82rem;
        border: 1px solid rgba(11,128,115,.14);
        border-radius: 999px;
        background: rgba(255,255,255,.78);
        box-shadow: 0 8px 22px rgba(15,23,42,.06), inset 0 1px 0 rgba(255,255,255,.9);
        color: #0b8073;
        font-weight: 700;
        text-decoration: none;
      }
      .pc-header-card {
        position: relative;
        overflow: hidden;
        border: 1px solid rgba(11,128,115,.16);
        background:
          radial-gradient(circle at 8% 0%, rgba(19,182,162,.12), transparent 35%),
          linear-gradient(135deg, rgba(255,255,255,.94), rgba(240,253,249,.86));
        box-shadow: 0 18px 46px rgba(15, 23, 42, .08), inset 0 1px 0 rgba(255,255,255,.92);
      }
      .pc-header-card::after {
        content: '';
        position: absolute;
        inset: auto -8rem -9rem auto;
        width: 18rem;
        height: 18rem;
        border-radius: 999px;
        background: rgba(11,128,115,.07);
        pointer-events: none;
      }
      .pc-header-card .supplier-page-title {
        color: #0f172a !important;
        letter-spacing: -0.035em;
      }
      .pc-header-card .supplier-page-subtitle { color: #667085 !important; }
      .pc-header-actions .cta { box-shadow: 0 10px 24px rgba(15,23,42,.08); }
      .pc-selector-card { margin-bottom: 1rem; border: 1px solid rgba(11,128,115,.12); }
      .pc-layout { align-items: start; }
      .pc-form-col { min-width: 0; }
      .pc-step {
        border-color: rgba(11,128,115,.12);
        box-shadow: 0 12px 34px rgba(15,23,42,.055), inset 0 1px 0 rgba(255,255,255,.92);
      }
      .pc-step:hover { transform: translateY(-1px); }
      .pc-step-desc { max-width: 72ch; color: #64748b; }
      .pc-step-header { border-bottom-color: rgba(11,128,115,.09); }
      .pc-step-num { box-shadow: 0 8px 18px rgba(11,128,115,.22); }
      .pc-banner-zone {
        isolation: isolate;
        min-height: 148px;
        display: grid;
        place-items: center;
      }
      .pc-banner-zone:focus-visible,
      #select-stock-photo-btn:focus-visible,
      .color-preset:focus-visible,
      #pc-save-bar-save:focus-visible,
      #pc-save-bar-discard:focus-visible,
      #sup-save-btn:focus-visible,
      #reset-theme-color:focus-visible {
        outline: 3px solid rgba(11,128,115,.28);
        outline-offset: 3px;
      }
      .pc-banner-zone.has-image { border-style: solid; background: rgba(11,128,115,.045); }
      .photo-preview-grid:empty { display: none; }
      .photo-preview-grid:not(:empty) { display: grid; grid-template-columns: minmax(0, 1fr); gap: .75rem; }
      .photo-preview-item-inner {
        position: relative;
        overflow: hidden;
        border-radius: 18px;
        border: 1px solid rgba(15,23,42,.08);
        box-shadow: 0 14px 34px rgba(15,23,42,.12);
      }
      .photo-preview-img { width: 100%; height: 168px; object-fit: cover; display: block; }
      .photo-preview-remove {
        position: absolute;
        top: .55rem;
        right: .55rem;
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 999px;
        background: rgba(17,24,39,.76);
        color: #fff;
        cursor: pointer;
        display: grid;
        place-items: center;
        box-shadow: 0 8px 18px rgba(0,0,0,.18);
      }
      .pc-color-row { gap: .72rem; }
      .color-preset {
        position: relative;
        width: 32px !important;
        height: 32px !important;
        border: 2px solid rgba(255,255,255,.95) !important;
        box-shadow: 0 7px 16px rgba(15,23,42,.14) !important;
        transition: transform .18s ease, box-shadow .18s ease;
      }
      .color-preset:hover { transform: translateY(-1px); }
      .color-preset.active {
        transform: translateY(-1px) scale(1.04);
        box-shadow: 0 9px 22px rgba(15,23,42,.16), 0 0 0 5px rgba(11,128,115,.10) !important;
      }
      .color-preset.active::after {
        content: '';
        position: absolute;
        inset: -7px;
        border-radius: 999px;
        border: 2px solid rgba(11,128,115,.72);
        box-shadow: 0 0 0 3px rgba(11,128,115,.09), 0 0 18px rgba(11,128,115,.22);
        pointer-events: none;
        animation: pcColorRingGlow 1.9s ease-in-out infinite;
      }
      @keyframes pcColorRingGlow {
        0%, 100% { opacity: .78; transform: scale(.98); }
        50% { opacity: 1; transform: scale(1.04); }
      }
      .color-picker-group {
        align-items: center;
        gap: .7rem;
        padding: .72rem;
        border: 1px solid rgba(11,128,115,.10);
        border-radius: 14px;
        background: rgba(255,255,255,.72);
        width: max-content;
        max-width: 100%;
      }
      .color-preview-card {
        overflow: hidden;
        border-radius: 16px;
        border: 1px solid rgba(15,23,42,.08);
        box-shadow: 0 10px 26px rgba(15,23,42,.06);
      }
      .pc-social-grid { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
      .pc-social-item { min-height: 52px; border-color: rgba(15,23,42,.08); }
      .pc-social-item:hover { border-color: rgba(11,128,115,.32); background: rgba(255,255,255,.96); }
      .pc-social-input { min-height: 32px; }
      .pc-sidebar { z-index: 5; }
      .pc-completion,
      .pc-preview-card,
      .pc-sidebar > .pc-step {
        border-color: rgba(11,128,115,.13);
        box-shadow: 0 16px 38px rgba(15,23,42,.07), inset 0 1px 0 rgba(255,255,255,.9);
      }
      .pc-preview-card { overflow: hidden; }
      .pc-preview-banner::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, transparent, rgba(15,23,42,.20));
        pointer-events: none;
      }
      .pc-preview-body { background: linear-gradient(180deg, rgba(255,255,255,.96), rgba(248,250,252,.94)); }
      .pc-preview-body .pc-preview-name {
        color: #0f172a !important;
        text-shadow: none !important;
      }
      .pc-preview-body .pc-preview-tagline {
        color: #64748b !important;
        text-shadow: none !important;
      }
      .pc-preview-placeholder {
        font-size: .74rem;
        color: #94a3b8;
        line-height: 1.45;
        margin: .25rem 0 .5rem;
      }
      .pc-preview-footer { background: rgba(248,250,252,.92); }
      .pc-save-bar {
        left: 50% !important;
        right: auto !important;
        bottom: 16px !important;
        width: min(940px, calc(100% - 32px)) !important;
        border: 1px solid rgba(11,128,115,.14) !important;
        border-radius: 18px !important;
        box-shadow: 0 18px 44px rgba(15,23,42,.16), inset 0 1px 0 rgba(255,255,255,.9) !important;
        transform: translate(-50%, calc(100% + 32px)) !important;
      }
      .pc-save-bar.pc-save-bar--visible { transform: translate(-50%, 0) !important; }
      .pc-save-bar button:disabled,
      #sup-save-btn:disabled { opacity: .65; cursor: wait; }
      .pc-save-bar.pc-save-bar--saving .pc-save-bar__dot { background: #0b8073; }
      @media (max-width: 1024px) {
        .pc-sidebar { position: static; }
      }
      @media (max-width: 640px) {
        #main-content.section { padding-top: 1rem; }
        .pc-header-inner { flex-direction: column; }
        .pc-header-actions, .pc-header-actions .cta { width: 100%; }
        .pc-header-actions .cta { justify-content: center; }
        .pc-step { padding: 1.15rem !important; }
        .photo-preview-img { height: 132px; }
        .color-picker-group { width: 100%; }
        .pc-save-bar {
          bottom: 10px !important;
          width: calc(100% - 20px) !important;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .color-preset.active::after { animation: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function cleanInteractiveElement(el) {
    if (!el || !el.parentNode) {
      return el || null;
    }
    const clone = el.cloneNode(true);
    if ('value' in clone) {
      clone.value = el.value;
    }
    if ('checked' in clone) {
      clone.checked = el.checked;
    }
    el.replaceWith(clone);
    return clone;
  }

  function cleanInteractiveSelector(selector) {
    return Array.from(document.querySelectorAll(selector)).map(el => cleanInteractiveElement(el));
  }

  function markDirty() {
    if (initialising || dirty) {
      return;
    }
    dirty = true;
    document.body.classList.add('pc-has-unsaved');
    $('pc-save-bar')?.classList.add('pc-save-bar--visible');
  }

  function markClean() {
    dirty = false;
    document.body.classList.remove('pc-has-unsaved');
    const saveBar = $('pc-save-bar');
    if (saveBar) {
      saveBar.classList.remove('pc-save-bar--visible', 'pc-save-bar--saving');
    }
  }

  function setSaving(isSaving) {
    const ids = [
      'sup-save-btn',
      'pc-save-bar-save',
      'pc-save-bar-discard',
      'select-stock-photo-btn',
    ];
    ids.forEach(id => {
      const el = $(id);
      if (el) {
        el.disabled = isSaving;
      }
    });
    $('pc-save-bar')?.classList.toggle('pc-save-bar--saving', isSaving);
  }

  function normaliseSocialUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return { value: '', error: null };
    }
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(withProtocol);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return { value: '', error: 'Please enter a full website URL.' };
      }
      if (!url.hostname.includes('.')) {
        return { value: '', error: 'Please enter a valid profile URL.' };
      }
      return { value: url.toString(), error: null };
    } catch (_) {
      return { value: '', error: 'Please enter a valid profile URL.' };
    }
  }

  function setInputValue(input, value) {
    if (!input) {
      return;
    }
    input.value = value || '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getThemeColor() {
    const candidate =
      $('sup-theme-color')?.value || $('sup-theme-color-hex')?.value || DEFAULT_COLOR;
    return HEX_RE.test(candidate) ? candidate : DEFAULT_COLOR;
  }

  function applyThemeColor(color, shouldMarkDirty = false) {
    const safeColor = HEX_RE.test(color) ? color : DEFAULT_COLOR;
    const colorPicker = $('sup-theme-color');
    const colorHex = $('sup-theme-color-hex');
    if (colorPicker) {
      colorPicker.value = safeColor;
    }
    if (colorHex) {
      colorHex.value = safeColor;
    }
    const previewHeader = $('color-preview-header');
    const previewButton = $('color-preview-button');
    if (previewHeader) {
      previewHeader.style.backgroundColor = safeColor;
    }
    if (previewButton) {
      previewButton.style.backgroundColor = safeColor;
    }
    document.querySelectorAll('.color-preset').forEach(preset => {
      preset.classList.toggle(
        'active',
        String(preset.dataset.color || '').toLowerCase() === safeColor.toLowerCase()
      );
    });
    const previewBanner = $('preview-banner');
    if (previewBanner && !previewBanner.querySelector('img')) {
      previewBanner.style.background = `linear-gradient(135deg, ${safeColor}, ${safeColor}cc)`;
    }
    document.querySelectorAll('.pc-preview-tag').forEach(tag => {
      tag.style.background = `${safeColor}1a`;
      tag.style.color = safeColor;
    });
    if (shouldMarkDirty) {
      themeSelectionChanged = true;
      markDirty();
      updateLivePreview();
    }
  }

  function clearChildren(el) {
    if (!el) {
      return;
    }
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  function renderBannerPreview(imageUrl) {
    const bannerPreview = $('sup-banner-preview');
    if (!bannerPreview) {
      return;
    }
    while (bannerPreview.firstChild) {
      bannerPreview.removeChild(bannerPreview.firstChild);
    }
    $('sup-banner-drop')?.classList.toggle('has-image', !!imageUrl);
    if (!imageUrl) {
      return;
    }

    const container = document.createElement('div');
    container.className = 'photo-preview-item photo-preview-item-inner';

    const imgElement = document.createElement('img');
    imgElement.alt = 'Selected banner';
    imgElement.className = 'photo-preview-img';
    imgElement.src = imageUrl;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'photo-preview-remove';
    removeBtn.setAttribute('aria-label', 'Remove banner image');
    removeBtn.textContent = '\u2715';
    removeBtn.addEventListener('click', () => {
      const bannerInput = document.getElementById('sup-banner');
      setInputValue(bannerInput, '');
      updateBannerPreview('');
      markDirty();
    });

    container.appendChild(imgElement);
    container.appendChild(removeBtn);
    bannerPreview.appendChild(container);
  }

  function updatePreviewBanner(imageUrl) {
    const pBanner = $('preview-banner');
    if (!pBanner) {
      return;
    }
    clearChildren(pBanner);
    if (imageUrl) {
      pBanner.style.background = 'none';
      const pImg = document.createElement('img');
      pImg.src = imageUrl;
      pImg.alt = '';
      pBanner.appendChild(pImg);
    } else {
      const color = getThemeColor();
      pBanner.style.background = `linear-gradient(135deg, ${color}, ${color}cc)`;
    }
  }

  function updateBannerPreview(imageUrl) {
    renderBannerPreview(imageUrl);
    updatePreviewBanner(imageUrl);
    updateCompletion();
  }

  function validatePexelsImageUrl(url) {
    try {
      const urlObj = new URL(url);
      const allowedDomains = window.PEXELS_ALLOWED_DOMAINS || [
        'images.pexels.com',
        'www.pexels.com',
      ];
      return allowedDomains.includes(urlObj.hostname);
    } catch (_) {
      return false;
    }
  }

  function readHighlights() {
    return [1, 2, 3, 4, 5]
      .map(i => $(`sup-highlight-${i}`)?.value?.trim() || '')
      .filter(Boolean)
      .slice(0, 5);
  }

  function readFeaturedServices() {
    return String($('sup-featured-services')?.value || '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 10);
  }

  function readSocialLinks() {
    const socialLinks = {};
    for (const platform of SOCIAL_PLATFORMS) {
      const input = $(`sup-social-${platform}`);
      if (!input || !input.value.trim()) {
        continue;
      }
      const result = normaliseSocialUrl(input.value);
      if (result.error) {
        throw new Error(`${SOCIAL_LABELS[platform]}: ${result.error}`);
      }
      input.value = result.value;
      socialLinks[platform] = result.value;
    }
    return socialLinks;
  }

  function buildSavePayload() {
    const bannerInput = document.getElementById('sup-banner');
    const payload = {
      bannerUrl: bannerInput?.value?.trim() || '',
      tagline: $('sup-tagline')?.value?.trim() || '',
      highlights: readHighlights(),
      featuredServices: readFeaturedServices(),
      socialLinks: readSocialLinks(),
    };
    if (themeSelectionChanged) {
      payload.themeMode = 'custom';
      payload.themeColor = getThemeColor();
    }
    return payload;
  }

  function renderPlaceholder(container, message) {
    if (!container) {
      return;
    }
    const placeholder = document.createElement('p');
    placeholder.className = 'pc-preview-placeholder';
    placeholder.textContent = message;
    container.appendChild(placeholder);
  }

  function updateLivePreview() {
    const tagline = $('sup-tagline')?.value || '';
    const pTagline = $('preview-tagline');
    if (pTagline) {
      pTagline.textContent = tagline;
    }

    const pHl = $('preview-highlights');
    if (pHl) {
      clearChildren(pHl);
      const highlights = readHighlights();
      highlights.forEach(value => {
        const el = document.createElement('div');
        el.className = 'pc-preview-highlight';
        el.textContent = value;
        pHl.appendChild(el);
      });
      if (highlights.length === 0) {
        renderPlaceholder(pHl, 'Add two strong highlights to show buyers why they should enquire.');
      }
    }

    const services = readFeaturedServices().slice(0, 5);
    const pSvc = $('preview-services');
    if (pSvc) {
      clearChildren(pSvc);
      services.forEach(service => {
        const tag = document.createElement('span');
        tag.className = 'pc-preview-tag';
        tag.textContent = service;
        pSvc.appendChild(tag);
      });
      applyThemeColor(getThemeColor(), false);
    }

    const activeSocial = SOCIAL_PLATFORMS.filter(platform =>
      $(`sup-social-${platform}`)?.value?.trim()
    );
    const pSocialRow = $('preview-social-row');
    const pSocialDots = $('preview-social-dots');
    if (pSocialRow && pSocialDots) {
      pSocialRow.style.display = activeSocial.length > 0 ? 'flex' : 'none';
      clearChildren(pSocialDots);
      activeSocial.forEach(platform => {
        const dot = document.createElement('span');
        dot.className = 'pc-preview-social-dot';
        dot.textContent = SOCIAL_LABELS[platform].charAt(0);
        dot.title = SOCIAL_LABELS[platform];
        pSocialDots.appendChild(dot);
      });
    }

    updateCompletion();
  }

  function updateCompletion() {
    const checks = {
      banner: !!$('sup-banner')?.value,
      tagline: !!$('sup-tagline')?.value?.trim(),
      highlights: readHighlights().length >= 2,
      services: readFeaturedServices().length > 0,
      social: SOCIAL_PLATFORMS.some(platform => $(`sup-social-${platform}`)?.value?.trim()),
    };
    const done = Object.values(checks).filter(Boolean).length;
    const total = Object.keys(checks).length;
    const pct = Math.round((done / total) * 100);
    const fill = $('pc-progress-fill');
    const label = $('pc-pct-label');
    if (fill) {
      fill.style.width = `${pct}%`;
    }
    if (label) {
      label.textContent = `${pct}%`;
    }
    document.querySelectorAll('.pc-tip[data-tip]').forEach(el => {
      el.classList.toggle('pc-tip--done', !!checks[el.dataset.tip]);
    });
  }

  function populateForm(supplier) {
    if (!supplier) {
      return;
    }
    initialising = true;

    const supId = $('sup-id');
    if (supId) {
      supId.value = supplier.id || '';
    }
    const bannerInput = $('sup-banner');
    if (bannerInput) {
      bannerInput.value = supplier.bannerUrl || '';
    }
    updateBannerPreview(supplier.bannerUrl || '');

    const tagline = $('sup-tagline');
    if (tagline) {
      tagline.value = supplier.tagline || '';
      updateTaglineCount();
    }
    applyThemeColor(supplier.themeColor || DEFAULT_COLOR, false);
    themeSelectionChanged = false;

    for (let i = 1; i <= 5; i++) {
      const input = $(`sup-highlight-${i}`);
      if (input) {
        input.value =
          supplier.highlights && supplier.highlights[i - 1] ? supplier.highlights[i - 1] : '';
      }
    }
    const featured = $('sup-featured-services');
    if (featured) {
      featured.value = (supplier.featuredServices || []).join('\n');
    }
    SOCIAL_PLATFORMS.forEach(platform => {
      const input = $(`sup-social-${platform}`);
      if (input) {
        input.value = (supplier.socialLinks && supplier.socialLinks[platform]) || '';
      }
    });

    const previewName = $('preview-name');
    if (previewName) {
      previewName.textContent = supplier.name || 'Your Business Name';
    }
    const previewBtn = $('sup-preview');
    if (previewBtn && supplier.id) {
      previewBtn.style.display = 'inline-flex';
    }

    updateLivePreview();
    markClean();
    initialising = false;
  }

  async function loadSuppliers() {
    const container = $('profile-selector-container');
    try {
      const data = await api('/api/me/suppliers');
      suppliers = data.items || [];
      const selectorSection = $('pc-selector-section');
      if (!container) {
        return;
      }

      if (suppliers.length === 0) {
        container.innerHTML = `
          <p class="small" style="color:#667085;margin:0;">
            You do not have any supplier profiles yet.
            <a href="/dashboard/supplier" style="color:#0b8073;font-weight:600;">Create one on your dashboard</a>.
          </p>
        `;
        return;
      }

      if (suppliers.length === 1) {
        container.innerHTML = `<p class="small" style="color:#667085;margin:0;">Editing: <strong>${escapeHtml(suppliers[0].name)}</strong></p>`;
        if (selectorSection) {
          selectorSection.style.display = 'none';
        }
        currentEditingSupplierId = suppliers[0].id;
        populateForm(suppliers[0]);
        return;
      }

      if (selectorSection) {
        selectorSection.style.display = '';
      }
      container.innerHTML = `
        <label for="profile-select" style="font-size:.85rem;font-weight:600;color:#374151;margin-bottom:.375rem;display:block;">Choose a profile to customise:</label>
        <select id="profile-select">
          ${suppliers.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('')}
        </select>
      `;
      const select = $('profile-select');
      currentEditingSupplierId = suppliers[0].id;
      populateForm(suppliers[0]);
      select?.addEventListener('change', function () {
        const selectedSupplier = suppliers.find(s => s.id === this.value);
        if (selectedSupplier) {
          currentEditingSupplierId = selectedSupplier.id;
          populateForm(selectedSupplier);
        }
      });
    } catch (error) {
      console.error('Failed to load suppliers:', error);
      if (container) {
        container.innerHTML =
          '<p class="small" style="color:#dc2626;margin:0;">Failed to load profiles. Please refresh the page and try again.</p>';
      }
    }
  }

  function updateCachedSupplier(payload, response) {
    const responseSupplier = response && response.supplier ? response.supplier : null;
    const index = suppliers.findIndex(supplier => supplier.id === currentEditingSupplierId);
    if (index === -1) {
      return;
    }
    suppliers[index] = {
      ...suppliers[index],
      ...payload,
      ...(responseSupplier || {}),
      updatedAt: new Date().toISOString(),
    };
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation();
    }

    if (!currentEditingSupplierId) {
      notify('error', 'Please select a supplier profile first.');
      return;
    }

    let payload;
    try {
      payload = buildSavePayload();
    } catch (error) {
      notify('error', error.message);
      return;
    }

    try {
      setSaving(true);
      setStatus('Saving changes...', 'muted');
      const csrfToken = await ensureCsrfToken();
      const response = await api(
        `/api/me/suppliers/${encodeURIComponent(currentEditingSupplierId)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify(payload),
        }
      );
      updateCachedSupplier(payload, response);
      populateForm(suppliers.find(supplier => supplier.id === currentEditingSupplierId));
      markClean();
      notify('success', 'Profile changes saved successfully.');
      setStatus('✓ Saved successfully', 'success');
      setTimeout(() => setStatus('', 'muted'), 3500);
    } catch (error) {
      console.error('Error saving customization:', error);
      notify('error', error.message || 'Please try again.');
      setStatus(`Error: ${error.message || 'Please try again'}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  function handlePreview() {
    if (!currentEditingSupplierId) {
      notify('warning', 'Please select a profile first.');
      return;
    }
    const supplier = suppliers.find(item => item.id === currentEditingSupplierId);
    if (!supplier?.publicProfilePath) {
      notify('warning', 'A public profile link is not available yet.');
      return;
    }
    window.open(`${supplier.publicProfilePath}?preview=true`, '_blank');
  }

  function updateTaglineCount() {
    const taglineInput = $('sup-tagline');
    const taglineCount = $('tagline-count');
    if (!taglineInput || !taglineCount) {
      return;
    }
    const len = taglineInput.value.length;
    const max = Number(taglineInput.maxLength) || 100;
    taglineCount.textContent = `${len} / ${max}`;
    taglineCount.className = `pc-char-count${
      len > max ? ' pc-char-count--over' : len > max * 0.85 ? ' pc-char-count--warn' : ''
    }`;
  }

  function setupColourControls() {
    const colorPicker = cleanInteractiveElement($('sup-theme-color'));
    const colorHex = cleanInteractiveElement($('sup-theme-color-hex'));
    const resetBtn = cleanInteractiveElement($('reset-theme-color'));
    const presets = cleanInteractiveSelector('.color-preset');

    colorPicker?.addEventListener('input', function () {
      applyThemeColor(this.value, true);
    });
    colorHex?.addEventListener('input', function () {
      const hex = this.value.trim();
      if (HEX_RE.test(hex)) {
        applyThemeColor(hex, true);
      }
    });
    resetBtn?.addEventListener('click', event => {
      event.preventDefault();
      applyThemeColor(DEFAULT_COLOR, true);
    });
    presets.forEach(preset => {
      preset?.addEventListener('click', function (event) {
        event.preventDefault();
        applyThemeColor(this.dataset.color || DEFAULT_COLOR, true);
      });
    });
  }

  function setupDirtyAndPreview() {
    const form = $('customization-form');
    if (!form) {
      return;
    }
    form.addEventListener('submit', handleFormSubmit, true);
    form.querySelectorAll('input, textarea').forEach(el => {
      el.addEventListener('input', () => {
        updateTaglineCount();
        updateLivePreview();
        markDirty();
      });
      el.addEventListener('change', () => {
        updateLivePreview();
        markDirty();
      });
    });

    const saveBarSave = cleanInteractiveElement($('pc-save-bar-save'));
    const saveBarDiscard = cleanInteractiveElement($('pc-save-bar-discard'));
    saveBarSave?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    saveBarDiscard?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const supplier = suppliers.find(item => item.id === currentEditingSupplierId);
      if (supplier) {
        populateForm(supplier);
      }
      markClean();
    });
  }

  function setupBannerUpload() {
    const dropZone = $('sup-banner-drop');
    if (dropZone) {
      dropZone.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          dropZone.click();
        }
      });
    }

    if (typeof window.efSetupPhotoDropZone === 'function') {
      window.efSetupPhotoDropZone(
        'sup-banner-drop',
        'sup-banner-preview',
        dataUrl => {
          const input = $('sup-banner');
          setInputValue(input, dataUrl);
          updateBannerPreview(dataUrl);
          markDirty();
        },
        () => {
          const input = $('sup-banner');
          setInputValue(input, '');
          updateBannerPreview('');
          markDirty();
        }
      );
      return;
    }

    if (!dropZone) {
      return;
    }
    const fallbackInput = document.createElement('input');
    fallbackInput.type = 'file';
    fallbackInput.accept = 'image/jpeg,image/png,image/webp';
    fallbackInput.hidden = true;
    document.body.appendChild(fallbackInput);
    dropZone.addEventListener('click', () => fallbackInput.click());
    fallbackInput.addEventListener('change', () => {
      const file = fallbackInput.files && fallbackInput.files[0];
      if (!file) {
        return;
      }
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) {
        notify('error', 'Please choose a JPG, PNG or WebP image under 5 MB.');
        fallbackInput.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const input = $('sup-banner');
        setInputValue(input, String(reader.result || ''));
        updateBannerPreview(String(reader.result || ''));
        markDirty();
      };
      reader.readAsDataURL(file);
    });
  }

  function setupPexelsSelector() {
    const stockPhotoBtn = $('select-stock-photo-btn');
    if (!stockPhotoBtn) {
      return;
    }
    if (typeof window.PexelsSelector === 'undefined') {
      stockPhotoBtn.addEventListener('click', () => {
        notify(
          'error',
          'Stock photos are not available at the moment. Please upload a banner image instead.'
        );
      });
      return;
    }

    const selector = new window.PexelsSelector();
    stockPhotoBtn.addEventListener('click', () => {
      selector.open(selectedImageUrl => {
        if (!validatePexelsImageUrl(selectedImageUrl)) {
          notify('error', 'Invalid image URL. Please try selecting another photo.');
          return;
        }
        updateBannerPreview(selectedImageUrl);
        const bannerInput = document.getElementById('sup-banner');
        if (bannerInput) {
          bannerInput.value = selectedImageUrl;
          bannerInput.dispatchEvent(new Event('input', { bubbles: true }));
          bannerInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        markDirty();
        notify('success', 'Stock photo selected successfully!');
      });
    });
  }

  async function verifySupplierAccess() {
    const response = await fetch('/api/v1/auth/me', { credentials: 'include' });
    if (!response.ok) {
      window.location.href = `/auth?redirect=${encodeURIComponent(window.location.pathname)}`;
      return false;
    }
    const data = await response.json();
    if (data.user && data.user.role !== 'supplier') {
      window.location.href = '/dashboard/customer';
      return false;
    }
    return true;
  }

  async function init() {
    injectPolishStyles();
    try {
      const allowed = await verifySupplierAccess();
      if (!allowed) {
        return;
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      window.location.href = '/auth';
      return;
    }

    setupColourControls();
    setupDirtyAndPreview();
    setupBannerUpload();
    setupPexelsSelector();
    $('sup-preview')?.addEventListener('click', handlePreview);

    await loadSuppliers();
    updateTaglineCount();
    updateLivePreview();

    window._pcReloadCurrentSupplier = function () {
      const supplier = suppliers.find(item => item.id === currentEditingSupplierId);
      if (supplier) {
        populateForm(supplier);
      }
    };
    window._pcMarkClean = markClean;
    window._pcMarkDirty = markDirty;
    window._pcUpdatePreview = updateLivePreview;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
