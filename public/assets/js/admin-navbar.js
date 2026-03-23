/**
 * Admin Navbar JavaScript
 * Handles navigation functionality, mobile menu, and database status.
 *
 * Dynamic rendering:
 *   If a page includes `<div id="adminNavbarMount"></div>`, this script
 *   renders the complete navbar into that element from the NAV_ITEMS registry.
 *   Pages that already have the full hardcoded <nav> markup continue to work
 *   without any change (backward compatible).
 *
 *   To migrate a page:
 *     1. Replace the entire <nav class="admin-top-navbar">…</nav> block with
 *        <div id="adminNavbarMount"></div>
 *     2. Remove any skip-link adjustments — the script keeps the skip link.
 */

(function () {
  'use strict';

  // ── Nav items registry (browser copy of config/adminRegistry.js getNavItems) ──
  // Update config/adminRegistry.js first; then mirror inNav=true entries here.
  // `group` maps to category; `desc` is shown in the Quick Nav tile.
  const NAV_ITEMS = [
    {
      href: '/admin',
      icon: '📊',
      label: 'Dashboard',
      group: 'core',
      desc: 'Overview & platform metrics',
    },
    {
      href: '/admin-settings',
      icon: '⚙️',
      label: 'Settings',
      group: 'core',
      desc: 'Admin preferences & configuration',
    },
    {
      href: '/admin-users',
      icon: '👥',
      label: 'Users',
      group: 'users',
      desc: 'User accounts & management',
    },
    {
      href: '/admin-suppliers',
      icon: '🏢',
      label: 'Suppliers',
      group: 'users',
      desc: 'Supplier approvals & profiles',
      badgeId: 'navBadgeSuppliers',
    },
    {
      href: '/admin-packages',
      icon: '📦',
      label: 'Packages',
      group: 'catalogue',
      desc: 'Package approvals & listings',
      badgeId: 'navBadgePackages',
    },
    {
      href: '/admin-marketplace',
      icon: '🛒',
      label: 'Marketplace',
      group: 'catalogue',
      desc: 'Marketplace management',
    },
    {
      href: '/admin-photos',
      icon: '📸',
      label: 'Photos',
      group: 'catalogue',
      desc: 'Photo review & moderation',
      badgeId: 'navBadgePhotos',
    },
    {
      href: '/admin-media',
      icon: '🎨',
      label: 'Media',
      group: 'catalogue',
      desc: 'Media asset management',
    },
    {
      href: '/admin-tickets',
      icon: '🎫',
      label: 'Tickets',
      group: 'moderation',
      desc: 'Support ticket queue',
      badgeId: 'openTicketsBadge',
    },
    {
      href: '/admin-reports',
      icon: '📈',
      label: 'Reports',
      group: 'moderation',
      desc: 'Platform analytics',
      badgeId: 'navBadgeReports',
    },
    {
      href: '/admin-messenger',
      icon: '💬',
      label: 'Messages',
      group: 'moderation',
      desc: 'Conversation moderation',
    },
    {
      href: '/admin-payments',
      icon: '💳',
      label: 'Payments',
      group: 'operations',
      desc: 'Payment records & billing',
    },
    {
      href: '/admin-partners',
      icon: '🤝',
      label: 'Partners',
      group: 'operations',
      desc: 'Partner portal & affiliate credits',
    },
    {
      href: '/admin-audit',
      icon: '📋',
      label: 'Audit',
      group: 'operations',
      desc: 'Admin activity log',
    },
    {
      href: '/admin-exports',
      icon: '📤',
      label: 'Exports',
      group: 'operations',
      desc: 'Data export & downloads',
    },
    {
      href: '/admin-homepage',
      icon: '🏠',
      label: 'Homepage',
      group: 'content',
      desc: 'Homepage content & imagery',
    },
    {
      href: '/admin-content',
      icon: '✏️',
      label: 'Content',
      group: 'content',
      desc: 'Page content editor',
    },
    {
      href: '/admin-search',
      icon: '🔍',
      label: 'Search',
      group: 'tools',
      desc: 'Search index & configuration',
    },
    {
      href: '/admin-debug',
      icon: '🩺',
      label: 'Debug',
      group: 'tools',
      desc: 'System diagnostics & checks',
    },
  ];

  // ── Quick Nav group definitions (display order for the panel) ─────────────
  const NAV_GROUPS = [
    { id: 'core', label: 'Core', icon: '📊' },
    { id: 'users', label: 'People', icon: '👥' },
    { id: 'catalogue', label: 'Catalogue', icon: '🗂️' },
    { id: 'moderation', label: 'Moderation', icon: '🔍' },
    { id: 'operations', label: 'Operations', icon: '⚙️' },
    { id: 'content', label: 'Content', icon: '✏️' },
    { id: 'tools', label: 'Tools', icon: '🔧' },
  ];

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    renderNavMount();
    initMobileMenu();
    initUserDropdown();
    initDatabaseStatus();
    highlightActivePage();
    initBadgeCounts();
    updateNavbarUser();
    initRefreshButton();
    initLogoutButton();
    initQuickNav();
  }

  // ── Dynamic navbar rendering ───────────────────────────────────────────────

  /**
   * Renders the full admin navbar into #adminNavbarMount when that element
   * exists.  Pages that already contain the hardcoded <nav> are left untouched.
   */
  function renderNavMount() {
    const mount = document.getElementById('adminNavbarMount');
    if (!mount) {
      return;
    }

    mount.innerHTML = buildNavbarHTML();
  }

  function buildNavbarHTML() {
    return [
      '<nav class="admin-top-navbar" aria-label="Admin navigation">',
      '  <div class="admin-navbar-content">',
      '    <!-- Brand -->',
      '    <div class="admin-navbar-brand">',
      '      <a href="/admin" class="admin-navbar-logo">EventFlow</a>',
      '      <span class="admin-navbar-title">Admin Panel</span>',
      '    </div>',
      '    <!-- Quick Nav Burger Button -->',
      '    <button class="admin-qnav-btn" id="adminQuickNavBtn"',
      '            aria-label="Open quick navigation"',
      '            aria-expanded="false"',
      '            aria-controls="adminQuickNav"',
      '            title="Quick Navigation — all admin sections">',
      '      <svg class="admin-qnav-btn-icon" width="20" height="20" viewBox="0 0 20 20"',
      '           fill="none" stroke="currentColor" stroke-width="2"',
      '           stroke-linecap="round" aria-hidden="true">',
      '        <line x1="3" y1="5" x2="17" y2="5"/>',
      '        <line x1="3" y1="10" x2="13" y2="10"/>',
      '        <line x1="3" y1="15" x2="17" y2="15"/>',
      '      </svg>',
      '      <span class="admin-qnav-btn-label">All Sections</span>',
      '    </button>',
      '    <!-- Spacer -->',
      '    <div class="admin-navbar-spacer" aria-hidden="true"></div>',
      '    <!-- Right Actions -->',
      '    <div class="admin-navbar-actions">',
      '      <div class="db-status-badge db-loading" id="dbStatusBadge"',
      '           title="Database status"',
      '           aria-live="polite"',
      '           aria-label="Database status: Loading">',
      '        <span class="db-status-dot" aria-hidden="true"></span> Loading...',
      '      </div>',
      '      <button class="navbar-icon-btn" id="navRefreshBtn"',
      '              title="Refresh data" aria-label="Refresh data">',
      '        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"',
      '             stroke="currentColor" stroke-width="2" aria-hidden="true">',
      '          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>',
      '        </svg>',
      '      </button>',
      '      <div class="admin-user-dropdown">',
      '        <button class="admin-user-btn" id="adminUserBtn"',
      '                aria-haspopup="true" aria-expanded="false"',
      '                aria-controls="adminDropdownMenu">',
      '          <div class="admin-user-avatar" aria-hidden="true">A</div>',
      '          <span>Admin</span>',
      '          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"',
      '               stroke="currentColor" stroke-width="2" aria-hidden="true">',
      '            <polyline points="6 9 12 15 18 9"></polyline>',
      '          </svg>',
      '        </button>',
      '        <div class="admin-dropdown-menu" id="adminDropdownMenu"',
      '             role="menu" aria-labelledby="adminUserBtn">',
      '          <a href="/admin-settings" class="admin-dropdown-item" role="menuitem">',
      '            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"',
      '                 stroke="currentColor" stroke-width="2" aria-hidden="true">',
      '              <circle cx="12" cy="12" r="3"></circle>',
      '              <path d="M12 1v6m0 6v6m4.22-13.22l-4.24 4.24m0 5.96l-4.24 4.24M23 12h-6m-6 0H1m18.78 4.22l-4.24-4.24m-5.96 0l-4.24 4.24"></path>',
      '            </svg>',
      '            Settings',
      '          </a>',
      '          <div class="admin-dropdown-divider" role="separator"></div>',
      '          <button class="admin-dropdown-item" id="adminLogoutBtn" role="menuitem">',
      '            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"',
      '                 stroke="currentColor" stroke-width="2" aria-hidden="true">',
      '              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>',
      '              <polyline points="16 17 21 12 16 7"></polyline>',
      '              <line x1="21" y1="12" x2="9" y2="12"></line>',
      '            </svg>',
      '            Sign Out',
      '          </button>',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</nav>',
      '<!-- Quick Nav Backdrop -->',
      '<div class="admin-qnav-backdrop" id="adminQnavBackdrop" aria-hidden="true"></div>',
      '<!-- Quick Nav Panel -->',
      buildQuickNavHTML(),
    ].join('\n');
  }

  function buildQuickNavHTML() {
    const groupsHtml = NAV_GROUPS.map(group => {
      const items = NAV_ITEMS.filter(item => {
        return item.group === group.id;
      });
      if (items.length === 0) {
        return '';
      }
      const tilesHtml = items.map(buildTileHTML).join('\n');
      return [
        `      <div class="admin-qnav-group" data-group="${group.id}">`,
        '        <h3 class="admin-qnav-group-label">',
        `          <span class="admin-qnav-group-icon" aria-hidden="true">${group.icon}</span>`,
        `          ${group.label}`,
        '        </h3>',
        '        <div class="admin-qnav-tiles">',
        tilesHtml,
        '        </div>',
        '      </div>',
      ].join('\n');
    })
      .filter(Boolean)
      .join('\n');

    return [
      '<div class="admin-qnav-panel" id="adminQuickNav"',
      '     role="dialog" aria-modal="true"',
      '     aria-label="Quick Navigation" aria-hidden="true">',
      '  <div class="admin-qnav-inner">',
      '    <!-- Header -->',
      '    <div class="admin-qnav-header">',
      '      <div class="admin-qnav-header-left">',
      '        <svg class="admin-qnav-spark" width="24" height="24" viewBox="0 0 24 24"',
      '             fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">',
      '          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>',
      '        </svg>',
      '        <h2 class="admin-qnav-title">Quick Nav</h2>',
      '      </div>',
      '      <button class="admin-qnav-close" id="adminQnavClose"',
      '              aria-label="Close quick navigation">',
      '        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"',
      '             stroke="currentColor" stroke-width="2.5" aria-hidden="true">',
      '          <line x1="18" y1="6" x2="6" y2="18"></line>',
      '          <line x1="6" y1="6" x2="18" y2="18"></line>',
      '        </svg>',
      '      </button>',
      '    </div>',
      '    <!-- Search -->',
      '    <div class="admin-qnav-search-wrap">',
      '      <svg class="admin-qnav-search-icon" width="16" height="16" viewBox="0 0 24 24"',
      '           fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">',
      '        <circle cx="11" cy="11" r="8"></circle>',
      '        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>',
      '      </svg>',
      '      <input type="search" class="admin-qnav-search" id="adminQnavSearch"',
      '             placeholder="Filter sections\u2026"',
      '             aria-label="Filter navigation sections"',
      '             autocomplete="off">',
      '    </div>',
      '    <!-- Content -->',
      '    <div class="admin-qnav-content" id="adminQnavContent">',
      groupsHtml,
      '      <p class="admin-qnav-no-results" id="adminQnavNoResults" aria-live="polite" hidden>',
      '        No sections match your search.',
      '      </p>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n');
  }

  function buildTileHTML(item) {
    const badge = item.badgeId
      ? `<span class="admin-qnav-tile-badge" id="${item.badgeId}" style="display:none;" aria-label="${item.label} count"></span>`
      : '';
    const desc = item.desc ? `<span class="admin-qnav-tile-desc">${item.desc}</span>` : '';
    return [
      `          <a href="${item.href}" class="admin-qnav-tile"`,
      `             data-label="${item.label.toLowerCase()}">`,
      badge,
      `            <span class="admin-qnav-tile-icon" aria-hidden="true">${item.icon}</span>`,
      '            <span class="admin-qnav-tile-body">',
      `              <span class="admin-qnav-tile-label">${item.label}</span>`,
      desc,
      '            </span>',
      '          </a>',
    ].join('\n');
  }

  // ── Mobile hamburger menu toggle ───────────────────────────────────────────
  /**
   * Mobile hamburger menu toggle (backward-compatible — only acts when the
   * legacy hardcoded navbar elements are present in the page).
   */
  function initMobileMenu() {
    const hamburger = document.getElementById('adminHamburger');
    const nav = document.getElementById('adminNavbarNav');

    if (hamburger && nav) {
      hamburger.addEventListener('click', () => {
        const isExpanded = hamburger.classList.toggle('active');
        nav.classList.toggle('show');
        hamburger.setAttribute('aria-expanded', String(isExpanded));
      });

      // Close menu when clicking outside
      document.addEventListener('click', e => {
        if (
          !hamburger.contains(e.target) &&
          !nav.contains(e.target) &&
          nav.classList.contains('show')
        ) {
          hamburger.classList.remove('active');
          nav.classList.remove('show');
          hamburger.setAttribute('aria-expanded', 'false');
        }
      });

      // Close menu when pressing Escape
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && nav.classList.contains('show')) {
          hamburger.classList.remove('active');
          nav.classList.remove('show');
          hamburger.setAttribute('aria-expanded', 'false');
          hamburger.focus();
        }
      });

      // Close menu when clicking a link (on mobile)
      const navLinks = nav.querySelectorAll('.admin-nav-btn');
      navLinks.forEach(link => {
        link.addEventListener('click', () => {
          if (window.innerWidth <= 768) {
            hamburger.classList.remove('active');
            nav.classList.remove('show');
            hamburger.setAttribute('aria-expanded', 'false');
          }
        });
      });
    }
  }

  // ── Quick Nav panel ────────────────────────────────────────────────────────

  /**
   * Wire up the Quick Nav burger button, panel open/close, focus trap,
   * keyboard navigation, and tile search filter.
   */
  function initQuickNav() {
    const btn = document.getElementById('adminQuickNavBtn');
    const backdrop = document.getElementById('adminQnavBackdrop');
    const panel = document.getElementById('adminQuickNav');
    const closeBtn = document.getElementById('adminQnavClose');
    const searchInput = document.getElementById('adminQnavSearch');

    if (!btn || !panel) {
      return;
    }

    function openPanel() {
      panel.removeAttribute('aria-hidden');
      panel.classList.add('qnav-open');
      if (backdrop) {
        backdrop.classList.add('qnav-open');
      }
      btn.setAttribute('aria-expanded', 'true');
      document.body.classList.add('admin-qnav-body-lock');
      // Focus the search input after the slide-in starts
      setTimeout(() => {
        if (searchInput) {
          searchInput.focus();
        }
      }, 60);
    }

    function closePanel() {
      panel.setAttribute('aria-hidden', 'true');
      panel.classList.remove('qnav-open');
      if (backdrop) {
        backdrop.classList.remove('qnav-open');
      }
      btn.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('admin-qnav-body-lock');
      // Reset search when closing
      if (searchInput && searchInput.value) {
        searchInput.value = '';
        filterTiles('');
      }
      btn.focus();
    }

    // Burger button toggles panel
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (panel.classList.contains('qnav-open')) {
        closePanel();
      } else {
        openPanel();
      }
    });

    // Close button
    if (closeBtn) {
      closeBtn.addEventListener('click', closePanel);
    }

    // Backdrop click closes
    if (backdrop) {
      backdrop.addEventListener('click', closePanel);
    }

    // Escape key closes
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && panel.classList.contains('qnav-open')) {
        closePanel();
      }
    });

    // Search filter
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        filterTiles(searchInput.value.trim().toLowerCase());
      });
      // Arrow-down from search focuses first visible tile
      searchInput.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const firstTile = panel.querySelector('.admin-qnav-tile:not([hidden])');
          if (firstTile) {
            firstTile.focus();
          }
        }
      });
    }

    // Focus trap inside panel
    panel.addEventListener('keydown', e => {
      if (e.key !== 'Tab') {
        return;
      }
      const focusable = Array.from(
        panel.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])')
      ).filter(el => {
        return !el.hidden && el.offsetParent !== null;
      });
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // Mark the tile for the current page as active
    highlightActiveTile();
  }

  /**
   * Filter Quick Nav tiles by a search query string.
   * Hides groups that have no matching tiles.
   *
   * @param {string} query - lower-case search term
   */
  function filterTiles(query) {
    const groups = document.querySelectorAll('.admin-qnav-group');
    const noResults = document.getElementById('adminQnavNoResults');
    let visibleCount = 0;

    groups.forEach(group => {
      const tiles = group.querySelectorAll('.admin-qnav-tile');
      let groupVisible = 0;
      tiles.forEach(tile => {
        const label = tile.getAttribute('data-label') || '';
        const matches = !query || label.includes(query);
        tile.hidden = !matches;
        if (matches) {
          groupVisible++;
        }
      });
      group.hidden = groupVisible === 0;
      visibleCount += groupVisible;
    });

    if (noResults) {
      noResults.hidden = visibleCount > 0;
    }
  }

  /**
   * Add `.active` / `aria-current="page"` to the Quick Nav tile that
   * corresponds to the current browser path.
   */
  function highlightActiveTile() {
    const currentPath = window.location.pathname;
    const tiles = document.querySelectorAll('.admin-qnav-tile');
    tiles.forEach(tile => {
      const href = tile.getAttribute('href');
      const isActive = href ? currentPath === href || currentPath.startsWith(`${href}/`) : false;
      tile.classList.toggle('active', isActive);
      if (isActive) {
        tile.setAttribute('aria-current', 'page');
      } else {
        tile.removeAttribute('aria-current');
      }
    });
  }

  /**
   * User dropdown menu toggle
   */
  function initUserDropdown() {
    const userBtn = document.getElementById('adminUserBtn');
    const dropdownMenu = document.getElementById('adminDropdownMenu');

    if (userBtn && dropdownMenu) {
      userBtn.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = dropdownMenu.classList.toggle('show');
        userBtn.setAttribute('aria-expanded', String(isOpen));
      });

      // Close dropdown when clicking outside
      document.addEventListener('click', e => {
        if (!userBtn.contains(e.target) && !dropdownMenu.contains(e.target)) {
          dropdownMenu.classList.remove('show');
          userBtn.setAttribute('aria-expanded', 'false');
        }
      });

      // Close dropdown when pressing Escape
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && dropdownMenu.classList.contains('show')) {
          dropdownMenu.classList.remove('show');
          userBtn.setAttribute('aria-expanded', 'false');
          userBtn.focus();
        }
      });
    }
  }

  /**
   * Fetch and display database status
   */
  function initDatabaseStatus() {
    const statusBadge = document.getElementById('dbStatusBadge');
    if (!statusBadge) {
      return;
    }

    updateDatabaseStatus();

    // Refresh status every 30 seconds
    setInterval(updateDatabaseStatus, 30000);
  }

  function updateDatabaseStatus() {
    const statusBadge = document.getElementById('dbStatusBadge');
    if (!statusBadge) {
      return;
    }

    // Try to fetch database status from API
    fetch('/api/v1/admin/db-status', {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    })
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to fetch status');
        }
        return response.json();
      })
      .then(data => {
        const dbType = data.dbType || 'unknown';
        const dot = '<span class="db-status-dot"></span>';

        if (dbType === 'mongodb') {
          statusBadge.className = 'db-status-badge db-mongodb';
          statusBadge.innerHTML = `${dot} MongoDB`;
          statusBadge.title = 'Connected to MongoDB';
          statusBadge.setAttribute('aria-label', 'Database status: Connected to MongoDB');
        } else if (dbType === 'local') {
          statusBadge.className = 'db-status-badge db-local';
          statusBadge.innerHTML = `${dot} Local Storage`;
          statusBadge.title = 'Using local file storage';
          statusBadge.setAttribute('aria-label', 'Database status: Using local file storage');
        } else {
          statusBadge.className = 'db-status-badge db-loading';
          statusBadge.innerHTML = `${dot} Unknown`;
          statusBadge.title = 'Database status unknown';
          statusBadge.setAttribute('aria-label', 'Database status: Unknown');
        }
      })
      .catch(error => {
        console.error('Failed to fetch database status:', error);
        statusBadge.className = 'db-status-badge db-local';
        statusBadge.innerHTML = '<span class="db-status-dot"></span> Local Storage';
        statusBadge.title = 'Using local file storage';
        statusBadge.setAttribute('aria-label', 'Database status: Using local file storage');
      });
  }

  /**
   * Highlight the active page in navigation
   */
  function highlightActivePage() {
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.admin-nav-btn');

    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      // Exact match or sub-path (e.g. /admin-suppliers/123) — but NOT prefix-only
      // (e.g. /admin-content must NOT match /admin-content-dates)
      const isActive = href ? currentPath === href || currentPath.startsWith(`${href}/`) : false;
      if (isActive) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      } else {
        link.classList.remove('active');
        link.removeAttribute('aria-current');
      }
    });

    // Scroll the active nav link into view so it's always visible
    // (the navbar overflows horizontally when there are many items)
    const activeLink = document.querySelector('.admin-top-navbar .admin-nav-btn.active');
    if (activeLink) {
      activeLink.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' });
    }
  }

  /**
   * Populate navbar user avatar and display name from the current session
   */
  function updateNavbarUser() {
    fetch('/api/v1/auth/me', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(data => {
        const user = data.user || data;
        const fullName = user.name || user.displayName || '';
        // For email-only accounts, use the part before '@'
        const displayName = fullName || (user.email ? user.email.split('@')[0] : 'Admin');
        const initial = displayName.charAt(0).toUpperCase();

        const avatarEl = document.querySelector('.admin-user-avatar');
        if (avatarEl) {
          avatarEl.textContent = initial;
        }

        const labelEl = document.querySelector('.admin-user-btn > span');
        if (labelEl) {
          labelEl.textContent = displayName.split(' ')[0];
        }
      })
      .catch(() => {
        // Session not available — leave the default "A" / "Admin" labels
      });
  }

  /**
   * Initialize and update badge counts
   */
  function initBadgeCounts() {
    // Update badge counts from API
    updateBadgeCounts();

    // Refresh counts every 60 seconds
    setInterval(updateBadgeCounts, 60000);
  }

  function updateBadgeCounts() {
    // Fetch badge counts from dedicated endpoint
    fetch('/api/admin/badge-counts', {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: Failed to fetch badge counts`);
        }
        return response.json();
      })
      .then(data => {
        // Check for error in response
        if (data.error) {
          throw new Error(data.error);
        }

        // Update badge counts if elements exist
        const pending = data.pending || {};

        // Suppliers badge (pending approvals)
        const suppliersBadge = document.getElementById('navBadgeSuppliers');
        if (suppliersBadge) {
          const count = pending.suppliers || 0;
          if (count > 0) {
            suppliersBadge.textContent = count;
            suppliersBadge.style.display = 'flex';
          } else {
            suppliersBadge.style.display = 'none';
          }
        }

        // Packages badge (pending approvals)
        const packagesBadge = document.getElementById('navBadgePackages');
        if (packagesBadge) {
          const count = pending.packages || 0;
          if (count > 0) {
            packagesBadge.textContent = count;
            packagesBadge.style.display = 'flex';
          } else {
            packagesBadge.style.display = 'none';
          }
        }

        // Photos badge (pending approvals)
        const photosBadge = document.getElementById('navBadgePhotos');
        if (photosBadge) {
          const count = pending.photos || 0;
          if (count > 0) {
            photosBadge.textContent = count;
            photosBadge.style.display = 'flex';
          } else {
            photosBadge.style.display = 'none';
          }
        }

        // Reviews badge (pending/flagged)
        const reviewsBadge = document.getElementById('navBadgeReviews');
        if (reviewsBadge) {
          const count = pending.reviews || 0;
          if (count > 0) {
            reviewsBadge.textContent = count;
            reviewsBadge.style.display = 'flex';
          } else {
            reviewsBadge.style.display = 'none';
          }
        }

        // Reports badge (pending)
        const reportsBadge = document.getElementById('navBadgeReports');
        if (reportsBadge) {
          const count = pending.reports || 0;
          if (count > 0) {
            reportsBadge.textContent = count;
            reportsBadge.style.display = 'flex';
          } else {
            reportsBadge.style.display = 'none';
          }
        }

        // Open tickets badge
        const openTicketsBadge = document.getElementById('openTicketsBadge');
        if (openTicketsBadge) {
          const count = pending.tickets || data.openTickets || 0;
          if (count > 0) {
            openTicketsBadge.textContent = count;
            openTicketsBadge.style.display = 'flex';
          } else {
            openTicketsBadge.style.display = 'none';
          }
        }
      })
      .catch(error => {
        console.error('Failed to fetch badge counts:', error);
        // Display error to user
        const errorContainer = document.getElementById('navErrorContainer');
        if (errorContainer) {
          errorContainer.textContent = 'Failed to load badge counts';
          errorContainer.style.display = 'block';
          // Hide error after 5 seconds
          setTimeout(() => {
            errorContainer.style.display = 'none';
          }, 5000);
        }
      });
  }

  /**
   * Refresh button handler
   */
  function initRefreshButton() {
    const refreshBtn = document.getElementById('navRefreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        // Trigger spin animation via CSS class
        refreshBtn.classList.add('spinning');
        refreshBtn.addEventListener(
          'animationend',
          () => {
            refreshBtn.classList.remove('spinning');
          },
          { once: true }
        );

        // Refresh data
        updateDatabaseStatus();
        updateBadgeCounts();

        // Trigger page-specific refresh, or fall back to full reload after animation completes
        if (typeof window.refreshDashboardData === 'function') {
          window.refreshDashboardData();
        } else {
          setTimeout(() => window.location.reload(), 600);
        }
      });
    }
  }

  /**
   * Logout handler
   */
  function initLogoutButton() {
    const logoutBtn = document.getElementById('adminLogoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async e => {
        e.preventDefault();
        if (confirm('Are you sure you want to sign out?')) {
          try {
            // Call POST logout endpoint with CSRF token if available
            await fetch('/api/v1/auth/logout', {
              method: 'POST',
              headers: { 'X-CSRF-Token': window.__CSRF_TOKEN__ || '' },
              credentials: 'include',
            });
          } catch (_) {
            /* Ignore logout errors */
          }
          // Clear any auth-related storage
          try {
            localStorage.removeItem('eventflow_onboarding_new');
            sessionStorage.clear();
          } catch (_) {
            /* Ignore storage errors */
          }
          // Force full reload with cache-busting to ensure clean state
          window.location.href = `/?t=${Date.now()}`;
        }
      });
    }
  }
})();
