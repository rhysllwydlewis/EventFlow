'use strict';
(function () {
  if (window.__weddingThemeMediaCustomiserLoaded) {
    return;
  }
  window.__weddingThemeMediaCustomiserLoaded = true;

  const rootSelector = '#wedding-website-dashboard-root';
  const maxGallery = 12;
  const palettes = [
    {
      name: 'Sage & Blush',
      accentColor: '#0B8073',
      secondaryColor: '#F4A6C8',
      backgroundColor: '#FFF7FB',
      textColor: '#1E1B4B',
    },
    {
      name: 'Champagne Gold',
      accentColor: '#B88A2B',
      secondaryColor: '#F4D6A0',
      backgroundColor: '#FFF9EF',
      textColor: '#30261C',
    },
    {
      name: 'Midnight Romance',
      accentColor: '#24436F',
      secondaryColor: '#BFA2DB',
      backgroundColor: '#F6F3FF',
      textColor: '#161B33',
    },
    {
      name: 'Terracotta',
      accentColor: '#B85C38',
      secondaryColor: '#E9A178',
      backgroundColor: '#FFF4EE',
      textColor: '#3B2119',
    },
    {
      name: 'Coastal Blue',
      accentColor: '#2C94B1',
      secondaryColor: '#9AD7E5',
      backgroundColor: '#F2FBFE',
      textColor: '#14313B',
    },
    {
      name: 'Classic Rose',
      accentColor: '#A8325F',
      secondaryColor: '#F2A7C4',
      backgroundColor: '#FFF5FA',
      textColor: '#311827',
    },
  ];

  let cachedPlanId = '';
  let cachedState = null;

  function esc(value) {
    return String(value || '').replace(
      /[&<>"']/g,
      ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
    );
  }

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    const tokenFromMeta = meta?.getAttribute('content');
    if (tokenFromMeta) {
      return tokenFromMeta;
    }
    const cookieMatch = document.cookie.match(/(?:^|; )csrfToken=([^;]+)/);
    return cookieMatch ? decodeURIComponent(cookieMatch[1]) : '';
  }

  async function api(path, options = {}) {
    const opts = { ...options, credentials: options.credentials || 'same-origin' };
    const method = String(opts.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      opts.headers = { ...(opts.headers || {}) };
      const token = getCsrfToken();
      if (token && !opts.headers['X-CSRF-Token']) {
        opts.headers['X-CSRF-Token'] = token;
      }
    }
    const res = await fetch(path, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error || 'Request failed');
    }
    return json;
  }

  function planIdFromDom(root) {
    if (root?.dataset?.planId) {
      return root.dataset.planId;
    }
    const candidates = Array.from(
      root.querySelectorAll("a[href*='/api/me/plans/'], a[href*='/guests/export.csv']")
    );
    for (const link of candidates) {
      const match = link.getAttribute('href')?.match(/\/api\/me\/plans\/([^/]+)/);
      if (match) {
        return decodeURIComponent(match[1]);
      }
    }
    return '';
  }

  function collapseBuilderSections(root) {
    if (!root || root.dataset.defaultCollapsed === 'true') {
      return;
    }
    root.dataset.defaultCollapsed = 'true';
    const close = () =>
      root
        .querySelectorAll(
          '#ww-builder > details, .ww-password-privacy-panel, .ww-theme-media-panel'
        )
        .forEach(detail => {
          detail.open = false;
        });
    close();
    setTimeout(close, 500);
    setTimeout(close, 1200);
  }

  function defaultState() {
    return {
      accentColor: '#0B8073',
      secondaryColor: '#F4A6C8',
      backgroundColor: '#FFF7FB',
      textColor: '#1E1B4B',
      heroLayout: 'classic',
      coverImageUrl: '',
      galleryImages: [],
    };
  }

  async function imageToDataUrl(file) {
    if (!file || !file.type.startsWith('image/')) {
      throw new Error('Please choose an image file.');
    }
    if (file.size > 700000) {
      throw new Error('Please choose an image under 700 KB for now.');
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Unable to read this image.'));
      reader.readAsDataURL(file);
    });
  }

  function collect(panel) {
    return {
      accentColor: panel.querySelector('[name="themeAccent"]')?.value || '#0B8073',
      secondaryColor: panel.querySelector('[name="themeSecondary"]')?.value || '#F4A6C8',
      backgroundColor: panel.querySelector('[name="themeBackground"]')?.value || '#FFF7FB',
      textColor: panel.querySelector('[name="themeText"]')?.value || '#1E1B4B',
      heroLayout: panel.querySelector('[name="heroLayout"]:checked')?.value || 'classic',
      coverImageUrl: panel.dataset.coverImageUrl || '',
      galleryImages: JSON.parse(panel.dataset.galleryImages || '[]'),
    };
  }

  function applyPreview(panel) {
    const state = collect(panel);
    const preview = panel.querySelector('.ww-theme-preview');
    if (!preview) {
      return;
    }
    preview.style.setProperty('--ww-theme-accent', state.accentColor);
    preview.style.setProperty('--ww-theme-secondary', state.secondaryColor);
    preview.style.setProperty('--ww-theme-bg', state.backgroundColor);
    preview.style.setProperty('--ww-theme-text', state.textColor);
    preview.className = `ww-theme-preview ww-theme-preview--${state.heroLayout}`;
    const hero = preview.querySelector('.ww-theme-preview__hero');
    if (hero) {
      hero.style.backgroundImage = state.coverImageUrl
        ? `linear-gradient(135deg, rgba(0,0,0,.42), rgba(0,0,0,.08)), url('${state.coverImageUrl}')`
        : '';
    }
    const gallery = preview.querySelector('.ww-theme-preview__gallery');
    if (gallery) {
      gallery.innerHTML = state.galleryImages
        .slice(0, 4)
        .map(item => `<span style="background-image:url('${esc(item.imageUrl)}')"></span>`)
        .join('');
    }
  }

  function renderGallery(panel) {
    const gallery = JSON.parse(panel.dataset.galleryImages || '[]');
    const list = panel.querySelector('.ww-media-gallery-list');
    if (!list) {
      return;
    }
    list.innerHTML = gallery.length
      ? gallery
          .map(
            (item, index) =>
              `<article class="ww-media-thumb"><img src="${esc(item.imageUrl)}" alt="${esc(item.alt || item.caption || 'Gallery image')}"><input value="${esc(item.caption || '')}" placeholder="Optional caption" data-caption-index="${index}"><div class="ww-media-thumb__actions"><button type="button" data-move-gallery="${index}" data-direction="up" ${index === 0 ? 'disabled' : ''}>Move up</button><button type="button" data-move-gallery="${index}" data-direction="down" ${index === gallery.length - 1 ? 'disabled' : ''}>Move down</button><button type="button" data-remove-gallery="${index}" aria-label="Remove image">Remove</button></div></article>`
          )
          .join('')
      : '<p class="small">No gallery photos yet. Add a few moments guests will love.</p>';
    list.querySelectorAll('[data-remove-gallery]').forEach(button =>
      button.addEventListener('click', () => {
        const next = JSON.parse(panel.dataset.galleryImages || '[]');
        next.splice(Number(button.dataset.removeGallery), 1);
        panel.dataset.galleryImages = JSON.stringify(next);
        renderGallery(panel);
        applyPreview(panel);
      })
    );
    list.querySelectorAll('[data-move-gallery]').forEach(button =>
      button.addEventListener('click', () => {
        const next = JSON.parse(panel.dataset.galleryImages || '[]');
        const from = Number(button.dataset.moveGallery);
        const to = button.dataset.direction === 'up' ? from - 1 : from + 1;
        if (to < 0 || to >= next.length) {
          return;
        }
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        panel.dataset.galleryImages = JSON.stringify(next);
        renderGallery(panel);
        applyPreview(panel);
      })
    );
    list.querySelectorAll('[data-caption-index]').forEach(input =>
      input.addEventListener('input', () => {
        const next = JSON.parse(panel.dataset.galleryImages || '[]');
        if (next[Number(input.dataset.captionIndex)]) {
          next[Number(input.dataset.captionIndex)].caption = input.value;
        }
        panel.dataset.galleryImages = JSON.stringify(next);
        applyPreview(panel);
      })
    );
  }

  function setState(panel, state) {
    const merged = { ...defaultState(), ...(state || {}) };
    panel.querySelector('[name="themeAccent"]').value = merged.accentColor;
    panel.querySelector('[name="themeSecondary"]').value = merged.secondaryColor;
    panel.querySelector('[name="themeBackground"]').value = merged.backgroundColor;
    panel.querySelector('[name="themeText"]').value = merged.textColor;
    const layout =
      panel.querySelector(`[name="heroLayout"][value="${merged.heroLayout || 'classic'}"]`) ||
      panel.querySelector('[name="heroLayout"]');
    if (layout) {
      layout.checked = true;
    }
    panel.dataset.coverImageUrl = merged.coverImageUrl || '';
    panel.dataset.galleryImages = JSON.stringify(
      Array.isArray(merged.galleryImages) ? merged.galleryImages : []
    );
    const coverImg = panel.querySelector('.ww-cover-preview img');
    const coverEmpty = panel.querySelector('.ww-cover-empty');
    if (coverImg) {
      coverImg.src = merged.coverImageUrl || '';
      coverImg.hidden = !merged.coverImageUrl;
    }
    if (coverEmpty) {
      coverEmpty.hidden = !!merged.coverImageUrl;
    }
    renderGallery(panel);
    applyPreview(panel);
  }

  function createPanel(root) {
    const form = root.querySelector('#ww-builder');
    if (!form || form.querySelector('.ww-theme-media-panel')) {
      return null;
    }
    const panel = document.createElement('details');
    panel.className = 'ww-theme-media-panel';
    panel.open = false;
    panel.innerHTML = `
      <summary>Theme colours & photos</summary>
      <div class="ww-theme-media-card">
        <div class="ww-theme-media-grid">
          <section class="ww-theme-tools">
            <h4>Colour theme</h4>
            <p class="small">Pick a polished palette or fine-tune every colour with the custom picker.</p>
            <div class="ww-palette-grid">${palettes.map((p, i) => `<button type="button" class="ww-palette" data-palette="${i}" title="${esc(p.name)}"><span style="background:${p.accentColor}"></span><span style="background:${p.secondaryColor}"></span><span style="background:${p.backgroundColor}"></span><strong>${esc(p.name)}</strong></button>`).join('')}</div>
            <div class="ww-colour-grid">
              <label>Accent<input type="color" name="themeAccent"><span>Buttons and highlights</span></label>
              <label>Secondary<input type="color" name="themeSecondary"><span>Soft decorative colour</span></label>
              <label>Background<input type="color" name="themeBackground"><span>Page wash</span></label>
              <label>Text<input type="color" name="themeText"><span>Headings and body text</span></label>
            </div>
            <h4>Hero layout</h4>
            <div class="ww-layout-row">
              <label><input type="radio" name="heroLayout" value="classic"> Classic</label>
              <label><input type="radio" name="heroLayout" value="editorial"> Editorial</label>
              <label><input type="radio" name="heroLayout" value="full_bleed"> Full bleed</label>
            </div>
            <h4>Hero photo</h4>
            <div class="ww-cover-preview"><img alt="Hero preview" hidden><div class="ww-cover-empty">Upload a hero photo</div></div>
            <div class="ww-media-actions"><label class="cta secondary small">Choose hero photo<input type="file" accept="image/*" data-cover-upload hidden></label><button type="button" class="cta secondary small" data-remove-cover>Remove</button></div>
            <h4>Gallery photos</h4>
            <div class="ww-media-actions"><label class="cta secondary small">Add gallery photos<input type="file" accept="image/*" multiple data-gallery-upload hidden></label></div>
            <div class="ww-media-gallery-list"></div>
            <div class="ww-theme-actions"><button type="button" class="cta primary" data-save-theme>Save theme & photos</button><span class="ww-theme-message" role="status" aria-live="polite"></span></div>
          </section>
          <section class="ww-theme-preview" aria-label="Wedding website theme preview">
            <div class="ww-theme-preview__hero"><p>Wedding Celebration</p><h3>Your Wedding Website</h3><span>Saturday, 15 May 2026 · Cardiff</span></div>
            <div class="ww-theme-preview__body"><h4>Preview</h4><p>This shows how the public website colours, hero image and gallery will feel.</p><button type="button">RSVP now</button><div class="ww-theme-preview__gallery"></div></div>
          </section>
        </div>
      </div>`;
    const privacy = form.querySelector('.ww-password-privacy-panel');
    if (privacy) {
      privacy.after(panel);
    } else {
      form.prepend(panel);
    }
    return panel;
  }

  async function init(root) {
    const form = root.querySelector('#ww-builder');
    if (!form || form.dataset.themeMediaReady === 'true') {
      return;
    }
    const planId = planIdFromDom(root);
    if (!planId) {
      return;
    }
    form.dataset.themeMediaReady = 'true';
    const panel = createPanel(root);
    if (!panel) {
      return;
    }
    cachedPlanId = planId;
    try {
      const data = await api(
        `/api/me/plans/${encodeURIComponent(planId)}/wedding-website/theme-media`
      );
      cachedState = data.themeMedia || defaultState();
    } catch (_err) {
      cachedState = defaultState();
    }
    setState(panel, cachedState);
    collapseBuilderSections(root);
    panel.addEventListener('input', event => {
      if (event.target.matches('input[type="color"], input[name="heroLayout"]')) {
        applyPreview(panel);
      }
    });
    panel.querySelectorAll('[data-palette]').forEach(button =>
      button.addEventListener('click', () => {
        const p = palettes[Number(button.dataset.palette)] || palettes[0];
        setState(panel, { ...collect(panel), ...p });
      })
    );
    panel.querySelector('[data-cover-upload]').addEventListener('change', async event => {
      const msg = panel.querySelector('.ww-theme-message');
      try {
        const dataUrl = await imageToDataUrl(event.target.files[0]);
        panel.dataset.coverImageUrl = dataUrl;
        setState(panel, collect(panel));
        msg.textContent = 'Hero photo ready to save.';
      } catch (err) {
        msg.textContent = err.message;
      }
      event.target.value = '';
    });
    panel.querySelector('[data-gallery-upload]').addEventListener('change', async event => {
      const msg = panel.querySelector('.ww-theme-message');
      const current = JSON.parse(panel.dataset.galleryImages || '[]');
      try {
        for (const file of Array.from(event.target.files).slice(0, maxGallery - current.length)) {
          current.push({
            id: `gallery_${Date.now()}_${current.length}`,
            imageUrl: await imageToDataUrl(file),
            caption: '',
            alt: '',
          });
        }
        panel.dataset.galleryImages = JSON.stringify(current.slice(0, maxGallery));
        renderGallery(panel);
        applyPreview(panel);
        msg.textContent = 'Gallery photos ready to save.';
      } catch (err) {
        msg.textContent = err.message;
      }
      event.target.value = '';
    });
    panel.querySelector('[data-remove-cover]').addEventListener('click', () => {
      panel.dataset.coverImageUrl = '';
      setState(panel, collect(panel));
    });
    panel.querySelector('[data-save-theme]').addEventListener('click', async () => {
      const button = panel.querySelector('[data-save-theme]');
      const msg = panel.querySelector('.ww-theme-message');
      if (!cachedPlanId) {
        msg.textContent = 'Unable to find the wedding plan. Please refresh and try again.';
        return;
      }
      button.disabled = true;
      button.textContent = 'Saving…';
      try {
        const data = await api(
          `/api/me/plans/${encodeURIComponent(cachedPlanId)}/wedding-website/theme-media`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(collect(panel)),
          }
        );
        cachedState = data.themeMedia;
        setState(panel, cachedState);
        msg.textContent = 'Theme and photos saved. Preview has been updated.';
      } catch (err) {
        msg.textContent = err.message || 'Unable to save theme.';
      }
      button.disabled = false;
      button.textContent = 'Save theme & photos';
    });
  }

  function waitForBuilder() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const root = document.querySelector(rootSelector);
      if (root?.querySelector('#ww-builder') && planIdFromDom(root)) {
        clearInterval(timer);
        init(root);
      } else if (attempts > 120) {
        clearInterval(timer);
      }
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForBuilder);
  } else {
    waitForBuilder();
  }
})();
