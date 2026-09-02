'use strict';
(function () {
  const FALLBACK_IMAGE = '/assets/images/collage-venue.jpg';

  const escapeHtml = value => {
    const div = document.createElement('div');
    div.textContent = value === null || value === undefined ? '' : String(value);
    return div.innerHTML;
  };

  const safeImageUrl = (value, fallback = FALLBACK_IMAGE) => {
    const url = String(value || '').trim();
    if (!url || /^(javascript|data|vbscript|file):/i.test(url)) {
      return fallback;
    }
    return url;
  };

  // Admin categories can carry a Pexels-sourced heroImage (from the same
  // image picker used elsewhere in admin), but this homepage enhancement is
  // documented as same-origin-only imagery with nowhere to show the
  // accompanying photographer attribution. Reject any non-same-origin URL
  // here rather than requesting a third-party image on every homepage view.
  const sameOriginImageUrl = (value, fallback = FALLBACK_IMAGE) => {
    const url = safeImageUrl(value, '');
    if (!url) {
      return fallback;
    }
    if (!/^https?:\/\//i.test(url)) {
      return url;
    }
    try {
      return new URL(url, window.location.origin).origin === window.location.origin
        ? url
        : fallback;
    } catch (error) {
      return fallback;
    }
  };

  const categoryIcon = type => {
    const icons = {
      venue:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M6 20V9h12v11M9 20v-7h6v7M5 9l7-5 7 5"></path></svg>',
      catering:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17h16M6 17a6 6 0 0 1 12 0M12 8V5M9 5h6"></path></svg>',
      entertainment:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l10-2v13M9 9l10-2"></path><circle cx="6" cy="18" r="2.5"></circle><circle cx="16" cy="16" r="2.5"></circle></svg>',
      photography:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h4l2-3h4l2 3h4v11H4z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>',
      decor:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21c4-4 7-7 7-11a4 4 0 0 0-7-2 4 4 0 0 0-7 2c0 4 3 7 7 11Z"></path><path d="M12 8V3"></path></svg>',
      av: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"></rect><path d="M8 21h8M12 17v4"></path></svg>',
      transport:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17h14l-1-7H6l-1 7ZM7 10l2-4h6l2 4"></path><circle cx="8" cy="17" r="2"></circle><circle cx="16" cy="17" r="2"></circle></svg>',
      cake: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20h14M7 20v-6h10v6M8 14v-4h8v4M10 10V7h4v3"></path><path d="M12 7c-1-1-1-2 0-3 1 1 1 2 0 3Z"></path></svg>',
    };
    return icons[type] || icons.venue;
  };

  const approvedCategories = [
    {
      title: 'Venues',
      category: 'Venues',
      image: '/assets/images/collage-venue.jpg',
      icon: 'venue',
      description: 'Ballrooms, barns and gardens for any event.',
    },
    {
      title: 'Catering',
      category: 'Catering',
      image: '/assets/images/collage-catering.jpg',
      icon: 'catering',
      description: 'Food and drink for every taste and budget.',
    },
    {
      title: 'Entertainment',
      category: 'Entertainment',
      image: '/assets/images/collage-entertainment.jpg',
      icon: 'entertainment',
      description: 'Live music, DJs and performers.',
    },
    {
      title: 'Photography',
      category: 'Photography',
      image: '/assets/images/collage-photography.jpg',
      icon: 'photography',
      description: 'Photographers and videographers for every moment.',
    },
    {
      title: 'Decor & Styling',
      category: 'Decor',
      image: '/assets/images/hero-video-poster.jpg',
      icon: 'decor',
      description: 'Decorations, flowers and styling.',
    },
    {
      title: 'AV & Lighting',
      category: 'Music/DJ',
      image: '/assets/images/collage-entertainment.jpg',
      icon: 'av',
      description: 'Sound systems and lighting equipment.',
    },
    {
      title: 'Transport',
      category: 'Transport',
      image: '/assets/images/collage-venue.jpg',
      icon: 'transport',
      description: 'Cars and coaches for you and your guests.',
    },
    {
      title: 'Cakes & Florals',
      category: 'Cake',
      image: '/assets/images/collage-catering.jpg',
      icon: 'cake',
      description: 'Celebration cakes and floral arrangements.',
    },
  ];

  const approvedGuideImages = [
    '/assets/images/collage-venue.jpg',
    '/assets/images/collage-catering.jpg',
    '/assets/images/collage-photography.jpg',
  ];

  const attachImageFallbacks = scope => {
    scope.querySelectorAll('img[data-fallback-src]').forEach(image => {
      image.addEventListener(
        'error',
        () => {
          image.src = image.dataset.fallbackSrc;
          image.removeAttribute('data-fallback-src');
        },
        { once: true }
      );
    });
  };

  // Prefer the real, server-rendered `/categories/:slug` landing page over
  // the `/suppliers?category=X` filter view: the filter URL always carries a
  // static self-canonical back to the bare `/suppliers` listing (see
  // `services/categoryDirectoryPage.service.js`), so a homepage link to it
  // gets consolidated away rather than passed through. Falls back to the
  // filter URL when the category can't be resolved to a canonical slug.
  const categoryDirectoryHref = category => {
    const registry = window.EventFlowCategoryLink;
    if (!registry) {
      return null;
    }
    const canonicalName = registry.canonicalCategoryValue(category);
    const match = registry.CATEGORY_DEFINITIONS.find(def => def.name === canonicalName);
    return match ? `/categories/${match.slug}` : null;
  };

  const mapFallbackCategory = category => ({
    title: category.title,
    href:
      categoryDirectoryHref(category.category) ||
      `/suppliers?category=${encodeURIComponent(category.category)}`,
    image: safeImageUrl(category.image),
    iconHtml: categoryIcon(category.icon),
    description: category.description,
  });

  const mapLiveCategory = category => ({
    title: category.name || 'Category',
    href:
      categoryDirectoryHref(category) ||
      (window.EventFlowCategoryLink
        ? window.EventFlowCategoryLink.categoryHref(category)
        : `/suppliers?category=${encodeURIComponent(category.slug || category.name || '')}`),
    image: sameOriginImageUrl(category.heroImage),
    iconHtml: category.icon ? escapeHtml(category.icon) : categoryIcon('venue'),
    description: category.description || '',
  });

  // Admin-managed categories (name, hero image, description, visibility) are
  // the source of truth. The hardcoded list below is only a fallback for
  // when that fetch fails or returns nothing, so the section never renders
  // blank or depends on a third-party image host.
  const fetchLiveCategories = async () => {
    try {
      const response = await fetch('/api/v1/categories');
      if (!response.ok) {
        throw new Error('Failed to load categories');
      }
      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];
      return items
        .filter(category => category.visible !== false)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    } catch (error) {
      return null;
    }
  };

  const renderApprovedCategories = (container, categories) => {
    if (!container) {
      return;
    }

    const cards = categories
      .map(
        category => `
          <a class="ef-approved-category-card" href="${escapeHtml(category.href)}">
            <img src="${escapeHtml(category.image)}" alt="${escapeHtml(category.title)}" loading="lazy" data-fallback-src="${FALLBACK_IMAGE}">
            <div class="ef-approved-category-copy">
              <span class="ef-approved-category-icon">${category.iconHtml}</span>
              <h3>${escapeHtml(category.title)}</h3>
              <p>${escapeHtml(category.description)}</p>
            </div>
          </a>`
      )
      .join('');

    container.removeAttribute('aria-busy');
    container.setAttribute('aria-label', 'Supplier categories');
    container.innerHTML = `<div class="ef-approved-category-grid">${cards}</div>`;
    attachImageFallbacks(container);
  };

  const loadAndRenderCategories = async container => {
    const liveCategories = await fetchLiveCategories();
    const categories =
      liveCategories && liveCategories.length > 0
        ? liveCategories.map(mapLiveCategory)
        : approvedCategories.map(mapFallbackCategory);
    renderApprovedCategories(container, categories);
  };

  const renderBenefits = section => {
    if (!section) {
      return;
    }

    section.className = 'ef-approved-benefits-section';
    section.innerHTML = `
      <div class="container">
        <div class="ef-approved-benefits" aria-label="EventFlow benefits">
          <article>
            <span aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M8 3v4M16 3v4M4 10h16"></path></svg></span>
            <div><h3>Suppliers opening in stages</h3><p>New suppliers are joining as EventFlow expands across the UK.</p></div>
          </article>
          <article>
            <span aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M8 10V8a4 4 0 0 1 8 0v2"></path></svg></span>
            <div><h3>Secure Messaging</h3><p>Safe and private communication built in.</p></div>
          </article>
          <article><span aria-hidden="true">£</span><div><h3>No Platform Fees</h3><p>Book directly with the supplier you choose.</p></div></article>
          <article>
            <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg></span>
            <div><h3>UK Based Support</h3><p>Local support when you need it.</p></div>
          </article>
        </div>
      </div>`;
  };

  const renderEarlyAccess = section => {
    if (!section) {
      return;
    }

    section.className = 'ef-section ef-approved-steps-section';
    section.innerHTML = `
      <div class="container">
        <div class="ef-approved-heading">
          <span class="ef-approved-kicker">Early access</span>
          <h2>EventFlow is opening across the UK</h2>
          <p>Start planning now. Browse available suppliers, keep your ideas in one place, and manage enquiries all in one secure platform.</p>
        </div>
        <div class="ef-approved-step-grid">
          <article>
            <span class="ef-approved-step-number">1</span>
            <span class="ef-approved-step-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 4h8M9 2h6v4H9z"></path><rect x="5" y="4" width="14" height="18" rx="2"></rect><path d="m8 12 2 2 4-4M8 18h8"></path></svg></span>
            <div><h3>Build your plan</h3><p>Answer a few questions, choose your priorities and get a clear plan that matches your event.</p></div>
          </article>
          <article>
            <span class="ef-approved-step-number">2</span>
            <span class="ef-approved-step-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"></circle><circle cx="17" cy="10" r="2.5"></circle><path d="M3 21v-2a6 6 0 0 1 12 0v2M14 21v-1a5 5 0 0 1 7-4.6"></path></svg></span>
            <div><h3>Find the right suppliers</h3><p>Browse by category and location, save favourites and compare your options.</p></div>
          </article>
          <article>
            <span class="ef-approved-step-number">3</span>
            <span class="ef-approved-step-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="m7 12 3 3 7-7"></path></svg></span>
            <div><h3>Keep everything in one place</h3><p>Track your budget, message suppliers and stay on top of your planning checklist.</p></div>
          </article>
        </div>
      </div>`;
  };

  const formatPrice = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 'Price on request';
    }
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(number);
  };

  const getListingImage = listing => {
    const imageArrays = [listing?.images, listing?.photos];
    for (const images of imageArrays) {
      if (!Array.isArray(images)) {
        continue;
      }
      const image = images.find(item => typeof item === 'string' && item.trim());
      if (image) {
        return image;
      }
    }
    return listing?.image || FALLBACK_IMAGE;
  };

  const scoreListing = listing => {
    let score = 0;
    if (listing?.featured === true || listing?.isFeatured === true) {
      score += 1000;
    }
    if (getListingImage(listing) !== FALLBACK_IMAGE) {
      score += 100;
    }
    if (listing?.description) {
      score += 30;
    }
    if (listing?.condition) {
      score += 20;
    }
    if (listing?.category) {
      score += 20;
    }
    const createdAt = Date.parse(listing?.createdAt || '');
    if (!Number.isNaN(createdAt)) {
      score += Math.max(0, 180 - (Date.now() - createdAt) / 86400000);
    }
    return score;
  };

  const renderMarketplaceCard = (container, listing) => {
    if (!container) {
      return;
    }
    if (!listing) {
      container.innerHTML = `
        <div class="ef-approved-marketplace-empty">
          <div><h3>New marketplace items are coming soon</h3><p>Browse the marketplace for pre-loved event décor, attire, equipment and finishing touches.</p></div>
          <a href="/marketplace">View all marketplace items</a>
        </div>`;
      return;
    }

    const url = listing.id
      ? `/marketplace?listing=${encodeURIComponent(listing.id)}`
      : '/marketplace';
    const description = String(
      listing.description || 'A pre-loved event item ready for its next celebration.'
    );
    const summary = description.length > 180 ? `${description.slice(0, 177)}…` : description;
    const tags = [listing.category, listing.condition, listing.location]
      .filter(Boolean)
      .slice(0, 3)
      .map(tag => `<span>${escapeHtml(tag)}</span>`)
      .join('');

    container.innerHTML = `
      <article class="ef-approved-marketplace-card">
        <a class="ef-approved-marketplace-image" href="${escapeHtml(url)}">
          <img src="${escapeHtml(safeImageUrl(getListingImage(listing)))}" alt="${escapeHtml(listing.title || 'Marketplace listing')}" loading="lazy" data-fallback-src="${FALLBACK_IMAGE}">
        </a>
        <div class="ef-approved-marketplace-copy">
          <h3>${escapeHtml(listing.title || 'Marketplace listing')}</h3>
          <strong>${escapeHtml(formatPrice(listing.price))}</strong>
          <p>${escapeHtml(summary)}</p>
          <div class="ef-approved-tags">${tags}</div>
        </div>
        <a class="ef-approved-marketplace-cta" href="/marketplace">View all marketplace items</a>
      </article>`;
    attachImageFallbacks(container);
  };

  const loadApprovedMarketplace = async container => {
    try {
      const response = await fetch('/api/v1/marketplace/listings?limit=12');
      if (!response.ok) {
        throw new Error('Marketplace unavailable');
      }
      const data = await response.json();
      const listings = Array.isArray(data.listings) ? data.listings : [];
      const listing = listings.sort((a, b) => scoreListing(b) - scoreListing(a))[0];
      renderMarketplaceCard(container, listing || null);
    } catch (_) {
      renderMarketplaceCard(container, null);
    }
  };

  const preserveApprovedAsyncContent = (container, selector, render) => {
    let approvedReady = false;
    let rendering = false;
    const observer = new MutationObserver(() => {
      if (approvedReady && !rendering && !container.querySelector(selector)) {
        rendering = true;
        render().finally(() => {
          rendering = false;
        });
      }
    });
    observer.observe(container, { childList: true });
    render().finally(() => {
      approvedReady = true;
    });
    window.setTimeout(() => {
      observer.disconnect();
    }, 15000);
  };

  const prepareMarketplaceSection = section => {
    if (!section) {
      return;
    }
    section.className = 'ef-section ef-approved-marketplace-section';
    const header = section.querySelector('.ef-section__header');
    if (header) {
      header.className = 'ef-approved-heading';
      header.innerHTML =
        '<span class="ef-approved-kicker">Marketplace</span><h2>Latest Items for Sale</h2><p>Buy and sell pre-loved event items — dresses, décor, AV gear and more.</p>';
    }

    const container = document.getElementById('marketplace-preview');
    if (container) {
      container.className = 'ef-approved-marketplace-container';
      container.innerHTML =
        '<div class="ef-approved-loading" aria-label="Loading marketplace item"></div>';
      preserveApprovedAsyncContent(
        container,
        '.ef-approved-marketplace-card, .ef-approved-marketplace-empty',
        () => loadApprovedMarketplace(container)
      );
    }

    section.querySelectorAll('.ef-btn').forEach(link => {
      const wrapper = link.closest('div');
      if (wrapper && wrapper !== header) {
        wrapper.remove();
      }
    });
  };

  const renderApprovedGuides = (container, guides) => {
    if (!container) {
      return;
    }
    const selected = Array.isArray(guides) ? guides.slice(0, 3) : [];
    if (!selected.length) {
      container.innerHTML =
        '<div class="ef-approved-guides-empty"><p>Planning guides are being prepared.</p><a href="/guides">View all guides</a></div>';
      return;
    }

    container.className = 'ef-approved-guide-grid';
    container.innerHTML = selected
      .map((guide, index) => {
        const href = String(guide.href || '/guides');
        const image = approvedGuideImages[index] || FALLBACK_IMAGE;
        return `
          <a class="ef-approved-guide-card" href="${escapeHtml(href)}">
            <img src="${escapeHtml(image)}" alt="${escapeHtml(guide.title || 'Event planning guide')}" loading="lazy" data-fallback-src="${FALLBACK_IMAGE}">
            <div>
              <span>${escapeHtml(guide.category || 'Guide')}</span>
              <h3>${escapeHtml(guide.title || 'Event planning guide')}</h3>
              <p>${escapeHtml(guide.description || 'Practical event planning advice.')}</p>
              <small>${escapeHtml(String(guide.readingMins || 4))} min read</small>
            </div>
          </a>`;
      })
      .join('');
    attachImageFallbacks(container);
  };

  const loadApprovedGuides = async container => {
    try {
      const response = await fetch('/assets/data/guides.json');
      if (!response.ok) {
        throw new Error('Guides unavailable');
      }
      renderApprovedGuides(container, await response.json());
    } catch (_) {
      renderApprovedGuides(container, []);
    }
  };

  const prepareGuidesSection = section => {
    if (!section) {
      return;
    }
    section.className = 'ef-section ef-approved-guides-section';
    const header = section.querySelector('.ef-section__header');
    if (header) {
      header.className = 'ef-approved-heading';
      header.innerHTML =
        '<span class="ef-approved-kicker">Helpful Guides</span><h2>Expert Planning Resources</h2><p>Practical guides and inspiration to help you plan with confidence.</p>';
    }

    const container = document.getElementById('guides-list');
    if (container) {
      container.className = 'ef-approved-guide-grid';
      container.innerHTML = '<div class="ef-approved-loading" aria-label="Loading guides"></div>';
      preserveApprovedAsyncContent(
        container,
        '.ef-approved-guide-card, .ef-approved-guides-empty',
        () => loadApprovedGuides(container)
      );
    }

    if (!section.querySelector('.ef-approved-view-guides')) {
      const action = document.createElement('div');
      action.className = 'ef-approved-view-guides';
      action.innerHTML = '<a href="/guides">View all guides</a>';
      section.querySelector('.container')?.appendChild(action);
    }
  };

  const removeHowItWorks = () => {
    const heading = document.getElementById('how-it-works');
    if (heading) {
      heading.closest('section')?.remove();
    }
  };

  const renderSupplierCta = section => {
    if (!section) {
      return;
    }
    section.className = 'ef-approved-supplier-section';
    section.innerHTML = `
      <div class="container">
        <div class="ef-approved-supplier-panel">
          <div class="ef-approved-supplier-copy">
            <span class="ef-approved-kicker">For Suppliers</span>
            <h2>Are you an event supplier?</h2>
            <p>Join EventFlow and connect with customers planning their next event. Get discovered by people actively looking for services like yours, with no commission on bookings.</p>
            <div class="ef-approved-supplier-benefits">
              <article><span aria-hidden="true">✓</span><div><h3>No Commission</h3><p>Keep 100% of your booking fees.</p></div></article>
              <article><span aria-hidden="true">✓</span><div><h3>Verified Leads</h3><p>Connect with serious customers.</p></div></article>
              <article><span aria-hidden="true">✓</span><div><h3>Easy Setup</h3><p>Go live in minutes.</p></div></article>
            </div>
            <div class="ef-approved-supplier-actions"><a href="/pricing">Join as a Supplier</a><a href="/for-suppliers">Learn more</a></div>
          </div>
          <img src="/assets/images/hero-video-poster.jpg" alt="Event supplier preparing floral arrangements" loading="lazy">
          <div class="ef-approved-supplier-stats" aria-label="EventFlow supplier features">
            <article><strong>Growing network</strong><span>Across the UK</span></article>
            <article><strong>100%</strong><span>Your booking fees</span></article>
            <article><strong>Direct</strong><span>Customer enquiries</span></article>
            <article><strong>UK based</strong><span>Local support</span></article>
          </div>
        </div>
      </div>`;
  };

  const init = () => {
    const categorySection = document.querySelector('.home-category-section');
    if (!categorySection || document.body.dataset.efApprovedLower === 'true') {
      return;
    }
    document.body.dataset.efApprovedLower = 'true';
    document.body.classList.add('ef-approved-lower-home');

    categorySection.className = 'ef-section ef-approved-category-section';
    const header = categorySection.querySelector('.ef-section__header');
    if (header) {
      header.className = 'ef-approved-heading';
      header.innerHTML =
        '<span class="ef-approved-kicker">Browse suppliers by category</span><h2>Explore trusted suppliers</h2><p>Explore UK event suppliers across weddings, corporate events, parties and more.</p>';
    }

    const categoryContainer = document.getElementById('category-grid-home');
    if (categoryContainer) {
      loadAndRenderCategories(categoryContainer);
    }

    renderBenefits(document.querySelector('.home-trust-section'));
    renderEarlyAccess(document.getElementById('launch-section'));
    prepareMarketplaceSection(document.getElementById('marketplace-preview-section'));
    prepareGuidesSection(document.getElementById('guides-section'));
    removeHowItWorks();
    renderSupplierCta(document.querySelector('.ef-section--supplier-cta'));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
