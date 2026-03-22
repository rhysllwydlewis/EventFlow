/**
 * Admin Pages Registry
 *
 * Single source of truth for all admin pages, their canonical routes, legacy
 * aliases, navigation metadata, and any other useful metadata.
 *
 * Usage:
 *   const { ADMIN_PAGES, NAV_ITEMS, getAdminPagesAllowlist } = require('./config/adminRegistry');
 *
 * middleware/adminPages.js imports getAdminPagesAllowlist() to build the
 * protection allowlist, eliminating manual drift between the HTML files on
 * disk and the server-side access control list.
 */

'use strict';

/**
 * @typedef {Object} AdminPage
 * @property {string}   route      - Canonical clean URL (no .html)
 * @property {string}   htmlFile   - Filename stem under public/ (without .html)
 * @property {string}   label      - Human-readable page label
 * @property {string}   icon       - Emoji icon for the navbar
 * @property {string}   category   - Logical grouping (core | moderation | content | tools | compat)
 * @property {boolean}  inNav      - Whether to render a link in the admin navbar
 * @property {string}   [badgeId]  - DOM id for the optional badge counter element
 * @property {string}   [redirect] - If set, canonical URL is a legacy alias → redirect here
 */

/** @type {AdminPage[]} */
const REGISTRY = [
  // ── Core ──────────────────────────────────────────────────────────────────
  {
    route: '/admin',
    htmlFile: 'admin',
    label: 'Dashboard',
    icon: '📊',
    category: 'core',
    inNav: true,
  },
  {
    route: '/admin-settings',
    htmlFile: 'admin-settings',
    label: 'Settings',
    icon: '⚙️',
    category: 'core',
    inNav: true,
  },

  // ── Users & Suppliers ─────────────────────────────────────────────────────
  {
    route: '/admin-users',
    htmlFile: 'admin-users',
    label: 'Users',
    icon: '👥',
    category: 'users',
    inNav: true,
  },
  {
    route: '/admin-user-detail',
    htmlFile: 'admin-user-detail',
    label: 'User Detail',
    icon: '👤',
    category: 'users',
    inNav: false,
  },
  {
    route: '/admin-suppliers',
    htmlFile: 'admin-suppliers',
    label: 'Suppliers',
    icon: '🏢',
    category: 'users',
    inNav: true,
  },
  {
    route: '/admin-supplier-detail',
    htmlFile: 'admin-supplier-detail',
    label: 'Supplier Detail',
    icon: '🏗️',
    category: 'users',
    inNav: false,
  },

  // ── Catalogue ─────────────────────────────────────────────────────────────
  {
    route: '/admin-packages',
    htmlFile: 'admin-packages',
    label: 'Packages',
    icon: '📦',
    category: 'catalogue',
    inNav: true,
  },
  {
    route: '/admin-marketplace',
    htmlFile: 'admin-marketplace',
    label: 'Marketplace',
    icon: '🛒',
    category: 'catalogue',
    inNav: true,
  },
  {
    route: '/admin-photos',
    htmlFile: 'admin-photos',
    label: 'Photos',
    icon: '📸',
    category: 'catalogue',
    inNav: true,
  },
  {
    route: '/admin-media',
    htmlFile: 'admin-media',
    label: 'Media',
    icon: '🎨',
    category: 'catalogue',
    inNav: true,
  },

  // ── Moderation ────────────────────────────────────────────────────────────
  {
    route: '/admin-tickets',
    htmlFile: 'admin-tickets',
    label: 'Tickets',
    icon: '🎫',
    category: 'moderation',
    inNav: true,
    badgeId: 'openTicketsBadge',
  },
  {
    route: '/admin-reports',
    htmlFile: 'admin-reports',
    label: 'Reports',
    icon: '📈',
    category: 'moderation',
    inNav: true,
  },
  {
    route: '/admin-messenger',
    htmlFile: 'admin-messenger',
    label: 'Messages',
    icon: '💬',
    category: 'moderation',
    inNav: true,
  },
  {
    route: '/admin-messenger-view',
    htmlFile: 'admin-messenger-view',
    label: 'Message View',
    icon: '📨',
    category: 'moderation',
    inNav: false,
  },

  // ── Operations ────────────────────────────────────────────────────────────
  {
    route: '/admin-payments',
    htmlFile: 'admin-payments',
    label: 'Payments',
    icon: '💳',
    category: 'operations',
    inNav: true,
  },
  {
    route: '/admin-audit',
    htmlFile: 'admin-audit',
    label: 'Audit',
    icon: '📋',
    category: 'operations',
    inNav: true,
  },
  {
    route: '/admin-exports',
    htmlFile: 'admin-exports',
    label: 'Exports',
    icon: '📤',
    category: 'operations',
    inNav: true,
  },

  // ── Content ───────────────────────────────────────────────────────────────
  {
    route: '/admin-homepage',
    htmlFile: 'admin-homepage',
    label: 'Homepage',
    icon: '🏠',
    category: 'content',
    inNav: true,
  },
  {
    route: '/admin-content',
    htmlFile: 'admin-content',
    label: 'Content',
    icon: '✏️',
    category: 'content',
    inNav: true,
  },

  // ── Tools ─────────────────────────────────────────────────────────────────
  {
    route: '/admin-search',
    htmlFile: 'admin-search',
    label: 'Search',
    icon: '🔍',
    category: 'tools',
    inNav: true,
  },
  {
    route: '/admin-debug',
    htmlFile: 'admin-debug',
    label: 'Debug',
    icon: '🩺',
    category: 'tools',
    inNav: true,
  },

  // ── Compatibility stubs (legacy aliases — no nav link, server-side redirect) ──
  {
    route: '/admin-pexels',
    htmlFile: 'admin-pexels',
    label: 'Stock Photos (legacy)',
    icon: '',
    category: 'compat',
    inNav: false,
    redirect: '/admin-media',
  },
  {
    route: '/admin-content-dates',
    htmlFile: 'admin-content-dates',
    label: 'Content Dates (legacy)',
    icon: '',
    category: 'compat',
    inNav: false,
    redirect: '/admin-content?tab=legalDates',
  },
];

/**
 * Returns the flat allowlist used by adminPageProtectionMiddleware.
 * Both the canonical clean URL and the legacy .html variant are included so
 * that protection is enforced regardless of which form the browser requests.
 *
 * @returns {string[]}
 */
function getAdminPagesAllowlist() {
  return REGISTRY.flatMap(page => [page.route, `${page.route}.html`]);
}

/**
 * Returns only the nav-visible items, in display order.
 * Used by admin-navbar.js (via a compiled/inlined constant) to render links.
 *
 * @returns {AdminPage[]}
 */
function getNavItems() {
  return REGISTRY.filter(page => page.inNav);
}

/**
 * Returns only pages that have a redirect target (legacy compat stubs).
 *
 * @returns {AdminPage[]}
 */
function getLegacyRedirects() {
  return REGISTRY.filter(page => Boolean(page.redirect));
}

module.exports = {
  REGISTRY,
  getAdminPagesAllowlist,
  getNavItems,
  getLegacyRedirects,
};
