const PROFILE_POLISH_STYLESHEET_ID = 'supplier-profile-polish-styles';
const PROFILE_POLISH_STYLESHEET_HREF = '/assets/css/supplier-profile-polish.css?v=19.4.2';

const SOCIAL_PLATFORMS = {
  facebook: {
    label: 'Facebook',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14 8h3V4.2c-.52-.07-2.31-.2-4.43-.2C8.14 4 5.1 6.63 5.1 11.47V15H2v4.25h3.1V24h4.27v-4.75h3.56L13.5 15H9.37v-3.11c0-1.23.33-2.07 2.1-2.07H14V8Z"/></svg>',
  },
  instagram: {
    label: 'Instagram',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor"/></svg>',
  },
  twitter: {
    label: 'X',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.2 3H21l-6.12 7 7.2 11H16.45l-4.4-5.76L7 21H4.18l6.56-7.5L3.84 3h5.77l3.98 5.27L18.2 3Zm-.99 16.06h1.55L8.76 4.84H7.1l10.11 14.22Z"/></svg>',
  },
  linkedin: {
    label: 'LinkedIn',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5.34 7.5H1.67V19.2h3.67V7.5ZM3.5 1.8a2.13 2.13 0 1 0 0 4.25 2.13 2.13 0 0 0 0-4.25ZM19.2 7.23c-1.76 0-2.94.97-3.42 1.9h-.05V7.5h-3.52v11.7h3.67v-5.79c0-1.52.29-3 2.18-3 1.86 0 1.88 1.74 1.88 3.1v5.69h3.67v-6.42c0-3.16-.68-5.55-4.41-5.55Z"/></svg>',
  },
  youtube: {
    label: 'YouTube',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M23.5 6.2a3 3 0 0 0-2.1-2.12C19.55 3.58 12 3.58 12 3.58s-7.55 0-9.4.5A3 3 0 0 0 .5 6.2 31.2 31.2 0 0 0 0 12a31.2 31.2 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.12c1.85.5 9.4.5 9.4.5s7.55 0 9.4-.5a3 3 0 0 0 2.1-2.12A31.2 31.2 0 0 0 24 12a31.2 31.2 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.24 3.6-6.24 3.6Z"/></svg>',
  },
  tiktok: {
    label: 'TikTok',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15.3 2c.38 2.14 1.58 3.42 3.7 3.56V8.6a7.08 7.08 0 0 1-3.67-.99v6.18a6.02 6.02 0 1 1-5.2-5.97c.4-.05.8-.06 1.2-.02v3.12a2.95 2.95 0 1 0 .01 5.73c.68-.24 1.12-.88 1.12-1.6V2h2.84Z"/></svg>',
  },
};

function loadProfilePolishStylesheet() {
  if (document.getElementById(PROFILE_POLISH_STYLESHEET_ID)) {
    return;
  }

  const link = document.createElement('link');
  link.id = PROFILE_POLISH_STYLESHEET_ID;
  link.rel = 'stylesheet';
  link.href = PROFILE_POLISH_STYLESHEET_HREF;
  document.head.appendChild(link);
}

function normaliseExternalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || /^(javascript|data|vbscript|file|blob):/i.test(raw)) {
    return null;
  }

  let candidate = raw;
  if (!/^[a-z][a-z\d+.-]*:/i.test(candidate)) {
    if (candidate.startsWith('//')) {
      candidate = `https:${candidate}`;
    } else if (/^(?:www\.)?[a-z\d](?:[a-z\d.-]*[a-z\d])?\.[a-z]{2,}(?:[/:?#]|$)/i.test(candidate)) {
      candidate = `https://${candidate}`;
    } else {
      return null;
    }
  }

  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
      return null;
    }
    return parsed.href;
  } catch (_) {
    return null;
  }
}

function enhanceCoverFallback(supplier = window.__supplierData) {
  const heroMedia = document.querySelector('#supplier-hero .hero-media');
  if (!heroMedia || !supplier) {
    return;
  }

  const hasCover = Boolean(supplier.bannerUrl || supplier.coverImage);
  heroMedia.classList.toggle('sp-hero-media--fallback', !hasCover);
}

function setSupplierAccent(supplier = window.__supplierData) {
  const accent = supplier?.themeColor;
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) {
    return;
  }
  document.documentElement.style.setProperty('--sp-profile-accent', accent);
}

function enhanceAboutDescription() {
  const description = document.querySelector('#sp-section-about .sp-about__description');
  if (!description || description.dataset.spReadMoreReady === 'true') {
    return;
  }

  const text = String(description.textContent || '').trim();
  if (text.length < 420 && text.split(/\n/).length < 6) {
    return;
  }

  description.dataset.spReadMoreReady = 'true';
  description.id = description.id || 'sp-about-description';
  description.classList.add('is-collapsible');

  requestAnimationFrame(() => {
    if (!description.isConnected) {
      return;
    }

    const clipped = description.scrollHeight > description.clientHeight + 2;
    if (!clipped) {
      description.classList.remove('is-collapsible');
      return;
    }

    if (description.nextElementSibling?.classList.contains('sp-about__toggle')) {
      return;
    }

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'sp-about__toggle';
    toggle.textContent = 'Read more';
    toggle.setAttribute('aria-controls', description.id);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      description.classList.toggle('is-expanded', !expanded);
      toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      toggle.textContent = expanded ? 'Read more' : 'Read less';
    });
    description.insertAdjacentElement('afterend', toggle);
  });
}

function enhanceWebsiteLink() {
  const links = document.querySelectorAll('#sp-section-about .sp-about__meta a[target="_blank"]');

  links.forEach(link => {
    if (link.dataset.spWebsiteEnhanced === 'true' || link.closest('.sp-social-links')) {
      return;
    }

    const safeUrl = normaliseExternalUrl(link.getAttribute('href'));
    if (!safeUrl) {
      link.remove();
      return;
    }

    const host = new URL(safeUrl).hostname.replace(/^www\./, '');
    link.dataset.spWebsiteEnhanced = 'true';
    link.href = safeUrl;
    link.rel = 'noopener noreferrer external';
    link.classList.add('sp-about__website');
    link.textContent = 'Visit website';
    link.title = host;
    link.setAttribute('aria-label', `Visit ${host} in a new tab`);
  });
}

function platformFromLink(link) {
  return Object.keys(SOCIAL_PLATFORMS).find(key =>
    link.classList.contains(`sp-social-link--${key}`)
  );
}

function enhanceSocialLinks() {
  document.querySelectorAll('#sp-section-about .sp-social-link').forEach(link => {
    if (link.dataset.spSocialEnhanced === 'true') {
      return;
    }

    const platform = platformFromLink(link);
    const definition = platform ? SOCIAL_PLATFORMS[platform] : null;
    const safeUrl = normaliseExternalUrl(link.getAttribute('href'));
    if (!definition || !safeUrl) {
      link.remove();
      return;
    }

    link.dataset.spSocialEnhanced = 'true';
    link.href = safeUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer external';
    link.referrerPolicy = 'no-referrer';
    link.setAttribute('aria-label', `Open ${definition.label} in a new tab`);
    link.innerHTML =
      `<span class="sp-social-link__icon">${definition.icon}</span>` +
      `<span>${definition.label}</span>`;
  });

  document.querySelectorAll('#sp-section-about .sp-social-links').forEach(group => {
    if (!group.querySelector('.sp-social-link')) {
      group.remove();
    }
  });
}

function removeGenericBadgeGroups(container) {
  container.querySelectorAll('.sp-badges-group-label').forEach(label => {
    const name = String(label.textContent || '')
      .trim()
      .toLowerCase();
    if (!['subscription', 'verification'].includes(name)) {
      return;
    }

    const row = label.nextElementSibling;
    if (row?.classList.contains('sp-badges-row')) {
      row.remove();
    }
    label.remove();
  });
}

function enhanceBadgesSection() {
  const container = document.getElementById('sp-section-badges');
  if (!container) {
    return;
  }

  removeGenericBadgeGroups(container);
  const meaningful = container.querySelector(
    '.sp-badge-card, .badge-founding, .badge-featured, [data-recognition="true"]'
  );
  const shouldShow = Boolean(meaningful);
  container.hidden = !shouldShow;
  container.classList.toggle('is-empty', !shouldShow);
}

function getDistributionTotal(widget) {
  const counts = [...widget.querySelectorAll('.rating-bar-count')];
  if (counts.length < 5) {
    return null;
  }

  return counts.reduce((total, item) => total + (Number.parseInt(item.textContent, 10) || 0), 0);
}

function enhanceReviewsState() {
  const widget = document.getElementById('reviews-widget');
  if (!widget) {
    return;
  }

  const emptyState = widget.querySelector('.reviews-empty');
  const distributionTotal = getDistributionTotal(widget);
  const isGenuinelyEmpty = Boolean(emptyState && distributionTotal === 0);
  widget.classList.toggle('sp-reviews-widget--empty', isGenuinelyEmpty);

  if (!isGenuinelyEmpty) {
    delete widget.dataset.spEmptyReady;
    return;
  }

  if (widget.dataset.spEmptyReady === 'true') {
    return;
  }
  widget.dataset.spEmptyReady = 'true';

  const title = emptyState.querySelector('.empty-title');
  const message = emptyState.querySelector('.empty-message');
  const action = emptyState.querySelector('.btn-write-review, .reviews-empty__signin-cta');
  if (title) {
    title.textContent = 'No EventFlow reviews yet';
  }
  if (message) {
    message.textContent = 'Be the first to share your experience with this supplier on EventFlow.';
  }
  if (action?.classList.contains('btn-write-review')) {
    action.textContent = 'Write a review';
  }
}

let reviewSyncQueued = false;
function queueReviewSync() {
  if (reviewSyncQueued) {
    return;
  }

  reviewSyncQueued = true;
  requestAnimationFrame(() => {
    reviewSyncQueued = false;
    enhanceReviewsState();
  });
}

function observeProfileMount(id, callback) {
  const mount = document.getElementById(id);
  if (!mount || mount.dataset.spPolishObserved === 'true') {
    return;
  }

  mount.dataset.spPolishObserved = 'true';
  new MutationObserver(callback).observe(mount, { childList: true, subtree: true });
}

function enhanceProfile(supplier = window.__supplierData) {
  enhanceCoverFallback(supplier);
  setSupplierAccent(supplier);
  enhanceAboutDescription();
  enhanceWebsiteLink();
  enhanceSocialLinks();
  enhanceBadgesSection();
  queueReviewSync();
}

function initSupplierProfilePolish() {
  loadProfilePolishStylesheet();
  enhanceProfile();

  observeProfileMount('sp-section-about', () => {
    enhanceAboutDescription();
    enhanceWebsiteLink();
    enhanceSocialLinks();
  });
  observeProfileMount('sp-section-badges', enhanceBadgesSection);
  observeProfileMount('sp-section-reviews', queueReviewSync);

  window.addEventListener('sp:dataReady', event => {
    enhanceProfile(event.detail?.supplier);
  });
}

window.SupplierProfilePolish = {
  enhanceProfile,
  enhanceReviewsState,
  normaliseExternalUrl,
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSupplierProfilePolish, { once: true });
} else {
  initSupplierProfilePolish();
}

export {
  enhanceBadgesSection,
  enhanceCoverFallback,
  enhanceProfile,
  enhanceReviewsState,
  normaliseExternalUrl,
};
