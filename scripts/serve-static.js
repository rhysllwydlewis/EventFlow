#!/usr/bin/env node

/**
 * Lightweight static server for E2E tests
 * Serves the /public directory with a stub /api/health endpoint
 *
 * NOTE: This server mirrors routing behavior from main server.js to ensure
 * E2E tests can verify canonical URL redirects. Express.static alone won't
 * provide 301 redirects - it would serve files directly without redirection.
 */

const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 4173;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Basic rate limiter — limits abusive hammering of the test server
// (server only listens on 127.0.0.1 so this is defence-in-depth)
const staticLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3000, // generous limit — E2E test suites issue many requests per page load
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(staticLimiter);

// Disable caching for development/testing
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Add X-Robots-Tag: noindex, nofollow for private/authenticated pages
// This mirrors the behavior of middleware/seo.js in the main server
const noindexPatterns = [
  /^\/(auth|reset-password|dashboard|dashboard-customer|dashboard-supplier|messages|guests|checkout|my-marketplace-listings|budget)(\.html)?($|\?)/,
  /^\/(admin)([-/].+)?(\.html)?($|\?)/,
  /^\/(messenger|chat)(\/.*)?($|\?)/,
];
app.use((req, res, next) => {
  const isNoindex = noindexPatterns.some(pattern => pattern.test(req.path));
  if (isNoindex) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});

// ---------- Protected page guard (static/E2E server) ----------
// Prevents sensitive pages from being served to unauthenticated requests.
// In the static test server, authentication is signalled by the test_auth cookie.
// This mirrors the server-side authRequired middleware in the production server and
// ensures that the HTML is never sent before auth is confirmed — eliminating the
// "flash before redirect" window that client-side-only guards cannot prevent.
const protectedStaticPaths = [
  '/notifications',
  '/messages',
  '/guests',
  '/my-marketplace-listings',
  '/settings',
  '/plan',
  '/timeline',
  '/budget',
  '/dashboard',
  '/dashboard/customer',
  '/dashboard/supplier',
  '/messenger',
  '/chat',
];

app.use((req, res, next) => {
  const path = req.path.replace(/\.html$/, '');
  const isProtected = protectedStaticPaths.some(p => path === p || path.startsWith(`${p}/`));
  if (!isProtected) {
    return next();
  }

  const cookies = req.headers.cookie || '';
  const isAuthed = cookies.includes('test_auth=');
  if (!isAuthed) {
    return res.redirect(302, `/auth?redirect=${encodeURIComponent(req.originalUrl)}`);
  }
  next();
});

// Stub /api/health endpoint for Playwright health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', mode: 'static' });
});

// Stub supplier search API — returns mock suppliers so E2E tests can render cards
// and exercise the auth-gating logic (Save, Message, Add to plan).
app.get('/api/v2/search/suppliers', (req, res) => {
  const mockSuppliers = [
    {
      id: 'mock-sup-1',
      name: 'The Grand Venue',
      category: 'Venues',
      location: 'London, UK',
      description_short: 'Stunning event space in central London with capacity for 500 guests.',
      logo: '',
      approved: true,
      verified: true,
      rating: 4.8,
      averageRating: 4.8,
      reviewCount: 23,
      subscriptionTier: 'pro',
      ownerUserId: '',
      topPackages: [
        {
          id: 'mock-pkg-1',
          slug: 'garden-party-package',
          title: 'Garden Party Package',
          price: '£1,200 / event',
          description: 'Full outdoor garden setup with catering, decorations and staff included.',
          image: '',
        },
        {
          id: 'mock-pkg-2',
          slug: 'intimate-dinner',
          title: 'Intimate Dinner',
          price: '£850 / event',
          description: 'Intimate dining experience for up to 30 guests.',
          image: '',
        },
      ],
    },
    {
      id: 'mock-sup-2',
      name: 'Pixel Perfect Photography',
      category: 'Photography',
      location: 'Manchester, UK',
      description_short: 'Award-winning wedding and event photography since 2010.',
      logo: '',
      approved: true,
      subscriptionTier: 'pro_plus',
      ownerUserId: '',
      topPackages: [
        {
          id: 'mock-pkg-3',
          slug: 'wedding-full-day',
          title: 'Wedding Full Day',
          price: '£1,800',
          description: 'Full day wedding photography from prep to reception.',
          image: '',
        },
      ],
    },
    {
      id: 'mock-sup-3',
      name: 'Simply Catering Co',
      category: 'Catering',
      location: 'Birmingham, UK',
      description_short: 'Fresh, locally-sourced catering for events of all sizes.',
      logo: '',
      approved: true,
      ownerUserId: '',
      topPackages: [],
    },
  ];

  res.json({
    data: {
      results: mockSuppliers,
      pagination: { total: mockSuppliers.length, page: 1, limit: 20, totalPages: 1 },
      appliedSort: 'relevance',
    },
  });
});

// Stub spotlight + featured package carousel endpoints.
// These MUST be registered before /api/packages/:slug or Express will treat
// "spotlight" / "featured" as slug parameters and return the package detail stub.
// Deliberately includes packages where pkg.image is the placeholder but gallery
// has real images, to exercise and visually verify the resolvePackageImage() fix
// (the client-side resolver in home-init.js falls back to gallery when image is placeholder).
const PLACEHOLDER_IMG = '/assets/images/placeholders/package-event.svg';
const mockCarouselPackages = [
  {
    id: 'mock-spot-1',
    slug: 'barn-exclusive-hire',
    title: 'Barn Exclusive Hire',
    supplier_name: 'The Rustic Barn Venue',
    description: 'Transform our stunning rustic barn into your dream event space.',
    price_display: '£1,200',
    // image is placeholder — client-side resolver must fall back to gallery[0]
    image: PLACEHOLDER_IMG,
    gallery: [{ url: '/assets/images/collage-venue.jpg' }],
    featured: true,
  },
  {
    id: 'mock-spot-2',
    slug: 'wedding-full-day-photography',
    title: 'Wedding Full Day Photography',
    supplier_name: 'Pixel Perfect Photography',
    description: 'Full day wedding photography from prep to reception.',
    price_display: '£1,800',
    // image is a real path — resolver must use it directly
    image: '/assets/images/collage-photography.jpg',
    gallery: [],
    featured: false,
  },
  {
    id: 'mock-spot-3',
    slug: 'corporate-catering-package',
    title: 'Corporate Catering Package',
    supplier_name: 'Simply Catering Co',
    description: 'Fresh, locally-sourced catering for events of all sizes.',
    price_display: '£650',
    // both image and gallery are absent — resolver must return placeholder
    image: PLACEHOLDER_IMG,
    gallery: [],
    featured: false,
  },
  {
    id: 'mock-spot-4',
    slug: 'garden-party-package',
    title: 'Garden Party Package',
    supplier_name: 'The Grand Venue',
    description: 'Full outdoor garden setup with catering and staff included.',
    price_display: '£950',
    image: PLACEHOLDER_IMG,
    gallery: ['/assets/images/collage-catering.jpg'],
    featured: false,
  },
];

app.get('/api/packages/spotlight', (req, res) => {
  res.json({ items: mockCarouselPackages });
});

app.get('/api/packages/featured', (req, res) => {
  res.json({ items: mockCarouselPackages });
});

// Stub package detail API — returns a mock package so E2E tests can render the detail page.
// Must be registered AFTER the specific /spotlight and /featured routes above.
app.get('/api/packages/:slug', (req, res) => {
  const { slug } = req.params;
  // Use real Pexels photos (images.pexels.com is explicitly allowed by the image sanitizer)
  const mockPackage = {
    package: {
      id: 'mock-pkg-detail-1',
      slug,
      title: 'Barn Exclusive Hire',
      description:
        'Transform our stunning rustic barn into your dream event space. ' +
        'The exclusive hire package includes full access to the venue, on-site coordinator, ' +
        'decorative lighting, and a dedicated events team to ensure your special day runs perfectly. ' +
        'Perfect for weddings, milestone birthdays, and corporate celebrations.',
      price: 1200,
      price_display: '£1,200',
      location: 'Herefordshire, UK',
      featured: true,
      tags: ['rustic', 'barn', 'exclusive', 'wedding', 'celebration'],
      eventTypes: ['Weddings', 'Birthdays', 'Corporate Events', 'Anniversaries'],
      gallery: [
        {
          url: '/assets/images/collage-venue.jpg',
          alt: 'Rustic barn exterior with fairy lights',
        },
        {
          url: '/assets/images/collage-catering.jpg',
          alt: 'Elegant event catering and table settings',
        },
        {
          url: '/assets/images/collage-entertainment.jpg',
          alt: 'Live entertainment at the venue',
        },
      ],
    },
    supplier: {
      id: 'mock-sup-1',
      name: 'The Rustic Barn Venue',
      blurb: 'Award-winning rural event venue in the heart of Herefordshire',
      description_long:
        'We have been hosting unforgettable events since 2008. ' +
        'Our barn has been lovingly restored to offer a unique blend of rustic charm and modern amenities.',
      category: 'Venues',
      location: 'Herefordshire, UK',
      logo: '',
      verified: true,
      subscriptionTier: 'pro',
      ownerUserId: 'mock-owner-1',
    },
    categories: [{ slug: 'venues', name: 'Venues', icon: '🏛️' }],
  };
  res.json(mockPackage);
});

// Stub supplier profile API — returns a rich mock supplier for the profile page
// Supports both /api/suppliers/:id and /api/v1/suppliers/:id endpoints
const MOCK_SUPPLIER_PROFILE = {
  id: 'sup_demo1',
  name: 'The Grand Rustic Venue',
  tagline: 'A stunning countryside venue for weddings, corporate events and celebrations',
  category: 'Venues',
  location: 'Cotswolds',
  postcode: 'GL54 1AB',
  phone: '+44 1234 567890',
  website: 'https://thegrandrustic.co.uk',
  rating: 4.8,
  reviewCount: 47,
  priceRange: 'From £2,500',
  price_display: 'From £2,500',
  bannerUrl: null,
  themeColor: '#0b8073',
  description_long:
    'Nestled in the heart of the Cotswolds, The Grand Rustic Venue offers a magical setting for your special occasion. With exposed beams, original stone walls, and sweeping countryside views, we provide an unforgettable backdrop for weddings, corporate retreats, and private celebrations of all sizes.',
  description_short: 'A stunning countryside venue in the Cotswolds.',
  amenities: ['Free Parking', 'Catering Kitchen', 'Bridal Suite', 'AV Equipment', 'Outdoor Space'],
  highlights: [
    'Stunning countryside views',
    'Flexible layouts for up to 300 guests',
    'Award-winning catering team',
    'Dedicated event coordinator',
  ],
  completedEvents: 142,
  avgResponseTime: 4,
  isFoundingSupplier: true,
  verified: true,
  approved: true,
  isPro: true,
  subscription: { tier: 'pro' },
  ownerUserId: 'user_123',
  maxGuests: 300,
  insurance: true,
  createdAt: '2023-06-15T10:00:00Z',
  verifications: { email: true, phone: true, business: true },
  photosGallery: [
    { url: '/assets/images/placeholder-banner.svg', approved: true },
    { url: '/assets/images/placeholder-banner.svg', approved: true },
  ],
  socialLinks: {
    instagram: 'https://instagram.com/grandrusticvenue',
    facebook: 'https://facebook.com/grandrusticvenue',
  },
  featuredServices: [
    'Wedding Hire',
    'Corporate Events',
    'Private Parties',
    'Birthday Celebrations',
  ],
  badgeDetails: [
    {
      type: 'fast-responder',
      name: 'Fast Responder',
      icon: '⚡',
      description: 'Typically responds within 4 hours',
    },
    {
      type: 'top-rated',
      name: 'Top Rated',
      icon: '🌟',
      description: 'Consistently rated 4.5+ by clients',
    },
  ],
};

app.get('/api/suppliers/:id', (req, res) => {
  res.json(MOCK_SUPPLIER_PROFILE);
});

app.get('/api/suppliers/:id/packages', (req, res) => {
  res.json({
    items: [
      {
        id: 'pkg-1',
        slug: 'wedding-package',
        title: 'Wedding Package',
        price_display: '£4,500',
        description:
          'Full day wedding hire with catering coordination and dedicated event coordinator.',
        image: '/assets/images/placeholder-banner.svg',
      },
      {
        id: 'pkg-2',
        slug: 'corporate-day',
        title: 'Corporate Day',
        price_display: '£1,800',
        description:
          'Half-day or full-day corporate event hire with AV equipment and on-site support.',
        image: '/assets/images/placeholder-banner.svg',
      },
      {
        id: 'pkg-3',
        slug: 'private-celebration',
        title: 'Private Celebration',
        price_display: '£2,200',
        description:
          'Birthdays, anniversaries and milestone events — fully tailored to your needs.',
        image: '/assets/images/placeholder-banner.svg',
      },
    ],
  });
});

app.get('/api/v1/suppliers/:id/packages', (req, res) => {
  res.json({
    items: [
      {
        id: 'pkg-1',
        slug: 'wedding-package',
        title: 'Wedding Package',
        price_display: '£4,500',
        description: 'Full day wedding hire with catering coordination and dedicated coordinator.',
        image: '/assets/images/placeholder-banner.svg',
      },
      {
        id: 'pkg-2',
        slug: 'corporate-day',
        title: 'Corporate Day',
        price_display: '£1,800',
        description: 'Half-day or full-day corporate event hire with AV equipment.',
        image: '/assets/images/placeholder-banner.svg',
      },
    ],
  });
});

app.get('/api/v1/suppliers/:id', (req, res) => {
  res.json(MOCK_SUPPLIER_PROFILE);
});

app.get('/api/suppliers/:id/reviews', (req, res) => {
  res.json({
    reviews: [
      {
        id: 'rev-1',
        customerName: 'Sarah J.',
        rating: 5,
        comment:
          'Absolutely stunning venue. The staff were incredible and made our wedding day perfect.',
        createdAt: new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString(),
        verified: true,
      },
      {
        id: 'rev-2',
        customerName: 'Marcus T.',
        rating: 5,
        comment:
          'We held our company away-day here and it exceeded all expectations. Highly recommended!',
        createdAt: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
        verified: true,
      },
      {
        id: 'rev-3',
        customerName: 'Emma W.',
        rating: 4,
        comment: 'Beautiful venue, very accommodating team. Would definitely book again.',
        createdAt: new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString(),
        verified: false,
      },
    ],
    pagination: { total: 47, page: 1, perPage: 10 },
    averageRating: 4.8,
    distribution: { 5: 38, 4: 6, 3: 2, 2: 1, 1: 0 },
  });
});

app.get('/api/reviews/supplier/:id/distribution', (req, res) => {
  res.json({
    distribution: { 5: 38, 4: 6, 3: 2, 2: 1, 1: 0 },
    averageRating: 4.8,
    totalReviews: 47,
  });
});

// Stub shortlist API endpoints (auth-gated in real server; return 401 here)
app.get('/api/shortlist', (req, res) => {
  res.status(401).json({ error: 'Unauthorized' });
});

// Stub auth check.
// Default: returns 401 (logged-out) for normal E2E tests.
// Test override: if the request carries the cookie `test_auth=owner`, return the mock
// supplier owner so the "Your listing" disabled-button state can be exercised in E2E tests.
app.get('/api/v1/auth/me', (req, res) => {
  const cookies = req.headers.cookie || '';
  if (cookies.includes('test_auth=owner')) {
    return res.json({
      user: {
        id: 'mock-owner-1',
        name: 'Test Supplier Owner',
        email: 'owner@example.com',
        role: 'supplier',
      },
    });
  }
  res.status(401).json({ error: 'Not authenticated' });
});

// Stub public stats
app.get('/api/stats/public', (req, res) => {
  res.json({ suppliers: 500, packages: 1200, events: 3400 });
});

// Stub for homepage stats section (used by home-init.js fetchPublicStats)
app.get('/api/v1/public/stats', (req, res) => {
  res.json({
    suppliersVerified: 500,
    packagesApproved: 1200,
    marketplaceListingsActive: 150,
    reviewsApproved: 500,
  });
});

// Canonical URL redirects (matching server.js behavior)
// These redirects are needed because express.static serves files directly without redirection
app.get('/index.html', (req, res) => {
  res.redirect(301, '/');
});

app.get('/marketplace', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'marketplace.html'));
});

app.get('/marketplace.html', (req, res) => {
  res.redirect(301, '/marketplace');
});

// /package — serve the real package detail page only when a meaningful identifier is
// present (id, packageId, or slug query param).  A bare /package with no context is
// a dead-end, so redirect crawlers/users to /suppliers instead.
app.get('/package', (req, res) => {
  const { id, packageId, slug } = req.query;
  if (id || packageId || slug) {
    return res.sendFile(path.join(PUBLIC_DIR, 'package.html'));
  }
  return res.redirect(301, '/suppliers');
});

app.get('/package.html', (req, res) => {
  const qs = req.originalUrl.split('?').slice(1).join('?');
  res.redirect(301, `/package${qs ? `?${qs}` : ''}`);
});

// Dead-end singular routes — permanently redirect to the canonical plural/listing page.
// Crawlers hitting /supplier or /category land here via old links; send them somewhere useful.
app.get('/supplier', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/suppliers${qs}`);
});

app.get('/supplier.html', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/suppliers${qs}`);
});

app.get('/category', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/suppliers${qs}`);
});

app.get('/category.html', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/suppliers${qs}`);
});

app.get('/suppliers', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'suppliers.html'));
});

app.get('/suppliers.html', (req, res) => {
  res.redirect(301, '/suppliers');
});

app.get('/messenger', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'messenger', 'index.html'));
});

app.get('/messenger/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'messenger', 'index.html'));
});

app.get('/chat', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'chat', 'index.html'));
});

app.get('/chat/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'chat', 'index.html'));
});

// Canonical routes for other pages (matching server.js behavior)
// Note: /supplier, /category, and /package are all handled by explicit route handlers
// above (including redirects and conditional package-detail serving).  Do not add
// them back here.
const canonicalPages = [
  'start',
  'guides',
  'pricing',
  'faq',
  'for-suppliers',
  'auth',
  'contact',
  'legal',
  'credits',
  'checkout',
  'privacy',
  'terms',
  'payment-success',
  'payment-cancel',
  'my-marketplace-listings',
  'budget',
  'plan',
  'settings',
  'timeline',
  'notifications',
  'guests',
  'messages',
];

canonicalPages.forEach(page => {
  // Serve the page at canonical URL
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, `${page}.html`));
  });
  // Redirect .html to canonical, preserving any query string
  app.get(`/${page}.html`, (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(301, `/${page}${qs}`);
  });
});

// Deprecated admin pages — redirect to canonical replacements (matches server.js).
// These routes are registered BEFORE the adminPages serve loop so they take
// precedence even though the HTML files still exist on disk.
['/admin-pexels', '/admin-pexels.html'].forEach(deprecated => {
  app.get(deprecated, staticLimiter, (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(302, `/admin-media${qs}`);
  });
});

['/admin-content-dates', '/admin-content-dates.html'].forEach(deprecated => {
  app.get(deprecated, staticLimiter, (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const base = qs ? `${qs}&tab=legalDates` : '?tab=legalDates';
    res.redirect(302, `/admin-content${base}`);
  });
});

// Admin pages — serve clean URLs (matching server.js canonical redirect behavior)
// Both /<page> and /<page>.html serve the same file so static-mode E2E tests
// can navigate via clean URLs (matching production redirects) or via .html paths.
const adminPages = [
  'admin',
  'admin-audit',
  'admin-content',
  'admin-content-dates',
  'admin-exports',
  'admin-homepage',
  'admin-marketplace',
  'admin-messenger',
  'admin-messenger-view',
  'admin-packages',
  'admin-payments',
  'admin-media',
  'admin-pexels',
  'admin-search',
  'admin-photos',
  'admin-reports',
  'admin-settings',
  'admin-supplier-detail',
  'admin-suppliers',
  'admin-tickets',
  'admin-user-detail',
  'admin-users',
  'admin-debug',
];

adminPages.forEach(page => {
  // Serve admin page at clean URL (rate limiter applied globally via app.use above)
  app.get(`/${page}`, staticLimiter, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, `${page}.html`));
  });
  // In static-mode we keep .html paths working too (no redirect) so that
  // existing E2E tests that navigate to /<page>.html are not broken.
});

// Article pages — serve clean URLs and redirect .html to canonical
app.get('/articles/:slug', (req, res, next) => {
  const slug = req.params.slug;
  // Validate slug: only lowercase alphanumerics and hyphens — prevents path traversal
  if (!/^[a-z0-9-]+$/i.test(slug)) {
    return next();
  }
  res.sendFile(path.join(PUBLIC_DIR, 'articles', `${slug}.html`), err => {
    if (err) {
      next();
    }
  });
});
app.get('/articles/:slug.html', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/articles/${req.params.slug}${qs}`);
});

// Serve static files from public directory
app.use(express.static(PUBLIC_DIR));

// Fallback to index.html for client-side routing
app.get('*', staticLimiter, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Static server running at http://127.0.0.1:${PORT}`);
  console.log(`Serving directory: ${PUBLIC_DIR}`);
});
