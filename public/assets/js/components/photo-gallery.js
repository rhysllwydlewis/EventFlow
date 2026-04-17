/**
 * Photo Gallery Component
 * Responsive photo gallery with lightbox, lazy loading, and reordering
 *
 * Usage:
 *   const gallery = new PhotoGallery({
 *     photos: [...],
 *     lightbox: true,
 *     lazyLoad: true,
 *     editable: false,
 *     onDelete: (photoId) => { ... },
 *     onReorder: (photoIds) => { ... }
 *   });
 */

class PhotoGallery {
  constructor(options = {}) {
    this.photos = options.photos || [];
    this.lightbox = options.lightbox !== false;
    this.lazyLoad = options.lazyLoad !== false;
    this.editable = options.editable || false;
    this.reorderable = options.reorderable || false;
    this.onDelete = options.onDelete || (() => {});
    this.onReorder = options.onReorder || (() => {});
    this.columns = options.columns || 'auto'; // 'auto' or number

    this.currentLightboxIndex = 0;
    this.draggedElement = null;

    this.init();
  }

  init() {
    this.createUI();
    this.renderGallery();
    if (this.lightbox) {
      this.createLightbox();
    }
    if (this.lazyLoad) {
      this.setupLazyLoading();
    }
  }

  createUI() {
    this.container = document.createElement('div');
    this.container.className = 'photo-gallery';

    this.grid = document.createElement('div');
    this.grid.className = `photo-gallery__grid ${this.columns !== 'auto' ? `photo-gallery__grid--${this.columns}col` : ''}`;

    this.container.appendChild(this.grid);

    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById('photo-gallery-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'photo-gallery-styles';
    style.textContent = `
      .photo-gallery {
        width: 100%;
      }
      
      .photo-gallery__grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        gap: 1rem;
      }
      
      .photo-gallery__grid--1col { grid-template-columns: 1fr; }
      .photo-gallery__grid--2col { grid-template-columns: repeat(2, 1fr); }
      .photo-gallery__grid--3col { grid-template-columns: repeat(3, 1fr); }
      .photo-gallery__grid--4col { grid-template-columns: repeat(4, 1fr); }
      
      .photo-gallery__item {
        position: relative;
        aspect-ratio: 1;
        border-radius: 12px;
        overflow: hidden;
        cursor: pointer;
        transition: transform 0.3s ease, box-shadow 0.3s ease;
        background: #f0f0f0;
      }
      
      .photo-gallery__item:hover {
        transform: translateY(-4px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
      }
      
      .photo-gallery__item.dragging {
        opacity: 0.5;
      }
      
      .photo-gallery__item.drag-over {
        border: 3px dashed #667eea;
      }
      
      .photo-gallery__img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: opacity 0.3s ease;
      }
      
      .photo-gallery__img[data-src] {
        opacity: 0;
      }
      
      .photo-gallery__img.loaded {
        opacity: 1;
      }
      
      .photo-gallery__caption {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent);
        color: white;
        padding: 2rem 1rem 1rem;
        font-size: 0.9rem;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      
      .photo-gallery__item:hover .photo-gallery__caption {
        opacity: 1;
      }
      
      .photo-gallery__actions {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        display: flex;
        gap: 0.5rem;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      
      .photo-gallery__item:hover .photo-gallery__actions {
        opacity: 1;
      }
      
      .photo-gallery__action-btn {
        background: rgba(255, 255, 255, 0.9);
        border: none;
        border-radius: 50%;
        width: 32px;
        height: 32px;
        cursor: pointer;
        font-size: 1.2rem;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      
      .photo-gallery__action-btn:hover {
        background: white;
        transform: scale(1.1);
      }
      
      .photo-gallery__action-btn--delete {
        color: #d32f2f;
      }
      
      .photo-gallery__badge {
        position: absolute;
        top: 0.5rem;
        left: 0.5rem;
        background: rgba(255, 193, 7, 0.9);
        color: #000;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: 600;
      }
      
      .photo-gallery__badge--approved {
        background: rgba(76, 175, 80, 0.9);
        color: white;
      }
      
      /* Lightbox */
      .photo-gallery__lightbox {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.95);
        z-index: 9999;
        align-items: center;
        justify-content: center;
      }
      
      .photo-gallery__lightbox.active {
        display: flex;
      }
      
      .photo-gallery__lightbox-content {
        position: relative;
        max-width: 90vw;
        max-height: 90vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .photo-gallery__lightbox-img {
        max-width: 100%;
        max-height: 90vh;
        object-fit: contain;
        border-radius: 8px;
      }
      
      .photo-gallery__lightbox-close {
        position: absolute;
        top: 1rem;
        right: 1rem;
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        font-size: 2rem;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }
      
      .photo-gallery__lightbox-close:hover {
        background: rgba(255, 255, 255, 0.3);
      }
      
      .photo-gallery__lightbox-nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        font-size: 2rem;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }
      
      .photo-gallery__lightbox-nav:hover {
        background: rgba(255, 255, 255, 0.3);
      }
      
      .photo-gallery__lightbox-nav--prev {
        left: 1rem;
      }
      
      .photo-gallery__lightbox-nav--next {
        right: 1rem;
      }
      
      .photo-gallery__lightbox-caption {
        position: absolute;
        bottom: 2rem;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 1rem 2rem;
        border-radius: 8px;
        max-width: 80%;
        text-align: center;
      }
      
      .photo-gallery__lightbox-counter {
        position: absolute;
        top: 1rem;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.5);
        color: white;
        padding: 0.5rem 1rem;
        border-radius: 20px;
        font-size: 0.9rem;
      }
      
      .photo-gallery__empty {
        text-align: center;
        padding: 3rem;
        color: #999;
      }
      
      .photo-gallery__empty-icon {
        font-size: 4rem;
        margin-bottom: 1rem;
      }
      
      @media (max-width: 768px) {
        .photo-gallery__grid {
          grid-template-columns: repeat(2, 1fr);
          gap: 0.5rem;
        }
        
        .photo-gallery__grid--3col,
        .photo-gallery__grid--4col {
          grid-template-columns: repeat(2, 1fr);
        }
        
        .photo-gallery__lightbox-nav {
          width: 40px;
          height: 40px;
          font-size: 1.5rem;
        }
        
        .photo-gallery__lightbox-close {
          width: 40px;
          height: 40px;
          font-size: 1.5rem;
        }
      }
    `;
    document.head.appendChild(style);
  }

  renderGallery() {
    this.grid.innerHTML = '';

    if (this.photos.length === 0) {
      this.grid.innerHTML = `
        <div class="photo-gallery__empty">
          <div class="photo-gallery__empty-icon">📷</div>
          <div>No photos yet</div>
        </div>
      `;
      return;
    }

    this.photos.forEach((photo, index) => {
      const item = this.createGalleryItem(photo, index);
      this.grid.appendChild(item);
    });
  }

  createGalleryItem(photo, index) {
    const item = document.createElement('div');
    item.className = 'photo-gallery__item';
    item.dataset.index = index;
    item.dataset.id = photo.id || index;

    // Image
    const img = document.createElement('img');
    img.className = 'photo-gallery__img';

    if (this.lazyLoad) {
      img.dataset.src = photo.url;
      img.src = photo.thumbnail || photo.url;
    } else {
      img.src = photo.url;
      img.classList.add('loaded');
    }

    img.alt = photo.caption || 'Photo';

    // Click to open lightbox
    if (this.lightbox) {
      item.addEventListener('click', e => {
        if (!e.target.closest('.photo-gallery__action-btn')) {
          this.openLightbox(index);
        }
      });
    }

    item.appendChild(img);

    // Caption
    if (photo.caption) {
      const caption = document.createElement('div');
      caption.className = 'photo-gallery__caption';
      caption.textContent = photo.caption;
      item.appendChild(caption);
    }

    // Badge for approval status
    if (photo.approved !== undefined) {
      const badge = document.createElement('div');
      badge.className = `photo-gallery__badge ${photo.approved ? 'photo-gallery__badge--approved' : ''}`;
      badge.textContent = photo.approved ? 'Approved' : 'Pending';
      item.appendChild(badge);
    }

    // Actions (delete, etc.)
    if (this.editable) {
      const actions = document.createElement('div');
      actions.className = 'photo-gallery__actions';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'photo-gallery__action-btn photo-gallery__action-btn--delete';
      deleteBtn.innerHTML = '🗑️';
      deleteBtn.title = 'Delete';
      deleteBtn.addEventListener('click', e => {
        e.stopPropagation();
        this.deletePhoto(photo, index);
      });

      actions.appendChild(deleteBtn);
      item.appendChild(actions);
    }

    // Drag and drop for reordering
    if (this.reorderable) {
      item.draggable = true;
      item.addEventListener('dragstart', e => this.handleDragStart(e, item));
      item.addEventListener('dragover', e => this.handleDragOver(e));
      item.addEventListener('drop', e => this.handleDrop(e, item));
      item.addEventListener('dragend', e => this.handleDragEnd(e));
    }

    return item;
  }

  setupLazyLoading() {
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            if (img.dataset.src) {
              img.src = img.dataset.src;
              img.addEventListener('load', () => {
                img.classList.add('loaded');
                delete img.dataset.src;
              });
              observer.unobserve(img);
            }
          }
        });
      },
      {
        rootMargin: '50px',
      }
    );

    this.grid.querySelectorAll('img[data-src]').forEach(img => {
      observer.observe(img);
    });
  }

  createLightbox() {
    this.lightboxElement = document.createElement('div');
    this.lightboxElement.className = 'photo-gallery__lightbox';
    this.lightboxElement.innerHTML = `
      <div class="photo-gallery__lightbox-content">
        <button class="ef-cta photo-gallery__lightbox-close" title="Close (Esc)">×</button>
        <button class="ef-cta photo-gallery__lightbox-nav photo-gallery__lightbox-nav--prev" title="Previous (←)">‹</button>
        <button class="ef-cta photo-gallery__lightbox-nav photo-gallery__lightbox-nav--next" title="Next (→)">›</button>
        <img class="photo-gallery__lightbox-img" src="" alt="">
        <div class="photo-gallery__lightbox-counter"></div>
        <div class="photo-gallery__lightbox-caption"></div>
      </div>
    `;

    document.body.appendChild(this.lightboxElement);

    // Event listeners
    this.lightboxElement
      .querySelector('.photo-gallery__lightbox-close')
      .addEventListener('click', () => this.closeLightbox());
    this.lightboxElement
      .querySelector('.photo-gallery__lightbox-nav--prev')
      .addEventListener('click', () => this.previousPhoto());
    this.lightboxElement
      .querySelector('.photo-gallery__lightbox-nav--next')
      .addEventListener('click', () => this.nextPhoto());

    // Click outside to close
    this.lightboxElement.addEventListener('click', e => {
      if (e.target === this.lightboxElement) {
        this.closeLightbox();
      }
    });

    // Keyboard navigation
    document.addEventListener('keydown', e => {
      if (this.lightboxElement.classList.contains('active')) {
        if (e.key === 'Escape') {
          this.closeLightbox();
        }
        if (e.key === 'ArrowLeft') {
          this.previousPhoto();
        }
        if (e.key === 'ArrowRight') {
          this.nextPhoto();
        }
      }
    });

    // Touch gestures for mobile
    let touchStartX = 0;
    let touchEndX = 0;

    this.lightboxElement.addEventListener('touchstart', e => {
      touchStartX = e.changedTouches[0].screenX;
    });

    this.lightboxElement.addEventListener('touchend', e => {
      touchEndX = e.changedTouches[0].screenX;
      this.handleSwipe(touchStartX, touchEndX);
    });
  }

  handleSwipe(startX, endX) {
    const threshold = 50;
    const diff = startX - endX;

    if (Math.abs(diff) > threshold) {
      if (diff > 0) {
        this.nextPhoto();
      } else {
        this.previousPhoto();
      }
    }
  }

  openLightbox(index) {
    this.currentLightboxIndex = index;
    this.updateLightbox();
    this.lightboxElement.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  closeLightbox() {
    this.lightboxElement.classList.remove('active');
    document.body.style.overflow = '';
  }

  nextPhoto() {
    this.currentLightboxIndex = (this.currentLightboxIndex + 1) % this.photos.length;
    this.updateLightbox();
  }

  previousPhoto() {
    this.currentLightboxIndex =
      (this.currentLightboxIndex - 1 + this.photos.length) % this.photos.length;
    this.updateLightbox();
  }

  updateLightbox() {
    const photo = this.photos[this.currentLightboxIndex];
    const img = this.lightboxElement.querySelector('.photo-gallery__lightbox-img');
    const caption = this.lightboxElement.querySelector('.photo-gallery__lightbox-caption');
    const counter = this.lightboxElement.querySelector('.photo-gallery__lightbox-counter');

    img.src = photo.large || photo.url;
    img.alt = photo.caption || 'Photo';

    caption.textContent = photo.caption || '';
    caption.style.display = photo.caption ? 'block' : 'none';

    counter.textContent = `${this.currentLightboxIndex + 1} / ${this.photos.length}`;
  }

  deletePhoto(photo, index) {
    if (confirm('Are you sure you want to delete this photo?')) {
      this.onDelete(photo.id || photo.url, index);
      this.photos.splice(index, 1);
      this.renderGallery();
      if (this.lazyLoad) {
        this.setupLazyLoading();
      }
    }
  }

  // Drag and drop handlers
  handleDragStart(e, item) {
    this.draggedElement = item;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }

  handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  handleDrop(e, item) {
    e.preventDefault();

    if (this.draggedElement !== item) {
      const fromIndex = parseInt(this.draggedElement.dataset.index);
      const toIndex = parseInt(item.dataset.index);

      // Reorder photos array
      const [movedPhoto] = this.photos.splice(fromIndex, 1);
      this.photos.splice(toIndex, 0, movedPhoto);

      // Re-render
      this.renderGallery();
      if (this.lazyLoad) {
        this.setupLazyLoading();
      }

      // Callback with new order
      this.onReorder(this.photos.map(p => p.id).filter(id => id !== undefined));
    }
  }

  handleDragEnd() {
    if (this.draggedElement) {
      this.draggedElement.classList.remove('dragging');
      this.draggedElement = null;
    }

    // Remove drag-over class from all items
    this.grid.querySelectorAll('.photo-gallery__item').forEach(item => {
      item.classList.remove('drag-over');
    });
  }

  // Public methods
  updatePhotos(photos) {
    this.photos = photos;
    this.renderGallery();
    if (this.lazyLoad) {
      this.setupLazyLoading();
    }
  }

  addPhoto(photo) {
    this.photos.push(photo);
    this.renderGallery();
    if (this.lazyLoad) {
      this.setupLazyLoading();
    }
  }

  getElement() {
    return this.container;
  }

  appendTo(target) {
    const element = typeof target === 'string' ? document.querySelector(target) : target;
    if (element) {
      element.appendChild(this.container);
    }
    return this;
  }

  destroy() {
    if (this.lightboxElement) {
      this.lightboxElement.remove();
    }
    this.container.remove();
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PhotoGallery;
}
