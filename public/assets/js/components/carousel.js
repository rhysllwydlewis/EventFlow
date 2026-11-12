/**
 * Carousel component - Class-based implementation
 * Features:
 * - Responsive items per view (3 desktop, 2 tablet, 1 mobile)
 * - Arrow navigation (one card per press)
 * - Swipe/drag support (one card per swipe)
 * - No horizontal overflow on mobile
 * - Auto-scroll support
 * - Proper gap handling for positioning
 */

// Responsive breakpoint constants (must match CSS media queries)
const BREAKPOINT_MOBILE = 480;
const BREAKPOINT_TABLET = 768;

class Carousel {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.warn(`Carousel: Container with id "${containerId}" not found`);
      return;
    }

    this.options = {
      itemsPerView: options.itemsPerView || 3,
      itemsPerViewTablet: options.itemsPerViewTablet || 2,
      itemsPerViewMobile: options.itemsPerViewMobile || 1,
      autoScroll: options.autoScroll || false,
      autoScrollInterval: options.autoScrollInterval || 5000,
      ariaLabel: options.ariaLabel || 'Featured packages carousel',
    };

    this.items = [];
    this.currentIndex = 0;
    this.autoScrollTimer = null;
    this.autoScrollPaused = false;
    this.isInitialized = false;

    this._injectStyles();
  }

  _injectStyles() {
    if (document.getElementById('carousel-component-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'carousel-component-styles';
    style.textContent = `
      /* Featured carousel wrapper */
      .featured-carousel {
        position: relative;
        width: 100%;
      }

      /* Track: a native horizontal scroller with snap points. Touch swiping is
         the browser's own scrolling, so it works on every card; the arrows and
         keyboard just move it by one card. */
      .carousel-container {
        position: relative; /* offsetParent for the items, so offsetLeft is track-relative */
        display: flex;
        gap: 20px;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-x: contain;
        scroll-snap-type: x mandatory;
        scroll-behavior: smooth;
        scrollbar-width: none; /* Firefox */
        padding: 6px 0 18px;
      }

      .carousel-container::-webkit-scrollbar { display: none; }

      .carousel-container:focus-visible {
        outline: 2px solid #0B8073;
        outline-offset: 4px;
        border-radius: 16px;
      }

      /* Carousel item - snap aligned */
      .carousel-item {
        flex: 0 0 auto;
        scroll-snap-align: start;
        box-sizing: border-box;
        min-width: 0;
      }

      /* Desktop: 3 items per view */
      @media (min-width: ${BREAKPOINT_TABLET + 1}px) {
        .carousel-item {
          width: calc((100% - 40px) / 3); /* 3 items with 20px gaps */
        }
      }

      /* Tablet: 2 items per view */
      @media (min-width: ${BREAKPOINT_MOBILE + 1}px) and (max-width: ${BREAKPOINT_TABLET}px) {
        .carousel-item {
          width: calc((100% - 20px) / 2); /* 2 items with 20px gap */
        }
      }

      /* Mobile: one card with the next one peeking in, so it is obvious the
         row scrolls. */
      @media (max-width: ${BREAKPOINT_MOBILE}px) {
        .carousel-container {
          gap: 12px;
        }
        .carousel-item {
          width: 86%;
          max-width: 86%;
        }
      }

      /* Package card */
      .featured-package-card {
        background: #fff;
        border: 1px solid #e3eaeb;
        border-radius: 16px;
        overflow: hidden;
        height: 100%;
        display: flex;
        flex-direction: column;
        transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        text-decoration: none;
        color: inherit;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      }

      .featured-package-card:hover,
      .featured-package-card:focus-visible {
        transform: translateY(-3px);
        border-color: rgba(11, 128, 115, 0.35);
        box-shadow: 0 16px 32px -16px rgba(11, 64, 58, 0.28);
      }

      .featured-package-card:focus-visible {
        outline: 2px solid #0B8073;
        outline-offset: 2px;
      }

      .featured-package-card .package-media {
        position: relative;
        aspect-ratio: 16 / 10;
        background: #eef3f3;
        overflow: hidden;
      }

      .featured-package-card img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
        transition: transform 0.4s ease;
      }

      .featured-package-card:hover img {
        transform: scale(1.04);
      }

      .featured-package-card .package-tag {
        position: absolute;
        top: 12px;
        left: 12px;
        max-width: calc(100% - 24px);
        padding: 4px 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.94);
        color: #0a5c53;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
        line-height: 1.4;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.16);
      }

      .featured-package-card .package-info {
        padding: 16px 16px 14px;
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .featured-package-card h3 {
        margin: 0 0 2px 0;
        font-size: 17px;
        font-weight: 700;
        line-height: 1.3;
        letter-spacing: -0.01em;
        color: #0b1220;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
      }

      .featured-package-card .package-supplier {
        margin: 0 0 8px 0;
        font-size: 13px;
        color: #475467;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .featured-package-card .package-description {
        margin: 0 0 14px 0;
        font-size: 14px;
        color: #475467;
        line-height: 1.5;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
      }

      .featured-package-card .package-footer {
        margin-top: auto;
        padding-top: 12px;
        border-top: 1px solid #eef2f2;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .featured-package-card .package-price {
        min-width: 0;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.35;
        color: #0a6b60;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
      }

      .featured-package-card .package-price .price-not-set {
        color: #667085;
        font-weight: 500;
      }

      .featured-package-card .package-cta {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 13px;
        font-weight: 700;
        color: #0a6b60;
        white-space: nowrap;
      }

      .featured-package-card .package-cta svg {
        width: 14px;
        height: 14px;
        transition: transform 0.2s ease;
      }

      .featured-package-card:hover .package-cta svg {
        transform: translateX(3px);
      }

      /* Carousel arrows */
      .carousel-prev, .carousel-next {
        position: absolute;
        top: 38%;
        transform: translateY(-50%);
        background: #fff;
        border: 1px solid #e3eaeb;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 10;
        transition: box-shadow 0.2s ease, opacity 0.2s ease, color 0.2s ease;
        color: #0b1220;
        box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
      }

      .carousel-prev svg, .carousel-next svg {
        width: 18px;
        height: 18px;
      }

      .carousel-prev:hover:not(:disabled),
      .carousel-next:hover:not(:disabled) {
        color: #0a6b60;
        box-shadow: 0 6px 18px rgba(15, 23, 42, 0.18);
      }

      .carousel-prev:focus-visible,
      .carousel-next:focus-visible {
        outline: 2px solid #0B8073;
        outline-offset: 2px;
      }

      .carousel-prev:disabled,
      .carousel-next:disabled {
        opacity: 0;
        pointer-events: none;
      }

      .carousel-prev { left: -20px; }
      .carousel-next { right: -20px; }

      /* Nothing to page through: every card already fits. */
      .featured-carousel.is-static .carousel-prev,
      .featured-carousel.is-static .carousel-next {
        display: none;
      }

      @media (max-width: ${BREAKPOINT_TABLET}px) {
        .carousel-prev { left: 4px; }
        .carousel-next { right: 4px; }
      }

      /* Mobile: the row is swiped, so the arrows are a small pair laid out
         under the track instead of a 36px gutter each side of one card. */
      @media (max-width: ${BREAKPOINT_MOBILE}px) {
        .featured-carousel {
          display: grid;
          grid-template-columns: 1fr auto auto;
          column-gap: 8px;
        }
        .carousel-container {
          grid-column: 1 / -1;
          grid-row: 1;
        }
        .carousel-prev, .carousel-next {
          position: static;
          grid-row: 2;
          transform: none;
          width: 36px;
          height: 36px;
          box-shadow: 0 1px 4px rgba(15, 23, 42, 0.12);
        }
        .carousel-prev { grid-column: 2; }
        .carousel-next { grid-column: 3; }
        .carousel-prev:disabled,
        .carousel-next:disabled {
          opacity: 0.4;
        }
      }

      /* Dragging state (mouse) */
      .carousel-container.is-dragging {
        cursor: grabbing;
        user-select: none;
        scroll-behavior: auto;
        scroll-snap-type: none;
      }

      .carousel-container.is-dragging * {
        user-select: none;
        -webkit-user-drag: none;
      }

      @media (prefers-reduced-motion: reduce) {
        .carousel-container { scroll-behavior: auto; }
        .featured-package-card,
        .featured-package-card img,
        .featured-package-card .package-cta svg { transition: none; }
        .featured-package-card:hover { transform: none; }
        .featured-package-card:hover img { transform: none; }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Set carousel items and render the carousel.
   * Note: This method replaces the entire carousel content and should
   * typically be called only once during initialization. Calling it
   * multiple times will destroy existing event listeners and re-render
   * the entire carousel from scratch.
   *
   * @param {Array} items - Array of package items to display
   */
  setItems(items) {
    // Stop auto-scroll if running
    this._stopAutoScroll();

    this.items = items;
    this._render();

    // Only set up event listeners if not already initialized
    // This prevents duplicate event listeners on multiple setItems calls
    if (!this.isInitialized) {
      this._setupEventListeners();
    }

    if (this.options.autoScroll && this._hasMultiplePages()) {
      this._startAutoScroll();
    }

    this.isInitialized = true;
  }

  _render() {
    if (!this.container) {
      return;
    }

    // Create carousel structure
    const html = `
      <button type="button" class="carousel-prev" aria-label="Previous packages">${Carousel.CHEVRON_LEFT}</button>
      <div class="carousel-container" tabindex="0" role="region" aria-label="${this.options.ariaLabel}">
        ${this.items.map(item => this._renderItem(item)).join('')}
      </div>
      <button type="button" class="carousel-next" aria-label="Next packages">${Carousel.CHEVRON_RIGHT}</button>
    `;

    this.container.innerHTML = html;

    // Get references
    this.carouselContainer = this.container.querySelector('.carousel-container');
    this.prevButton = this.container.querySelector('.carousel-prev');
    this.nextButton = this.container.querySelector('.carousel-next');
    this.itemElements = Array.from(this.carouselContainer.querySelectorAll('.carousel-item'));

    this._updateControls();
  }

  _renderItem(item) {
    const DESCRIPTION_MAX_LENGTH = 100;

    const escapeHtml = text => {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    };

    // Validate and sanitize URLs to prevent XSS
    const sanitizeUrl = url => {
      if (!url) {
        return '/assets/images/placeholders/package-event.svg';
      }
      const urlStr = String(url);
      // Block javascript:, data:, vbscript:, and file: URLs
      if (/^(javascript|data|vbscript|file):/i.test(urlStr)) {
        return '/assets/images/placeholders/package-event.svg';
      }
      return escapeHtml(urlStr);
    };

    // Validate slug for URL safety
    const validateSlug = (value, fallbackId) => {
      const slugStr = String(value || '');
      // Only allow alphanumeric, hyphens, and underscores
      const cleaned = slugStr.replace(/[^a-zA-Z0-9_-]/g, '');
      // Fall back to provided id if slug becomes empty after cleaning
      return cleaned || String(fallbackId || 'unknown');
    };

    // Format price with £ symbol if it's a number
    const formatPrice = priceDisplay => {
      if (!priceDisplay) {
        return null; // Signal "not set" so the caller can emit a styled placeholder
      }
      const priceStr = String(priceDisplay);
      // A price that starts with a digit is an amount with the currency left
      // off ("650", "650+", "1,200 per day"), so it gets the £ it is missing.
      // Anything worded ("From £120", "Enquire for quote") is shown as written.
      if (/^\d/.test(priceStr.trim())) {
        return `£${priceStr.trim()}`;
      }
      // Otherwise return as-is
      return priceStr;
    };

    const title = escapeHtml(item.title || 'Untitled Package');
    const supplierName = escapeHtml(item.supplier_name || '');
    // Truncate description BEFORE escaping to avoid counting HTML entities
    const rawDesc = item.description || '';
    const truncatedRawDesc =
      rawDesc.length > DESCRIPTION_MAX_LENGTH
        ? `${rawDesc.substring(0, DESCRIPTION_MAX_LENGTH)}...`
        : rawDesc;
    const description = escapeHtml(truncatedRawDesc);
    const rawPrice = formatPrice(item.price_display || item.price);
    const price = rawPrice
      ? escapeHtml(rawPrice)
      : '<span class="price-not-set">Price not set</span>';
    // Resolve the best available image via the shared utility when loaded,
    // otherwise fall back to the same inline strategy for resilience.
    const resolvedRaw =
      typeof resolvePackageImage === 'function'
        ? resolvePackageImage(item)
        : (() => {
            const placeholder = '/assets/images/placeholders/package-event.svg';
            if (item.image && item.image !== placeholder) {
              return item.image;
            }
            if (Array.isArray(item.gallery) && item.gallery.length > 0) {
              for (const img of item.gallery) {
                const url =
                  typeof img === 'string'
                    ? img
                    : img.url ||
                      img.src ||
                      img.path ||
                      img.image ||
                      img.originalUrl ||
                      img.thumbnail;
                if (url && url !== placeholder) {
                  return url;
                }
              }
            }
            return placeholder;
          })();
    const image = sanitizeUrl(resolvedRaw);
    // Emit debug info when debug mode is active (?debugImages=1 or localStorage)
    if (typeof debugPackageImage === 'function') {
      debugPackageImage(item, image);
    }
    const slug = validateSlug(item.slug, item.id);

    // Category pill over the image. Stored either as a display name
    // ("Transport") or a slug list (["venues"]), so normalise to Title Case.
    const rawCategory =
      item.primaryCategoryKey || (Array.isArray(item.categories) ? item.categories[0] : '') || '';
    // "Other" on a pill says nothing, so those cards go without one.
    const showCategory = rawCategory && !/^other$/i.test(String(rawCategory).trim());
    const category = escapeHtml(
      String(rawCategory)
        .replace(/[-_]+/g, ' ')
        .trim()
        .replace(/\b\w/g, ch => ch.toUpperCase())
    );

    return `
      <div class="carousel-item">
        <a href="/package/${encodeURIComponent(slug)}" class="featured-package-card">
          <div class="package-media">
            <img src="${image}" alt="${title}" loading="lazy" decoding="async"
                 data-fallback-src="/assets/images/placeholders/package-event.svg">
            ${showCategory ? `<span class="package-tag">${category}</span>` : ''}
          </div>
          <div class="package-info">
            <h3>${title}</h3>
            ${supplierName ? `<p class="package-supplier">${supplierName}</p>` : ''}
            <p class="package-description">${description}</p>
            <div class="package-footer">
              <div class="package-price">${price}</div>
              <span class="package-cta" aria-hidden="true">View ${Carousel.ARROW_RIGHT}</span>
            </div>
          </div>
        </a>
      </div>
    `;
  }

  _setupEventListeners() {
    if (!this.carouselContainer) {
      return;
    }

    // Arrow buttons
    if (this.prevButton) {
      this.prevButton.addEventListener('click', e => {
        e.preventDefault();
        this._stopAutoScroll();
        this.goToPrev();
      });
    }

    if (this.nextButton) {
      this.nextButton.addEventListener('click', e => {
        e.preventDefault();
        this._stopAutoScroll();
        this.goToNext();
      });
    }

    // Keyboard navigation
    this.carouselContainer.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this._stopAutoScroll();
        this.goToPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this._stopAutoScroll();
        this.goToNext();
      }
    });

    // Scroll sync
    let scrollRaf = null;
    this.carouselContainer.addEventListener(
      'scroll',
      () => {
        if (scrollRaf) {
          cancelAnimationFrame(scrollRaf);
        }
        scrollRaf = requestAnimationFrame(() => {
          this._syncIndexFromScroll();
        });
      },
      { passive: true }
    );

    // Drag handling
    this._setupDragHandling();

    // Auto-scroll etiquette: hold while the row is hovered or focused, and
    // stop for good once the visitor scrolls it themselves by touch.
    const pause = () => {
      this.autoScrollPaused = true;
    };
    const resume = () => {
      this.autoScrollPaused = false;
    };
    this.container.addEventListener('pointerenter', pause);
    this.container.addEventListener('pointerleave', resume);
    this.container.addEventListener('focusin', pause);
    this.container.addEventListener('focusout', resume);
    this.carouselContainer.addEventListener('touchstart', () => this._stopAutoScroll(), {
      passive: true,
    });

    // Resize handling
    let resizeRaf = null;
    window.addEventListener('resize', () => {
      if (resizeRaf) {
        cancelAnimationFrame(resizeRaf);
      }
      resizeRaf = requestAnimationFrame(() => {
        this.scrollToIndex(this.currentIndex);
      });
    });
  }

  _setupDragHandling() {
    let isPointerDown = false;
    let didDrag = false;
    let startX = 0;
    let startScrollLeft = 0;
    let pointerId = null;
    const DRAG_THRESHOLD_PX = 10; // Increased threshold for better click detection

    const onPointerDown = e => {
      // Don't interfere with clicks on links
      if (e.target.closest('a')) {
        return;
      }

      if (e.pointerType === 'mouse' && e.button !== 0) {
        return;
      }

      isPointerDown = true;
      didDrag = false;
      startX = e.clientX;
      startScrollLeft = this.carouselContainer.scrollLeft;
      pointerId = e.pointerId;

      // Don't capture pointer yet - wait until we're actually dragging
      this._stopAutoScroll();
    };

    const onPointerMove = e => {
      if (!isPointerDown) {
        return;
      }
      const dx = e.clientX - startX;

      if (!didDrag && Math.abs(dx) > DRAG_THRESHOLD_PX) {
        didDrag = true;
        // NOW capture the pointer since we're actually dragging
        this.carouselContainer.setPointerCapture?.(pointerId);
        // Only add dragging class and prevent selection when actually dragging
        this.carouselContainer.classList.add('is-dragging');
        document.body.style.userSelect = 'none';
      }

      if (didDrag) {
        this.carouselContainer.scrollLeft = startScrollLeft - dx;
      }
    };

    const onPointerUp = () => {
      if (!isPointerDown) {
        return;
      }
      isPointerDown = false;
      this.carouselContainer.classList.remove('is-dragging');

      // Only release if we actually captured it
      if (didDrag && pointerId !== null) {
        this.carouselContainer.releasePointerCapture?.(pointerId);
      }

      document.body.style.userSelect = '';
      pointerId = null;

      // Only prevent clicks if user actually dragged (moved more than threshold)
      if (didDrag) {
        // Prevent the NEXT click event
        const preventClick = ev => {
          ev.preventDefault();
          ev.stopPropagation();
        };
        this.carouselContainer.addEventListener('click', preventClick, {
          capture: true,
          once: true,
        });
      }
      // If didn't drag, allow click to proceed normally
    };

    this.carouselContainer.addEventListener('pointerdown', onPointerDown);
    this.carouselContainer.addEventListener('pointermove', onPointerMove);
    this.carouselContainer.addEventListener('pointerup', onPointerUp);
    this.carouselContainer.addEventListener('pointercancel', onPointerUp);
    this.carouselContainer.addEventListener('pointerleave', onPointerUp);
  }

  _syncIndexFromScroll() {
    if (!this.itemElements.length) {
      return;
    }

    const scrollLeft = this.carouselContainer.scrollLeft;
    let closestIdx = 0;
    let closestDist = Infinity;

    for (let i = 0; i < this.itemElements.length; i++) {
      const dist = Math.abs(this.itemElements[i].offsetLeft - scrollLeft);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }

    if (closestIdx !== this.currentIndex) {
      this.currentIndex = closestIdx;
      this._updateControls();
    }
  }

  scrollToIndex(index) {
    const i = this._clamp(index, 0, this.itemElements.length - 1);
    if (!this.itemElements[i]) {
      return;
    }

    const left = this.itemElements[i].offsetLeft;
    this.carouselContainer.scrollTo({ left, behavior: 'smooth' });
    this.currentIndex = i;
    this._updateControls();
  }

  goToNext() {
    this.scrollToIndex(this.currentIndex + 1);
  }

  goToPrev() {
    this.scrollToIndex(this.currentIndex - 1);
  }

  /**
   * Whether the track is scrolled as far right as it goes. With three cards in
   * view the last *index* is never reached — the track stops two cards short —
   * so "is this the last card" is the wrong question for the next button.
   * @returns {boolean}
   */
  _isAtEnd() {
    const track = this.carouselContainer;
    if (!track) {
      return true;
    }
    return track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
  }

  _updateControls() {
    const track = this.carouselContainer;
    const isStatic = !track || track.scrollWidth <= track.clientWidth + 2;
    this.container.classList.toggle('is-static', isStatic);

    if (this.prevButton) {
      this.prevButton.disabled = isStatic || this.currentIndex <= 0;
    }
    if (this.nextButton) {
      this.nextButton.disabled =
        isStatic || this.currentIndex >= this.itemElements.length - 1 || this._isAtEnd();
    }
  }

  _hasMultiplePages() {
    const width = window.innerWidth;
    let itemsPerView = this.options.itemsPerView;

    if (width <= BREAKPOINT_MOBILE) {
      itemsPerView = this.options.itemsPerViewMobile;
    } else if (width <= BREAKPOINT_TABLET) {
      itemsPerView = this.options.itemsPerViewTablet;
    }

    return this.items.length > itemsPerView;
  }

  _startAutoScroll() {
    this._stopAutoScroll();

    // Moving content nobody asked to move is exactly what this preference is
    // for, so the row stays put and is paged by hand.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    this.autoScrollTimer = setInterval(() => {
      // Held while someone is pointing at or tabbing through the row, so a
      // card never slides out from under the cursor or the focus ring.
      if (this.autoScrollPaused) {
        return;
      }
      if (this.currentIndex >= this.itemElements.length - 1 || this._isAtEnd()) {
        this.scrollToIndex(0);
      } else {
        this.goToNext();
      }
    }, this.options.autoScrollInterval);
  }

  _stopAutoScroll() {
    if (this.autoScrollTimer) {
      clearInterval(this.autoScrollTimer);
      this.autoScrollTimer = null;
    }
  }

  _clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  destroy() {
    this._stopAutoScroll();
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

// Expose globally for homepage usage
const CAROUSEL_ICON_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
Carousel.CHEVRON_LEFT = `<svg ${CAROUSEL_ICON_ATTRS}><path d="m15 18-6-6 6-6"/></svg>`;
Carousel.CHEVRON_RIGHT = `<svg ${CAROUSEL_ICON_ATTRS}><path d="m9 18 6-6-6-6"/></svg>`;
Carousel.ARROW_RIGHT = `<svg ${CAROUSEL_ICON_ATTRS}><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

window.Carousel = Carousel;
