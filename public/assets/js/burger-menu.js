/**
 * Simple Burger Menu Implementation - Built from scratch
 * Minimal, focused, and reliable mobile menu toggle
 * With accessibility features: focus trap, ARIA attributes, and inert background
 */

'use strict';
(function () {
  // Debug flag - set to false to disable console logs
  const DEBUG = false;

  // Prevent double initialization
  if (window.__burgerMenuInitialized) {
    if (DEBUG) {
      console.log('🍔 Burger menu already initialized, skipping...');
    }
    return;
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBurgerMenu);
  } else {
    initBurgerMenu();
  }

  function initBurgerMenu() {
    if (DEBUG) {
      console.log('🍔 Initializing burger menu...');
    }

    // Get DOM elements
    const mobileToggle = document.getElementById('ef-mobile-toggle');
    const mobileMenu = document.getElementById('ef-mobile-menu');
    const bottomMenuBtn = document.getElementById('ef-bottom-menu');
    const mainContent = document.querySelector('main');

    if (!mobileToggle || !mobileMenu) {
      if (DEBUG) {
        console.warn('Burger menu elements not found');
      }
      return;
    }

    if (DEBUG) {
      console.log('✅ Burger menu elements found');
    }

    // Mark as initialized
    window.__burgerMenuInitialized = true;

    // State
    let isOpen = false;
    let lastFocusedElement = null;

    function updateToggleA11yState(open) {
      const label = open ? 'Close menu' : 'Open menu';
      mobileToggle.setAttribute('aria-label', label);
      mobileToggle.setAttribute('title', label);
      if (bottomMenuBtn) {
        bottomMenuBtn.setAttribute('aria-label', label);
      }
    }

    // Create backdrop element for click-outside detection
    let backdrop = document.getElementById('ef-menu-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'ef-menu-backdrop';
      backdrop.className = 'ef-menu-backdrop';
      backdrop.style.cssText = 'display: none;';
      document.body.appendChild(backdrop);
    }

    // Get all focusable elements within the menu
    function getFocusableElements() {
      return mobileMenu.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
    }

    // Focus trap handler
    function handleFocusTrap(event) {
      if (!isOpen) {
        return;
      }

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      // Tab key
      if (event.key === 'Tab') {
        // Shift + Tab (backwards)
        if (event.shiftKey) {
          if (document.activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
          }
        }
        // Tab (forwards)
        else {
          if (document.activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus();
          }
        }
      }
    }

    // Toggle function
    function toggleMenu(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      isOpen = !isOpen;

      if (DEBUG) {
        console.log(`🔄 Menu ${isOpen ? 'opening' : 'closing'}...`);
      }

      if (isOpen) {
        // Store the element that had focus before opening
        lastFocusedElement = document.activeElement;

        // Open menu
        mobileMenu.classList.add('open');
        mobileToggle.setAttribute('aria-expanded', 'true');
        mobileMenu.setAttribute('aria-hidden', 'false');
        updateToggleA11yState(true);
        document.body.classList.add('ef-menu-open');

        // Show backdrop
        backdrop.style.display = 'block';

        if (bottomMenuBtn) {
          bottomMenuBtn.setAttribute('aria-expanded', 'true');
        }

        // Make background inert (or use aria-hidden as fallback)
        if (mainContent) {
          if ('inert' in mainContent) {
            mainContent.inert = true;
          } else {
            mainContent.setAttribute('aria-hidden', 'true');
          }
        }

        // Focus first menu link using requestAnimationFrame for better timing
        const focusableElements = getFocusableElements();
        if (focusableElements.length > 0) {
          // Use requestAnimationFrame to ensure DOM is fully updated
          requestAnimationFrame(() => {
            setTimeout(() => {
              focusableElements[0].focus();
            }, 100);
          });
        }

        // Add focus trap listener
        document.addEventListener('keydown', handleFocusTrap);
      } else {
        // Close menu
        mobileMenu.classList.remove('open');
        mobileToggle.setAttribute('aria-expanded', 'false');
        mobileMenu.setAttribute('aria-hidden', 'true');
        updateToggleA11yState(false);
        document.body.classList.remove('ef-menu-open');

        // Hide backdrop
        backdrop.style.display = 'none';

        if (bottomMenuBtn) {
          bottomMenuBtn.setAttribute('aria-expanded', 'false');
        }

        // Restore background
        if (mainContent) {
          if ('inert' in mainContent) {
            mainContent.inert = false;
          } else {
            mainContent.removeAttribute('aria-hidden');
          }
        }

        // Remove focus trap listener
        document.removeEventListener('keydown', handleFocusTrap);

        // Return focus to the button that opened the menu
        if (lastFocusedElement) {
          lastFocusedElement.focus();
        } else {
          mobileToggle.focus();
        }
      }
    }

    // Attach click handlers
    updateToggleA11yState(false);
    mobileToggle.addEventListener('click', toggleMenu);
    if (DEBUG) {
      console.log('✅ Click handler attached to mobile toggle');
    }

    if (bottomMenuBtn) {
      bottomMenuBtn.addEventListener('click', toggleMenu);
      if (DEBUG) {
        console.log('✅ Click handler attached to bottom menu button');
      }
    }

    // Close menu when clicking on links
    const menuLinks = mobileMenu.querySelectorAll('a');
    menuLinks.forEach(link => {
      link.addEventListener('click', () => {
        if (isOpen && link.getAttribute('href') && link.getAttribute('href') !== '#') {
          if (DEBUG) {
            console.log('📍 Closing menu after link click');
          }
          toggleMenu();
        }
      });
    });

    // Close on Escape key and return focus
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen) {
        if (DEBUG) {
          console.log('⎋ Closing menu with Escape key');
        }
        toggleMenu();
        // Return focus to the element that opened the menu
        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
          requestAnimationFrame(() => {
            lastFocusedElement.focus();
          });
        }
      }
    });

    // Ensure menu is closed when switching to desktop layout
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1024 && isOpen) {
        toggleMenu();
      }
    });

    // Close when clicking on backdrop
    backdrop.addEventListener('click', e => {
      if (isOpen) {
        if (DEBUG) {
          console.log('🖱️ Closing menu - clicked on backdrop');
        }
        e.preventDefault();
        e.stopPropagation();
        toggleMenu();
      }
    });

    // Close when clicking outside (keep as fallback)
    document.addEventListener('click', e => {
      if (
        isOpen &&
        !mobileMenu.contains(e.target) &&
        !mobileToggle.contains(e.target) &&
        (!bottomMenuBtn || !bottomMenuBtn.contains(e.target)) &&
        e.target !== backdrop
      ) {
        if (DEBUG) {
          console.log('🖱️ Closing menu - clicked outside');
        }
        toggleMenu();
      }
    });

    if (DEBUG) {
      console.log('🎉 Burger menu initialization complete!');
    }
  }
})();
