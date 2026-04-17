/**
 * Lightbox Component
 * Displays images in a fullscreen overlay with navigation
 */

class Lightbox {
  constructor(options = {}) {
    this.options = {
      closeOnBackdropClick: true,
      showNavigation: true,
      showCounter: true,
      enableKeyboard: true,
      animationDuration: 300,
      ...options,
    };

    this.images = [];
    this.currentIndex = 0;
    this.isOpen = false;
    this.lightboxElement = null;

    this.init();
  }

  init() {
    this.injectStyles();
    this.createLightbox();
    this.setupEventListeners();
  }

  injectStyles() {
    if (document.getElementById('lightbox-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'lightbox-styles';
    style.textContent = `
      .lightbox {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.95);
        z-index: 10000;
        display: none;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .lightbox.is-open {
        display: flex;
        opacity: 1;
      }

      .lightbox-content {
        position: relative;
        max-width: 90vw;
        max-height: 90vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .lightbox-image {
        max-width: 100%;
        max-height: 90vh;
        object-fit: contain;
        transform: scale(0.95);
        transition: transform 0.3s ease;
      }

      .lightbox.is-open .lightbox-image {
        transform: scale(1);
      }

      .lightbox-close {
        position: absolute;
        top: 20px;
        right: 20px;
        width: 44px;
        height: 44px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 50%;
        color: white;
        font-size: 24px;
        line-height: 1;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s ease;
        z-index: 10001;
      }

      .lightbox-close:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      .lightbox-nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 44px;
        height: 44px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 50%;
        color: white;
        font-size: 24px;
        line-height: 1;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s ease;
        z-index: 10001;
      }

      .lightbox-nav:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      .lightbox-nav.lightbox-prev {
        left: 20px;
      }

      .lightbox-nav.lightbox-next {
        right: 20px;
      }

      .lightbox-nav:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }

      .lightbox-counter {
        position: absolute;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        color: white;
        background: rgba(0, 0, 0, 0.5);
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 14px;
        z-index: 10001;
      }

      .lightbox-loader {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 40px;
        height: 40px;
        border: 3px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: lightbox-spin 0.8s linear infinite;
      }

      @keyframes lightbox-spin {
        to { transform: translate(-50%, -50%) rotate(360deg); }
      }

      @media (max-width: 640px) {
        .lightbox-nav {
          width: 40px;
          height: 40px;
          font-size: 20px;
        }

        .lightbox-close {
          width: 40px;
          height: 40px;
          font-size: 20px;
        }

        .lightbox-nav.lightbox-prev {
          left: 10px;
        }

        .lightbox-nav.lightbox-next {
          right: 10px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  createLightbox() {
    this.lightboxElement = document.createElement('div');
    this.lightboxElement.className = 'lightbox';
    this.lightboxElement.setAttribute('role', 'dialog');
    this.lightboxElement.setAttribute('aria-modal', 'true');
    this.lightboxElement.setAttribute('aria-label', 'Image lightbox');

    this.lightboxElement.innerHTML = `
      <button class="ef-cta lightbox-close" aria-label="Close lightbox">×</button>
      <div class="lightbox-content">
        <div class="lightbox-loader"></div>
        <img class="lightbox-image" src="" alt="" style="display:none;">
      </div>
      ${
        this.options.showNavigation
          ? `
        <button class="ef-cta lightbox-nav lightbox-prev" aria-label="Previous image">‹</button>
        <button class="ef-cta lightbox-nav lightbox-next" aria-label="Next image">›</button>
      `
          : ''
      }
      ${this.options.showCounter ? '<div class="lightbox-counter"></div>' : ''}
    `;

    document.body.appendChild(this.lightboxElement);
  }

  setupEventListeners() {
    // Close button
    const closeButton = this.lightboxElement.querySelector('.lightbox-close');
    closeButton.addEventListener('click', () => this.close());

    // Navigation buttons
    if (this.options.showNavigation) {
      const prevButton = this.lightboxElement.querySelector('.lightbox-prev');
      const nextButton = this.lightboxElement.querySelector('.lightbox-next');

      prevButton.addEventListener('click', () => this.prev());
      nextButton.addEventListener('click', () => this.next());
    }

    // Backdrop click
    if (this.options.closeOnBackdropClick) {
      this.lightboxElement.addEventListener('click', e => {
        if (e.target === this.lightboxElement) {
          this.close();
        }
      });
    }

    // Keyboard navigation
    if (this.options.enableKeyboard) {
      document.addEventListener('keydown', e => {
        if (!this.isOpen) {
          return;
        }

        switch (e.key) {
          case 'Escape':
            this.close();
            break;
          case 'ArrowLeft':
            this.prev();
            break;
          case 'ArrowRight':
            this.next();
            break;
        }
      });
    }

    // Image load event
    const img = this.lightboxElement.querySelector('.lightbox-image');
    img.addEventListener('load', () => {
      this.hideLoader();
      img.style.display = 'block';
    });

    img.addEventListener('error', () => {
      this.hideLoader();
      this.close();
    });
  }

  /**
   * Open lightbox with images
   * @param {Array|string} images - Array of image URLs or single URL
   * @param {number} startIndex - Index to start at
   */
  open(images, startIndex = 0) {
    // Convert single image to array
    this.images = Array.isArray(images) ? images : [images];
    this.currentIndex = startIndex;
    this.isOpen = true;

    // Show lightbox
    this.lightboxElement.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    // Load first image
    this.loadImage(this.currentIndex);

    // Update navigation
    this.updateNavigation();

    // Trap focus
    if (window.keyboardNav) {
      window.keyboardNav.trapFocus(this.lightboxElement);
    }
  }

  /**
   * Close lightbox
   */
  close() {
    this.isOpen = false;
    this.lightboxElement.classList.remove('is-open');
    document.body.style.overflow = '';

    // Release focus trap
    if (window.keyboardNav) {
      window.keyboardNav.releaseFocusTrap(this.lightboxElement);
    }

    // Clear image after animation
    setTimeout(() => {
      const img = this.lightboxElement.querySelector('.lightbox-image');
      img.src = '';
      img.style.display = 'none';
    }, this.options.animationDuration);
  }

  /**
   * Show previous image
   */
  prev() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.loadImage(this.currentIndex);
      this.updateNavigation();
    }
  }

  /**
   * Show next image
   */
  next() {
    if (this.currentIndex < this.images.length - 1) {
      this.currentIndex++;
      this.loadImage(this.currentIndex);
      this.updateNavigation();
    }
  }

  /**
   * Load image at index
   * @param {number} index - Image index
   */
  loadImage(index) {
    const img = this.lightboxElement.querySelector('.lightbox-image');
    const imageUrl = this.images[index];

    // Show loader
    this.showLoader();
    img.style.display = 'none';

    // Load image
    img.src = imageUrl;
    img.alt = `Image ${index + 1} of ${this.images.length}`;

    // Update counter
    this.updateCounter();
  }

  /**
   * Update navigation buttons state
   */
  updateNavigation() {
    if (!this.options.showNavigation) {
      return;
    }

    const prevButton = this.lightboxElement.querySelector('.lightbox-prev');
    const nextButton = this.lightboxElement.querySelector('.lightbox-next');

    prevButton.disabled = this.currentIndex === 0;
    nextButton.disabled = this.currentIndex === this.images.length - 1;
  }

  /**
   * Update image counter
   */
  updateCounter() {
    if (!this.options.showCounter) {
      return;
    }

    const counter = this.lightboxElement.querySelector('.lightbox-counter');
    counter.textContent = `${this.currentIndex + 1} / ${this.images.length}`;
  }

  /**
   * Show loader
   */
  showLoader() {
    const loader = this.lightboxElement.querySelector('.lightbox-loader');
    loader.style.display = 'block';
  }

  /**
   * Hide loader
   */
  hideLoader() {
    const loader = this.lightboxElement.querySelector('.lightbox-loader');
    loader.style.display = 'none';
  }

  /**
   * Destroy lightbox
   */
  destroy() {
    if (this.lightboxElement) {
      this.lightboxElement.remove();
    }
  }
}

/**
 * Auto-initialize lightbox for images with data-lightbox attribute
 */
document.addEventListener('DOMContentLoaded', () => {
  const lightbox = new Lightbox();

  // Find all images with data-lightbox attribute
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-lightbox]');
    if (!target) {
      return;
    }

    e.preventDefault();

    // Get all images in the same gallery
    const gallery = target.dataset.lightbox;
    const images = Array.from(document.querySelectorAll(`[data-lightbox="${gallery}"]`)).map(
      img => img.href || img.src || img.dataset.src
    );

    // Get index of clicked image
    const index = images.indexOf(target.href || target.src || target.dataset.src);

    // Open lightbox
    lightbox.open(images, index);
  });

  // Make lightbox globally available
  window.lightbox = lightbox;
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Lightbox;
}
