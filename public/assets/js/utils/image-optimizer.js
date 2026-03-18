/**
 * Image Lazy Loading and Optimization Utility
 * Provides enhanced lazy loading with placeholder, blur-up effect, and error handling
 */

class ImageOptimizer {
  constructor(options = {}) {
    this.options = {
      rootMargin: '50px',
      threshold: 0.01,
      placeholderClass: 'img-placeholder',
      loadedClass: 'img-loaded',
      errorClass: 'img-error',
      blurUpEffect: true,
      retryAttempts: 2,
      retryDelay: 1000,
      ...options,
    };

    this.observer = null;
    this.init();
  }

  init() {
    this.injectStyles();
    this.setupIntersectionObserver();
    this.observeImages();
  }

  injectStyles() {
    if (document.getElementById('image-optimizer-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'image-optimizer-styles';
    style.textContent = `
      .img-placeholder {

      @keyframes img-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      .img-loading {
        opacity: 0.5;
        filter: blur(5px);
        transition: opacity 0.5s ease-in-out, filter 0.5s ease-in-out;
      }

      .img-loaded {
        opacity: 1;
        filter: blur(0);
      }

      .img-error {

      .img-error::after {
        content: '🖼️ Image failed to load';
        position: absolute;
        text-align: center;
        color: #9ca3af;
        font-size: 14px;
        padding: 20px;
      }

      /* Responsive images */
      img[data-lazy] {
        width: 100%;
        height: auto;
      }

      /* Aspect ratio containers */
      .img-aspect-16-9 {
        aspect-ratio: 16 / 9;
        overflow: hidden;
      }

      .img-aspect-4-3 {
        aspect-ratio: 4 / 3;
        overflow: hidden;
      }

      .img-aspect-1-1 {
        aspect-ratio: 1 / 1;
        overflow: hidden;
      }

      .img-aspect-16-9 img,
      .img-aspect-4-3 img,
      .img-aspect-1-1 img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    `;
    document.head.appendChild(style);
  }

  setupIntersectionObserver() {
    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              this.loadImage(entry.target);
              this.observer.unobserve(entry.target);
            }
          });
        },
        {
          rootMargin: this.options.rootMargin,
          threshold: this.options.threshold,
        }
      );
    }
  }

  observeImages() {
    // Find all images with data-lazy attribute
    const lazyImages = document.querySelectorAll('img[data-lazy]');

    if (!this.observer) {
      // Fallback for browsers without IntersectionObserver
      lazyImages.forEach(img => this.loadImage(img));
      return;
    }

    lazyImages.forEach(img => {
      // Add placeholder class
      img.classList.add(this.options.placeholderClass);

      // Observe the image
      this.observer.observe(img);
    });
  }

  async loadImage(img, attempt = 1) {
    const src = img.dataset.lazy;
    const srcset = img.dataset.srcset;

    if (!src) {
      // Remove placeholder if no source
      img.classList.remove(this.options.placeholderClass, 'img-loading');
      return;
    }

    // Add loading class for blur-up effect
    if (this.options.blurUpEffect) {
      img.classList.add('img-loading');
    }

    try {
      // Preload the image
      await this.preloadImage(src, srcset);

      // Set the actual source
      img.src = src;
      if (srcset) {
        img.srcset = srcset;
      }

      // Remove data attributes
      delete img.dataset.lazy;
      delete img.dataset.srcset;

      // Handle load event
      img.onload = () => {
        img.classList.remove(this.options.placeholderClass, 'img-loading');
        img.classList.add(this.options.loadedClass);

        // Dispatch custom event
        img.dispatchEvent(new CustomEvent('imageloaded', { detail: { src } }));
      };

      // Handle error
      img.onerror = () => {
        if (attempt < this.options.retryAttempts) {
          // Retry loading
          setTimeout(() => {
            this.loadImage(img, attempt + 1);
          }, this.options.retryDelay * attempt);
        } else {
          this.handleImageError(img);
        }
      };
    } catch (error) {
      if (attempt < this.options.retryAttempts) {
        setTimeout(() => {
          this.loadImage(img, attempt + 1);
        }, this.options.retryDelay * attempt);
      } else {
        this.handleImageError(img);
      }
    }
  }

  preloadImage(src, srcset) {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = resolve;
      img.onerror = reject;

      if (srcset) {
        img.srcset = srcset;
      }
      img.src = src;
    });
  }

  handleImageError(img) {
    img.classList.remove(this.options.placeholderClass, 'img-loading');
    img.classList.add(this.options.errorClass);

    // Dispatch custom event
    img.dispatchEvent(new CustomEvent('imageerror', { detail: { src: img.dataset.lazy } }));

    console.error('Failed to load image:', img.dataset.lazy);
  }

  // Refresh to observe new images added to DOM
  refresh() {
    this.observeImages();
  }

  // Disconnect observer
  disconnect() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }
}

// Helper function to convert regular images to lazy loading
function convertToLazyLoading(container = document) {
  const images = container.querySelectorAll('img:not([data-lazy])');

  images.forEach(img => {
    // Skip if already loaded
    if (img.complete && img.naturalHeight !== 0) {
      return;
    }

    // Skip if no src
    if (!img.src) {
      return;
    }

    // Convert to lazy loading
    img.dataset.lazy = img.src;
    if (img.srcset) {
      img.dataset.srcset = img.srcset;
      img.removeAttribute('srcset');
    }
    img.removeAttribute('src');
  });
}

// Auto-initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.imageOptimizer = new ImageOptimizer();
  });
} else {
  window.imageOptimizer = new ImageOptimizer();
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ImageOptimizer, convertToLazyLoading };
}
