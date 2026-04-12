/**
 * P3-08: Image Carousel/Lightbox
 * Simple, accessible image carousel for galleries
 */

(function () {
  'use strict';

  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  let currentIndex = 0;
  let images = [];
  let carousel = null;
  let lastFocused = null;

  /**
   * Initialize image carousel on gallery images
   */
  function initCarousel() {
    const galleryImages = document.querySelectorAll('.gallery-image, .supplier-photo, .photo-item');

    if (galleryImages.length === 0) {
      return;
    }

    // Store images data
    images = Array.from(galleryImages).map((img, index) => ({
      src: img.dataset.fullsize || img.src,
      alt: img.alt || `Image ${index + 1}`,
      caption: img.dataset.caption || img.title || '',
    }));

    // Add click handlers to images
    galleryImages.forEach((img, index) => {
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => openCarousel(index));
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
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="carousel-overlay" role="button" tabindex="0" aria-label="Close carousel"></div>
      <div class="carousel-content">
        <button 
          type="button"
          class="carousel-close" 
          aria-label="Close carousel"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
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
        
        <div class="carousel-image-container">
          <img 
            id="carousel-image" 
            src="" 
            alt="" 
            class="carousel-image"
          />
          <div id="carousel-caption" class="carousel-caption"></div>
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
        
        <div class="carousel-counter" id="carousel-counter" aria-live="polite">
          <span id="carousel-current">1</span> / <span id="carousel-total">1</span>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    carousel = modal;

    // Add event listeners for buttons
    const overlay = modal.querySelector('.carousel-overlay');
    const closeBtn = modal.querySelector('.carousel-close');
    const prevBtn = modal.querySelector('.carousel-prev');
    const nextBtn = modal.querySelector('.carousel-next');

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

    // Keyboard navigation
    document.addEventListener('keydown', handleKeyboard);
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

    // Fade out
    img.style.opacity = '0';

    setTimeout(() => {
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

      // Fade in
      img.style.opacity = '1';
    }, 150);

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
    images = photoUrls.map((url, i) => ({
      src: url,
      alt: name ? `${name} — photo ${i + 1}` : `photo ${i + 1}`,
      caption: '',
    }));

    createCarouselModal();
    openCarousel(typeof startIndex === 'number' ? startIndex : 0);
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
