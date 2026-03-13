/**
 * PackageGallery Component
 * Image gallery carousel for package detail pages
 */

// Constants
const PLACEHOLDER_IMAGE = '/assets/images/placeholders/package-event.svg';

// Swipe gesture thresholds
const SWIPE_AXIS_LOCK_PX = 8; // horizontal movement (px) before scroll is suppressed
const SWIPE_DISTANCE_PX = 40; // minimum swipe distance to trigger navigation
const SWIPE_HORIZONTAL_BIAS = 1.5; // horizontal-to-vertical ratio required for swipe intent

class PackageGallery {
  constructor(containerId, images = []) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.warn(`PackageGallery: Container ${containerId} not found`);
      return;
    }
    this.images = images;
    this.currentIndex = 0;
    this.injectStyles();
    this.render();
  }

  injectStyles() {
    if (document.getElementById('package-gallery-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'package-gallery-styles';
    style.textContent = `
      .package-gallery {
        position: relative;
        width: 100%;
      }

      .package-gallery-main {
        position: relative;
        width: 100%;
        aspect-ratio: 4 / 3;
        min-height: 240px;
        border-radius: 12px;
        overflow: hidden;
        background-color: #f8f9fa;
        display: flex;
        align-items: center;
        justify-content: center;
        /* Prevent text selection during swipe */
        user-select: none;
        -webkit-user-select: none;
      }

      .package-gallery-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: none;
        animation: fadeIn 0.3s ease-in;
        background-color: #e5e7eb;
        transition: opacity 0.3s ease-in-out;
        /* Allow touch events to reach the swipe handler */
        pointer-events: none;
      }

      .package-gallery-image.active {
        display: block;
      }

      .package-gallery-image[aria-busy="true"] {
        opacity: 0.5;
      }

      .package-gallery-image:not([src]), .package-gallery-image[src=""] {
        background: #e5e7eb url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="%23999" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>') center center no-repeat;
      }

      /* ── Nav arrows: edge-flush tabs, visible against any image ── */
      .package-gallery-nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        /* Dark pill flush to the edge with a white inner shadow for contrast on light images */
        background-color: rgba(0, 0, 0, 0.55);
        color: #fff;
        border: none;
        /* Inner white border so the button is legible on both dark and light photos */
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
        padding: 0;
        cursor: pointer;
        font-size: 20px;
        font-weight: 700;
        width: 32px;
        margin-top: 0;
        height: 56px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.18s ease, width 0.18s ease;
        z-index: 2;
        flex-shrink: 0;
      }

      .package-gallery-nav:hover,
      .package-gallery-nav:focus-visible {
        background-color: rgba(0, 0, 0, 0.72);
        width: 38px;
        outline: none;
      }

      .package-gallery-nav.prev {
        left: 0;
        border-radius: 0 8px 8px 0;
      }

      .package-gallery-nav.next {
        right: 0;
        border-radius: 8px 0 0 8px;
      }

      /* Fade arrows during swipe gesture */
      .package-gallery-main.swiping .package-gallery-nav {
        opacity: 0.3;
        pointer-events: none;
      }

      .package-gallery-counter {
        position: absolute;
        bottom: 12px;
        left: 50%;
        transform: translateX(-50%);
        background-color: rgba(0, 0, 0, 0.55);
        color: white;
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 0.8rem;
        font-weight: 600;
        z-index: 2;
        pointer-events: none;
        white-space: nowrap;
      }

      .package-gallery-thumbnails {
        display: flex;
        gap: 10px;
        margin-top: 12px;
        overflow-x: auto;
        padding: 4px 2px 8px;
        scrollbar-width: thin;
        scrollbar-color: #d1d5db transparent;
      }
      .package-gallery-thumbnails::-webkit-scrollbar {
        height: 4px;
      }
      .package-gallery-thumbnails::-webkit-scrollbar-thumb {
        background: #d1d5db;
        border-radius: 4px;
      }

      .package-gallery-thumbnail {
        width: 100px;
        height: 70px;
        object-fit: cover;
        border-radius: 8px;
        cursor: pointer;
        border: 2px solid transparent;
        transition: border-color 0.2s ease, opacity 0.2s ease, transform 0.15s ease;
        flex-shrink: 0;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
      }

      .package-gallery-thumbnail:hover {
        opacity: 0.85;
        transform: translateY(-2px);
      }

      .package-gallery-thumbnail.active {
        border-color: var(--accent, #13B6A2);
      }

      .package-gallery-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        aspect-ratio: 4 / 3;
        min-height: 240px;
        background: linear-gradient(135deg, #f0fdf9 0%, #e6f7f5 100%);
        border-radius: 12px;
        border: 2px dashed #a7f3e4;
        color: var(--color-text-secondary, #6c757d);
        font-size: 1rem;
      }
      .package-gallery-empty-icon {
        font-size: 2.5rem;
        opacity: 0.45;
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      /* ── Desktop: landscape widescreen ratio, capped height ── */
      @media (min-width: 768px) {
        .package-gallery-main,
        .package-gallery-empty {
          aspect-ratio: 16 / 9;
          max-height: 460px;
        }
      }

      /* ── Mobile: taller aspect ratio, smaller thumbnails ── */
      @media (max-width: 767px) {
        .package-gallery-main,
        .package-gallery-empty {
          aspect-ratio: 4 / 3;
          min-height: 200px;
          border-radius: 10px;
        }

        /* Arrows: slightly narrower on mobile but still clearly tappable */
        .package-gallery-nav {
          width: 30px;
          height: 52px;
          font-size: 18px;
        }
        .package-gallery-nav:hover,
        .package-gallery-nav:focus-visible {
          width: 34px;
        }

        .package-gallery-counter {
          font-size: 0.75rem;
          padding: 3px 10px;
          bottom: 10px;
        }

        .package-gallery-thumbnail {
          width: 72px;
          height: 52px;
          border-radius: 6px;
        }

        .package-gallery-thumbnails {
          gap: 8px;
          margin-top: 8px;
        }
      }

      /* ── Very small screens ── */
      @media (max-width: 380px) {
        .package-gallery-thumbnail {
          width: 60px;
          height: 44px;
        }
      }

      /* ── Reset global touch-target min-width for gallery arrows ──
         ui-ux-fixes.css @media (pointer: coarse) sets button { min-width: 44px }
         with specificity (0,0,1). Our class selector (0,1,0) wins cleanly. */
      .package-gallery-nav {
        min-width: 0;
        min-height: 0;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Validate and sanitize image URL
   * Replace blocked sources (unsplash, etc.) with placeholder
   */
  sanitizeImageUrl(url) {
    if (!url || typeof url !== 'string') {
      return PLACEHOLDER_IMAGE;
    }

    // Allow relative paths (e.g. /uploads/...) and data URLs as-is
    if (url.startsWith('/') || url.startsWith('data:')) {
      return url;
    }

    // Check if URL is from a blocked or problematic source
    // Note: images.pexels.com is explicitly allowed — do NOT add it to blockedDomains
    const blockedDomains = ['source.unsplash.com', 'unsplash.com'];
    try {
      const urlObj = new URL(url);
      if (blockedDomains.some(domain => urlObj.hostname.includes(domain))) {
        console.warn(`Image from blocked domain ${urlObj.hostname}, using placeholder`);
        return PLACEHOLDER_IMAGE;
      }
    } catch (e) {
      // Unrecognized URL format — use placeholder
      console.warn(`Invalid image URL: ${url}, using placeholder`);
      return PLACEHOLDER_IMAGE;
    }

    return url;
  }

  render() {
    if (!this.images || this.images.length === 0) {
      this.container.innerHTML = `
        <div class="package-gallery-empty" role="img" aria-label="No images available">
          <span class="package-gallery-empty-icon" aria-hidden="true">🖼️</span>
          <span>No images available</span>
        </div>
      `;
      return;
    }

    const gallery = document.createElement('div');
    gallery.className = 'package-gallery';

    // Main image container
    const mainContainer = document.createElement('div');
    mainContainer.className = 'package-gallery-main';

    // Add all images
    this.images.forEach((img, index) => {
      const image = document.createElement('img');
      image.className = 'package-gallery-image';
      if (index === 0) {
        image.classList.add('active');
      }

      // Sanitize the image URL before setting src
      // Support multiple property names used by different API versions
      const originalUrl =
        typeof img === 'string' ? img : img.url || img.src || img.path || img.image || '';
      const sanitizedUrl = this.sanitizeImageUrl(originalUrl);
      image.src = sanitizedUrl;
      image.alt =
        typeof img === 'object' && img.alt
          ? img.alt
          : `Gallery image ${index + 1} of ${this.images.length}`;
      image.loading = 'lazy'; // Enable native lazy loading

      // Add loading state
      image.addEventListener('loadstart', () => {
        image.style.opacity = '0.5';
        image.setAttribute('aria-busy', 'true');
      });

      image.addEventListener('load', () => {
        image.style.opacity = '1';
        image.removeAttribute('aria-busy');
      });

      // Add error handling for image loading
      image.onerror = () => {
        console.warn(`Failed to load gallery image: ${image.src}`);
        // Guard against infinite loop: don't replace if already showing the placeholder.
        // Check includes('/placeholders/') since browsers resolve the path to an absolute URL.
        if (!image.src.includes('/placeholders/')) {
          image.src = PLACEHOLDER_IMAGE;
          image.alt = 'Image failed to load - placeholder shown';
        }
      };

      mainContainer.appendChild(image);
    });

    // Add navigation buttons if multiple images
    if (this.images.length > 1) {
      const prevBtn = document.createElement('button');
      prevBtn.className = 'package-gallery-nav prev';
      prevBtn.innerHTML = '‹';
      prevBtn.setAttribute('aria-label', 'Previous image');
      prevBtn.setAttribute('type', 'button');
      prevBtn.addEventListener('click', () => this.navigate(-1));

      const nextBtn = document.createElement('button');
      nextBtn.className = 'package-gallery-nav next';
      nextBtn.innerHTML = '›';
      nextBtn.setAttribute('aria-label', 'Next image');
      nextBtn.setAttribute('type', 'button');
      nextBtn.addEventListener('click', () => this.navigate(1));

      const counter = document.createElement('div');
      counter.className = 'package-gallery-counter';
      counter.id = 'gallery-counter';
      counter.textContent = `1 / ${this.images.length}`;

      mainContainer.appendChild(prevBtn);
      mainContainer.appendChild(nextBtn);
      mainContainer.appendChild(counter);
    }

    gallery.appendChild(mainContainer);

    // Add thumbnails if multiple images
    if (this.images.length > 1) {
      const thumbnails = document.createElement('div');
      thumbnails.className = 'package-gallery-thumbnails';

      this.images.forEach((img, index) => {
        const thumb = document.createElement('img');
        thumb.className = 'package-gallery-thumbnail';
        if (index === 0) {
          thumb.classList.add('active');
        }

        // Sanitize thumbnail URL
        // Support multiple property names used by different API versions
        const originalUrl =
          typeof img === 'string' ? img : img.url || img.src || img.path || img.image || '';
        const sanitizedUrl = this.sanitizeImageUrl(originalUrl);
        thumb.src = sanitizedUrl;
        thumb.alt = `Thumbnail ${index + 1} of ${this.images.length}`;
        thumb.setAttribute('role', 'button');
        thumb.setAttribute('tabindex', '0');
        thumb.setAttribute('aria-label', `View image ${index + 1}`);

        // Add error handling for thumbnail loading
        thumb.onerror = () => {
          console.warn(`Failed to load thumbnail: ${thumb.src}`);
          // Guard against infinite loop: browsers resolve relative paths to absolute URLs,
          // so check includes('/placeholders/') rather than endsWith with a relative path.
          if (!thumb.src.includes('/placeholders/')) {
            thumb.src = PLACEHOLDER_IMAGE;
          }
        };

        thumb.addEventListener('click', () => this.goToImage(index));
        thumb.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.goToImage(index);
          }
        });
        thumbnails.appendChild(thumb);
      });

      gallery.appendChild(thumbnails);
    }

    this.container.innerHTML = '';
    this.container.appendChild(gallery);

    // Store references for navigation
    this.galleryElement = gallery;

    // Attach touch/swipe support on the main container
    if (this.images.length > 1) {
      this._attachSwipe(mainContainer);
    }
  }

  /**
   * Attach touch-swipe handlers so users can swipe left/right on mobile.
   * A horizontal swipe of > 40px triggers navigation.
   */
  _attachSwipe(el) {
    let startX = 0;
    let startY = 0;
    let isDragging = false;

    el.addEventListener(
      'touchstart',
      e => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isDragging = true;
      },
      { passive: true }
    );

    el.addEventListener(
      'touchmove',
      e => {
        if (!isDragging) {
          return;
        }
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        // If movement is more horizontal than vertical, prevent scroll
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_AXIS_LOCK_PX) {
          e.preventDefault();
        }
      },
      { passive: false }
    );

    el.addEventListener(
      'touchend',
      e => {
        if (!isDragging) {
          return;
        }
        isDragging = false;
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        // Only trigger on predominantly horizontal swipes of > SWIPE_DISTANCE_PX
        if (
          Math.abs(dx) > SWIPE_DISTANCE_PX &&
          Math.abs(dx) > Math.abs(dy) * SWIPE_HORIZONTAL_BIAS
        ) {
          this.navigate(dx < 0 ? 1 : -1);
        }
      },
      { passive: true }
    );
  }

  navigate(direction) {
    const images = this.container.querySelectorAll('.package-gallery-image');
    const thumbnails = this.container.querySelectorAll('.package-gallery-thumbnail');

    images[this.currentIndex].classList.remove('active');
    if (thumbnails.length > 0) {
      thumbnails[this.currentIndex].classList.remove('active');
    }

    this.currentIndex = (this.currentIndex + direction + this.images.length) % this.images.length;

    images[this.currentIndex].classList.add('active');
    if (thumbnails.length > 0) {
      thumbnails[this.currentIndex].classList.add('active');
    }

    const counter = document.getElementById('gallery-counter');
    if (counter) {
      counter.textContent = `${this.currentIndex + 1} / ${this.images.length}`;
    }
  }

  goToImage(index) {
    const images = this.container.querySelectorAll('.package-gallery-image');
    const thumbnails = this.container.querySelectorAll('.package-gallery-thumbnail');

    images[this.currentIndex].classList.remove('active');
    thumbnails[this.currentIndex].classList.remove('active');

    this.currentIndex = index;

    images[this.currentIndex].classList.add('active');
    thumbnails[this.currentIndex].classList.add('active');

    const counter = document.getElementById('gallery-counter');
    if (counter) {
      counter.textContent = `${this.currentIndex + 1} / ${this.images.length}`;
    }
  }
}

// Export to window
if (typeof window !== 'undefined') {
  window.PackageGallery = PackageGallery;
}
