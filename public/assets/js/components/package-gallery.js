/**
 * PackageGallery Component
 * Image gallery carousel for package detail pages
 */

// Constants
const PLACEHOLDER_IMAGE = '/assets/images/placeholders/package-event.svg';

class PackageGallery {
  constructor(containerId, images = []) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.warn(`PackageGallery: Container ${containerId} not found`);
      return;
    }
    this.images = images;
    this.currentIndex = 0;
    this.injectStyles();
    this.render();
  }

  injectStyles() {
    if (document.getElementById('package-gallery-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'package-gallery-styles';
    style.textContent = `
      .package-gallery {
        position: relative;
        width: 100%;
      }

      .package-gallery-main {
        position: relative;
        width: 100%;
        aspect-ratio: 16 / 7;
        min-height: 320px;
        border-radius: 12px;
        overflow: hidden;
        background-color: #f8f9fa;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .package-gallery-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: none;
        animation: fadeIn 0.3s ease-in;
        background-color: #e5e7eb;
        transition: opacity 0.3s ease-in-out;
      }

      .package-gallery-image.active {
        display: block;
      }

      .package-gallery-image[aria-busy="true"] {
        opacity: 0.5;
      }

      .package-gallery-image:not([src]), .package-gallery-image[src=""] {
        background: #e5e7eb url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="%23999" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>') center center no-repeat;
      }

      .package-gallery-nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        background-color: rgba(0, 0, 0, 0.5);
        color: white;
        border: none;
        padding: 16px;
        cursor: pointer;
        font-size: 20px;
        border-radius: 50%;
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s ease;
        z-index: 2;
      }

      .package-gallery-nav:hover {
        background-color: rgba(0, 0, 0, 0.7);
      }

      .package-gallery-nav.prev {
        left: 16px;
      }

      .package-gallery-nav.next {
        right: 16px;
      }

      .package-gallery-counter {
        position: absolute;
        bottom: 16px;
        left: 50%;
        transform: translateX(-50%);
        background-color: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 0.9rem;
        z-index: 2;
      }

      .package-gallery-thumbnails {
        display: flex;
        gap: 12px;
        margin-top: 16px;
        overflow-x: auto;
        padding: 8px 0;
      }

      .package-gallery-thumbnail {
        width: 120px;
        height: 90px;
        object-fit: cover;
        border-radius: 8px;
        cursor: pointer;
        border: 2px solid transparent;
        transition: border-color 0.2s ease, opacity 0.2s ease, transform 0.15s ease;
        flex-shrink: 0;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
      }

      .package-gallery-thumbnail:hover {
        opacity: 0.85;
        transform: translateY(-2px);
      }

      .package-gallery-thumbnail.active {
        border-color: var(--accent, #13B6A2);
      }

      .package-gallery-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        aspect-ratio: 16 / 7;
        min-height: 320px;
        background: linear-gradient(135deg, #f0fdf9 0%, #e6f7f5 100%);
        border-radius: 12px;
        border: 2px dashed #a7f3e4;
        color: var(--color-text-secondary, #6c757d);
        font-size: 1rem;
      }
      .package-gallery-empty-icon {
        font-size: 2.5rem;
        opacity: 0.45;
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @media (max-width: 768px) {
        .package-gallery-main,
        .package-gallery-empty {
          aspect-ratio: 4 / 3;
          min-height: 220px;
        }

        .package-gallery-nav {
          width: 40px;
          height: 40px;
          padding: 12px;
          font-size: 16px;
        }

        .package-gallery-thumbnail {
          width: 80px;
          height: 60px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Validate and sanitize image URL
   * Replace blocked sources (unsplash, etc.) with placeholder
   */
  sanitizeImageUrl(url) {
    if (!url || typeof url !== 'string') {
      return PLACEHOLDER_IMAGE;
    }

    // Allow relative paths (e.g. /uploads/...) and data URLs as-is
    if (url.startsWith('/') || url.startsWith('data:')) {
      return url;
    }

    // Check if URL is from a blocked or problematic source
    // Note: images.pexels.com is explicitly allowed — do NOT add it to blockedDomains
    const blockedDomains = ['source.unsplash.com', 'unsplash.com'];
    try {
      const urlObj = new URL(url);
      if (blockedDomains.some(domain => urlObj.hostname.includes(domain))) {
        console.warn(`Image from blocked domain ${urlObj.hostname}, using placeholder`);
        return PLACEHOLDER_IMAGE;
      }
    } catch (e) {
      // Unrecognized URL format — use placeholder
      console.warn(`Invalid image URL: ${url}, using placeholder`);
      return PLACEHOLDER_IMAGE;
    }

    return url;
  }

  render() {
    if (!this.images || this.images.length === 0) {
      this.container.innerHTML = `
        <div class="package-gallery-empty" role="img" aria-label="No images available">
          <span class="package-gallery-empty-icon" aria-hidden="true">🖼️</span>
          <span>No images available</span>
        </div>
      `;
      return;
    }

    const gallery = document.createElement('div');
    gallery.className = 'package-gallery';

    // Main image container
    const mainContainer = document.createElement('div');
    mainContainer.className = 'package-gallery-main';

    // Add all images
    this.images.forEach((img, index) => {
      const image = document.createElement('img');
      image.className = 'package-gallery-image';
      if (index === 0) {
        image.classList.add('active');
      }

      // Sanitize the image URL before setting src
      // Support multiple property names used by different API versions
      const originalUrl =
        typeof img === 'string' ? img : img.url || img.src || img.path || img.image || '';
      const sanitizedUrl = this.sanitizeImageUrl(originalUrl);
      image.src = sanitizedUrl;
      image.alt =
        typeof img === 'object' && img.alt
          ? img.alt
          : `Gallery image ${index + 1} of ${this.images.length}`;
      image.loading = 'lazy'; // Enable native lazy loading

      // Add loading state
      image.addEventListener('loadstart', () => {
        image.style.opacity = '0.5';
        image.setAttribute('aria-busy', 'true');
      });

      image.addEventListener('load', () => {
        image.style.opacity = '1';
        image.removeAttribute('aria-busy');
      });

      // Add error handling for image loading
      image.onerror = () => {
        console.warn(`Failed to load gallery image: ${image.src}`);
        // Only try to fallback if we're not already showing the placeholder
        // Use endsWith because browser resolves relative paths to absolute URLs
        if (!image.src.endsWith(PLACEHOLDER_IMAGE) && !image.src.includes('placeholder')) {
          image.src = PLACEHOLDER_IMAGE;
          image.alt = 'Image failed to load - placeholder shown';
        }
      };

      mainContainer.appendChild(image);
    });

    // Add navigation buttons if multiple images
    if (this.images.length > 1) {
      const prevBtn = document.createElement('button');
      prevBtn.className = 'package-gallery-nav prev';
      prevBtn.innerHTML = '‹';
      prevBtn.setAttribute('aria-label', 'Previous image');
      prevBtn.setAttribute('type', 'button');
      prevBtn.addEventListener('click', () => this.navigate(-1));

      const nextBtn = document.createElement('button');
      nextBtn.className = 'package-gallery-nav next';
      nextBtn.innerHTML = '›';
      nextBtn.setAttribute('aria-label', 'Next image');
      nextBtn.setAttribute('type', 'button');
      nextBtn.addEventListener('click', () => this.navigate(1));

      const counter = document.createElement('div');
      counter.className = 'package-gallery-counter';
      counter.id = 'gallery-counter';
      counter.textContent = `1 / ${this.images.length}`;

      mainContainer.appendChild(prevBtn);
      mainContainer.appendChild(nextBtn);
      mainContainer.appendChild(counter);
    }

    gallery.appendChild(mainContainer);

    // Add thumbnails if multiple images
    if (this.images.length > 1) {
      const thumbnails = document.createElement('div');
      thumbnails.className = 'package-gallery-thumbnails';

      this.images.forEach((img, index) => {
        const thumb = document.createElement('img');
        thumb.className = 'package-gallery-thumbnail';
        if (index === 0) {
          thumb.classList.add('active');
        }

        // Sanitize thumbnail URL
        // Support multiple property names used by different API versions
        const originalUrl =
          typeof img === 'string' ? img : img.url || img.src || img.path || img.image || '';
        const sanitizedUrl = this.sanitizeImageUrl(originalUrl);
        thumb.src = sanitizedUrl;
        thumb.alt = `Thumbnail ${index + 1} of ${this.images.length}`;
        thumb.setAttribute('role', 'button');
        thumb.setAttribute('tabindex', '0');
        thumb.setAttribute('aria-label', `View image ${index + 1}`);

        // Add error handling for thumbnail loading
        thumb.onerror = () => {
          console.warn(`Failed to load thumbnail: ${thumb.src}`);
          // Use endsWith because browser resolves relative paths to absolute URLs
          if (!thumb.src.endsWith(PLACEHOLDER_IMAGE) && !thumb.src.includes('placeholder')) {
            thumb.src = PLACEHOLDER_IMAGE;
          }
        };

        thumb.addEventListener('click', () => this.goToImage(index));
        thumb.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.goToImage(index);
          }
        });
        thumbnails.appendChild(thumb);
      });

      gallery.appendChild(thumbnails);
    }

    this.container.innerHTML = '';
    this.container.appendChild(gallery);

    // Store references for navigation
    this.galleryElement = gallery;
  }

  navigate(direction) {
    const images = this.container.querySelectorAll('.package-gallery-image');
    const thumbnails = this.container.querySelectorAll('.package-gallery-thumbnail');

    images[this.currentIndex].classList.remove('active');
    if (thumbnails.length > 0) {
      thumbnails[this.currentIndex].classList.remove('active');
    }

    this.currentIndex = (this.currentIndex + direction + this.images.length) % this.images.length;

    images[this.currentIndex].classList.add('active');
    if (thumbnails.length > 0) {
      thumbnails[this.currentIndex].classList.add('active');
    }

    const counter = document.getElementById('gallery-counter');
    if (counter) {
      counter.textContent = `${this.currentIndex + 1} / ${this.images.length}`;
    }
  }

  goToImage(index) {
    const images = this.container.querySelectorAll('.package-gallery-image');
    const thumbnails = this.container.querySelectorAll('.package-gallery-thumbnail');

    images[this.currentIndex].classList.remove('active');
    thumbnails[this.currentIndex].classList.remove('active');

    this.currentIndex = index;

    images[this.currentIndex].classList.add('active');
    thumbnails[this.currentIndex].classList.add('active');

    const counter = document.getElementById('gallery-counter');
    if (counter) {
      counter.textContent = `${this.currentIndex + 1} / ${this.images.length}`;
    }
  }
}

// Export to window
if (typeof window !== 'undefined') {
  window.PackageGallery = PackageGallery;
}
