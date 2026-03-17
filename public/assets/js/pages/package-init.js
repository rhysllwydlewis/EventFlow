/* global PackageGallery */
window.__EF_PAGE__ = 'package';

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('slug');
  const id = urlParams.get('id');

  if (!slug && !id) {
    document.getElementById('package-loading').style.display = 'none';
    document.getElementById('package-error').style.display = 'block';
    return;
  }

  // Prefer slug for SEO-friendly URLs; fall back to id-based lookup
  const slugOrId = encodeURIComponent(slug || id);

  fetch(`/api/packages/${slugOrId}`)
    .then(res => {
      if (!res.ok) {
        throw new Error('Package not found');
      }
      return res.json();
    })
    .then(data => {
      const { package: pkg, supplier, categories } = data;

      document.getElementById('package-loading').style.display = 'none';
      document.getElementById('package-content').style.display = 'block';

      document.title = `${pkg.title} — EventFlow`;

      // Breadcrumb
      if (categories && categories.length > 0) {
        document.getElementById('breadcrumb-category').innerHTML = categories
          .map(
            c =>
              `<a href="/category?slug=${encodeURIComponent(c.slug)}" style="text-decoration:none;color:inherit;">${c.name}</a>`
          )
          .join(' · ');
        // Show the category segment (hidden by default to avoid 'Home › › Package')
        const catGroup = document.getElementById('breadcrumb-category-group');
        if (catGroup) {
          catGroup.style.display = '';
        }
      }
      document.getElementById('breadcrumb-package').textContent = pkg.title;

      // Gallery — filter out entries with empty or placeholder URLs so the gallery
      // only contains items that can actually be displayed as real images.
      const rawGallery = pkg.gallery || [];
      const PLACEHOLDER_PATH = '/assets/images/placeholders/';
      const validGalleryImages = rawGallery.filter(img => {
        if (!img) {
          return false;
        }
        const url =
          typeof img === 'string' ? img : img.url || img.src || img.path || img.image || '';
        return url && !url.includes(PLACEHOLDER_PATH);
      });
      // Use filtered gallery; if empty, fall back to pkg.image (already normalised by API).
      const galleryImages =
        validGalleryImages.length > 0
          ? validGalleryImages
          : pkg.image && !pkg.image.includes(PLACEHOLDER_PATH)
            ? [{ url: pkg.image }]
            : [];
      if (galleryImages.length > 0 && typeof PackageGallery !== 'undefined') {
        new PackageGallery('package-gallery-container', galleryImages);
      }

      // Title + badges
      document.getElementById('package-title').textContent = pkg.title;
      if (pkg.featured || pkg.isFeatured) {
        document.getElementById('package-featured-badge').style.display = 'inline-flex';
      }
      if (pkg.isTest) {
        document.getElementById('package-test-badge').style.display = 'inline-flex';
      }

      // Categories
      if (categories && categories.length > 0) {
        document.getElementById('package-categories').innerHTML = categories
          .map(
            c => `<a href="/category?slug=${encodeURIComponent(c.slug)}"
                style="background:#f8f9fa;color:#6c757d;padding:5px 12px;border-radius:16px;
                       font-size:0.82rem;font-weight:500;text-decoration:none;display:inline-block;">
              ${c.icon || ''} ${c.name}
            </a>`
          )
          .join('');
      }

      // Price + location
      const rawPrice = pkg.price_display || pkg.price;
      const formatted = rawPrice
        ? /^\d+(\.\d+)?$/.test(String(rawPrice))
          ? `£${rawPrice}`
          : rawPrice
        : 'Contact for price';
      document.getElementById('package-price').textContent = formatted;
      if (pkg.location) {
        document.getElementById('package-location').innerHTML = `📍 ${pkg.location}`;
      }

      // Description
      document.getElementById('package-description').textContent =
        pkg.description || 'No description available.';

      // Tags
      if (pkg.tags && pkg.tags.length > 0) {
        document.getElementById('package-tags').innerHTML = pkg.tags
          .map(t => `<span class="pkg-tag">#${t}</span>`)
          .join('');
      }

      // Event types
      if (pkg.eventTypes && pkg.eventTypes.length > 0) {
        const etSection = document.getElementById('package-event-types-section');
        if (etSection) {
          etSection.style.display = 'block';
        }
        const etContainer = document.getElementById('package-event-types');
        if (etContainer) {
          etContainer.innerHTML = pkg.eventTypes
            .map(et => {
              const label = typeof et === 'string' ? et : et.name || et.label || String(et);
              return `<span class="pkg-event-type-pill"><span aria-hidden="true">🎉</span> ${label}</span>`;
            })
            .join('');
        }
      }

      // ── Supplier sidebar widget ──────────────────────────────
      buildSupplierSidebar(supplier, pkg);

      // ── Package action buttons ───────────────────────────────
      wirePackageActions(pkg, supplier);
    })
    .catch(err => {
      console.error('Error loading package:', err);
      document.getElementById('package-loading').style.display = 'none';
      document.getElementById('package-error').style.display = 'block';
    });
});

/**
 * Populate and wire the supplier sidebar widget.
 * Mirrors the Save / View Profile / Message pattern from the suppliers page.
 */
function buildSupplierSidebar(supplier, pkg) {
  const sidebar = document.getElementById('pkg-supplier-sidebar');
  if (!sidebar || !supplier) {
    return;
  }

  // Avatar
  const avatarEl = document.getElementById('pkg-sup-avatar');
  const FALLBACK_INITIAL = '?'; // generic character when supplier name is not yet available
  const initial = supplier.name ? supplier.name.charAt(0).toUpperCase() : FALLBACK_INITIAL;
  const palettes = [
    ['#13B6A2', '#0B8073'],
    ['#8B5CF6', '#6D28D9'],
    ['#F59E0B', '#D97706'],
    ['#10B981', '#059669'],
    ['#3B82F6', '#2563EB'],
    ['#EC4899', '#DB2777'],
  ];
  const pi = supplier.name ? supplier.name.charCodeAt(0) % palettes.length : 0;
  const [c1, c2] = palettes[pi];

  function showAvatarInitial() {
    avatarEl.innerHTML = '';
    avatarEl.style.background = `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
    avatarEl.textContent = initial;
  }

  if (supplier.logo) {
    const img = document.createElement('img');
    img.src = supplier.logo;
    img.alt = `${supplier.name} logo`;
    img.addEventListener('error', showAvatarInitial);
    avatarEl.appendChild(img);
  } else {
    showAvatarInitial();
  }

  // Name
  document.getElementById('pkg-sup-name').textContent = supplier.name || 'Supplier';

  // Blurb
  const blurbEl = document.getElementById('pkg-sup-blurb');
  const blurb = supplier.blurb || supplier.description_short || '';
  if (blurb) {
    blurbEl.textContent = blurb;
  } else {
    blurbEl.style.display = 'none';
  }

  // Tier badge
  const tierEl = document.getElementById('pkg-sup-tier');
  const tier = supplier.subscriptionTier || supplier.subscription?.tier;
  if (tier) {
    const tierMap = {
      pro_plus: { label: 'Professional Plus', bg: '#7c3aed', icon: '💎' },
      pro: { label: 'Professional', bg: '#d97706', icon: '⭐' },
      featured: { label: 'Featured', bg: '#0b8073', icon: '✨' },
    };
    const t = tierMap[tier] || { label: tier, bg: '#6b7280', icon: '' };
    tierEl.innerHTML = `<span style="display:inline-flex;align-items:center;gap:4px;
                      background:${t.bg};color:#fff;padding:2px 10px;
                      border-radius:20px;font-size:0.75rem;font-weight:700;">
           ${t.icon} ${t.label}
         </span>`;
  }

  // Meta (category + location)
  const metaEl = document.getElementById('pkg-sup-meta');
  const metas = [];
  if (supplier.category) {
    metas.push(`<div class="pkg-sup-meta-item"><span>📂</span> ${supplier.category}</div>`);
  }
  if (supplier.location) {
    metas.push(`<div class="pkg-sup-meta-item"><span>📍</span> ${supplier.location}</div>`);
  }
  if (metas.length) {
    metaEl.innerHTML = metas.join('');
  } else {
    metaEl.style.display = 'none';
  }

  // View Profile link
  const viewBtn = document.getElementById('pkg-view-profile-btn');
  if (supplier.id) {
    viewBtn.href = `/supplier?id=${encodeURIComponent(supplier.id)}`;
  }

  // Save / shortlist button
  const saveBtn = document.getElementById('pkg-save-btn');
  saveBtn.dataset.supplierId = supplier.id || '';
  saveBtn.dataset.supplierName = supplier.name || '';
  saveBtn.dataset.supplierCategory = supplier.category || '';
  saveBtn.dataset.supplierLocation = supplier.location || '';
  saveBtn.dataset.supplierImage = supplier.logo || '';

  // Reflect current shortlist state
  const sm = window.shortlistManager;
  if (sm && sm.isAuthenticated && sm.hasItem('supplier', supplier.id)) {
    saveBtn.classList.replace('sp-btn--shortlist', 'sp-btn--shortlist-active');
    saveBtn.innerHTML = '❤️ Saved';
    saveBtn.setAttribute('aria-label', 'Remove from shortlist');
  }

  saveBtn.addEventListener('click', async () => {
    const mgr = window.shortlistManager;
    // Auth gate — redirect unauthenticated users
    if (!mgr || !mgr.isAuthenticated) {
      const returnTo = window.location.pathname + window.location.search;
      window.location.href = `/auth?redirect=${encodeURIComponent(returnTo)}&intent=save`;
      return;
    }
    const isActive = saveBtn.classList.contains('sp-btn--shortlist-active');
    if (isActive) {
      await mgr.removeItem('supplier', supplier.id);
      saveBtn.classList.replace('sp-btn--shortlist-active', 'sp-btn--shortlist');
      saveBtn.innerHTML = '♡ Save Supplier';
      saveBtn.setAttribute('aria-label', 'Save supplier to shortlist');
    } else {
      await mgr.addItem({
        type: 'supplier',
        id: supplier.id,
        name: supplier.name,
        category: supplier.category || '',
        location: supplier.location || '',
        imageUrl: supplier.logo || '',
      });
      saveBtn.classList.replace('sp-btn--shortlist', 'sp-btn--shortlist-active');
      saveBtn.innerHTML = '❤️ Saved';
      saveBtn.setAttribute('aria-label', 'Remove from shortlist');
    }
  });

  // Message button — wire up QuickComposeV4
  const msgBtn = document.getElementById('pkg-message-btn');
  if (supplier.ownerUserId) {
    msgBtn.dataset.recipientId = supplier.ownerUserId;
  }
  msgBtn.dataset.contextType = 'package';
  msgBtn.dataset.contextId = pkg.id || '';
  msgBtn.dataset.contextTitle = pkg.title || '';
  if (supplier.logo) {
    msgBtn.dataset.contextImage = supplier.logo;
  }

  // Auth gate for message button (before QuickComposeV4 fires)
  msgBtn.addEventListener('click', e => {
    const mgr = window.shortlistManager;
    if (!mgr || !mgr.isAuthenticated) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const returnTo = window.location.pathname + window.location.search;
      window.location.href = `/auth?redirect=${encodeURIComponent(returnTo)}&intent=message`;
    }
  });

  // Show the sidebar
  sidebar.style.display = '';

  // Attach QuickComposeV4 if loaded
  if (window.QuickComposeV4) {
    window.QuickComposeV4.attachAll();
  }
}

/**
 * Wire the "Save Package" and "Add to Plan" buttons.
 * Save Package uses shortlistManager (type='package').
 * Add to Plan navigates to /start with packageId + supplierId context.
 * Both gate behind auth when not logged in.
 */
function wirePackageActions(pkg, supplier) {
  const savePkgBtn = document.getElementById('pkg-save-package-btn');
  const addPlanBtn = document.getElementById('pkg-add-to-plan-btn');
  if (!savePkgBtn || !addPlanBtn) {
    return;
  }

  // Reflect current shortlist state for this package
  const sm = window.shortlistManager;
  if (sm && sm.isAuthenticated && pkg.id && sm.hasItem('package', pkg.id)) {
    savePkgBtn.classList.add('pkg-btn--save-active');
    savePkgBtn.textContent = '❤️ Saved';
    savePkgBtn.setAttribute('aria-label', 'Remove this package from saved');
  }

  // Save Package handler
  savePkgBtn.addEventListener('click', async () => {
    const mgr = window.shortlistManager;
    if (!mgr || !mgr.isAuthenticated) {
      const returnTo = window.location.pathname + window.location.search;
      window.location.href = `/auth?redirect=${encodeURIComponent(returnTo)}&intent=save`;
      return;
    }
    const isActive = savePkgBtn.classList.contains('pkg-btn--save-active');
    if (isActive) {
      await mgr.removeItem('package', pkg.id);
      savePkgBtn.classList.remove('pkg-btn--save-active');
      savePkgBtn.textContent = '♡ Save Package';
      savePkgBtn.setAttribute('aria-label', 'Save this package');
    } else {
      const rawPrice = pkg.price_display || pkg.price;
      await mgr.addItem({
        type: 'package',
        id: pkg.id,
        name: pkg.title,
        category: (supplier && supplier.category) || '',
        location: pkg.location || '',
        priceHint: rawPrice ? String(rawPrice) : '',
      });
      savePkgBtn.classList.add('pkg-btn--save-active');
      savePkgBtn.textContent = '❤️ Saved';
      savePkgBtn.setAttribute('aria-label', 'Remove this package from saved');
    }
  });

  // Add to Plan handler
  addPlanBtn.addEventListener('click', () => {
    const mgr = window.shortlistManager;
    if (!mgr || !mgr.isAuthenticated) {
      const returnTo = window.location.pathname + window.location.search;
      window.location.href = `/auth?redirect=${encodeURIComponent(returnTo)}&intent=plan`;
      return;
    }
    const query = new URLSearchParams();
    if (pkg.id) {
      query.set('packageId', pkg.id);
    }
    if (supplier && supplier.id) {
      query.set('supplierId', supplier.id);
    }
    window.location.href = `/start?${query.toString()}`;
  });
}
