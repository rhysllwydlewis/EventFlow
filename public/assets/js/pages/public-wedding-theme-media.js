'use strict';
(function () {
  if (window.__publicWeddingThemeMediaLoaded) {
    return;
  }
  window.__publicWeddingThemeMediaLoaded = true;

  const slug = window.location.pathname.split('/').filter(Boolean).pop();
  const root = document.getElementById('public-wedding-root');
  if (!slug || !root) {
    return;
  }

  const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/]+={0,2}$/i;

  function esc(value) {
    return String(value || '').replace(
      /[&<>"']/g,
      ch =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[ch]
    );
  }

  function safeImageUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }
    if (DATA_IMAGE_RE.test(raw)) {
      return raw;
    }
    try {
      const url = new URL(raw, window.location.origin);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_err) {
      return '';
    }
  }

  function cssUrl(value) {
    const safe = safeImageUrl(value);
    return safe ? `url("${safe.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")` : '';
  }

  function apply(theme) {
    if (!theme) {
      return;
    }
    document.documentElement.style.setProperty('--wed-accent', theme.accentColor || '#0B8073');
    document.documentElement.style.setProperty(
      '--wed-secondary',
      theme.secondaryColor || '#F4A6C8'
    );
    document.documentElement.style.setProperty('--wed-bg', theme.backgroundColor || '#FFF7FB');
    document.documentElement.style.setProperty('--wed-text', theme.textColor || '#1E1B4B');
    document.body.classList.add('wed-themed');
    if (theme.heroLayout) {
      document.body.dataset.heroLayout = theme.heroLayout;
    }

    const heroImage = cssUrl(theme.coverImageUrl);
    const hero = root.querySelector('.wed-hero');
    if (hero && heroImage) {
      hero.classList.add('wed-hero--image');
      hero.style.setProperty('--hero-image', heroImage);
      hero.style.backgroundImage = `linear-gradient(135deg, rgba(0,0,0,.44), rgba(0,0,0,.12)), ${heroImage}`;
    }

    const gallery = Array.isArray(theme.galleryImages)
      ? theme.galleryImages
          .map(item => ({ ...item, imageUrl: safeImageUrl(item && item.imageUrl) }))
          .filter(item => item && item.imageUrl)
      : [];
    if (!gallery.length || root.querySelector('.wed-gallery')) {
      return;
    }
    const rsvp = root.querySelector('#rsvp');
    const section = document.createElement('section');
    section.className = 'wed-card wed-gallery';
    section.innerHTML = `<p class="wed-kicker">Photo gallery</p><h2>Moments we love</h2><div class="wed-gallery-grid">${gallery
      .map(
        item =>
          `<figure><img src="${esc(item.imageUrl)}" alt="${esc(item.alt || item.caption || 'Wedding gallery photo')}" loading="lazy">${item.caption ? `<figcaption>${esc(item.caption)}</figcaption>` : ''}</figure>`
      )
      .join('')}</div>`;
    if (rsvp) {
      rsvp.before(section);
    } else {
      root.appendChild(section);
    }
  }

  async function loadFromThemeEndpoint() {
    const response = await fetch(
      `/api/public/wedding-websites/${encodeURIComponent(slug)}/theme-media`,
      {
        credentials: 'same-origin',
      }
    );
    if (!response.ok) {
      return null;
    }
    const data = await response.json().catch(() => ({}));
    return data.themeMedia || null;
  }

  async function load() {
    try {
      const theme = window.__PUBLIC_WEDDING_THEME_MEDIA__ || (await loadFromThemeEndpoint());
      apply(theme);
    } catch (_err) {
      // Decorative enhancement only. Never block the public website.
    }
  }

  window.addEventListener('eventflow:wedding-theme-media-ready', event => {
    apply(event.detail || window.__PUBLIC_WEDDING_THEME_MEDIA__);
  });

  const observer = new MutationObserver(() => {
    if (root.querySelector('.wed-hero')) {
      observer.disconnect();
      load();
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  if (root.querySelector('.wed-hero')) {
    observer.disconnect();
    load();
  }
})();
