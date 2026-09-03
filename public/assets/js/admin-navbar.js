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

'use strict';
(function () {

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
      href: '/admin-analytics',
      icon: '📈',
      label: 'Analytics',
      group: 'core',
      desc: 'Revenue, growth & platform analytics',
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
      href: '/admin-public-calendar',
      icon: '📅',
      label: 'Events',
      group: 'catalogue',
      desc: 'Shared calendar events & publishing requests',
      badgeId: 'navBadgePublicCalendar',
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
      href: '/admin-reviews',
      icon: '⭐',
      label: 'Reviews',
      group: 'moderation',
      desc: 'Review approvals & moderation',
      badgeId: 'navBadgeReviews',
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
      href: '/admin-external-contacts',
      icon: '📩',
      label: 'External Contacts',
      group: 'moderation',
      desc: 'Enquiries from VEXI, Chlo and other integrated sites',
      badgeId: 'navBadgeExternalContacts',
    },
    {
      href: '/admin-community',
      icon: '💜',
      label: 'Community',
      group: 'moderation',
      desc: 'Community moderation, reports, categories and health',
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
      href: '/admin-cashout-requests',
      icon: '💸',
      label: 'Cashout Requests',
      group: 'moderation',
      desc: 'Partner cashout requests — approve, process and deliver',
    },
    {
      href: '/admin-locations',
      icon: '📍',
      label: 'Locations',
      group: 'content',
      desc: 'UK city pages: publication, indexing and editorial review',
      badgeId: 'navBadgeLocations',
    },
    {
      href: '/admin-seo',
      icon: '🔍',
      label: 'SEO Insights',
      group: 'content',
      desc: 'Search Console performance, keyword gaps and rewrite opportunities',
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
      href: '/admin-campaigns',
      icon: '📣',
      label: 'Campaigns',
      group: 'operations',
      desc: 'Compose and send marketing email campaigns',
    },
    {
      href: '/admin-emails',
      icon: '📨',
      label: 'Email Centre',
      group: 'operations',
      desc: 'Campaigns, templates, sent email logs and delivery status',
    },
    {
      href: '/admin/email-previews',
      icon: '✉️',
      label: 'Email Previews',
      group: 'operations',
      desc: 'Preview and test local email templates',
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

  // ── Notification bell state — declared here so init() can safely call
  // initNotifBell() synchronously when the script runs after DOMContentLoaded.
  // If these were declared after the init call site, a `let` temporal dead zone
  // (TDZ) ReferenceError would abort init() and leave all buttons broken.
  let notifPanelOpen = false;
  let notifPollInterval = null;

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
    // Guard: if notification bell init fails for any reason it must not
    // stop the Refresh button, All Sections, or User dropdown from working.
    try {
      initNotifBell();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[AdminNavbar] initNotifBell failed (non-fatal):', e.message);
    }
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
      '      <span class="admin-navbar-title">Admin Dashboard</span>',
      '    </div>',
      '    <!-- Quick Nav Burger Button -->',
      '    <button class="ef-cta admin-qnav-btn" id="adminQuickNavBtn"',
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
      '      <!-- Admin Notification Bell -->',
      '      <div class="admin-notif-bell-wrap" id="adminNotifWrap">',
      '        <button type="button" class="ef-cta navbar-icon-btn admin-notif-bell" id="adminNotifBellBtn"',
      '                aria-label="Notifications" aria-haspopup="true" aria-expanded="false"',
      '                aria-controls="adminNotifPanel" title="Notifications">',
      '          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"',
      '               stroke="currentColor" stroke-width="2" stroke-linecap="round"',
      '               stroke-linejoin="round" aria-hidden="true">',
      '            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>',
      '            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
      '          </svg>',
      '          <span class="admin-notif-badge" id="adminNotifBadge" hidden aria-label="unread notifications">0</span>',
      '        </button>',
      '        <div class="admin-notif-panel" id="adminNotifPanel" hidden',
      '             role="dialog" aria-label="Notifications panel">',
      '          <div class="admin-notif-panel-header">',
      '            <span class="admin-notif-panel-title">Notifications</span>',
      '            <button class="admin-notif-mark-all-btn" id="adminNotifMarkAllBtn" type="button">Mark all read</button>',
      '          </div>',
      '          <div class="admin-notif-panel-body" id="adminNotifPanelBody">',
      '            <div class="admin-notif-loading">Loading…</div>',
      '          </div>',
      '          <div class="admin-notif-panel-footer">',
      '            <a href="/admin-tickets" class="admin-notif-footer-link">View all tickets</a>',
      '          </div>',
      '        </div>',
      '      </div>',
      '      <button type="button" class="ef-cta navbar-icon-btn" id="navRefreshBtn"',
      '              title="Refresh data" aria-label="Refresh data">',
      '        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"',
      '             stroke="currentColor" stroke-width="2" aria-hidden="true">',
      '          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>',
      '        </svg>',
      '      </button>',
      '      <div class="admin-user-dropdown">',
      '        <button class="ef-cta admin-user-btn" id="adminUserBtn"',
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
      '          <button class="ef-cta admin-dropdown-item" id="adminLogoutBtn" role="menuitem">',
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
      '      <button class="ef-cta admin-qnav-close" id="adminQnavClose"',
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
      ? `<span class="admin-qnav-tile-badge" id="${item.badgeId}" hidden aria-label="${item.label} count"></span>`
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

        // Public calendar badge (pending publishing requests + open event reports)
        const calendarBadge = document.getElementById('navBadgePublicCalendar');
        if (calendarBadge) {
          const count = pending.publicCalendarRequests || 0;
          if (count > 0) {
            calendarBadge.textContent = count;
            calendarBadge.style.display = 'flex';
          } else {
            calendarBadge.style.display = 'none';
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

        // Locations badge (auto-published cities never reviewed by a human)
        const locationsBadge = document.getElementById('navBadgeLocations');
        if (locationsBadge) {
          const count = pending.locations || 0;
          if (count > 0) {
            locationsBadge.textContent = count;
            locationsBadge.style.display = 'flex';
          } else {
            locationsBadge.style.display = 'none';
          }
        }

        // External contacts badge (new, unactioned enquiries)
        const externalContactsBadge = document.getElementById('navBadgeExternalContacts');
        if (externalContactsBadge) {
          const count = pending.externalContacts || 0;
          if (count > 0) {
            externalContactsBadge.textContent = count;
            externalContactsBadge.style.display = 'flex';
          } else {
            externalContactsBadge.style.display = 'none';
          }
        }
      })
      .catch(error => {
        console.error('Failed to fetch badge counts:', error);
        // Display error to user
        const errorContainer = document.getElementById('navErrorContainer');
        if (errorContainer) {
          errorContainer.textContent = 'Failed to load badge counts';
          errorContainer.classList.remove('is-hidden');
          // Hide error after 5 seconds
          setTimeout(() => {
            errorContainer.classList.add('is-hidden');
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

  // ── Admin Notification Bell ────────────────────────────────────────────────
  //
  // Polls /api/admin/notifications/unread-count every 30s (faster than the
  // 60s badge-count poll so the admin learns about new tickets sooner).
  // When the bell is clicked, loads the full list and renders the panel.
  // Clicking a notification marks it as read and navigates to its actionUrl.

  function formatNotifTime(isoString) {
    if (!isoString) {
      return '';
    }
    try {
      const d = new Date(isoString);
      const diff = Date.now() - d.getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) {
        return 'just now';
      }
      if (mins < 60) {
        return `${mins}m ago`;
      }
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) {
        return `${hrs}h ago`;
      }
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    } catch {
      return '';
    }
  }

  function getNotifIcon(type, metadata) {
    // External contact notifications use type='system' with metadata.category='external_contact'
    if (type === 'system' && metadata && metadata.category === 'external_contact') {
      return (
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
        ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
        '<line x1="9" y1="10" x2="15" y2="10"/></svg>'
      );
    }
    const icons = {
      ticket:
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/></svg>',
      message:
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
      review:
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
      system:
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    };
    return icons[type] || icons.system;
  }

  async function fetchUnreadCount() {
    try {
      const res = await fetch('/api/admin/notifications/unread-count', { credentials: 'include' });
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      updateNotifBadge(data.count || 0);
    } catch {
      /* non-blocking */
    }
  }

  function updateNotifBadge(count) {
    const badge = document.getElementById('adminNotifBadge');
    const btn = document.getElementById('adminNotifBellBtn');
    if (!badge) {
      return;
    }
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = false;
      if (btn) {
        btn.classList.add('admin-notif-bell--has-unread');
      }
    } else {
      badge.hidden = true;
      if (btn) {
        btn.classList.remove('admin-notif-bell--has-unread');
      }
    }
  }

  async function loadNotifPanel() {
    const body = document.getElementById('adminNotifPanelBody');
    if (!body) {
      return;
    }
    body.innerHTML = '<div class="admin-notif-loading">Loading…</div>';

    try {
      const res = await fetch('/api/admin/notifications?limit=20', { credentials: 'include' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const notifications = data.notifications || [];

      if (!notifications.length) {
        body.innerHTML = '<div class="admin-notif-empty"><p>No notifications yet.</p></div>';
        return;
      }

      body.innerHTML = notifications
        .map(n => {
          const isUnread = !n.isRead;
          const icon = getNotifIcon(n.type, n.metadata);
          const time = formatNotifTime(n.createdAt);
          const href = n.actionUrl || '#';
          return `<div class="admin-notif-item ${isUnread ? 'admin-notif-item--unread' : ''}"
                     data-notif-id="${n.id}" data-action-url="${href}">
          <span class="admin-notif-item-icon admin-notif-item-icon--${n.type || 'system'}" aria-hidden="true">${icon}</span>
          <div class="admin-notif-item-body">
            <p class="admin-notif-item-title">${escapeHtml(n.title || 'Notification')}</p>
            <p class="admin-notif-item-msg">${escapeHtml(n.message || '')}</p>
            <span class="admin-notif-item-time">${time}</span>
          </div>
          ${isUnread ? '<span class="admin-notif-unread-dot" aria-label="Unread"></span>' : ''}
        </div>`;
        })
        .join('');

      // Wire click handlers
      body.querySelectorAll('.admin-notif-item').forEach(item => {
        item.addEventListener('click', async () => {
          const id = item.dataset.notifId;
          const url = item.dataset.actionUrl;
          item.classList.remove('admin-notif-item--unread');
          const dot = item.querySelector('.admin-notif-unread-dot');
          if (dot) {
            dot.remove();
          }

          // Mark as read (fire and forget)
          try {
            await fetch(`/api/admin/notifications/${id}/read`, {
              method: 'PATCH',
              credentials: 'include',
              headers: window.__CSRF_TOKEN__ ? { 'X-CSRF-Token': window.__CSRF_TOKEN__ } : {},
            });
          } catch {
            /* non-blocking */
          }

          await fetchUnreadCount();
          if (url && url !== '#') {
            window.location.href = url;
          }
        });
      });
    } catch (err) {
      body.innerHTML = '<div class="admin-notif-empty"><p>Failed to load notifications.</p></div>';
    }
  }

  /**
   * Position the admin notification panel so it is always within the viewport.
   *
   * Root-cause of the original bug: the panel was `position:absolute` inside
   * `.admin-notif-bell-wrap` (which has `position:relative`).  On mobile the
   * bell wrap sits at approximately x=240–260 on a 390 px screen, so with
   * `right:0; width:360px` the panel's left edge was at ~260-360 = -100 px —
   * 100 px off the left of the viewport.  The old CSS `@media(max-width:480px)`
   * override (`right:-8px`) still anchored to the same container and did not
   * solve the problem.
   *
   * Fix: switch to `position:fixed` via inline style so the panel is always
   * positioned relative to the viewport, with `top` computed from the button's
   * `getBoundingClientRect()` so it still opens directly below the bell.
   */
  function positionAdminNotifPanel(panel, btn) {
    const btnRect = btn.getBoundingClientRect();
    const vw      = window.innerWidth;
    const top     = Math.round(btnRect.bottom + 8);

    if (vw <= 600) {
      // ── Mobile / narrow tablet ────────────────────────────────────────────
      // Pin the panel to viewport edges with 12 px clearance on each side.
      panel.style.position   = 'fixed';
      panel.style.top        = `${top  }px`;
      panel.style.left       = '12px';
      panel.style.right      = '12px';
      panel.style.width      = 'auto';
      panel.style.maxWidth   = 'none';
      panel.style.boxSizing  = 'border-box';
    } else {
      // ── Desktop / wide tablet ─────────────────────────────────────────────
      // Right-align to the bell button and clamp both edges to the viewport.
      const PANEL_W  = 360;
      const MARGIN   = 12;
      let rightEdge  = Math.round(btnRect.right);
      rightEdge      = Math.min(rightEdge, vw - MARGIN);    // clamp right
      let leftEdge   = rightEdge - PANEL_W;
      leftEdge       = Math.max(leftEdge, MARGIN);          // clamp left
      rightEdge      = leftEdge + PANEL_W;

      panel.style.position   = 'fixed';
      panel.style.top        = `${top  }px`;
      panel.style.left       = `${leftEdge  }px`;
      panel.style.right      = '';
      panel.style.width      = `${PANEL_W  }px`;
      panel.style.maxWidth   = 'calc(100vw - 24px)';
      panel.style.boxSizing  = 'border-box';
    }
  }

  function clearAdminNotifPanelStyles(panel) {
    ['position','top','left','right','width','maxWidth','boxSizing'].forEach(p => {
      panel.style[p] = '';
    });
  }

  function toggleNotifPanel(open) {
    const panel = document.getElementById('adminNotifPanel');
    const btn   = document.getElementById('adminNotifBellBtn');
    if (!panel || !btn) {
      return;
    }
    notifPanelOpen = open;
    btn.setAttribute('aria-expanded', String(open));

    if (open) {
      positionAdminNotifPanel(panel, btn);
      panel.hidden = false;
      loadNotifPanel();
      document.addEventListener('click', closeNotifOnOutsideClick, true);
      document.addEventListener('keydown', closeNotifOnEscape);
    } else {
      clearAdminNotifPanelStyles(panel);
      panel.hidden = true;
      document.removeEventListener('click', closeNotifOnOutsideClick, true);
      document.removeEventListener('keydown', closeNotifOnEscape);
    }
  }

  function closeNotifOnOutsideClick(e) {
    const wrap = document.getElementById('adminNotifWrap');
    if (wrap && !wrap.contains(e.target)) {
      toggleNotifPanel(false);
    }
  }

  function closeNotifOnEscape(e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      toggleNotifPanel(false);
      document.getElementById('adminNotifBellBtn') &&
        document.getElementById('adminNotifBellBtn').focus();
    }
  }

  function initNotifBell() {
    const bellBtn = document.getElementById('adminNotifBellBtn');
    if (!bellBtn) {
      return;
    }

    bellBtn.addEventListener('click', e => {
      e.stopPropagation();
      toggleNotifPanel(!notifPanelOpen);
    });

    const markAllBtn = document.getElementById('adminNotifMarkAllBtn');
    if (markAllBtn) {
      markAllBtn.addEventListener('click', async () => {
        try {
          await fetch('/api/admin/notifications/read-all', {
            method: 'POST',
            credentials: 'include',
            headers: window.__CSRF_TOKEN__ ? { 'X-CSRF-Token': window.__CSRF_TOKEN__ } : {},
          });
          updateNotifBadge(0);
          await loadNotifPanel();
        } catch {
          /* non-blocking */
        }
      });
    }

    // Initial count fetch + poll every 30s
    fetchUnreadCount();
    if (notifPollInterval) {
      clearInterval(notifPollInterval);
    }
    notifPollInterval = setInterval(fetchUnreadCount, 30000);
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') {
      return '';
    }
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
