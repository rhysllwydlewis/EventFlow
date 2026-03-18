/**
 * EventFlow Onboarding Tour
 * Interactive tour for new users
 */

(function () {
  'use strict';

  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  class OnboardingTour {
    constructor(options = {}) {
      if (isDevelopment) {
        console.log('[OnboardingTour] Initializing with options:', options);
      }

      this.options = {
        steps: options.steps || [],
        onComplete: options.onComplete || null,
        onSkip: options.onSkip || null,
        storageKey: options.storageKey || 'ef_tour_completed',
        autoStart: options.autoStart !== false,
      };

      this.currentStep = 0;
      this.overlay = null;
      this.isActive = false;

      if (isDevelopment) {
        console.log('[OnboardingTour] Steps count:', this.options.steps.length);
      }
      if (isDevelopment) {
        console.log('[OnboardingTour] Has completed tour:', this.hasCompletedTour());
      }

      if (this.options.autoStart && !this.hasCompletedTour()) {
        if (isDevelopment) {
          console.log('[OnboardingTour] Auto-starting tour');
        }
        this.start();
      } else {
        if (isDevelopment) {
          console.log(
            '[OnboardingTour] Tour not auto-starting. AutoStart:',
            this.options.autoStart,
            'Completed:',
            this.hasCompletedTour()
          );
        }
      }
    }

    hasCompletedTour() {
      const completed = localStorage.getItem(this.options.storageKey) === 'true';
      if (isDevelopment) {
        console.log(
          '[OnboardingTour] Checking completion status:',
          completed,
          'for key:',
          this.options.storageKey
        );
      }
      return completed;
    }

    markTourCompleted() {
      if (isDevelopment) {
        console.log('[OnboardingTour] Marking tour as completed');
      }
      localStorage.setItem(this.options.storageKey, 'true');
    }

    resetTour() {
      if (isDevelopment) {
        console.log('[OnboardingTour] Resetting tour');
      }
      localStorage.removeItem(this.options.storageKey);
    }

    start() {
      if (this.isActive || this.options.steps.length === 0) {
        if (isDevelopment) {
          console.log(
            '[OnboardingTour] Cannot start. Active:',
            this.isActive,
            'Steps:',
            this.options.steps.length
          );
        }
        return;
      }

      if (isDevelopment) {
        console.log('[OnboardingTour] Starting tour');
      }
      this.isActive = true;
      this.currentStep = 0;
      this.createOverlay();
      this.showStep(0);
      this.injectStyles();
    }

    createOverlay() {
      this.overlay = document.createElement('div');
      this.overlay.className = 'onboarding-overlay';
      this.overlay.innerHTML = `
      <div class="onboarding-spotlight"></div>
      <div class="onboarding-tooltip">
        <div class="onboarding-tooltip-header">
          <div class="onboarding-step-indicator">
            <span class="current-step">1</span>/<span class="total-steps">${this.options.steps.length}</span>
          </div>
          <button class="onboarding-skip" aria-label="Skip tour">Skip Tour</button>
        </div>
        <div class="onboarding-tooltip-content">
          <h3 class="onboarding-title"></h3>
          <p class="onboarding-description"></p>
        </div>
        <div class="onboarding-tooltip-footer">
          <button class="btn btn-secondary onboarding-prev" style="display:none;">Previous</button>
          <button class="btn btn-primary onboarding-next">Next</button>
        </div>
      </div>
    `;

      document.body.appendChild(this.overlay);

      // Event listeners
      this.overlay.querySelector('.onboarding-skip').addEventListener('click', () => {
        this.skip();
      });

      this.overlay.querySelector('.onboarding-prev').addEventListener('click', () => {
        this.previousStep();
      });

      this.overlay.querySelector('.onboarding-next').addEventListener('click', () => {
        this.nextStep();
      });

      // Close on ESC key
      this.escapeHandler = e => {
        if (e.key === 'Escape') {
          this.skip();
        }
      };
      document.addEventListener('keydown', this.escapeHandler);
    }

    showStep(stepIndex) {
      if (stepIndex < 0 || stepIndex >= this.options.steps.length) {
        return;
      }

      this.currentStep = stepIndex;
      const step = this.options.steps[stepIndex];

      // Update step indicator
      this.overlay.querySelector('.current-step').textContent = stepIndex + 1;

      // Update content
      this.overlay.querySelector('.onboarding-title').textContent = step.title;
      this.overlay.querySelector('.onboarding-description').textContent = step.description;

      // Update buttons
      const prevBtn = this.overlay.querySelector('.onboarding-prev');
      const nextBtn = this.overlay.querySelector('.onboarding-next');

      prevBtn.style.display = stepIndex > 0 ? 'block' : 'none';
      nextBtn.textContent = stepIndex === this.options.steps.length - 1 ? 'Finish' : 'Next';

      // Highlight element
      if (step.element) {
        this.highlightElement(step.element, step.position || 'bottom');
      } else {
        this.positionTooltip('center');
      }

      // Execute step action if provided
      if (step.action && typeof step.action === 'function') {
        step.action();
      }
    }

    highlightElement(selector, position) {
      const element = typeof selector === 'string' ? document.querySelector(selector) : selector;

      if (!element) {
        console.warn('Onboarding: Element not found:', selector);
        this.positionTooltip('center');
        return;
      }

      // Scroll element into view
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Add spotlight class to element
      element.classList.add('onboarding-highlighted');

      // Remove previous highlights
      document.querySelectorAll('.onboarding-highlighted').forEach(el => {
        if (el !== element) {
          el.classList.remove('onboarding-highlighted');
        }
      });

      // Position spotlight
      setTimeout(() => {
        const rect = element.getBoundingClientRect();
        const spotlight = this.overlay.querySelector('.onboarding-spotlight');

        spotlight.style.top = `${rect.top - 8}px`;
        spotlight.style.left = `${rect.left - 8}px`;
        spotlight.style.width = `${rect.width + 16}px`;
        spotlight.style.height = `${rect.height + 16}px`;
        spotlight.style.opacity = '1';

        // Position tooltip
        this.positionTooltip(position, rect);
      }, 100);
    }

    positionTooltip(position, elementRect = null) {
      const tooltip = this.overlay.querySelector('.onboarding-tooltip');

      if (position === 'center' || !elementRect) {
        tooltip.style.top = '50%';
        tooltip.style.left = '50%';
        tooltip.style.transform = 'translate(-50%, -50%)';
        tooltip.style.bottom = 'auto';
        tooltip.style.right = 'auto';
        return;
      }

      const padding = 20;
      tooltip.style.transform = 'none';
      tooltip.style.top = 'auto';
      tooltip.style.left = 'auto';
      tooltip.style.bottom = 'auto';
      tooltip.style.right = 'auto';

      switch (position) {
        case 'top':
          tooltip.style.bottom = `${window.innerHeight - elementRect.top + padding}px`;
          tooltip.style.left = `${elementRect.left}px`;
          break;
        case 'bottom':
          tooltip.style.top = `${elementRect.bottom + padding}px`;
          tooltip.style.left = `${elementRect.left}px`;
          break;
        case 'left':
          tooltip.style.right = `${window.innerWidth - elementRect.left + padding}px`;
          tooltip.style.top = `${elementRect.top}px`;
          break;
        case 'right':
          tooltip.style.left = `${elementRect.right + padding}px`;
          tooltip.style.top = `${elementRect.top}px`;
          break;
      }

      // Ensure tooltip stays within viewport
      setTimeout(() => {
        const tooltipRect = tooltip.getBoundingClientRect();

        if (tooltipRect.right > window.innerWidth - 20) {
          tooltip.style.left = 'auto';
          tooltip.style.right = '20px';
        }

        if (tooltipRect.left < 20) {
          tooltip.style.left = '20px';
          tooltip.style.right = 'auto';
        }

        if (tooltipRect.bottom > window.innerHeight - 20) {
          tooltip.style.top = 'auto';
          tooltip.style.bottom = '20px';
        }

        if (tooltipRect.top < 20) {
          tooltip.style.top = '20px';
          tooltip.style.bottom = 'auto';
        }
      }, 10);
    }

    nextStep() {
      if (this.currentStep < this.options.steps.length - 1) {
        this.showStep(this.currentStep + 1);
      } else {
        this.complete();
      }
    }

    previousStep() {
      if (this.currentStep > 0) {
        this.showStep(this.currentStep - 1);
      }
    }

    complete() {
      this.markTourCompleted();
      this.cleanup();

      if (this.options.onComplete) {
        this.options.onComplete();
      }

      if (typeof showToast === 'function') {
        showToast("Tour completed! You're all set 🎉", 'success');
      }
    }

    skip() {
      this.cleanup();

      if (this.options.onSkip) {
        this.options.onSkip();
      }
    }

    cleanup() {
      this.isActive = false;

      // Remove highlights
      document.querySelectorAll('.onboarding-highlighted').forEach(el => {
        el.classList.remove('onboarding-highlighted');
      });

      // Remove overlay
      if (this.overlay) {
        this.overlay.classList.add('fade-out');
        setTimeout(() => {
          if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
          }
          this.overlay = null;
        }, 300);
      }

      // Remove event listener
      if (this.escapeHandler) {
        document.removeEventListener('keydown', this.escapeHandler);
        this.escapeHandler = null;
      }
    }

    injectStyles() {
      if (document.getElementById('onboarding-tour-styles')) {
        return;
      }

      const styles = document.createElement('style');
      styles.id = 'onboarding-tour-styles';
      styles.textContent = `
      .onboarding-overlay {
        position: fixed;
        inset: 0;
        z-index: 10000;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(2px);
        animation: fadeIn 0.3s ease-out;
        pointer-events: none;
      }

      .onboarding-overlay.fade-out {
        animation: fadeOut 0.3s ease-out;
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }

      .onboarding-spotlight {
        position: absolute;
        border-radius: 8px;
        box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6);
        opacity: 0;
        transition: all 0.3s ease-out;
        pointer-events: none;
        z-index: 10001;
        background: transparent;
      }

      .onboarding-highlighted {
        position: relative;
        z-index: 10002 !important;
        filter: none !important;
        opacity: 1 !important;
      }

      .onboarding-tooltip {

      @keyframes slideInUp {
        from {
          transform: translateY(20px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }

      .onboarding-tooltip-header {

      .onboarding-step-indicator {
        font-size: 0.875rem;
        color: #6B7280;
        font-weight: 500;
      }

      .current-step {
        color: var(--ink, #0B8073);
        font-weight: 700;
      }

      .onboarding-skip {
        background: none;
        border: none;
        color: #6B7280;
        cursor: pointer;
        font-size: 0.875rem;
        padding: 4px 8px;
        border-radius: 4px;
        transition: all 0.2s;
      }

      .onboarding-skip:hover {
        background: #F3F4F6;
        color: #374151;
      }

      .onboarding-tooltip-content {
        padding: 16px;
      }

      .onboarding-title {

      .onboarding-description {

      .onboarding-tooltip-footer {

      @media (max-width: 640px) {
        .onboarding-tooltip {
          max-width: none;
          width: calc(100% - 40px);
          left: 20px !important;
          right: 20px !important;
          bottom: 20px !important;
          top: auto !important;
          transform: none !important;
        }
      }
    `;
      document.head.appendChild(styles);
    }

    reset() {
      localStorage.removeItem(this.options.storageKey);
    }
  }

  window.OnboardingTour = OnboardingTour;

  // Export for use in modules
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = OnboardingTour;
  }
})();
