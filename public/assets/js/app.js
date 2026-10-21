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
    if (img.dataset.fallbackText !== undefined && img.parentNode) {
      // A photo that will not load becomes the person's initials (a plain, clearly generic fallback).
      const initials = document.createElement('span');
      initials.className = 'ef-img-fallback-initials';
      initials.textContent = img.dataset.fallbackText;
      img.replaceWith(initials);
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

/**
 * Escapes text for use inside a double- or single-quoted HTML attribute (aria-label, title, data-*,
 * src, href). escapeHtml leaves quotes alone, so a package called 6" cake would end its own
 * attribute; this also turns both kinds of quote into entities.
 * @param {*} unsafe - The value to escape (non-strings become an empty string).
 * @returns {string} Text safe to place between attribute quotes.
 */
function escapeAttr(unsafe) {
  return escapeHtml(unsafe).split('"').join('&quot;').split("'").join('&#39;');
}

/**
 * The price to show for a package: what the supplier typed (`price`), or the older
 * `price_display`; nothing when neither is there.
 * @param {Object} p - Package record.
 * @returns {string} The price text, or ''.
 */
function packagePriceText(p) {
  const typed = p.price_display || p.price;
  return typed === undefined || typed === null ? '' : String(typed).trim();
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
      '/guests',
      '/guests.html',
      '/start',
      '/start.html',
    ],
  };

  const allowed = allowedPaths[userRole] || [];
  return allowed.includes(pathname);
}

// Shared banner used by explicit page actions that need inline network feedback.
let efErrorBanner = null;

function showNetworkError(message, type = 'error') {
  try {
    if (!efErrorBanner) {
      efErrorBanner = document.createElement('div');
      efErrorBanner.id = 'ef-network-error';
      efErrorBanner.style.position = 'fixed';
      efErrorBanner.style.bottom = '1rem';
      efErrorBanner.style.left = '50%';
      efErrorBanner.style.transform = 'translateX(-50%)';
      efErrorBanner.style.padding = '0.75rem 1.25rem';
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
    efErrorBanner.style.background = type === 'success' ? '#0f766e' : '#b00020';
    efErrorBanner.style.opacity = '1';
    clearTimeout(efErrorBanner._hideTimer);
    efErrorBanner._hideTimer = setTimeout(() => {
      efErrorBanner.style.opacity = '0';
    }, 5000);
  } catch {
    /* Ignore banner display errors */
  }
}

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

// skipcq: JS-R1005 -- Supplier-card rendering intentionally centralises badge
// priority and compatibility rules (mirrors verification-badges.js); the
// complexity is inherent to that, not something a structural split would
// remove without duplicating the ordering logic across pieces.
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

  // Raw stored tier value, kept only to detect the legacy `subscriptionTier:
  // 'featured'` sentinel (still read by package-list.js / lead-quality-helper.js)
  // below -- resolved before the Featured check since that sentinel is itself
  // one of the signals that counts as Featured.
  const rawTier = s.subscriptionTier || s.subscription?.tier || null;

  // Featured badge -- a curation flag, not a subscription tier, so it's
  // checked independently of the tier ladder (a supplier is never "on the
  // featured tier"; tier and Featured can both be true at once). Two live
  // sources: the modern package-level flag (featuredSupplier, joined by the
  // API from the packages collection) and the legacy stored tier value.
  if (s.featured || s.featuredSupplier || rawTier === 'featured') {
    supplierBadges.push('<span class="badge badge-featured">Featured</span>');
  }

  // Starter/Pro/Pro Plus badge -- shared with lead-quality-helper.js,
  // package-list.js and supplier-profile.js via EFTierIcon
  // (utils/tier-icon.js) so the label can't drift between them.
  // (admin-suppliers-init.js keeps its own resolution -- it also has to
  // recognise a legacy 'cancelled' subscription.tier value, which this
  // shared resolver doesn't.)
  if (rawTier !== 'featured') {
    supplierBadges.push(
      typeof EFTierIcon !== 'undefined'
        ? EFTierIcon.renderBadge(s)
        : '<span class="badge badge-starter">Starter</span>'
    );
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

function efMaybeShowOnboarding(page) {
  // Check if onboarding has been permanently dismissed (either key suffices)
  try {
    const dismissed = localStorage.getItem('ef_onboarding_dismissed');
    if (dismissed === '1') {
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

  // Admin: a short welcome card.
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

/**
 * Tells the supplier dashboard home script that something it summarises (the profile or the
 * packages) changed, so it asks the server for fresh numbers.
 */
function notifyDashboardChanged() {
  document.dispatchEvent(new CustomEvent('sdh:changed'));
}

/**
 * Tell the supplier something through the dashboard's single toast, falling back to alert().
 * @param {string} message - What to say.
 * @param {string} [type] - success, error or info.
 */
function efSay(message, type) {
  const home = window.SupplierDashboardHome;
  if (home && typeof home.toast === 'function') {
    home.toast(message, type || 'info');
  } else {
    window.alert(message);
  }
}

/**
 * Ask the supplier to confirm a destructive action in the dashboard's own dialog, falling back
 * to the browser's confirm() when that dialog is not on the page.
 * @param {{title: string, message: string, confirmLabel: string}} options - What to ask.
 * @returns {Promise<boolean>} True when the supplier confirmed.
 */
function efConfirm(options) {
  const home = window.SupplierDashboardHome;
  if (home && typeof home.confirm === 'function') {
    return home.confirm(options);
  }
  return Promise.resolve(window.confirm(options.message || options.title));
}

/** Message shown in #pkg-status when the free-tier active package limit is reached. */
const PKG_LIMIT_MESSAGE =
  'You have reached the active package limit on the Starter plan. Upgrade to Pro to add more.';

async function initDashSupplier() {
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
  let currentEditingSupplierId = null; // Track which supplier is being edited

  // "Other areas you serve" picker state — named cities, and a single
  // nationwide claim, that a supplier picks on top of (or instead of) a
  // travel radius from one base. Declared here, ahead of every reader, rather
  // than beside the functions that use them further down this scope.
  const NATIONWIDE_PICK_NAME = 'Nationwide (all of the UK)';
  let supplierServiceAreaPicks = [];
  let supplierServiceAreaAllowance = 2; // Free-plan default, until the real allowance loads.
  let supplierServiceAreaSearchTimer = null;
  /** Currently rendered, not-yet-picked search results — lets Enter pick the top one. */
  let supplierServiceAreaSearchResults = [];
  /** Bumped on every search request so a slower, older response can't overwrite a newer one. */
  let supplierServiceAreaSearchRequestId = 0;

  /**
   * Plan label for the profile card badge, from the supplier record. The dashboard home script
   * replaces it with the plan from the dashboard summary once that has loaded, so a stale
   * supplier record cannot show the wrong plan for long.
   * @param {Object} supplier - Supplier record.
   * @returns {string} Pro Plus, Pro or Starter.
   */
  function supplierTierLabel(supplier) {
    const tier =
      supplier.subscriptionTier ||
      (supplier.subscription && supplier.subscription.tier) ||
      (supplier.isPro || supplier.pro ? 'pro' : null);
    if (tier === 'pro_plus') {
      return 'Pro Plus';
    }
    return tier === 'pro' ? 'Pro' : 'Starter';
  }

  /**
   * The profile card: photo, name, plan and approval badges, where and what. The edit form
   * opens from the card header; this only carries the photo controls.
   * @param {Object} supplier - Supplier record.
   * @param {string} photoUrl - Already escaped profile photo URL, or ''.
   * @param {string} initials - Already escaped initials shown when there is no photo.
   * @returns {string} Card markup.
   */
  function supplierCardHtml(supplier, photoUrl, initials) {
    const supplierId = escapeAttr(String(supplier.id || ''));
    const name = escapeHtml(String(supplier.name || 'Unnamed supplier'));
    const meta = [supplier.location, supplier.category]
      .filter(part => part && String(part).trim())
      .map(part => escapeHtml(String(part)))
      .join(' · ');
    const approval = supplier.approved
      ? '<span class="sdh-pill sdh-pill--ok">Approved</span>'
      : '<span class="sdh-pill sdh-pill--warn">Awaiting review</span>';
    return `<div class="sdh-profile" data-supplier-id="${supplierId}">
      <div class="sdh-profile__avatar">
        <div class="supplier-profile-photo-slot sdh-avatar" data-avatar-key="${supplierId}">${
          photoUrl
            ? `<img src="${photoUrl}" alt="Your profile photo" data-fallback-text="${initials.split('"').join('&quot;').split("'").join('&#39;')}">`
            : initials
        }</div>
        ${
          photoUrl
            ? `<button type="button" class="sdh-avatar__remove" data-action="delete-profile-photo" data-profile-id="${supplierId}" title="Delete profile photo" aria-label="Delete profile photo"><span aria-hidden="true">&times;</span></button>`
            : ''
        }
        <label for="supplier-profile-photo-upload-${supplierId}" class="sdh-avatar__camera">
          <span class="sdh-sr">Upload profile photo</span>
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </label>
        <input type="file" id="supplier-profile-photo-upload-${supplierId}" class="supplier-profile-photo-upload sdh-sr" data-profile-id="${supplierId}" accept="image/*">
      </div>
      <div class="sdh-profile__main">
        <div class="sdh-profile__name-row">
          <h3 class="sdh-profile__name">${name}</h3>
          <span class="sdh-pill sdh-pill--accent" data-sdh-tier>${supplierTierLabel(supplier)}</span>
          ${approval}
        </div>
        ${meta ? `<p class="sdh-profile__meta">${meta}</p>` : ''}
      </div>
      <div class="sdh-profile__actions">
        <button type="button" class="sdh-btn sdh-btn--secondary sdh-btn--sm" data-action="upload-photo" data-profile-id="${supplierId}">Add photos</button>
      </div>
    </div>`;
  }

  /** The profile card's body for a supplier who has no profile yet: one short explanation, one button. */
  const SUPPLIER_EMPTY_HTML =
    '<div class="sdh-empty"><p class="sdh-empty__title">Create your business profile</p><p class="sdh-empty__text">Add your business name, category and location to start. You can fill in the rest later, and customers see your profile once we have approved it.</p><button type="button" class="sdh-btn sdh-btn--primary" data-sdh-action="edit-profile" data-sdh-focus="sup-name">Create profile</button></div>';

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
        return typeof found === 'string' ? escapeAttr(found.trim()) : '';
      };
      const profileInitial = escapeHtml(
        (profileDisplayName || '')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map(part => part.charAt(0).toUpperCase())
          .join('') || 'U'
      );
      window._efCachedSuppliers = items; // Expose globally for editProfile()
      const hasSupplierProfile = items.length > 0;
      const hasApprovedSupplierProfile = items.some(s => s && s.approved === true);
      window._supplierProfileMissing = !hasSupplierProfile;
      window._supplierApprovalBlocked = hasSupplierProfile && !hasApprovedSupplierProfile;
      // The dashboard home script switches the page to its "no profile yet" layout from this.
      document.dispatchEvent(new CustomEvent('sdh:suppliers', { detail: { suppliers: items } }));

      if (!supWrap) {
        return;
      }

      const toggleBtn = document.getElementById('toggle-profile-form');
      if (!hasSupplierProfile) {
        supWrap.innerHTML = SUPPLIER_EMPTY_HTML;
        const emptyLabel = toggleBtn && toggleBtn.querySelector('.label');
        if (
          emptyLabel &&
          !document.getElementById('profile-form-section')?.classList.contains('expanded')
        ) {
          emptyLabel.textContent = 'Create profile';
        }
        return;
      }

      supWrap.innerHTML = items
        .filter(Boolean)
        .map(s =>
          supplierCardHtml(
            s,
            resolveDashboardSupplierProfilePhoto(s),
            escapeHtml(
              (window.EFSupplierAvatar && window.EFSupplierAvatar.getSupplierInitials(s.name)) ||
                profileInitial
            )
          )
        )
        .join('');
      // Initials sit on the supplier's own colour; the colour is data, so it is set from script.
      supWrap.querySelectorAll('.sdh-avatar').forEach(slot => {
        if (!slot.querySelector('img')) {
          slot.style.background = window.EFSupplierAvatar
            ? window.EFSupplierAvatar.getSupplierAvatarGradient(slot.dataset.avatarKey)
            : '';
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
            notifyDashboardChanged();
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
          .map(
            s =>
              `<option value="${escapeHtml(String(s.id))}">${escapeHtml(String(s.name))}</option>`
          )
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

      // Fill the edit form with the supplier being edited, else the first one, so opening it
      // always shows the saved profile.
      let supplierToEdit = items[0];
      if (currentEditingSupplierId) {
        const foundSupplier = items.find(s => s && s.id === currentEditingSupplierId);
        if (foundSupplier) {
          supplierToEdit = foundSupplier;
        }
      }
      populateSupplierForm(supplierToEdit);

      // One profile per supplier: the toggle says "Edit profile" and the form heading too.
      const labelSpan = toggleBtn && toggleBtn.querySelector('.label');
      if (
        labelSpan &&
        !document.getElementById('profile-form-section')?.classList.contains('expanded')
      ) {
        labelSpan.textContent = 'Edit profile';
      }
      const sectionHeading = document.querySelector(
        '#profile-form-section .supplier-section-header'
      );
      if (sectionHeading) {
        sectionHeading.textContent = 'Edit profile';
      }
    } catch (err) {
      console.error('Error loading suppliers:', err);
      document.dispatchEvent(
        new CustomEvent('sdh:suppliers', { detail: { suppliers: null, failed: true } })
      );
      if (supWrap) {
        supWrap.innerHTML =
          '<div class="sdh-empty"><p class="sdh-empty__title">Could not load your profile</p><p class="sdh-empty__text">Check your connection and try again.</p><button type="button" class="sdh-btn sdh-btn--secondary sdh-btn--sm" data-sdh-action="reload">Try again</button></div>';
      }
    }
  }

  /**
   * Populate supplier form with existing supplier data
   * @param {Object} supplier - Supplier data
   */
  // skipcq: JS-R1005 -- Pre-existing: this function sets ~40 form fields from
  // one supplier object. This PR's only footprint is one small if/supplier.id
  // check to show/hide the "manage gallery" link — splitting the rest of this
  // function apart is a larger, riskier change than that addition calls for.
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
    const supManageGalleryLink = document.getElementById('sup-manage-gallery-link');
    if (supManageGalleryLink) {
      if (supplier.id) {
        supManageGalleryLink.href = `/gallery?type=supplier&id=${encodeURIComponent(supplier.id)}`;
        supManageGalleryLink.hidden = false;
      } else {
        supManageGalleryLink.hidden = true;
      }
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
    const serviceAreas = Array.isArray(supplier.serviceAreas) ? supplier.serviceAreas : [];

    if (supBasePostcode) {
      supBasePostcode.value = supplier.basePostcode || '';
    }
    if (supTravelRadius) {
      const radius = serviceAreas.find(area => area && area.type === 'radius');
      supTravelRadius.value = radius && radius.miles ? radius.miles : '';
    }

    // Self-service "picks": named cities, and a single nationwide claim,
    // shown and edited together in the same picker.
    const cityAreas = serviceAreas.filter(area => area && area.type === 'city' && area.slug);
    const hasNationwide = serviceAreas.some(area => area && area.type === 'nationwide');
    supplierServiceAreaPicks = [
      ...cityAreas.map(area => ({
        type: 'city',
        slug: area.slug,
        name: titleCaseCitySlug(area.slug),
      })),
      ...(hasNationwide ? [{ type: 'nationwide', name: NATIONWIDE_PICK_NAME }] : []),
    ];
    renderSupplierServiceAreaTags();
    loadSupplierServiceAreaAllowance();
    // Titles start as a readable guess from the slug; upgrade them to the
    // registry's canonical spelling (e.g. aliases, hyphenation) once resolved.
    if (cityAreas.length) {
      // resolveSupplierServiceAreaCityName() never rejects — a failed lookup
      // resolves to its title-cased fallback — so this needs no .catch().
      Promise.all(cityAreas.map(area => resolveSupplierServiceAreaCityName(area.slug))).then(
        names => {
          const nameBySlug = new Map(cityAreas.map((area, i) => [area.slug, names[i]]));
          supplierServiceAreaPicks = supplierServiceAreaPicks.map(pick =>
            pick.type === 'city' ? { ...pick, name: nameBySlug.get(pick.slug) || pick.name } : pick
          );
          renderSupplierServiceAreaTags();
        }
      );
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
      previewBtn.hidden = false;
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

  // Known placeholder paths a package's `image` field falls back to when it has
  // no real photo — mirrors utils/packageImageUtils.js's KNOWN_PLACEHOLDERS so
  // the "No photo" badge below agrees with the server-side nudge that uses the
  // same definition of "missing".
  const PKG_CARD_PLACEHOLDER_PATHS = new Set([
    '/assets/images/package-placeholder.webp',
    '/assets/images/package-placeholder.svg',
    '/assets/images/placeholders/package-event.svg',
    '/assets/images/placeholder-package.jpg',
  ]);

  function isKnownPlaceholderUrl(rawUrl) {
    const raw = String(rawUrl || '').trim();
    if (!raw) {
      return true;
    }
    try {
      const path = new URL(raw, window.location.origin).pathname;
      return PKG_CARD_PLACEHOLDER_PATHS.has(path);
    } catch {
      return PKG_CARD_PLACEHOLDER_PATHS.has(raw.split(/[?#]/)[0]);
    }
  }

  function isPackagePhotoMissing(p) {
    return isKnownPlaceholderUrl(p?.image);
  }

  /**
   * Package allowance for the plan, from the dashboard summary (the server's own limits), so the
   * number shown here is the number the server enforces. Resolves to limit null when the plan has
   * no limit or the summary could not be loaded; the server still refuses a package over the limit.
   * @returns {Promise<{known: boolean, limit: (number|null)}>} The allowance.
   */
  async function getPackageAllowance() {
    try {
      const home = window.SupplierDashboardHome;
      if (home && typeof home.getPackageAllowance === 'function') {
        const allowance = await home.getPackageAllowance();
        return { known: Boolean(allowance.known), limit: allowance.limit };
      }
    } catch {
      /* Fall through: the limit is unknown, the server decides. */
    }
    return { known: false, limit: null };
  }

  /**
   * The line under the "Your packages" heading: how much of the plan is used, from real counts.
   * @param {number} activeCount - Packages that are not paused (the ones the limit counts).
   * @param {{known: boolean, limit: (number|null)}} allowance - The plan's allowance.
   * @returns {string} The sentence.
   */
  function packageNoteText(activeCount, allowance) {
    const noun = count => `${count} active package${count === 1 ? '' : 's'}`;
    if (allowance.limit !== null) {
      if (activeCount > allowance.limit) {
        const surplus = activeCount - allowance.limit;
        return `You have ${noun(activeCount)} but your plan allows ${allowance.limit}. Pause or delete ${surplus} to stay within your limit, or upgrade.`;
      }
      return `${activeCount} of ${allowance.limit} active packages on your plan.`;
    }
    if (allowance.known) {
      return activeCount ? `${noun(activeCount)}.` : 'Add a package to show what you offer.';
    }
    return 'What you offer, and what it costs.';
  }

  /**
   * One package row: photo, title and price, status badges, and one Edit button with text links
   * for the rest.
   * @param {Object} p - Package record.
   * @returns {string} Row markup.
   */
  function packageCardHtml(p) {
    const packageId = escapeAttr(String(p.id || ''));
    const image = escapeAttr(String(p.image || '/assets/images/package-placeholder.svg'));
    const rawTitle = String(p.title || 'Untitled package');
    const title = escapeHtml(rawTitle);
    const titleAttr = escapeAttr(rawTitle);
    // The server stores what the supplier typed as `price`; `price_display` is the older name.
    const priceText = escapeHtml(packagePriceText(p));
    const description = escapeHtml(String(p.description || ''));
    const slug = escapeAttr(String(p.slug || ''));
    const approved = !!p.approved;
    const paused = !!p.paused;
    const badges = [
      p.featured ? '<span class="sdh-pill sdh-pill--accent">Featured</span>' : '',
      approved
        ? ''
        : '<span class="sdh-pill sdh-pill--warn" title="This package is awaiting approval before it appears publicly">Awaiting review</span>',
      paused
        ? '<span class="sdh-pill sdh-pill--muted" title="This package is paused and not visible publicly">Paused</span>'
        : '',
      isPackagePhotoMissing(p)
        ? '<span class="sdh-pill" title="This package shows a placeholder image to customers. Add a photo.">No photo</span>'
        : '',
    ].join('');
    const viewUnavailableReason = !approved
      ? 'This package has no public page yet: it is awaiting approval'
      : 'This package has no public page yet';
    const viewControl =
      approved && slug
        ? `<a href="/package?slug=${slug}" target="_blank" rel="noopener" class="sdh-link">View</a>`
        : `<button type="button" class="sdh-link" disabled aria-disabled="true" title="${viewUnavailableReason}">View</button>`;
    const pauseControl = `<button type="button" class="sdh-link" data-action="${paused ? 'unpause-package' : 'pause-package'}" data-package-id="${packageId}">${paused ? 'Resume' : 'Pause'}</button>`;
    return `<article class="package-card sdh-pkg${paused ? ' sdh-pkg--paused' : ''}" data-package-id="${packageId}">
      <div class="sdh-pkg__media"><img src="${image}" alt="" loading="lazy" data-fallback-src="/assets/images/package-placeholder.svg"></div>
      <div class="sdh-pkg__body">
        <div class="sdh-pkg__head">
          <h3 class="sdh-pkg__title">${title}</h3>
          ${priceText ? `<span class="sdh-pkg__price">${priceText}</span>` : ''}
        </div>
        <div class="sdh-pkg__badges">${badges}</div>
        ${description ? `<p class="sdh-pkg__desc">${description}</p>` : ''}
        <div class="sdh-pkg__actions">
          <button type="button" class="sdh-btn sdh-btn--secondary sdh-btn--sm" data-action="edit-package" data-package-id="${packageId}" aria-label="Edit ${titleAttr}">Edit</button>
          ${viewControl}
          <a href="/gallery?type=package&id=${encodeURIComponent(String(p.id || ''))}" target="_blank" rel="noopener" class="sdh-link">Photos</a>
          ${pauseControl}
          <button type="button" class="sdh-link sdh-link--danger" data-action="delete-package" data-package-id="${packageId}" aria-label="Delete ${titleAttr}">Delete</button>
        </div>
      </div>
    </article>`;
  }

  const PACKAGES_SHOWN_FIRST = 5;
  const PACKAGES_SHOWN_FIRST_PHONE = 3;

  /**
   * The package list: the first few rows, and any others folded into a real <details> so a
   * supplier with fifty packages does not push every other card off the page.
   * @param {Object[]} items - Package records.
   * @param {boolean} [keepOpen] - Whether the folded rows were open before this redraw.
   * @returns {string} List markup.
   */
  function packageListHtml(items, keepOpen) {
    const rows = items.filter(Boolean).map(packageCardHtml);
    // A phone shows fewer rows before the fold: the page there is one very long column.
    const phone = Boolean(window.matchMedia && window.matchMedia('(max-width: 767px)').matches);
    const shown = phone ? PACKAGES_SHOWN_FIRST_PHONE : PACKAGES_SHOWN_FIRST;
    const first = `<div class="sdh-pkgs">${rows.slice(0, shown).join('')}</div>`;
    if (rows.length <= shown) {
      return first;
    }
    const rest = rows.length - shown;
    return `${first}<details class="sdh-more"${keepOpen ? ' open' : ''}><summary class="sdh-more__summary">Show the other ${rest} package${rest === 1 ? '' : 's'}</summary><div class="sdh-pkgs">${rows.slice(shown).join('')}</div></details>`;
  }

  /**
   * A short message in the packages card: what is wrong or missing, and optionally one button.
   * @param {string} title - Heading line.
   * @param {string} text - Explanation.
   * @param {string} [action] - Button markup.
   * @returns {string} Markup.
   */
  function packageMessageHtml(title, text, action) {
    return `<div class="sdh-empty"><p class="sdh-empty__title">${title}</p><p class="sdh-empty__text">${text}</p>${action || ''}</div>`;
  }

  async function loadPackages() {
    try {
      if (!pkgsWrap) {
        return;
      }
      const note = document.getElementById('pkg-limit-note');
      const supplierBlocked = window._supplierProfileMissing || window._supplierApprovalBlocked;
      const supplierBlockMessage = window._supplierProfileMissing
        ? 'Create your profile before adding packages.'
        : 'Package creation unlocks once your profile is approved.';
      const [d, allowance] = await Promise.all([api('/api/me/packages'), getPackageAllowance()]);
      const items = d?.items && Array.isArray(d.items) ? d.items : [];
      // Only count active (non-paused) packages against the plan limit; paused packages
      // are preserved but don't occupy a slot, matching the server-side enforcement.
      const activeCount = items.filter(p => !p.paused).length;
      const atLimit = allowance.limit !== null && activeCount >= allowance.limit;

      if (note) {
        note.textContent = packageNoteText(activeCount, allowance);
      }

      // Only block *creating* new packages; editing existing ones must remain allowed.
      const pkgForm = document.getElementById('package-form');
      // Expose globally so togglePackageForm() and editPackage() can reference it.
      window._pkgAtLimit = atLimit;
      // Store limit label text so togglePackageForm() can restore it after edit mode.
      window._pkgLimitLabel = atLimit
        ? `${activeCount}/${allowance.limit} active: limit reached`
        : 'Create package';

      const toggleBtn = document.getElementById('toggle-package-form');
      if (toggleBtn) {
        const labelEl = toggleBtn.querySelector('.label');
        // Only change the label when the form is collapsed (not in edit/cancel state).
        const formIsOpen =
          document.getElementById('package-form-section')?.classList.contains('expanded') ?? false;
        if (!formIsOpen) {
          if (atLimit) {
            toggleBtn.disabled = true;
            toggleBtn.title = `You have reached your plan's ${allowance.limit}-package limit. Pause or delete a package, or upgrade your plan.`;
            if (labelEl) {
              labelEl.textContent = window._pkgLimitLabel;
            }
          } else if (supplierBlocked) {
            toggleBtn.disabled = true;
            toggleBtn.title = supplierBlockMessage;
            if (labelEl) {
              labelEl.textContent = window._supplierProfileMissing
                ? 'Profile setup needed'
                : 'Profile pending approval';
            }
          } else {
            toggleBtn.disabled = false;
            toggleBtn.title = '';
            if (labelEl) {
              labelEl.textContent = 'Create package';
            }
          }
        }
        // Show or hide the upgrade link alongside the button.
        let upgradeCta = document.getElementById('pkg-upgrade-cta');
        if (atLimit) {
          if (!upgradeCta) {
            upgradeCta = document.createElement('a');
            upgradeCta.id = 'pkg-upgrade-cta';
            upgradeCta.href = '/supplier/subscription';
            upgradeCta.className = 'sdh-link';
            upgradeCta.textContent = 'Upgrade plan';
            toggleBtn.insertAdjacentElement('afterend', upgradeCta);
          }
          upgradeCta.hidden = false;
        } else if (upgradeCta) {
          upgradeCta.hidden = true;
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
        pkgsWrap.innerHTML = packageMessageHtml(
          'No packages yet',
          supplierBlocked
            ? supplierBlockMessage
            : 'Create your first package to show what you offer and what it costs.'
        );
        return;
      }
      const wasOpen = Boolean(pkgsWrap.querySelector('details.sdh-more[open]'));
      pkgsWrap.innerHTML = packageListHtml(items, wasOpen);
    } catch (err) {
      console.error('Error loading packages:', err);
      if (pkgsWrap) {
        if (err.code === 'SUPPLIER_PROFILE_MISSING') {
          pkgsWrap.innerHTML = packageMessageHtml(
            'Create your profile first',
            'Packages belong to your profile. Create it, and you can add packages straight after.',
            '<button type="button" class="sdh-btn sdh-btn--primary" data-sdh-action="edit-profile" data-sdh-focus="sup-name">Create profile</button>'
          );
        } else if (err.code === 'SUPPLIER_NOT_APPROVED') {
          pkgsWrap.innerHTML = packageMessageHtml(
            'Packages unlock after approval',
            'Your profile is waiting to be approved. You can add and manage packages as soon as it is.'
          );
        } else {
          pkgsWrap.innerHTML = packageMessageHtml(
            'Could not load your packages',
            'Check your connection and try again.',
            '<button type="button" class="sdh-btn sdh-btn--secondary sdh-btn--sm" data-sdh-action="reload-packages">Try again</button>'
          );
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

  // The editors' Cancel buttons are wired by supplier-dashboard-overlays.js (with the unsaved-changes
  // guard); a closed editor is reset here.
  document.addEventListener('sdh:overlay-closed', event => {
    if (event.detail?.name === 'profile') {
      resetProfileForm();
    } else if (event.detail?.name === 'package') {
      resetPackageForm();
    }
  });

  // Initialize profile form toggle
  const toggleProfileFormBtn = document.getElementById('toggle-profile-form');
  if (toggleProfileFormBtn) {
    toggleProfileFormBtn.addEventListener('click', toggleProfileForm);
  }

  // Add event delegation for Edit/Delete buttons on packages and profiles
  // Guard against duplicate bindings if supplier dashboard init runs more than once.
  if (!window.__efSupplierDashboardActionsBound) {
    window.__efSupplierDashboardActionsBound = true;
    document.addEventListener('click', async e => {
      const target = e.target;
      const actionEl = target.closest ? target.closest('[data-action]') : null;
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
              await editProfile(profileId, { focusId: 'sup-photo-drop' });
            } catch (err) {
              console.error('Failed to prepare profile form for photo upload:', err);
              return;
            }
          }
          const uploader = document.getElementById('sup-photo-drop');
          if (uploader) {
            const galleryRow = uploader.closest('.form-row') || uploader;
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

        // Handle profile photo delete button
        if (actionEl && actionEl.matches('[data-action="delete-profile-photo"]')) {
          if (actionEl.dataset.busy === 'true') {
            return;
          }
          if (
            !(await efConfirm({
              title: 'Remove your profile photo?',
              message: 'Your profile will show your initials until you add another photo.',
              confirmLabel: 'Remove photo',
            }))
          ) {
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
  }

  /**
   * Translate the coverage controls into the service-area shape the API stores.
   *
   * Suppliers are asked two plain questions — how far they travel from their
   * base, and which specific other areas (if any) they serve, nationwide
   * cover included — rather than being asked to think in service areas
   * directly. The API re-validates and caps whatever arrives, so this is only
   * a translation.
   * @param {Object} payload - Supplier payload, modified in place.
   */
  function applyCoverageToPayload(payload) {
    const radiusInput = document.getElementById('sup-travel-radius');
    const hasServiceAreaWidget = Boolean(document.getElementById('sup-service-area-tags'));

    if (radiusInput || hasServiceAreaWidget) {
      const serviceAreas = hasServiceAreaWidget
        ? supplierServiceAreaPicks.map(pick =>
            pick.type === 'nationwide' ? { type: 'nationwide' } : { type: 'city', slug: pick.slug }
          )
        : [];
      const radiusMiles = Number(payload.travelRadiusMiles);
      if (Number.isFinite(radiusMiles) && radiusMiles > 0) {
        serviceAreas.push({ type: 'radius', miles: Math.min(200, Math.round(radiusMiles)) });
      }
      payload.serviceAreas = serviceAreas;
      // Tells the API this list of picks is authoritative — including empty,
      // once every picked area has been removed — rather than "untouched".
      if (hasServiceAreaWidget) {
        payload.replaceServiceAreaPicks = true;
      }
    }

    delete payload.travelRadiusMiles;
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

  // Mirrors PATCH_FIELD_MAX_LENGTHS.website in routes/supplier-management.js.
  const SUPPLIER_WEBSITE_MAX_LENGTH = 200;
  const SUPPLIER_WEBSITE_INVALID_MESSAGE =
    'Please enter a valid website (for example: https://example.com, www.example.com, or example.com).';
  const SUPPLIER_WEBSITE_TOO_LONG_MESSAGE = `Website address must be ${SUPPLIER_WEBSITE_MAX_LENGTH} characters or fewer.`;

  /**
   * Normalise the supplier website input (prepend https:// when no scheme is
   * given) and validate it, including the length of the normalised URL.
   * @param {HTMLInputElement|null} inputEl Website input.
   * @returns {{ok: boolean, value: string, message?: string}} Result; `message`
   *   is the user-facing error when `ok` is false.
   */
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
      return { ok: false, value: raw, message: SUPPLIER_WEBSITE_INVALID_MESSAGE };
    }
    const hasHttpScheme = /^https?:\/\//i.test(raw);
    const normalized = hasHttpScheme ? raw : `https://${raw.replace(/^\/+/, '')}`;
    let parsed;
    try {
      parsed = new URL(normalized);
    } catch {
      return { ok: false, value: raw, message: SUPPLIER_WEBSITE_INVALID_MESSAGE };
    }
    if (!/^https?:$/i.test(parsed.protocol)) {
      return { ok: false, value: raw, message: SUPPLIER_WEBSITE_INVALID_MESSAGE };
    }
    // For no-scheme input, require a plausible host shape (domain, localhost, or IPv4).
    if (!hasHttpScheme) {
      const host = (parsed.hostname || '').toLowerCase();
      const isLikelyDomain = host.includes('.');
      const isLocalhost = host === 'localhost';
      const isIPv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
      if (!host || (!isLikelyDomain && !isLocalhost && !isIPv4)) {
        return { ok: false, value: raw, message: SUPPLIER_WEBSITE_INVALID_MESSAGE };
      }
    }
    // The server stores (and length-limits) the normalised href, which can be
    // longer than what was typed once https:// is prepended.
    if (parsed.href.length > SUPPLIER_WEBSITE_MAX_LENGTH) {
      return { ok: false, value: raw, message: SUPPLIER_WEBSITE_TOO_LONG_MESSAGE };
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
          scheduleSupplierStatusClear(statusEl, 5000);
        }
        if (categoryEl) {
          categoryEl.focus();
        }
        return;
      }
      const websiteCheck = normalizeAndValidateWebsiteInput(websiteEl);
      if (!websiteCheck.ok) {
        setSupplierFieldError(websiteEl, websiteErrorEl, websiteCheck.message);
        if (statusEl) {
          clearSupplierStatusTimer();
          statusEl.setAttribute('data-tone', 'error');
          statusEl.textContent = 'Please fix the website URL and try again.';
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
              scheduleSupplierStatusClear(statusEl, 5000);
            }
            // Don't rethrow — the profile save succeeded
            await loadSuppliers();
            notifyDashboardChanged();
            return;
          }
        }

        await loadSuppliers();
        notifyDashboardChanged();

        if (statusEl) {
          statusEl.setAttribute('data-tone', 'success');
          statusEl.textContent = 'Profile saved.';
          scheduleSupplierStatusClear(statusEl, 3000);
        }
        // Saved: the editor has nothing unsaved, so it closes without asking and the dashboard
        // behind it already shows the new details.
        efSay('Profile saved.', 'success');
        window.SupplierDashboardOverlays?.markClean('profile');
        window.SupplierDashboardOverlays?.close('profile');
      } catch (err) {
        console.error('Error saving supplier:', err);
        if (statusEl) {
          statusEl.setAttribute('data-tone', 'error');
          statusEl.textContent = `Error: ${err.message || 'Please try again'}`;
          scheduleSupplierStatusClear(statusEl, 8000);
        }
        surfaceServiceAreaLimitError(err);
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

  // "Other areas you serve" picker — lets a supplier add specific named
  // cities, and/or a single nationwide claim, on top of (or instead of) a
  // travel radius from one base — e.g. a caterer with branches in more than
  // one town. Capped to the supplier's plan allowance, enforced by the API;
  // this client-side copy of the limit is presentation only, so it starts at
  // the free-tier default and is corrected once the real allowance loads.
  // (State declared earlier in this scope, ahead of populateSupplierForm.)

  /**
   * Turn a registry slug into a readable guess ("stoke-on-trent" → "Stoke On
   * Trent") for the moment before the real name has loaded.
   * @param {string} slug City slug.
   * @returns {string} Readable guess.
   */
  function titleCaseCitySlug(slug) {
    return String(slug || '')
      .split('-')
      .filter(Boolean)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Look up a city's canonical display name from the registry search endpoint.
   * Falls back to a title-cased guess from the slug if the lookup fails or the
   * slug is no longer recognised.
   * @param {string} slug City slug.
   * @returns {Promise<string>} Display name.
   */
  async function resolveSupplierServiceAreaCityName(slug) {
    const fallback = titleCaseCitySlug(slug);
    try {
      const resp = await fetch(`/api/v1/locations/search?q=${encodeURIComponent(slug)}&limit=1`, {
        credentials: 'include',
      });
      if (!resp.ok) {
        return fallback;
      }
      const data = await resp.json().catch(() => null);
      const match = (data?.data?.cities || []).find(city => city.slug === slug);
      return match?.name || fallback;
    } catch {
      return fallback;
    }
  }

  function renderSupplierServiceAreaTags() {
    const list = document.getElementById('sup-service-area-tags');
    if (!list) {
      return;
    }
    list.innerHTML = '';
    supplierServiceAreaPicks.forEach(pick => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = pick.name;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.setAttribute('aria-label', `Remove ${pick.name}`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        supplierServiceAreaPicks = supplierServiceAreaPicks.filter(
          p => !(p.type === pick.type && p.slug === pick.slug)
        );
        renderSupplierServiceAreaTags();
        updateSupplierServiceAreaAvailability();
      });
      li.appendChild(label);
      li.appendChild(removeBtn);
      list.appendChild(li);
    });
    document.dispatchEvent(
      new CustomEvent('ef:supplier-service-areas-changed', {
        detail: { hasNationwide: supplierServiceAreaPicks.some(p => p.type === 'nationwide') },
      })
    );
  }

  /**
   * Show a SERVICE_AREA_LIMIT_EXCEEDED save rejection next to the picker.
   *
   * The allowance shown client-side is presentation only, so the API's own
   * rejection is the one that can actually happen (e.g. a plan downgrade
   * landing mid-session, before the picker's local copy of the limit has
   * refreshed) — this puts it right by the picker, not just in the general
   * status banner.
   * @param {Error & {code?: string}} err Error thrown by a failed save.
   * @returns {void} Nothing.
   */
  function surfaceServiceAreaLimitError(err) {
    if (err.code !== 'SERVICE_AREA_LIMIT_EXCEEDED') {
      return;
    }
    const areaErrorEl = document.getElementById('sup-service-area-error');
    if (areaErrorEl) {
      areaErrorEl.textContent = err.message;
    }
  }

  function hideSupplierServiceAreaResults() {
    const resultsEl = document.getElementById('sup-service-area-results');
    const searchEl = document.getElementById('sup-service-area-search');
    supplierServiceAreaSearchResults = [];
    // Also retires whatever search/browse fetch is still in flight — without
    // this, a slow response landing after blur (or after the limit/nationwide
    // closed this dropdown for an unrelated reason) could still call
    // renderSupplierServiceAreaResults and reopen a list this call just closed.
    supplierServiceAreaSearchRequestId += 1;
    if (resultsEl) {
      resultsEl.innerHTML = '';
      resultsEl.hidden = true;
    }
    if (searchEl) {
      searchEl.setAttribute('aria-expanded', 'false');
    }
  }

  function updateSupplierServiceAreaAvailability() {
    const searchEl = document.getElementById('sup-service-area-search');
    const nationwideBtn = document.getElementById('sup-service-area-add-nationwide');
    const maxEl = document.getElementById('sup-service-area-max');
    const errorEl = document.getElementById('sup-service-area-error');
    const atLimit = supplierServiceAreaPicks.length >= supplierServiceAreaAllowance;
    const hasNationwide = supplierServiceAreaPicks.some(p => p.type === 'nationwide');
    // Nationwide already covers every city, so picking one alongside it adds
    // no real coverage — it would just spend a slot of the supplier's
    // allowance on a redundant tag. Block the search the same way the limit
    // does, rather than letting them add cities the save would later drop.
    const searchBlocked = atLimit || hasNationwide;

    if (maxEl) {
      maxEl.textContent = String(supplierServiceAreaAllowance);
    }
    if (searchEl) {
      searchEl.disabled = searchBlocked;
      searchEl.placeholder = hasNationwide
        ? 'Nationwide already covers every city — remove it to pick specific areas'
        : atLimit
          ? `Limit of ${supplierServiceAreaAllowance} reached — remove one to add another`
          : 'Search for a city or town…';
    }
    if (nationwideBtn) {
      nationwideBtn.disabled = hasNationwide || atLimit;
    }
    if (errorEl && !atLimit) {
      errorEl.textContent = '';
    }
    if (searchBlocked) {
      hideSupplierServiceAreaResults();
    }
  }

  /**
   * Read the viewer's service-area allowance from their subscription.
   *
   * A failure leaves the free-tier default in place: the API enforces the
   * real limit either way, so the worst case is a paid supplier being briefly
   * shown a lower ceiling than they actually have.
   * @returns {Promise<void>} Nothing.
   */
  async function loadSupplierServiceAreaAllowance() {
    try {
      // The plan's limits come from the dashboard summary, which is requested once per page load.
      const home = window.SupplierDashboardHome;
      const limits =
        home && typeof home.getPlanLimits === 'function' ? await home.getPlanLimits() : null;
      const limit = limits?.maxServiceAreas;
      if (Number.isFinite(limit) && limit >= 0) {
        supplierServiceAreaAllowance = limit;
      }
    } catch {
      // Keep the default; the API is the authority.
    } finally {
      updateSupplierServiceAreaAvailability();
    }
  }

  function addSupplierServiceAreaPick(pick) {
    if (!pick) {
      return;
    }
    const isDuplicate = supplierServiceAreaPicks.some(
      p => p.type === pick.type && p.slug === pick.slug
    );
    // A city pick adds nothing once nationwide is already selected — it
    // covers every city already — so reject it here too, not just in the UI
    // that normally prevents it, in case a stale search result (a response
    // that landed after nationwide was picked) reaches this call directly.
    const redundantUnderNationwide =
      pick.type === 'city' && supplierServiceAreaPicks.some(p => p.type === 'nationwide');
    if (
      isDuplicate ||
      redundantUnderNationwide ||
      supplierServiceAreaPicks.length >= supplierServiceAreaAllowance
    ) {
      return;
    }
    supplierServiceAreaPicks.push(pick);
    renderSupplierServiceAreaTags();
    updateSupplierServiceAreaAvailability();
    hideSupplierServiceAreaResults();
    const searchEl = document.getElementById('sup-service-area-search');
    if (searchEl) {
      searchEl.value = '';
      searchEl.focus();
    }
  }

  function renderSupplierServiceAreaResults(cities) {
    const resultsEl = document.getElementById('sup-service-area-results');
    const searchEl = document.getElementById('sup-service-area-search');
    if (!resultsEl) {
      return;
    }
    // A search can still be in flight when a different action (the
    // nationwide button, reaching the limit, or a plain remove) changes what
    // the picker allows first; without this, its results would reopen a
    // dropdown that action has already closed.
    const hasNationwide = supplierServiceAreaPicks.some(p => p.type === 'nationwide');
    if (hasNationwide || supplierServiceAreaPicks.length >= supplierServiceAreaAllowance) {
      hideSupplierServiceAreaResults();
      return;
    }
    resultsEl.innerHTML = '';
    const selectedSlugs = new Set(
      supplierServiceAreaPicks.filter(p => p.type === 'city').map(p => p.slug)
    );
    const available = cities.filter(city => !selectedSlugs.has(city.slug));
    supplierServiceAreaSearchResults = available;
    if (!available.length) {
      hideSupplierServiceAreaResults();
      return;
    }
    available.forEach(city => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      const btn = document.createElement('button');
      btn.type = 'button';
      const region = city.region && city.region !== city.name ? `, ${city.region}` : '';
      btn.textContent = `${city.name}${region}`;
      btn.addEventListener('click', () =>
        addSupplierServiceAreaPick({ type: 'city', slug: city.slug, name: city.name })
      );
      li.appendChild(btn);
      resultsEl.appendChild(li);
    });
    resultsEl.hidden = false;
    if (searchEl) {
      searchEl.setAttribute('aria-expanded', 'true');
    }
  }

  /**
   * Fetch every place the registry recognises, alphabetically, for the
   * picker's "browse everywhere" list — shown when the search box is empty
   * rather than only once the supplier starts typing.
   * @returns {Promise<void>} Nothing.
   */
  async function browseSupplierServiceAreaCities() {
    const requestId = ++supplierServiceAreaSearchRequestId;
    try {
      const resp = await fetch('/api/v1/locations/search?browse=true', {
        credentials: 'include',
      });
      if (!resp.ok || requestId !== supplierServiceAreaSearchRequestId) {
        return;
      }
      const data = await resp.json().catch(() => null);
      if (requestId !== supplierServiceAreaSearchRequestId) {
        return;
      }
      renderSupplierServiceAreaResults(data?.data?.cities || []);
    } catch (err) {
      console.error('City browse failed:', err);
    }
  }

  async function searchSupplierServiceAreaCities(query) {
    const trimmed = query.trim();
    if (!trimmed) {
      await browseSupplierServiceAreaCities();
      return;
    }
    // A faster later keystroke's response can land before an earlier one's —
    // only the most recently *sent* request is allowed to render, so a slow
    // response for a stale query can never overwrite fresher results.
    const requestId = ++supplierServiceAreaSearchRequestId;
    try {
      const resp = await fetch(`/api/v1/locations/search?q=${encodeURIComponent(trimmed)}`, {
        credentials: 'include',
      });
      if (!resp.ok || requestId !== supplierServiceAreaSearchRequestId) {
        return;
      }
      const data = await resp.json().catch(() => null);
      if (requestId !== supplierServiceAreaSearchRequestId) {
        return;
      }
      renderSupplierServiceAreaResults(data?.data?.cities || []);
    } catch (err) {
      console.error('City search failed:', err);
    }
  }

  const supServiceAreaSearchEl = document.getElementById('sup-service-area-search');
  if (supServiceAreaSearchEl) {
    supServiceAreaSearchEl.addEventListener('input', () => {
      clearTimeout(supplierServiceAreaSearchTimer);
      const value = supServiceAreaSearchEl.value;
      supplierServiceAreaSearchTimer = setTimeout(
        () => searchSupplierServiceAreaCities(value),
        250
      );
    });
    // Show the full alphabetical list the moment the (empty) box is focused,
    // rather than making a supplier type something first to see anything at
    // all — the same list an empty keystroke already produces via 'input'.
    supServiceAreaSearchEl.addEventListener('focus', () => {
      if (!supServiceAreaSearchEl.value.trim()) {
        browseSupplierServiceAreaCities();
      }
    });
    supServiceAreaSearchEl.addEventListener('blur', () => {
      // Let a click on a result register before the list disappears.
      setTimeout(hideSupplierServiceAreaResults, 150);
    });
    // This field sits inside <form id="supplier-form">, which has a submit
    // button — so without this, Enter here would submit (and save) the whole
    // profile instead of picking a city, the same as Enter does in any
    // ordinary combobox's text field.
    supServiceAreaSearchEl.addEventListener('keydown', e => {
      if (e.key !== 'Enter') {
        return;
      }
      e.preventDefault();
      const top = supplierServiceAreaSearchResults[0];
      if (top) {
        addSupplierServiceAreaPick({ type: 'city', slug: top.slug, name: top.name });
      }
    });
  }
  const supServiceAreaNationwideBtn = document.getElementById('sup-service-area-add-nationwide');
  if (supServiceAreaNationwideBtn) {
    supServiceAreaNationwideBtn.addEventListener('click', () => {
      addSupplierServiceAreaPick({ type: 'nationwide', name: NATIONWIDE_PICK_NAME });
    });
  }
  if (supServiceAreaSearchEl || supServiceAreaNationwideBtn) {
    updateSupplierServiceAreaAvailability();
    loadSupplierServiceAreaAllowance();
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
          scheduleSupplierStatusClear(statusEl, 4500);
        }
      } else {
        if (statusEl) {
          clearSupplierStatusTimer();
          statusEl.setAttribute('data-tone', 'warning');
          statusEl.textContent = 'Please save your profile first before previewing.';
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
    // skipcq: JS-R1005 -- Pre-existing: the full create/edit package flow
    // (field collection, validation, limit checks, the API call, and every
    // success/failure branch it can return) in one submit handler. This PR's
    // only footprint here is capturing the API response to detect a failed
    // image upload — it does not add branches, and splitting this handler
    // apart is a larger, riskier change than that fix called for.
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

      // Validate required fields. The editor is a dialog, so the message goes in the dialog (a
      // toast would sit behind it) and the first field to fix gets focus.
      clearPackageErrors();
      if (!payload.title || !String(payload.title).trim()) {
        showPackageError('pkg-title', 'Please give the package a title.');
        return;
      }
      if (!payload.price || !String(payload.price).trim()) {
        showPackageError('pkg-price', 'Please enter a price for this package.');
        return;
      }
      if (!payload.primaryCategoryKey) {
        showPackageError('pkg-category', 'Please select a primary category.');
        return;
      }
      if (!payload.eventTypes || payload.eventTypes.length === 0) {
        showPackageError('pkg-event-wedding', 'Please select at least one event type.');
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
        showPackageError('pkg-title', PKG_LIMIT_MESSAGE);
        return;
      }

      const saveBtn = pkgForm.querySelector('button[type="submit"]');
      if (saveBtn && saveBtn.disabled) {
        // A save is already in flight: a second Enter or click must not send it twice.
        return;
      }
      pkgForm.setAttribute('aria-busy', 'true');
      const origLabel = saveBtn ? saveBtn.textContent : '';
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
      }

      try {
        const saveResult = await api(path, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        await loadPackages();
        efSay(saveResult?.imageProcessingError || 'Package saved.', 'success');
        notifyDashboardChanged();
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
          galleryExisting.hidden = true;
        }
        const galleryRow = document.getElementById('pkg-gallery-row');
        if (galleryRow) {
          galleryRow.hidden = true;
        }
        const pkgManageGalleryLink = document.getElementById('pkg-manage-gallery-link');
        if (pkgManageGalleryLink) {
          pkgManageGalleryLink.hidden = true;
        }

        // Form has been reset to create mode. Re-apply limit restrictions if needed
        // so the user cannot immediately attempt to create a new package over the limit.
        if (window._pkgAtLimit) {
          setPkgFormDisabled(true);
        }
        // Close the editor: the package now shows in the list behind it.
        window.SupplierDashboardOverlays?.markClean('package');
        window.SupplierDashboardOverlays?.close('package');
      } catch (err) {
        if (err.code === 'SUPPLIER_PROFILE_MISSING') {
          showPackageError('pkg-title', 'Create your profile before adding packages.');
        } else if (err.code === 'SUPPLIER_NOT_APPROVED') {
          showPackageError('pkg-title', 'Package creation unlocks once your profile is approved.');
        } else {
          showPackageError(
            'pkg-title',
            `Could not save the package: ${err.message || 'please try again'}`
          );
        }
      } finally {
        pkgForm.removeAttribute('aria-busy');
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

  // "Use a photo from your profile" — lets a supplier attach an already-uploaded
  // profile photo to a package instead of re-uploading the same file. The photo
  // list comes from window._efCachedSuppliers (populated when the profile section
  // loads), so this needs no extra API call.
  (() => {
    const reuseBtn = document.getElementById('pkg-use-profile-photo-btn');
    const reusePanel = document.getElementById('pkg-reuse-photo-panel');
    if (!reuseBtn || !reusePanel) {
      return;
    }

    function selectReusePhoto(url) {
      const pkgImageInput = document.getElementById('pkg-image');
      if (pkgImageInput) {
        pkgImageInput.value = url;
      }
      const pkgPreview = document.getElementById('pkg-photo-preview');
      if (pkgPreview) {
        pkgPreview.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'photo-preview-item';
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        wrapper.appendChild(img);
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'photo-preview-remove';
        removeBtn.setAttribute('aria-label', 'Remove image');
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', () => {
          wrapper.remove();
          if (pkgImageInput) {
            pkgImageInput.value = '';
          }
        });
        wrapper.appendChild(removeBtn);
        pkgPreview.appendChild(wrapper);
      }
      reusePanel.hidden = true;
      reusePanel.innerHTML = '';
    }

    reuseBtn.addEventListener('click', () => {
      const isOpen = !reusePanel.hidden;
      reusePanel.innerHTML = '';
      if (isOpen) {
        reusePanel.hidden = true;
        return;
      }

      const supplierId =
        document.getElementById('pkg-supplier')?.value ||
        document.getElementById('sup-id')?.value ||
        '';
      const supplier = (window._efCachedSuppliers || []).find(
        item => String(item.id) === String(supplierId)
      );
      const photos = Array.isArray(supplier?.photosGallery) ? supplier.photosGallery : [];
      const usableUrls = photos
        .map(p => (typeof p === 'string' ? p : p?.url || ''))
        .filter(url => url && !isKnownPlaceholderUrl(url));

      if (usableUrls.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'tiny';
        empty.textContent =
          "You haven't uploaded any profile photos yet — add some in the Photos section above, then come back here.";
        reusePanel.appendChild(empty);
      } else {
        usableUrls.forEach(url => {
          const option = document.createElement('button');
          option.type = 'button';
          option.className = 'photo-preview-item pkg-reuse-photo-option';
          option.setAttribute('aria-label', 'Use this photo for the package');
          const img = document.createElement('img');
          img.src = url;
          img.alt = '';
          option.appendChild(img);
          option.addEventListener('click', () => selectReusePhoto(url));
          reusePanel.appendChild(option);
        });
      }
      reusePanel.hidden = false;
    });
  })();

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

/** Clears the package editor's message and every field marked invalid. */
function clearPackageErrors() {
  const statusEl = document.getElementById('pkg-status');
  if (statusEl) {
    statusEl.textContent = '';
    statusEl.removeAttribute('data-tone');
  }
  document
    .querySelectorAll('#package-form [aria-invalid="true"]')
    .forEach(field => field.removeAttribute('aria-invalid'));
}

/**
 * Shows an error inside the package editor and moves focus to the field to fix.
 * @param {string} fieldId - The field the message is about.
 * @param {string} message - What to tell the supplier.
 */
function showPackageError(fieldId, message) {
  const statusEl = document.getElementById('pkg-status');
  if (statusEl) {
    statusEl.setAttribute('data-tone', 'error');
    statusEl.textContent = message;
  }
  const field = document.getElementById(fieldId);
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }
}

/**
 * Opens the package editor for a new package, or asks to close it when it is already open. The
 * editor is a dialog owned by supplier-dashboard-overlays.js.
 */
function togglePackageForm() {
  const overlays = window.SupplierDashboardOverlays;
  if (!overlays) {
    return;
  }
  if (overlays.isOpen('package')) {
    overlays.requestClose('package');
    return;
  }
  resetPackageForm();
  overlays.open('package', { focusId: 'pkg-title' });
}

/** Puts the package editor back to "create a package"; runs whenever the editor closes. */
function resetPackageForm() {
  const toggleBtn = document.getElementById('toggle-package-form');
  const form = document.getElementById('package-form');
  if (form) {
    form.reset();
  }
  const idField = document.getElementById('pkg-id-hidden');
  if (idField) {
    idField.value = '';
  }
  const statusEl = document.getElementById('pkg-status');
  if (statusEl) {
    statusEl.textContent = '';
  }
  const heading = document.querySelector('#package-form-section .supplier-section-header');
  if (heading) {
    heading.textContent = 'Create a package';
  }

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
    galleryExistingReset.hidden = true;
  }
  const galleryRowReset = document.getElementById('pkg-gallery-row');
  if (galleryRowReset) {
    galleryRowReset.hidden = true;
  }
  const pkgManageGalleryLinkReset = document.getElementById('pkg-manage-gallery-link');
  if (pkgManageGalleryLinkReset) {
    pkgManageGalleryLinkReset.hidden = true;
  }

  // The form is back in create mode: re-apply the package limit if it is reached.
  if (window._pkgAtLimit) {
    setPkgFormDisabled(true);
    if (toggleBtn) {
      toggleBtn.disabled = true;
      toggleBtn.classList.add('form-toggle-btn--at-limit');
      toggleBtn.setAttribute('aria-label', 'Package limit reached: upgrade to create more');
      toggleBtn.title =
        "You've reached your package limit. Pause or delete a package, or upgrade your plan.";
      const labelElRestore = toggleBtn.querySelector('.label');
      if (labelElRestore) {
        labelElRestore.textContent = window._pkgLimitLabel || 'Limit reached';
      }
    }
    const upgradeCta = document.getElementById('pkg-upgrade-cta');
    if (upgradeCta) {
      upgradeCta.hidden = false;
    }
  } else if (toggleBtn) {
    toggleBtn.removeAttribute('aria-label');
    toggleBtn.title = '';
  }
}

/**
 * Fills the package editor from a saved package and opens it over the dashboard.
 * @param {string} packageId - The package to edit.
 */
function editPackage(packageId) {
  const formSection = document.getElementById('package-form-section');

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
    // skipcq: JS-R1005 -- Pre-existing: this callback populates every field
    // of the edit-package form from the fetched package. This PR's only
    // footprint is one small if/pkg.id check to show/hide the "manage
    // gallery" link — splitting the rest of this callback apart is a
    // larger, riskier change than that addition calls for.
    .then(pkg => {
      // Populate form with package data
      document.getElementById('pkg-id-hidden').value = pkg.id || '';
      const pkgManageGalleryLink = document.getElementById('pkg-manage-gallery-link');
      if (pkgManageGalleryLink) {
        if (pkg.id) {
          pkgManageGalleryLink.href = `/gallery?type=package&id=${encodeURIComponent(pkg.id)}`;
          pkgManageGalleryLink.hidden = false;
        } else {
          pkgManageGalleryLink.hidden = true;
        }
      }
      document.getElementById('pkg-title').value = pkg.title || '';
      document.getElementById('pkg-price').value = packagePriceText(pkg);
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
          galleryExisting.hidden = false;
          if (galleryRow) {
            galleryRow.hidden = false;
          }
          // Show reorder bar only when there are ≥2 photos
          const reorderBar = document.getElementById('pkg-gallery-reorder-bar');
          if (reorderBar) {
            reorderBar.hidden = validPhotos.length < 2;
          }
        } else {
          galleryExisting.innerHTML = '';
          galleryExisting.hidden = true;
          if (galleryRow) {
            galleryRow.hidden = true;
          }
          const reorderBar = document.getElementById('pkg-gallery-reorder-bar');
          if (reorderBar) {
            reorderBar.hidden = true;
          }
        }
      }

      // Update form heading
      const heading = formSection.querySelector('.supplier-section-header');
      if (heading) {
        heading.textContent = 'Edit package';
      }

      window.SupplierDashboardOverlays?.open('package', { focusId: 'pkg-title' });
    })
    .catch(e => {
      console.error('Error loading package for edit:', e);
      efSay('Could not load the package. Please try again.', 'error');
    });
}

/**
 * A package write (delete, pause, resume) with the dashboard's CSRF handling: the token is
 * fetched when missing and fetched again once if the server refuses it.
 * @param {string} url - The package route.
 * @param {string} method - DELETE or PUT.
 * @returns {Promise<{ok: boolean, status: number, data: Object}>} The response.
 */
async function packageRequest(url, method) {
  const home = window.SupplierDashboardHome;
  if (home && typeof home.sendJson === 'function') {
    return home.sendJson(url, method);
  }
  const response = await fetch(url, {
    method,
    headers: { 'X-CSRF-Token': window.__CSRF_TOKEN__ || '' },
    credentials: 'include',
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

/** Puts keyboard focus back on the packages heading after a row has been removed or redrawn. */
function focusPackagesHeading() {
  const heading = document.getElementById('packages-heading');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
}

async function deletePackage(packageId) {
  const confirmed = await efConfirm({
    title: 'Delete this package?',
    message: 'This cannot be undone. Customers will no longer see it.',
    confirmLabel: 'Delete package',
  });
  if (!confirmed) {
    return;
  }

  try {
    const result = await packageRequest(
      `/api/v1/me/packages/${encodeURIComponent(packageId)}`,
      'DELETE'
    );
    if (!result.ok) {
      efSay(`Could not delete the package: ${result.data.error || 'unknown error'}`, 'error');
      return;
    }

    if (typeof window._efLoadPackages === 'function') {
      await window._efLoadPackages();
    }
    notifyDashboardChanged();
    efSay('Package deleted.', 'success');
    focusPackagesHeading();
  } catch (e) {
    console.error('Error deleting package:', e);
    efSay('Could not delete the package. Please try again.', 'error');
  }
}

async function togglePackagePause(packageId, pause) {
  const action = pause ? 'pause' : 'unpause';
  try {
    const result = await packageRequest(
      `/api/v1/me/packages/${encodeURIComponent(packageId)}/${action}`,
      'PUT'
    );
    if (!result.ok) {
      efSay(`Could not ${action} the package: ${result.data.error || 'unknown error'}`, 'error');
      return;
    }

    // Refresh packages list to reflect the updated state.
    // _efLoadPackages is the closure-scoped loadPackages() exposed by initDashSupplier().
    if (typeof window._efLoadPackages === 'function') {
      await window._efLoadPackages();
    }
    // The summary row counts active packages: ask for fresh numbers.
    notifyDashboardChanged();
    efSay(pause ? 'Package paused.' : 'Package resumed.', 'success');
    focusPackagesHeading();
  } catch (e) {
    console.error(`Error ${action}ing package:`, e);
    efSay(`Could not ${action} the package. Please try again.`, 'error');
  }
}

async function deletePackagePhoto(packageId, photoUrl, btnEl) {
  const confirmed = await efConfirm({
    title: 'Remove this photo?',
    message: 'It will be removed from the package gallery.',
    confirmLabel: 'Remove photo',
  });
  if (!confirmed) {
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
      efSay(`Could not delete the photo: ${err.error || 'unknown error'}`, 'error');
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
      galleryExisting.hidden = true;
      const galleryRow = document.getElementById('pkg-gallery-row');
      if (galleryRow) {
        galleryRow.hidden = true;
      }
    }
  } catch (e) {
    console.error('Error deleting package photo:', e);
    efSay('Could not delete the photo. Please try again.', 'error');
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
    bar.hidden = false;
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
/**
 * Opens the profile editor over the dashboard, filled in from the saved profile, or asks to close
 * it when it is already open. The editor is a dialog owned by supplier-dashboard-overlays.js.
 */
function toggleProfileForm() {
  const overlays = window.SupplierDashboardOverlays;
  if (!overlays) {
    return;
  }
  if (overlays.isOpen('profile')) {
    overlays.requestClose('profile');
    return;
  }
  // Closing the editor clears it (and the hidden profile id). Opening it again must show the
  // saved profile: a blank form would save as a new profile instead of updating this one.
  const savedProfile = (window._efCachedSuppliers || [])[0];
  const heading = document.querySelector('#profile-form-section .supplier-section-header');
  if (savedProfile && typeof window._efPopulateSupplierForm === 'function') {
    window._efPopulateSupplierForm(savedProfile);
    if (heading) {
      heading.textContent = 'Edit profile';
    }
  } else if (heading) {
    heading.textContent = 'Create your profile';
  }
  overlays.open('profile', { focusId: 'sup-name' });
}

/** Puts the profile editor back to its empty state; runs whenever the editor closes. */
function resetProfileForm() {
  const form = document.getElementById('supplier-form');
  if (form) {
    form.reset();
  }
  const idField = document.getElementById('sup-id');
  if (idField) {
    idField.value = '';
  }
  const statusEl = document.getElementById('sup-status');
  if (statusEl) {
    statusEl.textContent = '';
  }
  const hasProfile = (window._efCachedSuppliers || []).length > 0;
  const heading = document.querySelector('#profile-form-section .supplier-section-header');
  if (heading) {
    heading.textContent = hasProfile ? 'Edit profile' : 'Create your profile';
  }
  const label = document.querySelector('#toggle-profile-form .label');
  if (label) {
    label.textContent = hasProfile ? 'Edit profile' : 'Create profile';
  }
}

/**
 * Fills the profile editor from a saved profile and opens it over the dashboard.
 * @param {string} supplierId - The profile to edit.
 * @param {{focusId?: string}} [options] - A field to land on.
 */
async function editProfile(supplierId, options = {}) {
  const formSection = document.getElementById('profile-form-section');

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

    window.SupplierDashboardOverlays?.open('profile', { focusId: options.focusId || 'sup-name' });
  } catch (e) {
    console.error('Error loading supplier for edit:', e);
    efSay('Could not load your profile. Please try again.', 'error');
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
      <img src="${x.image}" alt="${escapeHtml(x.title)}"><div><h3>${x.title}</h3><div class="small"><span class="badge">${x.price}</span> — Supplier ${x.supplierId.slice(0, 8)}</div>
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

/** The page tag for a URL path, for pages that do not set window.__EF_PAGE__ themselves. */
function efDetectPage(pathname) {
  // Order matters: '/suppliers' also starts with '/supplier', so it is tested first.
  const routes = [
    ['admin_users', p => p.endsWith('admin-users.html') || p === '/admin-users'],
    ['admin', p => p.endsWith('admin.html') || p === '/admin'],
    ['auth', p => p.endsWith('auth.html') || p === '/auth'],
    ['verify', p => p.endsWith('verify.html') || p === '/verify'],
    ['dash_supplier', p => p.endsWith('dashboard-supplier.html') || p === '/dashboard/supplier'],
    ['suppliers', p => p.endsWith('suppliers.html') || p === '/suppliers'],
    ['supplier', p => p.endsWith('supplier.html') || p.startsWith('/supplier')],
    ['plan', p => p.endsWith('plan.html') || p === '/plan'],
  ];
  const match = routes.find(([, test]) => test(pathname));
  return match ? match[0] : '';
}

// skipcq: JS-R1005 -- One DOMContentLoaded handler keeps every page's setup in one place; the
// sign-in/sign-up block is most of it.
document.addEventListener('DOMContentLoaded', () => {
  const page = window.__EF_PAGE__ || efDetectPage(location.pathname);

  // Version display is handled by admin-shared.js for admin pages.
  // Public pages keep the version wrapper hidden via the HTML hidden attribute.
  // No version fetch needed here.

  // Per-page setup
  // Note: homepage initialization is handled by home-init.js
  // (removed initHome() from app.js to avoid conflicts)
  if (page === 'results') {
    initResults && initResults();
  }
  if (page === 'plan') {
    initPlan && initPlan();
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

      const isAccountTypeChosen = () => {
        const regRoleInput = document.getElementById('reg-role');
        if (regRoleInput?.value) {
          return true;
        }
        const message = 'Choose an account type — Customer or Supplier — to continue.';
        if (regStatus) {
          regStatus.textContent = message;
        }
        if (window.EventFlowAuthRole) {
          window.EventFlowAuthRole.flagMissing(message);
        }
        return false;
      };

      // A separate listener, not a branch added inside the big handler below:
      // that handler was already a DeepSource complexity finding pre-dating
      // this PR, so keeping this check's own branches out of its body avoids
      // adding to a score already this high. Listeners on the same element
      // run in registration order, so this runs first; blocking here with
      // stopImmediatePropagation stops the handler below from running at all.
      regForm.addEventListener('submit', e => {
        if (isAccountTypeChosen()) {
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
      });

      // skipcq: JS-R1005 -- Pre-existing: the full registration flow (client
      // validation, feature-flag and ALTCHA gates, the API call, and every
      // failure branch it can return) in one submit handler. This PR's only
      // footprint here is making the button's label reset role-aware instead
      // of a hardcoded string on each of these failure paths — it does not
      // add branches, and splitting this handler apart is a larger, riskier
      // change than that fix called for.
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

        // Check password confirmation (the field is optional markup; the show/hide
        // toggle replaces it on the redesigned auth page)
        if (regPasswordConfirm && password !== passwordConfirm) {
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
            setAuthSubmitButtonState(regBtn, regBtn?.dataset?.defaultLabel || 'Create account');
            return;
          }

          if (role === 'supplier' && !company) {
            const message = 'Company name is required for suppliers';
            if (regStatus) {
              regStatus.textContent = message;
            }
            setAuthFieldError(companyEl, message);
            setAuthSubmitButtonState(regBtn, regBtn?.dataset?.defaultLabel || 'Create account');
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
              setAuthSubmitButtonState(regBtn, regBtn?.dataset?.defaultLabel || 'Create account');
              return;
            }

            payload.captchaToken = captchaToken;
          } else if (window.__altchaUnavailable) {
            // Widget failed to load entirely — inform the user to refresh
            if (regStatus) {
              regStatus.textContent =
                'Verification is unavailable. Please refresh the page and try again.';
            }
            setAuthSubmitButtonState(regBtn, regBtn?.dataset?.defaultLabel || 'Create account');
            return;
          } else if (altchaContainer) {
            // Container exists but widget element isn't in DOM yet (still loading).
            // Block submission to prevent a guaranteed 400 from the backend.
            if (regStatus) {
              regStatus.textContent =
                'Please wait for the verification to load and complete the challenge.';
            }
            setAuthSubmitButtonState(regBtn, regBtn?.dataset?.defaultLabel || 'Create account');
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
          setAuthSubmitButtonState(regBtn, regBtn?.dataset?.defaultLabel || 'Create account');
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

document.addEventListener('DOMContentLoaded', () => {
  if (window.__EF_PAGE__ === 'admin') {
    adminCharts();
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
