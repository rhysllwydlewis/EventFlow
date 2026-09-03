/**
 * Supplier Dashboard Photo Gallery Management
 * Handles drag-and-drop photo uploads via the EventFlow REST API
 */

const isDevelopment =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
import supplierPhotoUpload from './supplier-photo-upload.js';
import supplierManager from './supplier-manager.js';

/** Photo allowance for the free tier, used until the real one has loaded. */
const DEFAULT_PHOTO_LIMIT = 10;

class SupplierGalleryManager {
  constructor() {
    this.currentSupplierId = null;
    this.uploadedPhotos = [];
    this.pendingUploads = [];
    this._dragSrc = null;
    this._filePickerInput = null;
    // Every plan used to be capped here at the free tier's ten photos, which
    // made "unlimited photos" on a paid plan a promise the product did not
    // keep. The real allowance comes from the subscription endpoint; the
    // server enforces it too, so this is presentation rather than a gate.
    this.maxPhotos = DEFAULT_PHOTO_LIMIT;
    this.loadPhotoLimit();
    this.init();
  }

  /**
   * Read the viewer's photo allowance from their subscription.
   *
   * A failure leaves the free-tier default in place: the upload route applies
   * the real limit either way, so the worst case is a paid supplier being
   * told to upload in smaller batches.
   * @returns {Promise<void>} Nothing.
   */
  async loadPhotoLimit() {
    try {
      const response = await fetch('/api/v2/subscriptions/me', { credentials: 'include' });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const limit = data?.limits?.maxPhotos;
      if (Number.isFinite(limit)) {
        this.maxPhotos = limit;
      }
    } catch {
      // Keep the default; the server is the authority.
    }
  }

  async ensureCsrfToken() {
    if (!window.__CSRF_TOKEN__) {
      try {
        const resp = await fetch('/api/v1/csrf-token', { credentials: 'include' });
        if (resp.ok) {
          const data = await resp.json();
          window.__CSRF_TOKEN__ = data.csrfToken;
        }
      } catch (e) {
        console.error('Failed to fetch CSRF token:', e);
      }
    }
    return window.__CSRF_TOKEN__ || '';
  }

  init() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setup());
    } else {
      this.setup();
    }
  }

  setup() {
    const dropZone = document.getElementById('sup-photo-drop');
    const previewContainer = document.getElementById('sup-photo-preview');

    if (!dropZone || !previewContainer) {
      if (isDevelopment) {
        console.log('Photo drop zone not found on this page');
      }
      return;
    }

    if (isDevelopment) {
      console.log('Setting up supplier gallery manager');
    }

    // Set up drag and drop (idempotent)
    this.setupDragAndDrop(dropZone, previewContainer);

    // Load existing photos if editing a supplier
    this.loadExistingPhotos();
  }

  setupDragAndDrop(dropZone, previewContainer) {
    if (dropZone.dataset.galleryBound === 'true') {
      return;
    }
    dropZone.dataset.galleryBound = 'true';

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, e => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    // Highlight drop zone when dragging
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, () => {
        dropZone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, () => {
        dropZone.classList.remove('dragover');
      });
    });

    // Handle dropped files
    dropZone.addEventListener('drop', e => {
      const files = e.dataTransfer.files;
      this.handleFiles(files, previewContainer);
    });

    // Handle click to upload
    dropZone.addEventListener('click', () => {
      this.openFilePicker(previewContainer);
    });
  }

  openFilePicker(previewContainer) {
    const now = Date.now();
    if (this._pickerOpeningUntil && now < this._pickerOpeningUntil) {
      return;
    }
    this._pickerOpeningUntil = now + 600;
    if (!this._filePickerInput) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.style.display = 'none';
      input.addEventListener('change', () => {
        this.handleFiles(input.files, previewContainer);
        // Reset value so re-selecting the same file still triggers change
        input.value = '';
      });
      document.body.appendChild(input);
      this._filePickerInput = input;
    }
    this._filePickerInput.click();
    setTimeout(() => {
      this._pickerOpeningUntil = 0;
    }, 650);
  }

  async handleFiles(files, previewContainer) {
    if (!files || files.length === 0) {
      return;
    }

    const fileArray = Array.from(files);

    // Validate number of photos against the viewer's plan allowance.
    const currentPhotoCount = this.uploadedPhotos.length + this.pendingUploads.length;
    const maxPhotos = this.maxPhotos;

    if (maxPhotos !== -1 && currentPhotoCount + fileArray.length > maxPhotos) {
      // Use Toast if available, fallback to alert
      if (typeof Toast !== 'undefined') {
        Toast.warning(
          `You can upload a maximum of ${maxPhotos} photos. You currently have ${currentPhotoCount} photos.`
        );
      } else {
        alert(
          `You can upload a maximum of ${maxPhotos} photos. You currently have ${currentPhotoCount} photos.`
        );
      }
      return;
    }

    // Add files to pending uploads and show preview
    for (const file of fileArray) {
      if (!file.type || !file.type.startsWith('image/')) {
        console.warn('Skipping non-image file:', file.name);
        continue;
      }

      // Add to pending uploads
      this.pendingUploads.push(file);

      // Show preview
      this.showPreview(file, previewContainer);
    }

    if (isDevelopment) {
      console.log(`Added ${fileArray.length} photos to upload queue`);
    }

    // For existing suppliers, upload immediately so selected photos are added to
    // the gallery without requiring another profile save.
    if (this.currentSupplierId) {
      await this.uploadPendingPhotos(this.currentSupplierId);
    }
  }

  showPreview(file, previewContainer) {
    const reader = new FileReader();

    reader.addEventListener('load', e => {
      const wrapper = document.createElement('div');
      wrapper.className = 'photo-preview-item photo-preview-item--pending';

      // "Pending" label so the user can distinguish staged files from uploaded ones
      const pendingBadge = document.createElement('span');
      pendingBadge.className = 'photo-pending-badge';
      pendingBadge.textContent = 'Pending';
      pendingBadge.setAttribute('aria-hidden', 'true');
      wrapper.appendChild(pendingBadge);

      // Remove button (before upload)
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '✕';
      removeBtn.className = 'photo-remove-btn';
      removeBtn.setAttribute('aria-label', 'Remove photo');
      removeBtn.title = 'Remove from upload queue';
      removeBtn.addEventListener('click', () => {
        // Remove from pending uploads - ensure pendingUploads is defined
        if (this.pendingUploads && Array.isArray(this.pendingUploads)) {
          const index = this.pendingUploads.indexOf(file);
          if (index > -1) {
            this.pendingUploads.splice(index, 1);
          }
        }
        // Remove preview
        wrapper.remove();
      });
      wrapper.appendChild(removeBtn);

      // Image container — overflow:hidden keeps the tile at a fixed size
      const imgWrap = document.createElement('div');
      imgWrap.className = 'photo-preview-item__image-wrap';
      const img = document.createElement('img');
      img.src = e.target.result;
      img.alt = file.name;
      img.addEventListener(
        'error',
        () => {
          if (img.dataset.errorHandled) {
            return;
          }
          img.dataset.errorHandled = '1';
          img.alt = 'Image unavailable';
          img.title = 'Could not load image';
          imgWrap.classList.add('photo-preview-item__image-wrap--error');
        },
        { once: true }
      );
      imgWrap.appendChild(img);
      wrapper.appendChild(imgWrap);

      previewContainer.appendChild(wrapper);
    });

    reader.readAsDataURL(file);
  }

  /**
   * @deprecated No-op kept for backward-compatibility.
   * Photo uploads are now triggered by app.js via window.uploadPendingGalleryPhotos()
   * after the supplier profile is saved, eliminating the duplicate-submit race condition.
   */
  setupFormIntercept(_form) {
    // No-op: photo uploads are triggered by app.js after a successful profile save.
  }

  /**
   * Upload any pending (staged) photos for the given supplier ID.
   * Called by the app.js save handler after the supplier profile has been
   * persisted, so we always have a valid supplier ID when uploading.
   * @param {string} supplierId
   * @returns {Promise<void>}
   */
  async uploadPendingGalleryPhotos(supplierId) {
    if (!supplierId) {
      return;
    }
    this.currentSupplierId = supplierId;
    if (this.pendingUploads.length > 0) {
      await this.uploadPendingPhotos(supplierId);
    }
  }

  async uploadPendingPhotos(supplierId) {
    if (this.pendingUploads.length === 0) {
      return;
    }

    const statusEl = document.getElementById('sup-status');
    if (statusEl) {
      statusEl.textContent = `Uploading ${this.pendingUploads.length} photo(s)...`;
    }

    try {
      const results = await supplierPhotoUpload.uploadMultiplePhotos(
        this.pendingUploads,
        supplierId,
        (current, total, photoData, _error) => {
          if (statusEl) {
            statusEl.textContent = `Uploading photo ${current} of ${total}...`;
          }

          if (photoData) {
            const newPhoto = {
              url: photoData.url,
              id: photoData.id || photoData.url,
            };
            this.uploadedPhotos.push(newPhoto);
          }
        }
      );

      // Check for errors
      const errors = results.filter(r => !r.success);
      if (errors.length > 0) {
        console.warn('Some photos failed to upload:', errors);
        if (statusEl) {
          statusEl.textContent = `${results.length - errors.length} of ${results.length} photos uploaded successfully`;
        }
      } else {
        if (statusEl) {
          statusEl.textContent = `All ${results.length} photos uploaded successfully!`;
        }
      }

      // Remove pending-upload preview tiles (they're now in the existing photos list)
      const previewContainer = document.getElementById('sup-photo-preview');
      if (previewContainer) {
        previewContainer
          .querySelectorAll('.photo-preview-item:not(.photo-preview-item--existing)')
          .forEach(el => el.remove());
        // Re-render the existing photos list to include the newly uploaded ones
        this.renderExistingPhotos(previewContainer);
      }

      // Clear pending uploads
      this.pendingUploads = [];

      if (isDevelopment) {
        console.log('Photos uploaded:', this.uploadedPhotos);
      }
    } catch (error) {
      console.error('Error uploading photos:', error);
      if (statusEl) {
        statusEl.textContent = `Error uploading photos: ${error.message}`;
      }
      throw error;
    }
  }

  async loadExistingPhotos() {
    const supplierIdField = document.getElementById('sup-id');
    if (!supplierIdField || !supplierIdField.value) {
      return; // No supplier ID, must be creating a new supplier
    }
    await this.loadPhotosForSupplier(supplierIdField.value);
  }

  /**
   * Load and render photos for a specific supplier.
   * Called both at setup time and whenever the supplier form is populated
   * (via window.loadSupplierGalleryPhotos exposed below).
   * @param {string} supplierId
   */
  async loadPhotosForSupplier(supplierId) {
    if (!supplierId) {
      return;
    }
    this.currentSupplierId = supplierId;

    try {
      const supplier = await supplierManager.getSupplier(supplierId);
      if (supplier && supplier.photosGallery && Array.isArray(supplier.photosGallery)) {
        this.uploadedPhotos = supplier.photosGallery.map((p, i) => ({
          url: p.url,
          id: p.id || p.url || `photo_${i}`,
        }));
      } else {
        this.uploadedPhotos = [];
      }

      const previewContainer = document.getElementById('sup-photo-preview');
      if (previewContainer) {
        this.renderExistingPhotos(previewContainer);
      }

      if (isDevelopment) {
        console.log('Loaded existing photos for supplier', supplierId, this.uploadedPhotos);
      }
    } catch (error) {
      console.error('Error loading existing photos:', error);
    }
  }

  /**
   * Render already-uploaded photos into the preview container.
   * Each tile has a delete button and a drag handle for reordering.
   */
  renderExistingPhotos(previewContainer) {
    // Remove any previously rendered existing-photo tiles (avoid duplicates on re-render)
    previewContainer.querySelectorAll('.photo-preview-item--existing').forEach(el => el.remove());
    // Remove any previous empty-state hint
    previewContainer.querySelectorAll('.photo-preview-empty-hint').forEach(el => el.remove());

    // Keep track of any pending-upload tiles so we insert existing photos before them
    const pendingNodes = Array.from(
      previewContainer.querySelectorAll('.photo-preview-item:not(.photo-preview-item--existing)')
    );

    this.uploadedPhotos.forEach((photo, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'photo-preview-item photo-preview-item--existing';
      wrapper.draggable = true;
      wrapper.dataset.photoId = photo.id;

      // "Cover" badge on first photo (absolutely positioned, inside wrapper)
      if (index === 0) {
        wrapper.classList.add('photo-preview-item--cover');
        const badge = document.createElement('span');
        badge.className = 'photo-first-badge';
        badge.textContent = 'Cover';
        wrapper.appendChild(badge);
      }

      // Drag handle (absolutely positioned, inside wrapper)
      const dragHandle = document.createElement('span');
      dragHandle.className = 'photo-drag-handle';
      dragHandle.title = 'Drag to reorder';
      dragHandle.setAttribute('aria-hidden', 'true');
      dragHandle.textContent = '⠿';
      wrapper.appendChild(dragHandle);

      // Delete button (absolutely positioned, inside wrapper)
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = '✕';
      deleteBtn.className = 'photo-remove-btn photo-delete-btn';
      deleteBtn.setAttribute('aria-label', 'Delete photo');
      deleteBtn.title = 'Delete photo';
      deleteBtn.addEventListener('click', () => this.deleteExistingPhoto(photo.id, wrapper));
      wrapper.appendChild(deleteBtn);

      // Image container — overflow:hidden keeps the tile fixed at 90×90 regardless
      // of image load state; absolute-positioned overlays (badge, handle, btn) sit above.
      const imgWrap = document.createElement('div');
      imgWrap.className = 'photo-preview-item__image-wrap';

      const img = document.createElement('img');
      img.src = photo.url;
      img.alt = 'Gallery photo';
      img.loading = 'lazy';
      img.addEventListener(
        'error',
        () => {
          if (img.dataset.errorHandled) {
            return;
          }
          img.dataset.errorHandled = '1';
          img.alt = 'Image unavailable';
          img.title = 'Could not load image';
          imgWrap.classList.add('photo-preview-item__image-wrap--error');
        },
        { once: true }
      );
      imgWrap.appendChild(img);
      wrapper.appendChild(imgWrap);

      // Insert before the first pending-upload tile (if any) so existing photos come first
      if (pendingNodes.length > 0 && pendingNodes[0].parentNode === previewContainer) {
        previewContainer.insertBefore(wrapper, pendingNodes[0]);
      } else {
        previewContainer.appendChild(wrapper);
      }
    });

    // Show empty-state hint when there are no photos at all (uploaded or pending)
    if (this.uploadedPhotos.length === 0 && pendingNodes.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'photo-preview-empty-hint';
      hint.textContent = 'No photos yet — drag & drop above to add some.';
      previewContainer.appendChild(hint);
    }

    this.attachExistingPhotoDragDrop(previewContainer);
    this.updateReorderBar();
  }

  /**
   * Delete an already-uploaded photo via the API.
   */
  async deleteExistingPhoto(photoId, wrapperEl) {
    if (!confirm('Remove this photo from your gallery?')) {
      return;
    }

    const supplierId = this.currentSupplierId;
    if (!supplierId) {
      return;
    }

    const deleteBtn = wrapperEl.querySelector('.photo-delete-btn');
    if (deleteBtn) {
      deleteBtn.disabled = true;
    }

    try {
      const csrfToken = await this.ensureCsrfToken();
      const response = await fetch(
        `/api/v1/me/suppliers/${encodeURIComponent(supplierId)}/photos/${encodeURIComponent(photoId)}`,
        {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'X-CSRF-Token': csrfToken },
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const msg = err.error || 'Failed to delete photo';
        if (typeof Toast !== 'undefined') {
          Toast.error(msg);
        } else {
          alert(msg);
        }
        if (deleteBtn) {
          deleteBtn.disabled = false;
        }
        return;
      }

      // Remove from local state
      this.uploadedPhotos = this.uploadedPhotos.filter(p => p.id !== photoId);

      // Remove from DOM
      wrapperEl.remove();

      // Refresh "Cover" badge position
      const previewContainer = document.getElementById('sup-photo-preview');
      if (previewContainer) {
        this._refreshFirstBadge(previewContainer);
      }

      this.updateReorderBar();
    } catch (e) {
      console.error('Error deleting photo:', e);
      if (typeof Toast !== 'undefined') {
        Toast.error('Failed to delete photo. Please try again.');
      } else {
        alert('Failed to delete photo. Please try again.');
      }
      if (deleteBtn) {
        deleteBtn.disabled = false;
      }
    }
  }

  /**
   * Attach drag-and-drop handlers for reordering existing photos.
   * Guards against multiple calls by using a data attribute on the container.
   */
  attachExistingPhotoDragDrop(container) {
    // Only attach once — re-renders clear and re-create tiles but keep the same container
    if (container.dataset.dragHandlersAttached) {
      return;
    }
    container.dataset.dragHandlersAttached = '1';

    container.addEventListener('dragstart', e => {
      const item = e.target.closest('.photo-preview-item--existing');
      if (!item) {
        return;
      }
      this._dragSrc = item;
      item.classList.add('photo-gallery-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    container.addEventListener('dragend', e => {
      const item = e.target.closest('.photo-preview-item--existing');
      if (item) {
        item.classList.remove('photo-gallery-dragging');
      }
      container.querySelectorAll('.photo-preview-item--existing').forEach(el => {
        el.classList.remove('photo-gallery-drag-over');
      });
      this._dragSrc = null;
      this._refreshFirstBadge(container);
      this.markOrderDirty();
    });

    container.addEventListener('dragover', e => {
      const item = e.target.closest('.photo-preview-item--existing');
      if (!item || item === this._dragSrc) {
        return;
      }
      e.preventDefault();
      container.querySelectorAll('.photo-preview-item--existing').forEach(el => {
        el.classList.remove('photo-gallery-drag-over');
      });
      item.classList.add('photo-gallery-drag-over');
      e.dataTransfer.dropEffect = 'move';
    });

    container.addEventListener('dragleave', e => {
      const item = e.target.closest('.photo-preview-item--existing');
      if (item) {
        item.classList.remove('photo-gallery-drag-over');
      }
    });

    container.addEventListener('drop', e => {
      e.preventDefault();
      const target = e.target.closest('.photo-preview-item--existing');
      if (!target || !this._dragSrc || target === this._dragSrc) {
        return;
      }
      target.classList.remove('photo-gallery-drag-over');

      const rect = target.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (e.clientX < midX) {
        container.insertBefore(this._dragSrc, target);
      } else {
        container.insertBefore(this._dragSrc, target.nextSibling);
      }
    });
  }

  /**
   * Show "Cover" badge only on the first existing-photo tile.
   * The badge is inserted before the image-wrap div so it sits above the image.
   */
  _refreshFirstBadge(container) {
    const items = container.querySelectorAll('.photo-preview-item--existing');
    items.forEach((item, idx) => {
      let badge = item.querySelector('.photo-first-badge');
      if (idx === 0) {
        item.classList.add('photo-preview-item--cover');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'photo-first-badge';
          badge.textContent = 'Cover';
          // Insert before the image-wrap so it appears inside the tile overlay stack
          const imgWrap = item.querySelector('.photo-preview-item__image-wrap');
          item.insertBefore(badge, imgWrap || item.firstChild);
        }
      } else {
        item.classList.remove('photo-preview-item--cover');
        if (badge) {
          badge.remove();
        }
      }
    });
  }

  /**
   * Show or hide the save-order bar depending on whether there are ≥2 photos.
   */
  updateReorderBar() {
    const bar = document.getElementById('sup-gallery-reorder-bar');
    if (!bar) {
      return;
    }
    const count = this.uploadedPhotos.length;
    bar.style.display = count >= 2 ? '' : 'none';
    const status = document.getElementById('sup-gallery-order-status');
    if (status) {
      status.textContent = '';
    }
  }

  /**
   * Mark the order as changed (show save bar).
   */
  markOrderDirty() {
    const bar = document.getElementById('sup-gallery-reorder-bar');
    if (bar) {
      bar.style.display = '';
    }
    const status = document.getElementById('sup-gallery-order-status');
    if (status) {
      status.textContent = '';
    }
  }

  /**
   * Collect the current order from the DOM and persist via the API.
   */
  async savePhotoOrder() {
    const container = document.getElementById('sup-photo-preview');
    const supplierId = this.currentSupplierId;
    if (!container || !supplierId) {
      return;
    }

    const photoIds = Array.from(
      container.querySelectorAll('.photo-preview-item--existing[data-photo-id]')
    ).map(el => el.dataset.photoId);

    const saveBtn = document.getElementById('sup-gallery-save-order');
    const status = document.getElementById('sup-gallery-order-status');
    if (saveBtn) {
      saveBtn.disabled = true;
    }
    if (status) {
      status.textContent = 'Saving…';
    }

    try {
      const csrfToken = await this.ensureCsrfToken();
      const response = await fetch(
        `/api/v1/me/suppliers/${encodeURIComponent(supplierId)}/photos/order`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({ photoIds }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        if (status) {
          status.textContent = `Error: ${err.error || 'Could not save order'}`;
        }
      } else {
        const data = await response.json();
        if (data.photosGallery) {
          this.uploadedPhotos = data.photosGallery.map((p, i) => ({
            url: p.url,
            id: p.id || p.url || `photo_${i}`,
          }));
        }
        if (status) {
          status.textContent = '✓ Order saved';
          setTimeout(() => {
            status.textContent = '';
          }, 3000);
        }
        this._refreshFirstBadge(container);
      }
    } catch (e) {
      console.error('Error saving photo order:', e);
      if (status) {
        status.textContent = 'Network error — please try again';
      }
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
      }
    }
  }
}

// Initialize when the module loads
const galleryManager = new SupplierGalleryManager();

// Expose save-order so the HTML button can call it directly
window.saveSupplierGalleryOrder = () => galleryManager.savePhotoOrder();

// Expose photo-load so populateSupplierForm (app.js) can trigger a reload
// whenever the supplier edit form is populated with a different supplier.
window.loadSupplierGalleryPhotos = supplierId => galleryManager.loadPhotosForSupplier(supplierId);

// Expose pending-photo upload so app.js can trigger uploads after the
// supplier profile has been successfully saved and a supplier ID is known.
window.uploadPendingGalleryPhotos = supplierId =>
  galleryManager.uploadPendingGalleryPhotos(supplierId);

// Expose gallery picker opener so external actions can invoke the same single flow.
window.openSupplierGalleryPicker = () =>
  galleryManager.openFilePicker(document.getElementById('sup-photo-preview'));

export default galleryManager;
