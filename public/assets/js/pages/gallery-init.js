'use strict';

let selectedFiles = [];
let currentImages = [];
let currentLightboxIndex = 0;
const API_BASE = '/api';

// Drag and drop
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');

dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', e => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', e => {
  handleFiles(e.target.files);
});

function handleFiles(files) {
  selectedFiles = Array.from(files).filter(file => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert(`${file.name} is not an image file`);
      return false;
    }
    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert(`${file.name} is too large (max 10MB)`);
      return false;
    }
    return true;
  });

  document.getElementById('fileCount').textContent = selectedFiles.length;
  document.getElementById('uploadBtn').disabled = selectedFiles.length === 0;

  // Show preview
  if (selectedFiles.length > 0) {
    dropzone.classList.add('uploading');
    dropzone.querySelector('.upload-text').textContent =
      `${selectedFiles.length} file(s) ready to upload`;
  }
}

// Modal management
const uploadModal = document.getElementById('uploadModal');
const modalClose = document.getElementById('modalClose');
const modalCancel = document.getElementById('modalCancel');
const modalConfirm = document.getElementById('modalConfirm');
const uploadTarget = document.getElementById('uploadTarget');

function showModal() {
  uploadModal.classList.add('visible');
  loadSelectOptions();
}

function hideModal() {
  uploadModal.classList.remove('visible');
}

async function loadSelectOptions() {
  const checkedRadio = document.querySelector('input[name="uploadType"]:checked');
  const uploadType = checkedRadio ? checkedRadio.value : 'supplier';
  uploadTarget.innerHTML = '<option value="">Loading...</option>';

  try {
    const endpoint = uploadType === 'supplier' ? '/api/me/suppliers' : '/api/me/packages';
    const response = await fetch(endpoint, { credentials: 'include' });
    if (response.ok) {
      const data = await response.json();
      const items = data.items || [];

      if (items.length === 0) {
        uploadTarget.innerHTML = `<option value="">No ${uploadType}s found</option>`;
      } else {
        uploadTarget.innerHTML = items
          .map(
            item =>
              `<option value="${item.id || item._id}">${item.name || item.title || 'Unnamed'}</option>`
          )
          .join('');
      }
    }
  } catch (error) {
    uploadTarget.innerHTML = '<option value="">Error loading items</option>';
  }
}

// Radio button change handler
document.querySelectorAll('input[name="uploadType"]').forEach(radio => {
  radio.addEventListener('change', loadSelectOptions);
});

modalClose.addEventListener('click', hideModal);
modalCancel.addEventListener('click', hideModal);

// Close on overlay click
uploadModal.addEventListener('click', e => {
  if (e.target === uploadModal) {
    hideModal();
  }
});

// Escape key to close
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && uploadModal.classList.contains('visible')) {
    hideModal();
  }
});

async function uploadFiles() {
  if (selectedFiles.length === 0) {
    return;
  }
  showModal();
}

modalConfirm.addEventListener('click', async () => {
  const checkedRadio = document.querySelector('input[name="uploadType"]:checked');
  const uploadType = checkedRadio ? checkedRadio.value : 'supplier';
  const id = uploadTarget.value;

  if (!id) {
    alert('Please select an item');
    return;
  }

  hideModal();

  const formData = new FormData();
  selectedFiles.forEach(file => {
    formData.append('photos', file);
  });

  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  progressContainer.style.display = 'block';

  try {
    // Simulate progress (since we can't track real upload progress easily)
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += 10;
      if (progress >= 90) {
        clearInterval(progressInterval);
      }
      progressFill.style.width = `${progress}%`;
      progressFill.textContent = `${progress}%`;
    }, 200);

    const response = await fetch(`${API_BASE}/photos/upload/batch?type=${uploadType}&id=${id}`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    clearInterval(progressInterval);
    progressFill.style.width = '100%';
    progressFill.textContent = '100%';

    const result = await response.json();

    if (response.ok) {
      if (typeof window.EFToast !== 'undefined') {
        window.EFToast.success(result.message || 'Upload successful!');
      } else {
        alert(result.message || 'Upload successful!');
      }

      // Reset
      selectedFiles = [];
      fileInput.value = '';
      document.getElementById('fileCount').textContent = '0';
      document.getElementById('uploadBtn').disabled = true;
      dropzone.classList.remove('uploading');
      dropzone.querySelector('.upload-text').textContent = 'Drag & Drop Images Here';

      setTimeout(() => {
        progressContainer.style.display = 'none';
        progressFill.style.width = '0%';
      }, 1000);

      loadGallery();
    } else {
      if (typeof window.EFToast !== 'undefined') {
        window.EFToast.error(`Upload failed: ${result.error || 'Unknown error'}`);
      } else {
        alert(`Upload failed: ${result.error || 'Unknown error'}`);
      }
      progressContainer.style.display = 'none';
    }
  } catch (error) {
    console.error('Upload error:', error);
    alert(`Upload failed: ${error.message}`);
    progressContainer.style.display = 'none';
  }
});

async function fetchCsrfToken() {
  try {
    const response = await fetch('/api/auth/csrf', {
      credentials: 'include',
    });
    const data = await response.json();
    return data.csrfToken;
  } catch (error) {
    console.error('Failed to fetch CSRF token:', error);
    return null;
  }
}

async function deletePhoto(photoId) {
  if (!confirm('Are you sure you want to delete this photo?')) {
    return;
  }

  try {
    const urlParams = new URLSearchParams(window.location.search);
    const supplierId = urlParams.get('supplierId') || urlParams.get('id');

    if (!supplierId) {
      alert('Supplier ID not found');
      return;
    }

    // Get CSRF token - check window first, only fetch if not available
    let csrfToken = window.__CSRF_TOKEN__;
    if (!csrfToken) {
      csrfToken = await fetchCsrfToken();
    }

    const response = await fetch(`${API_BASE}/me/suppliers/${supplierId}/photos/${photoId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        'X-CSRF-Token': csrfToken,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to delete photo');
    }

    alert('Photo deleted successfully');
    loadGallery(); // Reload gallery
  } catch (error) {
    console.error('Delete photo error:', error);
    alert(`Failed to delete photo: ${error.message}`);
  }
}

async function loadGallery() {
  const loading = document.getElementById('loading');
  const galleryGrid = document.getElementById('galleryGrid');
  const emptyState = document.getElementById('emptyState');

  loading.style.display = 'block';
  galleryGrid.innerHTML = '';
  emptyState.style.display = 'none';

  try {
    // Get supplierId from URL params or prompt
    const urlParams = new URLSearchParams(window.location.search);
    const supplierId = urlParams.get('supplierId') || urlParams.get('id');

    if (!supplierId) {
      // No supplier ID provided, show empty state
      loading.style.display = 'none';
      emptyState.style.display = 'block';
      document.getElementById('photoCount').textContent = '0';
      return;
    }

    // Fetch photos from API
    const response = await fetch(`${API_BASE}/me/suppliers/${supplierId}/photos`, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch photos');
    }

    const data = await response.json();
    currentImages = data.photos || [];

    loading.style.display = 'none';

    if (currentImages.length === 0) {
      emptyState.style.display = 'block';
      document.getElementById('photoCount').textContent = '0';
    } else {
      renderGallery(currentImages);
      document.getElementById('photoCount').textContent = currentImages.length;
    }
  } catch (error) {
    console.error('Load gallery error:', error);
    loading.style.display = 'none';
    // Show empty state on error with message
    emptyState.style.display = 'block';
    document.getElementById('photoCount').textContent = '0';

    // Show error message to user
    const errorMsg =
      error.message === 'Failed to fetch photos'
        ? 'Unable to load photos. Please check your connection and try again.'
        : `Error loading gallery: ${error.message}`;

    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = errorMsg;
    emptyState.parentNode.insertBefore(errorDiv, emptyState.nextSibling);
  }
}

function renderGallery(images) {
  const galleryGrid = document.getElementById('galleryGrid');
  galleryGrid.innerHTML = '';

  images.forEach((image, index) => {
    const item = document.createElement('div');
    item.className = `gallery-item ${image.approved ? 'approved' : 'pending'}`;

    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'image-wrapper';
    imageWrapper.addEventListener('click', () => openLightbox(index));

    const img = document.createElement('img');
    img.className = 'gallery-image';
    img.src = image.thumbnail || image.url;
    img.alt = 'Photo';
    img.loading = 'lazy';

    const status = document.createElement('span');
    status.className = `image-status status-${image.approved ? 'approved' : 'pending'}`;
    status.textContent = image.approved ? '✓ Approved' : '⏳ Pending';

    imageWrapper.appendChild(img);
    imageWrapper.appendChild(status);

    const actions = document.createElement('div');
    actions.className = 'image-actions';

    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn btn-small btn-warning';
    viewBtn.textContent = '👁️ View';
    viewBtn.addEventListener('click', () => viewImage(image.large || image.url));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-small btn-danger';
    deleteBtn.textContent = '🗑️ Delete';
    deleteBtn.addEventListener('click', e => {
      e.stopPropagation();
      deletePhoto(image.id);
    });

    actions.appendChild(viewBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(imageWrapper);
    item.appendChild(actions);
    galleryGrid.appendChild(item);
  });
}

function openLightbox(index) {
  currentLightboxIndex = index;
  const image = currentImages[index];
  document.getElementById('lightboxImage').src = image.large || image.url;
  document.getElementById('lightbox').classList.add('active');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('active');
}

function navigateLightbox(direction) {
  currentLightboxIndex += direction;
  if (currentLightboxIndex < 0) {
    currentLightboxIndex = currentImages.length - 1;
  }
  if (currentLightboxIndex >= currentImages.length) {
    currentLightboxIndex = 0;
  }

  const image = currentImages[currentLightboxIndex];
  document.getElementById('lightboxImage').src = image.large || image.url;
}

function viewImage(url) {
  window.open(url, '_blank');
}

async function deleteImage(url, type, id) {
  if (!confirm('Are you sure you want to delete this image?')) {
    return;
  }

  try {
    const response = await fetch(
      `${API_BASE}/photos/delete?type=${type}&id=${id}&photoUrl=${encodeURIComponent(url)}`,
      {
        method: 'DELETE',
        credentials: 'include',
      }
    );

    const result = await response.json();

    if (response.ok) {
      alert('Image deleted successfully');
      loadGallery();
    } else {
      alert(`Delete failed: ${result.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Delete error:', error);
    alert(`Delete failed: ${error.message}`);
  }
}

// Keyboard navigation for lightbox
document.addEventListener('keydown', e => {
  const lightbox = document.getElementById('lightbox');
  if (lightbox.classList.contains('active')) {
    if (e.key === 'ArrowLeft') {
      navigateLightbox(-1);
    }
    if (e.key === 'ArrowRight') {
      navigateLightbox(1);
    }
    if (e.key === 'Escape') {
      lightbox.classList.remove('active');
    }
  }
});

// Setup event listeners for UI controls
document.getElementById('browseFilesBtn').addEventListener('click', () => {
  document.getElementById('fileInput').click();
});

document.getElementById('uploadBtn').addEventListener('click', uploadFiles);

document.getElementById('filterType').addEventListener('change', loadGallery);
document.getElementById('filterStatus').addEventListener('change', loadGallery);

// Lightbox controls
const lightbox = document.getElementById('lightbox');
lightbox.addEventListener('click', e => {
  if (e.target.id === 'lightbox') {
    closeLightbox();
  }
});

document.getElementById('lightboxClose').addEventListener('click', closeLightbox);

document.getElementById('lightboxPrev').addEventListener('click', e => {
  e.stopPropagation();
  navigateLightbox(-1);
});

document.getElementById('lightboxNext').addEventListener('click', e => {
  e.stopPropagation();
  navigateLightbox(1);
});

// Load gallery on page load
loadGallery();
