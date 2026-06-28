'use strict';

const express = require('express');
const router = express.Router();

function homepageVariant() {
  return String(process.env.HOMEPAGE_VARIANT || 'v1').trim().toLowerCase();
}

function buildHomepageV2Html({ preview }) {
  const robots = preview ? 'noindex,nofollow' : 'index,follow';
  const canonical = preview ? 'https://event-flow.co.uk/home-v2-preview' : 'https://event-flow.co.uk/';
  const title = preview
    ? 'EventFlow Homepage V2 Preview — Plan Better. Celebrate More.'
    : 'EventFlow — Plan Better. Celebrate More.';

  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
  <meta name="theme-color" content="#0B8073" />
  <meta name="robots" content="${robots}" />
  <title>${title}</title>
  <meta name="description" content="Plan your event with EventFlow. Discover suppliers, manage budgets, organise guests, message suppliers and browse marketplace items in one place." />
  <link rel="canonical" href="${canonical}" />
  <link rel="stylesheet" href="/assets/css/tokens.css?v=18.3.0" />
  <link rel="stylesheet" href="/assets/css/design-system.css?v=18.3.0" />
  <link rel="stylesheet" href="/assets/css/styles.css?v=18.3.0" />
  <link rel="stylesheet" href="/assets/css/components.css?v=18.3.0" />
  <link rel="stylesheet" href="/assets/css/navbar.css?v=18.3.0" />
  <link rel="stylesheet" href="/assets/css/eventflow-footer.css?v=18.3.0" />
  <link rel="stylesheet" href="/assets/css/home-v2-preview.css?v=1.0.0" />
  <link rel="icon" href="/favicon.ico" sizes="any" />
</head>
<body class="efv2-page">
  <header class="ef-header efv2-header" role="banner">
    <div class="ef-container"><div class="ef-header-content">
      <a href="/" class="ef-brand" aria-label="EventFlow homepage"><div class="ef-logo" aria-hidden="true"><div class="ef-logo-inner"></div></div><span class="ef-brand-text">EventFlow</span></a>
      <nav class="ef-nav-desktop" aria-label="Main navigation"><a href="/start" class="ef-nav-link">Plan</a><a href="/suppliers" class="ef-nav-link">Suppliers</a><a href="/public-calendar" class="ef-nav-link">Events</a><a href="/marketplace" class="ef-nav-link">Marketplace</a><a href="/guides" class="ef-nav-link">Guides</a><a href="/pricing" class="ef-nav-link">Pricing</a></nav>
      <div class="ef-header-actions"><button id="ef-notification-btn" class="ef-icon-btn" type="button" aria-label="View notifications" style="display:none"><span id="ef-notification-badge" class="ef-badge" style="display:none"></span></button><a href="/auth" id="ef-auth-link" class="ef-btn ef-btn-primary">Log in</a><a href="#" id="ef-dashboard-link" class="ef-nav-link" style="display:none">Dashboard</a><button id="ef-mobile-toggle" class="ef-mobile-toggle" type="button" aria-label="Toggle menu" aria-expanded="false" aria-controls="ef-mobile-menu"><span class="ef-toggle-line"></span><span class="ef-toggle-line"></span><span class="ef-toggle-line"></span></button></div>
    </div></div>
    <div id="ef-mobile-menu" class="ef-mobile-menu" role="dialog" aria-modal="true" aria-label="Mobile navigation"><nav class="ef-mobile-nav" aria-label="Primary navigation"><a href="/start" class="ef-mobile-link">Plan an Event</a><a href="/suppliers" class="ef-mobile-link">Browse Suppliers</a><a href="/public-calendar" class="ef-mobile-link">Events Calendar</a><a href="/marketplace" class="ef-mobile-link">Marketplace</a><a href="/guides" class="ef-mobile-link">Guides</a><a href="/pricing" class="ef-mobile-link">Pricing</a><a href="/for-suppliers" class="ef-mobile-link">For Suppliers</a><a href="/faq" class="ef-mobile-link">FAQ</a><div class="ef-mobile-divider"></div><a href="/auth" id="ef-mobile-auth" class="ef-mobile-link ef-mobile-primary">Log in</a><a href="#" id="ef-mobile-dashboard" class="ef-mobile-link" style="display:none">Dashboard</a><a href="/settings" id="ef-mobile-settings" class="ef-mobile-link" style="display:none">Settings</a><a href="#" id="ef-mobile-logout" class="ef-mobile-link" style="display:none">Log out</a></nav></div>
  </header>

  <main id="main-content">
    <section class="efv2-hero" aria-labelledby="efv2-hero-title"><div class="efv2-orb efv2-orb--one" aria-hidden="true"></div><div class="efv2-orb efv2-orb--two" aria-hidden="true"></div><div class="efv2-container efv2-hero__grid"><div class="efv2-hero__copy"><p class="efv2-kicker">Trusted by event planners</p><h1 id="efv2-hero-title">Plan Better. Celebrate More.</h1><p class="efv2-hero__lead">The smarter way to discover event suppliers, build your plan, manage your budget and keep every decision in one calm place.</p><form class="efv2-search" action="/suppliers" method="GET"><div class="efv2-search__field"><label for="efv2-category">What are you planning?</label><select id="efv2-category" name="category"><option value="">All categories</option><option value="Venues">Wedding venues</option><option value="Photography">Photographers</option><option value="Catering">Caterers</option><option value="Entertainment">Entertainment</option><option value="Music/DJ">Live bands and DJs</option><option value="Florist">Florists</option></select></div><div class="efv2-search__field"><label for="efv2-location">Location</label><input id="efv2-location" name="location" type="search" placeholder="City or postcode" autocomplete="postal-code" /></div><button class="efv2-button efv2-button--primary" type="submit">Find suppliers</button></form><div class="efv2-chips" aria-label="Popular searches"><a href="/suppliers?category=Venues">Wedding Venues</a><a href="/suppliers?category=Photography">Photographers</a><a href="/suppliers?category=Catering">Caterers</a><a href="/suppliers?category=Entertainment">Live Bands</a></div><div class="efv2-trust-strip" aria-label="EventFlow benefits"><span>Quality suppliers</span><span>Real reviews</span><span>Secure messaging</span><span>No booking fees</span></div></div><div class="efv2-hero__visual" aria-label="Premium EventFlow planning preview"><div class="efv2-photo-card"><div class="efv2-photo-card__image" role="img" aria-label="Elegant event table setting with flowers and warm lighting"></div><div class="efv2-floating-card efv2-floating-card--budget"><span>Budget tracked</span><strong>£12,450</strong><small>74% allocated</small></div><div class="efv2-floating-card efv2-floating-card--shortlist"><span>Supplier shortlist</span><strong>8 saved</strong><small>3 replies today</small></div></div><div class="efv2-dashboard-card"><div class="efv2-dashboard-card__header"><span>Wedding Plan</span><strong>82%</strong></div><div class="efv2-progress"><span style="width:82%"></span></div><ul><li><span></span> Venue shortlist ready</li><li><span></span> Photographer quote received</li><li><span></span> Guest list imported</li></ul></div></div></div></section>

    <section class="efv2-proof" aria-label="Why EventFlow"><div class="efv2-container efv2-proof__grid"><article><strong>One place</strong><span>Suppliers, marketplace items, budgets and planning tools together.</span></article><article><strong>Direct contact</strong><span>Message suppliers without losing the thread across emails.</span></article><article><strong>Built for real events</strong><span>Weddings, parties, corporate events, community events and more.</span></article><article><strong>Free to start</strong><span>Create your plan and begin comparing options before you book.</span></article></div></section>

    <section class="efv2-section efv2-section--journey" aria-labelledby="efv2-journey-title"><div class="efv2-container"><div class="efv2-section__header"><p class="efv2-kicker">Planning journey</p><h2 id="efv2-journey-title">From first idea to final booking</h2><p>EventFlow turns scattered ideas, supplier research and budget decisions into a simple guided flow.</p></div><div class="efv2-journey" role="list"><article role="listitem"><span>01</span><h3>Create your event</h3><p>Add your event type, location, date and early priorities.</p></article><article role="listitem"><span>02</span><h3>Build your plan</h3><p>Use budget, checklist, guests and timeline tools from the start.</p></article><article role="listitem"><span>03</span><h3>Compare suppliers</h3><p>Shortlist venues, photographers, caterers and entertainment.</p></article><article role="listitem"><span>04</span><h3>Message directly</h3><p>Keep quotes, questions and supplier replies in one place.</p></article><article role="listitem"><span>05</span><h3>Book with confidence</h3><p>Make decisions with your whole plan visible.</p></article></div></div></section>

    <section class="efv2-section" aria-labelledby="efv2-categories-title"><div class="efv2-container"><div class="efv2-section__header efv2-section__header--split"><div><p class="efv2-kicker">Supplier discovery</p><h2 id="efv2-categories-title">Find the people who make the event</h2></div><a href="/suppliers" class="efv2-link">Browse all suppliers</a></div><div class="efv2-category-grid"><a href="/suppliers?category=Venues" class="efv2-category-card efv2-category-card--venue"><span>Wedding Venues</span><small>Find the place that sets the tone.</small></a><a href="/suppliers?category=Photography" class="efv2-category-card efv2-category-card--photo"><span>Photographers</span><small>Capture the day properly.</small></a><a href="/suppliers?category=Catering" class="efv2-category-card efv2-category-card--catering"><span>Caterers</span><small>Menus, drinks and service.</small></a><a href="/suppliers?category=Entertainment" class="efv2-category-card efv2-category-card--music"><span>Entertainment</span><small>Bands, DJs and performers.</small></a><a href="/suppliers?category=Florist" class="efv2-category-card efv2-category-card--florist"><span>Florists</span><small>Flowers, installations and styling.</small></a><a href="/suppliers?category=Decor" class="efv2-category-card efv2-category-card--decor"><span>Decor & Styling</span><small>Details that make it feel yours.</small></a></div></div></section>

    <section class="efv2-section efv2-section--marketplace" aria-labelledby="efv2-marketplace-title"><div class="efv2-container efv2-marketplace"><div class="efv2-marketplace__copy"><p class="efv2-kicker">Marketplace</p><h2 id="efv2-marketplace-title">Everything for your event, in one place.</h2><p>Buy or hire dresses, decor, furniture, AV equipment and more from trusted suppliers and event sellers.</p><a href="/marketplace" class="efv2-button efv2-button--dark">Browse marketplace</a></div><div class="efv2-marketplace__cards" id="efv2-marketplace-cards" aria-live="polite"><a href="/marketplace?search=centrepiece" class="efv2-product-card"><span class="efv2-product-card__media">Decor</span><strong>Eucalyptus centrepiece</strong><small>Decor & styling</small></a><a href="/marketplace?search=chair" class="efv2-product-card"><span class="efv2-product-card__media">Hire</span><strong>Chiavari chair hire</strong><small>Furniture</small></a><a href="/marketplace?search=lights" class="efv2-product-card"><span class="efv2-product-card__media">Light</span><strong>Fairy light backdrop</strong><small>Venue styling</small></a><a href="/marketplace?search=sound" class="efv2-product-card"><span class="efv2-product-card__media">AV</span><strong>Sound system</strong><small>AV equipment</small></a></div></div></section>

    <section class="efv2-section" aria-labelledby="efv2-tools-title"><div class="efv2-container efv2-tools"><div class="efv2-section__header"><p class="efv2-kicker">Planning tools</p><h2 id="efv2-tools-title">More than just a supplier directory</h2><p>Bring the practical parts of planning into the same place as supplier discovery.</p></div><div class="efv2-tool-grid"><article><span>Budget</span><h3>Budget manager</h3><p>Track planned, quoted and booked spend as your event develops.</p></article><article><span>Tasks</span><h3>Planning checklist</h3><p>Keep next steps visible instead of buried in notes and messages.</p></article><article><span>Chat</span><h3>Supplier messaging</h3><p>Keep enquiries, quotes and replies connected to the event.</p></article><article><span>Guests</span><h3>Guest management</h3><p>Organise guests, responses and important details in one flow.</p></article><article><span>Dates</span><h3>Calendar & timeline</h3><p>See deadlines, appointments and event milestones clearly.</p></article><article><span>Saved</span><h3>Supplier shortlist</h3><p>Save, compare and revisit the suppliers you are considering.</p></article></div></div></section>

    <section class="efv2-section efv2-section--compare" aria-labelledby="efv2-why-title"><div class="efv2-container"><div class="efv2-section__header"><p class="efv2-kicker">Why EventFlow</p><h2 id="efv2-why-title">Stop planning across ten different places</h2></div><div class="efv2-compare-grid"><article><h3>Spreadsheets</h3><ul><li>Budget in one file</li><li>Supplier notes somewhere else</li><li>No direct planning journey</li></ul></article><article><h3>Supplier directories</h3><ul><li>Good for browsing</li><li>Limited planning tools</li><li>Event management happens elsewhere</li></ul></article><article class="efv2-compare-grid__winner"><h3>EventFlow</h3><ul><li>Discover suppliers</li><li>Manage planning tools</li><li>Browse marketplace items</li><li>Keep decisions together</li></ul></article></div></div></section>

    <section class="efv2-section efv2-final-cta" aria-label="Start using EventFlow"><div class="efv2-container efv2-cta-grid"><article><p class="efv2-kicker">Planning an event?</p><h2>Start your free plan today.</h2><p>Create your event, browse suppliers and get organised before the next decision lands.</p><a href="/start" class="efv2-button efv2-button--primary">Start planning for free</a></article><article><p class="efv2-kicker">Are you a supplier?</p><h2>Join EventFlow and grow your business.</h2><p>Showcase your services, packages and marketplace listings to people actively planning events.</p><a href="/for-suppliers" class="efv2-button efv2-button--light">Join as a supplier</a></article></div></section>
  </main>

  <footer class="footer ef-footer-modern" role="contentinfo"><div class="container"><div class="ef-footer-grid"><div class="ef-footer-column ef-footer-brand"><div class="ef-footer-logo"><strong>EventFlow</strong></div><p class="ef-footer-tagline">Event planning made simple.</p><p class="ef-footer-copyright">&copy; 2025&ndash;2026 EventFlow. All rights reserved.</p></div><div class="ef-footer-column"><h3 class="ef-footer-heading">Platform</h3><ul class="ef-footer-links"><li><a href="/start">Plan an Event</a></li><li><a href="/suppliers">Browse Suppliers</a></li><li><a href="/marketplace">Marketplace</a></li><li><a href="/pricing">Pricing</a></li></ul></div><div class="ef-footer-column"><h3 class="ef-footer-heading">Resources</h3><ul class="ef-footer-links"><li><a href="/guides">Guides</a></li><li><a href="/faq">FAQ</a></li><li><a href="/for-suppliers">For Suppliers</a></li></ul></div><div class="ef-footer-column"><h3 class="ef-footer-heading">Legal</h3><ul class="ef-footer-links"><li><a href="/legal">Legal Hub</a></li><li><a href="/privacy">Privacy Policy</a></li><li><a href="/terms">Terms of Service</a></li><li><a href="/contact">Contact</a></li></ul></div></div></div></footer>

  <script src="/assets/js/utils/auth-state.js" defer></script><script src="/assets/js/burger-menu.js" defer></script><script src="/assets/js/navbar.js" defer></script><script src="/assets/js/app.js" defer></script><script src="/assets/js/pages/home-v2-preview.js?v=1.0.0" defer></script>
</body>
</html>`;
}

function sendHomepageV2({ preview }) {
  return (req, res, next) => {
    if (!preview && homepageVariant() !== 'v2') {
      return next();
    }

    if (preview) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    } else {
      res.setHeader('X-EventFlow-Homepage-Variant', 'v2');
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.type('html').send(buildHomepageV2Html({ preview }));
  };
}

router.get('/', sendHomepageV2({ preview: false }));
router.get('/home-v2-preview', sendHomepageV2({ preview: true }));
router.get('/home-v2-preview.html', sendHomepageV2({ preview: true }));

module.exports = router;
