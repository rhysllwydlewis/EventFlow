/**
 * Supplier Dashboard Enhancements
 * Adds export buttons and other P3 features
 */

(function () {
  'use strict';

  const LAYOUT_PAINT_DELAY = 50;
  const DRAG_SCROLL_MULTIPLIER = 2; // Faster scroll for responsive feel on mobile
  const THEME_CLASSES = [
    'supplier-welcome-card--morning',
    'supplier-welcome-card--afternoon',
    'supplier-welcome-card--evening',
    'supplier-welcome-card--night',
  ];

  // Curated pro tips list
  const PRO_TIPS = [
    'Boost response speed to delight customers.',
    'Add high-quality photos to increase enquiries.',
    'Complete your profile for better visibility.',
    'Respond within 24 hours for better ratings.',
    'Update your packages regularly to stay fresh.',
    'Add detailed descriptions to build trust.',
    'Showcase your best work in your gallery.',
    'Engage with customer reviews promptly.',
  ];

  /**
   * Utility: time-based theme class for welcome card
   */
  function applyTimeBasedGreeting() {
    const card = document.querySelector('.supplier-welcome-card');
    const greetingEl = document.getElementById('welcome-greeting');
    if (!card || !greetingEl) {
      return;
    }

    const hour = new Date().getHours();
    let variant = 'afternoon';
    let greeting = 'Good day,';

    // Time-based gradients as per spec:
    // Morning (5am-12pm): golden
    // Afternoon (12pm-5pm): blue
    // Evening (5pm-9pm): purple
    // Night (9pm-5am): indigo
    if (hour >= 5 && hour < 12) {
      variant = 'morning';
      greeting = 'Good morning,';
    } else if (hour >= 12 && hour < 17) {
      variant = 'afternoon';
      greeting = 'Good afternoon,';
    } else if (hour >= 17 && hour < 21) {
      variant = 'evening';
      greeting = 'Good evening,';
    } else {
      variant = 'night';
      greeting = 'Good night,';
    }

    THEME_CLASSES.forEach(cls => card.classList.remove(cls));
    card.classList.add(`supplier-welcome-card--${variant}`);
    greetingEl.textContent = greeting;
  }

  /**
   * Display random pro tip from curated list
   */
  function showRandomProTip() {
    const proTipText = document.getElementById('pro-tip-text');
    if (!proTipText) {
      return;
    }

    const randomTip = PRO_TIPS[Math.floor(Math.random() * PRO_TIPS.length)];
    proTipText.textContent = randomTip;
  }

  /**
   * Utility: animate stat counters when visible
   */
  function setupStatCounters() {
    const counters = document.querySelectorAll('.welcome-stat-value[data-target]');
    if (!counters.length) {
      return;
    }

    const animate = el => {
      const target = parseInt(el.getAttribute('data-target'), 10) || 0;
      const duration = 900;
      const start = performance.now();
      const initial = 0;

      function frame(now) {
        const progress = Math.min((now - start) / duration, 1);
        const value = Math.floor(initial + (target - initial) * progress);
        el.textContent = value.toLocaleString();
        if (progress < 1) {
          requestAnimationFrame(frame);
        }
      }
      requestAnimationFrame(frame);
    };

    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            animate(entry.target);
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 }
    );

    counters.forEach(c => observer.observe(c));
  }

  /**
   * Mobile nav indicator + snap scrolling + keyboard navigation
   */
  function setupMobileNav() {
    if (window.__supplierQuickNavInitialized) {
      return;
    }

    const nav = document.querySelector('.mobile-nav-pills');
    if (!nav) {
      return;
    }
    const pills = nav.querySelectorAll('.mobile-nav-pill');
    if (!pills.length) {
      return;
    }

    window.__supplierQuickNavInitialized = true;

    let indicator = nav.querySelector('.mobile-nav-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'mobile-nav-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      nav.appendChild(indicator);
    }

    const moveIndicator = pill => {
      const rect = pill.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      const width = rect.width;
      const offset = rect.left - navRect.left + nav.scrollLeft;
      indicator.style.width = `${width}px`;
      indicator.style.transform = `translateX(${offset}px)`;
    };

    let lastActiveSection = null;

    const setActive = (pill, options = {}) => {
      const { announce = false } = options;
      const sectionId = pill.getAttribute('data-section') || null;

      pills.forEach(p => {
        const active = p === pill;
        p.classList.toggle('active', active);
        p.setAttribute('aria-current', active ? 'page' : 'false');
        p.setAttribute('aria-selected', active ? 'true' : 'false');
        p.setAttribute('tabindex', active ? '0' : '-1');
      });
      moveIndicator(pill);

      // Announce to screen readers only for user-triggered updates
      if (announce) {
        const sectionName = pill.textContent.trim();
        if (window.announceToSR) {
          window.announceToSR(`Navigated to ${sectionName}`);
        }
      }

      if (sectionId && sectionId !== lastActiveSection) {
        lastActiveSection = sectionId;
        window.dispatchEvent(
          new CustomEvent('supplier-nav-section-change', {
            detail: { sectionId, label: pill.textContent.trim() },
          })
        );
      }
    };

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollBehavior = reduceMotion ? 'auto' : 'smooth';

    const getStickyOffset = () => {
      const header = document.querySelector('.ef-header');
      const quickNav = document.querySelector('.dashboard-mobile-nav');
      const headerHeight = header ? header.getBoundingClientRect().height : 64;
      const quickNavHeight = quickNav ? quickNav.getBoundingClientRect().height : 52;
      return Math.ceil(headerHeight + quickNavHeight + 12);
    };

    const scrollToSection = target => {
      const y = target.getBoundingClientRect().top + window.scrollY - getStickyOffset();
      window.scrollTo({ top: Math.max(0, y), behavior: scrollBehavior });
    };

    const sections = Array.from(pills)
      .map(pill => ({ pill, target: document.getElementById(pill.getAttribute('data-section')) }))
      .filter(item => item.target);

    const updateActiveByScroll = () => {
      if (!sections.length) {
        return;
      }

      // If the user is at (or very near) the top of the page, always highlight
      // the first pill (Overview). Without this guard the sticky-offset added to
      // scrollY=0 can push currentY past several section tops and land on a later
      // section such as "Tickets" before the layout has fully settled.
      if (window.scrollY < 10) {
        setActive(sections[0].pill);
        return;
      }

      const currentY = window.scrollY + getStickyOffset();
      let current = sections[0];

      sections.forEach(section => {
        if (section.target.offsetTop <= currentY) {
          current = section;
        }
      });

      if (current) {
        setActive(current.pill);
      }
    };

    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          updateActiveByScroll();
          ticking = false;
        });
        ticking = true;
      }
    };

    pills.forEach((pill, index) => {
      // Click handler
      pill.addEventListener('click', () => {
        setActive(pill, { announce: true });
        const targetId = pill.getAttribute('data-section');
        const target = document.getElementById(targetId);
        if (target) {
          scrollToSection(target);
        }

        pill.scrollIntoView({ behavior: scrollBehavior, inline: 'center', block: 'nearest' });
      });

      // Keyboard navigation
      pill.addEventListener('keydown', e => {
        let targetIndex = index;

        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          targetIndex = index > 0 ? index - 1 : pills.length - 1;
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          targetIndex = index < pills.length - 1 ? index + 1 : 0;
        } else if (e.key === 'Home') {
          e.preventDefault();
          targetIndex = 0;
        } else if (e.key === 'End') {
          e.preventDefault();
          targetIndex = pills.length - 1;
        } else {
          return; // Let other keys pass through
        }

        pills[targetIndex].focus();
        pills[targetIndex].click();
      });

      // Set tabindex and role for accessibility (first pill gets 0, others get -1)
      pill.setAttribute('role', 'tab');
      pill.setAttribute('tabindex', index === 0 ? '0' : '-1');
      pill.setAttribute('aria-label', pill.textContent.trim());
      pill.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
      pill.setAttribute('aria-current', index === 0 ? 'page' : 'false');
    });

    // Set role for container
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Dashboard sections');

    // Keep indicator aligned after viewport changes
    window.addEventListener('resize', () => {
      const activePill = nav.querySelector('.mobile-nav-pill.active') || pills[0];
      if (activePill) {
        moveIndicator(activePill);
      }
    });

    window.addEventListener('scroll', onScroll, { passive: true });

    // Wait for layout/paint to measure pill widths; rAF ensures post-paint
    requestAnimationFrame(() =>
      setTimeout(() => {
        setActive(pills[0]);
        updateActiveByScroll();
        // tabindex already set to '0' in loop above
      }, LAYOUT_PAINT_DELAY)
    );
  }

  /**
   * Quick actions horizontal scroll on mobile with drag support and ripple effects
   */
  function setupQuickActionsCarousel() {
    const container = document.querySelector('.supplier-actions-primary');
    if (!container) {
      return;
    }
    const prev = document.getElementById('quick-actions-prev');
    const next = document.getElementById('quick-actions-next');

    const scrollByAmount = () => container.clientWidth * 0.9;
    const scrollTo = delta => {
      container.scrollTo({ left: container.scrollLeft + delta, behavior: 'smooth' });
    };

    if (prev) {
      prev.addEventListener('click', () => scrollTo(-scrollByAmount()));
      prev.setAttribute('aria-label', 'Previous actions');
    }
    if (next) {
      next.addEventListener('click', () => scrollTo(scrollByAmount()));
      next.setAttribute('aria-label', 'Next actions');
    }

    // Touch/mouse drag support
    let isDown = false;
    let startX;
    let scrollLeft;

    container.addEventListener('pointerdown', e => {
      if (window.innerWidth > 768) {
        return;
      }
      isDown = true;
      container.style.cursor = 'grabbing';
      container.style.userSelect = 'none';
      startX = e.pageX - container.offsetLeft;
      scrollLeft = container.scrollLeft;
    });

    container.addEventListener('pointerleave', () => {
      isDown = false;
      container.style.cursor = 'grab';
    });

    container.addEventListener('pointerup', () => {
      isDown = false;
      container.style.cursor = 'grab';
      container.style.userSelect = '';
    });

    container.addEventListener('pointermove', e => {
      if (!isDown || window.innerWidth > 768) {
        return;
      }
      e.preventDefault();
      const x = e.pageX - container.offsetLeft;
      const walk = (x - startX) * DRAG_SCROLL_MULTIPLIER;
      container.scrollLeft = scrollLeft - walk;
    });

    // Set cursor on mobile
    if (window.innerWidth <= 768) {
      container.style.cursor = 'grab';
    }

    // Add ripple effect to action buttons
    const actionButtons = document.querySelectorAll(
      '.supplier-action-btn--large, .supplier-action-btn'
    );
    actionButtons.forEach(button => {
      button.addEventListener('click', function (e) {
        // Only add ripple if not reduced motion
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          return;
        }

        const ripple = document.createElement('span');
        ripple.className = 'ripple-effect';

        const rect = this.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = e.clientX - rect.left - size / 2;
        const y = e.clientY - rect.top - size / 2;

        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;

        this.appendChild(ripple);

        setTimeout(() => ripple.remove(), 600);
      });
    });
  }

  /**
   * Add CSV export button to enquiries section
   */
  function addExportButton() {
    // Check if export button already exists first
    if (document.getElementById('export-enquiries-btn')) {
      return;
    }

    // Wait for dashboard to load
    const observer = new MutationObserver(() => {
      // Look for enquiries section or stats
      const statsSection = document.querySelector('.stats-grid, .dashboard-stats, #stats-section');

      if (statsSection) {
        // Double-check button doesn't exist
        if (document.getElementById('export-enquiries-btn')) {
          observer.disconnect();
          return;
        }

        // Create export button
        const exportBtn = document.createElement('button');
        exportBtn.id = 'export-enquiries-btn';
        exportBtn.className = 'btn btn-secondary';
        exportBtn.innerHTML = '📥 Export Enquiries';
        exportBtn.style.marginTop = '1rem';

        exportBtn.addEventListener('click', async () => {
          try {
            exportBtn.disabled = true;
            exportBtn.textContent = 'Exporting...';

            const response = await fetch('/api/v1/supplier/enquiries/export', {
              credentials: 'include',
            });

            if (!response.ok) {
              throw new Error('Export failed');
            }

            // Download the CSV file
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `enquiries-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            exportBtn.disabled = false;
            exportBtn.innerHTML = '📥 Export Enquiries';

            // Show success message
            alert('Enquiries exported successfully!');
          } catch (error) {
            console.error('Export error:', error);
            alert('Failed to export enquiries. Please try again.');
            exportBtn.disabled = false;
            exportBtn.innerHTML = '📥 Export Enquiries';
          }
        });

        // Add button after stats section
        statsSection.insertAdjacentElement('afterend', exportBtn);

        observer.disconnect();
      }
    });

    // Start observing
    const main = document.querySelector('main, #main-content');
    if (main) {
      observer.observe(main, { childList: true, subtree: true });
    }
  }

  /**
   * Trigger confetti on trial activation success
   */
  function setupTrialConfetti() {
    // Listen for trial activation
    const trialBtn = document.querySelector('#activate-trial-btn, [data-action="activate-trial"]');
    if (trialBtn) {
      trialBtn.addEventListener('click', () => {
        // Wait a bit for the success response
        setTimeout(() => {
          if (typeof triggerSuccessConfetti === 'function') {
            triggerSuccessConfetti();
          }
        }, 1000);
      });
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      applyTimeBasedGreeting();
      showRandomProTip();
      setupStatCounters();
      setupMobileNav();
      setupQuickActionsCarousel();
      addExportButton();
      setupTrialConfetti();
    });
  } else {
    applyTimeBasedGreeting();
    showRandomProTip();
    setupStatCounters();
    setupMobileNav();
    setupQuickActionsCarousel();
    addExportButton();
    setupTrialConfetti();
  }
})();
