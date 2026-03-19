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

// Generate gradient based on supplier name for consistent avatar colors
function generateSupplierGradient(name) {
  const colors = [
    ['#13B6A2', '#0B8073'],
    ['#8B5CF6', '#6D28D9'],
    ['#F59E0B', '#D97706'],
    ['#10B981', '#059669'],
    ['#3B82F6', '#2563EB'],
    ['#EC4899', '#DB2777'],
  ];
  const index = name ? name.charCodeAt(0) % colors.length : 0;
  return `linear-gradient(135deg, ${colors[index][0]} 0%, ${colors[index][1]} 100%)`;
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
  } catch (_) {
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
    } catch (_) {
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
  } catch (_) {
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
  } catch (_) {
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
  if (s.featuredSupplier) {
    tags.unshift('<span class="badge">Featured</span>');
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
      `<span class="badge badge-founding" title="Founding Supplier - Original member since 2024">⭐ Founding${yearLabel}</span>`
    );
  }

  // Pro/Pro Plus/Featured tier badges
  const tier =
    s.subscriptionTier ||
    (s.subscription && s.subscription.tier) ||
    (s.isPro || s.pro ? 'pro' : null);

  if (tier === 'featured') {
    supplierBadges.push('<span class="badge badge-featured">Featured</span>');
  } else if (tier === 'pro_plus') {
    supplierBadges.push('<span class="badge badge-pro-plus">Professional Plus</span>');
  } else if (tier === 'pro') {
    supplierBadges.push('<span class="badge badge-pro">Professional</span>');
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
  } else if (s.verified || (s.badges && s.badges.includes('verified'))) {
    // Fallback for legacy verified field
    supplierBadges.push('<span class="badge badge-email-verified">Verified</span>');
  }

  // Supplier avatar with fallback
  const supplierInitial = s.name ? s.name.charAt(0).toUpperCase() : 'S';
  const avatarHtml = s.logo
    ? `<img src="${escapeHtml(s.logo)}" alt="${escapeHtml(s.name)} logo" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover; margin-right: 16px;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
       <div style="display: none; width: 60px; height: 60px; border-radius: 50%; background: ${generateSupplierGradient(s.name)}; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 1.5rem; margin-right: 16px; flex-shrink: 0;">${supplierInitial}</div>`
    : `<div style="width: 60px; height: 60px; border-radius: 50%; background: ${generateSupplierGradient(s.name)}; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 1.5rem; margin-right: 16px; flex-shrink: 0;">${supplierInitial}</div>`;

  return `<div class="card supplier-card" style="display: flex; gap: 16px; align-items: start;">
    ${avatarHtml}
    <div style="flex: 1; min-width: 0;">
      <h3 style="margin: 0 0 8px 0;">
        <a href="/supplier?id=${encodeURIComponent(s.id)}" style="text-decoration: none; color: inherit;">${escapeHtml(s.name)}</a>
      </h3>
      <div class="small" style="margin-bottom: 8px;">${escapeHtml(s.location || '')} · <span class="badge">${escapeHtml(s.category)}</span> ${s.price_display ? `· ${escapeHtml(s.price_display)}` : ''}</div>
      <p class="small" style="margin-bottom: 8px;">${escapeHtml(s.description_short || '')}</p>
      <div class="supplier-badges" style="margin: 8px 0;">${supplierBadges.join('')}</div>
      <div class="small" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">${tags.join(' ')}</div>
      <div class="form-actions">${addBtn}<a class="cta secondary" href="/supplier?id=${encodeURIComponent(s.id)}">View details</a></div>
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
    } catch (_e) {
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

// Helper function to adjust color brightness
function adjustColorBrightness(hex, percent) {
  // Remove # if present
  // eslint-disable-next-line no-param-reassign
  hex = hex.replace('#', '');

  // Convert to RGB
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  // Adjust brightness
  r = Math.max(0, Math.min(255, r + (r * percent) / 100));
  g = Math.max(0, Math.min(255, g + (g * percent) / 100));
  b = Math.max(0, Math.min(255, b + (b * percent) / 100));

  // Convert back to hex
  const toHex = n => {
    const hex = Math.round(n).toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
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
  const img =
    (s.photosGallery && s.photosGallery[0] && s.photosGallery[0].url) ||
    '/assets/images/hero-venue.svg';

  // Use custom banner if available, otherwise use first photo or default
  const bannerImg = s.bannerUrl || img;
  // Apply custom theme color if set (with validation)
  const hexColorRegex = /^#[0-9A-F]{6}$/i;
  const themeColor = s.themeColor && hexColorRegex.test(s.themeColor) ? s.themeColor : '#0B8073';
  const themeColorDark = adjustColorBrightness(themeColor, -10);

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
      ? `
    <div style="margin: 20px 0; padding: 20px; background: linear-gradient(135deg, #F6FAF9 0%, #EBF5F4 100%); border-radius: 12px;">
      <h3 style="font-size: 18px; font-weight: 600; margin-bottom: 16px; color: #0B1220;">✨ Key Highlights</h3>
      <div style="display: grid; gap: 12px;">
        ${s.highlights
          .map(
            h => `
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="color: ${themeColor}; font-size: 18px;">✓</span>
            <span style="font-size: 15px; color: #374151;">${escapeHtml(h)}</span>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `
      : '';

  // Render featured services if available
  const featuredServicesHtml =
    s.featuredServices && s.featuredServices.length > 0
      ? `
    <div style="margin: 20px 0;">
      <h3 style="font-size: 18px; font-weight: 600; margin-bottom: 16px; color: #0B1220;">⭐ Featured Services</h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;">
        ${s.featuredServices
          .map(
            service => `
          <div style="padding: 12px 16px; background: white; border: 2px solid #E7EAF0; border-radius: 8px; font-size: 14px; color: #374151; transition: all 0.2s;">
            ${escapeHtml(service)}
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `
      : '';

  // Render social links if available
  const socialLinksHtml =
    s.socialLinks && Object.keys(s.socialLinks).length > 0
      ? `
    <div style="margin: 20px 0; padding: 20px; background: white; border: 2px solid #E7EAF0; border-radius: 12px;">
      <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #0B1220;">🔗 Connect With Us</h3>
      <div style="display: flex; flex-wrap: wrap; gap: 12px;">
        ${s.socialLinks.facebook ? `<a href="${escapeHtml(s.socialLinks.facebook)}" target="_blank" rel="noopener noreferrer" class="social-link" style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; background: #1877F2; color: white; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">📘 Facebook</a>` : ''}
        ${s.socialLinks.instagram ? `<a href="${escapeHtml(s.socialLinks.instagram)}" target="_blank" rel="noopener noreferrer" class="social-link" style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; background: linear-gradient(45deg, #F58529, #DD2A7B, #8134AF); color: white; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">📷 Instagram</a>` : ''}
        ${s.socialLinks.twitter ? `<a href="${escapeHtml(s.socialLinks.twitter)}" target="_blank" rel="noopener noreferrer" class="social-link" style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; background: #1DA1F2; color: white; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">🐦 Twitter</a>` : ''}
        ${s.socialLinks.linkedin ? `<a href="${escapeHtml(s.socialLinks.linkedin)}" target="_blank" rel="noopener noreferrer" class="social-link" style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; background: #0A66C2; color: white; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">💼 LinkedIn</a>` : ''}
        ${s.socialLinks.youtube ? `<a href="${escapeHtml(s.socialLinks.youtube)}" target="_blank" rel="noopener noreferrer" class="social-link" style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; background: #FF0000; color: white; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">▶️ YouTube</a>` : ''}
        ${s.socialLinks.tiktok ? `<a href="${escapeHtml(s.socialLinks.tiktok)}" target="_blank" rel="noopener noreferrer" class="social-link" style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; background: #000000; color: white; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">🎵 TikTok</a>` : ''}
      </div>
    </div>
  `
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

  // Enhanced badge system
  const badges = [];

  // Tier badges
  const tier =
    s.subscriptionTier ||
    (s.subscription && s.subscription.tier) ||
    (s.isPro || s.pro ? 'pro' : null);

  if (tier === 'pro_plus') {
    badges.push(
      '<span class="badge badge-pro-plus" title="Professional Plus Member">✨ Pro+</span>'
    );
  } else if (tier === 'pro') {
    badges.push('<span class="badge badge-pro" title="Professional Member">⭐ Pro</span>');
  }

  // Verified badge
  if (s.approved || s.verified) {
    badges.push('<span class="badge badge-verified" title="Verified Supplier">✓ Verified</span>');
  }

  // Founding supplier (check both founding and isFounding properties)
  if (s.founding || s.isFounding || (s.badges && s.badges.includes('founding'))) {
    const yearLabel = s.foundingYear ? ` (${escapeHtml(String(s.foundingYear))})` : '';
    badges.push(
      `<span class="badge badge-founding" title="Founding Supplier - Original member since 2024">⭐ Founding${yearLabel}</span>`
    );
  }

  // Featured supplier (check both featured and featuredSupplier properties)
  if (s.featured || s.featuredSupplier) {
    badges.push('<span class="badge badge-featured" title="Featured Supplier">⭐ Featured</span>');
  }

  // Fast responder (if response time < 24 hours)
  if (s.avgResponseTime && s.avgResponseTime < 24) {
    badges.push(
      '<span class="badge badge-fast-responder" title="Responds within 24 hours">⚡ Fast Responder</span>'
    );
  }

  // Top rated (if rating >= 4.5) - check both avgRating and averageRating properties
  if ((s.avgRating && s.avgRating >= 4.5) || (s.averageRating && s.averageRating >= 4.5)) {
    badges.push('<span class="badge badge-top-rated" title="Top Rated">🌟 Top Rated</span>');
  }

  // Expert (if completed events > 50)
  if (s.completedEvents && s.completedEvents > 50) {
    badges.push(
      '<span class="badge badge-expert" title="Over 50 completed events">👨‍🎓 Expert</span>'
    );
  }

  const badgesHtml =
    badges.length > 0
      ? `<div class="supplier-badges" style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px;">${badges.join('')}</div>`
      : '';

  // Calculate years active more precisely
  const yearsActive = s.createdAt
    ? Math.max(
        1,
        Math.floor((Date.now() - new Date(s.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
      )
    : null;

  // Build stats section
  const statsHtml = `
    <div class="supplier-stats" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 16px; margin: 20px 0; padding: 20px; background: linear-gradient(135deg, #F6FAF9 0%, #EBF5F4 100%); border-radius: 12px;">
      ${
        s.completedEvents
          ? `<div class="stat-item" style="text-align: center;">
        <div class="stat-value" style="font-size: 28px; font-weight: 700; color: var(--ink, #0B8073);">${s.completedEvents}</div>
        <div class="stat-label" style="font-size: 12px; color: #6b7280; font-weight: 500;">Events</div>
      </div>`
          : ''
      }
      ${
        yearsActive
          ? `<div class="stat-item" style="text-align: center;">
        <div class="stat-value" style="font-size: 28px; font-weight: 700; color: var(--ink, #0B8073);">${yearsActive}</div>
        <div class="stat-label" style="font-size: 12px; color: #6b7280; font-weight: 500;">Years Active</div>
      </div>`
          : ''
      }
      ${
        s.avgResponseTime
          ? `<div class="stat-item" style="text-align: center;">
        <div class="stat-value" style="font-size: 28px; font-weight: 700; color: var(--ink, #0B8073);">${Math.round(s.avgResponseTime)}h</div>
        <div class="stat-label" style="font-size: 12px; color: #6b7280; font-weight: 500;">Response Time</div>
      </div>`
          : ''
      }
      ${
        s.reviewCount
          ? `<div class="stat-item" style="text-align: center;">
        <div class="stat-value" style="font-size: 28px; font-weight: 700; color: var(--ink, #0B8073);">${s.reviewCount}</div>
        <div class="stat-label" style="font-size: 12px; color: #6b7280; font-weight: 500;">Reviews</div>
      </div>`
          : ''
      }
    </div>
  `;

  // Trust indicators
  const trustHtml = `
    <div class="supplier-trust" style="margin: 20px 0; padding: 16px; background: white; border: 2px solid #E7EAF0; border-radius: 12px;">
      <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 12px; color: var(--text, #0B1220);">Trust & Safety</h3>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${s.verifications?.email ? '<div style="display: flex; align-items: center; gap: 8px;"><span style="color: #10b981; font-weight: 600;">✓</span> <span style="font-size: 14px;">Email verified</span></div>' : ''}
        ${s.verifications?.phone ? '<div style="display: flex; align-items: center; gap: 8px;"><span style="color: #10b981; font-weight: 600;">✓</span> <span style="font-size: 14px;">Phone verified</span></div>' : ''}
        ${s.verifications?.business ? '<div style="display: flex; align-items: center; gap: 8px;"><span style="color: #10b981; font-weight: 600;">✓</span> <span style="font-size: 14px;">Business verified</span></div>' : ''}
        ${s.insurance ? '<div style="display: flex; align-items: center; gap: 8px;"><span style="color: #10b981; font-weight: 600;">✓</span> <span style="font-size: 14px;">Insured</span></div>' : ''}
        ${s.license ? '<div style="display: flex; align-items: center; gap: 8px;"><span style="color: #10b981; font-weight: 600;">✓</span> <span style="font-size: 14px;">Licensed</span></div>' : ''}
      </div>
    </div>
  `;

  document.getElementById('supplier-container').innerHTML = `
    <div class="card supplier-profile-card" style="background: linear-gradient(135deg, ${themeColor} 0%, ${themeColorDark} 100%); color: white; padding: 0; overflow: hidden; animation: fadeInScale 0.5s ease-out;">
      <div style="position: relative; height: 200px; overflow: hidden;">
        <img src="${escapeHtml(bannerImg)}" alt="${escapeHtml(s.name)} banner" style="width: 100%; height: 100%; object-fit: cover; opacity: ${s.bannerUrl ? '1' : '0.3'};">
        <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(to bottom, transparent 0%, ${themeColor}CC 100%);"></div>
      </div>
      <div style="padding: 24px; margin-top: -60px; position: relative;">
        <div style="background: white; border-radius: 50%; width: 100px; height: 100px; display: flex; align-items: center; justify-content: center; font-size: 48px; font-weight: 700; color: ${themeColor}; box-shadow: 0 4px 12px rgba(0,0,0,0.15); margin-bottom: 16px;">
          ${s.name ? s.name.charAt(0).toUpperCase() : 'S'}
        </div>
        <h1 style="font-size: 32px; font-weight: 700; margin: 0 0 8px 0; color: white;">${escapeHtml(s.name)}</h1>
        ${s.tagline ? `<p style="font-size: 18px; color: rgba(255,255,255,0.95); margin-bottom: 12px; font-style: italic;">"${escapeHtml(s.tagline)}"</p>` : ''}
        <div style="font-size: 16px; color: rgba(255,255,255,0.9); margin-bottom: 12px;">
          ${escapeHtml(s.location || '')} · <span class="badge" style="background: rgba(255,255,255,0.2); color: white;">${escapeHtml(s.category)}</span> ${s.price_display ? `· ${escapeHtml(s.price_display)}` : ''}
        </div>
        ${badgesHtml}
      </div>
    </div>

    ${statsHtml}
    
    ${highlightsHtml}
    
    <div class="card" style="animation: fadeInUp 0.5s ease-out 0.1s backwards;">
      <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 12px;">About</h2>
      ${facts}
      <div class="small" style="margin-top:12px">${amenities}</div>
      <p style="margin-top:16px; line-height: 1.6;">${escapeHtml(s.description_long || s.description_short || '')}</p>
      ${featuredServicesHtml}
      ${socialLinksHtml}
      ${trustHtml}
      <div class="form-actions" style="margin-top:20px; display: flex; gap: 12px; flex-wrap: wrap;">
        <button class="cta" id="add" style="flex: 1; min-width: 150px;">Add to My Plan</button>
        <button class="cta secondary" id="save-supplier-btn" data-supplier-id="${escapeHtml(s.id)}" style="flex: 1; min-width: 150px;" aria-label="Save supplier to favorites">♡ Save</button>
        <button class="cta secondary" id="start-thread" style="flex: 1; min-width: 150px;">Start Conversation</button>
      </div>
    </div>

    <section class="section" style="animation: fadeInUp 0.5s ease-out 0.2s backwards;">
      <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 16px;">Gallery</h2>
      <div class="cards">${gallery || '<div class="card"><p class="small">No photos yet.</p></div>'}</div>
    </section>
    
    <section class="section" style="animation: fadeInUp 0.5s ease-out 0.3s backwards;">
      <h2 style="font-size: 24px; font-weight: 600; margin-bottom: 16px;">Packages & Services</h2>
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
            <button id="btn-write-review" class="btn-write-review" aria-label="Write a review for this supplier">✍️ Write a Review</button>
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
          const r = await fetch(`/api/v1/plan/${encodeURIComponent(s.id)}`, {
            method: 'DELETE',
            headers: {
              'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
            },
            credentials: 'include',
          });
          if (r.ok) {
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
          const r = await fetch('/api/v1/plan', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
            },
            credentials: 'include',
            body: JSON.stringify({ supplierId: s.id }),
          });
          if (r.ok) {
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
    startThreadBtn.addEventListener('click', async () => {
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
        const r = await fetch('/api/v4/messenger/conversations', {
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
          d = await r.json();
        } catch (_) {
          /* Ignore JSON parse errors */
        }
        if (!r.ok) {
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
  toast.className = 'toast-notification';
  toast.textContent = message;

  const colors = {
    success: '#10b981',
    error: '#ef4444',
    info: '#3b82f6',
  };

  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: ${colors[type] || colors.info};
    color: white;
    padding: 16px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10000;
    animation: slideInUp 0.3s ease-out;
    max-width: 400px;
    font-size: 14px;
    line-height: 1.5;
  `;

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
      <button class="lightbox-close" aria-label="Close lightbox">&times;</button>
      ${photos.length > 1 ? '<button class="lightbox-nav lightbox-prev" aria-label="Previous photo">&lsaquo;</button>' : ''}
      <img class="lightbox-image" src="${escapeHtml(photos[currentIndex])}" alt="Gallery photo ${currentIndex + 1}">
      ${photos.length > 1 ? '<button class="lightbox-nav lightbox-next" aria-label="Next photo">&rsaquo;</button>' : ''}
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
    } catch (_e) {
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
    } catch (_e) {
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
  } catch (_e) {
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
                  <td><button class="link-button" data-remove-budget="${row.id}">Remove</button></td>
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
                <td><button class="link-button" data-remove-guest="${g.id}">Remove</button></td>
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
                <td><button class="link-button" data-remove-task="${t.id}">Remove</button></td>
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
                <td><button class="link-button" data-remove-timeline="${t.id}">Remove</button></td>
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
  } catch (_e) {
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
              otherParticipant && otherParticipant.name
                ? otherParticipant.name
                : t.title || 'Conversation';
            const last = (
              (t.lastMessage && t.lastMessage.content) ||
              t.lastMessageText ||
              ''
            ).slice(0, 80);
            const when = t.updatedAt ? new Date(t.updatedAt).toLocaleString() : '';
            const convId = t._id || t.id;
            return `
            <button class="thread-row" type="button" data-open="${convId}">
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
  } catch (_e) {
    host.innerHTML = '<p class="small">Could not load conversations.</p>';
  }
}

function efMaybeShowOnboarding(page) {
  // Check if onboarding has been permanently dismissed
  try {
    const dismissed = localStorage.getItem('ef_onboarding_dismissed');
    if (dismissed === '1') {
      return;
    }
  } catch (_) {
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
  } catch (_) {
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
    box.className = 'card glass-card glass-card--teal glass-card--elevated';
    box.style.background = '#ffffff';
    box.style.color = '#1f2937';
    box.style.padding = '2rem';
    box.style.borderRadius = '16px';
    box.style.boxShadow =
      '0 12px 40px rgba(11, 128, 115, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.15)';
    box.style.textAlign = 'center';
    box.style.border = '1px solid rgba(11, 128, 115, 0.15)';

    box.innerHTML = `
      <div style="font-size: 3rem; margin-bottom: 1rem;" role="img" aria-label="celebration">🎉</div>
      <h2 style="color: #1f2937; font-size: 1.75rem; font-weight: 700; margin-bottom: 0.75rem;">Welcome to Your Supplier Dashboard!</h2>
      <p style="color: #4b5563; font-size: 1.1rem; line-height: 1.6; margin-bottom: 1.5rem; max-width: 600px; margin-left: auto; margin-right: auto;">
        You're all set to showcase your services and connect with event planners. Let's help you get started on your journey!
      </p>
      <div style="background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 12px; padding: 1.25rem; margin-bottom: 1.5rem; text-align: left; max-width: 600px; margin-left: auto; margin-right: auto;">
        <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem;">
          <span style="font-size: 1.5rem;" aria-hidden="true">✨</span>
          <span style="color: #1f2937; font-weight: 500;">Complete your supplier profile</span>
        </div>
        <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem;">
          <span style="font-size: 1.5rem;" aria-hidden="true">📦</span>
          <span style="color: #1f2937; font-weight: 500;">Add your first package or service</span>
        </div>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span style="font-size: 1.5rem;" aria-hidden="true">💬</span>
          <span style="color: #1f2937; font-weight: 500;">Start engaging with customers</span>
        </div>
      </div>
      <button type="button" class="cta" id="ef-onboarding-dismiss" aria-label="Dismiss onboarding and start using dashboard" style="background: #0B8073; color: #ffffff; font-weight: 600; padding: 0.75rem 2rem; border-radius: 10px; border: none; cursor: pointer; font-size: 1rem; box-shadow: 0 4px 12px rgba(11, 128, 115, 0.3); transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);">Got it! Let's go 🚀</button>
    `;

    const cards = container.querySelector('.cards');
    if (cards && cards.parentNode === container) {
      container.insertBefore(box, cards);
    } else {
      container.insertBefore(box, container.firstChild);
    }

    const btn = box.querySelector('#ef-onboarding-dismiss');
    if (btn) {
      // Add hover effect with teal theme glow
      btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'scale(1.05) translateY(-2px)';
        btn.style.boxShadow = '0 8px 20px rgba(11, 128, 115, 0.3)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'scale(1) translateY(0)';
        btn.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
      });

      // Save permanent dismissal and remove card
      btn.addEventListener('click', () => {
        try {
          localStorage.setItem('ef_onboarding_dismissed', '1');
        } catch (_) {
          /* Ignore localStorage errors */
        }
        const easing = 'cubic-bezier(0.4, 0, 0.2, 1)';
        box.style.transition = `opacity 0.3s ${easing}, transform 0.3s ${easing}`;
        box.style.opacity = '0';
        box.style.transform = 'scale(0.95)';
        setTimeout(() => box.remove(), 300);
      });
    }
    return;
  }

  // For other pages (customer, admin), create the onboarding card as before
  const container = document.querySelector('main .container');
  if (!container) {
    return;
  }

  const box = document.createElement('div');
  box.className = 'card';
  let body = '';
  if (page === 'dash_customer') {
    body =
      '<p class="small">Here\'s what to do next:</p>' +
      '<ol class="small"><li>Start an event from <strong>Plan an Event</strong>.</li>' +
      '<li>Add a few suppliers to <strong>My Plan</strong>.</li>' +
      '<li>Use <strong>Conversations</strong> to keep messages in one place.</li></ol>';
  } else if (page === 'admin') {
    body =
      '<p class="small">Quick overview:</p>' +
      '<ol class="small"><li>Check <strong>Metrics</strong> to see demo usage.</li>' +
      '<li>Approve or hide supplier profiles and packages.</li>' +
      '<li>Use <strong>Reset demo data</strong> to get back to a clean state.</li></ol>';
  }

  box.innerHTML = `<h2 class="h4">Welcome to EventFlow</h2>${
    body
  }<div class="form-actions" style="margin-top:8px"><button type="button" class="cta secondary" id="ef-onboarding-dismiss">Got it</button></div>`;

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
      } catch (_) {
        /* Ignore localStorage errors */
      }
      box.remove();
    });
  }
}

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
    }
  } catch (_e) {
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
        const errorData = await r.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errorData.error || `HTTP ${r.status}`);
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
      cachedSuppliers = items; // Cache for use within initDashSupplier scope
      window._efCachedSuppliers = items; // Expose globally for editProfile()
      // If this user has at least one Pro supplier, treat them as Pro.
      currentIsPro = items.some(s => !!s.isPro);

      if (proRibbon) {
        if (currentIsPro) {
          proRibbon.style.display = 'block';
          proRibbon.innerHTML =
            '<strong>You’re on EventFlow Pro.</strong> Your listing can appear higher in search and you have access to premium features as we roll them out.';
        } else {
          proRibbon.style.display = 'block';
          proRibbon.innerHTML =
            '<strong>You’re on the free plan.</strong> Upgrade to EventFlow Pro to boost your visibility, unlock more packages and get priority support.';
        }
      }

      if (!supWrap) {
        return;
      }

      if (!items || items.length === 0) {
        supWrap.innerHTML =
          '<div class="sd-empty-state"><div class="sd-empty-state__icon" aria-hidden="true">👤</div><div class="sd-empty-state__body"><p class="sd-empty-state__title">No profiles yet</p><p class="sd-empty-state__desc">Create your first supplier profile to start attracting clients.</p></div></div>';
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
      supWrap.innerHTML = items
        .map(s => {
          // Safe access to supplier properties
          if (!s) {
            return '';
          }

          // Enhanced badge rendering for Pro and Pro+ tiers
          let proBadge = '';
          // Check subscriptionTier field first (new), then fall back to subscription.tier or isPro
          const tier =
            s.subscriptionTier ||
            (s.subscription && s.subscription.tier) ||
            (s.isPro || s.pro ? 'pro' : null);

          if (tier === 'pro_plus') {
            proBadge = '<span class="badge badge-pro-plus">Professional Plus</span>';
          } else if (tier === 'pro') {
            proBadge = '<span class="badge badge-pro">Professional</span>';
          }

          // Calculate profile completeness checklist with safe property access
          const hasPhotos =
            s.photosGallery && Array.isArray(s.photosGallery) && s.photosGallery.length > 0;
          const hasDescription =
            s.description_long &&
            typeof s.description_long === 'string' &&
            s.description_long.length > 50;
          const hasCategory = s.category && typeof s.category === 'string' && s.category.length > 0;
          const hasLocation = s.location && typeof s.location === 'string' && s.location.length > 0;
          const hasWebsite = s.website && typeof s.website === 'string' && s.website.length > 0;

          const checklistItems = [
            { label: 'Photos uploaded', complete: hasPhotos },
            { label: 'Detailed description', complete: hasDescription },
            { label: 'Category set', complete: hasCategory },
            { label: 'Location specified', complete: hasLocation },
            { label: 'Website added', complete: hasWebsite },
          ];
          const completedCount = checklistItems.filter(item => item.complete).length;
          const checklistHtml = checklistItems
            .map(
              item =>
                `<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.875rem;color:#667085;">
            <span style="color:${item.complete ? '#10b981' : '#d1d5db'}">${item.complete ? '✓' : '○'}</span>
            <span>${item.label}</span>
          </div>`
            )
            .join('');

          // Safe access to all fields with defaults — escape all user-supplied values to prevent XSS
          const supplierId = String(s.id || '').replace(/"/g, '&quot;');
          const name = escapeHtml(String(s.name || 'Unnamed Supplier'));
          const galleryItems =
            s.photosGallery && Array.isArray(s.photosGallery) ? s.photosGallery : [];
          // Validate photoUrl to allow only safe http/https/relative URLs
          const rawPhotoUrl = (galleryItems[0] && galleryItems[0].url) || '';
          const photoUrl =
            rawPhotoUrl && /^(https?:\/\/|\/[^:])/i.test(rawPhotoUrl)
              ? escapeHtml(rawPhotoUrl)
              : '/assets/images/collage-venue.svg';
          const location = escapeHtml(String(s.location || 'Location not set'));
          const category = escapeHtml(String(s.category || 'Uncategorized'));
          const priceDisplay = s.price_display ? ` · ${escapeHtml(String(s.price_display))}` : '';
          const description = escapeHtml(String(s.description_short || ''));
          const approved = !!s.approved;

          return `<div class="supplier-card card" style="margin-bottom:10px" data-supplier-id="${supplierId}">
      <img src="${photoUrl}" alt="${name} profile photo" onerror="console.warn('Failed to load supplier image:', this.src); this.src='/assets/images/collage-venue.svg'; this.onerror=null;">
      <div>
        <h3>${name} ${proBadge} ${approved ? '<span class="badge">Approved</span>' : '<span class="badge" style="background:#FFF5E6;color:#8A5A00">Awaiting review</span>'}</h3>
        <div class="small">${location} · <span class="badge">${category}</span>${priceDisplay}</div>
        <p class="small">${description}</p>
        <div class="listing-health">
          <div class="listing-health-bar">
            <div class="listing-health-fill"></div>
          </div>
          <div class="listing-health-label">Listing health: calculating…</div>
        </div>
        <details style="margin-top:0.75rem;">
          <summary style="cursor:pointer;font-size:0.875rem;color:#667eea;font-weight:500;">
            Profile Setup Checklist (${completedCount}/${checklistItems.length})
          </summary>
          <div style="margin-top:0.5rem;display:flex;flex-direction:column;gap:0.25rem;padding-left:0.5rem;">
            ${checklistHtml}
          </div>
        </details>
        <div class="card-actions">
          <button type="button" class="card-action-btn edit-btn" data-action="edit-profile" data-profile-id="${supplierId}">Edit</button>
        </div>
      </div>
    </div>`;
        })
        .join('');

      // Listing health based on smart score if present
      const rows = supWrap.querySelectorAll('.supplier-card');
      items.forEach((s, idx) => {
        if (!s) {
          return;
        }

        const row = rows[idx];
        if (!row) {
          return;
        }
        const bar = row.querySelector('.listing-health-fill');
        const label = row.querySelector('.listing-health-label');
        const score = typeof s.aiScore === 'number' ? s.aiScore : 0;
        if (bar) {
          bar.style.width = `${score || 10}%`;
        }
        if (label) {
          label.textContent = score
            ? `Listing health: ${score}%`
            : 'Listing health: add photos and details to improve this listing.';
        }
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
          // Keep in sync when the user changes the dropdown (attach once via onchange)
          select.onchange = () => {
            hiddenInput.value = select.value;
          };
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
    const supPrice = document.getElementById('sup-price');
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
    if (supPrice) {
      supPrice.value = supplier.price_display || '';
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
        imgDiv.style.cssText = 'width:100%;height:150px;border-radius:8px;position:relative;';

        const img = document.createElement('img');
        img.src = supplier.bannerUrl; // Browser automatically sanitizes
        img.alt = 'Banner preview';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:8px;';

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
      const count = items.length;
      const freeLimit = 3; // keep in sync with server FREE_PACKAGE_LIMIT default

      // Update note about allowance
      if (note) {
        if (currentIsPro) {
          note.textContent = count
            ? `You have ${count} package${count === 1 ? '' : 's'}. As a Pro supplier you can create unlimited packages.`
            : 'As a Pro supplier you can create unlimited packages.';
        } else {
          note.textContent = count
            ? `You have ${count} of ${freeLimit} packages on the free plan. Upgrade to Pro to unlock more.`
            : `On the free plan you can create up to ${freeLimit} packages.`;
        }
      }

      // If at limit on free plan, gently disable the form
      const pkgForm = document.getElementById('package-form');
      const pkgStatus = document.getElementById('pkg-status');
      const atLimit = !currentIsPro && count >= freeLimit;
      if (pkgForm) {
        const inputs = pkgForm.querySelectorAll('input, textarea, select, button[type="submit"]');
        inputs.forEach(el => {
          if (el.type === 'submit') {
            el.disabled = atLimit;
          } else {
            el.disabled = atLimit;
          }
        });
        if (pkgStatus) {
          if (atLimit) {
            pkgStatus.textContent =
              'You have reached the package limit on the free plan. Upgrade to Pro to add more.';
          } else {
            pkgStatus.textContent = '';
          }
        }
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
          const slug = String(p.slug || '').replace(/"/g, '&quot;');

          const approvalBadge = approved
            ? ''
            : '<span class="badge badge-pending" title="This package is awaiting admin approval before it appears publicly">Awaiting review</span>';
          const viewBtn =
            approved && slug
              ? `<a href="/package?slug=${slug}" target="_blank" class="card-action-btn view-btn">View</a>`
              : '';

          return `<div class="card package-card" data-package-id="${packageId}">
      <img src="${image}" alt="${title} image" onerror="this.src='/assets/images/package-placeholder.svg'; this.onerror=null;">
      <div>
        <h3>${title}</h3>
        <div class="small"><span class="badge">${priceDisplay}</span> ${featured ? '<span class="badge">Featured</span>' : ''} ${approvalBadge}</div>
        <p class="small">${description}</p>
        <div class="card-actions">
          <button type="button" class="card-action-btn edit-btn" data-action="edit-package" data-package-id="${packageId}">Edit</button>
          ${viewBtn}
          <button type="button" class="card-action-btn delete-btn" data-action="delete-package" data-package-id="${packageId}">Delete</button>
        </div>
      </div>
    </div>`;
        })
        .join('');
    } catch (err) {
      console.error('Error loading packages:', err);
      if (pkgsWrap) {
        pkgsWrap.innerHTML =
          '<div class="sd-empty-state"><div class="sd-empty-state__icon" aria-hidden="true">⚠️</div><div class="sd-empty-state__body"><p class="sd-empty-state__title">Could not load packages</p><p class="sd-empty-state__desc">Please refresh the page to try again.</p></div></div>';
      }
    }
  }
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
  document.addEventListener('click', e => {
    const target = e.target;

    // Handle package edit buttons
    if (target.matches('[data-action="edit-package"]')) {
      const packageId = target.getAttribute('data-package-id');
      if (packageId) {
        editPackage(packageId);
      }
    }

    // Handle package delete buttons
    if (target.matches('[data-action="delete-package"]')) {
      const packageId = target.getAttribute('data-package-id');
      if (packageId) {
        deletePackage(packageId);
      }
    }

    // Handle profile edit buttons
    if (target.matches('[data-action="edit-profile"]')) {
      const profileId = target.getAttribute('data-profile-id');
      if (profileId) {
        editProfile(profileId);
      }
    }

    // Handle profile delete buttons
    if (target.matches('[data-action="delete-profile"]')) {
      const profileId = target.getAttribute('data-profile-id');
      if (profileId) {
        deleteProfile(profileId);
      }
    }

    // Handle gallery photo delete buttons
    if (target.matches('.pkg-gallery-delete')) {
      const photoUrl = target.getAttribute('data-url');
      const packageId = target.getAttribute('data-package-id');
      if (photoUrl && packageId) {
        deletePackagePhoto(packageId, photoUrl, target);
      }
    }

    // Handle gallery save-order button
    if (target.matches('#pkg-gallery-save-order')) {
      savePkgGalleryOrder();
    }
  });

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
    return payload;
  }

  const supForm = document.getElementById('supplier-form');
  if (supForm) {
    supForm.addEventListener('submit', async e => {
      e.preventDefault();

      if (typeof window.validateVenuePostcode === 'function') {
        if (!window.validateVenuePostcode()) {
          return; // Stop submission if validation fails
        }
      }

      const statusEl = document.getElementById('sup-status');
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

        // Update currently editing supplier ID with the saved/created ID
        if (response && response.supplier && response.supplier.id) {
          currentEditingSupplierId = response.supplier.id;
        } else if (id) {
          currentEditingSupplierId = id;
        }

        await loadSuppliers();

        if (statusEl) {
          statusEl.textContent = '✓ Saved successfully';
          statusEl.style.color = '#10b981';
          setTimeout(() => {
            statusEl.textContent = '';
          }, 3000);
        }
      } catch (err) {
        console.error('Error saving supplier:', err);
        if (statusEl) {
          statusEl.textContent = `Error: ${err.message || 'Please try again'}`;
          statusEl.style.color = '#ef4444';
        }
      }
    });
  }

  // Preview button handler
  const previewBtn = document.getElementById('sup-preview');
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      const supplierIdInput = document.getElementById('sup-id');
      if (supplierIdInput && supplierIdInput.value) {
        const supplierId = supplierIdInput.value;
        window.open(`/supplier?id=${encodeURIComponent(supplierId)}&preview=true`, '_blank');
      } else {
        alert('Please save your profile first before previewing.');
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
        alert('Please select at least one event type (Wedding or Other)');
        return;
      }
      if (!payload.price || !String(payload.price).trim()) {
        alert('Please enter a price for this package.');
        return;
      }

      const id = payload.id;
      const path = id ? `/api/me/packages/${encodeURIComponent(id)}` : '/api/me/packages';
      const method = id ? 'PUT' : 'POST';

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
        const galleryExisting = document.getElementById('pkg-gallery-existing');
        if (galleryExisting) {
          galleryExisting.innerHTML = '';
          galleryExisting.style.display = 'none';
        }
        const galleryRow = document.getElementById('pkg-gallery-row');
        if (galleryRow) {
          galleryRow.style.display = 'none';
        }
      } catch (err) {
        alert(`Error saving package: ${err.message || 'Please try again'}`);
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = origLabel;
        }
      }
    });
  }

  // Drag & drop photo uploads
  efSetupPhotoDropZone(
    'sup-photo-drop',
    'sup-photo-preview',
    dataUrl => {
      const area = document.getElementById('sup-photos');
      if (!area) {
        return;
      }
      const current = (area.value || '')
        .split(/\r?\n/)
        .map(x => {
          return x.trim();
        })
        .filter(Boolean);
      current.push(dataUrl);
      area.value = current.join('\n');
    },
    dataUrl => {
      // Remove this specific data URL from the multiline textarea
      const area = document.getElementById('sup-photos');
      if (!area || !dataUrl) {
        return;
      }
      const updated = (area.value || '')
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(x => x && x !== dataUrl);
      area.value = updated.join('\n');
    }
  );

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
          } catch (err) {
            if (status) {
              status.textContent = 'Network error – please try again.';
            }
          }
        });
      }
    } catch (_e) {
      host.innerHTML = '<p class="small">Billing status is currently unavailable.</p>';
    }
  })();
}

// Package Form Toggle, Edit, and Delete Functions
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

      // Set supplier select if available
      const supplierSelect = document.getElementById('pkg-supplier');
      if (supplierSelect && pkg.supplierId) {
        supplierSelect.value = pkg.supplierId;
        document.getElementById('pkg-supplier-id-hidden').value = pkg.supplierId;
      }

      // Set event type checkboxes
      if (pkg.eventTypes && Array.isArray(pkg.eventTypes)) {
        document.getElementById('pkg-event-wedding').checked = pkg.eventTypes.includes('wedding');
        document.getElementById('pkg-event-other').checked = pkg.eventTypes.includes('other');
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
  } catch (e) {
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

async function editProfile(supplierId) {
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
      setVal('sup-price', supplier.price_display);
      setVal('sup-short', supplier.description_short);
      setVal('sup-long', supplier.description_long);
      setVal('sup-website', supplier.website);
      setVal('sup-license', supplier.license);
      setVal('sup-amenities', supplier.amenities);
      setVal('sup-max', supplier.maxGuests);
      if (supplier.venuePostcode) {
        setVal('sup-venue-postcode', supplier.venuePostcode);
      }
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

    // Scroll to form
    setTimeout(() => {
      if (formSection) {
        formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
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
      } catch (e) {
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
  } catch (e) {
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
  } catch (e) {
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
  } catch (e) {
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

  // Display backend version in footer if available
  (async () => {
    try {
      const label = document.getElementById('ef-version-label');
      if (!label) {
        return;
      }
      const r = await fetch('/api/v1/meta', {
        credentials: 'include',
      });
      if (!r.ok) {
        label.textContent = 'unknown';
        return;
      }
      const data = await r.json();
      if (data && data.version) {
        label.textContent = `${data.version} (Node ${data.node || ''})`.trim();
      } else {
        label.textContent = 'dev';
      }
    } catch (_err) {
      const label = document.getElementById('ef-version-label');
      if (label) {
        label.textContent = 'offline';
      }
    }
  })();

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
  } catch (_err) {
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
    toggle.addEventListener('click', () => {
      if (input.type === 'password') {
        input.type = 'text';
        toggle.innerHTML = SVG_EYE_OFF;
        toggle.setAttribute('aria-label', 'Hide password');
      } else {
        input.type = 'password';
        toggle.innerHTML = SVG_EYE;
        toggle.setAttribute('aria-label', 'Show password');
      }
    });
    input.classList.add('has-toggle');
    wrapper.appendChild(toggle);
  };

  if (page === 'auth') {
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
      } catch (_) {
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
        } catch (_) {
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

        // Update requirements list
        if (reqLength) {
          reqLength.style.color = hasLength ? '#10b981' : '#b00020';
          reqLength.style.fontWeight = hasLength ? '600' : '400';
        }
        if (reqLetter) {
          reqLetter.style.color = hasLetter ? '#10b981' : '#b00020';
          reqLetter.style.fontWeight = hasLetter ? '600' : '400';
        }
        if (reqNumber) {
          reqNumber.style.color = hasNumber ? '#10b981' : '#b00020';
          reqNumber.style.fontWeight = hasNumber ? '600' : '400';
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

      if (regPasswordConfirm) {
        regPasswordConfirm.addEventListener('input', validatePasswordMatch);
        regPasswordConfirm.addEventListener('blur', validatePasswordMatch);
      }
    }

    // Account type toggle (customer / supplier)
    const roleHidden = document.getElementById('reg-role');
    const rolePills = document.querySelectorAll('.role-pill');
    const supplierFields = document.getElementById('supplier-fields');
    const companyInput = document.getElementById('reg-company');

    if (rolePills && rolePills.length) {
      rolePills.forEach(btn => {
        btn.addEventListener('click', () => {
          rolePills.forEach(b => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          if (roleHidden) {
            const val = btn.getAttribute('data-role') || 'customer';
            roleHidden.value = val;

            // Show/hide supplier-specific fields
            if (supplierFields) {
              if (val === 'supplier') {
                supplierFields.style.display = 'block';
                if (companyInput) {
                  companyInput.required = true;
                }
              } else {
                supplierFields.style.display = 'none';
                if (companyInput) {
                  companyInput.required = false;
                }
              }
            }
          }
        });
      });
    }

    // Helper function to get headers with CSRF token
    const getHeadersWithCsrf = function (additionalHeaders = {}) {
      const headers = { ...additionalHeaders };
      const csrfToken = window.__CSRF_TOKEN__;
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }
      return headers;
    };

    // Helper function to show toast notification
    const showToast = function (message, type = 'info') {
      const toast = document.createElement('div');
      toast.className = 'ef-toast';
      toast.textContent = message;
      toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        opacity: 0;
        transform: translateX(400px);
        transition: all 0.3s ease;
      `;
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
            showToast('Please enter your email address', 'error');
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
            } catch (_) {
              /* Ignore JSON parse errors */
            }

            if (r.ok) {
              showToast(
                data.message || 'Verification email sent! Please check your inbox.',
                'success'
              );
              if (loginStatus) {
                loginStatus.textContent =
                  'Verification email sent. Please check your inbox and verify your account.';
              }
            } else {
              showToast(
                data.error || 'Failed to send verification email. Please try again.',
                'error'
              );
            }
          } catch (err) {
            console.error('Resend verification error', err);
            showToast('Network error. Please try again.', 'error');
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

        if (loginBtn) {
          loginBtn.disabled = true;
          loginBtn.textContent = 'Signing in…';
        }
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
          } catch (_) {
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
            } catch (_e) {
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
          if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.textContent = 'Log in';
          }
        }
      });
    }

    if (regForm && regEmail && regPassword) {
      const regBtn = regForm.querySelector('button[type="submit"]');
      regForm.addEventListener('submit', async e => {
        e.preventDefault();
        if (regStatus) {
          regStatus.textContent = '';
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
          if (regStatus) {
            regStatus.textContent =
              'Password must be at least 8 characters and contain both letters and numbers';
          }
          // Scroll to password field
          regPassword.focus();
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
          if (regPasswordConfirm) {
            regPasswordConfirm.focus();
          }
          return;
        }

        // Validate terms checkbox
        const termsCheckbox = document.getElementById('reg-terms');
        if (termsCheckbox && !termsCheckbox.checked) {
          if (regStatus) {
            regStatus.textContent =
              'You must agree to the Terms and Privacy Policy to create an account.';
          }
          return;
        }

        if (regBtn) {
          regBtn.disabled = true;
          regBtn.textContent = 'Creating…';
        }
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
            if (regStatus) {
              regStatus.textContent = 'Please select your location';
            }
            if (regBtn) {
              regBtn.disabled = false;
              regBtn.textContent = 'Create account';
            }
            return;
          }

          if (role === 'supplier' && !company) {
            if (regStatus) {
              regStatus.textContent = 'Company name is required for suppliers';
            }
            if (regBtn) {
              regBtn.disabled = false;
              regBtn.textContent = 'Create account';
            }
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

          // Include ALTCHA payload if the widget is present in the form
          const altchaWidget = document.getElementById('reg-altcha-widget');
          if (altchaWidget) {
            // Use the payload captured via the statechange event (window.__altchaRegPayload),
            // falling back to the .value property exposed by ALTCHA v2.
            payload.captchaToken = window.__altchaRegPayload || altchaWidget.value || null;
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
          } catch (_) {
            /* Ignore JSON parse errors */
          }
          if (!r.ok) {
            // Provide specific error messages
            let errorMsg = 'Could not create account. Please check your details.';
            if (data.error) {
              if (data.error.includes('email')) {
                errorMsg = data.error;
              } else if (data.error.includes('password')) {
                errorMsg = data.error;
              } else {
                errorMsg = data.error;
              }
            }
            if (regStatus) {
              regStatus.textContent = errorMsg;
            }
          } else {
            // Handle avatar upload if file was selected
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
                if (regStatus) {
                  regStatus.innerHTML =
                    'Account created. Check your email to verify your account, then you can sign in. ' +
                    '<button type="button" id="resend-verify-btn" class="link-button" style="text-decoration:underline;margin-left:4px;">Resend email</button>';

                  // Add resend handler
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
                          body: JSON.stringify({ email }),
                        });
                        const resendData = await resendResp.json();
                        if (resendResp.ok) {
                          showNetworkError(
                            resendData.message || 'Verification email sent!',
                            'success'
                          );
                        } else {
                          showNetworkError(resendData.error || 'Failed to send email', 'error');
                        }
                      } catch (err) {
                        showNetworkError('Network error - please try again', 'error');
                      } finally {
                        resendBtn.disabled = false;
                        resendBtn.textContent = 'Resend email';
                      }
                    });
                  }
                }
              }
            } else {
              if (regStatus) {
                regStatus.innerHTML =
                  'Account created. Check your email to verify your account, then you can sign in. ' +
                  '<button type="button" id="resend-verify-btn" class="link-button" style="text-decoration:underline;margin-left:4px;">Resend email</button>';

                // Add resend handler
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
                        body: JSON.stringify({ email }),
                      });
                      const resendData = await resendResp.json();
                      if (resendResp.ok) {
                        showNetworkError(
                          resendData.message || 'Verification email sent!',
                          'success'
                        );
                      } else {
                        showNetworkError(resendData.error || 'Failed to send email', 'error');
                      }
                    } catch (err) {
                      showNetworkError('Network error - please try again', 'error');
                    } finally {
                      resendBtn.disabled = false;
                      resendBtn.textContent = 'Resend email';
                    }
                  });
                }
              }
            }
          }
        } catch (err) {
          if (regStatus) {
            regStatus.textContent = 'Network error – please try again.';
          }
          console.error('Register error', err);
        } finally {
          if (regBtn) {
            regBtn.disabled = false;
            regBtn.textContent = 'Create account';
          }
        }
      });
    }
  }

  // Attach password visibility toggles to any remaining fields on any page
  // (the guard in attachPasswordToggle prevents double-initialization)
  document.querySelectorAll('.form-row input[type="password"]').forEach(attachPasswordToggle);
});

// Helper function to create resend verification form
// Used by verify-init.js and other pages
// eslint-disable-next-line no-unused-vars
function createResendVerificationForm(containerId, initialEmail = '') {
  const container = document.getElementById(containerId);
  if (!container) {
    return null;
  }

  const formHtml =
    '<div style="margin-top:16px;">' +
    `<input type="email" id="resend-email-${containerId}" placeholder="Enter your email" value="${initialEmail}" style="padding:8px;border:1px solid #ccc;border-radius:4px;margin-right:8px;">` +
    `<button type="button" id="resend-verify-btn-${containerId}" class="btn btn-primary">Send new verification email</button>` +
    '</div>';

  const existingContent = container.innerHTML;
  container.innerHTML = existingContent + formHtml;

  const resendBtn = document.getElementById(`resend-verify-btn-${containerId}`);
  const emailInput = document.getElementById(`resend-email-${containerId}`);

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
          container.innerHTML = `<p class="small">${resendData.message || 'Verification email sent! Check your inbox.'}</p>`;
        } else {
          showNetworkError(resendData.error || 'Failed to send email', 'error');
        }
      } catch (err) {
        showNetworkError('Network error - please try again', 'error');
      } finally {
        resendBtn.disabled = false;
        resendBtn.textContent = 'Send new verification email';
      }
    });
  }

  return { resendBtn, emailInput };
}

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
        '<button type="button" id="resend-verify-btn" class="btn btn-primary">Send new verification email</button>' +
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
              statusEl.innerHTML = `<p class="small">${resendData.message || 'Verification email sent! Check your inbox.'}</p>`;
            } else {
              showNetworkError(resendData.error || 'Failed to send email', 'error');
            }
          } catch (err) {
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
          `<p class="small">${errorMessage}</p>` +
          `<div style="margin-top:16px;">` +
          `<input type="email" id="resend-email" placeholder="Enter your email" style="padding:8px;border:1px solid #ccc;border-radius:4px;margin-right:8px;">` +
          `<button type="button" id="resend-verify-btn" class="btn btn-primary">Send new verification email</button>` +
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
                statusEl.innerHTML = `<p class="small">${resendData.message || 'Verification email sent! Check your inbox.'}</p>`;
              } else {
                showNetworkError(resendData.error || 'Failed to send email', 'error');
              }
            } catch (err) {
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
  } catch (e) {
    /* Ignore confetti errors */
  }
}

// Supplier onboarding checklist visual (client side)
function renderSupplierChecklist(wrapper, supplierCount, packageCount) {
  const steps = [
    { name: 'Create a supplier profile', done: supplierCount > 0 },
    { name: 'Get approved by admin', done: false }, // can't know client-side; show informational
    { name: 'Add at least one package', done: packageCount > 0 },
  ];
  wrapper.innerHTML = `<h3>Onboarding</h3>${steps
    .map(s => `<div class="small">${s.done ? '✅' : '⬜️'} ${s.name}</div>`)
    .join('')}`;
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.__EF_PAGE__ === 'admin') {
    adminCharts();
  }
  if (window.__EF_PAGE__ === 'dash_supplier') {
    (async () => {
      try {
        const me = await fetch('/api/v1/me/suppliers', {
          credentials: 'include',
        });
        const ms = await me.json();
        const pk = await fetch('/api/v1/me/packages', {
          credentials: 'include',
        });
        const mp = await pk.json();
        const box = document.createElement('div');
        box.className = 'card';
        box.style.marginTop = '16px';
        document.querySelector('main .container').appendChild(box);
        renderSupplierChecklist(box, (ms.items || []).length, (mp.items || []).length);
      } catch (e) {
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
    } catch (_) {
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
    } catch (_) {
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
  } catch (_) {
    /* Ignore loader init errors */
  }
  try {
    efInitBrandAnimation();
  } catch (_) {
    /* Ignore brand animation errors */
  }
  try {
    efInitVenueMap();
  } catch (_) {
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
  } catch (_) {
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
  } catch (_) {
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
