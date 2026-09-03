// Global CSP-safe image error handler (capture phase, registered once per page load).
// Handles data-fallback-src, data-fallback-hide, data-fallback-show-next, and
// data-fallback-action="attachment-error" attributes set on <img> elements.
// This replaces inline onerror="..." attributes blocked by script-src-attr 'none'.
'use strict';
(function () {
  if (window.__imgFallbackRegistered) {
    return;
  }
  window.__imgFallbackRegistered = true;
  function _handleImgError(e) {
    const img = e.target;
    if (!img || img.tagName !== 'IMG') {
      return;
    }
    if (img.dataset.fallbackApplied) {
      return;
    }
    img.dataset.fallbackApplied = 'true';
    if (img.dataset.fallbackAction === 'attachment-error') {
      img.style.display = 'none';
      img.classList.add('messenger-v4__attachment-error');
      if (img.parentNode) {
        const w = document.createElement('span');
        w.className = 'messenger-v4__attachment-error-label';
        w.title = 'Image unavailable';
        const l = document.createElement('span');
        l.textContent = 'Image unavailable';
        const h = document.createElement('span');
        h.className = 'messenger-v4__attachment-error-hint';
        h.textContent = 'The file may have been removed';
        w.appendChild(l);
        w.appendChild(h);
        img.parentNode.appendChild(w);
      }
      return;
    }
    if (img.dataset.fallbackSrc) {
      img.src = img.dataset.fallbackSrc;
      return;
    }
    if ('fallbackHide' in img.dataset) {
      img.style.display = 'none';
      if ('fallbackShowNext' in img.dataset && img.nextElementSibling) {
        img.nextElementSibling.style.display = 'flex';
      }
    }
  }
  document.addEventListener('error', _handleImgError, true);
})();

/**
 * Deduplicated fetch-as-JSON utility.
 *
 * The supplier dashboard makes several independent async calls to
 * `/api/v2/subscriptions/me` on page load (once from app.js's loadSuppliers
 * fallback, once from dashboard-supplier-module.js's displaySubscriptionStatus).
 * Without deduplication, both calls hit the server — and the server calls
 * stripe.customers.retrieve for each one, doubling the noise in Stripe Workbench.
 *
 * This helper stores the in-flight Promise for each URL so that concurrent
 * callers share a single network request and get the same parsed JSON result.
 * The cache entry is cleared once the request settles.
 *
 * @param {string} url  - The URL to fetch.
 * @param {object} opts - Fetch options (credentials, headers, etc.).
 * @returns {Promise<object|null>} Parsed JSON body or null on error.
 */
window._efFetchOnceJSON = function _efFetchOnceJSON(url, opts) {
  const cache = (window._efFetchOnceCache = window._efFetchOnceCache || {});
  if (!cache[url]) {
    cache[url] = fetch(url, opts || {})
      .then(r => {
        return r.ok ? r.json() : null;
      })
      .catch(() => {
        return null;
      })
      .finally(() => {
        // Remove from cache once settled so the next explicit reload gets a fresh result.
        delete cache[url];
      });
  }
  return cache[url];
};

/**
 * Set up a photo drag-and-drop zone with validation, preview, and removal support.
 *
 * @param {string}        dropId    - ID of the drop-zone element.
 * @param {string|null}   previewId - ID of the preview container element (optional).
 * @param {Function}      onImage   - Called with (dataUrl, file) when a valid file is selected.
 * @param {Function|null} onRemove  - Optional. Called with (dataUrl) when a preview item's ✕
 *                                    button is clicked for a successfully loaded image, allowing
 *                                    callers to clear the underlying input/storage.
 */
function efSetupPhotoDropZone(dropId, previewId, onImage, onRemove) {
  // Maximum allowed file size (5 MB — a conservative client-side gate before the server
  // limit; server-side limit for supplier uploads is MAX_FILE_SIZE_SUPPLIER in
  // utils/uploadValidation.js, defaulting to 10 MB).
  const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
  // Strictly allowed image MIME types. Extend here to support new formats.
  // client-side mirror of the server-side allowed-types list in routes/packages.js
  const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

  const drop = document.getElementById(dropId);
  if (!drop) {
    return;
  }
  const preview = previewId ? document.getElementById(previewId) : null;

  function stop(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  /** Format a byte count as a human-readable string (e.g. "4.2MB" or "512KB"). */
  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    }
    return `${Math.round(bytes / 1024)}KB`;
  }

  /** Show a brief inline error message below the drop zone. */
  function showDropError(message) {
    const parent = drop.parentNode;
    if (!parent) {
      return;
    }
    const existing = parent.querySelector('.photo-drop-error');
    if (existing) {
      existing.remove();
    }
    const err = document.createElement('p');
    err.className = 'photo-drop-error';
    err.textContent = `\u26a0\ufe0f ${message}`;
    parent.insertBefore(err, drop.nextSibling);
    setTimeout(() => {
      if (err.parentNode) {
        err.remove();
      }
    }, 8000);
  }

  /** Show an error via Toast if available, otherwise fall back to inline message. */
  function showError(message) {
    if (
      window.EventFlowNotifications &&
      typeof window.EventFlowNotifications.error === 'function'
    ) {
      window.EventFlowNotifications.error(message);
    } else {
      showDropError(message);
    }
  }

  /**
   * Add a thumbnail to the preview container.
   * @param {string|null} dataUrl  - Base-64 data URL, or null for failed items.
   * @param {string|null} errorMsg - Reason the file was rejected, or null on success.
   */
  function addPreviewItem(dataUrl, errorMsg) {
    if (!preview) {
      return;
    }
    const wrapper = document.createElement('div');
    wrapper.className = `photo-preview-item${errorMsg ? ' photo-preview-failed' : ''}`;

    if (dataUrl) {
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = '';
      wrapper.appendChild(img);
    }

    if (errorMsg) {
      const badge = document.createElement('span');
      badge.className = 'photo-preview-error-badge';
      badge.textContent = errorMsg;
      wrapper.appendChild(badge);
    }

    // Remove (✕) button present on every preview item
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'photo-preview-remove';
    removeBtn.setAttribute('aria-label', 'Remove image');
    removeBtn.textContent = '\u2715';
    removeBtn.addEventListener('click', () => {
      wrapper.remove();
      // For successful (non-failed) items, also notify the caller so it can
      // clear the underlying input value or remove the URL from storage.
      if (!errorMsg && dataUrl && typeof onRemove === 'function') {
        onRemove(dataUrl);
      }
    });
    wrapper.appendChild(removeBtn);

    preview.appendChild(wrapper);
  }

  function handleFiles(files) {
    if (!files || !files.length) {
      return;
    }
    Array.prototype.slice.call(files).forEach(file => {
      // Validate MIME type
      if (!file.type || !ALLOWED_TYPES.has(file.type)) {
        showError(
          `\u201c${file.name}\u201d is not a supported image type. Please use JPEG, PNG, WebP or GIF.`
        );
        addPreviewItem(null, 'Invalid file type');
        return;
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE_BYTES) {
        showError(
          `\u201c${file.name}\u201d is too large (${formatBytes(file.size)}). Maximum allowed size is ${formatBytes(MAX_FILE_SIZE_BYTES)}.`
        );
        addPreviewItem(
          null,
          `File too large (${formatBytes(file.size)}) \u2014 max ${formatBytes(MAX_FILE_SIZE_BYTES)}`
        );
        return;
      }

      // File passed validation — read and display preview
      const reader = new FileReader();
      reader.addEventListener('load', ev => {
        const dataUrl = ev.target && ev.target.result;
        if (!dataUrl) {
          return;
        }
        if (typeof onImage === 'function') {
          onImage(dataUrl, file);
        }
        addPreviewItem(dataUrl, null);
      });
      reader.readAsDataURL(file);
    });
  }

  ['dragenter', 'dragover'].forEach(evt => {
    drop.addEventListener(evt, e => {
      stop(e);
      drop.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(evt => {
    drop.addEventListener(evt, e => {
      stop(e);
      drop.classList.remove('dragover');
    });
  });

  drop.addEventListener('drop', e => {
    stop(e);
    const dt = e.dataTransfer;
    if (dt && dt.files) {
      handleFiles(dt.files);
    }
  });

  drop.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    // Derive accept from ALLOWED_TYPES so there's a single source of truth
    input.accept = Array.from(ALLOWED_TYPES).join(',');
    input.multiple = true;
    input.addEventListener('change', () => {
      handleFiles(input.files);
    });
    input.click();
  });
}

// HTML escaping utility
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') {
    return '';
  }
  const div = document.createElement('div');
  div.textContent = unsafe;
  return div.innerHTML;
}

// Supplier avatar initials/color: shared with every other supplier avatar
// placeholder on the site — see public/assets/js/utils/supplier-avatar.js.
function generateSupplierGradient(supplierOrName) {
  return window.EFSupplierAvatar.getSupplierAvatarGradient(supplierOrName);
}

// Validate redirect parameter for role-based access (SECURITY)
// Only allows same-origin, allowlisted paths appropriate for the user's role
function validateRedirectForRole(redirectUrl, userRole) {
  if (!redirectUrl || typeof redirectUrl !== 'string') {
    return false;
  }

  // Remove any whitespace
  const url = redirectUrl.trim();

  // Must start with / (relative path only, no external redirects)
  if (!url.startsWith('/')) {
    return false;
  }

  // Parse URL to get pathname (strip query string and hash)
  let pathname;
  try {
    const urlObj = new URL(url, window.location.origin);
    // Verify it's same-origin - use location.host for more robust check
    // This ensures protocol + hostname + port all match
    if (urlObj.host !== window.location.host || urlObj.protocol !== window.location.protocol) {
      return false;
    }
    pathname = urlObj.pathname;
  } catch {
    // If URL parsing fails, treat as pathname directly
    pathname = url.split('?')[0].split('#')[0];
  }

  // Define allowlisted pages per role
  const allowedPaths = {
    admin: [
      '/admin',
      '/admin.html',
      '/admin-audit',
      '/admin-audit.html',
      '/admin-content',
      '/admin-content.html',
      '/admin-homepage',
      '/admin-homepage.html',
      '/admin-marketplace',
      '/admin-marketplace.html',
      '/admin-packages',
      '/admin-packages.html',
      '/admin-payments',
      '/admin-payments.html',
      '/admin-media',
      '/admin-media.html',
      '/admin-messenger-view',
      '/admin-messenger-view.html',
      '/admin-pexels',
      '/admin-pexels.html',
      '/admin-photos',
      '/admin-photos.html',
      '/admin-reports',
      '/admin-reports.html',
      '/admin-settings',
      '/admin-settings.html',
      '/admin-supplier-detail',
      '/admin-supplier-detail.html',
      '/admin-suppliers',
      '/admin-suppliers.html',
      '/admin-tickets',
      '/admin-tickets.html',
      '/admin-user-detail',
      '/admin-user-detail.html',
      '/admin-users',
      '/admin-users.html',
      '/admin-search',
      '/admin-search.html',
    ],
    supplier: [
      '/dashboard/supplier',
      '/dashboard-supplier.html',
      '/dashboard',
      '/dashboard.html',
      '/settings',
      '/settings.html',
      '/plan',
      '/plan.html',
      '/pricing',
      '/pricing.html',
      '/checkout',
      '/checkout.html',
      '/supplier/subscription',
      '/supplier/subscription.html',
      '/my-marketplace-listings',
      '/my-marketplace-listings.html',
      '/supplier/marketplace-new-listing',
      '/supplier/marketplace-new-listing.html',
      '/marketplace',
      '/marketplace.html',
      '/suppliers',
      '/suppliers.html',
      '/supplier',
      '/supplier.html',
      '/messenger/',
      '/messages',
      '/messages.html',
      '/conversation',
      '/conversation.html',
      '/notifications',
      '/notifications.html',
      '/timeline',
      '/timeline.html',
      '/budget',
      '/budget.html',
    ],
    customer: [
      '/dashboard/customer',
      '/dashboard-customer.html',
      '/dashboard',
      '/dashboard.html',
      '/settings',
      '/settings.html',
      '/plan',
      '/plan.html',
      '/pricing',
      '/pricing.html',
      '/checkout',
      '/checkout.html',
      '/my-marketplace-listings',
      '/my-marketplace-listings.html',
      '/marketplace',
      '/marketplace.html',
      '/suppliers',
      '/suppliers.html',
      '/supplier',
      '/supplier.html',
      '/messenger/',
      '/messages',
      '/messages.html',
      '/conversation',
      '/conversation.html',
      '/notifications',
      '/notifications.html',
      '/timeline',
      '/timeline.html',
      '/budget',
      '/budget.html',
      '/start',
      '/start.html',
    ],
  };

  const allowed = allowedPaths[userRole] || [];
  return allowed.includes(pathname);
}

// Global network error handler & fetch wrapper (v5.3)
(function () {
  let efErrorBanner = null;

  function showNetworkError(message) {
    try {
      if (!efErrorBanner) {
        efErrorBanner = document.createElement('div');
        efErrorBanner.id = 'ef-network-error';
        efErrorBanner.style.position = 'fixed';
        efErrorBanner.style.bottom = '1rem';
        efErrorBanner.style.left = '50%';
        efErrorBanner.style.transform = 'translateX(-50%)';
        efErrorBanner.style.padding = '0.75rem 1.25rem';
        efErrorBanner.style.background = '#b00020';
        efErrorBanner.style.color = '#fff';
        efErrorBanner.style.borderRadius = '999px';
        efErrorBanner.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)';
        efErrorBanner.style.fontSize = '0.875rem';
        efErrorBanner.style.zIndex = '9999';
        efErrorBanner.style.transition = 'opacity 0.25s ease-out';
        efErrorBanner.style.opacity = '0';
        document.body.appendChild(efErrorBanner);
      }
      efErrorBanner.textContent =
        message || 'Could not reach EventFlow. Please check your connection and try again.';
      efErrorBanner.style.opacity = '1';
      clearTimeout(efErrorBanner._hideTimer);
      efErrorBanner._hideTimer = setTimeout(() => {
        efErrorBanner.style.opacity = '0';
      }, 5000);
    } catch {
      /* Ignore banner display errors */
    }
  }

  if (typeof window !== 'undefined' && window.fetch) {
    const realFetch = window.fetch.bind(window);
    window.fetch = function () {
      return realFetch.apply(this, arguments).catch(err => {
        showNetworkError();
        throw err;
      });
    };
  }
})();

const LS_PLAN_LOCAL = 'eventflow_local_plan';
function lsGet() {
  try {
    return JSON.parse(localStorage.getItem(LS_PLAN_LOCAL) || '[]');
  } catch {
    return [];
  }
}
function lsSet(a) {
  localStorage.setItem(LS_PLAN_LOCAL, JSON.stringify(a || []));
}
function addLocal(id) {
  const p = lsGet();
  if (!p.includes(id)) {
    p.push(id);
    lsSet(p);
  }
}

async function me() {
  // Use centralized auth state manager if available
  if (window.AuthStateManager) {
    const authState = await window.AuthStateManager.init();
    return authState.user;
  }

  // Fallback to direct API call (should not happen if auth-state.js is loaded)
  try {
    const r = await fetch('/api/v1/auth/me', {
      credentials: 'include',
    });
    // Treat 401/403 as expected guest state, not an error
    if (!r.ok) {
      return null;
    }
    const data = await r.json();
    return data.user || null;
  } catch {
    return null;
  }
}
async function listSuppliers(params = {}) {
  const q = new URLSearchParams(params).toString();
  const r = await fetch(`/api/v1/suppliers${q ? `?${q}` : ''}`, {
    credentials: 'include',
  });
  const d = await r.json();
  return d.items || [];
}

function supplierCard(s, user) {
  const showAddAccount = !!user && user.role === 'customer';
  const alreadyLocal = lsGet().includes(s.id);
  const addBtn = showAddAccount
    ? `<button class="cta" data-add="${escapeHtml(s.id)}">Add to my plan</button>`
    : `<button class="cta" data-add-local="${escapeHtml(s.id)}" ${alreadyLocal ? 'disabled' : ''}>${alreadyLocal ? 'Added' : 'Add to my plan'}</button>`;

  const tags = [];
  if (s.maxGuests && s.maxGuests > 0) {
    tags.push(`<span class="badge">Up to ${escapeHtml(String(s.maxGuests))} guests</span>`);
  }
  if (Array.isArray(s.amenities)) {
    s.amenities.slice(0, 3).forEach(a => {
      tags.push(
        `<span class="badge clickable-tag" data-amenity="${escapeHtml(a)}" style="cursor:pointer;" title="Click to filter by ${escapeHtml(a)}">${escapeHtml(a)}</span>`
      );
    });
  }

  // Build supplier badges array for consistent display
  const supplierBadges = [];

  // Test data badge (show first for visibility)
  if (s.isTest) {
    supplierBadges.push('<span class="badge badge-test-data">Test data</span>');
  }

  // Founding supplier badge
  if (s.isFounding || (s.badges && s.badges.includes('founding'))) {
    const yearLabel = s.foundingYear ? ` (${escapeHtml(String(s.foundingYear))})` : '';
    supplierBadges.push(
      `<span class="badge badge-founding" title="Founding Supplier - Original member since 2024">⭐ Founding Supplier${yearLabel}</span>`
    );
  }

  // Pro/Pro Plus tier, resolved before the Featured check below since a
  // legacy stored `subscriptionTier: 'featured'` value (still read by
  // normalizeSubscriptionTier() above and by package-list.js /
  // lead-quality-helper.js) is itself one of the signals that counts as
  // Featured.
  const tier =
    s.subscriptionTier ||
    (s.subscription && s.subscription.tier) ||
    (s.isPro || s.pro ? 'pro' : null);

  // Featured badge -- a curation flag, not a subscription tier, so it's
  // checked independently of the tier ladder (a supplier is never "on the
  // featured tier"; tier and Featured can both be true at once). Two live
  // sources: the modern package-level flag (featuredSupplier, joined by the
  // API from the packages collection) and the legacy stored tier value.
  if (s.featured || s.featuredSupplier || tier === 'featured') {
    supplierBadges.push('<span class="badge badge-featured">Featured</span>');
  }

  if (tier === 'pro_plus') {
    supplierBadges.push('<span class="badge badge-pro-plus">Pro Plus</span>');
  } else if (tier === 'pro') {
    supplierBadges.push('<span class="badge badge-pro">Pro</span>');
  } else if (tier !== 'featured') {
    supplierBadges.push('<span class="badge badge-starter">Starter</span>');
  }

  // Verification badges
  if (s.verifications) {
    if (s.verifications.email && s.verifications.email.verified) {
      supplierBadges.push('<span class="badge badge-email-verified">Email Verified</span>');
    }
    if (s.verifications.phone && s.verifications.phone.verified) {
      supplierBadges.push('<span class="badge badge-phone-verified">Phone Verified</span>');
    }
    if (s.verifications.business && s.verifications.business.verified) {
      supplierBadges.push('<span class="badge badge-business-verified">Business Verified</span>');
    }
  } else if (s.approved) {
    // Fallback when no per-field verifications object is present. `approved`
    // only means the listing passed moderation — EventFlow does not verify
    // supplier identity, insurance or capability (see /terms), so this must
    // never say "Verified".
    supplierBadges.push(
      '<span class="badge badge-approved" aria-label="Approved listing" title="Approved by EventFlow — this does not verify identity, insurance or licensing.">Approved listing</span>'
    );
  }

  // Supplier avatar with fallback
  const supplierInitial = window.EFSupplierAvatar.getSupplierInitials(s.name);
  const avatarHtml = s.logo
    ? `<img src="${escapeHtml(s.logo)}" alt="${escapeHtml(s.name)} logo" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover; margin-right: 16px;" data-fallback-hide data-fallback-show-next>
       <div style="display: none; width: 60px; height: 60px; border-radius: 50%; background: ${generateSupplierGradient(s)}; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 1.5rem; margin-right: 16px; flex-shrink: 0;">${supplierInitial}</div>`
    : `<div style="width: 60px; height: 60px; border-radius: 50%; background: ${generateSupplierGradient(s)}; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 1.5rem; margin-right: 16px; flex-shrink: 0;">${supplierInitial}</div>`;

  const supplierHref = window.EventFlowSupplierLink
    ? escapeHtml(window.EventFlowSupplierLink.supplierProfileHref(s))
    : escapeHtml(s.publicProfilePath || '/suppliers');

  return `<div class="card supplier-card glass-card" style="display: flex; gap: 16px; align-items: start;">
    ${avatarHtml}
    <div style="flex: 1; min-width: 0;">
      <h3 style="margin: 0 0 8px 0;">
        <a href="${supplierHref}" style="text-decoration: none; color: inherit;">${escapeHtml(s.name)}</a>
      </h3>
      <div class="small" style="margin-bottom: 8px;">${escapeHtml(s.location || '')} · <span class="badge">${escapeHtml(s.category)}</span> ${s.price_display ? `· ${escapeHtml(s.price_display)}` : ''}</div>
      <p class="small" style="margin-bottom: 8px;">${escapeHtml(s.description_short || '')}</p>
      <div class="supplier-badges" style="margin: 8px 0;">${supplierBadges.join('')}</div>
      <div class="small" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">${tags.join(' ')}</div>
      <div class="form-actions">${addBtn}<a class="cta secondary" href="${supplierHref}">View details</a></div>
    </div>
  </div>`;
}

function normalizeSubscriptionTier(...tierCandidates) {
  for (const candidate of tierCandidates) {
    if (!candidate) {
      continue;
    }
    const normalized = String(candidate).toLowerCase().trim();
    if (normalized === 'pro' || normalized === 'pro_plus' || normalized === 'featured') {
      return normalized;
    }
    if (normalized === 'pro+' || normalized === 'pro plus') {
      return 'pro_plus';
    }
    if (normalized === 'free' || normalized === 'starter') {
      return 'free';
    }
  }
  return null;
}

// initHome() removed - now handled by home-init.js to avoid conflicts

async function initResults() {
  const user = await me();
  const container = document.getElementById('results');
  const count = document.getElementById('resultCount');
  const contextEl = document.getElementById('results-context');
  const filterCategoryEl = document.getElementById('filterCategory');
  const filterPriceEl = document.getElementById('filterPrice');
  const filterQueryEl = document.getElementById('filterQuery');
  const filters = { category: '', price: '', q: '' };

  const params = new URLSearchParams(location.search || '');
  const qp = params.get('q') || '';
  if (qp) {
    filters.q = qp;
    if (filterQueryEl) {
      filterQueryEl.value = qp;
    }
  }

  // Optional context from the last Start step
  if (contextEl) {
    try {
      const raw = localStorage.getItem('eventflow_start');
      if (raw) {
        const data = JSON.parse(raw);
        const bits = [];
        if (data.type) {
          bits.push(data.type);
        }
        if (data.location) {
          bits.push(data.location);
        }
        if (typeof data.guests === 'number' && data.guests > 0) {
          bits.push(`${data.guests} guests`);
        }
        if (data.budget) {
          bits.push(data.budget);
        }
        contextEl.textContent = bits.length ? `Based on your last event: ${bits.join(' • ')}` : '';
      }
    } catch {
      // ignore
    }
  }

  async function render() {
    const items = await listSuppliers(filters);
    if (count) {
      count.textContent = `${items.length} supplier${items.length === 1 ? '' : 's'} found`;
    }
    if (!items.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          </div>
          <h3 class="empty-state-title">No suppliers found</h3>
          <p class="empty-state-message">
            No suppliers match your search yet. Try clearing filters, searching by town or city, or starting again from the Start page.
          </p>
          <a href="/start" class="btn btn-primary">Start Over</a>
        </div>
      `;
      return;
    }
    container.innerHTML = items.map(s => supplierCard(s, user)).join('');
    container.querySelectorAll('[data-add]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-add');
        const r = await fetch('/api/v1/plan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
          },
          credentials: 'include',
          body: JSON.stringify({ supplierId: id }),
        });
        if (!r.ok) {
          alert('Sign in as a customer to save to your account.');
          return;
        }
        btn.textContent = 'Added';
        btn.disabled = true;
      });
    });
    container.querySelectorAll('[data-add-local]').forEach(btn => {
      btn.addEventListener('click', () => {
        addLocal(btn.getAttribute('data-add-local'));
        btn.textContent = 'Added';
        btn.disabled = true;
      });
    });
    // Make amenity tags clickable for filtering
    container.querySelectorAll('.clickable-tag[data-amenity]').forEach(tag => {
      tag.addEventListener('click', () => {
        const amenity = tag.getAttribute('data-amenity');
        if (amenity && filterQueryEl) {
          filterQueryEl.value = amenity;
          filters.q = amenity;
          render();
          // Scroll to top to see results
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }

  if (filterCategoryEl) {
    filterCategoryEl.addEventListener('change', e => {
      filters.category = e.target.value || '';
      render();
    });
  }
  if (filterPriceEl) {
    filterPriceEl.addEventListener('change', e => {
      filters.price = e.target.value || '';
      render();
    });
  }
  if (filterQueryEl) {
    filterQueryEl.addEventListener('input', e => {
      filters.q = e.target.value || '';
      render();
    });
  }

  // Quick category shortcuts
  document.querySelectorAll('[data-quick-category]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.getAttribute('data-quick-category') || '';
      filters.category = cat;
      if (filterCategoryEl) {
        filterCategoryEl.value = cat;
      }
      render();
    });
  });

  render();
}

async function initSupplier() {
  const user = await me();
  const params = new URLSearchParams(location.search);
  const id = params.get('id');

  // Validate supplier ID
  if (!id) {
    const c = document.getElementById('supplier-container');
    if (c) {
      c.innerHTML =
        '<div class="card"><p>No supplier ID provided. Please return to the <a href="/suppliers">suppliers page</a>.</p></div>';
    }
    return;
  }

  const r = await fetch(`/api/v1/suppliers/${encodeURIComponent(id)}`, {
    credentials: 'include',
  });
  if (!r.ok) {
    const c = document.getElementById('supplier-container');
    if (c) {
      c.innerHTML =
        '<div class="card"><p>Supplier not found. Please return to the <a href="/suppliers">suppliers page</a>.</p></div>';
    }
    return;
  }
  const s = await r.json();

  // Fetch packages with error handling
  let pkgs = { items: [] };
  try {
    const pkgsRes = await fetch(`/api/v1/suppliers/${encodeURIComponent(id)}/packages`, {
      credentials: 'include',
    });
    if (pkgsRes.ok) {
      pkgs = await pkgsRes.json();
    } else {
      console.warn('Failed to load supplier packages:', pkgsRes.status);
    }
  } catch (error) {
    console.error('Error fetching supplier packages:', error);
  }
  // Create lightbox gallery HTML for photos (photosGallery is canonical — array of {url, approved, uploadedAt})
  const galleryPhotos = s.photosGallery ? s.photosGallery.map(p => p.url) : [];
  const gallery =
    galleryPhotos.length > 1
      ? galleryPhotos
          .slice(1)
          .map(
            (u, index) => `
      <div class="gallery-item" data-index="${index + 1}" style="cursor: pointer; position: relative; overflow: hidden; border-radius: 8px; transition: transform 0.3s ease;">
        <img loading="lazy" src="${escapeHtml(u)}" alt="${escapeHtml(s.name)} - Photo ${index + 2}" style="width: 100%; height: 200px; object-fit: cover; transition: transform 0.3s ease;">
        <div class="gallery-overlay" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.4); opacity: 0; transition: opacity 0.3s ease; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px;">🔍</div>
      </div>
    `
          )
          .join('')
      : '';

  const facts = `<div class="small">${s.website ? `<a href="${escapeHtml(s.website)}" target="_blank" rel="noopener">${escapeHtml(s.website)}</a> · ` : ''}${escapeHtml(s.phone || '')} ${escapeHtml(s.license || '')} ${s.maxGuests ? `· Max ${escapeHtml(String(s.maxGuests))} guests` : ''}</div>`;
  const amenities = (s.amenities || [])
    .map(a => `<span class="badge">${escapeHtml(a)}</span>`)
    .join(' ');

  // Render highlights if available
  const highlightsHtml =
    s.highlights && s.highlights.length > 0
      ? `<div class="spc-highlights">
          <h3 class="spc-highlights__title">✨ Key Highlights</h3>
          <div class="spc-highlights__list">
            ${s.highlights
              .map(
                h =>
                  `<div class="spc-highlight-item"><span class="spc-highlight-check" aria-hidden="true">✓</span><span>${escapeHtml(h)}</span></div>`
              )
              .join('')}
          </div>
        </div>`
      : '';

  // Render featured services if available
  const featuredServicesHtml =
    s.featuredServices && s.featuredServices.length > 0
      ? `<div class="spc-featured-services">
          <h4 class="spc-featured-services__title">Featured Services</h4>
          <div class="spc-featured-services__list">
            ${s.featuredServices
              .map(service => `<span class="spc-service-tag">${escapeHtml(service)}</span>`)
              .join('')}
          </div>
        </div>`
      : '';

  // Render social links if available
  const socialLinksHtml =
    s.socialLinks && Object.keys(s.socialLinks).length > 0
      ? `<div class="spc-social-links">
          ${s.socialLinks.facebook ? `<a href="${escapeHtml(s.socialLinks.facebook)}" target="_blank" rel="noopener noreferrer" class="spc-social-link spc-social-link--facebook" aria-label="Facebook">📘 Facebook</a>` : ''}
          ${s.socialLinks.instagram ? `<a href="${escapeHtml(s.socialLinks.instagram)}" target="_blank" rel="noopener noreferrer" class="spc-social-link spc-social-link--instagram" aria-label="Instagram">📷 Instagram</a>` : ''}
          ${s.socialLinks.twitter ? `<a href="${escapeHtml(s.socialLinks.twitter)}" target="_blank" rel="noopener noreferrer" class="spc-social-link spc-social-link--twitter" aria-label="Twitter/X">𝕏 Twitter</a>` : ''}
          ${s.socialLinks.linkedin ? `<a href="${escapeHtml(s.socialLinks.linkedin)}" target="_blank" rel="noopener noreferrer" class="spc-social-link spc-social-link--linkedin" aria-label="LinkedIn">💼 LinkedIn</a>` : ''}
          ${s.socialLinks.youtube ? `<a href="${escapeHtml(s.socialLinks.youtube)}" target="_blank" rel="noopener noreferrer" class="spc-social-link spc-social-link--youtube" aria-label="YouTube">▶️ YouTube</a>` : ''}
          ${s.socialLinks.tiktok ? `<a href="${escapeHtml(s.socialLinks.tiktok)}" target="_blank" rel="noopener noreferrer" class="spc-social-link spc-social-link--tiktok" aria-label="TikTok">🎵 TikTok</a>` : ''}
        </div>`
      : '';

  const packagesHtml =
    (pkgs.items || [])
      .map(
        p => `
    <div class="card pack" data-package-slug="${escapeHtml(p.slug || '')}" style="cursor: pointer;">
      <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.title)} image">
      <div>
        <h3>${escapeHtml(p.title)}</h3>
        <div class="small"><span class="badge">${escapeHtml(p.price_display || '')}</span></div>
        <p class="small">${escapeHtml(p.description || '')}</p>
      </div>
    </div>`
      )
      .join('') || `<div class="card"><p class="small">No approved packages yet.</p></div>`;

  // Calculate years active more precisely
  const yearsActive = s.createdAt
    ? Math.max(
        1,
        Math.floor((Date.now() - new Date(s.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
      )
    : null;

  // Build stats section — only render if at least one stat is available
  const statsItems = [
    s.completedEvents
      ? `<div class="stat-item"><div class="stat-value">${s.completedEvents}</div><div class="stat-label">Events</div></div>`
      : '',
    yearsActive
      ? `<div class="stat-item"><div class="stat-value">${yearsActive}</div><div class="stat-label">Years Active</div></div>`
      : '',
    s.avgResponseTime
      ? `<div class="stat-item"><div class="stat-value">${Math.round(s.avgResponseTime)}h</div><div class="stat-label">Response Time</div></div>`
      : '',
    s.reviewCount
      ? `<div class="stat-item"><div class="stat-value">${s.reviewCount}</div><div class="stat-label">Reviews</div></div>`
      : '',
  ].filter(Boolean);
  const statsHtml =
    statsItems.length > 0 ? `<div class="supplier-stats">${statsItems.join('')}</div>` : '';

  // Trust indicators
  const trustItems = [
    s.verifications?.email
      ? '<div class="trust-item"><span class="trust-check" aria-hidden="true">✓</span><span>Email verified</span></div>'
      : '',
    s.verifications?.phone
      ? '<div class="trust-item"><span class="trust-check" aria-hidden="true">✓</span><span>Phone verified</span></div>'
      : '',
    s.verifications?.business
      ? '<div class="trust-item"><span class="trust-check" aria-hidden="true">✓</span><span>Business verified</span></div>'
      : '',
    s.insurance
      ? '<div class="trust-item"><span class="trust-check" aria-hidden="true">✓</span><span>Insured</span></div>'
      : '',
    s.license
      ? '<div class="trust-item"><span class="trust-check" aria-hidden="true">✓</span><span>Licensed</span></div>'
      : '',
  ].filter(Boolean);
  const trustHtml =
    trustItems.length > 0
      ? `<div class="supplier-trust-card"><h3 class="trust-card__title">Trust &amp; Safety</h3><div class="trust-item-list">${trustItems.join('')}</div></div>`
      : '';

  // supplier-container is only present in the legacy HTML layout.
  // The current supplier.html uses supplier-profile.js as the authoritative renderer.
  const supplierContainer = document.getElementById('supplier-container');
  if (!supplierContainer) {
    return;
  }
  supplierContainer.innerHTML = `
    ${statsHtml}
    
    ${highlightsHtml}

    <div class="card spc-about" style="animation: fadeInUp 0.4s ease-out 0.05s backwards;">
      <h2 class="spc-section-title">About</h2>
      ${facts}
      <div class="small spc-amenities" style="margin-top:10px">${amenities}</div>
      <p class="spc-description">${escapeHtml(s.description_long || s.description_short || '')}</p>
      ${featuredServicesHtml}
      ${socialLinksHtml}
      ${trustHtml}
      <div class="spc-actions">
        <button class="cta spc-cta-plan" id="add">Add to My Plan</button>
        <button class="cta secondary spc-cta-save" id="save-supplier-btn" data-supplier-id="${escapeHtml(s.id)}" aria-label="Save supplier to favorites">♡ Save</button>
        <button class="cta secondary spc-cta-msg" id="start-thread">Start Conversation</button>
      </div>
    </div>

    <section class="spc-section" style="animation: fadeInUp 0.4s ease-out 0.1s backwards;">
      <h2 class="spc-section-title">Gallery</h2>
      <div class="cards">${gallery || '<div class="card"><p class="small">No photos yet.</p></div>'}</div>
    </section>

    <section class="spc-section" style="animation: fadeInUp 0.4s ease-out 0.15s backwards;">
      <h2 class="spc-section-title">Packages &amp; Services</h2>
      <div class="cards">${packagesHtml}</div>
    </section>
    
    <div class="reviews-widget" id="reviews-widget" role="region" aria-label="Customer reviews and ratings" style="animation: fadeInUp 0.5s ease-out 0.4s backwards;">
      <section class="reviews-section">
        <div class="review-summary">
          <div class="review-summary-score">
            <div class="review-average-rating" aria-label="Average rating">New</div>
            <div class="review-stars-large" aria-hidden="true" style="opacity: 0.3;">☆☆☆☆☆</div>
            <div class="review-count">No reviews yet</div>
          </div>
          
          <div class="review-summary-details">
            <h2 class="review-summary-title">Customer Reviews & Ratings</h2>
            <div class="rating-distribution" aria-label="Rating distribution"></div>
            <div class="review-trust-section">
              <div class="trust-score-badge">
                <div>
                  <div class="trust-score-value">New</div>
                  <div class="trust-score-label">Building Trust</div>
                </div>
              </div>
              <div class="review-badges" id="supplier-badges" aria-label="Supplier badges"></div>
            </div>
          </div>
        </div>
        
        <div class="reviews-header">
          <h3 class="reviews-title">All Reviews</h3>
          <div class="review-actions">
            <button id="btn-write-review" class="ef-cta btn-write-review" aria-label="Write a review for this supplier">✍️ Write a Review</button>
          </div>
        </div>
        
        <div class="review-controls" role="search" aria-label="Filter and sort reviews">
          <div class="review-filter-group">
            <label class="review-filter-label" for="filter-min-rating">Minimum Rating:</label>
            <select id="filter-min-rating" class="review-filter-select" aria-label="Filter by minimum rating">
              <option value="">All Ratings</option>
              <option value="5">5 Stars</option>
              <option value="4">4+ Stars</option>
              <option value="3">3+ Stars</option>
            </select>
          </div>
          
          <div class="review-filter-group">
            <label class="review-filter-label" for="filter-sort-by">Sort By:</label>
            <select id="filter-sort-by" class="review-filter-select" aria-label="Sort reviews">
              <option value="date">Most Recent</option>
              <option value="rating">Highest Rating</option>
              <option value="helpful">Most Helpful</option>
            </select>
          </div>
          
          <label class="review-verified-filter">
            <input type="checkbox" id="filter-verified" aria-label="Show only verified customers" />
            <span>✓ Verified Customers Only</span>
          </label>
        </div>
        
        <div id="reviews-list" class="reviews-list" role="list" aria-live="polite" aria-label="Customer reviews">
          <div class="reviews-loading">
            <div class="loading-spinner" role="status" aria-label="Loading reviews"></div>
            <p style="margin-top: 1rem; color: #6b7280;">Loading reviews...</p>
          </div>
        </div>
        
        <div id="review-pagination" class="review-pagination" style="display: none;" role="navigation" aria-label="Review pagination"></div>
      </section>
    </div>

    <section class="section" style="animation: fadeInUp 0.5s ease-out 0.5s backwards;">
      <div class="card">
        <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 16px;">Contact ${escapeHtml(s.name)}</h2>
        <p class="small" style="margin-bottom: 20px; color: #6b7280;">Have a question? Send a message and get a response directly.</p>
        <form id="supplier-contact-form" novalidate>
          <div style="margin-bottom: 16px;">
            <label for="contact-name" style="display: block; font-weight: 500; margin-bottom: 8px;">Name <span style="color: #ef4444;">*</span></label>
            <input type="text" id="contact-name" name="name" required minlength="2" maxlength="100" style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;" placeholder="Your name">
            <div id="contact-name-error" class="validation-error" style="display: none; color: #ef4444; font-size: 14px; margin-top: 4px;"></div>
          </div>
          
          <div style="margin-bottom: 16px;">
            <label for="contact-email" style="display: block; font-weight: 500; margin-bottom: 8px;">Email <span style="color: #ef4444;">*</span></label>
            <input type="email" id="contact-email" name="email" required maxlength="100" style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;" placeholder="your.email@example.com">
            <div id="contact-email-error" class="validation-error" style="display: none; color: #ef4444; font-size: 14px; margin-top: 4px;"></div>
          </div>
          
          <div style="margin-bottom: 16px;">
            <label for="contact-message" style="display: block; font-weight: 500; margin-bottom: 8px;">Message <span style="color: #ef4444;">*</span></label>
            <textarea id="contact-message" name="message" required minlength="10" maxlength="1000" rows="5" style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; resize: vertical;" placeholder="Tell us about your event..."></textarea>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
              <div id="contact-message-error" class="validation-error" style="display: none; color: #ef4444; font-size: 14px;"></div>
              <div id="contact-message-count" style="font-size: 12px; color: #6b7280;">0 / 1000</div>
            </div>
          </div>
          
          <div class="form-actions">
            <button type="submit" id="contact-submit-btn" class="cta" style="min-width: 150px;">Send Message</button>
          </div>
        </form>
      </div>
    </section>
  `;

  // Initialize lightbox gallery
  initSupplierGallery(galleryPhotos);

  const addBtn = document.getElementById('add');
  if (addBtn) {
    // Check if supplier is already in plan
    let isInPlan = false;

    if (user && user.role === 'customer') {
      // For authenticated users, check server-side plan
      try {
        const planResp = await fetch('/api/v1/plan', {
          credentials: 'include',
        });
        if (planResp.ok) {
          const planData = await planResp.json();
          isInPlan = (planData.items || []).some(item => item.id === s.id);
        } else {
          console.error('Failed to load plan status:', planResp.status);
          // Continue with isInPlan = false as default
        }
      } catch (e) {
        console.error('Error checking plan:', e);
        // Continue with isInPlan = false as default
      }
    } else {
      // For non-authenticated users, check localStorage
      const ls = lsGet();
      isInPlan = ls.includes(s.id);
    }

    if (isInPlan) {
      addBtn.textContent = 'Remove from plan';
      addBtn.classList.add('secondary');
      addBtn.dataset.inPlan = 'true';
    } else {
      addBtn.dataset.inPlan = 'false';
    }

    addBtn.addEventListener('click', async () => {
      if (!user || user.role !== 'customer') {
        alert('Create a customer account and sign in to add suppliers to your plan.');
        return;
      }

      // For authenticated users, use server-side API
      const currentlyInPlan = addBtn.dataset.inPlan === 'true';

      if (currentlyInPlan) {
        // Remove from plan
        try {
          const removeRes = await fetch(`/api/v1/plan/${encodeURIComponent(s.id)}`, {
            method: 'DELETE',
            headers: {
              'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
            },
            credentials: 'include',
          });
          if (removeRes.ok) {
            addBtn.textContent = 'Add to my plan';
            addBtn.classList.remove('secondary');
            addBtn.dataset.inPlan = 'false';
          } else {
            alert('Failed to remove from plan. Please try again.');
          }
        } catch (e) {
          console.error('Error removing from plan:', e);
          alert('Failed to remove from plan. Please try again.');
        }
      } else {
        // Add to plan
        try {
          const addRes = await fetch('/api/v1/plan', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
            },
            credentials: 'include',
            body: JSON.stringify({ supplierId: s.id }),
          });
          if (addRes.ok) {
            addBtn.textContent = 'Remove from plan';
            addBtn.classList.add('secondary');
            addBtn.dataset.inPlan = 'true';
          } else {
            alert('Failed to add to plan. Please try again.');
          }
        } catch (e) {
          console.error('Error adding to plan:', e);
          alert('Failed to add to plan. Please try again.');
        }
      }
    });
  }

  const startThreadBtn = document.getElementById('start-thread');
  if (startThreadBtn) {
    startThreadBtn.addEventListener('click', () => {
      if (!user) {
        alert('You need an account to contact suppliers. Please sign in or create an account.');
        return;
      }
      const modal = document.createElement('div');
      modal.className = 'modal-backdrop';
      modal.innerHTML = `
        <div class="modal">
          <h2>Send an enquiry</h2>
          <p class="small">Tell this supplier a bit about your event. They will reply via your EventFlow messages.</p>
          <textarea id="thread-message" rows="4" placeholder="Hi! We are planning an event on [DATE] for around [GUESTS] guests at [LOCATION]. Are you available, and could you share your pricing or packages?"></textarea>
          <div class="form-actions">
            <button class="cta" id="send-thread">Send message</button>
            <button class="cta secondary" id="cancel-thread">Cancel</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#cancel-thread').addEventListener('click', () => modal.remove());

      modal.querySelector('#send-thread').addEventListener('click', async () => {
        const msg = (modal.querySelector('#thread-message').value || '').trim();
        if (!msg) {
          return;
        }
        const payload = {
          type: 'direct',
          participantIds: [s.userId || s.id],
          context: {
            type: 'supplier_profile',
            referenceId: s.id,
            referenceTitle: s.name || s.businessName,
          },
        };
        const convRes = await fetch('/api/v4/messenger/conversations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
          },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        let d = {};
        try {
          d = await convRes.json();
        } catch {
          /* Ignore JSON parse errors */
        }
        if (!convRes.ok) {
          alert((d && d.error) || 'Could not start conversation');
          return;
        }

        const conversationId = d.conversation?._id || d.conversation?.id;
        if (conversationId && msg) {
          await fetch(`/api/v4/messenger/conversations/${conversationId}/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
            },
            credentials: 'include',
            body: JSON.stringify({ content: msg }),
          }).catch(() => {});
        }

        modal.remove();
        if (conversationId) {
          window.location.href = `/messenger/?conversation=${conversationId}`;
        } else {
          alert('Enquiry sent. Visit your dashboard to continue the conversation.');
        }
      });
    });
  }

  // Handle save supplier button
  const saveSupplierBtn = document.getElementById('save-supplier-btn');
  if (saveSupplierBtn) {
    // Check if supplier is already saved
    const checkSavedStatus = async () => {
      if (!user) {
        saveSupplierBtn.textContent = '♡ Save';
        return;
      }

      try {
        const res = await fetch('/api/v1/me/saved', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          const isSaved = data.savedItems.some(
            item => item.itemType === 'supplier' && item.itemId === s.id
          );
          saveSupplierBtn.textContent = isSaved ? '❤️ Saved' : '♡ Save';
          saveSupplierBtn.dataset.saved = isSaved ? 'true' : 'false';
        }
      } catch (err) {
        console.error('Error checking saved status:', err);
      }
    };

    checkSavedStatus();

    saveSupplierBtn.addEventListener('click', async () => {
      if (!user) {
        alert('Please sign in to save suppliers to your favorites.');
        return;
      }

      const isSaved = saveSupplierBtn.dataset.saved === 'true';

      try {
        if (isSaved) {
          // Find and unsave
          const res = await fetch('/api/v1/me/saved', { credentials: 'include' });
          if (res.ok) {
            const data = await res.json();
            const savedItem = data.savedItems.find(
              item => item.itemType === 'supplier' && item.itemId === s.id
            );

            if (savedItem) {
              const deleteRes = await fetch(`/api/v1/me/saved/${savedItem.id}`, {
                method: 'DELETE',
                headers: { 'X-CSRF-Token': window.__CSRF_TOKEN__ || '' },
                credentials: 'include',
              });

              if (deleteRes.ok) {
                saveSupplierBtn.textContent = '♡ Save';
                saveSupplierBtn.dataset.saved = 'false';
              }
            }
          }
        } else {
          // Save
          const saveRes = await fetch('/api/v1/me/saved', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
            },
            credentials: 'include',
            body: JSON.stringify({
              itemType: 'supplier',
              itemId: s.id,
            }),
          });

          if (saveRes.ok) {
            saveSupplierBtn.textContent = '❤️ Saved';
            saveSupplierBtn.dataset.saved = 'true';
          } else {
            const error = await saveRes.json();
            alert(error.error || 'Failed to save supplier');
          }
        }
      } catch (err) {
        console.error('Error saving supplier:', err);
        alert('Failed to save supplier. Please try again.');
      }
    });
  }

  // Add click handlers to package cards
  const packageCards = document.querySelectorAll('.card.pack[data-package-slug]');
  packageCards.forEach(card => {
    const slug = card.dataset.packageSlug;
    if (slug) {
      card.addEventListener('click', () => {
        window.location.href = `/package?slug=${encodeURIComponent(slug)}`;
      });
      // Make keyboard accessible
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.location.href = `/package?slug=${encodeURIComponent(slug)}`;
        }
      });
    }
  });

  // Initialize reviews system with retry logic
  const initReviews = () => {
    if (window.reviewsManager && id) {
      try {
        // Constants for animations and timing
        const ANIMATION_DELAY_MS = 100;
        const SCROLL_BEHAVIOR = 'smooth';

        // Get current user if logged in
        const currentUser = user || null;
        reviewsManager.init(id, currentUser);

        // Add smooth scroll functionality to write review button
        const writeBtn = document.getElementById('btn-write-review');
        if (writeBtn) {
          writeBtn.addEventListener('click', () => {
            // Scroll to reviews section smoothly
            const reviewsWidget = document.getElementById('reviews-widget');
            if (reviewsWidget) {
              reviewsWidget.scrollIntoView({ behavior: SCROLL_BEHAVIOR, block: 'start' });
            }
          });
        }

        // Add fade-in animation to reviews widget
        const reviewsWidget = document.getElementById('reviews-widget');
        if (reviewsWidget) {
          reviewsWidget.style.opacity = '0';
          reviewsWidget.style.transform = 'translateY(20px)';
          reviewsWidget.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
          setTimeout(() => {
            reviewsWidget.style.opacity = '1';
            reviewsWidget.style.transform = 'translateY(0)';
          }, ANIMATION_DELAY_MS);
        }
      } catch (error) {
        console.error('Error initializing reviews system:', error);
        const reviewsList = document.getElementById('reviews-list');
        if (reviewsList) {
          reviewsList.innerHTML =
            '<div class="card"><p class="small" style="color: #b00020;">Unable to load reviews. Please refresh the page.</p></div>';
        }
      }
    }
  };

  // Try to initialize immediately, or wait for reviewsManager to load
  if (window.reviewsManager) {
    initReviews();
  } else {
    // Wait for reviews.js to load with retry logic
    const RETRY_INTERVAL_MS = 100;
    const MAX_RETRY_ATTEMPTS = 30;
    const RETRY_TIMEOUT_MS = MAX_RETRY_ATTEMPTS * RETRY_INTERVAL_MS; // 3 seconds

    let attempts = 0;
    const checkInterval = setInterval(() => {
      attempts++;
      if (window.reviewsManager) {
        clearInterval(checkInterval);
        initReviews();
      } else if (attempts >= MAX_RETRY_ATTEMPTS) {
        clearInterval(checkInterval);
        console.warn(`Reviews system not loaded after ${RETRY_TIMEOUT_MS / 1000} seconds`);
        const reviewsList = document.getElementById('reviews-list');
        if (reviewsList) {
          reviewsList.innerHTML =
            '<div class="card"><p class="small" style="color: #6b7280;">Reviews are temporarily unavailable.</p></div>';
        }
      }
    }, RETRY_INTERVAL_MS);
  }

  // Initialize contact form validation
  initContactFormValidation(s.id, s.name);
}

/**
 * Initialize contact form validation and submission
 * @param {string} supplierId - The supplier ID
 * @param {string} supplierName - The supplier name
 */
function initContactFormValidation(supplierId, supplierName) {
  const form = document.getElementById('supplier-contact-form');
  if (!form) {
    return;
  }

  const nameInput = document.getElementById('contact-name');
  const emailInput = document.getElementById('contact-email');
  const messageInput = document.getElementById('contact-message');
  const submitBtn = document.getElementById('contact-submit-btn');
  const messageCount = document.getElementById('contact-message-count');

  // Character counter for message
  if (messageInput && messageCount) {
    messageInput.addEventListener('input', () => {
      const length = messageInput.value.length;
      messageCount.textContent = `${length} / 1000`;

      if (length > 1000) {
        messageCount.style.color = '#ef4444';
      } else if (length > 900) {
        messageCount.style.color = '#f59e0b';
      } else {
        messageCount.style.color = '#6b7280';
      }
    });
  }

  // Real-time validation
  const validateField = (field, errorElementId, validator) => {
    const errorElement = document.getElementById(errorElementId);
    const error = validator(field.value);

    if (error) {
      errorElement.textContent = error;
      errorElement.style.display = 'block';
      field.style.borderColor = '#ef4444';
      return false;
    } else {
      errorElement.style.display = 'none';
      field.style.borderColor = '#d1d5db';
      return true;
    }
  };

  // Validators
  const validateName = value => {
    const trimmed = value.trim();
    if (!trimmed) {
      return 'Name is required';
    }
    if (trimmed.length < 2) {
      return 'Name must be at least 2 characters';
    }
    if (trimmed.length > 100) {
      return 'Name must be less than 100 characters';
    }
    return null;
  };

  const validateEmail = value => {
    const trimmed = value.trim();
    if (!trimmed) {
      return 'Email is required';
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      return 'Please enter a valid email address';
    }
    if (trimmed.length > 100) {
      return 'Email must be less than 100 characters';
    }
    return null;
  };

  const validateMessage = value => {
    const trimmed = value.trim();
    if (!trimmed) {
      return 'Message is required';
    }
    if (trimmed.length < 10) {
      return 'Message must be at least 10 characters';
    }
    if (trimmed.length > 1000) {
      return 'Message must be less than 1000 characters';
    }
    return null;
  };

  // Add blur event listeners for real-time validation
  if (nameInput) {
    nameInput.addEventListener('blur', () => {
      validateField(nameInput, 'contact-name-error', validateName);
    });
  }

  if (emailInput) {
    emailInput.addEventListener('blur', () => {
      validateField(emailInput, 'contact-email-error', validateEmail);
    });
  }

  if (messageInput) {
    messageInput.addEventListener('blur', () => {
      validateField(messageInput, 'contact-message-error', validateMessage);
    });
  }

  // Form submission
  form.addEventListener('submit', async e => {
    e.preventDefault();

    // Validate all fields
    const nameValid = validateField(nameInput, 'contact-name-error', validateName);
    const emailValid = validateField(emailInput, 'contact-email-error', validateEmail);
    const messageValid = validateField(messageInput, 'contact-message-error', validateMessage);

    if (!nameValid || !emailValid || !messageValid) {
      // Scroll to first error
      const firstError = document.querySelector('.validation-error[style*="display: block"]');
      if (firstError) {
        firstError.closest('div').querySelector('input, textarea').focus();
      }
      return;
    }

    // Disable submit button
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.5';
    submitBtn.style.cursor = 'not-allowed';
    submitBtn.textContent = 'Sending...';

    try {
      const formData = {
        name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        message: messageInput.value.trim(),
        supplierId: supplierId,
      };

      const response = await fetch('/api/v1/contact-supplier', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
        },
        credentials: 'include',
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok) {
        // Show success message
        showToast(`Message sent successfully! ${supplierName} will respond soon.`, 'success');

        // Reset form
        form.reset();
        messageCount.textContent = '0 / 1000';
        messageCount.style.color = '#6b7280';

        // Clear any error states
        document.querySelectorAll('.validation-error').forEach(el => (el.style.display = 'none'));
        [nameInput, emailInput, messageInput].forEach(input => {
          if (input) {
            input.style.borderColor = '#d1d5db';
          }
        });
      } else {
        showToast(data.error || 'Failed to send message. Please try again.', 'error');
      }
    } catch (error) {
      console.error('Error sending contact message:', error);
      showToast('Network error. Please check your connection and try again.', 'error');
    } finally {
      // Re-enable submit button
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
      submitBtn.style.cursor = 'pointer';
      submitBtn.textContent = 'Send Message';
    }
  });
}

/**
 * Show toast notification
 * @param {string} message - Toast message
 * @param {string} type - Toast type (success, error, info)
 */
function showToast(message, type = 'info') {
  const existingToast = document.querySelector('.toast-notification');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = `toast-notification toast-notification--${type || 'info'}`;
  toast.textContent = message;

  // Colour and positioning handled by CSS class

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOutDown 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

/**
 * Initialize supplier photo gallery with lightbox
 * @param {Array} photos - Array of photo URLs
 */
function initSupplierGallery(photos) {
  if (!photos || photos.length <= 1) {
    return; // Need at least 2 photos (hero + 1 gallery photo)
  }

  const galleryItems = document.querySelectorAll('.gallery-item');
  if (!galleryItems.length) {
    return;
  }

  // Add click handlers to open lightbox
  galleryItems.forEach((item, index) => {
    item.addEventListener('click', () => {
      openLightbox(photos, index + 1); // +1 because hero image is photos[0]
    });
  });
}

/**
 * Open lightbox for photo gallery
 * @param {Array} photos - Array of photo URLs
 * @param {number} startIndex - Index to start at
 */
function openLightbox(photos, startIndex = 0) {
  let currentIndex = startIndex;

  const modal = document.createElement('div');
  modal.className = 'lightbox-modal';
  modal.innerHTML = `
    <div class="lightbox-content">
      <button class="ef-cta lightbox-close" aria-label="Close lightbox">&times;</button>
      ${photos.length > 1 ? '<button class="ef-cta lightbox-nav lightbox-prev" aria-label="Previous photo">&lsaquo;</button>' : ''}
      <img class="lightbox-image" src="${escapeHtml(photos[currentIndex])}" alt="Gallery photo ${currentIndex + 1}">
      ${photos.length > 1 ? '<button class="ef-cta lightbox-nav lightbox-next" aria-label="Next photo">&rsaquo;</button>' : ''}
    </div>
  `;

  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  const img = modal.querySelector('.lightbox-image');
  const closeBtn = modal.querySelector('.lightbox-close');
  const prevBtn = modal.querySelector('.lightbox-prev');
  const nextBtn = modal.querySelector('.lightbox-next');

  // Close lightbox
  const closeLightbox = () => {
    modal.remove();
    document.body.style.overflow = '';
  };

  closeBtn.addEventListener('click', closeLightbox);
  modal.addEventListener('click', e => {
    if (e.target === modal) {
      closeLightbox();
    }
  });

  // Navigate photos
  const updateImage = () => {
    img.src = escapeHtml(photos[currentIndex]);
    img.alt = `Gallery photo ${currentIndex + 1}`;
  };

  if (prevBtn) {
    prevBtn.addEventListener('click', e => {
      e.stopPropagation();
      currentIndex = currentIndex > 0 ? currentIndex - 1 : photos.length - 1;
      updateImage();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', e => {
      e.stopPropagation();
      currentIndex = currentIndex < photos.length - 1 ? currentIndex + 1 : 0;
      updateImage();
    });
  }

  // Keyboard navigation
  const handleKeydown = e => {
    if (e.key === 'Escape') {
      closeLightbox();
    } else if (e.key === 'ArrowLeft' && prevBtn) {
      currentIndex = currentIndex > 0 ? currentIndex - 1 : photos.length - 1;
      updateImage();
    } else if (e.key === 'ArrowRight' && nextBtn) {
      currentIndex = currentIndex < photos.length - 1 ? currentIndex + 1 : 0;
      updateImage();
    }
  };

  document.addEventListener('keydown', handleKeydown);

  // Clean up on close
  modal.addEventListener('remove', () => {
    document.removeEventListener('keydown', handleKeydown);
  });
}

async function initPlan() {
  const user = await me();
  const container = document.getElementById('plan-list');
  const budgetEl = document.getElementById('plan-budget');
  const notesEl = document.getElementById('plan-notes');
  const saveBtn = document.getElementById('save-notes');
  const status = document.getElementById('notes-status');
  const cloud = document.getElementById('cloud-status');
  const eventSummary = document.getElementById('event-summary-body');

  const PLAN_KEY = 'eventflow_plan_v2';

  function loadLocalPlan() {
    try {
      const raw = localStorage.getItem(PLAN_KEY);
      if (!raw) {
        return { version: 2, guests: [], tasks: [], timeline: [], notes: '' };
      }
      const obj = JSON.parse(raw);
      return Object.assign(
        { version: 2, guests: [], tasks: [], timeline: [], notes: '' },
        obj || {}
      );
    } catch {
      return { version: 2, guests: [], tasks: [], timeline: [], notes: '' };
    }
  }
  function saveLocalPlan(plan) {
    localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
  }

  const plan = loadLocalPlan();

  // --- Event summary from start page (local only) ---
  if (eventSummary) {
    try {
      const raw = localStorage.getItem('eventflow_start');
      if (raw) {
        const data = JSON.parse(raw);
        const bits = [];
        if (data.type) {
          bits.push(data.type);
        }
        if (data.date) {
          bits.push(data.date);
        }
        if (data.location) {
          bits.push(data.location);
        }
        if (data.guests) {
          bits.push(`${data.guests} guests`);
        }
        eventSummary.textContent = bits.length
          ? bits.join(' · ')
          : 'Tell us about your event to see a quick summary here.';
      } else {
        eventSummary.textContent = 'Tell us about your event to see a quick summary here.';
      }
    } catch {
      eventSummary.textContent = 'Tell us about your event to see a quick summary here.';
    }
  }

  // --- Load suppliers currently in the plan (server-side) ---
  let items = [];

  if (container) {
    container.innerHTML = '<div class="card"><p>Loading your plan...</p></div>';
  }

  // For authenticated users, always fetch from server
  if (user && user.role === 'customer') {
    try {
      const r = await fetch('/api/v1/plan', {
        credentials: 'include',
      });
      if (r.ok) {
        const d = await r.json();
        items = d.items || [];
      } else {
        console.error('Failed to load plan:', r.status);
        if (container) {
          container.innerHTML =
            '<div class="card"><p>Error loading your plan. Please refresh the page.</p></div>';
        }
        return;
      }
    } catch (e) {
      console.error('Error loading plan:', e);
      if (container) {
        container.innerHTML =
          '<div class="card"><p>Error loading your plan. Please refresh the page.</p></div>';
      }
      return;
    }
  } else {
    // For non-authenticated users, show message to sign in
    if (container) {
      container.innerHTML =
        '<div class="card"><p>Sign in to a customer account to save and manage your plan.</p></div>';
    }
    return;
  }

  if (container) {
    if (!items.length) {
      container.innerHTML =
        '<div class="card"><p>Your plan is currently empty. Add suppliers from the Suppliers page to build it.</p></div>';
    } else {
      container.innerHTML = items.map(s => supplierCard(s, user)).join('');
    }
  }

  // --- AI event planning assistant (optional, uses OpenAI if configured) ---
  try {
    const aiInput = document.getElementById('ai-plan-input');
    const aiRun = document.getElementById('ai-plan-run');
    const aiOut = document.getElementById('ai-plan-output');
    const aiUseCurrent = document.getElementById('ai-plan-use-current');

    if (aiRun && aiOut) {
      aiRun.addEventListener('click', async () => {
        const promptText = ((aiInput && aiInput.value) || '').trim();
        if (!promptText && !(aiUseCurrent && aiUseCurrent.checked)) {
          if (aiInput) {
            aiInput.focus();
          }
          return;
        }

        const summaryBits = [];
        if (plan && typeof plan === 'object') {
          if (Array.isArray(plan.guests) && plan.guests.length) {
            summaryBits.push(`${plan.guests.length} guests in the guest list`);
          }
          if (Array.isArray(plan.tasks) && plan.tasks.length) {
            summaryBits.push(`${plan.tasks.length} planning tasks`);
          }
          if (Array.isArray(plan.timeline) && plan.timeline.length) {
            summaryBits.push(`${plan.timeline.length} timeline items`);
          }
          if (Array.isArray(plan.budgetItems) && plan.budgetItems.length) {
            summaryBits.push(`${plan.budgetItems.length} budget lines`);
          }
        }

        let finalPrompt = promptText;
        if (aiUseCurrent && aiUseCurrent.checked) {
          finalPrompt += `\n\nHere is my current plan data summary: ${
            summaryBits.join(' • ') || 'No extra details yet.'
          }`;
        }

        aiOut.innerHTML = '<p class="small">Thinking about your event…</p>';

        try {
          const r = await fetch('/api/v1/ai/plan', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
            },
            credentials: 'include',
            body: JSON.stringify({ prompt: finalPrompt, plan }),
          });
          if (!r.ok) {
            aiOut.innerHTML =
              '<p class="small">Sorry, something went wrong while generating suggestions.</p>';
            return;
          }
          const payload = await r.json();
          const data = (payload && payload.data) || {};
          const checklist = Array.isArray(data.checklist) ? data.checklist : [];
          const timeline = Array.isArray(data.timeline) ? data.timeline : [];
          const suppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
          const budget = Array.isArray(data.budget) ? data.budget : [];
          const styleIdeas = Array.isArray(data.styleIdeas) ? data.styleIdeas : [];
          const messages = Array.isArray(data.messages) ? data.messages : [];

          let html = '';
          if (checklist.length) {
            html += `<h4>Suggested checklist</h4><ul>${checklist
              .map(t => `<li>${escapeHtml(String(t))}</li>`)
              .join('')}</ul>`;
          }
          if (timeline.length) {
            html += `<h4>Sample timeline</h4><ul>${timeline
              .map(
                row =>
                  `<li><strong>${escapeHtml(String(row.time || ''))}</strong> – ${escapeHtml(
                    String(row.item || '')
                  )}${
                    row.owner
                      ? ` <span class="small">(${escapeHtml(String(row.owner))})</span>`
                      : ''
                  }</li>`
              )
              .join('')}</ul>`;
          }
          if (suppliers.length) {
            html += `<h4>Supplier tips</h4><ul>${suppliers
              .map(
                row =>
                  `<li><strong>${escapeHtml(
                    String(row.category || 'Supplier')
                  )}:</strong> ${escapeHtml(String(row.suggestion || ''))}</li>`
              )
              .join('')}</ul>`;
          }
          if (budget.length) {
            html += `<h4>Budget breakdown</h4><ul>${budget
              .map(
                row =>
                  `<li><strong>${escapeHtml(String(row.item || 'Item'))}:</strong> ${escapeHtml(
                    String(row.estimate || '')
                  )}</li>`
              )
              .join('')}</ul>`;
          }
          if (styleIdeas.length) {
            html += `<h4>Style &amp; theme ideas</h4><ul>${styleIdeas
              .map(t => `<li>${escapeHtml(String(t))}</li>`)
              .join('')}</ul>`;
          }
          if (messages.length) {
            html += `<h4>Messages to suppliers</h4><ul>${messages
              .map(t => `<li>${escapeHtml(String(t))}</li>`)
              .join('')}</ul>`;
          }

          if (!html) {
            html =
              '<p class="small">AI did not return any structured suggestions. Try adding a bit more detail to your description.</p>';
          }
          aiOut.innerHTML = html;
        } catch (err) {
          console.error('AI planning error', err);
          aiOut.innerHTML =
            '<p class="small">Sorry, something went wrong while generating suggestions.</p>';
        }
      });
    }
  } catch {
    // If anything fails, we just keep the page working without AI.
  }

  // --- Budget tracker (manual, but seeded with supplier count) ---
  if (budgetEl) {
    const totalSuppliers = items.length;
    let est = '';
    if (totalSuppliers === 0) {
      est =
        'No suppliers added yet. Once you add venues, catering and more, you can track budget here.';
    } else if (totalSuppliers === 1) {
      est =
        'You have 1 supplier in your plan. Use this section to keep track of quotes and payments.';
    } else {
      est = `You have ${totalSuppliers} suppliers in your plan. Use this section to track quotes and payments.`;
    }
    const budgetItems = plan.budgetItems || [];
    budgetEl.innerHTML = `
      <p class="small">${est}</p>
      <div class="plan-list-block">
        ${
          budgetItems.length
            ? `
          <table>
            <thead><tr><th>Item</th><th>Estimate</th><th>Actual</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              ${budgetItems
                .map(
                  row => `
                <tr data-id="${row.id}">
                  <td>${escapeHtml(row.label || '')}</td>
                  <td>${escapeHtml(row.estimate || '')}</td>
                  <td>${escapeHtml(row.actual || '')}</td>
                  <td>${escapeHtml(row.notes || '')}</td>
                  <td><button class="ef-cta link-button" data-remove-budget="${row.id}">Remove</button></td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        `
            : `<p class="plan-list-empty">Add your first budget line below — for example “Venue”, “Catering” or “Photography”.</p>`
        }
      </div>
      <div class="form-row plan-inline-fields">
        <input id="budget-label" type="text" placeholder="Item, e.g. Venue hire">
        <input id="budget-estimate" type="text" placeholder="Estimate, e.g. £2,000">
        <input id="budget-actual" type="text" placeholder="Actual (optional)">
        <input id="budget-notes" type="text" placeholder="Notes (optional)">
        <button class="cta secondary" id="add-budget" type="button">Add line</button>
      </div>
    `;
    const addBudget = document.getElementById('add-budget');
    if (addBudget) {
      addBudget.addEventListener('click', () => {
        const label = (document.getElementById('budget-label').value || '').trim();
        const estimate = (document.getElementById('budget-estimate').value || '').trim();
        const actual = (document.getElementById('budget-actual').value || '').trim();
        const notesVal = (document.getElementById('budget-notes').value || '').trim();
        if (!label && !estimate) {
          return;
        }
        const row = {
          id: `b_${Date.now().toString(36)}`,
          label,
          estimate,
          actual,
          notes: notesVal,
        };
        if (!plan.budgetItems) {
          plan.budgetItems = [];
        }
        plan.budgetItems.push(row);
        saveLocalPlan(plan);
        initPlan(); // simple re-render
      });
    }
    budgetEl.querySelectorAll('[data-remove-budget]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-remove-budget');
        plan.budgetItems = (plan.budgetItems || []).filter(r => r.id !== id);
        saveLocalPlan(plan);
        initPlan();
      });
    });
  }

  // --- Render guests / tasks / timeline ---
  function renderGuests() {
    const host = document.getElementById('plan-guests');
    if (!host) {
      return;
    }
    const guests = plan.guests || [];
    if (!guests.length) {
      host.innerHTML =
        '<p class="plan-list-empty">No guests added yet. Start by adding your VIPs (wedding party, parents, etc.).</p>';
      return;
    }
    host.innerHTML = `
      <div class="plan-list-block">
        <table>
          <thead><tr><th>Name</th><th>Role / side</th><th>Notes</th><th></th></tr></thead>
          <tbody>
            ${guests
              .map(
                g => `
              <tr data-id="${g.id}">
                <td>${escapeHtml(g.name || '')}</td>
                <td>${escapeHtml(g.role || '')}</td>
                <td>${escapeHtml(g.notes || '')}</td>
                <td><button class="ef-cta link-button" data-remove-guest="${g.id}">Remove</button></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
    host.querySelectorAll('[data-remove-guest]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-remove-guest');
        plan.guests = (plan.guests || []).filter(g => g.id !== id);
        saveLocalPlan(plan);
        renderGuests();
        updateProgress();
      });
    });
  }

  function renderTasks() {
    const host = document.getElementById('plan-tasks');
    if (!host) {
      return;
    }
    const tasks = plan.tasks || [];
    if (!tasks.length) {
      host.innerHTML = '<p class="plan-list-empty">No tasks yet. Add your first one below.</p>';
      return;
    }
    host.innerHTML = `
      <div class="plan-list-block">
        <table>
          <thead><tr><th>Done</th><th>Task</th><th>Due</th><th></th></tr></thead>
          <tbody>
            ${tasks
              .map(
                t => `
              <tr data-id="${t.id}">
                <td><input type="checkbox" data-toggle-task="${t.id}" ${t.done ? 'checked' : ''}></td>
                <td>${escapeHtml(t.label || '')}</td>
                <td>${escapeHtml(t.due || '')}</td>
                <td><button class="ef-cta link-button" data-remove-task="${t.id}">Remove</button></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
    host.querySelectorAll('[data-toggle-task]').forEach(box => {
      box.addEventListener('change', () => {
        const id = box.getAttribute('data-toggle-task');
        const tasksArr = plan.tasks || [];
        const t = tasksArr.find(x => x.id === id);
        if (t) {
          t.done = !!box.checked;
        }
        plan.tasks = tasksArr;
        saveLocalPlan(plan);
        updateProgress();
      });
    });
    host.querySelectorAll('[data-remove-task]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-remove-task');
        plan.tasks = (plan.tasks || []).filter(t => t.id !== id);
        saveLocalPlan(plan);
        renderTasks();
        updateProgress();
      });
    });
  }

  function renderTimeline() {
    const host = document.getElementById('plan-timeline');
    if (!host) {
      return;
    }
    const timeline = plan.timeline || [];
    if (!timeline.length) {
      host.innerHTML =
        '<p class="plan-list-empty">No timeline items yet. Add key parts of the day below.</p>';
      return;
    }
    host.innerHTML = `
      <div class="plan-list-block">
        <table>
          <thead><tr><th>Time</th><th>What happens</th><th>Who</th><th></th></tr></thead>
          <tbody>
            ${timeline
              .map(
                t => `
              <tr data-id="${t.id}">
                <td>${escapeHtml(t.time || '')}</td>
                <td>${escapeHtml(t.item || '')}</td>
                <td>${escapeHtml(t.owner || '')}</td>
                <td><button class="ef-cta link-button" data-remove-timeline="${t.id}">Remove</button></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
    host.querySelectorAll('[data-remove-timeline]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-remove-timeline');
        plan.timeline = (plan.timeline || []).filter(t => t.id !== id);
        saveLocalPlan(plan);
        renderTimeline();
      });
    });
  }

  function updateProgress() {
    const wrap = document.getElementById('plan-progress-wrap');
    const percentEl = document.getElementById('plan-progress-percent');
    const breakdownEl = document.getElementById('plan-progress-breakdown');
    if (!wrap || !percentEl || !breakdownEl) {
      return;
    }

    const totalTasks = (plan.tasks || []).length;
    const doneTasks = (plan.tasks || []).filter(t => t.done).length;
    const hasGuests = (plan.guests || []).length > 0;
    const hasTimeline = (plan.timeline || []).length > 0;
    const hasSuppliers = items.length > 0;

    let score = 0;
    const max = 4;
    if (hasSuppliers) {
      score++;
    }
    if (hasGuests) {
      score++;
    }
    if (hasTimeline) {
      score++;
    }
    if (totalTasks && doneTasks === totalTasks) {
      score++;
    }

    const percent = Math.round((score / max) * 100);
    percentEl.textContent = `${percent}% complete`;

    const bits = [];
    bits.push(hasSuppliers ? '✓ At least one supplier added' : '• Add at least one supplier');
    bits.push(hasGuests ? '✓ Guest list started' : '• Start your guest list');
    bits.push(hasTimeline ? '✓ Timeline started' : '• Add key parts of your day');
    if (totalTasks) {
      bits.push(`• Tasks: ${doneTasks}/${totalTasks} complete`);
    } else {
      bits.push('• Add your first checklist task');
    }
    breakdownEl.innerHTML = bits.map(b => `<div>${escapeHtml(b)}</div>`).join('');
    wrap.style.display = 'block';
  }

  // Initial render from local plan
  renderGuests();
  renderTasks();
  renderTimeline();
  updateProgress();

  // Wire up add buttons
  const addGuest = document.getElementById('add-guest');
  if (addGuest) {
    addGuest.addEventListener('click', () => {
      const name = (document.getElementById('guest-name').value || '').trim();
      const side = (document.getElementById('guest-side').value || '').trim();
      const notesVal = (document.getElementById('guest-notes').value || '').trim();
      if (!name) {
        return;
      }
      const g = { id: `g_${Date.now().toString(36)}`, name, role: side, notes: notesVal };
      if (!plan.guests) {
        plan.guests = [];
      }
      plan.guests.push(g);
      saveLocalPlan(plan);
      document.getElementById('guest-name').value = '';
      document.getElementById('guest-side').value = '';
      document.getElementById('guest-notes').value = '';
      renderGuests();
      updateProgress();
    });
  }

  const addTask = document.getElementById('add-task');
  if (addTask) {
    addTask.addEventListener('click', () => {
      const label = (document.getElementById('task-label').value || '').trim();
      const due = (document.getElementById('task-due').value || '').trim();
      if (!label) {
        return;
      }
      const t = { id: `t_${Date.now().toString(36)}`, label, due, done: false };
      if (!plan.tasks) {
        plan.tasks = [];
      }
      plan.tasks.push(t);
      saveLocalPlan(plan);
      document.getElementById('task-label').value = '';
      document.getElementById('task-due').value = '';
      renderTasks();
      updateProgress();
    });
  }

  const addTimeline = document.getElementById('add-timeline');
  if (addTimeline) {
    addTimeline.addEventListener('click', () => {
      const time = (document.getElementById('timeline-time').value || '').trim();
      const item = (document.getElementById('timeline-item').value || '').trim();
      const owner = (document.getElementById('timeline-owner').value || '').trim();
      if (!time && !item) {
        return;
      }
      const t = { id: `tl_${Date.now().toString(36)}`, time, item, owner };
      if (!plan.timeline) {
        plan.timeline = [];
      }
      plan.timeline.push(t);
      saveLocalPlan(plan);
      document.getElementById('timeline-time').value = '';
      document.getElementById('timeline-item').value = '';
      document.getElementById('timeline-owner').value = '';
      renderTimeline();
      updateProgress();
    });
  }

  // Notes are part of the same local plan object
  if (notesEl) {
    if (plan.notes) {
      notesEl.value = plan.notes;
    }
    notesEl.addEventListener('input', () => {
      plan.notes = notesEl.value;
      saveLocalPlan(plan);
      if (status) {
        status.textContent = 'Saved';
      }
      if (cloud) {
        cloud.textContent = 'Saved locally';
      }
      if (status) {
        setTimeout(() => {
          status.textContent = '';
        }, 1200);
      }
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      plan.notes = notesEl ? notesEl.value : '';
      saveLocalPlan(plan);
      if (status) {
        status.textContent = 'Saved';
      }
      if (cloud) {
        cloud.textContent = 'Saved locally';
      }
      if (status) {
        setTimeout(() => {
          status.textContent = '';
        }, 1200);
      }
    });
  }
}

async function renderThreads(targetEl) {
  const host = document.getElementById(targetEl);
  if (!host) {
    return;
  }

  let user = null;
  try {
    user = await me();
  } catch {
    /* Ignore user fetch errors */
  }
  if (!user) {
    host.innerHTML = '<p class="small">Sign in to see your conversations.</p>';
    return;
  }

  try {
    const r = await fetch('/api/v4/messenger/conversations', {
      credentials: 'include',
    });
    if (!r.ok) {
      host.innerHTML = '<p class="small">Could not load conversations.</p>';
      return;
    }
    const d = await r.json();
    const items = (d.conversations || d.items || [])
      .slice()
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

    if (!items.length) {
      host.innerHTML =
        '<p class="small">No conversations yet. Once you contact suppliers, they\'ll appear here.</p>';
      return;
    }

    host.innerHTML = `
      <div class="thread-list">
        ${items
          .map(t => {
            const otherParticipant = (t.participants || []).find(
              p => p.userId !== (user && user.id)
            );
            const otherName =
              (otherParticipant && (otherParticipant.displayName || otherParticipant.name)) ||
              t.title ||
              'Conversation';
            const trimmedName = String(otherName).trim();
            const initial = (trimmedName || 'U').charAt(0).toUpperCase();
            const avatarUrl =
              otherParticipant &&
              otherParticipant.avatar &&
              /^(https?:\/\/|\/[^:])/i.test(otherParticipant.avatar)
                ? otherParticipant.avatar
                : '';
            const last = (
              (t.lastMessage && t.lastMessage.content) ||
              t.lastMessageText ||
              ''
            ).slice(0, 80);
            const when = t.updatedAt ? new Date(t.updatedAt).toLocaleString() : '';
            const convId = t._id || t.id;
            return `
            <button class="ef-cta thread-row" type="button" data-open="${convId}">
              <span class="thread-row-avatar" aria-hidden="true"${
                avatarUrl
                  ? ` style="background-image:url('${escapeHtml(avatarUrl)}');background-size:cover;background-position:center;color:transparent;"`
                  : ''
              }>${escapeHtml(initial)}</span>
              <div class="thread-row-main">
                <span class="thread-row-title">${escapeHtml(otherName)}</span>
                <span class="thread-row-snippet">${escapeHtml(last || 'No messages yet.')}</span>
              </div>
              <div class="thread-row-meta">
                ${escapeHtml(when)}
              </div>
            </button>
          `;
          })
          .join('')}
      </div>
    `;

    host.querySelectorAll('[data-open]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-open');
        window.location.href = `/messenger/?conversation=${id}`;
      });
    });
  } catch {
    host.innerHTML = '<p class="small">Could not load conversations.</p>';
  }
}

// Shared CSS for the onboarding overlay used by both supplier and customer dashboards.
// Uses ID selector + !important to override the global .card { border:none!important;
// background:#fff!important } rules that would otherwise break the gradient border.
const EF_OB_SHARED_CSS = `
  #ef-onboarding-box {
    border: 2px solid transparent !important;
    background-image: linear-gradient(#fff, #fff),
      linear-gradient(to bottom, #0d9488, #a7f3d0) !important;
    background-origin: padding-box, border-box !important;
    background-clip: padding-box, border-box !important;
    box-shadow: 0 4px 32px rgba(13, 148, 136, 0.13),
      0 1px 4px rgba(0, 0, 0, 0.06) !important;
    padding: 1rem 1.5rem 1.125rem !important;
    border-radius: 16px !important;
  }
  #ef-ob-inner {
    display: flex; align-items: center; gap: 1.25rem;
    flex-wrap: wrap; padding-top: 0.125rem;
  }
  #ef-ob-title { flex: 1; min-width: 200px; text-align: left; }
  #ef-ob-right {
    display: flex; align-items: center; gap: 0.5rem;
    flex-wrap: wrap; justify-content: flex-end;
  }
  #ef-onboarding-dismiss {
    flex-shrink: 0;
    background: linear-gradient(135deg, #22c55e, #16a34a) !important;
    color: #fff !important;
    font-weight: 700;
    padding: 0.5625rem 1.25rem !important;
    border-radius: 10px !important;
    border: none !important;
    cursor: pointer;
    font-size: 0.875rem !important;
    box-shadow: 0 3px 12px rgba(22, 163, 74, 0.3);
    white-space: nowrap;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    width: auto !important;
    margin-top: 0 !important;
  }
  .ef-ob-close:focus-visible {
    outline: none !important;
    box-shadow: 0 0 0 2px #fff, 0 0 0 4px #0d9488 !important;
  }
  @media (prefers-reduced-motion: reduce) {
    #ef-onboarding-box, .ef-ob-pill, #ef-onboarding-dismiss {
      transition: none !important;
    }
  }
`;

function efMaybeShowOnboarding(page) {
  // Check if onboarding has been permanently dismissed (either key suffices)
  try {
    const dismissed = localStorage.getItem('ef_onboarding_dismissed');
    if (dismissed === '1') {
      return;
    }
    if (page === 'dash_supplier' && localStorage.getItem('ef_supplier_welcome_dismissed') === '1') {
      return;
    }
    if (page === 'dash_customer' && localStorage.getItem('ef_customer_welcome_dismissed') === '1') {
      return;
    }
  } catch {
    /* Ignore localStorage errors */
  }

  // Check if this is a first-time visit that needs onboarding
  let shouldShow = false;
  try {
    const flag = localStorage.getItem('eventflow_onboarding_new');
    if (flag === '1') {
      shouldShow = true;
      localStorage.setItem('eventflow_onboarding_new', '0');
    }
  } catch {
    /* Ignore localStorage errors */
  }

  if (!shouldShow) {
    return;
  }

  // For supplier dashboard, create a modern, engaging onboarding card with liquid glass aesthetic
  if (page === 'dash_supplier') {
    const container = document.querySelector('main .container');
    if (!container) {
      return;
    }

    const box = document.createElement('div');
    box.id = 'ef-onboarding-box';
    box.className = 'card no-collapse';
    box.style.color = '#1f2937';
    box.style.padding = '1rem 1.5rem 1.125rem';
    box.style.borderRadius = '16px';
    box.style.position = 'relative';
    box.style.overflow = 'hidden';
    box.style.boxShadow = '0 4px 32px rgba(13, 148, 136, 0.13), 0 1px 4px rgba(0, 0, 0, 0.06)';
    box.style.border = '2px solid transparent';
    box.style.backgroundImage =
      'linear-gradient(#ffffff, #ffffff), linear-gradient(to bottom, #0d9488, #a7f3d0)';
    box.style.backgroundOrigin = 'padding-box, border-box';
    box.style.backgroundClip = 'padding-box, border-box';

    box.innerHTML = `
      <style>
        ${EF_OB_SHARED_CSS}
        /* Supplier-specific pill sizing */
        .ef-ob-pill {
          flex: 0 0 148px; display: flex; align-items: center;
          gap: 0.375rem; padding: 0.375rem 0.75rem;
          background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px;
        }
        .ef-ob-pill span:last-child {
          color: #134e4a; font-weight: 500;
          font-size: 0.8125rem; white-space: nowrap;
        }
        @media (max-width: 540px) {
          #ef-onboarding-box { padding: 0.875rem 1rem 1rem !important; }
          #ef-ob-inner { gap: 0.75rem; }
          #ef-ob-right {
            display: grid; grid-template-columns: 1fr 1fr;
            width: 100%; gap: 0.5rem;
          }
          #ef-onboarding-dismiss { grid-column: 1 / -1; text-align: center; }
          .ef-ob-pill { flex: unset; width: auto; }
        }
        @media (max-width: 400px) {
          #ef-ob-right { grid-template-columns: 1fr; }
        }
      </style>
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#0d9488,#5eead4);border-radius:16px 16px 0 0;"></div>
      <div id="ef-ob-inner">
        <div id="ef-ob-title">
          <h2 style="color:#1e3a5f;font-size:1.25rem;font-weight:800;letter-spacing:-0.02em;line-height:1.2;margin-bottom:0.25rem;">Welcome to your Supplier Dashboard! 👋</h2>
          <p style="color:#6b7280;font-size:0.8125rem;line-height:1.5;margin:0;">Manage your packages, respond to enquiries, track performance and set your availability — everything in the sections below.</p>
        </div>
        <div id="ef-ob-right">
          <div class="ef-ob-pill"><span style="font-size:1rem;line-height:1;" aria-hidden="true">✨</span><span>Complete profile</span></div>
          <div class="ef-ob-pill"><span style="font-size:1rem;line-height:1;" aria-hidden="true">📦</span><span>Add a package</span></div>
          <div class="ef-ob-pill"><span style="font-size:1rem;line-height:1;" aria-hidden="true">💬</span><span>Engage customers</span></div>
          <div class="ef-ob-pill"><span style="font-size:1rem;line-height:1;" aria-hidden="true">📅</span><span>Set availability</span></div>
          <button type="button" class="cta" id="ef-onboarding-dismiss" aria-label="Dismiss onboarding and start using dashboard">Got it! 🚀</button>
        </div>
      </div>
    `;

    const cards = container.querySelector('.cards');
    if (cards && cards.parentNode === container) {
      container.insertBefore(box, cards);
    } else {
      container.insertBefore(box, container.firstChild);
    }

    // Shared dismiss handler — delegates to module function if already loaded
    const doOverlayDismiss = function () {
      if (typeof window.dismissSupplierWelcome === 'function') {
        window.dismissSupplierWelcome();
        return;
      }
      // Fallback (module not yet loaded): handle inline
      try {
        localStorage.setItem('ef_onboarding_dismissed', '1');
        localStorage.setItem('ef_supplier_welcome_dismissed', '1');
      } catch {
        /* Ignore localStorage errors */
      }
      const easing = 'cubic-bezier(0.4, 0, 0.2, 1)';
      box.style.transition = `opacity 0.3s ${easing}, transform 0.3s ${easing}`;
      box.style.opacity = '0';
      box.style.transform = 'scale(0.95)';
      setTimeout(() => box.remove(), 300);
    };

    const btn = box.querySelector('#ef-onboarding-dismiss');
    if (btn) {
      // Add hover effect with green theme glow
      btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'scale(1.05) translateY(-2px)';
        btn.style.boxShadow = '0 8px 20px rgba(34, 197, 94, 0.4)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'scale(1) translateY(0)';
        btn.style.boxShadow = '0 3px 12px rgba(22, 163, 74, 0.3)';
      });

      btn.addEventListener('click', doOverlayDismiss);
    }
    return;
  }

  if (page === 'dash_customer') {
    const container = document.querySelector('main .container');
    if (!container) {
      return;
    }

    const box = document.createElement('div');
    box.id = 'ef-onboarding-box';
    box.className = 'card no-collapse';
    box.style.color = '#1f2937';
    box.style.padding = '1rem 1.5rem 1.125rem';
    box.style.borderRadius = '16px';
    box.style.position = 'relative';
    box.style.overflow = 'hidden';
    box.style.boxShadow = '0 4px 32px rgba(13, 148, 136, 0.13), 0 1px 4px rgba(0, 0, 0, 0.06)';
    box.style.border = '2px solid transparent';
    box.style.backgroundImage =
      'linear-gradient(#ffffff, #ffffff), linear-gradient(to bottom, #0d9488, #a7f3d0)';
    box.style.backgroundOrigin = 'padding-box, border-box';
    box.style.backgroundClip = 'padding-box, border-box';
    // Entry animation — start invisible/shifted, animate to visible
    box.style.opacity = '0';
    box.style.transform = 'translateY(-8px)';
    box.style.transition =
      'opacity 0.35s cubic-bezier(0.4,0,0.2,1), transform 0.35s cubic-bezier(0.4,0,0.2,1)';

    box.innerHTML = `
      <style>
        ${EF_OB_SHARED_CSS}
        /* Customer-specific pill styling (links with hover/focus states) */
        .ef-ob-pill {
          flex: 0 0 auto; display: flex; align-items: center;
          gap: 0.375rem; padding: 0.375rem 0.75rem;
          background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px;
          text-decoration: none;
          transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
        }
        .ef-ob-pill:hover, .ef-ob-pill:focus-visible {
          background: #ccfbf1; border-color: #5eead4;
          box-shadow: 0 2px 8px rgba(13, 148, 136, 0.15); outline: none;
        }
        .ef-ob-pill:focus-visible {
          outline: 2px solid #0d9488; outline-offset: 2px;
        }
        .ef-ob-pill span:last-child {
          color: #134e4a; font-weight: 500;
          font-size: 0.8125rem; white-space: nowrap;
        }
        /* Pulse the CTA button 3× after the card enters to draw attention */
        @keyframes ef-ob-btn-glow {
          0%, 100% { box-shadow: 0 3px 12px rgba(22, 163, 74, 0.3); }
          50% { box-shadow: 0 4px 20px rgba(22, 163, 74, 0.55), 0 0 0 3px rgba(34, 197, 94, 0.15); }
        }
        #ef-onboarding-dismiss {
          animation: ef-ob-btn-glow 1.8s ease-in-out 0.6s 3;
        }
        /* At tablet widths the button wraps to its own row — make it span full width */
        @media (max-width: 768px) {
          #ef-ob-right { gap: 0.5rem; }
          #ef-onboarding-dismiss { width: 100% !important; flex-basis: 100%; }
        }
        @media (max-width: 540px) {
          #ef-onboarding-box { padding: 0.875rem 1rem 1rem !important; }
          #ef-ob-inner { gap: 0.75rem; }
          #ef-ob-right {
            display: grid; grid-template-columns: 1fr 1fr;
            width: 100%; gap: 0.5rem;
          }
          #ef-onboarding-dismiss { grid-column: 1 / -1; text-align: center; }
          .ef-ob-pill { flex: unset; width: auto; overflow: hidden; }
          .ef-ob-pill span:last-child { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
        }
        @media (max-width: 400px) {
          #ef-ob-right { grid-template-columns: 1fr; }
        }
        @media (prefers-reduced-motion: reduce) {
          #ef-onboarding-dismiss { animation: none !important; }
        }
      </style>
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#0d9488,#5eead4);border-radius:16px 16px 0 0;"></div>
      <div id="ef-ob-inner">
        <div id="ef-ob-title">
          <h2 style="color:#1e3a5f;font-size:1.25rem;font-weight:800;letter-spacing:-0.02em;line-height:1.2;margin-bottom:0.25rem;">Welcome to EventFlow! 👋</h2>
          <p style="color:#6b7280;font-size:0.8125rem;line-height:1.5;margin:0;">Plan your perfect event with our curated suppliers — everything you need is below.</p>
        </div>
        <div id="ef-ob-right">
          <a href="/start" class="ef-ob-pill" aria-label="Create an event plan"><span style="font-size:1rem;line-height:1;flex-shrink:0;" aria-hidden="true">📋</span><span>Create an event plan</span></a>
          <a href="/suppliers" class="ef-ob-pill" aria-label="Browse and save suppliers"><span style="font-size:1rem;line-height:1;flex-shrink:0;" aria-hidden="true">🔍</span><span>Browse &amp; save suppliers</span></a>
          <a href="/budget" class="ef-ob-pill" aria-label="Track your budget"><span style="font-size:1rem;line-height:1;flex-shrink:0;" aria-hidden="true">💰</span><span>Track your budget</span></a>
          <button type="button" class="cta" id="ef-onboarding-dismiss" aria-label="Dismiss welcome message">Let's go! →</button>
        </div>
      </div>
    `;

    container.insertBefore(box, container.firstChild);

    // Hide the static #welcome-section to prevent two welcome messages on first visit
    const welcomeSection = container.querySelector('#welcome-section');
    if (welcomeSection) {
      welcomeSection.style.display = 'none';
    }

    // Trigger entry animation on next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        box.style.opacity = '1';
        box.style.transform = 'translateY(0)';
      });
    });

    const doOverlayDismiss = function () {
      if (typeof window.dismissCustomerWelcome === 'function') {
        window.dismissCustomerWelcome();
        return;
      }
      try {
        localStorage.setItem('ef_onboarding_dismissed', '1');
        localStorage.setItem('ef_customer_welcome_dismissed', '1');
      } catch {
        /* Ignore localStorage errors */
      }
      const easing = 'cubic-bezier(0.4, 0, 0.2, 1)';
      box.style.transition = `opacity 0.3s ${easing}, transform 0.3s ${easing}`;
      box.style.opacity = '0';
      box.style.transform = 'scale(0.97)';
      setTimeout(() => box.remove(), 300);
    };

    const btn = box.querySelector('#ef-onboarding-dismiss');
    if (btn) {
      btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'scale(1.05) translateY(-2px)';
        btn.style.boxShadow = '0 8px 20px rgba(34, 197, 94, 0.4)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'scale(1) translateY(0)';
        btn.style.boxShadow = '0 3px 12px rgba(22, 163, 74, 0.3)';
      });
      btn.addEventListener('click', doOverlayDismiss);
    }
    return;
  }

  // For other pages (admin), create the onboarding card as before
  const container = document.querySelector('main .container');
  if (!container) {
    return;
  }

  const box = document.createElement('div');
  box.className = 'card';
  let body = '';
  if (page === 'admin') {
    body =
      '<p class="small">Quick overview:</p>' +
      '<ol class="small"><li>Check <strong>Metrics</strong> to see demo usage.</li>' +
      '<li>Approve or hide supplier profiles and packages.</li>' +
      '<li>Use <strong>Reset demo data</strong> to get back to a clean state.</li></ol>';
  }

  box.innerHTML = `<h2 class="h4">Welcome to EventFlow</h2>${
    body
  }<div class="form-actions form-actions--modal"><button type="button" class="cta secondary" id="ef-onboarding-dismiss">Got it</button></div>`;

  const cards = container.querySelector('.cards');
  if (cards && cards.parentNode === container) {
    container.insertBefore(box, cards);
  } else {
    container.insertBefore(box, container.firstChild);
  }

  const btn = box.querySelector('#ef-onboarding-dismiss');
  if (btn) {
    btn.addEventListener('click', () => {
      try {
        localStorage.setItem('ef_onboarding_dismissed', '1');
      } catch {
        /* Ignore localStorage errors */
      }
      box.remove();
    });
  }
}

/** Message shown in #pkg-status when the free-tier active package limit is reached. */
const PKG_LIMIT_MESSAGE =
  'You have reached the active package limit on the Starter plan. Upgrade to Pro to add more.';

async function initDashSupplier() {
  efMaybeShowOnboarding('dash_supplier');

  // Fetch CSRF token if not already available
  async function ensureCsrfToken() {
    if (!window.__CSRF_TOKEN__) {
      try {
        const resp = await fetch('/api/csrf-token', { credentials: 'include' });
        if (resp.ok) {
          const data = await resp.json();
          window.__CSRF_TOKEN__ = data.csrfToken;
        }
      } catch (e) {
        console.error('Failed to fetch CSRF token:', e);
      }
    }
    return window.__CSRF_TOKEN__ || '';
  }

  // Fetch CSRF token on init
  await ensureCsrfToken();

  // If returning from Stripe checkout with billing=success, mark this supplier account as Pro
  // and show a welcome toast to confirm the subscription is active.
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('billing') === 'success') {
      fetch('/api/v1/me/subscription/upgrade', {
        method: 'POST',
        headers: { 'X-CSRF-Token': window.__CSRF_TOKEN__ || '' },
        credentials: 'include',
      }).catch(() => {
        /* Ignore errors */
      });
      // Show success toast — webhook provisioning may take a few seconds
      setTimeout(() => {
        showToast(
          '🎉 Welcome to EventFlow Professional! Your subscription is now active.',
          'success'
        );
        // Remove the billing=success query param from the URL without a reload
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('billing');
        cleanUrl.searchParams.delete('session_id');
        window.history.replaceState({}, '', cleanUrl.toString());
      }, 800);
    }
  } catch {
    /* Ignore conversation fetch errors */
  }

  async function api(path, opts = {}) {
    try {
      const method = (opts.method || 'GET').toUpperCase();
      const isWriteMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

      const headers = { ...(opts.headers || {}) };

      // Inject CSRF token for state-changing methods
      if (isWriteMethod) {
        try {
          const token = await ensureCsrfToken();
          if (token) {
            headers['X-CSRF-Token'] = token;
          }
        } catch (e) {
          console.warn('Unable to ensure CSRF token before API request:', e);
        }
      }

      // Always include credentials for cookie-based auth
      const options = {
        ...opts,
        headers,
        credentials: opts.credentials || 'include',
      };
      let r = await fetch(path, options);

      // On 403 with a CSRF error, refresh the token and retry once
      if (isWriteMethod && r.status === 403) {
        // Clone the response before reading its body so the original stays intact if no retry occurs
        const data = await r
          .clone()
          .json()
          .catch(() => ({}));
        if (/csrf/i.test(data?.error || '')) {
          try {
            window.__CSRF_TOKEN__ = null;
            window.csrfToken = null;
            const freshToken = await ensureCsrfToken();
            if (freshToken) {
              r = await fetch(path, {
                ...options,
                headers: { ...headers, 'X-CSRF-Token': freshToken },
              });
            }
          } catch (e) {
            console.warn('Unable to refresh CSRF token after 403:', e);
          }
        }
      }

      if (!r.ok) {
        // 413 Payload Too Large: body-parser limits exceeded (most likely a large base64 image).
        // body-parser sends an HTML response for 413, so r.json() would fail — give a useful message.
        // Note: the client-side efSetupPhotoDropZone already blocks files over 5 MB; this fallback
        // handles edge cases where the combined JSON payload still exceeds the server limit.
        if (r.status === 413) {
          throw new Error(
            'The uploaded image is too large. Please use an image smaller than 5 MB.'
          );
        }
        // 404 Not Found: the requested resource does not exist (e.g. a stale URL after a data
        // migration). The thrown Error propagates to the caller's catch block, which shows a
        // user-visible message via the status element — so 404s never fail silently.
        const errorData = await r.json().catch(() => ({ error: 'Request failed' }));
        const err = new Error(errorData.message || errorData.error || `HTTP ${r.status}`);
        err.code = errorData.code || '';
        err.setupUrl = errorData.setupUrl || '';
        err.status = r.status;
        throw err;
      }
      return r.json();
    } catch (error) {
      console.error(`API Error [${path}]:`, error);
      throw error;
    }
  }
  const supWrap = document.getElementById('my-suppliers');
  const pkgsWrap = document.getElementById('my-packages');
  const select = document.getElementById('pkg-supplier');
  const proRibbon = document.getElementById('supplier-pro-ribbon');
  let currentIsPro = false;
  let currentEditingSupplierId = null; // Track which supplier is being edited
  let cachedSuppliers = []; // Cache loaded suppliers for edit lookups

  async function loadSuppliers() {
    try {
      const d = await api('/api/me/suppliers');
      const items = d?.items && Array.isArray(d.items) ? d.items : [];
      let currentUser = null;
      try {
        currentUser = await me();
      } catch {
        console.warn('Unable to load current user profile for supplier photo controls');
        currentUser = null;
      }
      const profileDisplayName =
        `${currentUser?.firstName || ''} ${currentUser?.lastName || ''}`.trim() ||
        [currentUser?.name, currentUser?.firstName, currentUser?.email]
          .find(v => typeof v === 'string' && v.trim())
          ?.trim();
      const currentUserProfilePhotoUrl =
        currentUser?.avatarUrl &&
        /^(https?:\/\/[^\s]+|\/[^/\\:][^:]*)$/i.test(currentUser.avatarUrl)
          ? currentUser.avatarUrl.trim()
          : '';
      const resolveDashboardSupplierProfilePhoto = supplier => {
        const candidates = [
          supplier?.profilePhotoUrl,
          supplier?.displayAvatarUrl,
          supplier?.avatarUrl,
          supplier?.profileImage,
          currentUserProfilePhotoUrl,
          supplier?.logo,
        ];
        const found = candidates.find(value => {
          if (!value || typeof value !== 'string') {
            return false;
          }
          return /^(https?:\/\/[^\s]+|\/[^/\\:][^:]*)$/i.test(value.trim());
        });
        return typeof found === 'string' ? escapeHtml(found.trim()) : '';
      };
      const profileInitial = escapeHtml(
        (profileDisplayName || '')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map(part => part.charAt(0).toUpperCase())
          .join('') || 'U'
      );
      cachedSuppliers = items; // Cache for use within initDashSupplier scope
      window._efCachedSuppliers = items; // Expose globally for editProfile()
      const hasSupplierProfile = items.length > 0;
      const hasApprovedSupplierProfile = items.some(s => s && s.approved === true);
      window._supplierProfileMissing = !hasSupplierProfile;
      window._supplierApprovalBlocked = hasSupplierProfile && !hasApprovedSupplierProfile;
      // If this user has at least one Pro supplier, treat them as Pro.
      // Check subscriptionTier (new field) first, then subscription.tier, then legacy isPro boolean.
      currentIsPro = items.some(s => {
        const supplierTier = normalizeSubscriptionTier(
          s.subscriptionTier,
          s.subscription?.tier,
          s.proPlan
        );
        return !!s.isPro || supplierTier === 'pro' || supplierTier === 'pro_plus';
      });

      // Fallback: if no supplier object indicates Pro, check the user's subscription directly.
      // Use the shared dedup helper so this call and the concurrent
      // displaySubscriptionStatus() call in dashboard-supplier-module.js both
      // share a single network request (and therefore a single Stripe API call).
      if (!currentIsPro) {
        try {
          const subData = await window._efFetchOnceJSON('/api/v2/subscriptions/me', {
            credentials: 'include',
          });
          const userTier = normalizeSubscriptionTier(
            subData?.plan,
            subData?.tier,
            subData?.subscription?.tier,
            subData?.subscription?.plan
          );
          if (userTier === 'pro' || userTier === 'pro_plus') {
            currentIsPro = true;
          }
        } catch {
          // Ignore — subscription endpoint unavailable; fall through to Starter display.
        }
      }

      // Final fallback: auth/me is often the most up-to-date source for account tier.
      // This catches users with paid plans whose supplier records are stale.
      if (!currentIsPro) {
        try {
          const authMe = await window._efFetchOnceJSON('/api/v1/auth/me', {
            credentials: 'include',
          });
          const authTier = normalizeSubscriptionTier(
            authMe?.user?.subscriptionTier,
            authMe?.user?.subscription?.tier,
            authMe?.user?.proPlan
          );
          if (authTier === 'pro' || authTier === 'pro_plus' || authMe?.user?.isPro) {
            currentIsPro = true;
          }
        } catch {
          // Ignore — keep currentIsPro as computed from supplier/subscription endpoints.
        }
      }

      if (proRibbon) {
        if (currentIsPro) {
          proRibbon.classList.remove('pro-ribbon--starter');
          proRibbon.style.display = 'block';
          proRibbon.innerHTML = `
            <div class="pro-ribbon__inner">
              <span class="pro-ribbon__icon" aria-hidden="true">⭐</span>
              <div class="pro-ribbon__text-group">
                <strong>You're on EventFlow Pro.</strong>
                <span class="pro-ribbon__desc"> Your listing appears higher in search and you have access to premium features.</span>
              </div>
            </div>`;
        } else {
          proRibbon.classList.add('pro-ribbon--starter');
          proRibbon.style.display = 'block';
          proRibbon.innerHTML = `
            <div class="pro-ribbon__inner">
              <span class="pro-ribbon__icon" aria-hidden="true">🚀</span>
              <div class="pro-ribbon__text-group">
                <strong>Level up your plan</strong>
                <span class="pro-ribbon__desc">Unlock priority visibility, more packages, and dedicated support — <a href="/pricing" class="pro-ribbon__text-link">upgrade today</a>.</span>
              </div>
            </div>`;
        }
      }

      if (!supWrap) {
        return;
      }

      if (!items || items.length === 0) {
        supWrap.innerHTML =
          '<div class="sd-empty-state"><div class="sd-empty-state__icon" aria-hidden="true">👤</div><div class="sd-empty-state__body"><p class="sd-empty-state__title">Supplier profile setup needed</p><p class="sd-empty-state__desc">Your supplier account needs a linked business profile before you can create packages.</p><a class="sd-empty-state__cta" href="#profile-form" data-action="open-profile-form">Complete supplier profile →</a></div></div>';
        // Update quick-stat-profiles with the real count (0)
        const quickStatProfiles = document.getElementById('quick-stat-profiles');
        if (quickStatProfiles) {
          quickStatProfiles.setAttribute('data-target', '0');
          quickStatProfiles.textContent = '0';
        }
        return;
      }

      // Update quick-stat-profiles with the real profile count
      const quickStatProfiles = document.getElementById('quick-stat-profiles');
      if (quickStatProfiles) {
        quickStatProfiles.setAttribute('data-target', String(items.length));
        quickStatProfiles.textContent = String(items.length);
      }
      // Fetch packages once so checklist milestones can include "create your first package".
      let packagesBySupplierId = new Map();
      try {
        const pkgRes = await api('/api/me/packages');
        const pkgItems = Array.isArray(pkgRes?.items) ? pkgRes.items : [];
        packagesBySupplierId = pkgItems.reduce((map, pkg) => {
          const supplierId = String(pkg?.supplierId || pkg?.supplier || '');
          if (!supplierId) {
            return map;
          }
          map.set(supplierId, (map.get(supplierId) || 0) + 1);
          return map;
        }, new Map());
      } catch {
        // Non-fatal: supplier cards should still render if packages fail to load.
      }
      supWrap.innerHTML = items
        .map(s => {
          // Safe access to supplier properties
          if (!s) {
            return '';
          }

          // Enhanced badge rendering for Pro and Pro+ tiers
          let tierLabel = '';
          // Check subscriptionTier field first (new), then fall back to subscription.tier or isPro
          const tier =
            s.subscriptionTier ||
            (s.subscription && s.subscription.tier) ||
            (s.isPro || s.pro ? 'pro' : null);

          if (tier === 'pro_plus') {
            tierLabel = 'Pro Plus';
          } else if (tier === 'pro') {
            tierLabel = 'Pro';
          } else {
            tierLabel = 'Starter';
          }

          // Profile completeness checklist shown under each listing card. The score itself
          // reuses ProfileHealthWidget's calculation (the same one shown on the "Profile
          // Health" card further down this dashboard) so the two never disagree for the
          // same supplier. This checklist only controls which "improve your profile" items
          // are surfaced per-card; package creation stays as a dashboard-specific nudge.
          const hasPhotos =
            s.photosGallery && Array.isArray(s.photosGallery) && s.photosGallery.length > 0;
          const hasDescription =
            s.description_long &&
            typeof s.description_long === 'string' &&
            s.description_long.length > 50;
          const hasCategory = s.category && typeof s.category === 'string' && s.category.length > 0;
          const hasLocation = s.location && typeof s.location === 'string' && s.location.length > 0;
          const hasWebsite = s.website && typeof s.website === 'string' && s.website.length > 0;

          const packageCountForSupplier = packagesBySupplierId.get(String(s.id || '')) || 0;
          const checklistItems = [
            {
              label: 'Business Details',
              complete: Boolean(s.name && hasLocation),
              targetField: 'sup-name',
            },
            { label: 'Categories & Services', complete: hasCategory, targetField: 'sup-category' },
            { label: 'Photos', complete: hasPhotos, targetField: 'sup-photo-drop' },
            { label: 'Contact Information', complete: hasWebsite, targetField: 'sup-website' },
            {
              label: 'Create your first package',
              complete: packageCountForSupplier > 0,
              detail:
                packageCountForSupplier > 0
                  ? `${packageCountForSupplier} package${packageCountForSupplier === 1 ? '' : 's'} live`
                  : 'Add a package with pricing to start getting enquiries',
              highlight: true,
              targetField: 'package-form',
            },
            { label: 'Business Description', complete: hasDescription, targetField: 'sup-long' },
          ];
          const completedCount = checklistItems.filter(item => item.complete).length;
          // Health score: same formula as the "Profile Health" card (ProfileHealthWidget),
          // falling back to this checklist's own completion ratio only if that shared
          // component failed to load.
          const checklistScore =
            window.ProfileHealthWidget && typeof window.ProfileHealthWidget.calculate === 'function'
              ? window.ProfileHealthWidget.calculate(s).percentage
              : Math.round((completedCount / checklistItems.length) * 100);

          // Safe access to all fields with defaults — escape all user-supplied values to prevent XSS
          const supplierId = String(s.id || '').replace(/"/g, '&quot;');
          const name = escapeHtml(String(s.name || 'Unnamed Supplier'));
          const location = escapeHtml(String(s.location || 'Location not set'));
          const category = escapeHtml(String(s.category || 'Uncategorized'));
          const approved = !!s.approved;
          const profilePhotoUrl = resolveDashboardSupplierProfilePhoto(s);

          return `<div class="supplier-card card glass-card spc-root" data-supplier-id="${supplierId}">
      <div class="spc-summary">
        <!-- Avatar column with camera upload overlay -->
          <div class="spc-avatar-wrap">
            <div class="supplier-profile-photo-slot spc-avatar-col" aria-hidden="true" style="width:100px;height:100px;flex-shrink:0;border-radius:50%;overflow:hidden;${
              profilePhotoUrl
                ? `background:none;`
                : `background:linear-gradient(135deg,#0b8073 0%,#0a6b5f 100%);display:flex;align-items:center;justify-content:center;color:#fff;font-size:2.4rem;font-weight:700;`
            }">
            ${
              profilePhotoUrl
                ? `<img src="${profilePhotoUrl}" alt="Your profile photo" style="width:100%;height:100%;object-fit:cover;display:block;">`
                : profileInitial
            }
            </div>
            ${
              profilePhotoUrl
                ? `<button type="button" class="spc-avatar-delete-btn" data-action="delete-profile-photo" data-profile-id="${supplierId}" title="Delete profile photo" aria-label="Delete profile photo"><span aria-hidden="true">✕</span></button>`
                : ''
            }
            <label for="supplier-profile-photo-upload-${supplierId}" class="spc-camera-btn" title="Upload profile photo" aria-label="Upload profile photo">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </label>
          <input type="file" id="supplier-profile-photo-upload-${supplierId}" class="supplier-profile-photo-upload" data-profile-id="${supplierId}" accept="image/*" style="display:none;" aria-label="Upload profile photo">
        </div>
        <!-- Body column -->
        <div class="spc-body">
          <div class="spc-name-row">
            <h3 class="spc-name">${name}</h3>
            <div class="spc-badges">
              <span class="spc-badge spc-badge--tier">
                <svg class="spc-badge-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                ${tierLabel}
              </span>
              ${
                approved
                  ? `<span class="spc-badge spc-badge--approved">
                      <svg class="spc-badge-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                      Approved
                    </span>`
                  : '<span class="spc-badge spc-badge--pending">Awaiting review</span>'
              }
            </div>
          </div>
          <div class="spc-meta">
            <svg class="spc-meta-icon" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <span>${location}</span>
            <span class="spc-category-chip">
              <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
              ${category}
            </span>
          </div>
        </div>
        <!-- Health score ring (right column). This is a weighted richness score (logo,
             description length, photos, socials, website — see ProfileHealthWidget) and
             is deliberately a different number from the setup checklist beside it, which
             just counts finished tasks. The title/aria-label say so, since the two used
             to read as disagreeing claims about the same thing with nothing to explain why. -->
        <div
          class="spc-ring"
          aria-label="Health score: how complete your profile content is — separate from the setup checklist"
          title="How complete your profile content is (photos, description, links). Separate from the setup checklist below."
          aria-live="polite"
          data-computed-score="${checklistScore}"
        >
          <div class="spc-ring-circle">
            <svg class="spc-ring-svg" viewBox="0 0 80 80" fill="none" aria-hidden="true">
              <circle class="spc-ring-track" cx="40" cy="40" r="32"/>
              <circle class="spc-ring-fill" cx="40" cy="40" r="32"/>
            </svg>
            <div class="spc-ring-inner">
              <span class="spc-ring-score" aria-label="Health score">—</span>
            </div>
          </div>
          <span class="spc-ring-label">Health Score</span>
          <span class="spc-ring-grade"></span>
        </div>
      </div>
      <!-- 3-button action bar -->
      <div class="spc-actions">
        <button type="button" class="spc-action-btn spc-upload-btn" data-action="upload-photo" data-profile-id="${supplierId}">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Upload Photo
        </button>
        <button type="button" class="spc-action-btn spc-action-btn--edit" data-action="edit-profile" data-profile-id="${supplierId}">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          Edit Profile
        </button>
        <button type="button" class="spc-action-btn spc-action-btn--checklist" data-action="view-checklist" data-profile-id="${supplierId}" aria-expanded="true" aria-controls="spc-checklist-${supplierId}">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-2"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>
          <span class="spc-checklist-btn-label">Hide Checklist</span>
        </button>
      </div>
      <!-- Profile Setup Checklist -->
      <div class="spc-checklist-card" id="spc-checklist-${supplierId}">
        <div class="spc-checklist-header">
          <div class="spc-checklist-big-icon${completedCount === checklistItems.length ? ' spc-checklist-big-icon--complete' : ''}" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div class="spc-checklist-header-body">
            <div class="spc-checklist-title-row">
              <span class="spc-checklist-title">Profile Setup Checklist</span>
              <span class="spc-checklist-count">${completedCount} / ${checklistItems.length}</span>
            </div>
            <p class="spc-checklist-subtitle">Setup tasks to complete — a separate count from the Health Score above, which scores how rich your content is</p>
          </div>
        </div>
        <div class="spc-checklist-steps" role="list">
          ${checklistItems
            .map(
              (item, i) => `
            <button type="button" class="spc-checklist-step${item.complete ? ' spc-checklist-step--complete' : ''}${item.highlight ? ' spc-checklist-step--milestone' : ''}" role="listitem" data-checklist-target="${item.targetField || ''}" data-profile-id="${supplierId}" aria-label="Go to ${item.label}">
              <div class="spc-checklist-step-circle" aria-hidden="true">${
                item.complete
                  ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`
                  : `${i + 1}`
              }</div>
              <div class="spc-checklist-step-copy">
                <span class="spc-checklist-step-label">${item.label}</span>
                ${item.detail ? `<span class="spc-checklist-step-detail">${item.detail}</span>` : ''}
              </div>
            </button>
          `
            )
            .join('')}
        </div>
      </div>
    </div>`;
        })
        .join('');

      // Populate circular health score ring for each supplier card
      const rows = supWrap.querySelectorAll('.supplier-card');
      items.forEach((s, idx) => {
        if (!s) {
          return;
        }

        const row = rows[idx];
        if (!row) {
          return;
        }

        // Health score: prefer aiScore if set, otherwise use checklist-based score embedded in DOM
        const ringEl = row.querySelector('.spc-ring');
        const checklistScore = ringEl ? parseInt(ringEl.dataset.computedScore || '0', 10) : 0;
        const score = typeof s.aiScore === 'number' && s.aiScore > 0 ? s.aiScore : checklistScore;

        // Populate circular health score ring
        const RING_GOOD_THRESHOLD = 80;
        const RING_FAIR_THRESHOLD = 50;
        const ringScore = row.querySelector('.spc-ring-score');
        const ringFill = row.querySelector('.spc-ring-fill');
        const ringGrade = row.querySelector('.spc-ring-grade');
        if (ringScore && ringFill) {
          const RING_RADIUS = 32; // must match r="32" in the SVG circle + CSS stroke-dasharray comment
          const circumference = 2 * Math.PI * RING_RADIUS;
          const displayScore = score;
          const offset = circumference * (1 - displayScore / 100);
          ringFill.style.strokeDasharray = `${circumference}`;
          ringFill.style.strokeDashoffset = `${offset}`;
          ringScore.textContent = String(displayScore);
          ringScore.setAttribute('aria-label', `Health score: ${displayScore}`);
          if (ringGrade && ringEl) {
            if (displayScore >= RING_GOOD_THRESHOLD) {
              ringGrade.textContent = 'Good';
              ringEl.dataset.grade = 'good';
            } else if (displayScore >= RING_FAIR_THRESHOLD) {
              ringGrade.textContent = 'Fair';
              ringEl.dataset.grade = 'fair';
            } else {
              ringGrade.textContent = 'Poor';
              ringEl.dataset.grade = 'poor';
            }
          }
        }
      });

      supWrap.querySelectorAll('.supplier-profile-photo-upload').forEach(input => {
        if (input.dataset.bound === 'true') {
          return;
        }
        input.dataset.bound = 'true';
        input.addEventListener('change', async e => {
          const file = e.target.files && e.target.files[0];
          if (!file) {
            return;
          }
          const fd = new FormData();
          fd.append('avatar', file);
          try {
            const resp = await fetch('/api/profile/avatar', {
              method: 'POST',
              credentials: 'include',
              headers: { 'X-CSRF-Token': window.__CSRF_TOKEN__ || '' },
              body: fd,
            });
            const result = await resp.json().catch(() => ({}));
            if (!resp.ok) {
              throw new Error(result.error || 'Failed to upload profile photo');
            }
            // Bust the cached auth state so the next me() call fetches the updated avatarUrl
            if (window.AuthStateManager?.refresh) {
              await window.AuthStateManager.refresh();
            }
            await loadSuppliers();
          } catch (err) {
            console.error('Profile photo upload failed:', err);
            if (window.announceToSR) {
              window.announceToSR(err.message || 'Failed to upload profile photo');
            }
          } finally {
            e.target.value = '';
          }
        });
      });

      if (select) {
        select.innerHTML = items
          .filter(s => s && s.id && s.name)
          .map(s => `<option value="${s.id}">${s.name}</option>`)
          .join('');
        // Sync hidden supplierId input to the selected supplier
        const hiddenInput = document.getElementById('pkg-supplier-id-hidden');
        if (hiddenInput) {
          // Set initial value
          hiddenInput.value = select.value;
          // Keep in sync when the user changes the dropdown
          select.addEventListener('change', () => {
            hiddenInput.value = select.value;
          });
        }
      }

      // Auto-populate form with supplier's data
      // If we're currently editing a supplier, restore that supplier's data
      // Otherwise, populate with first supplier's data if exists
      if (items.length > 0) {
        let supplierToEdit = items[0];

        // If we have a currently editing supplier ID, find it and use it
        if (currentEditingSupplierId) {
          const foundSupplier = items.find(s => s && s.id === currentEditingSupplierId);
          if (foundSupplier) {
            supplierToEdit = foundSupplier;
          }
        }

        populateSupplierForm(supplierToEdit);

        // Single-profile enforcement: update button label and section heading
        // A supplier already has a profile — the button should say "Edit Profile"
        const toggleBtn = document.getElementById('toggle-profile-form');
        if (toggleBtn) {
          const labelSpan = toggleBtn.querySelector('.label');
          const profileFormSection = document.getElementById('profile-form-section');
          if (labelSpan && !profileFormSection?.classList.contains('expanded')) {
            labelSpan.textContent = 'Edit Profile';
          }
        }
        const sectionHeading = document.querySelector(
          '#profile-form-section .supplier-section-header'
        );
        if (sectionHeading) {
          sectionHeading.textContent = 'Edit Profile';
        }
        // Update the quick-action chip label to "Edit Profile" since only one profile is allowed
        const createProfileChip = document.querySelector('[data-action="create-profile"]');
        if (createProfileChip) {
          const chipSpan = createProfileChip.querySelector('span');
          if (chipSpan) {
            chipSpan.textContent = 'Edit Profile';
          }
          createProfileChip.setAttribute('data-action', 'edit-profile-chip');
        }
      }
    } catch (err) {
      console.error('Error loading suppliers:', err);
      if (supWrap) {
        supWrap.innerHTML =
          '<div class="sd-empty-state"><div class="sd-empty-state__icon" aria-hidden="true">⚠️</div><div class="sd-empty-state__body"><p class="sd-empty-state__title">Could not load profiles</p><p class="sd-empty-state__desc">Please refresh the page to try again.</p></div></div>';
      }
    }
  }

  /**
   * Populate supplier form with existing supplier data
   * @param {Object} supplier - Supplier data
   */
  function populateSupplierForm(supplier) {
    if (!supplier) {
      return;
    }

    // Track which supplier is being edited
    currentEditingSupplierId = supplier.id || null;

    // Basic fields
    const supId = document.getElementById('sup-id');
    const supName = document.getElementById('sup-name');
    const supCategory = document.getElementById('sup-category');
    const supLocation = document.getElementById('sup-location');
    const supShort = document.getElementById('sup-short');
    const supLong = document.getElementById('sup-long');
    const supWebsite = document.getElementById('sup-website');
    const supLicense = document.getElementById('sup-license');
    const supAmenities = document.getElementById('sup-amenities');
    const supMax = document.getElementById('sup-max');
    const supVenuePostcode = document.getElementById('sup-venue-postcode');

    if (supId) {
      supId.value = supplier.id || '';
    }
    if (supName) {
      supName.value = supplier.name || '';
    }
    if (supCategory) {
      supCategory.value = supplier.category || '';
    }
    if (supLocation) {
      supLocation.value = supplier.location || '';
    }
    if (supShort) {
      supShort.value = supplier.description_short || '';
    }
    if (supLong) {
      supLong.value = supplier.description_long || '';
    }
    if (supWebsite) {
      supWebsite.value = supplier.website || '';
    }
    if (supLicense) {
      supLicense.value = supplier.license || '';
    }
    if (supAmenities) {
      supAmenities.value = (supplier.amenities || []).join(', ');
    }
    if (supMax) {
      supMax.value = supplier.maxGuests || '';
    }
    if (supVenuePostcode) {
      supVenuePostcode.value = supplier.venuePostcode || '';
    }

    // Coverage: the postcode as typed, and the travel policy read back out of
    // the stored service areas so an edit never silently drops it.
    const supBasePostcode = document.getElementById('sup-base-postcode');
    const supTravelRadius = document.getElementById('sup-travel-radius');
    const supNationwide = document.getElementById('sup-travel-nationwide');
    const serviceAreas = Array.isArray(supplier.serviceAreas) ? supplier.serviceAreas : [];

    if (supBasePostcode) {
      supBasePostcode.value = supplier.basePostcode || '';
    }
    if (supTravelRadius) {
      const radius = serviceAreas.find(area => area && area.type === 'radius');
      supTravelRadius.value = radius && radius.miles ? radius.miles : '';
    }
    if (supNationwide) {
      supNationwide.checked = serviceAreas.some(area => area && area.type === 'nationwide');
    }

    // New customization fields
    const supBanner = document.getElementById('sup-banner');
    const supTagline = document.getElementById('sup-tagline');
    const supThemeColor = document.getElementById('sup-theme-color');
    const supThemeColorHex = document.getElementById('sup-theme-color-hex');

    if (supBanner) {
      supBanner.value = supplier.bannerUrl || '';
    }
    if (supTagline) {
      supTagline.value = supplier.tagline || '';
    }
    if (supThemeColor) {
      supThemeColor.value = supplier.themeColor || '#0B8073';
    }
    if (supThemeColorHex) {
      supThemeColorHex.value = supplier.themeColor || '#0B8073';
    }

    // Show existing banner image in preview if exists
    if (supplier.bannerUrl) {
      const bannerPreview = document.getElementById('sup-banner-preview');
      if (bannerPreview) {
        // Create image element safely to avoid XSS
        const imgDiv = document.createElement('div');
        imgDiv.className = 'photo-preview-item';
        imgDiv.classList.add('photo-preview-item-inner');

        const img = document.createElement('img');
        img.src = supplier.bannerUrl; // Browser automatically sanitizes
        img.alt = 'Banner preview';
        img.classList.add('photo-preview-img');
        img.addEventListener(
          'error',
          () => {
            if (img.dataset.errorHandled) {
              return;
            }
            img.dataset.errorHandled = '1';
            img.alt = 'Banner image unavailable';
            img.title = 'Could not load banner — upload a new one to replace it';
            imgDiv.style.background = '#f3f4f6';
            img.style.display = 'none';
            // Add ⚠ warning indicator — consistent with gallery error state
            imgDiv.classList.add('photo-preview-item__image-wrap--error');
          },
          { once: true }
        );

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'photo-preview-remove';
        removeBtn.setAttribute('aria-label', 'Remove banner image');
        removeBtn.textContent = '\u2715';
        removeBtn.addEventListener('click', () => {
          imgDiv.remove();
          const bannerInput = document.getElementById('sup-banner');
          if (bannerInput) {
            bannerInput.value = '';
          }
        });

        imgDiv.appendChild(img);
        imgDiv.appendChild(removeBtn);
        bannerPreview.innerHTML = ''; // Clear existing content
        bannerPreview.appendChild(imgDiv);
      }
    }

    // Populate highlights
    if (supplier.highlights && Array.isArray(supplier.highlights)) {
      supplier.highlights.forEach((highlight, index) => {
        const highlightInput = document.getElementById(`sup-highlight-${index + 1}`);
        if (highlightInput) {
          highlightInput.value = highlight;
        }
      });
    }

    // Populate featured services
    const supFeaturedServices = document.getElementById('sup-featured-services');
    if (supFeaturedServices && supplier.featuredServices) {
      supFeaturedServices.value = (supplier.featuredServices || []).join('\n');
    }

    // Populate social links
    if (supplier.socialLinks) {
      const platforms = ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok'];
      platforms.forEach(platform => {
        const input = document.getElementById(`sup-social-${platform}`);
        if (input && supplier.socialLinks[platform]) {
          input.value = supplier.socialLinks[platform];
        }
      });
    }

    // Show preview button if supplier has an ID
    const previewBtn = document.getElementById('sup-preview');
    if (previewBtn && supplier.id) {
      previewBtn.style.display = 'inline-block';
    }

    // Reload the supplier gallery photo tiles whenever the form is populated
    // with a supplier. This handles both the initial page load (where gallery.js
    // setup() runs before supplier data is fetched) and switching between suppliers.
    if (supplier.id && typeof window.loadSupplierGalleryPhotos === 'function') {
      window.loadSupplierGalleryPhotos(supplier.id);
    }
  }

  // Expose populateSupplierForm globally so editProfile() (defined outside this
  // closure) can delegate to it and benefit from the complete field population logic
  window._efPopulateSupplierForm = populateSupplierForm;

  async function loadPackages() {
    try {
      if (!pkgsWrap) {
        return;
      }
      const note = document.getElementById('pkg-limit-note');
      const d = await api('/api/me/packages');
      const items = d?.items && Array.isArray(d.items) ? d.items : [];
      // Only count active (non-paused) packages against the plan limit; paused packages
      // are preserved but don't occupy a slot, matching the server-side enforcement.
      const activeCount = items.filter(p => !p.paused).length;
      const freeLimit = 3; // keep in sync with server FREE_PACKAGE_LIMIT default

      // Update note about allowance
      if (note) {
        if (currentIsPro) {
          note.textContent = activeCount
            ? `You have ${activeCount} active package${activeCount === 1 ? '' : 's'}. As a Pro supplier you can create unlimited packages.`
            : 'As a Pro supplier you can create unlimited packages.';
        } else if (activeCount > freeLimit) {
          // Over-limit (e.g. after a downgrade): surface the excess clearly.
          const surplus = activeCount - freeLimit;
          note.textContent = `You have ${activeCount} active packages but your Starter plan allows ${freeLimit}. Pause or delete ${surplus} package${surplus === 1 ? '' : 's'} to stay within your limit, or upgrade.`;
        } else {
          note.textContent = activeCount
            ? `You have ${activeCount} of ${freeLimit} active packages on the Starter plan.`
            : `On the Starter plan you can create up to ${freeLimit} active packages.`;
        }
      }

      // Track whether the free tier package limit is reached.
      // Only block *creating* new packages — editing existing ones must remain allowed.
      const pkgForm = document.getElementById('package-form');
      const supplierBlocked = window._supplierProfileMissing || window._supplierApprovalBlocked;
      const supplierBlockMessage = window._supplierProfileMissing
        ? 'Complete your supplier profile setup before creating packages.'
        : 'Your supplier profile is pending approval. Package creation unlocks after approval.';
      const atLimit = !currentIsPro && activeCount >= freeLimit;
      // Expose globally so togglePackageForm() and editPackage() can reference it.
      window._pkgAtLimit = atLimit;
      // Store limit label text so togglePackageForm() can restore it after edit mode.
      window._pkgLimitLabel = atLimit
        ? `${activeCount}/${freeLimit} Active — Limit reached`
        : 'Create Package';

      // Update the "Create Package" toggle button to reflect the plan limit.
      const toggleBtn = document.getElementById('toggle-package-form');
      if (toggleBtn) {
        const labelEl = toggleBtn.querySelector('.label');
        // Only change the label when the form is collapsed (not in edit/cancel state).
        const formIsOpen =
          document.getElementById('package-form-section')?.classList.contains('expanded') ?? false;
        if (!formIsOpen) {
          if (atLimit) {
            toggleBtn.disabled = true;
            toggleBtn.classList.add('form-toggle-btn--at-limit');
            toggleBtn.setAttribute(
              'aria-label',
              `Package limit reached: ${activeCount} of ${freeLimit} active. Upgrade to create more.`
            );
            toggleBtn.title = `You've reached your ${freeLimit}-package limit. Pause or delete a package, or upgrade your plan.`;
            if (labelEl) {
              labelEl.textContent = window._pkgLimitLabel;
            }
          } else if (supplierBlocked) {
            toggleBtn.disabled = true;
            toggleBtn.classList.add('form-toggle-btn--at-limit');
            toggleBtn.setAttribute('aria-label', supplierBlockMessage);
            toggleBtn.title = supplierBlockMessage;
            if (labelEl) {
              // Explicitly say "Profile" here — this button sits inside the
              // Packages card, and existing approved packages may already be
              // listed below it, so an unqualified "Pending approval" reads
              // as if the packages themselves are pending rather than the
              // profile that gates *creating new ones*.
              labelEl.textContent = window._supplierProfileMissing
                ? 'Profile setup needed'
                : 'Profile pending approval';
            }
          } else {
            toggleBtn.disabled = false;
            toggleBtn.classList.remove('form-toggle-btn--at-limit');
            toggleBtn.setAttribute('aria-label', 'Toggle package creation form');
            toggleBtn.title = '';
            if (labelEl) {
              labelEl.textContent = 'Create Package';
            }
          }
        }
        // Show or hide upgrade CTA alongside the button.
        let upgradeCta = document.getElementById('pkg-upgrade-cta');
        if (atLimit) {
          if (!upgradeCta) {
            upgradeCta = document.createElement('a');
            upgradeCta.id = 'pkg-upgrade-cta';
            upgradeCta.href = '/supplier/subscription.html';
            upgradeCta.className = 'pkg-upgrade-link';
            upgradeCta.textContent = 'Upgrade plan';
            toggleBtn.insertAdjacentElement('afterend', upgradeCta);
          }
          upgradeCta.style.display = 'inline-flex';
        } else if (upgradeCta) {
          upgradeCta.style.display = 'none';
        }
      }

      if (pkgForm) {
        // Determine whether the form is currently in edit mode (has a package ID).
        const editingId = document.getElementById('pkg-id-hidden')?.value;
        const isEditMode = !!editingId;

        // Only apply the limit restriction when in create mode.
        const shouldDisable = (atLimit || supplierBlocked) && !isEditMode;
        setPkgFormDisabled(shouldDisable, supplierBlocked ? supplierBlockMessage : undefined);
      }

      if (!items || items.length === 0) {
        pkgsWrap.innerHTML =
          '<div class="sd-empty-state"><div class="sd-empty-state__icon" aria-hidden="true">📦</div><div class="sd-empty-state__body"><p class="sd-empty-state__title">No packages yet</p><p class="sd-empty-state__desc">Create your first package to showcase your services and pricing.</p></div></div>';
        return;
      }
      pkgsWrap.innerHTML = items
        .map(p => {
          if (!p) {
            return '';
          }

          const packageId = String(p.id || '').replace(/"/g, '&quot;');
          const image = String(p.image || '/assets/images/package-placeholder.svg');
          const title = String(p.title || 'Untitled Package');
          const priceDisplay = String(p.price_display || '');
          const description = String(p.description || '');
          const featured = !!p.featured;
          const approved = !!p.approved;
          const paused = !!p.paused;
          const slug = String(p.slug || '').replace(/"/g, '&quot;');

          const approvalBadge = approved
            ? ''
            : '<span class="badge badge-pending" title="This package is awaiting admin approval before it appears publicly">Awaiting review</span>';
          const pausedBadge = paused
            ? '<span class="badge badge-paused" title="This package is paused and not visible publicly">Paused</span>'
            : '';
          // Package price chip — only rendered when a price exists, so no empty pill appears
          const priceBadgeHtml = priceDisplay
            ? `<span class="badge pkg-price-badge">${escapeHtml(priceDisplay)}</span>`
            : '';
          // A package with no public page still gets a View control, disabled and
          // explaining itself. Dropping the button entirely left one card in the
          // row a button short, with nothing to say why it could not be viewed.
          const viewUnavailableReason = !approved
            ? 'This package has no public page yet — it is awaiting admin approval'
            : 'This package has no public page yet';
          const viewBtn =
            approved && slug
              ? `<a href="/package?slug=${slug}" target="_blank" class="ef-cta card-action-btn view-btn">View</a>`
              : `<button type="button" class="ef-cta card-action-btn view-btn" disabled aria-disabled="true" title="${viewUnavailableReason}">View</button>`;
          const pauseBtn = `<button type="button" class="ef-cta card-action-btn ${paused ? 'unpause-btn' : 'pause-btn'}" data-action="${paused ? 'unpause-package' : 'pause-package'}" data-package-id="${packageId}" aria-label="${paused ? 'Unpause package' : 'Pause package'}">${paused ? '<svg width="10" height="11" viewBox="0 0 10 11" fill="currentColor" aria-hidden="true"><polygon points="0,0 10,5.5 0,11"/></svg> Resume' : '<svg width="10" height="11" viewBox="0 0 10 11" fill="currentColor" aria-hidden="true"><rect x="0" y="0" width="3.5" height="11" rx="0.75"/><rect x="6.5" y="0" width="3.5" height="11" rx="0.75"/></svg> Pause'}</button>`;

          return `<div class="card package-card${paused ? ' package-card--paused' : ''}" data-package-id="${packageId}">
      <img src="${image}" alt="${title} image" data-fallback-src="/assets/images/package-placeholder.svg">
      <div class="package-card-content">
        <h3>${title}</h3>
        <div class="small">${priceBadgeHtml} ${featured ? '<span class="badge badge-featured">Featured</span>' : ''} ${approvalBadge} ${pausedBadge}</div>
        <p class="small">${description}</p>
        <div class="card-actions">
          <button type="button" class="ef-cta card-action-btn edit-btn" data-action="edit-package" data-package-id="${packageId}">Edit</button>
          ${viewBtn}
          ${pauseBtn}
          <button type="button" class="ef-cta card-action-btn delete-btn" data-action="delete-package" data-package-id="${packageId}">Delete</button>
        </div>
      </div>
    </div>`;
        })
        .join('');
    } catch (err) {
      console.error('Error loading packages:', err);
      if (pkgsWrap) {
        if (err.code === 'SUPPLIER_PROFILE_MISSING') {
          pkgsWrap.innerHTML =
            '<div class="sd-empty-state"><div class="sd-empty-state__icon" aria-hidden="true">👤</div><div class="sd-empty-state__body"><p class="sd-empty-state__title">Supplier profile setup needed</p><p class="sd-empty-state__desc">Complete your supplier profile setup before creating packages.</p><a class="sd-empty-state__cta" href="#profile-form" data-action="open-profile-form">Complete supplier profile →</a></div></div>';
        } else if (err.code === 'SUPPLIER_NOT_APPROVED') {
          pkgsWrap.innerHTML =
            '<div class="sd-empty-state"><div class="sd-empty-state__icon" aria-hidden="true">⏳</div><div class="sd-empty-state__body"><p class="sd-empty-state__title">Profile pending approval</p><p class="sd-empty-state__desc">Your supplier profile is awaiting admin approval. Package creation unlocks after approval.</p></div></div>';
        } else {
          pkgsWrap.innerHTML =
            '<div class="sd-empty-state"><div class="sd-empty-state__icon" aria-hidden="true">⚠️</div><div class="sd-empty-state__body"><p class="sd-empty-state__title">Could not load packages</p><p class="sd-empty-state__desc">Please refresh the page to try again.</p></div></div>';
        }
      }
    }
  }
  // Expose loadPackages globally so togglePackagePause() (defined outside this
  // closure) can refresh the package list after a pause/unpause operation.
  window._efLoadPackages = loadPackages;

  await loadSuppliers();
  await loadPackages();

  // Initialize package form toggle
  const togglePackageFormBtn = document.getElementById('toggle-package-form');
  if (togglePackageFormBtn) {
    togglePackageFormBtn.addEventListener('click', togglePackageForm);
  }

  const cancelPackageFormBtn = document.getElementById('cancel-package-form');
  if (cancelPackageFormBtn) {
    cancelPackageFormBtn.addEventListener('click', togglePackageForm);
  }

  // Initialize profile form toggle
  const toggleProfileFormBtn = document.getElementById('toggle-profile-form');
  if (toggleProfileFormBtn) {
    toggleProfileFormBtn.addEventListener('click', toggleProfileForm);
  }

  const cancelProfileFormBtn = document.getElementById('cancel-profile-form');
  if (cancelProfileFormBtn) {
    cancelProfileFormBtn.addEventListener('click', toggleProfileForm);
  }

  // Add event delegation for Edit/Delete buttons on packages and profiles
  // Guard against duplicate bindings if supplier dashboard init runs more than once.
  if (!window.__efSupplierDashboardActionsBound) {
    window.__efSupplierDashboardActionsBound = true;
    document.addEventListener('click', async e => {
      const target = e.target;
      const actionEl = target.closest
        ? target.closest('[data-action], .spc-checklist-step[data-checklist-target]')
        : null;
      try {
        // Handle package edit buttons
        if (actionEl && actionEl.matches('[data-action="edit-package"]')) {
          const packageId = actionEl.getAttribute('data-package-id');
          if (packageId) {
            editPackage(packageId);
          }
        }

        // Handle package delete buttons
        if (actionEl && actionEl.matches('[data-action="delete-package"]')) {
          const packageId = actionEl.getAttribute('data-package-id');
          if (packageId) {
            deletePackage(packageId);
          }
        }

        // Handle package pause buttons
        if (actionEl && actionEl.matches('[data-action="pause-package"]')) {
          const packageId = actionEl.getAttribute('data-package-id');
          if (packageId) {
            togglePackagePause(packageId, true);
          }
        }

        // Handle package unpause buttons
        if (actionEl && actionEl.matches('[data-action="unpause-package"]')) {
          const packageId = actionEl.getAttribute('data-package-id');
          if (packageId) {
            togglePackagePause(packageId, false);
          }
        }

        // Handle profile edit buttons
        if (actionEl && actionEl.matches('[data-action="edit-profile"]')) {
          const profileId = actionEl.getAttribute('data-profile-id');
          if (profileId) {
            editProfile(profileId);
          }
        }

        // Handle Upload Photo button — expand form, scroll to gallery section, and open file picker
        if (actionEl && actionEl.matches('[data-action="upload-photo"]')) {
          const profileId = actionEl.getAttribute('data-profile-id');
          if (profileId) {
            try {
              await editProfile(profileId, { skipFormScroll: true });
            } catch (err) {
              console.error('Failed to prepare profile form for photo upload:', err);
              return;
            }
          }
          const profileFormSection = document.getElementById('profile-form-section');
          if (profileFormSection) {
            if (!profileFormSection.classList.contains('expanded')) {
              profileFormSection.classList.add('expanded');
            }
            profileFormSection.removeAttribute('hidden');
          }
          const uploader = document.getElementById('sup-photo-drop');
          if (uploader) {
            const galleryRow = uploader.closest('.form-row') || uploader;
            galleryRow.style.scrollMarginTop = '96px';
            if (!uploader.hasAttribute('tabindex')) {
              uploader.setAttribute('tabindex', '-1');
            }
            galleryRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
            if (typeof uploader.focus === 'function') {
              uploader.focus({ preventScroll: true });
            }
            if (uploader.dataset.pickerOpening === 'true') {
              return;
            }
            uploader.dataset.pickerOpening = 'true';
            const AUTO_OPEN_PICKER_DELAY_MS = 320; // allow smooth-scroll/focus to complete before opening picker
            setTimeout(() => {
              if (typeof window.openSupplierGalleryPicker === 'function') {
                window.openSupplierGalleryPicker();
              } else {
                uploader.click();
              }
              delete uploader.dataset.pickerOpening;
            }, AUTO_OPEN_PICKER_DELAY_MS);
          }
        }

        // Handle View Checklist button — toggles checklist visibility for this profile
        if (actionEl && actionEl.matches('[data-action="view-checklist"]')) {
          const profileId = actionEl.getAttribute('data-profile-id');
          const checklistCard = profileId
            ? document.getElementById(`spc-checklist-${profileId}`)
            : null;
          if (checklistCard) {
            const label = actionEl.querySelector('.spc-checklist-btn-label');
            const isHidden = checklistCard.hasAttribute('hidden');
            if (isHidden) {
              checklistCard.removeAttribute('hidden');
              actionEl.setAttribute('aria-expanded', 'true');
              if (label) {
                label.textContent = 'Hide Checklist';
              }
              checklistCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
              checklistCard.setAttribute('hidden', '');
              actionEl.setAttribute('aria-expanded', 'false');
              if (label) {
                label.textContent = 'View Checklist';
              }
            }
          } else {
            // Fallback: expand and scroll to profile form section
            const profileFormSection = document.getElementById('profile-form-section');
            if (profileFormSection) {
              if (!profileFormSection.classList.contains('expanded')) {
                profileFormSection.classList.add('expanded');
                profileFormSection.removeAttribute('hidden');
              }
              profileFormSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }
        }

        // Handle checklist step click — jump directly to the relevant profile field/section
        if (actionEl && actionEl.matches('.spc-checklist-step[data-checklist-target]')) {
          const profileId = actionEl.getAttribute('data-profile-id');
          const checklistTargetId = actionEl.getAttribute('data-checklist-target');
          if (profileId) {
            await editProfile(profileId, { skipFormScroll: true });
          }
          const profileFormSection = document.getElementById('profile-form-section');
          if (profileFormSection) {
            profileFormSection.classList.add('expanded');
            profileFormSection.removeAttribute('hidden');
          }
          const targetField = checklistTargetId ? document.getElementById(checklistTargetId) : null;
          const fallbackTarget = document.getElementById('supplier-form');
          const scrollTarget = targetField || fallbackTarget;
          if (scrollTarget) {
            scrollTarget.style.scrollMarginTop = '96px';
            scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
            if (
              typeof scrollTarget.focus === 'function' &&
              checklistTargetId &&
              checklistTargetId !== 'package-form'
            ) {
              scrollTarget.focus({ preventScroll: true });
            }
          }
        }

        // Handle profile photo delete button
        if (actionEl && actionEl.matches('[data-action="delete-profile-photo"]')) {
          if (actionEl.dataset.busy === 'true') {
            return;
          }
          if (!confirm('Remove your profile photo?')) {
            return;
          }
          actionEl.dataset.busy = 'true';
          actionEl.setAttribute('aria-disabled', 'true');
          actionEl.disabled = true;
          actionEl.title = 'Removing profile photo…';
          try {
            const resp = await fetch('/api/profile/avatar', {
              method: 'DELETE',
              credentials: 'include',
              headers: { 'X-CSRF-Token': window.__CSRF_TOKEN__ || '' },
            });
            const result = await resp.json().catch(() => ({}));
            if (!resp.ok) {
              throw new Error(result.error || 'Failed to delete profile photo');
            }
            if (window.AuthStateManager?.refresh) {
              await window.AuthStateManager.refresh();
            }
            await loadSuppliers();
            if (window.announceToSR) {
              window.announceToSR('Profile photo removed');
            }
          } catch (err) {
            console.error('Profile photo delete failed:', err);
            if (window.announceToSR) {
              window.announceToSR(err.message || 'Failed to delete profile photo');
            }
          } finally {
            delete actionEl.dataset.busy;
            if (actionEl.isConnected) {
              actionEl.removeAttribute('aria-disabled');
              actionEl.disabled = false;
              actionEl.title = 'Delete profile photo';
            }
          }
        }

        // Handle profile delete buttons
        if (actionEl && actionEl.matches('[data-action="delete-profile"]')) {
          const profileId = actionEl.getAttribute('data-profile-id');
          if (profileId) {
            deleteProfile(profileId);
          }
        }

        // Handle gallery photo delete buttons
        const pkgDeleteBtn = target.closest ? target.closest('.pkg-gallery-delete') : null;
        if (pkgDeleteBtn) {
          const photoUrl = pkgDeleteBtn.getAttribute('data-url');
          const packageId = pkgDeleteBtn.getAttribute('data-package-id');
          if (photoUrl && packageId) {
            deletePackagePhoto(packageId, photoUrl, pkgDeleteBtn);
          }
        }

        // Handle gallery save-order button
        if (target.matches('#pkg-gallery-save-order')) {
          savePkgGalleryOrder();
        }

        // Handle supplier gallery save-order button
        if (target.matches('#sup-gallery-save-order')) {
          if (typeof window.saveSupplierGalleryOrder === 'function') {
            window.saveSupplierGalleryOrder();
          }
        }
      } catch (err) {
        console.error('Dashboard action handler error:', err);
      }
    });
    document.addEventListener('keydown', e => {
      const target = e.target;
      const checklistStep = target?.closest
        ? target.closest('.spc-checklist-step[data-checklist-target]')
        : null;
      if (!checklistStep) {
        return;
      }
      if (e.key !== 'Enter' && e.key !== ' ') {
        return;
      }
      e.preventDefault();
      checklistStep.click();
    });
  }

  /**
   * Translate the coverage controls into the service-area shape the API stores.
   *
   * Suppliers are asked two plain questions — how far they travel, and whether
   * they cover the whole UK — rather than being asked to think in service
   * areas. The API re-validates whatever arrives, so this is only a translation.
   * @param {Object} payload - Supplier payload, modified in place.
   */
  function applyCoverageToPayload(payload) {
    const radiusInput = document.getElementById('sup-travel-radius');
    const nationwideInput = document.getElementById('sup-travel-nationwide');

    if (radiusInput || nationwideInput) {
      const existingSupplier = cachedSuppliers.find(
        supplier => supplier && supplier.id === currentEditingSupplierId
      );
      // Explicit city coverage is assigned outside this form. Preserve it while
      // translating the radius/nationwide controls that suppliers can edit.
      const serviceAreas = Array.isArray(existingSupplier?.serviceAreas)
        ? existingSupplier.serviceAreas.filter(area => area && area.type === 'city')
        : [];
      const radiusMiles = Number(payload.travelRadiusMiles);
      if (Number.isFinite(radiusMiles) && radiusMiles > 0) {
        serviceAreas.push({ type: 'radius', miles: Math.min(200, Math.round(radiusMiles)) });
      }
      if (nationwideInput && nationwideInput.checked) {
        serviceAreas.push({ type: 'nationwide' });
      }
      payload.serviceAreas = serviceAreas;
    }

    delete payload.travelRadiusMiles;
    delete payload.travelNationwide;
  }

  function buildSupplierPayload(form) {
    const fd = new FormData(form);
    const payload = {};
    fd.forEach((v, k) => (payload[k] = v));
    // Collect highlights
    const highlights = [];
    for (let i = 1; i <= 5; i++) {
      const h = document.getElementById(`sup-highlight-${i}`);
      if (h && h.value.trim()) {
        highlights.push(h.value.trim());
      }
    }
    if (highlights.length > 0) {
      payload.highlights = highlights;
    }
    // Collect featured services
    const fsInput = document.getElementById('sup-featured-services');
    if (fsInput && fsInput.value.trim()) {
      const services = fsInput.value
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 10);
      if (services.length > 0) {
        payload.featuredServices = services;
      }
    }
    // Collect social links
    const socialLinks = {};
    ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok'].forEach(p => {
      const inp = document.getElementById(`sup-social-${p}`);
      if (inp && inp.value.trim()) {
        socialLinks[p] = inp.value.trim();
      }
    });
    if (Object.keys(socialLinks).length > 0) {
      payload.socialLinks = socialLinks;
    }
    // Theme color
    const tc = document.getElementById('sup-theme-color');
    if (tc && tc.value) {
      payload.themeColor = tc.value;
    }
    // Normalize website URL: prepend https:// if a scheme is missing
    if (payload.website) {
      const ws = payload.website.trim();
      payload.website = ws && !/^https?:\/\//i.test(ws) ? `https://${ws}` : ws;
    }
    applyCoverageToPayload(payload);
    return payload;
  }

  let supplierStatusClearTimer = null;
  function clearSupplierStatusTimer() {
    if (supplierStatusClearTimer) {
      clearTimeout(supplierStatusClearTimer);
      supplierStatusClearTimer = null;
    }
  }

  function scheduleSupplierStatusClear(statusEl, ms) {
    if (!statusEl || !ms) {
      return;
    }
    clearSupplierStatusTimer();
    supplierStatusClearTimer = setTimeout(() => {
      statusEl.textContent = '';
      statusEl.removeAttribute('data-tone');
      statusEl.style.color = '';
      supplierStatusClearTimer = null;
    }, ms);
  }

  function setSupplierFieldError(fieldEl, errorEl, message) {
    if (fieldEl) {
      fieldEl.setAttribute('aria-invalid', 'true');
      fieldEl.classList.add('supplier-field-invalid');
    }
    if (errorEl) {
      errorEl.textContent = message || '';
      errorEl.classList.toggle('visible', Boolean(message));
      errorEl.setAttribute('aria-hidden', message ? 'false' : 'true');
    }
  }

  function clearSupplierFieldError(fieldEl, errorEl) {
    if (fieldEl) {
      fieldEl.setAttribute('aria-invalid', 'false');
      fieldEl.classList.remove('supplier-field-invalid');
    }
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.remove('visible');
      errorEl.setAttribute('aria-hidden', 'true');
    }
  }

  function normalizeAndValidateWebsiteInput(inputEl) {
    if (!inputEl) {
      return { ok: true, value: '' };
    }
    const raw = (inputEl.value || '').trim();
    if (!raw) {
      inputEl.value = '';
      return { ok: true, value: '' };
    }
    if (/\s/.test(raw)) {
      return { ok: false, value: raw };
    }
    const hasHttpScheme = /^https?:\/\//i.test(raw);
    const normalized = hasHttpScheme ? raw : `https://${raw.replace(/^\/+/, '')}`;
    let parsed;
    try {
      parsed = new URL(normalized);
    } catch {
      return { ok: false, value: raw };
    }
    if (!/^https?:$/i.test(parsed.protocol)) {
      return { ok: false, value: raw };
    }
    // For no-scheme input, require a plausible host shape (domain, localhost, or IPv4).
    if (!hasHttpScheme) {
      const host = (parsed.hostname || '').toLowerCase();
      const isLikelyDomain = host.includes('.');
      const isLocalhost = host === 'localhost';
      const isIPv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
      if (!host || (!isLikelyDomain && !isLocalhost && !isIPv4)) {
        return { ok: false, value: raw };
      }
    }
    inputEl.value = normalized;
    return { ok: true, value: normalized };
  }

  const supForm = document.getElementById('supplier-form');
  if (supForm) {
    supForm.addEventListener('submit', async e => {
      e.preventDefault();
      const saveBtn = supForm.querySelector('button[type="submit"]');

      if (saveBtn && saveBtn.disabled) {
        return;
      }
      const originalSaveBtnText = saveBtn ? saveBtn.textContent : '';

      if (typeof window.validateVenuePostcode === 'function') {
        if (!window.validateVenuePostcode()) {
          return; // Stop submission if validation fails
        }
      }

      if (typeof window.validateBasePostcode === 'function') {
        if (!window.validateBasePostcode()) {
          return;
        }
      }

      // JS validation for required fields (novalidate disables browser validation)
      const statusEl = document.getElementById('sup-status');
      const nameEl = supForm.querySelector('#sup-name');
      const categoryEl = supForm.querySelector('#sup-category');
      const websiteEl = supForm.querySelector('#sup-website');
      const nameErrorEl = supForm.querySelector('#sup-name-error');
      const categoryErrorEl = supForm.querySelector('#sup-category-error');
      const websiteErrorEl = supForm.querySelector('#sup-website-error');
      clearSupplierFieldError(nameEl, nameErrorEl);
      clearSupplierFieldError(categoryEl, categoryErrorEl);
      clearSupplierFieldError(websiteEl, websiteErrorEl);
      if (!nameEl || !nameEl.value.trim()) {
        setSupplierFieldError(nameEl, nameErrorEl, 'Business name is required.');
        if (statusEl) {
          clearSupplierStatusTimer();
          statusEl.setAttribute('data-tone', 'error');
          statusEl.textContent = 'Business name is required.';
          statusEl.style.color = '#ef4444';
          scheduleSupplierStatusClear(statusEl, 5000);
        }
        if (nameEl) {
          nameEl.focus();
        }
        return;
      }
      if (!categoryEl || !categoryEl.value) {
        setSupplierFieldError(categoryEl, categoryErrorEl, 'Please select a category.');
        if (statusEl) {
          clearSupplierStatusTimer();
          statusEl.setAttribute('data-tone', 'error');
          statusEl.textContent = 'Please select a category.';
          statusEl.style.color = '#ef4444';
          scheduleSupplierStatusClear(statusEl, 5000);
        }
        if (categoryEl) {
          categoryEl.focus();
        }
        return;
      }
      const websiteCheck = normalizeAndValidateWebsiteInput(websiteEl);
      if (!websiteCheck.ok) {
        setSupplierFieldError(
          websiteEl,
          websiteErrorEl,
          'Please enter a valid website (for example: https://example.com, www.example.com, or example.com).'
        );
        if (statusEl) {
          clearSupplierStatusTimer();
          statusEl.setAttribute('data-tone', 'error');
          statusEl.textContent = 'Please fix the website URL and try again.';
          statusEl.style.color = '#ef4444';
          scheduleSupplierStatusClear(statusEl, 5000);
        }
        if (websiteEl) {
          websiteEl.focus();
        }
        return;
      }

      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.setAttribute('aria-disabled', 'true');
        saveBtn.classList.add('is-loading');
        saveBtn.textContent = 'Saving…';
      }
      supForm.setAttribute('aria-busy', 'true');
      try {
        // Ensure CSRF token is available
        const csrfToken = await ensureCsrfToken();

        const payload = buildSupplierPayload(supForm);

        // Remove venuePostcode if not Venues category
        if (payload.category !== 'Venues') {
          delete payload.venuePostcode;
        }

        const id = (payload.id || '').toString().trim();
        const path = id ? `/api/me/suppliers/${encodeURIComponent(id)}` : '/api/me/suppliers';
        const method = id ? 'PATCH' : 'POST';

        if (statusEl) {
          clearSupplierStatusTimer();
          statusEl.setAttribute('data-tone', 'info');
          statusEl.textContent = 'Saving...';
          statusEl.style.color = '#667085';
        }

        const response = await api(path, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify(payload),
        });

        // Determine the saved supplier ID (use server response for new profiles)
        const savedId =
          response && response.supplier && response.supplier.id ? response.supplier.id : id;

        // Guard: all successful saves should resolve to a usable supplier ID.
        if (!savedId) {
          if (statusEl) {
            clearSupplierStatusTimer();
            statusEl.setAttribute('data-tone', 'error');
            statusEl.textContent = 'Error: Save did not return a supplier ID. Please try again.';
            statusEl.style.color = '#ef4444';
            scheduleSupplierStatusClear(statusEl, 8000);
          }
          return;
        }

        // Update currently editing supplier ID with the saved/created ID
        currentEditingSupplierId = savedId;
        // Also update the hidden ID field so subsequent saves use PATCH
        const supIdField = document.getElementById('sup-id');
        if (supIdField && !supIdField.value) {
          supIdField.value = savedId;
        }

        // Upload any pending gallery photos now that we have a valid supplier ID
        if (typeof window.uploadPendingGalleryPhotos === 'function') {
          try {
            await window.uploadPendingGalleryPhotos(savedId);
          } catch (photoErr) {
            console.error('Photo upload error (profile saved):', photoErr);
            if (statusEl) {
              statusEl.setAttribute('data-tone', 'warning');
              statusEl.textContent = 'Warning: Profile saved but some photos failed to upload';
              statusEl.style.color = '#f59e0b';
              scheduleSupplierStatusClear(statusEl, 5000);
            }
            // Don't rethrow — the profile save succeeded
            await loadSuppliers();
            return;
          }
        }

        await loadSuppliers();

        if (statusEl) {
          statusEl.setAttribute('data-tone', 'success');
          statusEl.textContent = '✓ Saved successfully';
          statusEl.style.color = '#10b981';
          scheduleSupplierStatusClear(statusEl, 3000);
        }
      } catch (err) {
        console.error('Error saving supplier:', err);
        if (statusEl) {
          statusEl.setAttribute('data-tone', 'error');
          statusEl.textContent = `Error: ${err.message || 'Please try again'}`;
          statusEl.style.color = '#ef4444';
          scheduleSupplierStatusClear(statusEl, 8000);
        }
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.removeAttribute('aria-disabled');
          saveBtn.classList.remove('is-loading');
          saveBtn.textContent = originalSaveBtnText || 'Save profile';
        }
        supForm.setAttribute('aria-busy', 'false');
      }
    });
  }

  // Preview button handler
  const previewBtn = document.getElementById('sup-preview');
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      const statusEl = document.getElementById('sup-status');
      const saveBtn = document.getElementById('sup-create');
      const isSaving = Boolean(saveBtn?.disabled);
      if (isSaving) {
        if (statusEl) {
          clearSupplierStatusTimer();
          statusEl.setAttribute('data-tone', 'warning');
          statusEl.textContent = 'Please wait for the current save to finish before previewing.';
          statusEl.style.color = '#b45309';
          scheduleSupplierStatusClear(statusEl, 4500);
        }
        return;
      }
      const supplierIdInput = document.getElementById('sup-id');
      if (supplierIdInput && supplierIdInput.value) {
        const supplier = (window._efCachedSuppliers || []).find(
          item => String(item.id) === String(supplierIdInput.value)
        );
        if (supplier?.publicProfilePath) {
          window.open(`${supplier.publicProfilePath}?preview=true`, '_blank');
          return;
        }
        if (statusEl) {
          clearSupplierStatusTimer();
          statusEl.setAttribute('data-tone', 'warning');
          statusEl.textContent = 'A public profile link is not available yet.';
          statusEl.style.color = '#b45309';
          scheduleSupplierStatusClear(statusEl, 4500);
        }
      } else {
        if (statusEl) {
          clearSupplierStatusTimer();
          statusEl.setAttribute('data-tone', 'warning');
          statusEl.textContent = 'Please save your profile first before previewing.';
          statusEl.style.color = '#b45309';
          scheduleSupplierStatusClear(statusEl, 4500);
        }
        if (saveBtn) {
          saveBtn.focus();
        }
      }
    });
  }

  const pkgForm = document.getElementById('package-form');
  if (pkgForm) {
    pkgForm.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(pkgForm);
      const payload = {};
      fd.forEach((v, k) => {
        if (k === 'eventTypes') {
          // Handle checkbox array for eventTypes
          if (!payload.eventTypes) {
            payload.eventTypes = [];
          }
          payload.eventTypes.push(v);
        } else {
          payload[k] = v;
        }
      });

      // Ensure supplierId is set from the dropdown when creating a new package
      if (!payload.supplierId) {
        const supplierSelect = document.getElementById('pkg-supplier');
        if (supplierSelect && supplierSelect.value) {
          payload.supplierId = supplierSelect.value;
        }
      }

      // Validate required fields
      if (!payload.primaryCategoryKey) {
        alert('Please select a primary category');
        return;
      }
      if (!payload.eventTypes || payload.eventTypes.length === 0) {
        alert('Please select at least one event type.');
        return;
      }
      if (!payload.price || !String(payload.price).trim()) {
        alert('Please enter a price for this package.');
        return;
      }

      const id = payload.id;
      const path = id ? `/api/me/packages/${encodeURIComponent(id)}` : '/api/me/packages';
      const method = id ? 'PUT' : 'POST';

      // Belt-and-suspenders: block *creation* if free tier package limit is reached.
      // Although the submit button is already disabled by setPkgFormDisabled(), this
      // guard also prevents programmatic form submissions from bypassing the limit.
      // Editing an existing package (id is set) always bypasses this check.
      if (window._pkgAtLimit && !id) {
        alert(PKG_LIMIT_MESSAGE);
        return;
      }

      const saveBtn = pkgForm.querySelector('button[type="submit"]');
      const origLabel = saveBtn ? saveBtn.textContent : '';
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
      }

      try {
        await api(path, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        await loadPackages();
        alert('Saved package.');
        pkgForm.reset();

        // Clear photo preview and hidden image input so old images don't bleed into new packages
        const pkgPhotoPreviewEl = document.getElementById('pkg-photo-preview');
        if (pkgPhotoPreviewEl) {
          pkgPhotoPreviewEl.innerHTML = '';
        }
        const pkgImageEl = document.getElementById('pkg-image');
        if (pkgImageEl) {
          pkgImageEl.value = '';
        }

        const galleryExisting = document.getElementById('pkg-gallery-existing');
        if (galleryExisting) {
          galleryExisting.innerHTML = '';
          galleryExisting.style.display = 'none';
        }
        const galleryRow = document.getElementById('pkg-gallery-row');
        if (galleryRow) {
          galleryRow.style.display = 'none';
        }

        // Form has been reset to create mode. Re-apply limit restrictions if needed
        // so the user cannot immediately attempt to create a new package over the limit.
        if (window._pkgAtLimit) {
          setPkgFormDisabled(true);
        }
      } catch (err) {
        if (err.code === 'SUPPLIER_PROFILE_MISSING') {
          alert('Complete your supplier profile setup before creating packages.');
        } else if (err.code === 'SUPPLIER_NOT_APPROVED') {
          alert(
            'Your supplier profile is pending approval. Package creation unlocks after approval.'
          );
        } else {
          alert(`Error saving package: ${err.message || 'Please try again'}`);
        }
      } finally {
        if (saveBtn) {
          // Restore button label. Only re-enable if NOT at the package limit:
          // pkgForm.reset() already cleared pkg-id-hidden, returning to create mode,
          // and setPkgFormDisabled(true) above re-applied the limit restriction.
          if (!window._pkgAtLimit) {
            saveBtn.disabled = false;
          }
          saveBtn.textContent = origLabel;
        }
      }
    });
  }

  // Banner image upload
  efSetupPhotoDropZone(
    'sup-banner-drop',
    'sup-banner-preview',
    dataUrl => {
      const input = document.getElementById('sup-banner');
      if (!input) {
        return;
      }
      input.value = dataUrl;
    },
    () => {
      const input = document.getElementById('sup-banner');
      if (input) {
        input.value = '';
      }
    }
  );

  efSetupPhotoDropZone(
    'pkg-photo-drop',
    'pkg-photo-preview',
    dataUrl => {
      const input = document.getElementById('pkg-image');
      if (!input) {
        return;
      }
      input.value = dataUrl;
    },
    () => {
      const input = document.getElementById('pkg-image');
      if (input) {
        input.value = '';
      }
    }
  );

  // Supplier billing card
  (async () => {
    const host = document.getElementById('supplier-billing-card');
    if (!host) {
      return;
    }
    try {
      const r = await fetch('/api/v1/billing/config');
      if (!r.ok) {
        host.innerHTML = '<p class="small">Billing status is currently unavailable.</p>';
        return;
      }
      const data = await r.json();
      if (!data.enabled) {
        host.innerHTML =
          '<p class="small">Card payments and subscriptions are not set up yet. Ask your EventFlow admin to connect Stripe.</p>';
        return;
      }

      if (currentIsPro) {
        host.innerHTML = `
          <p class="small"><strong>You're on EventFlow Pro.</strong> Thank you for supporting the platform.</p>
          <p class="tiny" style="opacity:0.8;margin-top:4px">If you need to change your subscription or billing details, use the billing emails from Stripe or contact EventFlow support.</p>
        `;
        return;
      }

      host.innerHTML = `
        <p class="small">Upgrade to a paid plan to unlock extra visibility and insights.</p>
        <ul class="small" style="margin-bottom:8px">
          <li>Boosted placement in search results</li>
          <li>Unlimited packages</li>
          <li>Priority support</li>
        </ul>
        <div class="form-actions">
          <button class="cta" type="button" id="billing-upgrade-btn">Upgrade with Stripe</button>
          <span class="small" id="billing-status"></span>
        </div>
      `;
      const btn = document.getElementById('billing-upgrade-btn');
      const status = document.getElementById('billing-status');
      if (btn) {
        btn.addEventListener('click', async () => {
          if (status) {
            status.textContent = 'Redirecting to secure checkout…';
          }
          try {
            const resp = await fetch('/api/v1/billing/checkout', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
              },
              credentials: 'include',
              body: JSON.stringify({}),
            });
            const payload = await resp.json().catch(() => ({}));
            if (!resp.ok || !payload.url) {
              if (status) {
                status.textContent = payload.error || 'Could not start checkout.';
              }
              return;
            }
            window.location.href = payload.url;
          } catch {
            if (status) {
              status.textContent = 'Network error – please try again.';
            }
          }
        });
      }
    } catch {
      host.innerHTML = '<p class="small">Billing status is currently unavailable.</p>';
    }
  })();
}

// Package Form Toggle, Edit, and Delete Functions

/**
 * Enable or disable all inputs / the submit button in #package-form and update
 * the #pkg-status message accordingly.
 *
 * @param {boolean} disable - true to disable (limit reached), false to enable.
 */
function setPkgFormDisabled(disable, message) {
  const form = document.getElementById('package-form');
  if (!form) {
    return;
  }
  form.querySelectorAll('input, textarea, select, button[type="submit"]').forEach(el => {
    el.disabled = disable;
  });
  const status = document.getElementById('pkg-status');
  if (status) {
    status.textContent = disable ? message || PKG_LIMIT_MESSAGE : '';
  }
}

function togglePackageForm() {
  const formSection = document.getElementById('package-form-section');
  const toggleBtn = document.getElementById('toggle-package-form');
  const cancelBtn = document.getElementById('cancel-package-form');

  if (!formSection || !toggleBtn) {
    return;
  }

  const isExpanded = formSection.classList.contains('expanded');

  if (isExpanded) {
    // Collapse form
    formSection.classList.remove('expanded');
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.querySelector('.label').textContent = 'Create Package';
    toggleBtn.classList.remove('active');
    if (cancelBtn) {
      cancelBtn.style.display = 'none';
    }

    // Reset form
    const form = document.getElementById('package-form');
    if (form) {
      form.reset();
    }
    document.getElementById('pkg-id-hidden').value = '';

    // Clear photo preview and hidden image input so old images don't bleed into new packages
    const pkgPhotoPreview = document.getElementById('pkg-photo-preview');
    if (pkgPhotoPreview) {
      pkgPhotoPreview.innerHTML = '';
    }
    const pkgImage = document.getElementById('pkg-image');
    if (pkgImage) {
      pkgImage.value = '';
    }

    // Clear gallery section
    const galleryExistingReset = document.getElementById('pkg-gallery-existing');
    if (galleryExistingReset) {
      galleryExistingReset.innerHTML = '';
      galleryExistingReset.style.display = 'none';
    }
    const galleryRowReset = document.getElementById('pkg-gallery-row');
    if (galleryRowReset) {
      galleryRowReset.style.display = 'none';
    }

    // Form is returning to create mode — re-apply package limit restrictions if needed.
    if (window._pkgAtLimit) {
      setPkgFormDisabled(true);
      // Restore at-limit label and disabled state on the toggle button.
      toggleBtn.disabled = true;
      toggleBtn.classList.add('form-toggle-btn--at-limit');
      toggleBtn.setAttribute('aria-label', 'Package limit reached — upgrade to create more');
      toggleBtn.title =
        "You've reached your package limit. Pause or delete a package, or upgrade your plan.";
      const labelElRestore = toggleBtn.querySelector('.label');
      if (labelElRestore) {
        labelElRestore.textContent = window._pkgLimitLabel || 'Limit reached';
      }
      const upgradeCta = document.getElementById('pkg-upgrade-cta');
      if (upgradeCta) {
        upgradeCta.style.display = 'inline-flex';
      }
    } else {
      toggleBtn.setAttribute('aria-label', 'Toggle package creation form');
      toggleBtn.title = '';
    }
  } else {
    // Expand form
    formSection.classList.add('expanded');
    toggleBtn.setAttribute('aria-expanded', 'true');
    toggleBtn.querySelector('.label').textContent = 'Cancel';
    toggleBtn.classList.add('active');
    if (cancelBtn) {
      cancelBtn.style.display = 'inline-block';
    }

    // Scroll to form
    setTimeout(() => {
      formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }
}

function editPackage(packageId) {
  // Expand the form section
  const formSection = document.getElementById('package-form-section');
  const toggleBtn = document.getElementById('toggle-package-form');

  if (formSection && !formSection.classList.contains('expanded')) {
    formSection.classList.add('expanded');
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', 'true');
      toggleBtn.querySelector('.label').textContent = 'Cancel';
      toggleBtn.classList.add('active');
    }
  }

  // Always update the toggle button to the Cancel / edit-mode state, regardless
  // of whether the form was already expanded. This ensures an at-limit supplier
  // who had a disabled button can still cancel out of an edit they just opened.
  if (toggleBtn) {
    toggleBtn.disabled = false;
    toggleBtn.classList.remove('form-toggle-btn--at-limit');
    toggleBtn.setAttribute('aria-label', 'Cancel editing package');
    toggleBtn.title = '';
    const upgradeCta = document.getElementById('pkg-upgrade-cta');
    if (upgradeCta) {
      upgradeCta.style.display = 'none';
    }
  }

  // Fetch package data from API
  fetch(`/api/v1/me/packages/${encodeURIComponent(packageId)}`, {
    credentials: 'include',
  })
    .then(response => {
      if (!response.ok) {
        throw new Error('Failed to fetch package data');
      }
      return response.json();
    })
    .then(pkg => {
      // Populate form with package data
      document.getElementById('pkg-id-hidden').value = pkg.id || '';
      document.getElementById('pkg-title').value = pkg.title || '';
      document.getElementById('pkg-price').value = pkg.price_display || '';
      document.getElementById('pkg-desc').value = pkg.description || '';
      document.getElementById('pkg-category').value = pkg.primaryCategoryKey || '';
      document.getElementById('pkg-image').value = pkg.image || '';

      // Package limit only blocks *creation*. Re-enable all form inputs for editing
      // (they may have been disabled by the create-mode limit check in loadPackages).
      setPkgFormDisabled(false);

      // Set supplier select if available
      const supplierSelect = document.getElementById('pkg-supplier');
      if (supplierSelect && pkg.supplierId) {
        supplierSelect.value = pkg.supplierId;
        document.getElementById('pkg-supplier-id-hidden').value = pkg.supplierId;
      }

      // Set event type checkboxes
      // Set event type checkboxes
      if (pkg.eventTypes && Array.isArray(pkg.eventTypes)) {
        const ALL_EVENT_TYPES = [
          'wedding',
          'birthday',
          'corporate',
          'anniversary',
          'christening',
          'graduation',
          'engagement',
          'other',
        ];
        ALL_EVENT_TYPES.forEach(type => {
          const el = document.getElementById(`pkg-event-${type}`);
          if (el) {
            el.checked = pkg.eventTypes.includes(type);
          }
        });
      }

      // Populate existing gallery photos for editing
      const galleryExisting = document.getElementById('pkg-gallery-existing');
      const galleryRow = document.getElementById('pkg-gallery-row');
      if (galleryExisting) {
        const galleryPhotos = pkg.gallery || [];
        const PLACEHOLDER_PATH = '/assets/images/placeholders/';
        // Collect gallery photo URLs to avoid duplicating the main image
        const galleryUrls = new Set(
          galleryPhotos.map(item => (typeof item === 'string' ? item : item.url || ''))
        );
        const validPhotos = galleryPhotos.filter(item => {
          const photoUrl = typeof item === 'string' ? item : item.url || '';
          return !!photoUrl;
        });
        // If the main package image is a real photo not already in the gallery list, show it first
        if (
          pkg.image &&
          !pkg.image.includes(PLACEHOLDER_PATH) &&
          pkg.image !== '' &&
          !galleryUrls.has(pkg.image)
        ) {
          validPhotos.unshift({ url: pkg.image, _isMainImage: true });
        }
        if (validPhotos.length > 0) {
          renderPkgGallery(galleryExisting, validPhotos, pkg.id);
          galleryExisting.style.display = '';
          if (galleryRow) {
            galleryRow.style.display = '';
          }
          // Show reorder bar only when there are ≥2 photos
          const reorderBar = document.getElementById('pkg-gallery-reorder-bar');
          if (reorderBar) {
            reorderBar.style.display = validPhotos.length >= 2 ? '' : 'none';
          }
        } else {
          galleryExisting.innerHTML = '';
          galleryExisting.style.display = 'none';
          if (galleryRow) {
            galleryRow.style.display = 'none';
          }
          const reorderBar = document.getElementById('pkg-gallery-reorder-bar');
          if (reorderBar) {
            reorderBar.style.display = 'none';
          }
        }
      }

      // Update form heading
      const heading = formSection.querySelector('.supplier-section-header');
      if (heading) {
        heading.textContent = 'Edit package';
      }

      // Scroll to form
      setTimeout(() => {
        formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    })
    .catch(e => {
      console.error('Error loading package for edit:', e);
      alert('Failed to load package data. Please try again.');
    });
}

async function deletePackage(packageId) {
  if (!confirm('Are you sure you want to delete this package? This action cannot be undone.')) {
    return;
  }

  try {
    const csrfToken = window.__CSRF_TOKEN__ || '';
    const response = await fetch(`/api/v1/me/packages/${encodeURIComponent(packageId)}`, {
      method: 'DELETE',
      headers: {
        'X-CSRF-Token': csrfToken,
      },
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json();
      alert(`Failed to delete package: ${errorData.error || 'Unknown error'}`);
      return;
    }

    // Reload packages list
    const initFunc = window.initDashSupplier;
    if (initFunc) {
      // Reload just packages if possible, otherwise show success message
      alert('Package deleted successfully!');
      location.reload();
    }
  } catch (e) {
    console.error('Error deleting package:', e);
    alert('Failed to delete package. Please try again.');
  }
}

async function togglePackagePause(packageId, pause) {
  const action = pause ? 'pause' : 'unpause';
  try {
    const csrfToken = window.__CSRF_TOKEN__ || '';
    const response = await fetch(`/api/v1/me/packages/${encodeURIComponent(packageId)}/${action}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = `Failed to ${action} package: ${errorData.error || 'Unknown error'}`;
      if (typeof Toast !== 'undefined') {
        Toast.error(msg);
      } else {
        alert(msg);
      }
      return;
    }

    // Refresh packages list to reflect the updated state.
    // _efLoadPackages is the closure-scoped loadPackages() exposed by initDashSupplier().
    if (typeof window._efLoadPackages === 'function') {
      await window._efLoadPackages();
    }

    // Show a success notification
    const successMsg = pause ? 'Package paused successfully.' : 'Package unpaused successfully.';
    if (typeof Toast !== 'undefined') {
      Toast.success(successMsg);
    }

    // Keep the Active Packages stat card in sync without a full page reload
    try {
      const pkgsResp = await fetch('/api/v1/me/packages', { credentials: 'include' });
      if (pkgsResp.ok) {
        const pkgsData = await pkgsResp.json();
        const activeCount = (pkgsData?.items ?? []).filter(p => !p.paused).length;
        const statEl = document.getElementById('quick-stat-packages');
        if (statEl) {
          statEl.setAttribute('data-target', String(activeCount));
          statEl.textContent = String(activeCount);
        }
      }
    } catch {
      // Best effort — stat update failure should not block UX
    }
  } catch (e) {
    console.error(`Error ${action}ing package:`, e);
    const errMsg = `Failed to ${action} package. Please try again.`;
    if (typeof Toast !== 'undefined') {
      Toast.error(errMsg);
    } else {
      alert(errMsg);
    }
  }
}

async function deletePackagePhoto(packageId, photoUrl, btnEl) {
  if (!confirm('Remove this photo from the gallery?')) {
    return;
  }
  const csrfToken = window.__CSRF_TOKEN__ || '';
  if (btnEl) {
    btnEl.disabled = true;
  }
  try {
    const response = await fetch(`/api/me/packages/${encodeURIComponent(packageId)}/photos`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      credentials: 'include',
      body: JSON.stringify({ url: photoUrl }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      alert(`Failed to delete photo: ${err.error || 'Unknown error'}`);
      if (btnEl) {
        btnEl.disabled = false;
      }
      return;
    }
    // Remove the photo item from the gallery UI
    const item = btnEl ? btnEl.closest('.pkg-gallery-item') : null;
    if (item) {
      item.remove();
    }
    // Hide gallery container if no photos remain
    const galleryExisting = document.getElementById('pkg-gallery-existing');
    if (galleryExisting && !galleryExisting.querySelector('.pkg-gallery-item')) {
      galleryExisting.innerHTML = '';
      galleryExisting.style.display = 'none';
      const galleryRow = document.getElementById('pkg-gallery-row');
      if (galleryRow) {
        galleryRow.style.display = 'none';
      }
    }
  } catch (e) {
    console.error('Error deleting package photo:', e);
    alert('Failed to delete photo. Please try again.');
    if (btnEl) {
      btnEl.disabled = false;
    }
  }
}

/**
 * Render the editable package gallery with drag-to-reorder support.
 * Items can be dragged by their handle (≡) to change order.
 * The first item carries a "Cover" badge as a visual cue that it becomes the card thumbnail.
 *
 * @param {HTMLElement} container  - The #pkg-gallery-existing element
 * @param {Array}       photos     - Ordered array of gallery items (string URLs or objects with .url)
 * @param {string}      packageId  - Package ID used by the delete buttons
 */
function renderPkgGallery(container, photos, packageId) {
  container.innerHTML = photos
    .map((item, index) => {
      const photoUrl = typeof item === 'string' ? item : item.url || '';
      const escapedUrl = photoUrl.replace(/"/g, '&quot;');
      const isFirst = index === 0;
      return `<div class="pkg-gallery-item" draggable="true" data-url="${escapedUrl}">
        <span class="pkg-gallery-drag-handle" title="Drag to reorder" aria-hidden="true">⠿</span>
        ${isFirst ? '<span class="pkg-gallery-first-badge">Cover</span>' : ''}
        <img src="${escapedUrl}" alt="Gallery photo" loading="lazy">
        <button type="button" class="pkg-gallery-delete" data-url="${escapedUrl}" data-package-id="${packageId}" aria-label="Delete photo" title="Delete photo">✕</button>
      </div>`;
    })
    .join('');

  // Wire up HTML5 drag-and-drop on the container
  _attachGalleryDragDrop(container);
}

/**
 * Attach HTML5 drag-and-drop handlers to a rendered pkg-gallery-sortable container.
 * Uses event delegation on the container for efficiency.
 */
function _attachGalleryDragDrop(container) {
  let dragSrc = null;

  container.addEventListener('dragstart', e => {
    const item = e.target.closest('.pkg-gallery-item');
    if (!item) {
      return;
    }
    dragSrc = item;
    item.classList.add('pkg-gallery-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragend', e => {
    const item = e.target.closest('.pkg-gallery-item');
    if (item) {
      item.classList.remove('pkg-gallery-dragging');
    }
    container.querySelectorAll('.pkg-gallery-item').forEach(el => {
      el.classList.remove('pkg-gallery-drag-over');
    });
    dragSrc = null;
    // Refresh the "Cover" badge so it's always on the first card
    _refreshFirstBadge(container);
    // Show/hide the save-order bar based on whether order changed
    _markGalleryOrderDirty();
  });

  container.addEventListener('dragover', e => {
    e.preventDefault();
    const item = e.target.closest('.pkg-gallery-item');
    if (!item || item === dragSrc) {
      return;
    }
    container.querySelectorAll('.pkg-gallery-item').forEach(el => {
      el.classList.remove('pkg-gallery-drag-over');
    });
    item.classList.add('pkg-gallery-drag-over');
    e.dataTransfer.dropEffect = 'move';
  });

  container.addEventListener('dragleave', e => {
    const item = e.target.closest('.pkg-gallery-item');
    if (item) {
      item.classList.remove('pkg-gallery-drag-over');
    }
  });

  container.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('.pkg-gallery-item');
    if (!target || !dragSrc || target === dragSrc) {
      return;
    }
    target.classList.remove('pkg-gallery-drag-over');

    // Determine insertion position: before or after target based on pointer position
    const rect = target.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    if (e.clientX < midX) {
      container.insertBefore(dragSrc, target);
    } else {
      container.insertBefore(dragSrc, target.nextSibling);
    }
  });
}

/**
 * Refresh the "Cover" badge so it appears only on the first gallery item.
 */
function _refreshFirstBadge(container) {
  const items = container.querySelectorAll('.pkg-gallery-item');
  items.forEach((item, idx) => {
    let badge = item.querySelector('.pkg-gallery-first-badge');
    if (idx === 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'pkg-gallery-first-badge';
        badge.textContent = 'Cover';
        item.insertBefore(badge, item.firstChild.nextSibling); // after drag handle
      }
    } else if (badge) {
      badge.remove();
    }
  });
}

/**
 * Show the Save Order bar so the user can persist the new order.
 */
function _markGalleryOrderDirty() {
  const bar = document.getElementById('pkg-gallery-reorder-bar');
  if (bar) {
    bar.style.display = '';
    const status = document.getElementById('pkg-gallery-order-status');
    if (status) {
      status.textContent = '';
    }
  }
}

/**
 * Collect the current gallery order from the DOM and save it via the API.
 * Called when the supplier clicks "Save order".
 */
async function savePkgGalleryOrder() {
  const container = document.getElementById('pkg-gallery-existing');
  const packageId = document.getElementById('pkg-id-hidden')?.value;
  if (!container || !packageId) {
    return;
  }

  const urls = Array.from(container.querySelectorAll('.pkg-gallery-item[data-url]')).map(el =>
    el.getAttribute('data-url')
  );

  const saveBtn = document.getElementById('pkg-gallery-save-order');
  const status = document.getElementById('pkg-gallery-order-status');
  if (saveBtn) {
    saveBtn.disabled = true;
  }
  if (status) {
    status.textContent = 'Saving…';
  }

  try {
    const csrfToken = window.__CSRF_TOKEN__ || '';
    const response = await fetch(
      `/api/me/packages/${encodeURIComponent(packageId)}/gallery/order`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({ urls }),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (status) {
        status.textContent = `Error: ${err.error || 'Could not save order'}`;
      }
    } else {
      if (status) {
        status.textContent = '✓ Order saved';
        setTimeout(() => {
          status.textContent = '';
        }, 3000);
      }
      // Refresh "Cover" badge in case the server order differs
      _refreshFirstBadge(container);
    }
  } catch {
    if (status) {
      status.textContent = 'Network error — please try again';
    }
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
    }
  }
}

// Profile Form Toggle, Edit, and Delete Functions
function toggleProfileForm() {
  const formSection = document.getElementById('profile-form-section');
  const toggleBtn = document.getElementById('toggle-profile-form');
  const cancelBtn = document.getElementById('cancel-profile-form');

  if (!formSection || !toggleBtn) {
    return;
  }

  const isExpanded = formSection.classList.contains('expanded');
  // Determine whether the user already has a profile before any DOM mutations
  const hasProfile =
    !!document.getElementById('sup-id')?.value ||
    !!document.querySelector('#my-suppliers .supplier-card');

  if (isExpanded) {
    // Collapse form
    formSection.classList.remove('expanded');
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.querySelector('.label').textContent = hasProfile ? 'Edit Profile' : 'Create Profile';
    toggleBtn.classList.remove('active');
    if (cancelBtn) {
      cancelBtn.style.display = 'none';
    }

    // Reset form
    const form = document.getElementById('supplier-form');
    if (form) {
      form.reset();
    }
    document.getElementById('sup-id').value = '';

    // Reset form heading
    const heading = formSection.querySelector('.supplier-section-header');
    if (heading) {
      heading.textContent = hasProfile ? 'Edit Profile' : 'Create / Edit profile';
    }
  } else {
    // Expand form
    formSection.classList.add('expanded');
    toggleBtn.setAttribute('aria-expanded', 'true');
    toggleBtn.querySelector('.label').textContent = 'Cancel';
    toggleBtn.classList.add('active');
    if (cancelBtn) {
      cancelBtn.style.display = 'inline-block';
    }

    // Scroll to form
    setTimeout(() => {
      formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }
}

async function editProfile(supplierId, options = {}) {
  const skipFormScroll = !!options.skipFormScroll;
  // Expand the form section
  const formSection = document.getElementById('profile-form-section');
  const toggleBtn = document.getElementById('toggle-profile-form');

  if (formSection && !formSection.classList.contains('expanded')) {
    formSection.classList.add('expanded');
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', 'true');
      const labelEl = toggleBtn.querySelector('.label');
      if (labelEl) {
        labelEl.textContent = 'Cancel';
      }
      toggleBtn.classList.add('active');
    }
  }

  // Fetch supplier data and populate form
  try {
    // Look up from the globally-exposed suppliers cache to avoid an
    // extra API call (window._efCachedSuppliers is set by initDashSupplier)
    let supplier = (window._efCachedSuppliers || []).find(
      s => s && String(s.id) === String(supplierId)
    );

    if (!supplier) {
      // Fallback: fetch all suppliers directly (avoids dependency on closure-scoped api())
      const r = await fetch('/api/me/suppliers', { credentials: 'include' });
      if (!r.ok) {
        throw new Error(`Failed to fetch suppliers: ${r.status} ${r.statusText}`);
      }
      const d = await r.json();
      const items = d?.items && Array.isArray(d.items) ? d.items : [];
      window._efCachedSuppliers = items;
      supplier = items.find(s => s && String(s.id) === String(supplierId));
    }

    if (!supplier) {
      throw new Error('Supplier not found');
    }

    // Delegate form population to the comprehensive helper from initDashSupplier.
    // This populates all fields (basic, banner, tagline, theme, highlights, social links, etc.)
    // and keeps the internal currentEditingSupplierId in sync.
    if (typeof window._efPopulateSupplierForm === 'function') {
      window._efPopulateSupplierForm(supplier);
    } else {
      // Fallback: populate basic fields manually if helper is not yet available
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) {
          el.value = val || '';
        }
      };
      setVal('sup-id', supplier.id);
      setVal('sup-name', supplier.name);
      setVal('sup-category', supplier.category);
      setVal('sup-location', supplier.location);
      setVal('sup-short', supplier.description_short);
      setVal('sup-long', supplier.description_long);
      setVal('sup-website', supplier.website);
      setVal('sup-license', supplier.license);
      setVal('sup-amenities', supplier.amenities);
      setVal('sup-max', supplier.maxGuests);
      if (supplier.venuePostcode) {
        setVal('sup-venue-postcode', supplier.venuePostcode);
      }
      setVal('sup-base-postcode', supplier.basePostcode);
    }

    // Update form heading with truncated name if necessary
    if (formSection) {
      const heading = formSection.querySelector('.supplier-section-header');
      if (heading) {
        // Truncate supplier name if too long to prevent UI issues
        const MAX_DISPLAY_NAME_LENGTH = 50;
        const TRUNCATE_SUFFIX_LENGTH = 3; // for "..."
        const displayName =
          supplier.name && supplier.name.length > MAX_DISPLAY_NAME_LENGTH
            ? `${supplier.name.substring(0, MAX_DISPLAY_NAME_LENGTH - TRUNCATE_SUFFIX_LENGTH)}...`
            : supplier.name || 'Unknown';
        heading.textContent = `Edit profile: ${displayName}`;
      }
    }

    // Store the editing supplier ID for later use
    window.currentEditingSupplierId = supplierId;

    // Scroll to form unless caller wants to control scroll target
    if (!skipFormScroll) {
      setTimeout(() => {
        if (formSection) {
          formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  } catch (e) {
    console.error('Error loading supplier for edit:', e);
    alert('Failed to load supplier profile. Please try again.');
  }
}

async function deleteProfile(supplierId) {
  if (!confirm('Are you sure you want to delete this profile? This action cannot be undone.')) {
    return;
  }

  try {
    const csrfToken = window.__CSRF_TOKEN__ || '';
    const response = await fetch(`/api/v1/me/suppliers/${encodeURIComponent(supplierId)}`, {
      method: 'DELETE',
      headers: {
        'X-CSRF-Token': csrfToken,
      },
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json();
      alert(`Failed to delete profile: ${errorData.error || 'Unknown error'}`);
      return;
    }

    // Reload the page to refresh the list
    alert('Profile deleted successfully!');
    location.reload();
  } catch (e) {
    console.error('Error deleting profile:', e);
    alert('Failed to delete profile. Please try again.');
  }
}

// Make functions globally accessible
window.togglePackageForm = togglePackageForm;
window.editPackage = editPackage;
window.deletePackage = deletePackage;
window.deletePackagePhoto = deletePackagePhoto;
window.savePkgGalleryOrder = savePkgGalleryOrder;
window.toggleProfileForm = toggleProfileForm;
window.editProfile = editProfile;
window.deleteProfile = deleteProfile;

async function initAdmin() {
  efMaybeShowOnboarding('admin');
  const metrics = document.getElementById('metrics');
  const supWrap = document.getElementById('admin-suppliers');
  const pkgWrap = document.getElementById('admin-packages');

  const resetBtn = document.getElementById('reset-demo');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (!window.confirm('Reset demo data? This will clear demo users, suppliers and plans.')) {
        return;
      }
      resetBtn.disabled = true;
      const originalLabel = resetBtn.textContent;
      resetBtn.textContent = 'Resetting…';
      try {
        const r = await fetch('/api/v1/admin/reset-demo', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
          },
          credentials: 'include',
        });
        if (!r.ok) {
          alert(`Reset failed (${r.status}).`);
        } else {
          alert('Demo data has been reset.');
          window.location.reload();
        }
      } catch {
        alert('Could not contact server to reset demo data.');
      } finally {
        resetBtn.disabled = false;
        resetBtn.textContent = originalLabel;
      }
    });
  }

  // Helper function to add CSRF token to requests
  function addCsrfToken(opts) {
    const options = opts || {};
    options.headers = options.headers || {};
    options.credentials = 'include';
    if (
      window.__CSRF_TOKEN__ &&
      options.method &&
      ['POST', 'PUT', 'DELETE'].includes(options.method.toUpperCase())
    ) {
      options.headers['X-CSRF-Token'] = window.__CSRF_TOKEN__;
    }
    return options;
  }

  async function fetchJSON(url, opts) {
    const options = addCsrfToken(opts);
    const r = await fetch(url, options || {});
    if (!r.ok) {
      throw new Error((await r.json()).error || 'Request failed');
    }
    return r.json();
  }
  try {
    const m = await fetchJSON('/api/admin/metrics');
    const c = m.counts;
    metrics.textContent = `Users: ${c.usersTotal} ( ${Object.entries(c.usersByRole)
      .map(([k, v]) => `${k}: ${v}`)
      .join(
        ', '
      )} ) · Suppliers: ${c.suppliersTotal} · Packages: ${c.packagesTotal} · Threads: ${c.threadsTotal} · Messages: ${c.messagesTotal}`;
  } catch {
    metrics.textContent = 'Forbidden (admin only).';
  }
  try {
    const s = await fetchJSON('/api/admin/suppliers');
    supWrap.innerHTML =
      (s.items || [])
        .map(
          x => `<div class="card" style="margin-bottom:10px">
      <div class="small"><strong>${x.name}</strong> — ${x.category} · ${x.location || ''}</div>
      <div class="form-actions"><button class="cta secondary" data-approve="${x.id}" data-val="${x.approved ? 'false' : 'true'}">${x.approved ? 'Hide' : 'Approve'}</button></div>
    </div>`
        )
        .join('') || '<p class="small">No suppliers.</p>';
    supWrap.querySelectorAll('[data-approve]').forEach(btn =>
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-approve');
        const val = btn.getAttribute('data-val') === 'true';
        await fetchJSON(`/api/admin/suppliers/${id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approved: val }),
        });
        location.reload();
      })
    );
  } catch {
    supWrap.innerHTML = '<p class="small">Forbidden (admin only)</p>';
  }
  try {
    const p = await fetchJSON('/api/admin/packages');
    pkgWrap.innerHTML =
      (p.items || [])
        .map(
          x => `<div class="pack card" style="margin-bottom:10px">
      <img src="${x.image}"><div><h3>${x.title}</h3><div class="small"><span class="badge">${x.price}</span> — Supplier ${x.supplierId.slice(0, 8)}</div>
      <div class="form-actions"><button class="cta secondary" data-approve="${x.id}" data-val="${x.approved ? 'false' : 'true'}">${x.approved ? 'Hide' : 'Approve'}</button>
      <button class="cta secondary" data-feature="${x.id}" data-val="${x.featured ? 'false' : 'true'}">${x.featured ? 'Unfeature' : 'Feature'}</button></div></div></div>`
        )
        .join('') || '<p class="small">No packages.</p>';
    pkgWrap.querySelectorAll('[data-approve]').forEach(btn =>
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-approve');
        const val = btn.getAttribute('data-val') === 'true';
        await fetchJSON(`/api/admin/packages/${id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approved: val }),
        });
        location.reload();
      })
    );
    pkgWrap.querySelectorAll('[data-feature]').forEach(btn =>
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-feature');
        const val = btn.getAttribute('data-val') === 'true';
        await fetchJSON(`/api/admin/packages/${id}/feature`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ featured: val }),
        });
        location.reload();
      })
    );
  } catch {
    pkgWrap.innerHTML = '<p class="small">Forbidden (admin only)</p>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const page =
    window.__EF_PAGE__ ||
    (location.pathname.endsWith('admin-users.html') || location.pathname === '/admin-users'
      ? 'admin_users'
      : location.pathname.endsWith('admin.html') || location.pathname === '/admin'
        ? 'admin'
        : location.pathname.endsWith('auth.html') || location.pathname === '/auth'
          ? 'auth'
          : location.pathname.endsWith('verify.html') || location.pathname === '/verify'
            ? 'verify'
            : location.pathname.endsWith('dashboard-customer.html') ||
                location.pathname === '/dashboard/customer'
              ? 'dash_customer'
              : location.pathname.endsWith('dashboard-supplier.html') ||
                  location.pathname === '/dashboard/supplier'
                ? 'dash_supplier'
                : location.pathname.endsWith('suppliers.html') || location.pathname === '/suppliers'
                  ? 'suppliers'
                  : location.pathname.endsWith('supplier.html') ||
                      location.pathname.startsWith('/supplier')
                    ? 'supplier'
                    : location.pathname.endsWith('plan.html') || location.pathname === '/plan'
                      ? 'plan'
                      : '');

  // Version display is handled by admin-shared.js for admin pages.
  // Public pages keep the version wrapper hidden via the HTML hidden attribute.
  // No version fetch needed here.

  // Per-page setup
  // Note: homepage initialization is handled by home-init.js
  // (removed initHome() from app.js to avoid conflicts)
  if (page === 'results') {
    initResults && initResults();
  }
  if (page === 'supplier') {
    initSupplier && initSupplier();
  }
  if (page === 'plan') {
    initPlan && initPlan();
  }
  if (page === 'dash_customer') {
    efMaybeShowOnboarding('dash_customer');
    renderThreads && renderThreads('threads-cust');
  }
  if (page === 'dash_supplier') {
    initDashSupplier && initDashSupplier();
  }
  if (page === 'admin') {
    initAdmin && initAdmin();
  }
  // Note: page === 'admin_users' is handled by admin-users-init.js
  // Note: page === 'verify' is now handled by verify-init.js

  // Global header behaviour: scroll hide/show
  // Note: burger menu is handled by auth-nav.js
  try {
    const header = document.querySelector('.header');

    // Hide header on scroll down, show on scroll up
    let lastY = window.scrollY;
    let ticking = false;
    const threshold = 12;

    const onScroll = () => {
      const currentY = window.scrollY;
      if (Math.abs(currentY - lastY) < threshold) {
        ticking = false;
        return;
      }
      if (currentY > lastY && currentY > 40) {
        header && header.classList.add('header--hidden');
      } else {
        header && header.classList.remove('header--hidden');
      }
      lastY = currentY;
      ticking = false;
    };

    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(onScroll);
        ticking = true;
      }
    });
  } catch {
    /* Ignore loader errors */
  }

  // Password visibility toggle — shared across all pages
  const SVG_EYE =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const SVG_EYE_OFF =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  const attachPasswordToggle = function (input) {
    if (!input) {
      return;
    }
    const wrapper = input.parentElement;
    if (!wrapper) {
      return;
    }
    // Check if toggle already exists
    if (wrapper.querySelector('.password-toggle')) {
      return;
    }
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'password-toggle';
    toggle.innerHTML = SVG_EYE;
    toggle.setAttribute('aria-label', 'Show password');
    toggle.setAttribute('aria-pressed', 'false');
    toggle.addEventListener('click', () => {
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      toggle.innerHTML = isHidden ? SVG_EYE_OFF : SVG_EYE;
      toggle.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
      toggle.setAttribute('aria-pressed', isHidden ? 'true' : 'false');
    });
    input.classList.add('has-toggle');
    wrapper.appendChild(toggle);
  };

  if (page === 'auth') {
    // Helper function to get headers with CSRF token
    const getHeadersWithCsrf = (additionalHeaders = {}) => {
      const headers = { ...additionalHeaders };
      const csrfToken = window.__CSRF_TOKEN__;
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }
      return headers;
    };

    // Ensure Google auth initialisation is present even if an older cached auth.html omits it.
    if (
      !window.__eventflowGoogleAuthInitStarted &&
      !document.querySelector('script[src^="/assets/js/pages/auth-google-init.js"]')
    ) {
      const googleAuthInitScript = document.createElement('script');
      googleAuthInitScript.src = '/assets/js/pages/auth-google-init.js';
      googleAuthInitScript.defer = true;
      document.head.appendChild(googleAuthInitScript);
    }

    // auth form handlers
    const loginForm = document.getElementById('login-form');
    const loginStatus = document.getElementById('login-status');
    const loginEmail = document.getElementById('login-email');
    const loginPassword = document.getElementById('login-password');

    const regForm = document.getElementById('register-form');
    const regStatus = document.getElementById('reg-status');
    const regFirstName = document.getElementById('reg-firstname');
    const regLastName = document.getElementById('reg-lastname');
    const regEmail = document.getElementById('reg-email');
    const regPassword = document.getElementById('reg-password');
    const forgotLink = document.getElementById('forgot-password-link');

    // If already signed in, avoid showing the auth form again
    (async () => {
      try {
        const existing = await me();
        if (existing && loginStatus) {
          const label = existing.name || existing.email || existing.role || 'your account';
          loginStatus.textContent = `You are already signed in as ${label}. Redirecting…`;

          // Honour a valid redirect param (e.g. coming from the pricing page)
          const urlParams = new URLSearchParams(window.location.search);
          const redirectParam = urlParams.get('redirect');
          let destination = null;

          if (redirectParam && validateRedirectForRole(redirectParam, existing.role)) {
            destination = redirectParam;
          } else if (existing.role === 'admin') {
            destination = '/admin';
          } else if (existing.role === 'supplier') {
            destination = '/dashboard/supplier';
          } else {
            destination = '/dashboard/customer';
          }

          setTimeout(() => {
            location.href = destination;
          }, 600);
        }
      } catch {
        /* Ignore loader errors */
      }
    })();

    // Basic "forgot password" handler (demo-only)
    if (forgotLink && loginEmail) {
      forgotLink.addEventListener('click', async e => {
        e.preventDefault();
        const email = (loginEmail.value || '').trim();
        if (!email) {
          if (loginStatus) {
            loginStatus.textContent =
              'Enter your email address first so we know where to send reset instructions.';
          }
          return;
        }
        try {
          await fetch('/api/v1/auth/forgot', {
            method: 'POST',
            headers: getHeadersWithCsrf({ 'Content-Type': 'application/json' }),
            credentials: 'include',
            body: JSON.stringify({ email }),
          });
          if (loginStatus) {
            loginStatus.textContent = "If this email is registered, we'll send reset instructions.";
          }
        } catch {
          if (loginStatus) {
            loginStatus.textContent = 'Something went wrong. Please try again in a moment.';
          }
        }
      });
    }

    // Add caps lock warning to login password field
    if (loginPassword) {
      const loginCapsLockWarning = document.getElementById('login-caps-lock-warning');
      if (loginCapsLockWarning) {
        const _checkLoginCaps = e => {
          let on = !!(e.getModifierState && e.getModifierState('CapsLock'));
          // Secondary: verify via key character — only for letters that have distinct case forms
          // (handles both ASCII and accented non-English letters; excludes numbers and symbols)
          if (e.key && e.key.length === 1 && e.key.toUpperCase() !== e.key.toLowerCase()) {
            on = (e.key === e.key.toUpperCase()) !== !!e.shiftKey;
          }
          loginCapsLockWarning.style.display = on ? 'flex' : 'none';
        };
        loginPassword.addEventListener('keydown', _checkLoginCaps);
        loginPassword.addEventListener('keyup', _checkLoginCaps);
        loginPassword.addEventListener('blur', () => {
          loginCapsLockWarning.style.display = 'none';
        });
      }
    }

    // Real-time email validation for registration
    if (regEmail) {
      const emailValidationMsg = document.getElementById('email-validation-msg');
      regEmail.addEventListener('blur', () => {
        const email = regEmail.value.trim();
        if (email && emailValidationMsg) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(email)) {
            emailValidationMsg.textContent = 'Please enter a valid email address';
            emailValidationMsg.style.display = 'block';
          } else {
            emailValidationMsg.textContent = '';
            emailValidationMsg.style.display = 'none';
          }
        }
      });
    }

    // Password strength indicator for registration with progress bar
    if (regPassword) {
      const passwordStrengthMsg = document.getElementById('password-strength-msg');
      const passwordStrengthBar = document.getElementById('password-strength-bar');
      const passwordStrengthLabel = document.getElementById('password-strength-label');
      const passwordStrengthContainer = document.getElementById('password-strength-container');
      const passwordRequirements = document.getElementById('password-requirements');
      const reqLength = document.getElementById('req-length');
      const reqLetter = document.getElementById('req-letter');
      const reqNumber = document.getElementById('req-number');
      const capsLockWarning = document.getElementById('caps-lock-warning');
      const regPasswordConfirm = document.getElementById('reg-password-confirm');
      const passwordMatchMsg = document.getElementById('password-match-msg');

      // Password match validation
      const validatePasswordMatch = () => {
        if (!regPasswordConfirm || !passwordMatchMsg) {
          return;
        }

        const password = regPassword.value;
        const confirmPassword = regPasswordConfirm.value;

        if (!confirmPassword) {
          passwordMatchMsg.style.display = 'none';
          return;
        }

        if (password !== confirmPassword) {
          passwordMatchMsg.textContent = 'Passwords do not match';
          passwordMatchMsg.style.display = 'block';
          passwordMatchMsg.style.color = '#b00020';
          return false;
        } else {
          passwordMatchMsg.textContent = '✓ Passwords match';
          passwordMatchMsg.style.display = 'block';
          passwordMatchMsg.style.color = '#10b981';
          return true;
        }
      };

      // Caps lock warning
      const checkCapsLock = e => {
        if (!capsLockWarning) {
          return;
        }
        let on = !!(e.getModifierState && e.getModifierState('CapsLock'));
        // Secondary: verify via key character — only for letters that have distinct case forms
        // (handles both ASCII and accented non-English letters; excludes numbers and symbols)
        if (e.key && e.key.length === 1 && e.key.toUpperCase() !== e.key.toLowerCase()) {
          on = (e.key === e.key.toUpperCase()) !== !!e.shiftKey;
        }
        capsLockWarning.style.display = on ? 'flex' : 'none';
      };
      const _hideRegCaps = () => {
        if (capsLockWarning) {
          capsLockWarning.style.display = 'none';
        }
      };

      regPassword.addEventListener('keydown', checkCapsLock);
      regPassword.addEventListener('keyup', checkCapsLock);
      regPassword.addEventListener('blur', _hideRegCaps);
      if (regPasswordConfirm) {
        regPasswordConfirm.addEventListener('keydown', checkCapsLock);
        regPasswordConfirm.addEventListener('keyup', checkCapsLock);
        regPasswordConfirm.addEventListener('blur', _hideRegCaps);
      }

      // Password validation function (matches server-side validation)
      const validatePassword = password => {
        const hasLength = password.length >= 8;
        const hasLetter = /[A-Za-z]/.test(password);
        const hasNumber = /\d/.test(password);

        // Update requirements list — toggle a class rather than inline color so the
        // met/unmet state isn't conveyed by color alone (a ✓/✕ marker comes from CSS).
        if (reqLength) {
          reqLength.classList.toggle('is-met', hasLength);
        }
        if (reqLetter) {
          reqLetter.classList.toggle('is-met', hasLetter);
        }
        if (reqNumber) {
          reqNumber.classList.toggle('is-met', hasNumber);
        }

        return hasLength && hasLetter && hasNumber;
      };

      // Password strength calculation
      regPassword.addEventListener('input', () => {
        const password = regPassword.value;

        if (!password) {
          if (passwordStrengthContainer) {
            passwordStrengthContainer.style.display = 'none';
          }
          if (passwordRequirements) {
            passwordRequirements.style.display = 'none';
          }
          return;
        }

        if (passwordStrengthContainer) {
          passwordStrengthContainer.style.display = 'block';
        }
        if (passwordRequirements) {
          passwordRequirements.style.display = 'block';
        }

        const isValid = validatePassword(password);

        let strength = 0;
        let label = '';
        let barColor = '#b00020';
        let barWidth = '0%';
        let message = '';

        // Calculate strength
        if (password.length >= 8) {
          strength++;
        }
        if (/[a-z]/.test(password)) {
          strength++;
        }
        if (/[A-Z]/.test(password)) {
          strength++;
        }
        if (/[0-9]/.test(password)) {
          strength++;
        }
        if (/[^a-zA-Z0-9]/.test(password)) {
          strength++;
        }

        if (password.length < 8) {
          label = 'Too short';
          barColor = '#b00020';
          barWidth = '20%';
          message = 'Add more characters';
        } else if (!isValid) {
          label = 'Weak';
          barColor = '#b00020';
          barWidth = '33%';
          message = 'Add both letters and numbers';
        } else if (strength === 2) {
          label = 'Weak';
          barColor = '#ef4444';
          barWidth = '33%';
          message = 'Consider adding uppercase letters or symbols';
        } else if (strength === 3) {
          label = 'Fair';
          barColor = '#f59e0b';
          barWidth = '50%';
          message = 'Add uppercase letters or special characters for better security';
        } else if (strength === 4) {
          label = 'Good';
          barColor = '#10b981';
          barWidth = '75%';
          message = 'Strong enough for most uses';
        } else {
          label = 'Strong';
          barColor = '#059669';
          barWidth = '100%';
          message = 'Excellent password strength';
        }

        if (passwordStrengthBar) {
          passwordStrengthBar.style.width = barWidth;
          passwordStrengthBar.style.background = barColor;
        }
        if (passwordStrengthLabel) {
          passwordStrengthLabel.textContent = label;
          passwordStrengthLabel.style.color = barColor;
        }
        if (passwordStrengthMsg) {
          passwordStrengthMsg.textContent = message;
        }

        // Validate confirm password if it has content
        if (regPasswordConfirm && regPasswordConfirm.value) {
          validatePasswordMatch();
        }
      });

      if (regPasswordConfirm) {
        regPasswordConfirm.addEventListener('input', validatePasswordMatch);
        regPasswordConfirm.addEventListener('blur', validatePasswordMatch);
      }
    }

    // Account type toggle (customer / supplier) is handled by auth-init.js's
    // selectRole() — that version also syncs aria-required on the company
    // field and manages roving tabindex/keyboard nav for the radiogroup, so
    // it fully supersedes this file's role-picker handling.

    const setAuthSubmitButtonState = (button, label, isLoading = false) => {
      if (!button) {
        return;
      }

      const labelEl = button.querySelector('.auth-submit-text');
      if (labelEl) {
        labelEl.textContent = label;
      } else {
        button.textContent = label;
      }

      button.disabled = isLoading;
      button.classList.toggle('is-loading', isLoading);
      if (isLoading) {
        button.setAttribute('aria-busy', 'true');
      } else {
        button.removeAttribute('aria-busy');
      }
    };

    // Helper function to show toast notification
    const showLocalToast = function (message, type = 'info') {
      const toast = document.createElement('div');
      toast.className = `ef-toast ef-toast--${type || 'info'}`;
      toast.textContent = message;
      // Colour and positioning handled by CSS class
      document.body.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
      }, 10);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(400px)';
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    };

    if (loginForm && loginEmail && loginPassword) {
      const loginBtn = loginForm.querySelector('button[type="submit"]');
      const loginErrorEl = document.getElementById('login-error');
      const resendContainer = document.getElementById('resend-verification-container');
      const resendBtn = document.getElementById('resend-verification-btn');

      // Resend verification email handler
      if (resendBtn) {
        resendBtn.addEventListener('click', async () => {
          const email = loginEmail.value.trim();
          if (!email) {
            showLocalToast('Please enter your email address', 'error');
            return;
          }

          resendBtn.disabled = true;
          resendBtn.textContent = 'Sending...';

          try {
            const r = await fetch('/api/v1/auth/resend-verification', {
              method: 'POST',
              headers: getHeadersWithCsrf({ 'Content-Type': 'application/json' }),
              credentials: 'include',
              body: JSON.stringify({ email }),
            });

            let data = {};
            try {
              data = await r.json();
            } catch {
              /* Ignore JSON parse errors */
            }

            if (r.ok) {
              showLocalToast(
                data.message || 'Verification email sent! Please check your inbox.',
                'success'
              );
              if (loginStatus) {
                loginStatus.textContent =
                  'Verification email sent. Please check your inbox and verify your account.';
              }
            } else {
              showLocalToast(
                data.error || 'Failed to send verification email. Please try again.',
                'error'
              );
            }
          } catch (err) {
            console.error('Resend verification error', err);
            showLocalToast('Network error. Please try again.', 'error');
          } finally {
            resendBtn.disabled = false;
            resendBtn.textContent = 'Resend Verification Email';
          }
        });
      }

      loginForm.addEventListener('submit', async e => {
        e.preventDefault();
        if (loginStatus) {
          loginStatus.textContent = '';
        }
        // Hide resend button on new login attempt
        if (resendContainer) {
          resendContainer.style.display = 'none';
        }

        // Validate required fields
        const email = loginEmail.value.trim();
        const password = loginPassword.value;
        const rememberCheckbox = document.getElementById('login-remember');
        const remember = rememberCheckbox ? rememberCheckbox.checked : false;

        if (!email || !password) {
          if (loginErrorEl) {
            loginErrorEl.textContent = 'Please enter both email and password';
            loginErrorEl.style.display = 'block';
          }
          if (loginStatus) {
            loginStatus.textContent = '';
          }
          return;
        }

        // Clear any previous errors
        if (loginErrorEl) {
          loginErrorEl.style.display = 'none';
          loginErrorEl.textContent = '';
        }

        setAuthSubmitButtonState(loginBtn, 'Signing in…', true);
        try {
          const r = await fetch('/api/v1/auth/login', {
            method: 'POST',
            headers: getHeadersWithCsrf({ 'Content-Type': 'application/json' }),
            credentials: 'include',
            body: JSON.stringify({ email, password, remember }),
          });
          let data = {};
          try {
            data = await r.json();
          } catch {
            /* Ignore JSON parse errors */
          }
          if (!r.ok) {
            let errorMsg =
              data.error || 'Could not sign in. Please check your details and try again.';

            // Provide more specific error messages
            if (r.status === 401) {
              errorMsg = 'Invalid email or password. Please check your credentials and try again.';
            } else if (r.status === 403 && errorMsg.toLowerCase().includes('verify')) {
              errorMsg =
                'Please verify your email address before signing in. Check your inbox for the verification link.';
            } else if (r.status === 429) {
              errorMsg = 'Too many login attempts. Please wait a moment and try again.';
            } else if (
              !errorMsg ||
              errorMsg === 'Could not sign in. Please check your details and try again.'
            ) {
              errorMsg = 'Unable to sign in. Please check your email and password.';
            }

            if (loginErrorEl) {
              loginErrorEl.textContent = errorMsg;
              loginErrorEl.style.display = 'block';
            }

            if (loginStatus) {
              loginStatus.textContent = errorMsg;

              // Check if login failed due to unverified email (403 status)
              if (r.status === 403 && errorMsg.toLowerCase().includes('verify')) {
                if (resendContainer) {
                  resendContainer.style.display = 'block';
                }
              }
            }
          } else {
            if (loginStatus) {
              loginStatus.textContent = 'Signed in. Redirecting…';
            }
            const user = data.user || {};
            try {
              localStorage.setItem('eventflow_onboarding_new', '1');
            } catch {
              /* Ignore localStorage errors */
            }

            // Determine destination based on user role (SECURITY: never trust redirect param alone)
            let destination;
            if (user.role === 'admin') {
              destination = '/admin';
            } else if (user.role === 'supplier') {
              destination = '/dashboard/supplier';
            } else {
              destination = '/dashboard/customer';
            }

            // Check for redirect parameter - only allow if it matches user's role-appropriate pages
            const urlParams = new URLSearchParams(window.location.search);
            const redirect = urlParams.get('redirect') || urlParams.get('return');
            const plan = urlParams.get('plan');

            if (redirect) {
              // Validate redirect is safe: same-origin and allowlisted for user's role
              const isValidRedirect = validateRedirectForRole(redirect, user.role);
              if (isValidRedirect) {
                destination = redirect;
                // Preserve plan parameter if it exists and not already in redirect
                if (plan && !destination.includes('plan=')) {
                  const separator = destination.includes('?') ? '&' : '?';
                  destination = `${destination}${separator}plan=${encodeURIComponent(plan)}`;
                }
              } else {
                console.warn(
                  `Ignoring untrusted redirect param: ${redirect} for role: ${user.role}`
                );
              }
            }

            location.href = destination;
          }
        } catch (err) {
          if (loginErrorEl) {
            loginErrorEl.textContent = 'Network error – please try again.';
            loginErrorEl.style.display = 'block';
          }
          if (loginStatus) {
            loginStatus.textContent = 'Network error – please try again.';
          }
          console.error('Login error', err);
        } finally {
          setAuthSubmitButtonState(loginBtn, 'Log in');
        }
      });
    }

    if (regForm && regEmail && regPassword) {
      const regBtn = regForm.querySelector('button[type="submit"]');
      const setAuthFieldError = (field, message) => {
        if (!field) {
          return;
        }
        if (regForm._validator && typeof regForm._validator.showError === 'function') {
          regForm._validator.showError(field, message);
        } else {
          field.classList.add('form-field-error');
          field.setAttribute('aria-invalid', 'true');
          let container = field.parentElement;
          if (container && container.classList.contains('auth-input-wrap')) {
            container = container.parentElement || container;
          }
          let errorEl = container ? container.querySelector(':scope > .form-error-message') : null;
          if (!errorEl && container) {
            errorEl = document.createElement('span');
            errorEl.className = 'form-error-message';
            errorEl.setAttribute('role', 'alert');
            container.appendChild(errorEl);
          }
          if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
          }
        }
        field.focus();
      };

      regForm.addEventListener('submit', async e => {
        e.preventDefault();
        if (regForm._validator && typeof regForm._validator.clearAllErrors === 'function') {
          regForm._validator.clearAllErrors();
        }
        if (regStatus) {
          regStatus.textContent = '';
          regStatus.classList.remove('reg-status-visible');
        }

        if (regForm._validator && !regForm._validator.validateAll()) {
          const firstError = regForm.querySelector('.form-field-error');
          if (firstError) {
            firstError.focus();
          }
          return;
        }

        // Pre-check: registration feature flag (set by auth-init.js)
        if (window.__registrationDisabled) {
          if (regStatus) {
            regStatus.textContent =
              'New account registrations are temporarily unavailable. Please try again later.';
          }
          return;
        }

        // Validate password requirements
        const password = regPassword.value;
        const regPasswordConfirm = document.getElementById('reg-password-confirm');
        const passwordConfirm = regPasswordConfirm ? regPasswordConfirm.value : '';

        // Check password meets minimum requirements (matches server-side validation)
        const hasMinLength = password.length >= 8;
        const hasLetter = /[A-Za-z]/.test(password);
        const hasNumber = /\d/.test(password);

        if (!hasMinLength || !hasLetter || !hasNumber) {
          const message =
            'Password must be at least 8 characters and contain both letters and numbers';
          if (regStatus) {
            regStatus.textContent = message;
          }
          setAuthFieldError(regPassword, message);
          return;
        }

        // Check password confirmation
        if (password !== passwordConfirm) {
          if (regStatus) {
            regStatus.textContent = 'Passwords do not match';
          }
          const passwordMatchMsg = document.getElementById('password-match-msg');
          if (passwordMatchMsg) {
            passwordMatchMsg.textContent = 'Passwords do not match';
            passwordMatchMsg.style.display = 'block';
            passwordMatchMsg.style.color = '#b00020';
          }
          setAuthFieldError(regPasswordConfirm, 'Passwords do not match');
          return;
        }

        // Validate terms checkbox
        const termsCheckbox = document.getElementById('reg-terms');
        if (termsCheckbox && !termsCheckbox.checked) {
          const message = 'You must agree to the Terms and Privacy Policy to create an account.';
          if (regStatus) {
            regStatus.textContent = message;
          }
          setAuthFieldError(termsCheckbox, message);
          return;
        }

        setAuthSubmitButtonState(regBtn, 'Creating…', true);
        try {
          const firstName = regFirstName ? regFirstName.value.trim() : '';
          const lastName = regLastName ? regLastName.value.trim() : '';
          const email = regEmail.value.trim();
          const roleHidden = document.getElementById('reg-role');
          const role = roleHidden && roleHidden.value ? roleHidden.value : 'customer';
          const marketingEl = document.getElementById('reg-marketing');
          const marketingOptIn = !!(marketingEl && marketingEl.checked);

          // Profile fields
          const locationEl = document.getElementById('reg-location');
          const location = locationEl ? locationEl.value.trim() : '';
          const postcodeEl = document.getElementById('reg-postcode');
          const postcode = postcodeEl ? postcodeEl.value.trim() : '';

          // Supplier-specific fields
          const companyEl = document.getElementById('reg-company');
          const company = companyEl ? companyEl.value.trim() : '';
          const jobTitleEl = document.getElementById('reg-jobtitle');
          const jobTitle = jobTitleEl ? jobTitleEl.value.trim() : '';
          const websiteEl = document.getElementById('reg-website');
          const website = websiteEl ? websiteEl.value.trim() : '';

          // Social media fields
          const instagramEl = document.getElementById('reg-instagram');
          const facebookEl = document.getElementById('reg-facebook');
          const twitterEl = document.getElementById('reg-twitter');
          const linkedinEl = document.getElementById('reg-linkedin');
          const socials = {
            instagram: instagramEl ? instagramEl.value.trim() : '',
            facebook: facebookEl ? facebookEl.value.trim() : '',
            twitter: twitterEl ? twitterEl.value.trim() : '',
            linkedin: linkedinEl ? linkedinEl.value.trim() : '',
          };

          // Validate required fields
          if (!location) {
            const message = 'Please select your location';
            if (regStatus) {
              regStatus.textContent = message;
            }
            setAuthFieldError(locationEl, message);
            setAuthSubmitButtonState(regBtn, 'Create account');
            return;
          }

          if (role === 'supplier' && !company) {
            const message = 'Company name is required for suppliers';
            if (regStatus) {
              regStatus.textContent = message;
            }
            setAuthFieldError(companyEl, message);
            setAuthSubmitButtonState(regBtn, 'Create account');
            return;
          }

          const payload = {
            firstName,
            lastName,
            email,
            password,
            role,
            marketingOptIn,
            location,
            postcode,
            company,
            jobTitle,
            website,
            socials,
          };

          // Capture partner referral code from URL (?ref=p_XXXXXXXX) and include in payload
          // so the server can attribute this supplier signup to the referring partner.
          const refParam = new URLSearchParams(window.location.search).get('ref');
          if (refParam) {
            payload.ref = refParam;
          }

          // Carry the specific unclaimed Supplier Bot listing through from the
          // "claim this listing" link (see auth-init.js), so the server submits
          // an explicit claim for that exact profile instead of only relying on
          // an email/website match after the account is created.
          const claimSupplierIdEl = document.getElementById('reg-claim-supplier-id');
          const claimSupplierId = claimSupplierIdEl ? claimSupplierIdEl.value.trim() : '';
          if (claimSupplierId) {
            payload.claimSupplierId = claimSupplierId;
          }

          // Include ALTCHA payload if the widget is present in the form.
          // Priority order: statechange-captured global → Shadow DOM hidden input → .value property.
          // Prefer lookup by id; fall back to a container-scoped query in case the widget was
          // replaced/re-rendered and lost its id attribute (e.g. after a DOM replacement).
          const altchaContainer = document.getElementById('reg-altcha-container');
          const altchaWidget =
            document.getElementById('reg-altcha-widget') ||
            (altchaContainer ? altchaContainer.querySelector('altcha-widget') : null);
          if (altchaWidget) {
            let captchaToken = window.__altchaRegPayload || null;
            if (!captchaToken) {
              try {
                if (altchaWidget.shadowRoot) {
                  const shadowInput = altchaWidget.shadowRoot.querySelector('input[name="altcha"]');
                  if (shadowInput && shadowInput.value) {
                    captchaToken = shadowInput.value;
                  }
                }
              } catch {
                // Shadow DOM not accessible in this environment
              }
              if (!captchaToken) {
                captchaToken = altchaWidget.value || null;
              }
            }

            if (!captchaToken) {
              // Widget is present but not yet verified — block submission with a clear message.
              if (regStatus) {
                regStatus.textContent =
                  'Please complete the verification challenge before creating your account.';
              }
              setAuthSubmitButtonState(regBtn, 'Create account');
              return;
            }

            payload.captchaToken = captchaToken;
          } else if (window.__altchaUnavailable) {
            // Widget failed to load entirely — inform the user to refresh
            if (regStatus) {
              regStatus.textContent =
                'Verification is unavailable. Please refresh the page and try again.';
            }
            setAuthSubmitButtonState(regBtn, 'Create account');
            return;
          } else if (altchaContainer) {
            // Container exists but widget element isn't in DOM yet (still loading).
            // Block submission to prevent a guaranteed 400 from the backend.
            if (regStatus) {
              regStatus.textContent =
                'Please wait for the verification to load and complete the challenge.';
            }
            setAuthSubmitButtonState(regBtn, 'Create account');
            return;
          }

          const r = await fetch('/api/v1/auth/register', {
            method: 'POST',
            headers: getHeadersWithCsrf({ 'Content-Type': 'application/json' }),
            credentials: 'include',
            body: JSON.stringify(payload),
          });
          let data = {};
          try {
            data = await r.json();
          } catch {
            /* Ignore JSON parse errors */
          }
          if (!r.ok) {
            const errorMsg = data.error || 'Could not create account. Please check your details.';
            if (regStatus) {
              regStatus.textContent = errorMsg;
            }
          } else {
            // Helper: display the verification-pending success state and wire up resend.
            // Unverified accounts do not receive an auth cookie, so do not upload avatars or redirect yet.
            const showVerificationPending = emailAddr => {
              if (!regStatus) {
                return;
              }
              regStatus.classList.add('reg-status-visible');
              regStatus.innerHTML =
                '<span style="display:block;color:#0B8073;font-weight:500;">\u2713 Account created! Check your email to verify your account, then you can sign in.</span>' +
                '<button type="button" id="resend-verify-btn" class="auth-resend-btn cta">Resend email</button>';
              const resendBtn = document.getElementById('resend-verify-btn');
              if (resendBtn) {
                resendBtn.addEventListener('click', async () => {
                  resendBtn.disabled = true;
                  resendBtn.textContent = 'Sending...';
                  try {
                    const resendResp = await fetch('/api/v1/auth/resend-verification', {
                      method: 'POST',
                      headers: getHeadersWithCsrf({ 'Content-Type': 'application/json' }),
                      credentials: 'include',
                      body: JSON.stringify({ email: emailAddr }),
                    });
                    const resendData = await resendResp.json();
                    if (resendResp.ok) {
                      showNetworkError(resendData.message || 'Verification email sent!', 'success');
                    } else {
                      showNetworkError(resendData.error || 'Failed to send email', 'error');
                    }
                  } catch {
                    showNetworkError('Network error - please try again', 'error');
                  } finally {
                    resendBtn.disabled = false;
                    resendBtn.textContent = 'Resend email';
                  }
                });
              }
            };

            if (data.requiresVerification) {
              showVerificationPending(email);
              return;
            }

            // Handle avatar upload if file was selected. This only runs when the backend
            // established an authenticated session (for example, an already-verified owner account).
            const avatarInput = document.getElementById('reg-avatar');
            if (avatarInput && avatarInput.files && avatarInput.files[0]) {
              try {
                const formData = new FormData();
                formData.append('avatar', avatarInput.files[0]);

                const uploadRes = await fetch('/api/v1/profile/avatar', {
                  method: 'POST',
                  credentials: 'include',
                  body: formData,
                });

                if (!uploadRes.ok) {
                  console.warn('Avatar upload failed, but account was created');
                }
              } catch (uploadErr) {
                console.warn('Avatar upload error:', uploadErr);
              }
            }

            // Check if there's a redirect parameter
            const urlParams = new URLSearchParams(window.location.search);
            const redirect = urlParams.get('redirect');
            const plan = urlParams.get('plan');

            if (redirect) {
              // Validate redirect is safe: same-origin and allowlisted for user's role
              const user = data.user || {};
              const isValidRedirect = validateRedirectForRole(redirect, user.role);
              if (isValidRedirect) {
                // Preserve plan parameter if it exists
                let redirectUrl = redirect;
                if (plan && !redirect.includes('plan=')) {
                  const separator = redirect.includes('?') ? '&' : '?';
                  redirectUrl = `${redirect}${separator}plan=${encodeURIComponent(plan)}`;
                }
                if (regStatus) {
                  regStatus.textContent = 'Account created! Redirecting...';
                }
                setTimeout(() => {
                  window.location.href = redirectUrl;
                }, 1000);
              } else {
                console.warn(
                  `Ignoring untrusted redirect param: ${redirect} for role: ${user.role}`
                );
                // Don't redirect - fall through to show verification message
                showVerificationPending(email);
              }
            } else {
              showVerificationPending(email);
            }
          }
        } catch (err) {
          if (regStatus) {
            regStatus.textContent = 'Network error – please try again.';
          }
          console.error('Register error', err);
        } finally {
          setAuthSubmitButtonState(regBtn, 'Create account');
        }
      });
    }
  }

  // Attach password visibility toggles to any remaining fields on any page
  // (the guard in attachPasswordToggle prevents double-initialization)
  document.querySelectorAll('.form-row input[type="password"]').forEach(attachPasswordToggle);

  // Defensive cleanup: if a wrapper somehow ended up with more than one .password-toggle
  // (e.g. from a legacy or browser-injected duplicate), keep only the last one so a single
  // custom toggle remains visible.
  document.querySelectorAll('.auth-pw-wrap, .auth-input-wrap').forEach(wrapper => {
    const toggles = wrapper.querySelectorAll('.password-toggle');
    if (toggles.length > 1) {
      for (let i = 0; i < toggles.length - 1; i++) {
        toggles[i].remove();
      }
    }
  });
});

// Email verification page
// Overridden in verify-init.js but provided as fallback
// eslint-disable-next-line no-unused-vars
async function initVerify() {
  const statusEl = document.getElementById('verify-status');
  const nextEl = document.getElementById('verify-next');
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  if (!token) {
    if (statusEl) {
      statusEl.innerHTML =
        'No verification token provided. Please check your email for the verification link. ' +
        '<div style="margin-top:16px;">' +
        '<input type="email" id="resend-email" placeholder="Enter your email" style="padding:8px;border:1px solid #ccc;border-radius:4px;margin-right:8px;">' +
        '<button type="button" id="resend-verify-btn" class="ef-cta btn btn-primary">Send new verification email</button>' +
        '</div>';

      // Add resend handler
      const resendBtn = document.getElementById('resend-verify-btn');
      const emailInput = document.getElementById('resend-email');
      if (resendBtn && emailInput) {
        resendBtn.addEventListener('click', async () => {
          const email = emailInput.value.trim();
          if (!email) {
            showNetworkError('Please enter your email address', 'error');
            return;
          }
          resendBtn.disabled = true;
          resendBtn.textContent = 'Sending...';
          try {
            const resendResp = await fetch('/api/v1/auth/resend-verification', {
              method: 'POST',
              headers: getHeadersWithCsrf({ 'Content-Type': 'application/json' }),
              credentials: 'include',
              body: JSON.stringify({ email }),
            });
            const resendData = await resendResp.json();
            if (resendResp.ok) {
              showNetworkError(resendData.message || 'Verification email sent!', 'success');
              statusEl.innerHTML = `<p class="small">${escapeHtml(resendData.message || 'Verification email sent! Check your inbox.')}</p>`;
            } else {
              showNetworkError(resendData.error || 'Failed to send email', 'error');
            }
          } catch {
            showNetworkError('Network error - please try again', 'error');
          } finally {
            resendBtn.disabled = false;
            resendBtn.textContent = 'Send new verification email';
          }
        });
      }
    }
    return;
  }

  try {
    const r = await fetch(`/api/v1/auth/verify?token=${encodeURIComponent(token)}`, {
      credentials: 'include',
    });
    const data = await r.json();

    if (!r.ok) {
      if (statusEl) {
        let errorMessage = '';
        if (data.error && data.error.includes('Invalid or expired')) {
          errorMessage =
            'This verification link is invalid or has expired. Please request a new verification email.';
        } else {
          errorMessage = data.error || 'Verification failed. Please try again or contact support.';
        }

        // Show error message with resend option
        statusEl.innerHTML =
          `<p class="small">${escapeHtml(errorMessage)}</p>` +
          `<div style="margin-top:16px;">` +
          `<input type="email" id="resend-email" placeholder="Enter your email" style="padding:8px;border:1px solid #ccc;border-radius:4px;margin-right:8px;">` +
          `<button type="button" id="resend-verify-btn" class="ef-cta btn btn-primary">Send new verification email</button>` +
          `</div>`;

        // Add resend handler
        const resendBtn = document.getElementById('resend-verify-btn');
        const emailInput = document.getElementById('resend-email');
        if (resendBtn && emailInput) {
          resendBtn.addEventListener('click', async () => {
            const email = emailInput.value.trim();
            if (!email) {
              showNetworkError('Please enter your email address', 'error');
              return;
            }
            resendBtn.disabled = true;
            resendBtn.textContent = 'Sending...';
            try {
              const resendResp = await fetch('/api/v1/auth/resend-verification', {
                method: 'POST',
                headers: getHeadersWithCsrf({ 'Content-Type': 'application/json' }),
                credentials: 'include',
                body: JSON.stringify({ email }),
              });
              const resendData = await resendResp.json();
              if (resendResp.ok) {
                showNetworkError(resendData.message || 'Verification email sent!', 'success');
                statusEl.innerHTML = `<p class="small">${escapeHtml(resendData.message || 'Verification email sent! Check your inbox.')}</p>`;
              } else {
                showNetworkError(resendData.error || 'Failed to send email', 'error');
              }
            } catch {
              showNetworkError('Network error - please try again', 'error');
            } finally {
              resendBtn.disabled = false;
              resendBtn.textContent = 'Send new verification email';
            }
          });
        }
      }
    } else {
      if (statusEl) {
        statusEl.textContent = '✓ Your email has been verified successfully!';
      }
      if (nextEl) {
        nextEl.style.display = 'block';
      }
      // Auto-redirect to login after 3 seconds
      setTimeout(() => {
        window.location.href = '/auth';
      }, 3000);
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = 'Network error. Please check your connection and try again.';
    }
    console.error('Verification error', err);
  }
}

// Settings page
async function initSettings() {
  try {
    const r = await fetch('/api/v1/me/settings', {
      credentials: 'include',
    });

    if (r.status === 401) {
      // Not authenticated - handle gracefully without console error
      const container = document.querySelector('main .container');
      if (container) {
        container.innerHTML = '';
        const card = document.createElement('div');
        card.className = 'card';
        const text = document.createElement('p');
        text.className = 'small';
        text.textContent = 'Sign in to change your settings.';
        card.appendChild(text);
        container.appendChild(card);
      }
      return;
    }

    if (!r.ok) {
      throw new Error('Failed to load settings');
    }

    const d = await r.json();
    const cb = document.getElementById('notify');
    if (cb) {
      cb.checked = !!d.notify;
    }

    const saveBtn = document.getElementById('save-settings');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const rr = await fetch('/api/v1/me/settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
          },
          credentials: 'include',
          body: JSON.stringify({ notify: document.getElementById('notify').checked }),
        });
        if (rr.ok) {
          const statusEl = document.getElementById('settings-status');
          if (statusEl) {
            statusEl.textContent = 'Saved';
            setTimeout(() => (statusEl.textContent = ''), 1200);
          }
        }
      });
    }
  } catch (e) {
    console.error('Settings error:', e);
    const container = document.querySelector('main .container');
    if (container) {
      container.innerHTML = '';
      const card = document.createElement('div');
      card.className = 'card';
      const text = document.createElement('p');
      text.className = 'small';
      text.textContent = 'Unable to load settings.';
      card.appendChild(text);
      container.appendChild(card);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.__EF_PAGE__ === 'settings') {
    initSettings();
  }
});

// Simple pageview beacon - deferred to ensure CSRF token is loaded
// Fixes 403 Forbidden error from empty CSRF token
(function sendPageview() {
  // Wait for CSRF token to be available or timeout after 2 seconds
  const maxWait = 2000;
  const startTime = Date.now();
  let timeoutId = null;
  let hasSent = false;

  function attemptSend() {
    // Prevent sending after page unload or if already sent
    if (hasSent || document.hidden) {
      return;
    }

    if (window.__CSRF_TOKEN__) {
      hasSent = true;
      fetch('/api/v1/metrics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.__CSRF_TOKEN__ },
        credentials: 'include',
        body: JSON.stringify({ type: 'pageview', meta: { path: location.pathname } }),
      })
        .then(response => {
          // Silently handle 403/401 - metrics endpoint may not be configured
          if (!response.ok && window.location.hostname === 'localhost') {
            console.info('Metrics tracking not available');
          }
        })
        .catch(() => {
          // Silently ignore network errors for tracking beacon
        });
    } else if (Date.now() - startTime < maxWait) {
      // Retry after a short delay
      timeoutId = setTimeout(attemptSend, 100);
    }
    // If token isn't available after maxWait, skip silently (it's just a tracking beacon)
  }

  // Clean up timeout on page unload to prevent memory leak
  window.addEventListener(
    'beforeunload',
    () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
    { once: true }
  );

  attemptSend();
})();

// Admin charts
async function adminCharts() {
  try {
    const r = await fetch('/api/v1/admin/metrics/timeseries', {
      credentials: 'include',
    });
    if (!r.ok) {
      return;
    }
    const d = await r.json();
    const c = document.createElement('canvas');
    c.id = 'chart';
    document.querySelector('#metrics').after(c);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js';
    s.addEventListener('load', () => {
      const ctx = c.getContext('2d');
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: d.days,
          datasets: [
            { label: 'Pageviews', data: d.pageviews },
            { label: 'Signups', data: d.signups },
            { label: 'Messages', data: d.messages },
          ],
        },
      });
    });
    document.body.appendChild(s);
  } catch {
    /* Ignore confetti errors */
  }
}

// Supplier onboarding checklist visual (client side)
function renderSupplierChecklist(wrapper, supplierCount, packageCount, supplierApproved) {
  const steps = [
    { name: 'Create a supplier profile', done: supplierCount > 0 },
    { name: 'Get approved by admin', done: supplierApproved },
    { name: 'Add at least one package', done: packageCount > 0 },
  ];
  wrapper.innerHTML = `
    <div class="supplier-card-header sd-card-header sd-card-header--teal">
      <div class="sd-card-header__left">
        <div class="sd-card-header__title-row">
          <div class="sd-card-header__icon sd-card-header__icon--teal" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 11l3 3L22 4"/>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
          </div>
          <h3 class="sd-card-header__heading">Onboarding</h3>
        </div>
        <p class="sd-card-header__subtitle">Complete these steps to get started</p>
      </div>
    </div>
    <div class="sd-card-body">
      <ul class="health-checklist">
        ${steps
          .map(
            s => `<li class="health-checklist-item ${s.done ? 'completed' : 'incomplete'}">
          <span class="health-checklist-icon" aria-label="${s.done ? 'Completed' : 'Incomplete'}">${s.done ? '✓' : '○'}</span>
          <span class="health-checklist-text">${escapeHtml(s.name)}</span>
        </li>`
          )
          .join('')}
      </ul>
    </div>`;
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.__EF_PAGE__ === 'admin') {
    adminCharts();
  }
  if (window.__EF_PAGE__ === 'dash_supplier') {
    (async () => {
      try {
        const meResponse = await fetch('/api/v1/me/suppliers', {
          credentials: 'include',
        });
        const ms = await meResponse.json();
        const pk = await fetch('/api/v1/me/packages', {
          credentials: 'include',
        });
        const mp = await pk.json();
        const supplierItems = ms.items || [];
        const supplierApproved = supplierItems.some(s => s.approved === true);
        const box = document.createElement('div');
        box.className = 'card sd-card supplier-dashboard-card';
        // Starts expanded on mobile/tablet (card-collapse.js collapses .sd-card
        // by default below 1024px unless told otherwise) — matches the
        // "Your Supplier Profile" card just below it, and this one is now the
        // first thing after the hero, so collapsing it by default would undercut
        // the point of moving it up here.
        box.dataset.defaultExpanded = 'true';
        // Placed right after the hero card rather than appended at the end of
        // the page: this checklist (create profile → get approved → add a
        // package) is the single most useful thing a new supplier can see,
        // and previously landed after every other section — roughly 8,000px
        // down the page — where a first-time visitor would rarely scroll.
        const welcomeSection = document.getElementById('welcome-section');
        const container = document.querySelector('main .container');
        if (welcomeSection && welcomeSection.parentElement === container) {
          welcomeSection.insertAdjacentElement('afterend', box);
        } else {
          container.appendChild(box);
        }
        renderSupplierChecklist(
          box,
          supplierItems.length,
          (mp.items || []).length,
          supplierApproved
        );
      } catch {
        /* Ignore checklist render errors */
      }
    })();
  }
});

// === Experimental features (EventFlow Experimental v2) ===

// Simple loader overlay: fades out shortly after load
function efInitLoader() {
  const loader = document.getElementById('ef-loader');
  if (!loader) {
    return;
  }
  const hide = () => {
    loader.classList.add('loader-hidden');
    setTimeout(() => loader.remove(), 400);
  };
  window.addEventListener('load', () => {
    setTimeout(hide, 600);
  });
}

// Brand wordmark animation: collapse text after initial reveal
function efInitBrandAnimation() {
  const brandText = document.querySelector('.brand-text');
  if (!brandText) {
    return;
  }
  if (brandText.dataset.animated === 'true') {
    return;
  }
  brandText.dataset.animated = 'true';

  brandText.style.display = 'inline-block';
  brandText.style.whiteSpace = 'nowrap';
  brandText.style.overflow = 'hidden';

  const initialWidth = brandText.offsetWidth;
  brandText.style.width = `${initialWidth}px`;
  brandText.style.transition = 'opacity 0.45s ease, width 0.45s ease, margin 0.45s ease';

  setTimeout(() => {
    brandText.style.opacity = '0';
    brandText.style.width = '0';
    brandText.style.marginLeft = '0';
  }, 3000);
}

// Venue map: uses browser geolocation or postcode to set an embedded map
function efInitVenueMap() {
  const mapFrame = document.getElementById('venue-map');
  if (!mapFrame) {
    return;
  }
  const useBtn = document.getElementById('map-use-location');
  const form = document.getElementById('map-postcode-form');
  const input = document.getElementById('map-postcode');
  const status = document.getElementById('map-status');
  const LAST_QUERY_KEY = 'ef:lastMapQuery';
  const LAST_QUERY_LABEL_KEY = 'ef:lastMapLabel';
  const DEFAULT_QUERY = 'wedding venues in the UK';

  // Fetch Google Maps API key from server
  let mapsApiKey = '';
  fetch('/api/v1/config')
    .then(res => res.json())
    .then(config => {
      mapsApiKey = config.googleMapsApiKey || '';
    })
    .catch(() => {
      setStatus('Showing default UK map view.');
    })
    .finally(() => {
      showDefaultMap();
    });

  function setStatus(msg) {
    if (!status) {
      return;
    }
    status.textContent = msg || '';
  }

  function buildMapUrl(query) {
    if (!query) {
      return mapFrame.src;
    }
    const encodedQuery = encodeURIComponent(query);
    if (mapsApiKey) {
      return `https://www.google.com/maps/embed/v1/search?key=${encodeURIComponent(mapsApiKey)}&q=${encodedQuery}`;
    }
    return `https://www.google.com/maps?q=${encodedQuery}&output=embed`;
  }

  function showDefaultMap() {
    let savedQuery = '';
    let savedLabel = '';
    try {
      savedQuery = localStorage.getItem(LAST_QUERY_KEY) || '';
      savedLabel = localStorage.getItem(LAST_QUERY_LABEL_KEY) || '';
    } catch {
      /* Ignore storage errors */
    }

    const trimmed = savedQuery.trim();
    const baseQuery = trimmed ? `wedding venues near ${trimmed}` : DEFAULT_QUERY;
    const label = (savedLabel || trimmed).trim();
    mapFrame.src = buildMapUrl(baseQuery);
    mapFrame.style.display = 'block';
    setStatus(
      trimmed
        ? `Showing results near "${label || trimmed}".`
        : 'Showing venues across the UK. Share your location to refine your results.'
    );
  }

  function updateForQuery(q, labelOverride) {
    const cleaned = (q || '').trim();
    if (!cleaned) {
      return;
    }
    const query = `wedding venues near ${cleaned}`;
    mapFrame.src = buildMapUrl(query);
    mapFrame.style.display = 'block';

    const label = labelOverride || cleaned;
    setStatus(`Showing results near "${label}".`);
    try {
      localStorage.setItem(LAST_QUERY_KEY, cleaned);
      localStorage.setItem(LAST_QUERY_LABEL_KEY, label);
    } catch {
      /* Ignore storage errors */
    }
  }

  if (useBtn && navigator.geolocation) {
    useBtn.addEventListener('click', () => {
      setStatus('Requesting your location…');
      navigator.geolocation.getCurrentPosition(
        pos => {
          const { latitude, longitude } = pos.coords;
          const query = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
          updateForQuery(query, 'your location');
        },
        err => {
          setStatus(
            `Could not access your location (${err.message}). You can type a postcode instead.`
          );
        }
      );
    });
  }

  if (form && input) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) {
        setStatus('Type a postcode first.');
        return;
      }
      updateForQuery(val);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    efInitLoader();
  } catch {
    /* Ignore loader init errors */
  }
  try {
    efInitBrandAnimation();
  } catch {
    /* Ignore brand animation errors */
  }
  try {
    efInitVenueMap();
  } catch {
    /* Ignore map init errors */
  }
});

// Experimental v3: scroll reveal for .reveal elements
document.addEventListener('DOMContentLoaded', () => {
  try {
    const els = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
    if (!('IntersectionObserver' in window) || els.length === 0) {
      els.forEach(el => el.classList.add('is-visible'));
      return;
    }
    const obs = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.18 }
    );
    els.forEach(el => obs.observe(el));
  } catch {
    /* Ignore IntersectionObserver errors */
  }
});

// Experimental v4: simple confetti burst
// Called by verify-init.js on successful verification
// eslint-disable-next-line no-unused-vars
function efConfetti() {
  try {
    const layer = document.createElement('div');
    layer.className = 'confetti-layer';
    const colors = ['#22C55E', '#F97316', '#EAB308', '#38BDF8', '#A855F7', '#EC4899'];
    const pieces = 80;
    for (let i = 0; i < pieces; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      const left = Math.random() * 100;
      const delay = Math.random() * 0.4;
      const dur = 0.7 + Math.random() * 0.4;
      const color = colors[Math.floor(Math.random() * colors.length)];
      el.style.left = `${left}%`;
      el.style.top = `${-20 + Math.random() * 20}px`;
      el.style.backgroundColor = color;
      el.style.animationDelay = `${delay}s`;
      el.style.animationDuration = `${dur}s`;
      layer.appendChild(el);
    }
    document.body.appendChild(layer);
    setTimeout(() => {
      layer.remove();
    }, 1300);
  } catch {
    /* Ignore loader removal errors */
  }
}

// --- Supplier image file preview ---
(function () {
  const input = document.getElementById('sup-photos-file');
  const preview = document.getElementById('sup-photos-preview');
  if (!input || !preview) {
    return;
  }

  input.addEventListener('change', () => {
    while (preview.firstChild) {
      preview.removeChild(preview.firstChild);
    }
    const files = Array.prototype.slice.call(input.files || []);
    if (!files.length) {
      return;
    }

    const max = 6;
    files.slice(0, max).forEach(file => {
      if (!file.type || !file.type.startsWith('image/')) {
        return;
      }
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        if (!reader.result || typeof reader.result !== 'string') {
          return;
        }
        const url = reader.result;
        const item = document.createElement('div');
        item.className = 'thumb';
        const img = document.createElement('img');
        img.src = url;
        img.alt = file.name || 'Selected image';
        item.appendChild(img);
        preview.appendChild(item);
      });
      reader.readAsDataURL(file);
    });
  });
})();
