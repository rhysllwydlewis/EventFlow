'use strict';
(function () {
  let allPackages = [];
  let allSuppliers = [];
  let currentImageFile = null;
  let currentImageUrl = null;
  let currentFilter = 'all'; // Track current filter state
  // 221 packages used to be drawn at once; now 50 a page, with Previous / Next under the table
  const PACKAGE_PAGE_SIZE = 50;
  let packagePage = 1;
  let packagePager = null;
  // Set by a link such as /admin-packages?supplierId=… (from the supplier page)
  let supplierFilterId = null;

  // Gliding to the form is skipped for anyone who has asked their device for less motion
  function scrollToForm() {
    const reduce =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById('packageFormSection')
      .scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  }

  // Configuration
  const PLACEHOLDER_IMAGE = '/assets/images/placeholders/package-event.svg';

  // Use the shared api() wrapper from AdminShared
  function api(url, method, body) {
    return window.AdminShared.api(url, method || 'GET', body || null);
  }

  function escapeHtml(text) {
    return window.AdminShared ? window.AdminShared.escapeHtml(text) : String(text || '');
  }

  async function loadPackages() {
    try {
      // Load from MongoDB API
      const data = await api('/api/admin/packages');
      allPackages = data.items || [];
      applyFiltersAndRender();
    } catch (err) {
      console.error('Failed to load packages:', err);
      if (typeof Toast !== 'undefined') {
        Toast.error(`Failed to load packages: ${err.message}`);
      }
    }
  }

  function applyFiltersAndRender(options) {
    // A new search or filter starts again at page 1; saving or deleting a package keeps the page
    if (options && options.resetPage === true) {
      packagePage = 1;
    }
    let filtered = allPackages;

    // Apply test data filter
    if (currentFilter === 'test') {
      filtered = filtered.filter(pkg => pkg.isTest === true);
    } else if (currentFilter === 'real') {
      filtered = filtered.filter(pkg => !pkg.isTest);
    }

    if (supplierFilterId) {
      filtered = filtered.filter(pkg => pkg.supplierId === supplierFilterId);
    }
    showSupplierFilterNote();

    // Apply search filter if present
    const searchInput = document.getElementById('searchInput');
    if (searchInput?.value.trim()) {
      const query = searchInput.value.toLowerCase();
      filtered = filtered.filter(
        pkg =>
          (pkg.title && pkg.title.toLowerCase().includes(query)) ||
          (pkg.description && pkg.description.toLowerCase().includes(query))
      );
    }

    renderPackages(filtered);
  }

  function showSupplierFilterNote() {
    const note = document.getElementById('supplierFilterNote');
    if (!note) {
      return;
    }
    note.hidden = !supplierFilterId;
    if (supplierFilterId) {
      const supplier = allSuppliers.find(item => item.id === supplierFilterId);
      document.getElementById('supplierFilterText').textContent =
        `Showing only the packages of ${supplier ? supplier.name : 'this supplier'}. `;
    }
  }

  /**
   * Act on the page address once packages and suppliers are loaded:
   *   ?supplierId=ID   only that supplier's packages
   *   ?supplierId=ID&add=1   ...and the Add form open with that supplier chosen
   *   ?id=ID           that package's Edit form
   * @returns {void} Nothing.
   */
  function applyDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const supplierId = params.get('supplierId');
    const packageId = params.get('id');
    if (supplierId) {
      supplierFilterId = supplierId;
      applyFiltersAndRender({ resetPage: true });
      if (params.get('add') === '1') {
        document.getElementById('addPackageBtn').click();
        document.getElementById('packageSupplierId').value = supplierId;
      }
    }
    if (packageId) {
      window.editPackage(packageId);
    }
  }

  async function loadSuppliers() {
    try {
      // Load from MongoDB API
      const data = await api('/api/admin/suppliers');
      allSuppliers = data.items || [];
      populateSupplierSelect();
    } catch (err) {
      console.error('Failed to load suppliers:', err);
    }
  }

  function populateSupplierSelect() {
    const select = document.getElementById('packageSupplierId');
    if (!select) {
      return;
    }

    select.innerHTML = '<option value="">Select a supplier...</option>';
    allSuppliers.forEach(supplier => {
      const option = document.createElement('option');
      option.value = supplier.id;
      option.textContent = supplier.name || 'Unnamed Supplier';
      select.appendChild(option);
    });
  }

  function renderPackages(packages) {
    const container = document.getElementById('packagesContainer');
    if (!container) {
      return;
    }

    packagePager =
      packagePager ||
      window.AdminPager.mount({
        after: container,
        onChange(page) {
          packagePage = page;
          applyFiltersAndRender();
        },
      });

    if (!packages.length) {
      container.innerHTML = '<p class="small">No packages found.</p>';
      packagePager.update({ page: 1, size: PACKAGE_PAGE_SIZE, total: 0, noun: 'packages' });
      return;
    }
    const total = packages.length;
    packagePage = window.AdminPager.range(packagePage, PACKAGE_PAGE_SIZE, total).page;
    const pageRows = window.AdminPager.slice(packages, packagePage, PACKAGE_PAGE_SIZE);

    let html = '<table class="table"><thead><tr>';
    html += '<th>Image</th><th>Title</th><th>Price</th><th>Status</th><th>Actions</th>';
    html += '</tr></thead><tbody>';

    pageRows.forEach(pkg => {
      html += '<tr>';
      html += `<td><img src="${escapeHtml(
        pkg.image || PLACEHOLDER_IMAGE
      )}" class="package-image" alt="Package image" data-fallback-src="${PLACEHOLDER_IMAGE}"></td>`;
      html += `<td><strong>${escapeHtml(
        pkg.title || ''
      )}</strong><br><span class="small">${escapeHtml((pkg.description || '').substring(0, 100))}${
        pkg.description && pkg.description.length > 100 ? '...' : ''
      }</span></td>`;
      html += `<td>${escapeHtml(pkg.price_display || pkg.price || '')}</td>`;
      html += '<td>';
      html += `<span class="badge ${pkg.approved ? 'badge-yes' : 'badge-no'}">${
        pkg.approved ? 'Approved' : 'Pending'
      }</span> `;
      if (pkg.featured) {
        html += '<span class="badge badge-yes">Featured</span> ';
      }
      if (pkg.isTest) {
        html += '<span class="badge badge-test-data">Test data</span>';
      }
      html += '</td>';
      html += '<td>';
      html += `<button class="ef-cta btn btn-primary btn-small" data-action="editPackage" data-id="${
        pkg.id
      }">Edit</button> `;
      html += `<button class="ef-cta btn btn-small ${
        pkg.approved ? 'btn-secondary' : 'btn-primary'
      }" data-action="toggleApproval" data-id="${pkg.id}" data-param="${!pkg.approved}">${
        pkg.approved ? 'Unapprove' : 'Approve'
      }</button> `;
      html += `<button class="ef-cta btn btn-small ${
        pkg.featured ? 'btn-secondary' : 'btn-primary'
      }" data-action="toggleFeatured" data-id="${pkg.id}" data-param="${!pkg.featured}">${
        pkg.featured ? 'Unfeature' : 'Feature'
      }</button> `;
      html += `<button class="ef-cta btn btn-danger btn-small" data-action="deletePackage" data-id="${
        pkg.id
      }">Delete</button>`;
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
    packagePager.update({
      page: packagePage,
      size: PACKAGE_PAGE_SIZE,
      total,
      noun: total === allPackages.length ? 'packages' : 'matching packages',
    });
  }

  /**
   * Image Upload Functionality
   *
   * This section handles package image uploads through a drag-and-drop UI.
   * Flow:
   * 1. User selects/drops an image file
   * 2. handleImageFile() validates and creates a preview
   * 3. File is stored in currentImageFile, preview URL in currentImageUrl
   * 4. On form submit, if currentImageFile exists:
   *    a. For new packages: create package with placeholder, then upload image
   *    b. For existing packages: upload image, then update package with new URL
   * 5. Image is uploaded to /api/admin/packages/:id/image endpoint
   * 6. Backend processes image using Sharp and saves to filesystem
   * 7. Package document in MongoDB is updated with the image URL
   */
  function setupImageUpload() {
    const uploadZone = document.getElementById('imageUploadZone');
    const fileInput = document.getElementById('imageFileInput');
    const changeBtn = document.getElementById('changeImageBtn');

    // Click to upload
    uploadZone.addEventListener('click', e => {
      if (e.target !== changeBtn && !changeBtn.contains(e.target)) {
        fileInput.click();
      }
    });

    // File input change
    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) {
        handleImageFile(file);
      }
    });

    // Drag and drop
    uploadZone.addEventListener('dragover', e => {
      e.preventDefault();
      uploadZone.style.borderColor = '#3b82f6';
      uploadZone.style.background = '#eff6ff';
    });

    uploadZone.addEventListener('dragleave', e => {
      e.preventDefault();
      uploadZone.style.borderColor = '#d4d4d8';
      uploadZone.style.background = '#fafafa';
    });

    uploadZone.addEventListener('drop', e => {
      e.preventDefault();
      uploadZone.style.borderColor = '#d4d4d8';
      uploadZone.style.background = '#fafafa';

      const file = e.dataTransfer.files[0];
      if (file?.type.startsWith('image/')) {
        handleImageFile(file);
      } else {
        if (typeof Toast !== 'undefined') {
          Toast.error('Please drop an image file');
        }
      }
    });

    // Change image button
    changeBtn.addEventListener('click', e => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  /**
   * Validate and preview selected image file
   * @param {File} file - The selected image file
   *
   * Validates:
   * - File type must be an image
   * - File size must be under 5MB (aligns with backend 10MB limit)
   *
   * On success:
   * - Sets currentImageFile for later upload
   * - Creates and displays a preview using FileReader
   * - Stores preview data URL in currentImageUrl
   */
  function handleImageFile(file) {
    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      if (typeof Toast !== 'undefined') {
        Toast.error('Image size must be less than 5MB');
      }
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      if (typeof Toast !== 'undefined') {
        Toast.error('Please select an image file');
      }
      return;
    }

    currentImageFile = file;

    // Show preview
    const reader = new FileReader();
    reader.addEventListener('load', e => {
      const placeholder = document.getElementById('uploadPlaceholder');
      const preview = document.getElementById('imagePreview');
      const previewImage = document.getElementById('previewImage');

      previewImage.src = e.target.result;
      // Store the preview URL for use when upload is disabled
      currentImageUrl = e.target.result;
      placeholder.style.display = 'none';
      preview.style.display = 'block';
    });
    reader.readAsDataURL(file);
  }

  /**
   * Load package data into the edit form
   * @param {string} id - Package ID
   *
   * Populates form fields with package data including:
   * - All text fields (title, description, price, etc.)
   * - Image preview if package has an existing image
   * - Sets currentImageUrl to existing image for preservation
   * - Shows supplier name as read-only (not editable)
   *
   * Note: When editing, if user doesn't upload a new image,
   * the existing currentImageUrl will be used to preserve the image.
   */
  window.editPackage = function (id) {
    const pkg = allPackages.find(p => p.id === id);
    if (!pkg) {
      if (typeof Toast !== 'undefined') {
        Toast.error('Package not found');
      }
      return;
    }

    document.getElementById('formTitle').textContent = 'Edit Package';
    document.getElementById('packageId').value = pkg.id;

    // Hide the dropdown and show read-only supplier name
    const supplierSelect = document.getElementById('packageSupplierId');
    const supplierReadOnly = document.getElementById('supplierReadOnly');
    const supplierReadOnlyName = document.getElementById('supplierReadOnlyName');
    const supplierReadOnlyId = document.getElementById('supplierReadOnlyId');

    supplierSelect.style.display = 'none';
    supplierSelect.removeAttribute('required');

    // Find the supplier name from allSuppliers
    const supplier = allSuppliers.find(s => s.id === pkg.supplierId);
    const supplierName = supplier ? supplier.name : 'Unknown Supplier';

    supplierReadOnlyName.textContent = supplierName;
    supplierReadOnlyId.value = pkg.supplierId || '';
    supplierReadOnly.classList.remove('hidden');

    document.getElementById('packageTitle').value = pkg.title || '';
    document.getElementById('packageDescription').value = pkg.description || '';
    document.getElementById('packagePrice').value = pkg.price_display || pkg.price || '';
    document.getElementById('packageImage').value = pkg.image || '';
    document.getElementById('packageApproved').checked = Boolean(pkg.approved);
    document.getElementById('packageFeatured').checked = Boolean(pkg.featured);

    // Show image preview if exists
    if (pkg.image) {
      const placeholder = document.getElementById('uploadPlaceholder');
      const preview = document.getElementById('imagePreview');
      const previewImage = document.getElementById('previewImage');

      previewImage.src = pkg.image;
      placeholder.style.display = 'none';
      preview.style.display = 'block';
      currentImageUrl = pkg.image;
    }

    document.getElementById('packageFormSection').style.display = 'block';
    scrollToForm();
  };

  window.toggleApproval = async function (id, approved) {
    try {
      await api(`/api/admin/packages/${id}/approve`, 'POST', { approved });
      if (typeof Toast !== 'undefined') {
        Toast.success(approved ? 'Package approved' : 'Package unapproved');
      }
      await loadPackages();
    } catch (err) {
      if (typeof Toast !== 'undefined') {
        Toast.error(`Failed to update package: ${err.message}`);
      }
    }
  };

  window.toggleFeatured = async function (id, featured) {
    try {
      await api(`/api/admin/packages/${id}/feature`, 'POST', { featured });
      if (typeof Toast !== 'undefined') {
        Toast.success(featured ? 'Package featured' : 'Package unfeatured');
      }
      await loadPackages();
    } catch (err) {
      if (typeof Toast !== 'undefined') {
        Toast.error(`Failed to update package: ${err.message}`);
      }
    }
  };

  window.deletePackage = async function (id) {
    if (typeof Modal !== 'undefined') {
      const modal = new Modal({
        title: 'Delete Package',
        content:
          '<p>Are you sure you want to delete this package? This action cannot be undone.</p>',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        async onConfirm() {
          try {
            await api(`/api/admin/packages/${id}`, 'DELETE');
            if (typeof Toast !== 'undefined') {
              Toast.success('Package deleted successfully');
            }
            await loadPackages();
          } catch (err) {
            if (typeof Toast !== 'undefined') {
              Toast.error(`Failed to delete package: ${err.message}`);
            }
          }
        },
      });
      modal.show();
    } else {
      const confirmed = await (window.AdminShared?.showConfirmModal
        ? window.AdminShared.showConfirmModal({
            title: 'Delete Package',
            message: 'Are you sure you want to delete this package? This action cannot be undone.',
            confirmText: 'Delete',
          })
        : Promise.resolve(true));
      if (!confirmed) {
        return;
      }
      api(`/api/admin/packages/${id}`, 'DELETE')
        .then(() => {
          if (window.AdminShared?.showToast) {
            window.AdminShared.showToast('Package deleted successfully', 'success');
          }
          return loadPackages();
        })
        .catch(err => {
          if (window.AdminShared?.showToast) {
            window.AdminShared.showToast(`Failed to delete package: ${err.message}`, 'error');
          }
        });
    }
  };

  // Add Package Button
  document.getElementById('addPackageBtn').addEventListener('click', () => {
    document.getElementById('formTitle').textContent = 'Add Package';
    document.getElementById('packageForm').reset();
    document.getElementById('packageId').value = '';
    currentImageFile = null;
    currentImageUrl = null;

    // Show the dropdown and hide read-only supplier display
    const supplierSelect = document.getElementById('packageSupplierId');
    const supplierReadOnly = document.getElementById('supplierReadOnly');

    supplierSelect.style.display = 'block';
    supplierSelect.setAttribute('required', 'required');
    supplierReadOnly.classList.add('hidden');

    // Reset image preview
    const placeholder = document.getElementById('uploadPlaceholder');
    const preview = document.getElementById('imagePreview');
    placeholder.style.display = 'block';
    preview.style.display = 'none';

    document.getElementById('packageFormSection').style.display = 'block';
    scrollToForm();
  });

  // Cancel Form Button
  document.getElementById('cancelFormBtn').addEventListener('click', () => {
    document.getElementById('packageFormSection').style.display = 'none';
    document.getElementById('packageForm').reset();
    currentImageFile = null;
    currentImageUrl = null;
  });

  /**
   * Package Form Submit Handler
   *
   * Handles both creating new packages and updating existing ones.
   *
   * Image Upload Strategy:
   * - If currentImageFile exists (user selected a new image):
   *   * For NEW packages: Create package with placeholder → Upload image → Image URL auto-saved by backend
   *   * For EDIT: Upload image first → Get URL → Update package with new URL
   * - If NO currentImageFile (no new image selected):
   *   * Use currentImageUrl (preserves existing image on edit)
   *   * Or use placeholder for new packages without images
   *
   * This ensures:
   * 1. Images are properly uploaded via /api/admin/packages/:id/image
   * 2. Package documents in MongoDB have correct image URLs
   * 3. Existing images are preserved when editing without changing image
   */
  // Package Form Submit
  /** The supplier a package belongs to: the hidden input when editing, the dropdown when creating. */
  function readSupplierId(isEditing) {
    return document.getElementById(isEditing ? 'supplierReadOnlyId' : 'packageSupplierId').value;
  }

  /** The fields of the package form, as the admin API takes them. */
  function readPackageData(supplierId) {
    return {
      supplierId,
      title: document.getElementById('packageTitle').value,
      description: document.getElementById('packageDescription').value,
      price_display: document.getElementById('packagePrice').value,
      approved: document.getElementById('packageApproved').checked,
      featured: document.getElementById('packageFeatured').checked,
    };
  }

  /** Shows an error toast with whichever notifier the page has. */
  function notifyError(message) {
    if (typeof Toast !== 'undefined') {
      Toast.error(message);
    } else if (window.AdminShared?.showToast) {
      window.AdminShared.showToast(message, 'error');
    }
  }

  /**
   * The message for a refused image upload. When the server says what file type it saw, the message
   * says what was detected and what is allowed.
   */
  function uploadErrorMessage(errorData) {
    const fallback = errorData.error || 'Failed to upload image';
    const details = errorData.details;
    if (!details?.detectedType || !Array.isArray(details.allowedFormats)) {
      return fallback;
    }
    const allowed = details.allowedFormats.join(', ');
    if (details.detectedType === 'unknown') {
      return `Could not detect file type. The file may be corrupted. Allowed formats: ${allowed}`;
    }
    if (details.detectedType === 'error') {
      return `File type detection failed. The file may be corrupted or in an unsupported format. Allowed formats: ${allowed}`;
    }
    if (details.detectedType !== 'invalid') {
      return `Invalid file type. Detected: ${details.detectedType}. Allowed: ${allowed}`;
    }
    return fallback;
  }

  /** Makes sure a CSRF token is on the page for the multipart upload. */
  async function ensureCsrfToken() {
    if (window.__CSRF_TOKEN__) {
      return;
    }
    const csrfResponse = await fetch('/api/v1/csrf-token', { credentials: 'include' });
    const csrfData = await csrfResponse.json();
    window.__CSRF_TOKEN__ = csrfData.csrfToken;
  }

  /** Uploads the chosen file for a package and returns its stored URL. Throws what the server said. */
  async function uploadPackageImage(packageId) {
    const formData = new FormData();
    formData.append('image', currentImageFile);
    const uploadResponse = await fetch(`/api/v1/admin/packages/${packageId}/image`, {
      method: 'POST',
      headers: { 'X-CSRF-Token': window.__CSRF_TOKEN__ },
      credentials: 'include',
      body: formData,
    });
    if (!uploadResponse.ok) {
      throw new Error(uploadErrorMessage(await uploadResponse.json()));
    }
    const uploadData = await uploadResponse.json();
    return uploadData.imageUrl;
  }

  /** Saves a package whose image is a file the admin chose, which can only be uploaded once it exists. */
  async function saveWithUploadedFile(id, isEditing, packageData) {
    await ensureCsrfToken();
    let packageId = id;
    // A new package is created first, with the placeholder, so the upload has somewhere to go.
    if (!isEditing) {
      packageData.image = PLACEHOLDER_IMAGE;
      const createResponse = await api('/api/admin/packages', 'POST', packageData);
      packageId = createResponse.package.id;
    }
    const imageUrl = await uploadPackageImage(packageId);
    // An edited package is updated with the new image URL; a new one already has it from the upload.
    if (isEditing) {
      packageData.image = imageUrl;
      await api(`/api/admin/packages/${id}`, 'PUT', packageData);
    }
  }

  /** Saves a package whose image is a URL, the one already on it, or the placeholder. */
  async function saveWithImageUrl(id, isEditing, packageData) {
    const typedUrl = document.getElementById('packageImage').value;
    packageData.image = currentImageUrl || typedUrl || PLACEHOLDER_IMAGE;
    if (isEditing) {
      await api(`/api/admin/packages/${id}`, 'PUT', packageData);
    } else {
      await api('/api/admin/packages', 'POST', packageData);
    }
  }

  document.getElementById('packageForm').addEventListener('submit', async e => {
    e.preventDefault();

    const id = document.getElementById('packageId').value;
    const isEditing = Boolean(id);

    const supplierId = readSupplierId(isEditing);
    if (!supplierId) {
      if (typeof Toast !== 'undefined') {
        Toast.error('Please select a supplier');
      }
      return;
    }

    const packageData = readPackageData(supplierId);

    try {
      const saveBtn = document.getElementById('savePackageBtn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      if (currentImageFile) {
        await saveWithUploadedFile(id, isEditing, packageData);
      } else {
        await saveWithImageUrl(id, isEditing, packageData);
      }

      if (typeof Toast !== 'undefined') {
        Toast.success(isEditing ? 'Package updated successfully' : 'Package created successfully');
      }

      document.getElementById('packageFormSection').style.display = 'none';
      document.getElementById('packageForm').reset();
      currentImageFile = null;
      currentImageUrl = null;
      await loadPackages();
    } catch (err) {
      notifyError(`Failed to save package: ${err.message}`);
    } finally {
      const saveBtn = document.getElementById('savePackageBtn');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Package';
    }
  });

  // Search functionality
  document.getElementById('searchInput').addEventListener('input', () => {
    applyFiltersAndRender({ resetPage: true });
  });

  // Test data filter functionality
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const chosen = e.currentTarget;
      currentFilter = chosen.getAttribute('data-filter');

      // Update button styles, and tell assistive technology which one is chosen
      document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      chosen.classList.add('active');
      chosen.setAttribute('aria-pressed', 'true');

      applyFiltersAndRender({ resetPage: true });
    });
  });

  // Initialize function to set up the page
  function initializePage() {
    setupImageUpload();
    // Both lists are needed before a link from another page can pick a supplier or a package
    Promise.all([loadPackages(), loadSuppliers()]).then(applyDeepLink);

    const clearSupplierFilter = document.getElementById('supplierFilterClear');
    if (clearSupplierFilter) {
      clearSupplierFilter.addEventListener('click', () => {
        supplierFilterId = null;
        applyFiltersAndRender({ resetPage: true });
      });
    }

    // Event delegation for dynamically created buttons
    document.body.addEventListener('click', e => {
      const target = e.target;
      if (target.tagName !== 'BUTTON') {
        return;
      }

      const action = target.getAttribute('data-action');
      if (!action) {
        return;
      }

      const id = target.getAttribute('data-id');
      const param = target.getAttribute('data-param');

      switch (action) {
        case 'editPackage':
          if (id) {
            editPackage(id);
          }
          break;
        case 'toggleApproval':
          if (id && param !== null) {
            toggleApproval(id, param === 'true');
          }
          break;
        case 'toggleFeatured':
          if (id && param !== null) {
            toggleFeatured(id, param === 'true');
          }
          break;
        case 'deletePackage':
          if (id) {
            deletePackage(id);
          }
          break;
        default:
          break;
      }
    });

    // Back to dashboard button
    document.getElementById('backToDashboard')?.addEventListener('click', () => {
      location.href = '/admin';
    });
  }

  // Initialize when DOM is ready (since this is a module script, it's automatically deferred)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePage);
  } else {
    initializePage();
  }
})();
