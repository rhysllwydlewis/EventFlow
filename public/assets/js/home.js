/**
 * EventFlow Homepage JavaScript
 * Testimonials carousel functionality and other homepage-specific interactions
 */

'use strict';
(function () {
  function loadMobileSignupCta() {
    if (!document.getElementById('ef-home-mobile-signup-css')) {
      const stylesheet = document.createElement('link');
      stylesheet.id = 'ef-home-mobile-signup-css';
      stylesheet.rel = 'stylesheet';
      stylesheet.href = '/assets/css/home-mobile-signup.css?v=1.2.0';
      document.head.appendChild(stylesheet);
    }

    if (document.querySelector('script[data-ef-home-mobile-signup]')) {
      return;
    }

    const script = document.createElement('script');
    script.src = '/assets/js/components/home-mobile-signup.js?v=1.2.0';
    script.async = true;
    script.dataset.efHomeMobileSignup = 'true';
    document.head.appendChild(script);
  }

  loadMobileSignupCta();

  // ========================================
  // HERO VIDEO FALLBACK
  // Hide video container if no source is provided
  // ========================================

  // Check if running in development environment (constant as environment doesn't change at runtime)
  const IS_DEVELOPMENT =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '::1' ||
    window.location.hostname.endsWith('.local');

  function initHeroVideo() {
    const videoElement = document.getElementById('hero-pexels-video');
    const videoSource = document.getElementById('hero-video-source');
    const videoContainer = videoElement?.closest('.hero-video-card');

    if (videoElement && videoSource && videoContainer) {
      // Check if video has a valid source
      const src = videoSource.getAttribute('src');
      if (!src || src.trim() === '') {
        // Source is empty on initial load — home-init.js will populate it asynchronously
        // once it fetches from the Pexels API. Do NOT hide the container here; instead mark
        // it with a data attribute so home-init.js can detect a double-init scenario.
        videoContainer.dataset.awaitingSource = 'true';
        if (IS_DEVELOPMENT) {
          console.info('Hero video: source not yet available, waiting for home-init.js');
        }
      } else {
        // Valid source already present (e.g. SSR or cached src), ensure container is visible
        videoContainer.style.display = 'block';
        delete videoContainer.dataset.awaitingSource;
      }
    }
  }

  // ========================================
  // NEWSLETTER FORM FEEDBACK
  // Note: Form submission handling is expected to be implemented
  // in a separate newsletter handler that will populate the
  // #newsletter-feedback element with success/error messages
  // ========================================

  // ========================================
  // MARKETPLACE SKELETON LOADING
  // Note: When marketplace content finishes loading, the loading script
  // should add the 'loaded' class to .ef-marketplace-skeleton to hide it:
  // document.querySelector('.ef-marketplace-skeleton')?.classList.add('loaded');
  // ========================================

  // ========================================
  // TESTIMONIALS CAROUSEL
  // ========================================

  let currentTestimonial = 0;
  let carouselInterval = null;

  function initTestimonialsCarousel() {
    // Re-query elements each time so dynamic API content is picked up
    const testimonials = document.querySelectorAll('.ef-testimonial');
    const dots = document.querySelectorAll('.ef-testimonial-dot');

    if (testimonials.length === 0 || dots.length === 0) {
      return;
    }

    // Stop any existing auto-rotation before re-wiring
    if (carouselInterval) {
      clearInterval(carouselInterval);
      carouselInterval = null;
    }
    currentTestimonial = 0;

    function showTestimonial(index) {
      testimonials.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-hidden', 'true');
      });

      dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === index);
        dot.setAttribute('aria-selected', i === index ? 'true' : 'false');
      });

      testimonials[index].classList.add('active');
      testimonials[index].setAttribute('aria-hidden', 'false');
      currentTestimonial = index;
    }

    // Dot click handlers (re-attach to new dot elements)
    dots.forEach((dot, index) => {
      dot.addEventListener('click', () => {
        showTestimonial(index);
        if (carouselInterval) {
          clearInterval(carouselInterval);
        }
        startAutoRotation();
      });
    });

    function startAutoRotation() {
      carouselInterval = setInterval(() => {
        currentTestimonial = (currentTestimonial + 1) % testimonials.length;
        showTestimonial(currentTestimonial);
      }, 5000);
    }

    startAutoRotation();

    // Pause rotation when section is not visible (Intersection Observer)
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting && carouselInterval) {
              clearInterval(carouselInterval);
              carouselInterval = null;
            } else if (entry.isIntersecting && !carouselInterval) {
              startAutoRotation();
            }
          });
        },
        { threshold: 0.5 }
      );

      const section = document.querySelector('.ef-testimonials-section');
      if (section) {
        observer.observe(section);
      }
    }
  }

  // Initial carousel setup using static HTML testimonials
  initTestimonialsCarousel();

  // Re-initialise if home-init.js replaces the carousel content with API data
  document.addEventListener('testimonialsUpdated', () => {
    initTestimonialsCarousel();
  });

  // ========================================
  // INITIALIZE ON DOM READY
  // ========================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHeroVideo);
  } else {
    initHeroVideo();
  }
})();
