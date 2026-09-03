/**
 * P3-08: Image Carousel/Lightbox
 * Simple, accessible image carousel for galleries
 */

'use strict';
(function () {
  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  let currentIndex = 0;
  let images = [];
  let carousel = null;
  let lastFocused = null;
  let imageLoadToken = 0;

  /**
   * Initialize image carousel on gallery images
   */
  function initCarousel() {
    const galleryImages = document.querySelectorAll('.gallery-image, .supplier-photo, .photo-item');

    if (galleryImages.length === 0) {
      return;
    }

    // Store images data, deduplicating by src so the thumbnail strip never
    // shows the same image twice (e.g. a featured image that also appears in
    // the gallery grid).
    const seenSrcs = new Map(); // src → index in deduplicated images array
    images = [];
    Array.from(galleryImages).forEach(img => {
      const src = img.dataset.fullsize || img.src;
      if (!seenSrcs.has(src)) {
        const idx = images.length;
        seenSrcs.set(src, idx);
        // Prefer a dedicated thumbnail URL (data-thumb) if available.
        // Fall back to the display src (which is often already a smaller size)
        // rather than the full-size URL so thumbnails load quickly.
        const thumb = img.dataset.thumb || img.src;
        images.push({
          src,
          thumb,
          alt: img.alt || `Image ${idx + 1}`,
          caption: img.dataset.caption || img.title || '',
        });
      }
    });

    // Add click handlers to images — map each element to its deduplicated index
    galleryImages.forEach(img => {
      const src = img.dataset.fullsize || img.src;
      const dedupedIndex = seenSrcs.get(src) ?? 0;
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => openCarousel(dedupedIndex));
    });

    createCarouselModal();
    if (isDevelopment) {
      console.log(`✓ Image carousel initialized with ${images.length} images`);
    }
  }

  /**
   * Create carousel modal structure
   */
  function createCarouselModal() {
    if (document.getElementById('image-carousel-modal')) {
      return;
    }

    const modal = document.createElement('div');
    modal.id = 'image-carousel-modal';
    modal.className = 'image-carousel-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Image carousel');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('tabindex', '-1');
    modal.setAttribute('aria-hidden', 'true');
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="carousel-overlay" role="button" tabindex="0" aria-label="Close carousel"></div>
      <div class="carousel-content">
        <button 
          type="button"
          class="carousel-close" 
          aria-label="Close carousel"
        >
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        
        <button 
          type="button"
          class="carousel-nav carousel-prev" 
          aria-label="Previous image"
        >
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>

        <div 
          class="carousel-side-preview carousel-side-preview--prev" 
          id="carousel-prev-preview" 
          aria-hidden="true"
        >
          <img src="" alt="" class="carousel-side-preview__img" />
        </div>
        
        <div class="carousel-image-container">
          <img 
            id="carousel-image" 
            src="" 
            alt="" 
            class="carousel-image"
          />
          <div id="carousel-caption" class="carousel-caption"></div>
        </div>

        <div 
          class="carousel-side-preview carousel-side-preview--next" 
          id="carousel-next-preview" 
          aria-hidden="true"
        >
          <img src="" alt="" class="carousel-side-preview__img" />
        </div>
        
        <button 
          type="button"
          class="carousel-nav carousel-next" 
          aria-label="Next image"
        >
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
        
        <div class="carousel-counter" id="carousel-counter">
          <div class="carousel-dots" id="carousel-dots" role="tablist" aria-label="Image navigation"></div>
          <div class="carousel-divider" aria-hidden="true"></div>
          <span aria-live="polite"><span id="carousel-current">1</span> / <span id="carousel-total">1</span></span>
        </div>

        <div
          class="carousel-thumb-strip"
          id="carousel-thumb-strip"
          role="group"
          aria-label="Gallery thumbnails"
        ></div>
      </div>
    `;

    document.body.appendChild(modal);
    carousel = modal;

    // Add event listeners for buttons
    const overlay = modal.querySelector('.carousel-overlay');
    const closeBtn = modal.querySelector('.carousel-close');
    const prevBtn = modal.querySelector('.carousel-prev');
    const nextBtn = modal.querySelector('.carousel-next');
    const prevPreviewEl = modal.querySelector('#carousel-prev-preview');
    const nextPreviewEl = modal.querySelector('#carousel-next-preview');

    if (overlay) {
      overlay.addEventListener('click', closeCarousel);
      overlay.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          closeCarousel();
        }
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', closeCarousel);
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', prevImage);
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', nextImage);
    }
    if (prevPreviewEl) {
      prevPreviewEl.addEventListener('click', prevImage);
    }
    if (nextPreviewEl) {
      nextPreviewEl.addEventListener('click', nextImage);
    }

    modal.addEventListener('keydown', trapFocusInModal);

    // Keyboard navigation
    document.addEventListener('keydown', handleKeyboard);

    // Touch swipe navigation (mobile)
    addSwipeListeners(modal);
  }

  function trapFocusInModal(e) {
    if (!carousel || carousel.style.display === 'none' || e.key !== 'Tab') {
      return;
    }

    const focusable = Array.from(
      carousel.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => el.offsetParent !== null);

    if (!focusable.length) {
      e.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
      return;
    }

    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /**
   * Open carousel at specific index
   */
  function openCarousel(index = 0) {
    if (!carousel || images.length === 0) {
      return;
    }

    lastFocused = document.activeElement || null;
    currentIndex = index;
    rebuildDots();
    rebuildThumbStrip();
    updateCarouselImage();

    carousel.style.display = 'flex';
    carousel.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Focus the close button for keyboard navigation (more discoverable than the backdrop)
    const closeBtn = carousel.querySelector('.carousel-close');
    if (closeBtn) {
      closeBtn.focus();
    } else {
      carousel.focus();
    }
  }

  /**
   * Close carousel
   */
  function closeCarousel() {
    if (!carousel) {
      return;
    }

    carousel.style.display = 'none';
    carousel.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';

    // Return focus to the element that opened the carousel
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
      lastFocused = null;
    }
  }

  /**
   * Show next image
   */
  function nextImage() {
    if (images.length === 0) {
      return;
    }
    currentIndex = (currentIndex + 1) % images.length;
    updateCarouselImage();
  }

  /**
   * Show previous image
   */
  function prevImage() {
    if (images.length === 0) {
      return;
    }
    currentIndex = (currentIndex - 1 + images.length) % images.length;
    updateCarouselImage();
  }

  /**
   * Update carousel image display
   */
  function updateCarouselImage() {
    const img = document.getElementById('carousel-image');
    const caption = document.getElementById('carousel-caption');
    const current = document.getElementById('carousel-current');
    const total = document.getElementById('carousel-total');

    if (!img || !images[currentIndex]) {
      return;
    }

    const image = images[currentIndex];
    const loadToken = ++imageLoadToken;

    // Fade out
    img.style.opacity = '0';
    img.classList.add('is-loading');

    setTimeout(() => {
      if (loadToken !== imageLoadToken) {
        return;
      }

      img.onload = () => {
        if (loadToken !== imageLoadToken) {
          return;
        }
        img.classList.remove('is-loading');
        img.style.opacity = '1';
      };

      img.onerror = () => {
        if (loadToken !== imageLoadToken) {
          return;
        }
        img.classList.remove('is-loading');
        img.style.opacity = '1';
      };

      img.src = image.src;
      img.alt = image.alt;

      if (image.caption) {
        caption.textContent = image.caption;
        caption.style.display = 'block';
      } else {
        caption.style.display = 'none';
      }

      current.textContent = currentIndex + 1;
      total.textContent = images.length;

      // Update dot indicators
      const dotsContainer = document.getElementById('carousel-dots');
      if (dotsContainer) {
        Array.from(dotsContainer.querySelectorAll('.carousel-dot')).forEach((dot, i) => {
          const isActive = i === currentIndex;
          dot.classList.toggle('active', isActive);
          dot.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
      }

      // Update mobile thumbnail strip active state
      const strip = document.getElementById('carousel-thumb-strip');
      if (strip) {
        const thumbs = strip.querySelectorAll('.carousel-thumb-item');
        thumbs.forEach((thumb, i) => {
          const isActive = i === currentIndex;
          thumb.classList.toggle('active', isActive);
          if (isActive) {
            thumb.setAttribute('aria-current', 'true');
          } else {
            thumb.removeAttribute('aria-current');
          }
        });
        // Scroll active thumbnail into view
        const activeThumb = thumbs[currentIndex];
        if (activeThumb) {
          activeThumb.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
      }
    }, 150);

    // Update prev/next thumbnail previews immediately (no fade delay needed)
    const prevPreview = document.getElementById('carousel-prev-preview');
    const nextPreview = document.getElementById('carousel-next-preview');

    if (images.length > 1) {
      const prevIdx = (currentIndex - 1 + images.length) % images.length;
      const nextIdx = (currentIndex + 1) % images.length;

      if (prevPreview) {
        const prevImg = prevPreview.querySelector('img');
        if (prevImg) {
          prevImg.src = images[prevIdx].src;
          prevImg.alt = '';
        }
        prevPreview.classList.add('visible');
      }
      if (nextPreview) {
        const nextImg = nextPreview.querySelector('img');
        if (nextImg) {
          nextImg.src = images[nextIdx].src;
          nextImg.alt = '';
        }
        nextPreview.classList.add('visible');
      }
    } else {
      if (prevPreview) {
        prevPreview.classList.remove('visible');
      }
      if (nextPreview) {
        nextPreview.classList.remove('visible');
      }
    }

    // Update navigation buttons visibility
    const prevBtn = carousel.querySelector('.carousel-prev');
    const nextBtn = carousel.querySelector('.carousel-next');

    if (images.length <= 1) {
      prevBtn.style.display = 'none';
      nextBtn.style.display = 'none';
    } else {
      prevBtn.style.display = 'flex';
      nextBtn.style.display = 'flex';
    }
  }

  /**
   * Rebuild dot indicators whenever the images array changes.
   * Shows dots for 2–10 images; hides them otherwise.
   */
  const MAX_DOTS = 10;

  function rebuildDots() {
    const dotsContainer = document.getElementById('carousel-dots');
    const divider = carousel ? carousel.querySelector('.carousel-divider') : null;
    if (!dotsContainer) {
      return;
    }

    dotsContainer.innerHTML = '';

    const showDots = images.length >= 2 && images.length <= MAX_DOTS;
    dotsContainer.style.display = showDots ? 'flex' : 'none';
    if (divider) {
      divider.style.display = showDots ? 'block' : 'none';
    }

    if (!showDots) {
      return;
    }

    images.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `carousel-dot${i === currentIndex ? ' active' : ''}`;
      dot.setAttribute('role', 'tab');
      dot.setAttribute('aria-label', `Go to image ${i + 1} of ${images.length}`);
      dot.setAttribute('aria-selected', i === currentIndex ? 'true' : 'false');
      dot.addEventListener('click', e => {
        e.stopPropagation();
        currentIndex = i;
        updateCarouselImage();
      });
      dotsContainer.appendChild(dot);
    });
  }

  /**
   * Add touch-swipe navigation to an element (for mobile).
   * Horizontal swipe left → next image; swipe right → prev image.
   * Ignores mostly-vertical swipes so normal page scroll still works.
   */
  function addSwipeListeners(el) {
    let touchStartX = 0;
    let touchStartY = 0;

    el.addEventListener(
      'touchstart',
      e => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      },
      { passive: true }
    );

    el.addEventListener(
      'touchend',
      e => {
        if (!e.changedTouches.length) {
          return;
        }
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;

        // Only treat as horizontal swipe when horizontal movement dominates
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) {
          return;
        }

        if (dx < 0) {
          nextImage();
        } else {
          prevImage();
        }
      },
      { passive: true }
    );
  }

  /**
   * Rebuild the mobile bottom thumbnail strip.
   * Visible only on small screens (CSS controls display: none / flex).
   */
  function rebuildThumbStrip() {
    const strip = document.getElementById('carousel-thumb-strip');
    if (!strip) {
      return;
    }

    strip.innerHTML = '';

    const hasMultiple = images.length > 1;
    // Hide the strip element when there's only one image so it doesn't occupy
    // space at the bottom of the modal on mobile. The parent content container
    // gains the carousel-content--no-strip class so the counter and image
    // max-height rules can be recalculated via CSS.
    strip.style.display = hasMultiple ? '' : 'none';
    const content = strip.closest('.carousel-content');
    if (content) {
      content.classList.toggle('carousel-content--no-strip', !hasMultiple);
    }

    if (!hasMultiple) {
      return;
    }

    images.forEach((image, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = i === currentIndex;
      btn.className = `carousel-thumb-item${isActive ? ' active' : ''}`;
      btn.setAttribute('aria-label', `Go to image ${i + 1} of ${images.length}`);
      if (isActive) {
        btn.setAttribute('aria-current', 'true');
      }

      const img = document.createElement('img');
      img.src = image.thumb || image.src;
      img.alt = '';
      img.loading = 'lazy';
      // Match the CSS display dimensions so the browser can reserve layout space
      // and avoid cumulative layout shift. The full-size image will still be
      // downloaded and scaled down via object-fit: cover in CSS.
      img.width = 56;
      img.height = 56;

      btn.appendChild(img);
      btn.addEventListener('click', e => {
        e.stopPropagation();
        currentIndex = i;
        updateCarouselImage();
      });

      strip.appendChild(btn);
    });
  }

  /**
   * Handle keyboard navigation
   */
  function handleKeyboard(e) {
    if (!carousel || carousel.style.display === 'none') {
      return;
    }

    switch (e.key) {
      case 'Escape':
        closeCarousel();
        break;
      case 'ArrowLeft':
        prevImage();
        break;
      case 'ArrowRight':
        nextImage();
        break;
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCarousel);
  } else {
    initCarousel();
  }

  /**
   * Open carousel with an explicit array of photo URLs.
   * This bypasses DOM scanning and works for any gallery whose images
   * are not covered by the default selector (.gallery-image etc.).
   * @param {string[]} photoUrls - Array of image URLs
   * @param {number} [startIndex=0] - Index to open at
   * @param {string} [supplierName=''] - Optional name used in alt text
   */
  function openWithImages(photoUrls, startIndex, supplierName) {
    if (!Array.isArray(photoUrls) || photoUrls.length === 0) {
      return;
    }

    const name = supplierName || '';

    // Dedupe URLs by value while preserving order so the thumbnail strip never
    // shows the same photo twice when the source array contains duplicates.
    const seenUrls = new Set();
    const deduped = [];
    photoUrls.forEach(url => {
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        deduped.push(url);
      }
    });

    images = deduped.map((url, i) => ({
      src: url,
      thumb: url,
      alt: name ? `${name} — photo ${i + 1}` : `photo ${i + 1}`,
      caption: '',
    }));

    // Map the original startIndex into the deduplicated array so the carousel
    // still opens on the photo the user tapped.
    // Edge cases handled:
    //   - rawStart out of bounds (> photoUrls.length): falls back to deduped[0]
    //   - targetUrl always exists in deduped because either it came from photoUrls
    //     (guaranteed to be in deduped) or it IS deduped[0], so indexOf returns ≥ 0;
    //     Math.max(0, …) is a defensive guard for future callers.
    const rawStart = typeof startIndex === 'number' ? startIndex : 0;
    const targetUrl = photoUrls[rawStart] || deduped[0];
    const adjustedIndex = Math.max(0, deduped.indexOf(targetUrl));

    createCarouselModal();
    openCarousel(adjustedIndex);
  }

  // Export public API
  if (typeof window !== 'undefined') {
    window.ImageCarousel = {
      init: initCarousel,
      open: openCarousel,
      openWithImages: openWithImages,
      close: closeCarousel,
      next: nextImage,
      prev: prevImage,
    };
  }
})();
