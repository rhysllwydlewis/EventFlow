/**
 * Profile Customization Page
 * Handles loading and saving profile customization settings
 */

(function () {
  'use strict';

  // Helper function to make API requests
  async function api(path, opts = {}) {
    const options = {
      ...opts,
      credentials: opts.credentials || 'include',
    };
    const r = await fetch(path, options);
    if (!r.ok) {
      throw new Error((await r.json()).error || 'Request failed');
    }
    return r.json();
  }

  // Helper to escape HTML special characters to prevent XSS
  function escapeHtml(str) {
    if (!str) {
      return '';
    }
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Helper to get CSRF token
  async function ensureCsrfToken() {
    try {
      const response = await fetch('/api/auth/csrf', { credentials: 'include' });
      if (!response.ok) {
        throw new Error('Failed to fetch CSRF token');
      }
      const data = await response.json();
      return data.token;
    } catch (error) {
      console.error('Failed to get CSRF token:', error);
      throw error;
    }
  }

  let currentEditingSupplierId = null;
  let suppliers = [];

  // Load supplier profiles
  async function loadSuppliers() {
    try {
      const data = await api('/api/me/suppliers');
      suppliers = data.items || [];

      const container = document.getElementById('profile-selector-container');
      if (!container) {
        return;
      }

      if (suppliers.length === 0) {
        container.innerHTML = `
          <p class="small" style="color: #667085;">
            You don't have any supplier profiles yet. 
            <a href="/dashboard/supplier" style="color: #667eea;">Create one on your dashboard</a>.
          </p>
        `;
        return;
      }

      // Create profile selector
      if (suppliers.length === 1) {
        // Only one profile - auto-select it
        container.innerHTML = `
          <p class="small" style="color: #667085;">
            Customizing profile for: <strong>${escapeHtml(suppliers[0].name)}</strong>
          </p>
        `;
        currentEditingSupplierId = suppliers[0].id;
        populateForm(suppliers[0]);
      } else {
        // Multiple profiles - show selector
        container.innerHTML = `
          <label for="profile-select">Choose a profile to customize:</label>
          <select id="profile-select" style="margin-top: 0.5rem;">
            ${suppliers.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('')}
          </select>
        `;

        const select = document.getElementById('profile-select');
        if (select) {
          // Auto-select first profile
          currentEditingSupplierId = suppliers[0].id;
          populateForm(suppliers[0]);

          // Listen for changes
          select.addEventListener('change', function () {
            const selectedSupplier = suppliers.find(s => s.id === this.value);
            if (selectedSupplier) {
              currentEditingSupplierId = selectedSupplier.id;
              populateForm(selectedSupplier);
            }
          });
        }
      }
    } catch (error) {
      console.error('Failed to load suppliers:', error);
      const container = document.getElementById('profile-selector-container');
      if (container) {
        container.innerHTML = `
          <p class="small" style="color: #ef4444;">
            Failed to load profiles. Please try refreshing the page.
          </p>
        `;
      }
    }
  }

  // Populate form with supplier data
  function populateForm(supplier) {
    if (!supplier) {
      return;
    }

    // Set supplier ID
    const supId = document.getElementById('sup-id');
    if (supId) {
      supId.value = supplier.id || '';
    }

    // Banner
    const supBanner = document.getElementById('sup-banner');
    if (supBanner) {
      supBanner.value = supplier.bannerUrl || '';
    }

    // Show existing banner image in preview if exists
    if (supplier.bannerUrl) {
      const bannerPreview = document.getElementById('sup-banner-preview');
      if (bannerPreview) {
        const imgDiv = document.createElement('div');
        imgDiv.className = 'photo-preview-item';
        imgDiv.style.cssText = 'width:100%;height:150px;border-radius:8px;overflow:hidden;';

        const img = document.createElement('img');
        img.src = supplier.bannerUrl;
        img.alt = 'Banner preview';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';

        imgDiv.appendChild(img);
        bannerPreview.innerHTML = '';
        bannerPreview.appendChild(imgDiv);
      }
    }

    // Tagline
    const supTagline = document.getElementById('sup-tagline');
    if (supTagline) {
      supTagline.value = supplier.tagline || '';
    }

    // Theme Color
    const supThemeColor = document.getElementById('sup-theme-color');
    const supThemeColorHex = document.getElementById('sup-theme-color-hex');
    if (supThemeColor) {
      supThemeColor.value = supplier.themeColor || '#0B8073';
    }
    if (supThemeColorHex) {
      supThemeColorHex.value = supplier.themeColor || '#0B8073';
    }

    // Populate highlights
    for (let i = 1; i <= 5; i++) {
      const highlightInput = document.getElementById(`sup-highlight-${i}`);
      if (highlightInput) {
        highlightInput.value =
          supplier.highlights && supplier.highlights[i - 1] ? supplier.highlights[i - 1] : '';
      }
    }

    // Populate featured services
    const supFeaturedServices = document.getElementById('sup-featured-services');
    if (supFeaturedServices && supplier.featuredServices) {
      supFeaturedServices.value = (supplier.featuredServices || []).join('\n');
    }

    // Populate social links
    const platforms = ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok'];
    platforms.forEach(platform => {
      const input = document.getElementById(`sup-social-${platform}`);
      if (input && supplier.socialLinks && supplier.socialLinks[platform]) {
        input.value = supplier.socialLinks[platform];
      }
    });

    // Show preview button if supplier has an ID
    const previewBtn = document.getElementById('sup-preview');
    if (previewBtn && supplier.id) {
      previewBtn.style.display = 'inline-block';
    }
  }

  // Handle form submission
  async function handleFormSubmit(e) {
    e.preventDefault();

    const statusEl = document.getElementById('sup-status');
    const form = document.getElementById('customization-form');

    if (!currentEditingSupplierId) {
      if (statusEl) {
        statusEl.textContent = 'Error: No profile selected';
        statusEl.style.color = '#ef4444';
      }
      return;
    }

    try {
      const csrfToken = await ensureCsrfToken();

      const fd = new FormData(form);
      const payload = {};
      fd.forEach((v, k) => (payload[k] = v));

      // Collect highlights
      const highlights = [];
      for (let i = 1; i <= 5; i++) {
        const highlightInput = document.getElementById(`sup-highlight-${i}`);
        if (highlightInput && highlightInput.value.trim()) {
          highlights.push(highlightInput.value.trim());
        }
      }
      if (highlights.length > 0) {
        payload.highlights = highlights;
      }

      // Collect featured services
      const featuredServicesInput = document.getElementById('sup-featured-services');
      if (featuredServicesInput && featuredServicesInput.value.trim()) {
        const services = featuredServicesInput.value
          .split('\n')
          .map(s => s.trim())
          .filter(Boolean)
          .slice(0, 10);
        if (services.length > 0) {
          payload.featuredServices = services;
        }
      }

      // Collect social links
      const socialLinks = {};
      const platforms = ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok'];
      for (const platform of platforms) {
        const input = document.getElementById(`sup-social-${platform}`);
        if (input && input.value.trim()) {
          socialLinks[platform] = input.value.trim();
        }
      }
      if (Object.keys(socialLinks).length > 0) {
        payload.socialLinks = socialLinks;
      }

      // Get theme color
      const themeColorInput = document.getElementById('sup-theme-color');
      if (themeColorInput && themeColorInput.value) {
        payload.themeColor = themeColorInput.value;
      }

      if (statusEl) {
        statusEl.textContent = 'Saving...';
        statusEl.style.color = '#667085';
      }

      const path = `/api/me/suppliers/${encodeURIComponent(currentEditingSupplierId)}`;
      await api(path, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(payload),
      });

      if (statusEl) {
        statusEl.textContent = '✓ Saved successfully';
        statusEl.style.color = '#10b981';
        setTimeout(() => {
          statusEl.textContent = '';
        }, 3000);
      }

      // Reload to get latest data
      await loadSuppliers();
    } catch (err) {
      console.error('Error saving customization:', err);
      if (statusEl) {
        statusEl.textContent = `Error: ${err.message || 'Please try again'}`;
        statusEl.style.color = '#ef4444';
      }
    }
  }

  // Handle preview button
  function handlePreview() {
    if (currentEditingSupplierId) {
      window.open(
        `/supplier?id=${encodeURIComponent(currentEditingSupplierId)}&preview=true`,
        '_blank'
      );
    } else {
      alert('Please select a profile first.');
    }
  }

  // Initialize page
  async function init() {
    // Check authentication
    try {
      const response = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (!response.ok) {
        window.location.href = `/auth?redirect=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      const data = await response.json();
      if (data.user && data.user.role !== 'supplier') {
        window.location.href = '/dashboard/customer';
        return;
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      window.location.href = '/auth';
      return;
    }

    // Load suppliers
    await loadSuppliers();

    // Attach form handlers
    const form = document.getElementById('customization-form');
    if (form) {
      form.addEventListener('submit', handleFormSubmit);
    }

    const previewBtn = document.getElementById('sup-preview');
    if (previewBtn) {
      previewBtn.addEventListener('click', handlePreview);
    }

    // Initialize banner upload drop zone
    // efSetupPhotoDropZone is defined in app.js which is loaded before this script
    if (typeof window.efSetupPhotoDropZone === 'function') {
      window.efSetupPhotoDropZone('sup-banner-drop', 'sup-banner-preview', dataUrl => {
        const input = document.getElementById('sup-banner');
        if (input) {
          input.value = dataUrl;
        }
      });
    }

    // Initialize Pexels stock photo selector
    const stockPhotoBtn = document.getElementById('select-stock-photo-btn');
    if (stockPhotoBtn && typeof window.PexelsSelector !== 'undefined') {
      const pexelsSelector = new window.PexelsSelector();

      stockPhotoBtn.addEventListener('click', () => {
        pexelsSelector.open(selectedImageUrl => {
          // Validate URL is from Pexels CDN
          if (!validatePexelsImageUrl(selectedImageUrl)) {
            console.error('Invalid image URL from selector');
            if (
              window.EventFlowNotifications &&
              typeof window.EventFlowNotifications.error === 'function'
            ) {
              window.EventFlowNotifications.error(
                'Invalid image URL. Please try selecting another photo.'
              );
            }
            return;
          }

          // Update banner preview using DOM methods for security
          updateBannerPreview(selectedImageUrl);

          // Update hidden input
          const bannerInput = document.getElementById('sup-banner');
          if (bannerInput) {
            bannerInput.value = selectedImageUrl;
          }

          // Show success notification if available
          if (
            window.EventFlowNotifications &&
            typeof window.EventFlowNotifications.success === 'function'
          ) {
            window.EventFlowNotifications.success('Stock photo selected successfully!');
          }
        });
      });
    }
  }

  // Update banner preview with validated image URL
  function updateBannerPreview(imageUrl) {
    const bannerPreview = document.getElementById('sup-banner-preview');
    if (!bannerPreview) {
      return;
    }

    // Clear existing preview using DOM methods
    while (bannerPreview.firstChild) {
      bannerPreview.removeChild(bannerPreview.firstChild);
    }

    // Create preview container
    const container = document.createElement('div');
    container.className = 'photo-preview-item';
    container.style.cssText = 'width:100%;height:150px;border-radius:8px;overflow:hidden;';

    // Create image element using DOM (safer than innerHTML)
    const imgElement = document.createElement('img');
    imgElement.alt = 'Selected banner';
    imgElement.style.cssText = 'width:100%;height:100%;object-fit:cover;';

    // Set src via DOM property (safe after validation)
    imgElement.src = imageUrl;

    container.appendChild(imgElement);
    bannerPreview.appendChild(container);
  }

  // Validate image URL is from Pexels CDN
  function validatePexelsImageUrl(url) {
    try {
      const urlObj = new URL(url);
      // Use shared constant from pexels-selector.js
      const allowedDomains = window.PEXELS_ALLOWED_DOMAINS || [
        'images.pexels.com',
        'www.pexels.com',
      ];
      return allowedDomains.includes(urlObj.hostname);
    } catch (e) {
      return false;
    }
  }

  // Run init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
