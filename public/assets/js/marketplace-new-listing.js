/**
 * Marketplace New Listing Form
 * Handles creating and editing marketplace listings
 */

'use strict';
(function () {
  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  let selectedImages = [];
  let isEditMode = false;
  let editingListingId = null;
  let currentUser = null;

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  async function init() {
    // Check if user is authenticated
    const authOk = await checkAuth();
    if (!authOk) {
      return; // User will be redirected
    }

    // Check if we're in edit mode
    const urlParams = new URLSearchParams(window.location.search);
    editingListingId = urlParams.get('edit');
    if (editingListingId) {
      isEditMode = true;
      await loadListingForEdit(editingListingId);
    }

    initImageUpload();
    initCharacterCount();
    initFormSubmission();
  }

  /**
   * Check authentication status
   */
  async function checkAuth() {
    try {
      const res = await fetch('/api/v1/auth/me', {
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      });

      if (res.status === 401) {
        // Not logged in - redirect to auth
        window.location.href = '/auth?redirect=/supplier/marketplace-new-listing&intent=listing';
        return false;
      }

      if (!res.ok) {
        showToast('Unable to verify authentication', 'error');
        setTimeout(() => {
          window.location.href = '/auth';
        }, 2000);
        return false;
      }

      const data = await res.json();

      // Handle both wrapped ({user: ...}) and unwrapped response formats
      if (data.user !== undefined) {
        currentUser = data.user;
      } else if (data.id) {
        currentUser = data;
      } else {
        currentUser = null;
      }

      if (!currentUser) {
        window.location.href = '/auth?redirect=/supplier/marketplace-new-listing&intent=listing';
        return false;
      }

      return true;
    } catch (error) {
      console.error('Auth check failed:', error);
      showToast('Connection error. Please check your internet.', 'error');
      return false;
    }
  }

  /**
   * Load existing listing for editing
   */
  async function loadListingForEdit(listingId) {
    try {
      const res = await fetch(`/api/v1/marketplace/my-listings/${listingId}`, {
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Failed to load listing');
      }

      const data = await res.json();
      const listing = data.listing || data;

      // Populate form fields
      document.getElementById('listing-title').value = listing.title || '';
      document.getElementById('listing-description').value = listing.description || '';
      document.getElementById('listing-price').value = listing.price || '';
      document.getElementById('listing-location').value = listing.location || '';
      document.getElementById('listing-category').value = listing.category || '';
      document.getElementById('listing-condition').value = listing.condition || '';

      // Load images
      if (listing.images && listing.images.length > 0) {
        selectedImages = listing.images
          .map(image => {
            const imageUrl = typeof image === 'string' ? image : image?.url;
            return imageUrl ? { url: imageUrl, existing: true } : null;
          })
          .filter(Boolean);
        renderImagePreviews();
      }

      // Update page title
      document.querySelector('.form-header h1').textContent = 'Edit Listing';
      document.querySelector('button[type="submit"]').textContent = 'Update Listing';
    } catch (error) {
      console.error('Error loading listing:', error);
      showToast('Failed to load listing for editing', 'error');
      setTimeout(() => {
        window.location.href = '/my-marketplace-listings';
      }, 2000);
    }
  }

  /**
   * Initialize image upload functionality
   */
  function initImageUpload() {
    const zone = document.getElementById('image-upload-zone');
    const input = document.getElementById('listing-images');

    // Click to upload
    zone.addEventListener('click', () => {
      input.click();
    });

    // File input change
    input.addEventListener('change', handleFileSelect);

    // Drag and drop
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('dragover');

      const files = Array.from(e.dataTransfer.files);
      handleFiles(files);
    });
  }

  /**
   * Handle file selection
   */
  function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    handleFiles(files);
  }

  /**
   * Process selected files
   */
  async function handleFiles(files) {
    // Limit to 5 images total
    const remaining = 5 - selectedImages.length;
    if (remaining <= 0) {
      showToast('Maximum 5 images allowed', 'error');
      return;
    }

    const filesToProcess = files.slice(0, remaining);

    for (const file of filesToProcess) {
      // **NEW: Validate File object integrity**
      if (!file.name || typeof file.name !== 'string') {
        console.error('Invalid File object - missing name property:', file);
        showToast('Invalid file detected. Please try selecting the file again.', 'error');
        continue;
      }

      // Validate file type - use specific allowlist matching server
      const allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/avif',
        'image/heic',
      ];
      if (!allowedTypes.includes(file.type)) {
        showToast(
          `${file.name} is not a supported image type (allowed: JPEG, PNG, WebP, GIF, AVIF, HEIC)`,
          'error'
        );
        continue;
      }

      // Validate file size (10MB max to match server)
      if (file.size > 10 * 1024 * 1024) {
        showToast(`${file.name} is too large (max 10MB)`, 'error');
        continue;
      }

      // **NEW: Additional validation**
      if (file.size === 0) {
        console.error('Empty file detected:', file.name);
        showToast(`${file.name} is empty or corrupted`, 'error');
        continue;
      }

      // Show loading state
      showToast(`Processing ${file.name}...`, 'info');

      // Create preview (read as base64 for preview only)
      try {
        const reader = new FileReader();
        reader.onload = e => {
          // **NEW: Double-check file integrity before adding**
          if (!file || !file.name) {
            console.error('File became invalid during processing');
            showToast('File became invalid. Please try again.', 'error');
            return;
          }

          selectedImages.push({
            file: file, // Store actual File object
            preview: e.target.result, // Base64 preview only
            new: true,
          });
          renderImagePreviews();
          showToast(`${file.name} ready to upload`, 'success');
        };
        reader.onerror = () => {
          console.error('Error reading file:', file.name);
          showToast(
            `Could not read ${file.name}. The file may be corrupted or in an unsupported format.`,
            'error'
          );
        };
        reader.readAsDataURL(file);
      } catch (error) {
        console.error('Error processing image:', error);
        showToast(`Failed to process ${file.name}`, 'error');
      }
    }
  }

  /**
   * Render image previews
   */
  function renderImagePreviews() {
    const grid = document.getElementById('image-preview-grid');

    if (selectedImages.length === 0) {
      grid.innerHTML = '';
      return;
    }

    grid.innerHTML = selectedImages
      .map(
        (img, index) => `
      <div class="image-preview-item">
        <img src="${img.preview || img.url}" alt="Preview ${index + 1}">
        <button 
          type="button" 
          class="ef-cta image-preview-remove" 
          onclick="window.NewListing.removeImage(${index})"
          aria-label="Remove image"
        >×</button>
      </div>
    `
      )
      .join('');
  }

  /**
   * Remove an image
   */
  function removeImage(index) {
    selectedImages.splice(index, 1);
    renderImagePreviews();
  }

  /**
   * Initialize character count for description
   */
  function initCharacterCount() {
    const textarea = document.getElementById('listing-description');
    const counter = document.getElementById('char-count');

    textarea.addEventListener('input', () => {
      const length = textarea.value.length;
      counter.textContent = length;

      if (length > 900) {
        counter.style.color = '#dc2626';
      } else {
        counter.style.color = '#6b7280';
      }
    });
  }

  /**
   * Refresh CSRF token from server
   */
  async function refreshCsrfToken() {
    try {
      const res = await fetch('/api/v1/csrf-token', {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        window.__CSRF_TOKEN__ = data.token || data.csrfToken;
        return window.__CSRF_TOKEN__;
      }
    } catch (error) {
      console.error('Failed to refresh CSRF token:', error);
    }
    return null;
  }

  /**
   * Helper to perform batch upload with CSRF retry support
   */
  async function performBatchUpload(listingId, formData, csrfToken) {
    const uploadUrl = `/api/v1/photos/upload/batch?type=marketplace&id=${listingId}`;

    const response = await fetch(uploadUrl, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': csrfToken },
      body: formData,
    });

    const data = await response.json().catch(() => ({}));

    // Check for CSRF error and retry once with refreshed token
    if (response.status === 403 && data.errorType === 'CSRFError' && data.canRetry) {
      if (isDevelopment) {
        console.log('CSRF error detected, refreshing token and retrying...');
      }
      const newToken = await refreshCsrfToken();
      if (newToken) {
        const retryResponse = await fetch(uploadUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-CSRF-Token': newToken },
          body: formData,
        });
        const retryData = await retryResponse.json().catch(() => ({}));
        if (retryResponse.ok) {
          showToast('Upload succeeded after refreshing security token', 'success');
        }
        return { response: retryResponse, data: retryData };
      }
    }

    return { response, data };
  }

  async function uploadMarketplaceImages(newImages, listingId, csrfToken) {
    try {
      const formData = new FormData();

      // **NEW: Validate and log files before appending**
      const validFiles = [];
      for (const img of newImages) {
        if (!img.file) {
          console.error('Image object missing file property:', img);
          continue;
        }
        if (!img.file.name || typeof img.file.name !== 'string') {
          console.error('File missing name property:', img.file);
          continue;
        }
        validFiles.push(img);

        // Log file details for debugging
        console.debug('Appending file to FormData:', {
          name: img.file.name,
          type: img.file.type,
          size: img.file.size,
          lastModified: img.file.lastModified,
        });

        formData.append('photos', img.file);
      }

      if (validFiles.length === 0) {
        showToast('No valid files to upload', 'error');
        return newImages.length; // All failed
      }

      const { response: batchRes, data: batchData } = await performBatchUpload(
        listingId,
        formData,
        csrfToken
      );

      if (batchRes.ok) {
        return Array.isArray(batchData.errors) ? batchData.errors.length : 0;
      }

      // Enhanced error logging - **ALREADY EXISTS, keeping as-is**
      console.error('Batch image upload failed:', {
        status: batchRes.status,
        statusText: batchRes.statusText,
        error: batchData.error,
        errorType: batchData.errorType,
        details: batchData.details,
        errors: batchData.errors,
      });

      // Show detailed error messages from server
      let errorMessage = 'Photo upload failed. ';
      if (batchData.errorType === 'UnsupportedMediaType') {
        errorMessage =
          'Unsupported file type. Only JPEG, PNG, WebP, GIF, AVIF, and HEIC images are allowed.';
      } else if (batchData.errorType === 'FileSizeError') {
        errorMessage = 'File too large. Maximum 10MB per image.';
      } else if (
        batchData.errors &&
        Array.isArray(batchData.errors) &&
        batchData.errors.length > 0
      ) {
        const errorDetails = batchData.errors
          .map(e => `${e.filename || 'unknown'}: ${e.error || 'upload failed'}`)
          .join('; ');
        errorMessage += errorDetails;
      } else if (batchRes.status === 500) {
        errorMessage +=
          'Please try uploading smaller images (max 10MB each) or fewer images at once.';
      } else if (batchRes.status === 413) {
        errorMessage += 'Images are too large. Please reduce file size.';
      } else if (batchData.error) {
        errorMessage += batchData.error;
      } else {
        errorMessage += 'Retrying with individual uploads...';
      }

      showToast(errorMessage, 'error');
    } catch (error) {
      console.error('Batch image upload network error:', error);
      showToast(
        'Network error during upload. Please check your connection and try again.',
        'error'
      );
    }

    // Fallback to individual uploads
    let failedImageCount = 0;

    async function uploadSingleImageWithField(fieldName, imageFile) {
      const singleFormData = new FormData();
      singleFormData.append(fieldName, imageFile);

      try {
        const singleRes = await fetch(`/api/v1/photos/upload?type=marketplace&id=${listingId}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-CSRF-Token': csrfToken },
          body: singleFormData,
        });

        const singleData = await singleRes.json().catch(() => ({}));

        if (singleRes.ok) {
          return true;
        }

        // Log specific error for this file
        console.warn('Single image upload failed:', {
          fieldName,
          fileName: imageFile.name,
          status: singleRes.status,
          error: singleData.error,
          errorType: singleData.errorType,
          details: singleData.details,
          errors: singleData.errors,
        });

        // Show specific error if available
        if (singleData.error) {
          showToast(`${imageFile.name}: ${singleData.error}`, 'error');
        }

        return false;
      } catch (error) {
        console.warn('Single image upload network error:', {
          fieldName,
          fileName: imageFile.name,
          error: error.message,
        });
        return false;
      }
    }

    for (const image of newImages) {
      try {
        // Use 'photos' field name consistently (server accepts both 'files' and 'photos')
        const uploaded = await uploadSingleImageWithField('photos', image.file);

        if (!uploaded) {
          failedImageCount += 1;
        }
      } catch (error) {
        console.warn('Individual image upload failed:', error);
        failedImageCount += 1;
      }
    }

    return failedImageCount;
  }

  /**
   * Initialize form submission
   */
  function initFormSubmission() {
    const form = document.getElementById('new-listing-form');

    form.addEventListener('submit', async e => {
      e.preventDefault();

      // Disable submit button to prevent double submission
      const submitBtn = form.querySelector('button[type="submit"]');
      const originalText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = isEditMode ? 'Updating...' : 'Publishing...';

      try {
        // Get CSRF token
        const csrfToken = window.__CSRF_TOKEN__ || '';

        // Prepare listing data WITHOUT images
        const listingData = {
          title: document.getElementById('listing-title').value.trim(),
          description: document.getElementById('listing-description').value.trim(),
          price: parseFloat(document.getElementById('listing-price').value),
          location: document.getElementById('listing-location').value.trim(),
          category: document.getElementById('listing-category').value,
          condition: document.getElementById('listing-condition').value,
          images: selectedImages.filter(img => !img.new).map(img => img.url),
        };

        // Validate required fields
        if (
          !listingData.title ||
          !listingData.description ||
          listingData.price === undefined ||
          listingData.price === null ||
          listingData.price === '' ||
          !listingData.category ||
          !listingData.condition
        ) {
          throw new Error('Please fill in all required fields');
        }

        if (listingData.price < 0) {
          throw new Error('Price must be 0 or greater');
        }

        // Submit to API
        const url = isEditMode
          ? `/api/marketplace/listings/${editingListingId}`
          : '/api/marketplace/listings';

        const method = isEditMode ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method: method,
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify(listingData),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(
            errorData.error || `Failed to ${isEditMode ? 'update' : 'create'} listing`
          );
        }

        const responseData = await res.json();
        const listingId = responseData.listing?.id || editingListingId;

        // Upload new images in one batch request to avoid race conditions
        const newImages = selectedImages.filter(img => img.new && img.file);
        let failedImageCount = 0;

        if (newImages.length > 0) {
          failedImageCount = await uploadMarketplaceImages(newImages, listingId, csrfToken);
        }

        // Show appropriate success message
        if (failedImageCount > 0) {
          const successCount = newImages.length - failedImageCount;
          const listingAction = isEditMode ? 'updated' : 'created';
          showToast(
            `Listing ${listingAction}: ${successCount} of ${newImages.length} image(s) uploaded, ${failedImageCount} failed. Try selecting the files again if they failed.`,
            'warning'
          );
        } else {
          showToast(
            isEditMode
              ? 'Listing updated successfully!'
              : "Listing published successfully! It's now live on the marketplace.",
            'success'
          );
        }

        // Redirect to my listings page after a short delay
        setTimeout(() => {
          window.location.href = '/my-marketplace-listings';
        }, 1500);
      } catch (error) {
        console.error('Error submitting listing:', error);
        showToast(error.message || 'Failed to submit listing', 'error');

        // Re-enable submit button
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    });
  }

  /**
   * Show toast notification
   */
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: ${type === 'error' ? '#dc2626' : type === 'warning' ? '#d97706' : '#16a34a'};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 10000;
      max-width: 90%;
      text-align: center;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // Expose functions that need to be called from HTML onclick handlers
  window.NewListing = {
    removeImage,
  };
})();
