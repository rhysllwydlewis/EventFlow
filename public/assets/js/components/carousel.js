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
    };

    this.items = [];
    this.currentIndex = 0;
    this.autoScrollTimer = null;
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

      /* Carousel container - horizontally scrollable with snap */
      .carousel-container {
        display: flex;
        gap: 20px;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        scroll-snap-type: x mandatory;
        scroll-behavior: smooth;
        scrollbar-width: none; /* Firefox */
        padding: 10px 0;
      }
      .carousel-container::-webkit-scrollbar { display: none; }

      /* Prevent horizontal page overflow on mobile */
      @media (max-width: ${BREAKPOINT_MOBILE}px) {
        .carousel-container {
          overflow: hidden;
          gap: 0;
        }
      }

      /* Carousel item - snap aligned */
      .carousel-item {
        flex: 0 0 auto;
        scroll-snap-align: start;
        box-sizing: border-box;
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

      /* Mobile: 1 item per view */
      @media (max-width: ${BREAKPOINT_MOBILE}px) {
        .carousel-item {
          width: 100%;
          max-width: 100%;
          min-width: 0;
        }
      }

      /* Featured package card styling */
      .featured-package-card {
        background: #fff;
        border: 1px solid #e4e4e7;
        border-radius: 8px;
        overflow: hidden;
        height: 100%;
        display: flex;
        flex-direction: column;
        transition: transform 0.2s, box-shadow 0.2s;
        text-decoration: none;
        color: inherit;
      }

      .featured-package-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      }

      .featured-package-card img {
        width: 100%;
        height: 180px;
        object-fit: cover;
      }

      .featured-package-card .package-info {
        padding: 14px;
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      .featured-package-card h3 {
        margin: 0 0 4px 0;
        font-size: 16px;
        font-weight: 600;
        color: #0a0a0a;
      }

      .featured-package-card .package-supplier {
        margin: 0 0 8px 0;
        font-size: 13px;
        color: #71717a;
        font-weight: 500;
      }

      .featured-package-card .package-description {
        margin: 0 0 auto 0;
        font-size: 14px;
        color: #52525b;
        line-height: 1.4;
      }

      .featured-package-card .package-price {
        margin-top: 8px;
        font-size: 14px;
        font-weight: 600;
        color: #0B8073;
      }

      /* Carousel arrows */
      .carousel-prev, .carousel-next {
        position: absolute;
        top: 40%;
        transform: translateY(-50%);
        background: rgba(255, 255, 255, 0.9);
        border: 1px solid #e4e4e7;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 10;
        transition: all 0.2s;
        font-size: 20px;
        color: #0a0a0a;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      }

      .carousel-prev:hover:not(:disabled),
      .carousel-next:hover:not(:disabled) {
        background: #fff;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      }

      .carousel-prev:disabled,
      .carousel-next:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }

      .carousel-prev { left: -20px; }
      .carousel-next { right: -20px; }

      @media (max-width: ${BREAKPOINT_TABLET}px) {
        .carousel-prev { left: 0; }
        .carousel-next { right: 0; }
      }

      /* Mobile: smaller arrows that sit in gutters, not covering card content */
      @media (max-width: ${BREAKPOINT_MOBILE}px) {
        .featured-carousel {
          padding: 0 36px;
          box-sizing: border-box;
        }
        .carousel-prev, .carousel-next {
          width: 32px;
          height: 32px;
          font-size: 16px;
          background: rgba(255, 255, 255, 0.95);
          box-shadow: 0 1px 4px rgba(0,0,0,0.12);
        }
        .carousel-prev { left: 0; }
        .carousel-next { right: 0; }
      }

      /* Dragging state */
      .carousel-container.is-dragging {
        cursor: grabbing;
        user-select: none;
        scroll-behavior: auto;
      }
      .carousel-container.is-dragging * {
        user-select: none;
        -webkit-user-drag: none;
      }

      /* Mobile text overflow handling */
      @media (max-width: ${BREAKPOINT_MOBILE}px) {
        .featured-package-card {
          width: 100%;
          box-sizing: border-box;
        }
        .featured-package-card .package-info {
          overflow-wrap: break-word;
          word-break: break-word;
          hyphens: auto;
        }
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
      <button class="carousel-prev" aria-label="Previous">‹</button>
      <div class="carousel-container" tabindex="0" role="region" aria-label="Featured packages carousel">
        ${this.items.map(item => this._renderItem(item)).join('')}
      </div>
      <button class="carousel-next" aria-label="Next">›</button>
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
        return 'Contact for pricing';
      }
      const priceStr = String(priceDisplay);
      // If it's a plain number (integer or decimal), format as £X
      if (/^\d+(\.\d+)?$/.test(priceStr)) {
        return `£${priceStr}`;
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
    const price = escapeHtml(formatPrice(item.price_display || item.price));
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

    return `
      <div class="carousel-item">
        <a href="/package?slug=${encodeURIComponent(slug)}" class="featured-package-card">
          <img src="${image}" alt="${title}" loading="lazy"
               onerror="this.onerror=null;this.src='/assets/images/placeholders/package-event.svg';">
          <div class="package-info">
            <h3>${title}</h3>
            ${supplierName ? `<p class="package-supplier">${supplierName}</p>` : ''}
            <p class="package-description">${description}</p>
            <div class="package-price">${price}</div>
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

  _updateControls() {
    if (this.prevButton) {
      this.prevButton.disabled = this.currentIndex <= 0;
    }
    if (this.nextButton) {
      this.nextButton.disabled = this.currentIndex >= this.itemElements.length - 1;
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

    this.autoScrollTimer = setInterval(() => {
      if (this.currentIndex >= this.itemElements.length - 1) {
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
window.Carousel = Carousel;
