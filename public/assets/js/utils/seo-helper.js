/**
 * SEO Metadata Helper
 * Dynamically updates page metadata for better SEO
 */

/**
 * Check if debug logging is enabled
 * @returns {boolean} True if debug logging should be enabled
 */
function isDebugEnabled() {
  // Check window.DEBUG first
  if (typeof window !== 'undefined' && window.DEBUG) {
    return true;
  }
  // Check for development environment
  if (
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ) {
    return true;
  }
  return false;
}

class SEOHelper {
  constructor() {
    this.defaultMeta = {
      title: 'Plan your event the simple way',
      description:
        'Find suppliers, build your plan and keep everything in one place — beautifully simple on mobile and desktop.',
      keywords: 'event planning, wedding planning, suppliers, venues, catering',
      author: 'EventFlow',
      type: 'website',
      image: '/assets/images/eventflow-og-image.png?v=2',
      twitterCard: 'summary_large_image',
    };
  }

  /**
   * Update page title
   * @param {string} title - Page title
   * @param {boolean} includeSiteName - Whether to append the site name suffix
   *   When true the suffix " — EventFlow" is appended, but only if the title
   *   does not already contain the brand (prevents "EventFlow … — EventFlow").
   */
  setTitle(title, includeSiteName = true) {
    let fullTitle;
    if (includeSiteName) {
      // Avoid double-branding: skip the suffix when the title already ends with
      // "— EventFlow" / "| EventFlow" (any case) or starts with "EventFlow —".
      const alreadyBranded =
        /[—|]\s*eventflow\s*$/i.test(title) || /^eventflow\s*[—]/i.test(title);
      fullTitle = alreadyBranded ? title : `${title} — EventFlow`;
    } else {
      fullTitle = title;
    }
    document.title = fullTitle;

    // Update Open Graph title
    this.setMetaTag('og:title', fullTitle);
    this.setMetaTag('twitter:title', fullTitle);
  }

  /**
   * Update page description
   * @param {string} description - Page description
   */
  setDescription(description) {
    this.setMetaTag('description', description, 'name');
    this.setMetaTag('og:description', description);
    this.setMetaTag('twitter:description', description);
  }

  /**
   * Update page keywords
   * @param {string|Array} keywords - Keywords as string or array
   */
  setKeywords(keywords) {
    const keywordString = Array.isArray(keywords) ? keywords.join(', ') : keywords;
    this.setMetaTag('keywords', keywordString, 'name');
  }

  /**
   * Update Open Graph image
   * @param {string} imageUrl - Image URL
   * @param {Object} options - Image options (width, height, alt)
   */
  setImage(imageUrl, options = {}) {
    const fullUrl = this.getFullUrl(imageUrl);

    this.setMetaTag('og:image', fullUrl);
    this.setMetaTag('twitter:image', fullUrl);

    if (options.width) {
      this.setMetaTag('og:image:width', options.width);
    }
    if (options.height) {
      this.setMetaTag('og:image:height', options.height);
    }
    if (options.alt) {
      this.setMetaTag('og:image:alt', options.alt);
      this.setMetaTag('twitter:image:alt', options.alt);
    }
  }

  /**
   * Set canonical URL
   * Respects existing production canonical tags to prevent overriding in test/staging
   * @param {string} url - Canonical URL
   */
  setCanonical(url) {
    const fullUrl = this.getFullUrl(url);

    // Check if canonical already exists
    let canonical = document.querySelector('link[rel="canonical"]');

    // If canonical already exists and points to production, do not override
    if (canonical && canonical.href) {
      const existingHref = canonical.href.toLowerCase();
      // Check for exact domain match (not just prefix) to prevent bypasses like https://event-flow.co.uk.evil.com
      // Only preserve non-www production URLs (https://event-flow.co.uk), not www variants
      if (
        existingHref.startsWith('https://event-flow.co.uk/') ||
        existingHref === 'https://event-flow.co.uk'
      ) {
        // Production canonical already set in HTML, don't override
        if (isDebugEnabled()) {
          console.log('[SEO] Using existing production canonical:', canonical.href);
        }
        // Still update og:url to match
        this.setMetaTag('og:url', canonical.href);
        return;
      }
    }

    // Create or update canonical link
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = fullUrl;

    // Update Open Graph URL
    this.setMetaTag('og:url', fullUrl);
  }

  /**
   * Set page type
   * @param {string} type - Page type (website, article, product, etc.)
   */
  setType(type) {
    this.setMetaTag('og:type', type);
  }

  /**
   * Set structured data (JSON-LD)
   * @param {Object} data - Structured data object
   */
  setStructuredData(data) {
    // Remove existing structured data
    const existing = document.querySelector('script[type="application/ld+json"]');
    if (existing) {
      existing.remove();
    }

    // Add new structured data
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
  }

  /**
   * Set all metadata at once
   * @param {Object} meta - Metadata object
   */
  setAll(meta) {
    if (meta.title) {
      this.setTitle(meta.title, meta.includeSiteName !== false);
    }
    if (meta.description) {
      this.setDescription(meta.description);
    }
    if (meta.keywords) {
      this.setKeywords(meta.keywords);
    }
    if (meta.image) {
      this.setImage(meta.image, meta.imageOptions);
    }
    if (meta.canonical) {
      this.setCanonical(meta.canonical);
    }
    if (meta.type) {
      this.setType(meta.type);
    }
    if (meta.structuredData) {
      this.setStructuredData(meta.structuredData);
    }
  }

  /**
   * Set meta tag
   * Respects existing production og:url to prevent overriding in test/staging
   * @param {string} property - Meta property or name
   * @param {string} content - Meta content
   * @param {string} attribute - Attribute type (property or name)
   */
  setMetaTag(property, content, attribute = 'property') {
    let meta = document.querySelector(`meta[${attribute}="${property}"]`);

    // Special handling for og:url to respect production URLs
    if (property === 'og:url' && meta && meta.getAttribute('content')) {
      const existingContent = meta.getAttribute('content').toLowerCase();
      // Check for exact domain match (not just prefix) to prevent bypasses like https://event-flow.co.uk.evil.com
      // Only preserve non-www production URLs (https://event-flow.co.uk), not www variants
      if (
        existingContent.startsWith('https://event-flow.co.uk/') ||
        existingContent === 'https://event-flow.co.uk'
      ) {
        // Production og:url already set in HTML, don't override
        if (isDebugEnabled()) {
          console.log('[SEO] Using existing production og:url:', meta.getAttribute('content'));
        }
        return;
      }
    }

    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute(attribute, property);
      document.head.appendChild(meta);
    }

    meta.setAttribute('content', content);
  }

  /**
   * Get the canonical base URL for SEO purposes.
   * Prefers configured EF_CANONICAL_BASE over window.location.origin
   * to ensure consistent canonical URLs in all environments.
   * @returns {string} - Canonical base URL (e.g., 'https://event-flow.co.uk')
   */
  getCanonicalBase() {
    // Prefer explicit production base URL configuration
    // This ensures canonical URLs are correct even in dev/test environments
    if (typeof window !== 'undefined' && window.EF_CANONICAL_BASE) {
      return window.EF_CANONICAL_BASE.replace(/\/$/, ''); // Remove trailing slash
    }
    // Fallback to current origin (may be localhost in dev)
    return window.location.origin;
  }

  /**
   * Get full URL from relative path (with validation)
   * @param {string} path - Relative or absolute path
   * @returns {string} - Full URL
   */
  getFullUrl(path) {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }

    // Prevent protocol-relative URLs (open redirect vulnerability)
    if (path.startsWith('//')) {
      throw new Error('Protocol-relative URLs are not allowed');
    }

    const baseUrl = this.getCanonicalBase();
    const cleanPath = path.startsWith('/') ? path : `/${path}`;

    // Use URL constructor for safe URL building
    // Note: Origin validation is not needed here because:
    // 1. Absolute URLs (http/https) are returned early above
    // 2. Protocol-relative URLs (//) are blocked above
    // 3. URL constructor with relative path cannot produce different origin than baseUrl
    try {
      const url = new URL(cleanPath, baseUrl);
      return url.href;
    } catch (error) {
      console.error('Invalid URL:', path, error);
      return `${baseUrl}${cleanPath}`;
    }
  }

  /**
   * Generate breadcrumb structured data
   * @param {Array} items - Breadcrumb items [{ name, url }]
   * @returns {Object} - Structured data object
   */
  generateBreadcrumbs(items) {
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        item: this.getFullUrl(item.url),
      })),
    };
  }

  /**
   * Generate local business structured data
   * @param {Object} business - Business information
   * @returns {Object} - Structured data object
   */
  generateLocalBusiness(business) {
    return {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: business.name,
      description: business.description,
      url: this.getFullUrl('/'),
      telephone: business.telephone,
      email: business.email,
      address: business.address
        ? {
            '@type': 'PostalAddress',
            streetAddress: business.address.street,
            addressLocality: business.address.city,
            addressRegion: business.address.region,
            postalCode: business.address.postalCode,
            addressCountry: business.address.country,
          }
        : undefined,
      openingHoursSpecification: business.hours
        ? business.hours.map(hours => ({
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: hours.days,
            opens: hours.opens,
            closes: hours.closes,
          }))
        : undefined,
    };
  }

  /**
   * Generate event structured data
   * @param {Object} event - Event information
   * @returns {Object} - Structured data object
   */
  generateEvent(event) {
    return {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: event.name,
      description: event.description,
      startDate: event.startDate,
      endDate: event.endDate,
      location: event.location
        ? {
            '@type': 'Place',
            name: event.location.name,
            address: event.location.address,
          }
        : undefined,
      image: event.image ? this.getFullUrl(event.image) : undefined,
      organizer: event.organizer
        ? {
            '@type': 'Organization',
            name: event.organizer.name,
            url: event.organizer.url,
          }
        : undefined,
    };
  }

  /**
   * Generate supplier profile structured data (ProfessionalService schema)
   * @param {Object} supplier - Supplier information
   * @returns {Object} - Structured data object
   */
  generateSupplierProfile(supplier) {
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'ProfessionalService',
      name: supplier.name,
      description: supplier.description,
    };

    // Add URL if available
    if (supplier.url) {
      structuredData.url = this.getFullUrl(supplier.url);
    }

    // Add image if available
    if (supplier.image) {
      structuredData.image = this.getFullUrl(supplier.image);
    }

    // Add telephone if available
    if (supplier.telephone || supplier.phone) {
      structuredData.telephone = supplier.telephone || supplier.phone;
    }

    // Add email if available
    if (supplier.email) {
      structuredData.email = supplier.email;
    }

    // Add address if available
    if (supplier.address) {
      structuredData.address = {
        '@type': 'PostalAddress',
      };
      if (supplier.address.street) {
        structuredData.address.streetAddress = supplier.address.street;
      }
      if (supplier.address.city) {
        structuredData.address.addressLocality = supplier.address.city;
      }
      if (supplier.address.region) {
        structuredData.address.addressRegion = supplier.address.region;
      }
      if (supplier.address.postalCode) {
        structuredData.address.postalCode = supplier.address.postalCode;
      }
      if (supplier.address.country) {
        structuredData.address.addressCountry = supplier.address.country;
      }
    }

    // Add price range if available
    if (supplier.priceRange) {
      structuredData.priceRange = supplier.priceRange;
    }

    // Add aggregate rating if available
    if (supplier.rating && supplier.reviewCount) {
      structuredData.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: supplier.rating,
        reviewCount: supplier.reviewCount,
      };
    }

    // Add service area if available
    if (supplier.serviceArea) {
      structuredData.areaServed = supplier.serviceArea;
    }

    return structuredData;
  }

  /**
   * Generate product structured data (for packages)
   * @param {Object} pkg - Package information
   * @returns {Object} - Structured data object
   */
  generateProduct(pkg) {
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: pkg.name,
      description: pkg.description,
    };

    // Add image if available
    if (pkg.image) {
      structuredData.image = this.getFullUrl(pkg.image);
    }

    // Add URL if available
    if (pkg.url) {
      structuredData.url = this.getFullUrl(pkg.url);
    }

    // Add brand/provider if available
    if (pkg.brand || pkg.supplier) {
      structuredData.brand = {
        '@type': 'Brand',
        name: pkg.brand || pkg.supplier,
      };
    }

    // Add offer/pricing information if available
    if (pkg.price || pkg.priceFrom) {
      structuredData.offers = {
        '@type': 'Offer',
        priceCurrency: pkg.currency || 'GBP',
      };

      if (pkg.price) {
        structuredData.offers.price = pkg.price;
      } else if (pkg.priceFrom) {
        structuredData.offers.price = pkg.priceFrom;
        structuredData.offers.priceSpecification = {
          '@type': 'PriceSpecification',
          minPrice: pkg.priceFrom,
        };
      }

      // Add availability if available
      if (pkg.availability !== undefined) {
        structuredData.offers.availability =
          pkg.availability === true || pkg.availability === 'available'
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock';
      }

      // Add URL to the offer if available
      if (pkg.url) {
        structuredData.offers.url = this.getFullUrl(pkg.url);
      }
    }

    // Add aggregate rating if available
    if (pkg.rating && pkg.reviewCount) {
      structuredData.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: pkg.rating,
        reviewCount: pkg.reviewCount,
      };
    }

    // Add category if available
    if (pkg.category) {
      structuredData.category = pkg.category;
    }

    return structuredData;
  }
}

// Create global instance
if (typeof window !== 'undefined') {
  window.seoHelper = new SEOHelper();
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SEOHelper;
}
