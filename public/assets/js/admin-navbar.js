/**
 * Admin Navbar JavaScript
 * Handles navigation functionality, mobile menu, and database status
 */

(function () {
  'use strict';

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    initMobileMenu();
    initUserDropdown();
    initDatabaseStatus();
    highlightActivePage();
    initBadgeCounts();
    updateNavbarUser();
    initRefreshButton();
    initLogoutButton();
  }

  /**
   * Mobile hamburger menu toggle
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
