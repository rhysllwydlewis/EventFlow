(function () {
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
      'featureRequirePublicCalendarApproval',
      'featureMarketplaceAvailability',
      'featureQuoteBooking',
      'featureBookingPayments',
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
      requirePublicCalendarApproval: getCheckboxValue('featureRequirePublicCalendarApproval'),
      marketplaceAvailability: getCheckboxValue('featureMarketplaceAvailability'),
      quoteBooking: getCheckboxValue('featureQuoteBooking'),
      bookingPayments: getCheckboxValue('featureBookingPayments'),
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
        requirePublicCalendarApproval: flags.requirePublicCalendarApproval === true,
        marketplaceAvailability: flags.marketplaceAvailability === true,
        quoteBooking: flags.quoteBooking === true,
        bookingPayments: flags.bookingPayments === true,
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
      setCheckboxValue(
        'featureRequirePublicCalendarApproval',
        originalFeatureFlags.requirePublicCalendarApproval
      );
      setCheckboxValue(
        'featureMarketplaceAvailability',
        originalFeatureFlags.marketplaceAvailability
      );
      setCheckboxValue('featureQuoteBooking', originalFeatureFlags.quoteBooking);
      setCheckboxValue('featureBookingPayments', originalFeatureFlags.bookingPayments);

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
      'featureRequirePublicCalendarApproval',
      'featureMarketplaceAvailability',
      'featureQuoteBooking',
      'featureBookingPayments',
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
      requirePublicCalendarApproval: getCheckboxValue('featureRequirePublicCalendarApproval'),
      marketplaceAvailability: getCheckboxValue('featureMarketplaceAvailability'),
      quoteBooking: getCheckboxValue('featureQuoteBooking'),
      bookingPayments: getCheckboxValue('featureBookingPayments'),
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

  /**
   * Load the homepage sign-up popup settings into the form.
   *
   * @returns {Promise<void>}
   */
  const SIGNUP_POPUP_MODES = ['disabled', 'popup', 'banner'];

  /**
   * Reflect the selected mode onto the segmented control's pressed state and
   * the hidden input the save handler reads from.
   *
   * @param {string} mode - one of SIGNUP_POPUP_MODES
   * @returns {void}
   */
  function setSignupPopupMode(mode) {
    const resolved = SIGNUP_POPUP_MODES.includes(mode) ? mode : 'disabled';
    document.getElementById('signupPopupMode').value = resolved;
    document.querySelectorAll('.signup-popup-mode-btn').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === resolved));
    });
  }

  document.querySelectorAll('.signup-popup-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setSignupPopupMode(btn.dataset.mode));
  });

  async function loadSignupPopup() {
    try {
      const signupPopup = await AdminShared.adminFetch('/api/admin/settings/signup-popup', {
        method: 'GET',
      });
      setSignupPopupMode(signupPopup.mode);
      document.getElementById('signupPopupDelay').value = Number.isInteger(signupPopup.delaySeconds)
        ? signupPopup.delaySeconds
        : 5;
    } catch (err) {
      AdminShared.debugError('Failed to load signup popup settings:', err);
    }
  }

  // Save sign-up popup settings
  document.getElementById('saveSignupPopup').addEventListener('click', async () => {
    const rawDelay = document.getElementById('signupPopupDelay').value.trim();
    const delayValue = Number(rawDelay);

    if (rawDelay === '' || !Number.isInteger(delayValue) || delayValue < 0 || delayValue > 300) {
      AdminShared.showToast('Delay must be a whole number of seconds between 0 and 300', 'error');
      return;
    }

    const data = {
      mode: document.getElementById('signupPopupMode').value,
      delaySeconds: delayValue,
    };

    const saveBtn = document.getElementById('saveSignupPopup');
    await AdminShared.safeAction(
      saveBtn,
      async () => {
        const result = await AdminShared.adminFetch('/api/admin/settings/signup-popup', {
          method: 'PUT',
          body: data,
        });
        await loadSignupPopup();
        return result;
      },
      {
        loadingText: 'Saving...',
        successMessage: 'Sign-up popup settings updated',
        errorMessage: 'Failed to update sign-up popup settings',
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
          const actionLabel = AdminShared.escapeHtml(
            String(log.action || '')
              .replace(/_/g, ' ')
              .toLowerCase()
          );
          const adminEmail = AdminShared.escapeHtml(log.adminEmail || 'Unknown');
          // log.details can contain admin-supplied free text (e.g. email
          // template subject, site tagline) — never inject it unescaped.
          const detailsText = log.details
            ? AdminShared.escapeHtml(JSON.stringify(log.details).substring(0, 100))
            : '';
          return `
          <div style="padding: 0.75rem; border-bottom: 1px solid #eee; font-size: 0.9rem;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
              <strong>${actionLabel}</strong>
              <span style="color: #999;">${date.toLocaleString()}</span>
            </div>
            <div style="color: #666;">
              by ${adminEmail}
            </div>
            ${
              detailsText
                ? `<div style="color: #999; font-size: 0.85rem; margin-top: 0.25rem;">
              ${detailsText}...
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

      const metrics = status.queryMetrics;
      if (metrics && metrics.totalQueries > 0) {
        const slowNote = metrics.slowQueries > 0 ? `, ${metrics.slowQueries} slow` : '';
        lastOpEl.textContent = `${metrics.totalQueries.toLocaleString()} queries — avg ${metrics.avgQueryTimeMs}ms${slowNote}`;
      } else {
        lastOpEl.textContent = 'No queries recorded yet this session';
      }
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

      const importsMaintenanceOn = Boolean(data.maintenance && data.maintenance.enabled);
      const confirmed = await AdminShared.showConfirmModal({
        title: 'Import Settings?',
        message: importsMaintenanceOn
          ? 'This will overwrite your current settings AND enable maintenance mode, taking the site offline for non-admins. Are you sure you want to continue?'
          : 'This will overwrite your current settings. Are you sure you want to continue?',
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

      // Import maintenance settings — the confirmation above already warned
      // the admin explicitly if this would enable maintenance mode, so it's
      // safe to apply the imported value as-is (previously this silently
      // dropped the maintenance section whenever it was enabled, with no
      // indication to the admin that part of their import was skipped).
      if (data.maintenance) {
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

    if (!window.__CSRF_TOKEN__) {
      // Every save button on this page stays permanently disabled without a
      // token — the admin needs to know why, not just see a greyed-out button.
      AdminShared.showToast(
        'Could not verify your session (CSRF token unavailable). Save buttons will stay disabled — try refreshing the page.',
        'error'
      );
    }

    // Initialize change listeners for feature flags
    initFeatureFlagChangeListeners();

    // Now load settings in parallel
    await Promise.all([
      loadSiteConfig(),
      loadFeatureFlags(),
      loadMaintenanceMode(),
      loadSignupPopup(),
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
            const safeFilename = AdminShared.escapeHtml(backup.filename);
            html += `
                <div style="padding: 0.75rem; border: 1px solid #e5e7eb; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <strong>${safeFilename}</strong>
                    <div class="small" style="color: #6b7280;">
                      ${new Date(backup.createdAt).toLocaleString()} • ${(backup.size / 1024).toFixed(2)} KB
                    </div>
                  </div>
                  <button class="ef-cta btn btn-sm btn-secondary restore-backup-btn" data-filename="${safeFilename}">
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

// ── Email Automation Settings ─────────────────────────────────────────────
(function () {
  let emailAutoLoaded = false;
  let originalEmailAuto = {};

  const STATUS_HIDE_MS = 3000;

  function updateEmailAutoStatus(status, text) {
    const el = document.getElementById('emailAutomationStatus');
    const textEl = document.getElementById('emailAutomationStatusText');
    if (el && textEl) {
      el.style.display = status === 'hidden' ? 'none' : 'block';
      textEl.textContent = text || '';
      el.className = `feature-flags-status feature-flags-status-${status}`;
    }
  }

  function getEmailAutoValues() {
    return {
      enabled: document.getElementById('emailAutoEnabled')?.checked ?? false,
      cron: document.getElementById('emailAutoCron')?.value?.trim() || '0 9 * * *',
      promptTypes: {
        missingPackages: document.getElementById('emailAutoMissingPackages')?.checked ?? true,
        incompleteProfile: document.getElementById('emailAutoIncompleteProfile')?.checked ?? true,
        missingPhotos: document.getElementById('emailAutoMissingPhotos')?.checked ?? true,
      },
    };
  }

  function hasEmailAutoChanged() {
    if (!emailAutoLoaded) {
      return false;
    }
    const current = getEmailAutoValues();
    return JSON.stringify(current) !== JSON.stringify(originalEmailAuto);
  }

  function updateEmailAutoSaveBtn() {
    const btn = document.getElementById('saveEmailAutomation');
    if (btn) {
      btn.disabled = !(emailAutoLoaded && window.__CSRF_TOKEN__ && hasEmailAutoChanged());
    }
  }

  async function loadEmailAutoSettings() {
    updateEmailAutoStatus('loading', 'Loading...');
    emailAutoLoaded = false;
    try {
      const data = await AdminShared.adminFetch('/api/admin/settings/email-automation', {
        method: 'GET',
      });

      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) {
          el.checked = val;
        }
      };
      const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) {
          el.value = val || '';
        }
      };

      setVal('emailAutoEnabled', data.enabled);
      setVal('emailAutoMissingPackages', data.promptTypes?.missingPackages !== false);
      setVal('emailAutoIncompleteProfile', data.promptTypes?.incompleteProfile !== false);
      setVal('emailAutoMissingPhotos', data.promptTypes?.missingPhotos !== false);
      setTxt('emailAutoCron', data.cron || '0 9 * * *');

      originalEmailAuto = getEmailAutoValues();
      emailAutoLoaded = true;

      const updatedAtEl = document.getElementById('emailAutoUpdatedTime');
      const updatedByEl = document.getElementById('emailAutoUpdatedBy');
      const lastUpdEl = document.getElementById('emailAutoLastUpdated');
      if (updatedAtEl && updatedByEl && lastUpdEl && data.updatedAt && data.updatedBy) {
        updatedAtEl.textContent = new Date(data.updatedAt).toLocaleString();
        updatedByEl.textContent = data.updatedBy;
        lastUpdEl.style.display = 'block';
      }

      // Populate last-run status chip
      renderLastRun(data.lastRun);

      updateEmailAutoStatus('hidden');
      updateEmailAutoSaveBtn();

      // Notify other IIFEs that settings have been loaded (for run history, etc.)
      document.dispatchEvent(new CustomEvent('emailAutoSettingsLoaded', { detail: data }));
    } catch (err) {
      AdminShared.debugError('Failed to load email automation settings:', err);
      updateEmailAutoStatus('error', 'Error loading settings');
    }
  }

  function renderLastRun(lastRun) {
    const el = document.getElementById('emailAutoLastRun');
    if (!el || !lastRun) {
      return;
    }
    el.style.display = 'block';
    const timeEl = document.getElementById('emailAutoLastRunTime');
    const scannedEl = document.getElementById('emailAutoLastRunScanned');
    const sentEl = document.getElementById('emailAutoLastRunSent');
    const skippedEl = document.getElementById('emailAutoLastRunSkipped');
    const errorsEl = document.getElementById('emailAutoLastRunErrors');
    const errCountEl = document.getElementById('emailAutoLastRunErrorCount');
    const cappedEl = document.getElementById('emailAutoLastRunCapped');
    if (timeEl) {
      timeEl.textContent = lastRun.finishedAt ? new Date(lastRun.finishedAt).toLocaleString() : '?';
    }
    if (scannedEl) {
      scannedEl.textContent = lastRun.scanned ?? '-';
    }
    if (sentEl) {
      sentEl.textContent = lastRun.sent ?? '-';
    }
    if (skippedEl) {
      skippedEl.textContent = lastRun.skippedCadence ?? '-';
    }
    if (errorsEl && errCountEl) {
      if (lastRun.errors > 0) {
        errCountEl.textContent = lastRun.errors;
        errorsEl.style.display = '';
      } else {
        errorsEl.style.display = 'none';
      }
    }
    if (cappedEl) {
      cappedEl.style.display = lastRun.cappedByLimit ? '' : 'none';
    }
  }

  // Change listeners
  [
    'emailAutoEnabled',
    'emailAutoMissingPackages',
    'emailAutoIncompleteProfile',
    'emailAutoMissingPhotos',
    'emailAutoCron',
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', updateEmailAutoSaveBtn);
    }
    if (el && el.type === 'text') {
      el.addEventListener('input', updateEmailAutoSaveBtn);
    }
  });

  // Save button
  document.getElementById('saveEmailAutomation')?.addEventListener('click', async () => {
    const btn = document.getElementById('saveEmailAutomation');
    if (!btn || btn.disabled) {
      return;
    }

    const data = getEmailAutoValues();
    await AdminShared.safeAction(
      btn,
      async () => {
        const result = await AdminShared.adminFetch('/api/admin/settings/email-automation', {
          method: 'PUT',
          body: data,
        });
        updateEmailAutoStatus('saved', 'Saved');
        setTimeout(() => updateEmailAutoStatus('hidden'), STATUS_HIDE_MS);
        await loadEmailAutoSettings();
        return result;
      },
      {
        loadingText: 'Saving...',
        successMessage: 'Email automation settings saved',
        errorMessage: 'Failed to save settings',
      }
    );
  });

  // Dry Run button
  document.getElementById('emailAutoDryRun')?.addEventListener('click', async () => {
    const btn = document.getElementById('emailAutoDryRun');
    if (!btn) {
      return;
    }
    await AdminShared.safeAction(
      btn,
      async () => {
        const result = await AdminShared.adminFetch(
          '/api/admin/email-automation/action-prompts/run',
          { method: 'POST', body: { dryRun: true } }
        );
        const s = result.summary || {};
        updateEmailAutoStatus(
          'saved',
          `Dry run: scanned ${s.scanned ?? 0}, would-send ${s.sent ?? 0}, skipped ${s.skippedCadence ?? 0}`
        );
        setTimeout(() => updateEmailAutoStatus('hidden'), 6000);
        return result;
      },
      {
        loadingText: 'Running dry run…',
        successMessage: 'Dry run complete',
        errorMessage: 'Dry run failed',
      }
    );
  });

  // Send Now button — opens confirmation modal
  document.getElementById('emailAutoSendNow')?.addEventListener('click', () => {
    const modal = document.getElementById('emailAutoConfirmModal');
    if (modal) {
      modal.style.display = 'flex';
    }
  });

  document.getElementById('emailAutoConfirmCancel')?.addEventListener('click', () => {
    const modal = document.getElementById('emailAutoConfirmModal');
    if (modal) {
      modal.style.display = 'none';
    }
  });

  document.getElementById('emailAutoConfirmSend')?.addEventListener('click', async () => {
    const modal = document.getElementById('emailAutoConfirmModal');
    if (modal) {
      modal.style.display = 'none';
    }
    const btn = document.getElementById('emailAutoSendNow');
    await AdminShared.safeAction(
      btn,
      async () => {
        const result = await AdminShared.adminFetch(
          '/api/admin/email-automation/action-prompts/run',
          { method: 'POST', body: { dryRun: false, confirm: true } }
        );
        const s = result.summary || {};
        updateEmailAutoStatus(
          'saved',
          `Run complete: scanned ${s.scanned ?? 0}, sent ${s.sent ?? 0}, errors ${s.errors ?? 0}`
        );
        setTimeout(() => updateEmailAutoStatus('hidden'), 6000);
        await loadEmailAutoSettings();
        return result;
      },
      {
        loadingText: 'Sending…',
        successMessage: 'Email run complete',
        errorMessage: 'Email run failed',
      }
    );
  });

  loadEmailAutoSettings();

  // Surface whether the recurring cron job is actually alive. Previously
  // there was no way to tell from this page whether the scheduler had ever
  // fired — a dead/crashed scheduler looked identical to a healthy one that
  // just hadn't hit its next run yet. This reuses the existing background-job
  // telemetry endpoint (also used by the admin-debug page) rather than
  // building a second monitoring system.
  async function loadSchedulerHealth() {
    const el = document.getElementById('emailAutoSchedulerHealth');
    if (!el) {
      return;
    }
    try {
      const data = await AdminShared.adminFetch('/api/admin/background-jobs?limit=1', {
        method: 'GET',
      });
      const job = (data.jobs || []).find(j => j.key === 'action-prompts');
      if (!job) {
        el.style.display = 'none';
        return;
      }

      const styles = {
        healthy: { bg: '#f0fdf4', color: '#166534', label: '● Scheduler running' },
        warning: { bg: '#fffbeb', color: '#92400e', label: '● Scheduler needs attention' },
        overdue: { bg: '#fffbeb', color: '#92400e', label: '● Scheduler overdue' },
        failed: { bg: '#fef2f2', color: '#991b1b', label: '● Scheduler failed' },
      };
      const style = styles[job.health] || {
        bg: '#f8fafc',
        color: '#475569',
        label: `● Scheduler: ${job.health || 'unknown'}`,
      };

      el.style.display = 'block';
      el.style.background = style.bg;
      el.style.color = style.color;
      const nextRunText = job.nextRun
        ? `next run ${new Date(job.nextRun).toLocaleString()}`
        : 'no next run scheduled';
      el.innerHTML = `<strong>${AdminShared.escapeHtml(style.label)}</strong> — cron "${AdminShared.escapeHtml(job.schedule || '?')}", ${AdminShared.escapeHtml(nextRunText)}`;
    } catch (err) {
      AdminShared.debugError('Failed to load scheduler health:', err);
      el.style.display = 'block';
      el.style.background = '#f8fafc';
      el.style.color = '#64748b';
      el.textContent = 'Could not check scheduler status.';
    }
  }
  loadSchedulerHealth();
})();

// ── Run History ───────────────────────────────────────────────────────────
(function () {
  function renderRunHistory(runHistory) {
    const container = document.getElementById('emailAutoRunHistoryContainer');
    if (!container) {
      return;
    }

    if (!runHistory || runHistory.length === 0) {
      container.innerHTML =
        '<p style="color:#6b7280;font-size:0.875rem;">No runs recorded yet. History is populated after each real (non-dry-run) send.</p>';
      return;
    }

    const rows = runHistory
      .map(r => {
        const dt = r.finishedAt ? new Date(r.finishedAt).toLocaleString() : '?';
        const errStyle = r.errors > 0 ? 'color:#dc2626;font-weight:600;' : 'color:#059669;';
        const cappedBadge = r.cappedByLimit
          ? '<span style="display:inline-block;padding:0.1rem 0.4rem;border-radius:9999px;background:#fef3c7;color:#92400e;font-size:0.7rem;font-weight:600;">CAPPED</span>'
          : '';
        // trigger distinguishes an automatic cron-fired run from a manual
        // "Send Now" click — without this an admin can't tell whether the
        // scheduler has ever actually fired on its own.
        const isManual = r.trigger === 'manual';
        const triggerBadge = isManual
          ? '<span style="display:inline-block;padding:0.1rem 0.5rem;border-radius:9999px;background:#e0e7ff;color:#3730a3;font-size:0.7rem;font-weight:600;">MANUAL</span>'
          : '<span style="display:inline-block;padding:0.1rem 0.5rem;border-radius:9999px;background:#dcfce7;color:#166534;font-size:0.7rem;font-weight:600;">SCHEDULED</span>';
        return `<tr>
          <td style="padding:0.4rem 0.5rem;font-size:0.8rem;white-space:nowrap;">${dt}</td>
          <td style="padding:0.4rem 0.5rem;">${triggerBadge}</td>
          <td style="padding:0.4rem 0.5rem;text-align:right;">${r.scanned ?? '-'}</td>
          <td style="padding:0.4rem 0.5rem;text-align:right;font-weight:600;color:#059669;">${r.sent ?? '-'}</td>
          <td style="padding:0.4rem 0.5rem;text-align:right;">${r.skippedCadence ?? '-'}</td>
          <td style="padding:0.4rem 0.5rem;text-align:right;${errStyle}">${r.errors ?? '-'}</td>
          <td style="padding:0.4rem 0.5rem;text-align:right;">${cappedBadge}</td>
        </tr>`;
      })
      .join('');

    container.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
          <thead>
            <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
              <th style="padding:0.4rem 0.5rem;text-align:left;font-weight:600;">Finished At</th>
              <th style="padding:0.4rem 0.5rem;text-align:left;font-weight:600;">Trigger</th>
              <th style="padding:0.4rem 0.5rem;text-align:right;font-weight:600;">Scanned</th>
              <th style="padding:0.4rem 0.5rem;text-align:right;font-weight:600;">Sent</th>
              <th style="padding:0.4rem 0.5rem;text-align:right;font-weight:600;">Skipped</th>
              <th style="padding:0.4rem 0.5rem;text-align:right;font-weight:600;">Errors</th>
              <th style="padding:0.4rem 0.5rem;text-align:right;font-weight:600;"></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // Hook into email-automation settings load — re-use the event when settings are loaded
  // by patching after the existing IIFE sets up. We listen for a custom event dispatched
  // after loadEmailAutoSettings completes.
  document.addEventListener('emailAutoSettingsLoaded', e => {
    renderRunHistory(e.detail?.runHistory);
  });
})();

// ── Email Preview Tool ────────────────────────────────────────────────────
(function () {
  let currentPreviewUserId = null;

  function setPreviewStatus(msg, type) {
    const el = document.getElementById('emailPreviewStatus');
    if (!el) {
      return;
    }
    if (!msg) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.cssText = `display:block;padding:0.5rem 0.75rem;border-radius:6px;font-size:0.875rem;background:${type === 'error' ? '#fee2e2' : '#f0fdf4'};color:${type === 'error' ? '#991b1b' : '#166534'};border:1px solid ${type === 'error' ? '#fca5a5' : '#bbf7d0'};`;
    el.textContent = msg;
  }

  document.getElementById('emailPreviewBtn')?.addEventListener('click', async () => {
    const input = document.getElementById('emailPreviewSupplierInput')?.value?.trim();
    if (!input) {
      setPreviewStatus('Please enter a supplier user ID or email address.', 'error');
      return;
    }
    setPreviewStatus('Loading preview…', 'info');
    document.getElementById('emailPreviewResult').style.display = 'none';
    document.getElementById('emailPreviewSendToAdminBtn').style.display = 'none';

    try {
      const data = await AdminShared.adminFetch(
        '/api/admin/email-automation/action-prompts/preview',
        {
          method: 'POST',
          body: { supplierUserId: input },
        }
      );

      currentPreviewUserId = input;

      const toEl = document.getElementById('emailPreviewTo');
      const subEl = document.getElementById('emailPreviewSubject');
      const iframeEl = document.getElementById('emailPreviewIframe');
      const eligEl = document.getElementById('emailPreviewEligibility');
      const resultEl = document.getElementById('emailPreviewResult');

      if (toEl) {
        toEl.textContent = data.to || '?';
      }
      if (subEl) {
        subEl.textContent = data.subject || '?';
      }

      if (eligEl) {
        const e = data.eligibility || {};
        const items = [
          `Global enabled: ${e.globalEnabled ? '✓' : '✗'}`,
          `Verified: ${e.userVerified ? '✓' : '✗'}`,
          `Prefs enabled: ${e.userPrefsEnabled ? '✓' : '✗'}`,
          `Has outstanding actions: ${e.hasOutstandingActions ? '✓' : '✗'}`,
          `Would send now: ${e.wouldSendNow ? '✓' : '✗'}`,
        ].join(' &nbsp;|&nbsp; ');
        eligEl.innerHTML = `<strong>Eligibility:</strong> ${items}`;
        eligEl.style.display = 'block';
      }

      if (iframeEl && data.html) {
        iframeEl.srcdoc = data.html;
      }

      if (resultEl) {
        resultEl.style.display = 'block';
      }
      document.getElementById('emailPreviewSendToAdminBtn').style.display = '';
      setPreviewStatus('', null);
    } catch (err) {
      setPreviewStatus(`Preview failed: ${err.message || 'Unknown error'}`, 'error');
    }
  });

  // Send preview to admin
  document.getElementById('emailPreviewSendToAdminBtn')?.addEventListener('click', () => {
    const modal = document.getElementById('emailPreviewConfirmModal');
    const msgEl = document.getElementById('emailPreviewConfirmMsg');
    if (!modal) {
      return;
    }
    if (msgEl) {
      msgEl.textContent = `This will send the action-prompt preview email to your admin email address. The supplier will NOT receive anything.`;
    }
    modal.style.display = 'flex';
  });

  document.getElementById('emailPreviewConfirmCancel')?.addEventListener('click', () => {
    document.getElementById('emailPreviewConfirmModal').style.display = 'none';
  });

  document.getElementById('emailPreviewConfirmSend')?.addEventListener('click', async () => {
    document.getElementById('emailPreviewConfirmModal').style.display = 'none';
    const input =
      currentPreviewUserId || document.getElementById('emailPreviewSupplierInput')?.value?.trim();
    if (!input) {
      return;
    }

    const btn = document.getElementById('emailPreviewSendToAdminBtn');
    await AdminShared.safeAction(
      btn,
      async () => {
        const result = await AdminShared.adminFetch(
          '/api/admin/email-automation/action-prompts/send-preview-to-admin',
          { method: 'POST', body: { supplierUserId: input, confirm: true } }
        );
        setPreviewStatus(`Preview sent to ${result.sentTo || 'your email'}`, 'success');
        return result;
      },
      {
        loadingText: 'Sending…',
        successMessage: 'Preview email sent to your admin address',
        errorMessage: 'Failed to send preview',
      }
    );
  });

  // Close modal on backdrop click
  document.getElementById('emailPreviewConfirmModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('emailPreviewConfirmModal')) {
      document.getElementById('emailPreviewConfirmModal').style.display = 'none';
    }
  });
})();
