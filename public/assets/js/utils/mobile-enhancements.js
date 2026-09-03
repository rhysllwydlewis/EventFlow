/**
 * Mobile Enhancements JavaScript
 * Provides mobile-specific functionality improvements
 */

'use strict';
(function () {
  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  class MobileEnhancements {
    constructor() {
      this.isMobile = this.detectMobile();
      this.isTouch = this.detectTouch();
      this.init();
    }

    init() {
      if (!this.isMobile && !this.isTouch) {
        return; // Skip on desktop
      }

      // Add mobile class to body
      document.body.classList.add('is-mobile');
      if (this.isTouch) {
        document.body.classList.add('is-touch');
      }

      // Initialize enhancements
      this.setupBurgerMenu();
      this.setupSwipeGestures();
      this.setupTouchFeedback();
      this.setupScrollImprovements();
      this.setupViewportFixes();
      this.setupFilterToggle();
      this.setupBottomSheet();
    }

    detectMobile() {
      return window.innerWidth <= 768 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    }

    detectTouch() {
      return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    }

    /**
     * Setup burger menu toggle
     */
    setupBurgerMenu() {
      const burger = document.querySelector('.nav-toggle, #burger');
      const navMenu = document.querySelector('.nav-menu');

      if (!burger || !navMenu) {
        return;
      }

      burger.addEventListener('click', () => {
        const isOpen = navMenu.classList.contains('is-open');

        if (isOpen) {
          navMenu.classList.remove('is-open');
          burger.setAttribute('aria-expanded', 'false');
          document.body.style.overflow = '';
        } else {
          navMenu.classList.add('is-open');
          burger.setAttribute('aria-expanded', 'true');
          document.body.style.overflow = 'hidden';
        }
      });

      // Close menu when clicking outside
      document.addEventListener('click', e => {
        if (!navMenu.contains(e.target) && !burger.contains(e.target)) {
          navMenu.classList.remove('is-open');
          burger.setAttribute('aria-expanded', 'false');
          document.body.style.overflow = '';
        }
      });

      // Close menu on navigation
      navMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
          navMenu.classList.remove('is-open');
          burger.setAttribute('aria-expanded', 'false');
          document.body.style.overflow = '';
        });
      });
    }

    /**
     * Setup swipe gestures for mobile
     */
    setupSwipeGestures() {
      let touchStartX = 0;
      let touchEndX = 0;

      document.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
      });

      document.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        this.handleSwipe();
      });

      this.handleSwipe = () => {
        const swipeThreshold = 50;
        const swipeDistance = touchEndX - touchStartX;

        if (Math.abs(swipeDistance) < swipeThreshold) {
          return;
        }

        if (swipeDistance > 0) {
          // Swipe right - could open menu
          this.onSwipeRight();
        } else {
          // Swipe left - could close menu
          this.onSwipeLeft();
        }
      };
    }

    onSwipeRight() {
      // Open side menu if it exists
      const sidebar = document.querySelector('.dashboard-sidebar');
      if (sidebar && !sidebar.classList.contains('is-open')) {
        sidebar.classList.add('is-open');
      }
    }

    onSwipeLeft() {
      // Close side menu if it exists
      const sidebar = document.querySelector('.dashboard-sidebar');
      if (sidebar && sidebar.classList.contains('is-open')) {
        sidebar.classList.remove('is-open');
      }

      // Close nav menu
      const navMenu = document.querySelector('.nav-menu');
      if (navMenu && navMenu.classList.contains('is-open')) {
        navMenu.classList.remove('is-open');
        const burger = document.querySelector('.nav-toggle, #burger');
        if (burger) {
          burger.setAttribute('aria-expanded', 'false');
        }
        document.body.style.overflow = '';
      }
    }

    /**
     * Add touch feedback to interactive elements
     */
    setupTouchFeedback() {
      const interactiveElements = document.querySelectorAll(
        'button, a, .card, .cta, input[type="submit"]'
      );

      interactiveElements.forEach(element => {
        element.addEventListener('touchstart', function () {
          this.style.opacity = '0.7';
        });

        element.addEventListener('touchend', function () {
          setTimeout(() => {
            this.style.opacity = '';
          }, 100);
        });

        element.addEventListener('touchcancel', function () {
          this.style.opacity = '';
        });
      });
    }

    /**
     * Improve scrolling behavior on mobile
     */
    setupScrollImprovements() {
      // Smooth scrolling for anchor links
      document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
          const target = document.querySelector(this.getAttribute('href'));
          if (target) {
            e.preventDefault();
            target.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            });
          }
        });
      });

      // Hide/show header on scroll
      let lastScrollTop = 0;
      const header = document.querySelector('.header');

      if (header) {
        window.addEventListener(
          'scroll',
          () => {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

            if (scrollTop > lastScrollTop && scrollTop > 100) {
              // Scrolling down
              header.style.transform = 'translateY(-100%)';
            } else {
              // Scrolling up
              header.style.transform = 'translateY(0)';
            }

            lastScrollTop = scrollTop;
          },
          { passive: true }
        );

        // Add transition
        header.style.transition = 'transform 0.3s ease';
      }
    }

    /**
     * Fix viewport and zoom issues
     */
    setupViewportFixes() {
      // Prevent zoom on double tap for buttons
      let lastTouchEnd = 0;
      document.addEventListener(
        'touchend',
        e => {
          const now = Date.now();
          if (now - lastTouchEnd <= 300) {
            e.preventDefault();
          }
          lastTouchEnd = now;
        },
        false
      );

      // Fix iOS Safari bottom bar issue
      const setVH = () => {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
      };

      setVH();
      window.addEventListener('resize', setVH);
      window.addEventListener('orientationchange', setVH);
    }

    /**
     * Setup filter toggle for mobile
     */
    setupFilterToggle() {
      // Create filter toggle button if filters exist
      const filters = document.querySelector('.filters, #filters, .filter-panel');
      if (!filters) {
        return;
      }

      // Check if toggle button already exists
      let filterToggle = document.querySelector('.filter-toggle');

      if (!filterToggle) {
        filterToggle = document.createElement('button');
        filterToggle.className = 'filter-toggle';
        filterToggle.innerHTML = '🔍';
        filterToggle.setAttribute('aria-label', 'Toggle filters');
        filterToggle.type = 'button';
        document.body.appendChild(filterToggle);
      }

      filterToggle.addEventListener('click', () => {
        filters.classList.toggle('is-open');

        if (filters.classList.contains('is-open')) {
          document.body.style.overflow = 'hidden';
        } else {
          document.body.style.overflow = '';
        }
      });

      // Close filters when clicking outside
      filters.addEventListener('click', e => {
        if (e.target === filters) {
          filters.classList.remove('is-open');
          document.body.style.overflow = '';
        }
      });
    }

    /**
     * Setup bottom sheet modals for mobile
     */
    setupBottomSheet() {
      const modals = document.querySelectorAll('.modal');

      modals.forEach(modal => {
        // Add mobile-specific class
        modal.classList.add('modal-bottom');

        // Allow drag to close
        let startY = 0;
        let currentY = 0;

        const modalContent = modal.querySelector('.modal-content');
        if (!modalContent) {
          return;
        }

        modalContent.addEventListener('touchstart', e => {
          startY = e.touches[0].clientY;
        });

        modalContent.addEventListener('touchmove', e => {
          currentY = e.touches[0].clientY;
          const diff = currentY - startY;

          if (diff > 0) {
            // Dragging down
            modalContent.style.transform = `translateY(${diff}px)`;
          }
        });

        modalContent.addEventListener('touchend', () => {
          const diff = currentY - startY;

          if (diff > 100) {
            // Close modal if dragged down enough
            modal.style.display = 'none';
            document.body.style.overflow = '';
          }

          // Reset position
          modalContent.style.transform = '';
        });
      });
    }

    /**
     * Add pull to refresh (optional, can be disabled)
     */
    setupPullToRefresh() {
      let startY = 0;
      let isPulling = false;

      document.addEventListener('touchstart', e => {
        if (window.scrollY === 0) {
          startY = e.touches[0].clientY;
          isPulling = true;
        }
      });

      document.addEventListener('touchmove', e => {
        if (!isPulling) {
          return;
        }

        const currentY = e.touches[0].clientY;
        const diff = currentY - startY;

        if (diff > 100) {
          // Show refresh indicator
          if (isDevelopment) {
            console.log('Pull to refresh triggered');
          }
        }
      });

      document.addEventListener('touchend', () => {
        isPulling = false;
      });
    }

    /**
     * Optimize images for mobile
     */
    optimizeImages() {
      const images = document.querySelectorAll('img');

      images.forEach(img => {
        // Add loading lazy if not already present
        if (!img.hasAttribute('loading')) {
          img.setAttribute('loading', 'lazy');
        }

        // Add proper dimensions if missing
        if (!img.hasAttribute('width') && !img.hasAttribute('height')) {
          img.style.width = '100%';
          img.style.height = 'auto';
        }
      });
    }

    /**
     * Setup orientation change handler
     */
    handleOrientationChange() {
      window.addEventListener('orientationchange', () => {
        // Close all open menus on orientation change
        document.querySelectorAll('.nav-menu.is-open, .filters.is-open').forEach(el => {
          el.classList.remove('is-open');
        });

        document.body.style.overflow = '';

        // Recalculate viewport height
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
      });
    }
  }

  // Auto-initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.mobileEnhancements = new MobileEnhancements();
    });
  } else {
    window.mobileEnhancements = new MobileEnhancements();
  }

  window.MobileEnhancements = MobileEnhancements;

  // Export for module usage
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MobileEnhancements;
  }
})();
