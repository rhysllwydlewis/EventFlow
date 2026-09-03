/**
 * Enhanced Lazy Loading and Performance Optimization
 * Implements IntersectionObserver-based lazy loading with progressive image loading
 */

'use strict';
(function () {
  // Configuration
  const CONFIG = {
    rootMargin: '50px 0px', // Start loading 50px before entering viewport
    threshold: 0.01,
    imageFadeInDuration: 300,
  };

  /**
   * Initialize lazy loading for images
   */
  function initLazyLoading() {
    // Check for IntersectionObserver support
    if (!('IntersectionObserver' in window)) {
      // Fallback: load all images immediately
      loadAllImages();
      return;
    }

    const lazyImages = document.querySelectorAll('img[loading="lazy"]');

    const imageObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            loadImage(img);
            observer.unobserve(img);
          }
        });
      },
      {
        rootMargin: CONFIG.rootMargin,
        threshold: CONFIG.threshold,
      }
    );

    lazyImages.forEach(img => {
      // Add fade-in effect (use CSS class for better performance)
      if (!img.classList.contains('lazy-image')) {
        img.classList.add('lazy-image');
        img.style.opacity = '0';
        img.style.transition = `opacity ${CONFIG.imageFadeInDuration}ms ease-in-out`;
      }
      imageObserver.observe(img);
    });
  }

  /**
   * Mark an image as loaded and make it visible
   */
  function markImageAsLoaded(img) {
    img.style.opacity = '1';
    img.dataset.loaded = 'true';
  }

  /**
   * Load a single image with fade-in effect
   */
  function loadImage(img) {
    if (img.dataset.loaded) {
      return;
    }

    const picture = img.closest('picture');

    if (picture) {
      // Load WebP sources in picture element
      const sources = picture.querySelectorAll('source');
      sources.forEach(source => {
        if (source.dataset.srcset) {
          source.srcset = source.dataset.srcset;
          source.removeAttribute('data-srcset');
        }
      });
    }

    // Set image src (will trigger load from picture element if present)
    if (img.dataset.src) {
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
    }

    // Check if image is already loaded (from cache or before script ran)
    if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      markImageAsLoaded(img);
      return;
    }

    // Fade in when loaded
    img.addEventListener(
      'load',
      () => {
        markImageAsLoaded(img);
      },
      { once: true }
    );

    // Handle load errors gracefully
    img.addEventListener(
      'error',
      () => {
        console.warn('Failed to load image:', img.src);
        markImageAsLoaded(img);
      },
      { once: true }
    );
  }

  /**
   * Fallback: Load all images immediately
   */
  function loadAllImages() {
    const images = document.querySelectorAll('img[loading="lazy"]');
    images.forEach(img => {
      img.removeAttribute('loading');
      loadImage(img);
    });
  }

  /**
   * Preload critical resources
   */
  function preloadCriticalResources() {
    // Preload fonts if not already preloaded
    const fonts = [
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap',
    ];

    fonts.forEach(fontUrl => {
      const existingPreload = document.querySelector(`link[href="${fontUrl}"]`);
      if (!existingPreload) {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'style';
        link.href = fontUrl;
        document.head.appendChild(link);

        // Load the font stylesheet
        const fontLink = document.createElement('link');
        fontLink.rel = 'stylesheet';
        fontLink.href = fontUrl;
        document.head.appendChild(fontLink);
      }
    });
  }

  /**
   * Defer non-critical CSS
   */
  function deferNonCriticalCSS() {
    const nonCriticalCSS = document.querySelectorAll('link[rel="stylesheet"][data-defer]');
    nonCriticalCSS.forEach(link => {
      link.media = 'print';
      link.onload = function () {
        this.media = 'all';
      };
    });
  }

  /**
   * Monitor performance metrics
   */
  function monitorPerformance() {
    if ('PerformanceObserver' in window) {
      try {
        // Monitor Largest Contentful Paint (LCP)
        const lcpObserver = new PerformanceObserver(entryList => {
          const entries = entryList.getEntries();
          const lastEntry = entries[entries.length - 1];
          if (
            window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1'
          ) {
            console.log('LCP:', lastEntry.renderTime || lastEntry.loadTime);
          }
        });
        lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });

        // Monitor First Input Delay (FID)
        const fidObserver = new PerformanceObserver(entryList => {
          const entries = entryList.getEntries();
          entries.forEach(entry => {
            if (
              window.location.hostname === 'localhost' ||
              window.location.hostname === '127.0.0.1'
            ) {
              console.log('FID:', entry.processingStart - entry.startTime);
            }
          });
        });
        fidObserver.observe({ entryTypes: ['first-input'] });

        // Monitor Cumulative Layout Shift (CLS)
        let clsValue = 0;
        const clsObserver = new PerformanceObserver(entryList => {
          for (const entry of entryList.getEntries()) {
            if (!entry.hadRecentInput) {
              clsValue += entry.value;
              if (
                window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1'
              ) {
                console.log('CLS:', clsValue);
              }
            }
          }
        });
        clsObserver.observe({ entryTypes: ['layout-shift'] });
      } catch (e) {
        // Warn if observer setup fails - may indicate browser compatibility issues
        console.warn('Performance monitoring not available:', e.message);
      }
    }
  }

  /**
   * Optimize third-party scripts
   */
  function optimizeThirdPartyScripts() {
    // Delay loading of non-critical third-party scripts
    const delayedScripts = document.querySelectorAll('script[data-delay]');

    if (delayedScripts.length > 0) {
      const loadDelayedScripts = () => {
        delayedScripts.forEach(script => {
          if (script.dataset.src) {
            script.src = script.dataset.src;
            delete script.dataset.src;
          }
        });
      };

      // Load after user interaction or after 3 seconds
      let loaded = false;
      const load = () => {
        if (!loaded) {
          loaded = true;
          loadDelayedScripts();
        }
      };

      ['scroll', 'mousemove', 'touchstart', 'keydown'].forEach(event => {
        window.addEventListener(event, load, { once: true, passive: true });
      });

      setTimeout(load, 3000);
    }
  }

  /**
   * Initialize all optimizations
   */
  function init() {
    // Check if we're in development environment
    const isDevelopment =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.port === '8080' || // Common dev port (string comparison)
      window.location.port === '3000';

    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        initLazyLoading();
        preloadCriticalResources();
        deferNonCriticalCSS();
        optimizeThirdPartyScripts();

        // Monitor performance only in development
        if (isDevelopment) {
          monitorPerformance();
        }
      });
    } else {
      initLazyLoading();
      preloadCriticalResources();
      deferNonCriticalCSS();
      optimizeThirdPartyScripts();

      if (isDevelopment) {
        monitorPerformance();
      }
    }
  }

  // Start optimization
  init();

  // Expose API for manual control if needed
  window.EventFlowPerformance = {
    loadImage,
    loadAllImages,
  };
})();
