/**
 * ImageZoom Component
 * Provides smooth zoom-on-hover (desktop) and pinch-to-zoom (mobile) functionality.
 *
 * Usage:
 *   const zoom = new ImageZoom(imgElement, { zoomLevel: 2.5 });
 *   zoom.enable();
 *
 * Or use the static helper:
 *   ImageZoom.applyToGallery('.gallery img');
 */

'use strict';

class ImageZoom {
  constructor(element, options = {}) {
    this.element = typeof element === 'string' ? document.querySelector(element) : element;
    this.options = {
      zoomLevel: 2.5,
      minZoom: 1,
      transitionDuration: 200, // ms
      containerClass: 'ef-zoom-container',
      ...options,
    };
    // Ensure maxZoom is respected when passed directly
    if (options.maxZoom) {
      this.options.zoomLevel = options.maxZoom;
    }

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseEnter = this._onMouseEnter.bind(this);
    this._onMouseLeave = this._onMouseLeave.bind(this);
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);

    // Pinch-to-zoom state
    this._initialPinchDistance = null;
    this._currentScale = 1;
    this._pinchStartScale = 1;

    this._enabled = false;
    this._prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Wrap the target image in a zoom container and attach event listeners.
   */
  enable() {
    if (this._enabled || !this.element) {
      return;
    }

    // Wrap in container if not already wrapped
    if (!this.element.parentElement.classList.contains(this.options.containerClass)) {
      const container = document.createElement('div');
      container.className = this.options.containerClass;
      this.element.parentNode.insertBefore(container, this.element);
      container.appendChild(this.element);
      this._container = container;
    } else {
      this._container = this.element.parentElement;
    }

    this._applyContainerStyles();

    if (!this._prefersReducedMotion) {
      const duration = this.options.transitionDuration;
      this.element.style.transition = `transform ${duration}ms ease, transform-origin ${duration}ms ease`;
    }

    // Desktop hover events
    this._container.addEventListener('mouseenter', this._onMouseEnter);
    this._container.addEventListener('mousemove', this._onMouseMove);
    this._container.addEventListener('mouseleave', this._onMouseLeave);

    // Mobile pinch-to-zoom events
    this._container.addEventListener('touchstart', this._onTouchStart, { passive: true });
    this._container.addEventListener('touchmove', this._onTouchMove, { passive: false });
    this._container.addEventListener('touchend', this._onTouchEnd, { passive: true });

    this._enabled = true;
  }

  /**
   * Remove zoom behaviour and restore original styles.
   */
  disable() {
    if (!this._enabled || !this._container) {
      return;
    }

    this._container.removeEventListener('mouseenter', this._onMouseEnter);
    this._container.removeEventListener('mousemove', this._onMouseMove);
    this._container.removeEventListener('mouseleave', this._onMouseLeave);
    this._container.removeEventListener('touchstart', this._onTouchStart);
    this._container.removeEventListener('touchmove', this._onTouchMove);
    this._container.removeEventListener('touchend', this._onTouchEnd);

    this._resetTransform();
    this.element.style.transition = '';

    this._enabled = false;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  _applyContainerStyles() {
    Object.assign(this._container.style, {
      overflow: 'hidden',
      display: 'inline-block',
      cursor: 'zoom-in',
      position: this._container.style.position || 'relative',
    });
  }

  _onMouseEnter() {
    if (this._prefersReducedMotion) {
      return;
    }
    this.element.style.willChange = 'transform';
  }

  _onMouseMove(event) {
    if (this._prefersReducedMotion) {
      return;
    }

    const rect = this._container.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;

    this.element.style.transformOrigin = `${x}% ${y}%`;
    this.element.style.transform = `scale(${this.options.zoomLevel})`;
    this._container.style.cursor = 'zoom-in';
  }

  _onMouseLeave() {
    this._resetTransform();
    this.element.style.willChange = 'auto';
  }

  _resetTransform() {
    this.element.style.transform = 'scale(1)';
    this.element.style.transformOrigin = 'center center';
  }

  // ── Pinch-to-zoom ────────────────────────────────────────────────────────

  _getPinchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _onTouchStart(event) {
    if (event.touches.length === 2) {
      this._initialPinchDistance = this._getPinchDistance(event.touches);
      this._pinchStartScale = this._currentScale;
    }
  }

  _onTouchMove(event) {
    if (event.touches.length !== 2 || this._initialPinchDistance === null) {
      return;
    }

    event.preventDefault(); // Prevent page scroll during pinch

    const currentDistance = this._getPinchDistance(event.touches);
    const ratio = currentDistance / this._initialPinchDistance;
    const newScale = Math.min(
      Math.max(this._pinchStartScale * ratio, this.options.minZoom),
      this.options.zoomLevel
    );

    this._currentScale = newScale;
    this.element.style.transform = `scale(${newScale})`;
  }

  _onTouchEnd() {
    this._initialPinchDistance = null;
    if (this._currentScale <= this.options.minZoom + 0.05) {
      this._currentScale = this.options.minZoom;
      this._resetTransform();
    }
  }

  // ── Static factory ───────────────────────────────────────────────────────

  /**
   * Apply ImageZoom to all images matching the given CSS selector.
   * @param {string} selector - CSS selector for images
   * @param {Object} options - ImageZoom options
   * @returns {ImageZoom[]} Array of ImageZoom instances
   */
  static applyToGallery(selector, options = {}) {
    const elements = document.querySelectorAll(selector);
    const instances = [];
    elements.forEach(el => {
      const zoom = new ImageZoom(el, options);
      zoom.enable();
      instances.push(zoom);
    });
    return instances;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ImageZoom;
}
