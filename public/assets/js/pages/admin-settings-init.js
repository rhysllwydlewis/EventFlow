(function () {
  let currentEmailTemplate = null;

  // Load site configuration
  async function loadSiteConfig() {
    try {
      const config = await AdminShared.adminFetch('/api/admin/settings/site', { method: 'GET' });
      document.getElementById('siteName').value = config.name || '';
      document.getElementById('siteTagline').value = config.tagline || '';
      document.getElementById('contactEmail').value = config.contactEmail || '';
      document.getElementById('supportEmail').value = config.supportEmail || '';
    } catch (err) {
      AdminShared.debugError('Failed to load site config:', err);
    }
  }

  // Save site configuration with email validation
  document.getElementById('siteConfigForm').addEventListener('submit', async e => {
    e.preventDefault();

    const contactEmail = document.getElementById('contactEmail').value.trim();
    const supportEmail = document.getElementById('supportEmail').value.trim();

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (contactEmail && !emailRegex.test(contactEmail)) {
      AdminShared.showToast('Invalid contact email address', 'error');
      return;
    }
    if (supportEmail && !emailRegex.test(supportEmail)) {
      AdminShared.showToast('Invalid support email address', 'error');
      return;
    }

    const data = {
      name: document.getElementById('siteName').value.trim(),
      tagline: document.getElementById('siteTagline').value.trim(),
      contactEmail: contactEmail,
      supportEmail: supportEmail,
    };

    const submitBtn = e.target.querySelector('button[type="submit"]');
    await AdminShared.safeAction(
      submitBtn,
      async () => {
        return await AdminShared.adminFetch('/api/admin/settings/site', {
          method: 'PUT',
          body: data,
        });
      },
      {
        loadingText: 'Saving...',
        successMessage: 'Site configuration saved',
        errorMessage: 'Failed to save configuration',
      }
    );
  });

  // Constants
  const STATUS_HIDE_DELAY_MS = 3000;

  // State management for feature flags
  let featureFlagsLoaded = false;
  let originalFeatureFlags = {};
  let isSavingFeatureFlags = false;

  // Update feature flags status UI
  function updateFeatureFlagsStatus(status, text) {
    const statusEl = document.getElementById('featureFlagsStatus');
    const statusTextEl = document.getElementById('featureFlagsStatusText');

    if (statusEl && statusTextEl) {
      statusEl.style.display = status === 'hidden' ? 'none' : 'block';
      statusTextEl.textContent = text || '';

      // Update colors based on status
      statusEl.className = `feature-flags-status feature-flags-status-${status}`;
    }
  }

  // Enable or disable feature flag checkboxes
  function setFeatureFlagsEnabled(enabled) {
    const checkboxes = [
      'featureRegistration',
      'featureSupplierApply',
      'featureReviews',
      'featurePhotoUploads',
      'featureSupportTickets',
      'featurePexelsCollage',
      'featureRequirePackageApproval',
    ];

    checkboxes.forEach(id => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.disabled = !enabled;
      }
    });
  }

  // Check if feature flags have been modified (dirty state)
  function hasFeatureFlagsChanged() {
    if (!featureFlagsLoaded) {
      return false;
    }

    // Safely get checkbox values with null checks
    const getCheckboxValue = id => {
      const el = document.getElementById(id);
      return el ? el.checked : false;
    };

    const current = {
      registration: getCheckboxValue('featureRegistration'),
      supplierApplications: getCheckboxValue('featureSupplierApply'),
      reviews: getCheckboxValue('featureReviews'),
      photoUploads: getCheckboxValue('featurePhotoUploads'),
      supportTickets: getCheckboxValue('featureSupportTickets'),
      pexelsCollage: getCheckboxValue('featurePexelsCollage'),
      requirePackageApproval: getCheckboxValue('featureRequirePackageApproval'),
    };

    return JSON.stringify(current) !== JSON.stringify(originalFeatureFlags);
  }

  // Update save button state based on conditions
  function updateSaveButtonState() {
    const saveBtn = document.getElementById('saveFeatureFlags');
    if (!saveBtn) {
      return;
    }

    // Enable only if:
    // 1. Flags are loaded
    // 2. CSRF token is available
    // 3. User has made changes
    // 4. Not currently saving
    const canSave =
      featureFlagsLoaded &&
      window.__CSRF_TOKEN__ &&
      hasFeatureFlagsChanged() &&
      !isSavingFeatureFlags;

    saveBtn.disabled = !canSave;
  }

  // Load feature flags
  async function loadFeatureFlags() {
    try {
      updateFeatureFlagsStatus('loading', 'Loading feature flags...');
      setFeatureFlagsEnabled(false);
      featureFlagsLoaded = false;

      const flags = await AdminShared.adminFetch('/api/admin/settings/features', {
        method: 'GET',
      });

      // Store original values
      originalFeatureFlags = {
        registration: flags.registration !== false,
        supplierApplications: flags.supplierApplications !== false,
        reviews: flags.reviews !== false,
        photoUploads: flags.photoUploads !== false,
        supportTickets: flags.supportTickets !== false,
        pexelsCollage: flags.pexelsCollage === true,
        requirePackageApproval: flags.requirePackageApproval === true,
      };

      // Set checkbox values with null checks
      const setCheckboxValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) {
          el.checked = value;
        }
      };

      setCheckboxValue('featureRegistration', originalFeatureFlags.registration);
      setCheckboxValue('featureSupplierApply', originalFeatureFlags.supplierApplications);
      setCheckboxValue('featureReviews', originalFeatureFlags.reviews);
      setCheckboxValue('featurePhotoUploads', originalFeatureFlags.photoUploads);
      setCheckboxValue('featureSupportTickets', originalFeatureFlags.supportTickets);
      setCheckboxValue('featurePexelsCollage', originalFeatureFlags.pexelsCollage);
      setCheckboxValue(
        'featureRequirePackageApproval',
        originalFeatureFlags.requirePackageApproval
      );

      // Display last updated info
      const updatedTimeEl = document.getElementById('featureUpdatedTime');
      const updatedByEl = document.getElementById('featureUpdatedBy');
      const lastUpdatedEl = document.getElementById('featureFlagsLastUpdated');

      if (updatedTimeEl && updatedByEl && lastUpdatedEl) {
        if (flags.updatedAt && flags.updatedBy) {
          const updatedDate = new Date(flags.updatedAt);
          updatedTimeEl.textContent = updatedDate.toLocaleString();
          updatedByEl.textContent = flags.updatedBy;
          lastUpdatedEl.style.display = 'block';
        } else {
          updatedTimeEl.textContent = 'unknown';
          updatedByEl.textContent = 'unknown';
          lastUpdatedEl.style.display = 'block';
        }
      }

      updateFeatureFlagsStatus('hidden');
      setFeatureFlagsEnabled(true);
      featureFlagsLoaded = true;

      // Update save button state
      updateSaveButtonState();

      // Update Pexels test section visibility
      updatePexelsTestSection();
    } catch (err) {
      AdminShared.debugError('Failed to load feature flags:', err);
      updateFeatureFlagsStatus('error', 'Error loading feature flags');
      setFeatureFlagsEnabled(false);
      featureFlagsLoaded = false;
    }
  }

  // Add change listeners to all feature flag checkboxes
  function initFeatureFlagChangeListeners() {
    const checkboxIds = [
      'featureRegistration',
      'featureSupplierApply',
      'featureReviews',
      'featurePhotoUploads',
      'featureSupportTickets',
      'featurePexelsCollage',
      'featureRequirePackageApproval',
    ];

    checkboxIds.forEach(id => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.addEventListener('change', updateSaveButtonState);
      }
    });
  }

  // Save feature flags with confirmation for critical toggles
  document.getElementById('saveFeatureFlags').addEventListener('click', async () => {
    // Prevent double-submit
    if (isSavingFeatureFlags) {
      return;
    }

    // Helper to safely get checkbox value
    const getCheckboxValue = id => {
      const el = document.getElementById(id);
      return el ? el.checked : false;
    };

    const registrationChecked = getCheckboxValue('featureRegistration');
    const reviewsChecked = getCheckboxValue('featureReviews');

    // Confirmation dialog for disabling critical features
    if (!registrationChecked || !reviewsChecked) {
      const disabledFeatures = [];
      if (!registrationChecked) {
        disabledFeatures.push('User Registration');
      }
      if (!reviewsChecked) {
        disabledFeatures.push('Package Reviews');
      }

      const confirmMessage = `You are about to disable: ${disabledFeatures.join(', ')}.\n\nThis will prevent users from using these features.\n\nAre you sure you want to continue?`;

      const confirmed = await AdminShared.showConfirmModal({
        title: 'Disable Critical Features?',
        message: confirmMessage,
        confirmText: 'Yes, Disable',
        cancelText: 'Cancel',
        type: 'warning',
      });

      if (!confirmed) {
        return;
      }
    }

    const saveBtn = document.getElementById('saveFeatureFlags');
    if (!saveBtn) {
      AdminShared.showToast('Save button not found', 'error');
      return;
    }

    const data = {
      registration: registrationChecked,
      supplierApplications: getCheckboxValue('featureSupplierApply'),
      reviews: reviewsChecked,
      photoUploads: getCheckboxValue('featurePhotoUploads'),
      supportTickets: getCheckboxValue('featureSupportTickets'),
      pexelsCollage: getCheckboxValue('featurePexelsCollage'),
      requirePackageApproval: getCheckboxValue('featureRequirePackageApproval'),
    };

    // Set saving state
    isSavingFeatureFlags = true;
    setFeatureFlagsEnabled(false);
    updateFeatureFlagsStatus('saving', 'Saving feature flags...');
    // Note: Don't call updateSaveButtonState() here - it disables the button before safeAction(),
    // causing safeAction to exit early without making API calls due to race condition

    // Create a hard 15-second timeout wrapper to guarantee operation completes
    let timeoutId;
    const hardTimeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Operation timed out after 15 seconds'));
      }, 15000); // 15 second hard timeout
    });

    try {
      // Race the save operation against the hard timeout
      await Promise.race([
        (async () => {
          await AdminShared.safeAction(
            saveBtn,
            async () => {
              // Use new adminFetchWithTimeout with 10 second timeout and 2 retries
              const result = await AdminShared.adminFetchWithTimeout(
                '/api/admin/settings/features',
                {
                  method: 'PUT',
                  body: data,
                  timeout: 10000, // 10 second timeout
                  retries: 2, // Retry up to 2 times
                }
              );

              // safeAction will show success toast, we add status message
              updateFeatureFlagsStatus('saved', 'Feature flags saved successfully');
              setTimeout(() => updateFeatureFlagsStatus('hidden'), STATUS_HIDE_DELAY_MS);

              // Re-fetch flags from server (single source of truth)
              await loadFeatureFlags();
              return result;
            },
            {
              loadingText: 'Saving...',
              successMessage: 'Feature flags updated',
              errorMessage: 'Failed to save feature flags',
            }
          );
        })(),
        hardTimeoutPromise,
      ]);

      // Clear timeout on success
      clearTimeout(timeoutId);
    } catch (error) {
      // Clear timeout on error
      clearTimeout(timeoutId);

      // safeAction already showed error toast and restored button state
      // Show detailed error message with status and response
      let errorDetail = 'Error saving feature flags';

      if (error.message.includes('timed out')) {
        errorDetail = error.message.includes('15 seconds')
          ? 'Request timed out after 15 seconds. Database may be slow or unavailable.'
          : 'Request timed out after 10 seconds. Database may be slow or unavailable.';
        AdminShared.showToast(errorDetail, 'error');
      } else if (error.status === 504) {
        errorDetail = 'Gateway timeout. Please try again in a moment.';
      } else if (error.message) {
        errorDetail += `: ${error.message}`;
      }

      updateFeatureFlagsStatus('error', errorDetail);

      // Keep user's current toggles (don't revert)
      AdminShared.debugError('Feature flags save error:', error);
    } finally {
      // Always reset state and re-enable checkboxes - GUARANTEED to execute
      isSavingFeatureFlags = false;
      setFeatureFlagsEnabled(true);
      updateSaveButtonState();
    }
  });

  // Show/hide Pexels test section based on feature flag
  function updatePexelsTestSection() {
    const pexelsCheckbox = document.getElementById('featurePexelsCollage');
    const testSection = document.getElementById('pexelsTestSection');

    if (pexelsCheckbox && testSection) {
      testSection.style.display = pexelsCheckbox.checked ? 'block' : 'none';
    }
  }

  // Add listener to Pexels checkbox
  const pexelsCheckbox = document.getElementById('featurePexelsCollage');
  if (pexelsCheckbox) {
    pexelsCheckbox.addEventListener('change', updatePexelsTestSection);
  }

  // Test Pexels Connection button
  document.getElementById('testPexelsBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('testPexelsBtn');
    const resultDiv = document.getElementById('pexelsTestResult');

    if (!btn || !resultDiv) {
      return;
    }

    // Disable button and show loading state
    btn.disabled = true;
    btn.textContent = 'Testing...';
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<div style="color: #6b7280;">🔄 Testing Pexels API connection...</div>';

    try {
      const result = await AdminShared.adminFetchWithTimeout('/api/pexels/test', {
        method: 'GET',
        timeout: 15000, // 15 second timeout for API test
      });

      // Determine status display based on mode
      if (result.mode === 'api' && result.success) {
        // ✅ API Connected
        resultDiv.style.background = '#d1fae5';
        resultDiv.style.color = '#065f46';
        resultDiv.innerHTML = `
          <div style="font-weight: 600; margin-bottom: 0.5rem;">✅ ${AdminShared.escapeHtml(result.message)}</div>
          ${
            result.details
              ? `
            <div style="font-size: 0.85rem; opacity: 0.9;">
              <strong>Mode:</strong> API Connected<br>
              Response time: ${result.details.responseTime}ms<br>
              API version: ${result.details.apiVersion || 'v1'}<br>
              Sample results available: ${result.details.totalResults ? 'Yes' : 'No'}
            </div>
          `
              : ''
          }
        `;
        AdminShared.showToast('Pexels API connection successful', 'success');
      } else if (result.mode === 'fallback') {
        // ⚠️ Using URL Fallback
        resultDiv.style.background = '#fef3c7';
        resultDiv.style.color = '#92400e';
        resultDiv.innerHTML = `
          <div style="font-weight: 600; margin-bottom: 0.5rem;">⚠️ Using URL Fallback</div>
          <div style="font-size: 0.85rem; opacity: 0.9;">
            <strong>Mode:</strong> Fallback URLs<br>
            ${AdminShared.escapeHtml(result.message)}<br>
            ${
              result.fallback
                ? `
              Fallback photos: ${result.fallback.photosCount}<br>
              Fallback videos: ${result.fallback.videosCount}
            `
                : ''
            }
          </div>
          <div style="margin-top: 0.5rem; font-size: 0.85rem; opacity: 0.8;">
            Hardcoded URLs will be used. Configure PEXELS_API_KEY to use live API.
          </div>
        `;
        AdminShared.showToast('Using fallback mode', 'warning');
      } else {
        // ❌ Pexels Unavailable
        resultDiv.style.background = '#fee2e2';
        resultDiv.style.color = '#991b1b';
        resultDiv.innerHTML = `
          <div style="font-weight: 600; margin-bottom: 0.5rem;">❌ ${AdminShared.escapeHtml(result.message)}</div>
          ${
            result.details
              ? `
            <div style="font-size: 0.85rem; opacity: 0.9;">
              ${result.details.errorType ? `Error type: ${result.details.errorType}<br>` : ''}
              ${result.details.error ? `Details: ${AdminShared.escapeHtml(result.details.error)}` : ''}
            </div>
          `
              : ''
          }
          <div style="margin-top: 0.5rem; font-size: 0.85rem; opacity: 0.8;">
            Please check your PEXELS_API_KEY environment variable and ensure the API is accessible.
          </div>
        `;
        AdminShared.showToast('Pexels API test failed', 'error');
      }
    } catch (error) {
      resultDiv.style.background = '#fee2e2';
      resultDiv.style.color = '#991b1b';

      let errorMessage = 'Connection test failed';
      if (error.message && error.message.includes('timed out')) {
        errorMessage = 'Test timed out after 15 seconds';
      } else if (error.message) {
        errorMessage = error.message;
      }

      resultDiv.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 0.5rem;">❌ ${AdminShared.escapeHtml(errorMessage)}</div>
        <div style="font-size: 0.85rem; opacity: 0.9;">
          Please check your PEXELS_API_KEY environment variable and ensure the API is accessible.
        </div>
      `;
      AdminShared.showToast('Failed to test Pexels connection', 'error');
      AdminShared.debugError('Pexels test error:', error);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test Connection';
    }
  });

  // Load maintenance mode
  let maintenanceCountdownInterval = null;

  async function loadMaintenanceMode() {
    try {
      const maintenance = await AdminShared.adminFetch('/api/admin/settings/maintenance', {
        method: 'GET',
      });
      const isEnabled = maintenance.enabled || false;
      document.getElementById('maintenanceMode').checked = isEnabled;
      document.getElementById('maintenanceMessage').value = maintenance.message || '';
      document.getElementById('maintenanceDuration').value = maintenance.duration || '';

      // Update quick toggle button
      updateMaintenanceButton(isEnabled);

      // Start countdown if maintenance is enabled and has expiration
      if (isEnabled && maintenance.expiresAt) {
        startMaintenanceCountdown(maintenance.expiresAt);
      } else {
        stopMaintenanceCountdown();
      }
    } catch (err) {
      AdminShared.debugError('Failed to load maintenance mode:', err);
    }
  }

  // Format time remaining
  function formatTimeRemaining(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  // Start maintenance countdown
  function startMaintenanceCountdown(expiresAt) {
    stopMaintenanceCountdown(); // Clear any existing interval

    const countdownEl = document.getElementById('maintenanceCountdown');
    if (!countdownEl) {
      return;
    }

    function updateCountdown() {
      const now = new Date();
      const expires = new Date(expiresAt);
      const remaining = expires - now;

      if (remaining <= 0) {
        countdownEl.textContent = '⏰ Maintenance mode has expired and will auto-disable shortly';
        countdownEl.style.background = '#fff3cd';
        countdownEl.style.color = '#856404';
        stopMaintenanceCountdown();
        // Reload to reflect auto-disabled state
        setTimeout(() => loadMaintenanceMode(), 2000);
      } else {
        countdownEl.textContent = `⏰ Auto-disable in: ${formatTimeRemaining(remaining)}`;
        countdownEl.style.display = 'block';
      }
    }

    updateCountdown();
    maintenanceCountdownInterval = setInterval(updateCountdown, 1000);
  }

  // Stop maintenance countdown
  function stopMaintenanceCountdown() {
    if (maintenanceCountdownInterval) {
      clearInterval(maintenanceCountdownInterval);
      maintenanceCountdownInterval = null;
    }
    const countdownEl = document.getElementById('maintenanceCountdown');
    if (countdownEl) {
      countdownEl.style.display = 'none';
    }
  }

  // Update maintenance button appearance
  function updateMaintenanceButton(enabled) {
    const btn = document.getElementById('quickToggleMaintenance');
    const text = document.getElementById('maintenanceStatusText');
    if (enabled) {
      btn.className = 'btn btn-danger';
      text.textContent = '🔴 ON - Disable';
    } else {
      btn.className = 'btn btn-success';
      text.textContent = '🟢 OFF - Enable';
    }
  }

  // Quick toggle maintenance mode
  document.getElementById('quickToggleMaintenance').addEventListener('click', async () => {
    const currentState = document.getElementById('maintenanceMode').checked;
    const newState = !currentState;

    const confirmed = await AdminShared.showConfirmModal({
      title: newState ? 'Enable Maintenance Mode?' : 'Disable Maintenance Mode?',
      message: newState
        ? 'The site will be inaccessible to non-admin users.'
        : 'The site will become accessible to all users.',
      confirmText: newState ? 'Enable' : 'Disable',
      cancelText: 'Cancel',
      type: newState ? 'warning' : 'info',
    });

    if (!confirmed) {
      return;
    }

    const btn = document.getElementById('quickToggleMaintenance');
    await AdminShared.safeAction(
      btn,
      async () => {
        const durationValue = document.getElementById('maintenanceDuration').value;
        const data = {
          enabled: newState,
          message:
            document.getElementById('maintenanceMessage').value ||
            "We're performing scheduled maintenance. We'll be back soon!",
          duration: durationValue ? Number(durationValue) : null,
        };

        const result = await AdminShared.adminFetch('/api/admin/settings/maintenance', {
          method: 'PUT',
          body: data,
        });

        document.getElementById('maintenanceMode').checked = newState;
        updateMaintenanceButton(newState);

        // Reload to update countdown
        await loadMaintenanceMode();

        return result;
      },
      {
        loadingText: 'Updating...',
        successMessage: `Maintenance mode ${newState ? 'enabled' : 'disabled'}`,
        errorMessage: 'Failed to toggle maintenance mode',
      }
    );
  });

  // Save maintenance mode
  document.getElementById('saveMaintenanceMode').addEventListener('click', async () => {
    const durationValue = document.getElementById('maintenanceDuration').value;
    const data = {
      enabled: document.getElementById('maintenanceMode').checked,
      message: document.getElementById('maintenanceMessage').value,
      duration: durationValue ? Number(durationValue) : null,
    };

    if (data.enabled) {
      const confirmed = await AdminShared.showConfirmModal({
        title: 'Enable Maintenance Mode?',
        message: 'Are you sure? The site will be inaccessible to non-admin users.',
        confirmText: 'Enable',
        cancelText: 'Cancel',
        type: 'warning',
      });

      if (!confirmed) {
        return;
      }
    }

    const saveBtn = document.getElementById('saveMaintenanceMode');
    await AdminShared.safeAction(
      saveBtn,
      async () => {
        const result = await AdminShared.adminFetch('/api/admin/settings/maintenance', {
          method: 'PUT',
          body: data,
        });

        updateMaintenanceButton(data.enabled);

        // Reload to update countdown
        await loadMaintenanceMode();

        return result;
      },
      {
        loadingText: 'Saving...',
        successMessage: 'Maintenance mode updated',
        errorMessage: 'Failed to update maintenance mode',
      }
    );
  });

  // Email template buttons
  document.querySelectorAll('[data-template]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const templateName = btn.dataset.template;
      currentEmailTemplate = templateName;

      try {
        const template = await AdminShared.adminFetch(
          `/api/admin/settings/email-templates/${templateName}`,
          { method: 'GET' }
        );
        document.getElementById('emailSubject').value = template.subject || '';
        document.getElementById('emailBody').value = template.body || '';
        document.getElementById('emailTemplateEditor').style.display = 'block';
      } catch (err) {
        AdminShared.showToast(`Failed to load template: ${err.message}`, 'error');
      }
    });
  });

  // Save email template
  document.getElementById('saveEmailTemplate').addEventListener('click', async () => {
    if (!currentEmailTemplate) {
      return;
    }

    const data = {
      subject: document.getElementById('emailSubject').value,
      body: document.getElementById('emailBody').value,
    };

    const saveBtn = document.getElementById('saveEmailTemplate');
    await AdminShared.safeAction(
      saveBtn,
      async () => {
        return await AdminShared.adminFetch(
          `/api/admin/settings/email-templates/${currentEmailTemplate}`,
          {
            method: 'PUT',
            body: data,
          }
        );
      },
      {
        loadingText: 'Saving...',
        successMessage: 'Email template saved',
        errorMessage: 'Failed to save template',
      }
    );
  });

  // Preview email
  document.getElementById('previewEmail').addEventListener('click', () => {
    const subject = document.getElementById('emailSubject').value;
    const body = document.getElementById('emailBody').value;

    // Create safe HTML content
    const safeSubject = AdminShared.escapeHtml(subject);
    const safeBody = AdminShared.escapeHtml(body).replace(/\n/g, '<br>');

    const preview = window.open('', '_blank');
    if (preview) {
      preview.document.write(`
        <html>
          <head>
            <script src="/assets/js/dashboard-guard.js?v=17.0.2"></script>
            <title>${safeSubject}</title>
            <script src="/assets/js/admin-navbar.js" defer></script>
            <link rel="stylesheet" href="/assets/css/mobile-optimizations.css">
            <link rel="stylesheet" href="/assets/css/ui-ux-fixes.css">
          </head>
          <body style="font-family:sans-serif;padding:2rem;" class="has-admin-navbar admin">
            <h2>Subject: ${safeSubject}</h2>
            <hr>
            <div>${safeBody}</div>
            <script src="/assets/js/cookie-consent.js" defer></script>
          </body>
        </html>
      `);
      preview.document.close();
    }
  });

  // Reset email
  document.getElementById('resetEmail').addEventListener('click', async () => {
    if (!currentEmailTemplate) {
      return;
    }

    const confirmed = await AdminShared.showConfirmModal({
      title: 'Reset Template?',
      message: 'Reset this template to default? Your changes will be lost.',
      confirmText: 'Reset',
      cancelText: 'Cancel',
      type: 'warning',
    });

    if (!confirmed) {
      return;
    }

    const resetBtn = document.getElementById('resetEmail');
    await AdminShared.safeAction(
      resetBtn,
      async () => {
        await AdminShared.adminFetch(
          `/api/admin/settings/email-templates/${currentEmailTemplate}/reset`,
          { method: 'POST' }
        );

        // Reload template
        const template = await AdminShared.adminFetch(
          `/api/admin/settings/email-templates/${currentEmailTemplate}`,
          { method: 'GET' }
        );
        document.getElementById('emailSubject').value = template.subject || '';
        document.getElementById('emailBody').value = template.body || '';

        return template;
      },
      {
        loadingText: 'Resetting...',
        successMessage: 'Template reset to default',
        errorMessage: 'Failed to reset template',
      }
    );
  });

  // Load system info
  async function loadSystemInfo() {
    try {
      const info = await AdminShared.adminFetch('/api/admin/settings/system-info', {
        method: 'GET',
      });
      document.getElementById('systemVersion').textContent = info.version || 'v17.0.0';
      document.getElementById('systemEnv').textContent = info.environment || 'Production';
      document.getElementById('systemDB').textContent = info.database || 'MongoDB';
      document.getElementById('systemUptime').textContent = info.uptime || '-';
    } catch (err) {
      AdminShared.debugError('Failed to load system info:', err);
    }
  }

  // Load audit logs
  async function loadAuditLogs() {
    try {
      const response = await AdminShared.adminFetch(
        '/api/admin/audit-logs?limit=20&targetType=features,settings,maintenance',
        { method: 'GET' }
      );
      const logs = response.logs || [];

      const container = document.getElementById('auditLogContainer');

      if (logs.length === 0) {
        container.innerHTML =
          '<div style="padding: 2rem; text-align: center; color: #999;">No audit logs found</div>';
        return;
      }

      container.innerHTML = logs
        .map(log => {
          const date = new Date(log.timestamp || log.createdAt);
          const actionLabel = log.action.replace(/_/g, ' ').toLowerCase();
          return `
          <div style="padding: 0.75rem; border-bottom: 1px solid #eee; font-size: 0.9rem;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
              <strong>${actionLabel}</strong>
              <span style="color: #999;">${date.toLocaleString()}</span>
            </div>
            <div style="color: #666;">
              by ${log.adminEmail || 'Unknown'}
            </div>
            ${
              log.details
                ? `<div style="color: #999; font-size: 0.85rem; margin-top: 0.25rem;">
              ${JSON.stringify(log.details).substring(0, 100)}...
            </div>`
                : ''
            }
          </div>
        `;
        })
        .join('');
    } catch (err) {
      AdminShared.debugError('Failed to load audit logs:', err);
      document.getElementById('auditLogContainer').innerHTML =
        '<div style="padding: 2rem; text-align: center; color: #e74c3c;">Failed to load audit logs</div>';
    }
  }

  // Load database health
  async function loadDatabaseHealth() {
    try {
      const status = await AdminShared.adminFetch('/api/admin/db-status', { method: 'GET' });

      const statusEl = document.getElementById('dbConnectionStatus');
      const indicatorEl = document.getElementById('dbStatusIndicator');
      const backendEl = document.getElementById('dbBackendType');
      const lastOpEl = document.getElementById('dbLastOperation');

      // Check if all required elements exist
      if (!statusEl || !indicatorEl || !backendEl || !lastOpEl) {
        console.warn('Database health UI elements not found');
        return;
      }

      // Check if database is connected (initialized or state is completed)
      if (status.initialized || status.state === 'completed') {
        statusEl.textContent = 'Connected';
        indicatorEl.style.background = '#27ae60';
      } else if (status.state === 'initializing') {
        statusEl.textContent = 'Initializing...';
        indicatorEl.style.background = '#f39c12';
      } else if (status.state === 'error') {
        statusEl.textContent = 'Error';
        indicatorEl.style.background = '#e74c3c';
      } else {
        statusEl.textContent = 'Disconnected';
        indicatorEl.style.background = '#e74c3c';
      }

      backendEl.textContent =
        status.dbType === 'mongodb' ? 'MongoDB (Primary)' : 'Local Files (Fallback)';
      lastOpEl.textContent = new Date().toLocaleString();
    } catch (err) {
      AdminShared.debugError('Failed to load database health:', err);
      const statusEl = document.getElementById('dbConnectionStatus');
      const indicatorEl = document.getElementById('dbStatusIndicator');
      if (statusEl) {
        statusEl.textContent = 'Error checking status';
      }
      if (indicatorEl) {
        indicatorEl.style.background = '#e74c3c';
      }
    }
  }

  // Export settings
  document.getElementById('exportSettings').addEventListener('click', async () => {
    try {
      const settings = await AdminShared.adminFetch('/api/admin/settings/site', {
        method: 'GET',
      });
      const features = await AdminShared.adminFetch('/api/admin/settings/features', {
        method: 'GET',
      });
      const maintenance = await AdminShared.adminFetch('/api/admin/settings/maintenance', {
        method: 'GET',
      });

      const exportData = {
        exported: new Date().toISOString(),
        site: settings,
        features: features,
        maintenance: maintenance,
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eventflow-settings-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);

      AdminShared.showToast('Settings exported successfully', 'success');
    } catch (err) {
      AdminShared.debugError('Failed to export settings:', err);
      AdminShared.showToast('Failed to export settings', 'error');
    }
  });

  // Import settings
  document.getElementById('importSettings').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
  });

  document.getElementById('importFileInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const confirmed = await AdminShared.showConfirmModal({
        title: 'Import Settings?',
        message: 'This will overwrite your current settings. Are you sure you want to continue?',
        confirmText: 'Import',
        cancelText: 'Cancel',
        type: 'warning',
      });

      if (!confirmed) {
        e.target.value = '';
        return;
      }

      // Import site settings
      if (data.site) {
        await AdminShared.adminFetch('/api/admin/settings/site', {
          method: 'PUT',
          body: data.site,
        });
      }

      // Import feature flags
      if (data.features) {
        await AdminShared.adminFetch('/api/admin/settings/features', {
          method: 'PUT',
          body: data.features,
        });
      }

      // Import maintenance settings (only if import data has maintenance disabled)
      if (data.maintenance && !data.maintenance.enabled) {
        await AdminShared.adminFetch('/api/admin/settings/maintenance', {
          method: 'PUT',
          body: data.maintenance,
        });
      }

      AdminShared.showToast('Settings imported successfully', 'success');

      // Reload all settings
      loadSiteConfig();
      loadFeatureFlags();
      loadMaintenanceMode();

      e.target.value = '';
    } catch (err) {
      AdminShared.debugError('Failed to import settings:', err);
      AdminShared.showToast(`Failed to import settings: ${err.message}`, 'error');
      e.target.value = '';
    }
  });

  // Initial load
  async function initializeSettings() {
    // Fetch CSRF token first
    await AdminShared.fetchCSRFToken();

    // Initialize change listeners for feature flags
    initFeatureFlagChangeListeners();

    // Content Management Save Handler
    const saveContentBtn = document.getElementById('saveContentBtn');
    if (saveContentBtn) {
      saveContentBtn.addEventListener('click', async () => {
        const legalLastUpdated = document.getElementById('legalLastUpdated').value.trim();
        const legalEffectiveDate = document.getElementById('legalEffectiveDate').value.trim();
        const statusEl = document.getElementById('contentSaveStatus');
        const alertEl = document.getElementById('contentManagementAlert');

        if (!legalLastUpdated || !legalEffectiveDate) {
          if (statusEl) {
            statusEl.textContent = '❌ Both fields are required';
            statusEl.style.color = '#DC2626';
          }
          return;
        }

        await AdminShared.safeAction(
          saveContentBtn,
          async () => {
            const data = {
              legalLastUpdated,
              legalEffectiveDate,
            };

            const result = await AdminShared.adminFetchWithTimeout('/api/admin/content-config', {
              method: 'PUT',
              body: data,
              timeout: 10000,
            });

            // Update display values
            document.getElementById('displayLegalLastUpdated').textContent = legalLastUpdated;
            document.getElementById('displayLegalEffectiveDate').textContent = legalEffectiveDate;

            // Show info alert about server restart
            if (alertEl) {
              alertEl.style.display = 'block';
            }

            return result;
          },
          {
            loadingText: 'Saving...',
            successMessage: 'Content configuration saved (server restart required)',
            errorMessage: 'Failed to save content configuration',
          }
        );
      });
    }

    // Now load settings in parallel
    await Promise.all([
      loadSiteConfig(),
      loadFeatureFlags(),
      loadMaintenanceMode(),
      loadSystemInfo(),
      loadAuditLogs(),
      loadDatabaseHealth(),
    ]);
  }

  initializeSettings();

  // Refresh database health every 30 seconds
  setInterval(loadDatabaseHealth, 30000);

  // Backup & Restore functionality
  // Backup & Restore functionality
  document.getElementById('createBackupBtn')?.addEventListener('click', async () => {
    if (
      !(await AdminShared.showConfirmModal({
        title: 'Create Backup',
        message: 'Create a full database backup? This may take a moment.',
        confirmText: 'Create',
      }))
    ) {
      return;
    }

    try {
      const response = await fetch('/api/admin/backup/create', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
        },
      });

      if (response.ok) {
        const data = await response.json();
        AdminShared.showToast(`Backup created successfully: ${data.filename}`, 'success');
        // Refresh backup list if visible
        if (document.getElementById('backupsListContainer').style.display !== 'none') {
          document.getElementById('listBackupsBtn').click();
        }
      } else {
        const error = await response.json();
        AdminShared.showToast(
          `Failed to create backup: ${error.error || 'Unknown error'}`,
          'error'
        );
      }
    } catch (error) {
      console.error('Backup error:', error);
      AdminShared.showToast('Failed to create backup', 'error');
    }
  });

  document.getElementById('listBackupsBtn')?.addEventListener('click', async () => {
    const container = document.getElementById('backupsListContainer');
    const list = document.getElementById('backupsList');

    try {
      const response = await fetch('/api/admin/backup/list', {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();

        if (!data.backups || data.backups.length === 0) {
          list.innerHTML = '<p class="small">No backups found</p>';
        } else {
          let html = '<div style="display: flex; flex-direction: column; gap: 0.5rem;">';
          data.backups.forEach(backup => {
            html += `
                <div style="padding: 0.75rem; border: 1px solid #e5e7eb; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <strong>${backup.filename}</strong>
                    <div class="small" style="color: #6b7280;">
                      ${new Date(backup.createdAt).toLocaleString()} • ${(backup.size / 1024).toFixed(2)} KB
                    </div>
                  </div>
                  <button class="btn btn-sm btn-secondary restore-backup-btn" data-filename="${backup.filename}">
                    Restore
                  </button>
                </div>
              `;
          });
          html += '</div>';
          list.innerHTML = html;

          // Add restore handlers
          list.querySelectorAll('.restore-backup-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
              const filename = e.target.getAttribute('data-filename');
              if (
                !(await AdminShared.showConfirmModal({
                  title: 'Restore Backup',
                  message: `Restore from backup "${filename}"? This will overwrite current data!`,
                  confirmText: 'Restore',
                }))
              ) {
                return;
              }

              try {
                const restoreResponse = await fetch('/api/admin/backup/restore', {
                  method: 'POST',
                  credentials: 'include',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
                  },
                  body: JSON.stringify({ filename }),
                });

                if (restoreResponse.ok) {
                  AdminShared.showToast('Backup restored successfully', 'success');
                  window.location.reload();
                } else {
                  const error = await restoreResponse.json();
                  AdminShared.showToast(
                    `Failed to restore: ${error.error || 'Unknown error'}`,
                    'error'
                  );
                }
              } catch (error) {
                console.error('Restore error:', error);
                AdminShared.showToast('Failed to restore backup', 'error');
              }
            });
          });
        }

        container.style.display = 'block';
      } else {
        AdminShared.showToast('Failed to load backups', 'error');
      }
    } catch (error) {
      console.error('List backups error:', error);
      AdminShared.showToast('Failed to load backups', 'error');
    }
  });
})();
