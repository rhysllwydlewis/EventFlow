/**
 * Start Wizard Page Logic
 * Multi-step planning wizard implementation
 */

(function () {
  'use strict';

  /**
   * HTML escape utility — defined first so all template literals below can use it.
   */
  function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) {
      return '';
    }
    const div = document.createElement('div');
    div.textContent = String(unsafe);
    return div.innerHTML;
  }

  // Available categories for wizard steps (in order)
  const CATEGORIES = [
    { key: 'venues', name: 'Venues', icon: '🏛️' },
    { key: 'photography', name: 'Photography', icon: '📸' },
    { key: 'catering', name: 'Catering', icon: '🍽️' },
    { key: 'flowers', name: 'Flowers & Décor', icon: '💐' },
  ];

  const WIZARD_DATA_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

  // Single source of truth for step indices and counts (Bug 1.1)
  const STEP_CONFIG = {
    WELCOME: -1,
    EVENT_TYPE: 0,
    EVENT_BASICS: 1,
    CATEGORY_START: 2,
    get REVIEW() {
      return 2 + CATEGORIES.length;
    },
    get SUCCESS() {
      return 2 + CATEGORIES.length + 1;
    },
    get TOTAL_VISIBLE() {
      return 2 + CATEGORIES.length + 1;
    }, // excludes welcome & success
  };

  // Valid event types accepted by the wizard
  const VALID_EVENT_TYPES = ['Wedding', 'Corporate', 'Birthday', 'Other'];

  let currentStep = STEP_CONFIG.WELCOME; // Start at welcome screen
  let wizardState = null;
  const availablePackages = {}; // { categoryKey: [packages] }
  let hasShownWelcome = false;
  let savedPlanId = null; // Stored after successful plan creation for "View Plan" link
  let _beforeunloadHandler = null; // Stored so we can remove it on completion
  let _wizardCompleted = false; // Prevents beforeunload firing after successful submission
  let _mobileSummaryExpanded = false; // Tracks expanded state of mobile summary across re-renders

  /**
   * Initialize the wizard
   */
  function init() {
    // Load wizard state
    if (typeof window.WizardState === 'undefined') {
      console.error('WizardState not loaded');
      return;
    }

    // Check if we need to restore from localStorage
    restoreWizardState();

    wizardState = window.WizardState.getState();

    // Set up autosave callback
    window.WizardState.setAutosaveCallback(handleAutosave);

    // Check if user has started wizard before
    const timeSinceUpdate = window.WizardState.getTimeSinceLastUpdate();
    hasShownWelcome = timeSinceUpdate < WIZARD_DATA_EXPIRY_MS && wizardState.wizardStartedAt;

    // Determine starting step
    if (hasShownWelcome && wizardState.currentStep >= 0) {
      currentStep = wizardState.currentStep;
    } else {
      currentStep = STEP_CONFIG.WELCOME; // Show welcome screen
    }

    // Parse URL params and prefill wizard state if present
    const urlParams = new URLSearchParams(window.location.search);
    const hasParams = Array.from(urlParams.keys()).length > 0;

    if (hasParams) {
      // Prefill step EVENT_TYPE (event type) if provided
      const eventType = urlParams.get('eventType');
      if (eventType && VALID_EVENT_TYPES.includes(eventType)) {
        window.WizardState.saveStep(STEP_CONFIG.EVENT_TYPE, { eventType });
      }

      // Prefill step EVENT_BASICS (location, guests, budget) if provided
      const prefillData = {};
      const location = urlParams.get('location');
      const guests = urlParams.get('guests');
      const budget = urlParams.get('budget');

      if (location) {
        prefillData.location = location;
      }
      if (guests && !isNaN(parseInt(guests, 10))) {
        prefillData.guests = parseInt(guests, 10);
      }
      if (budget) {
        prefillData.budget = budget;
      }

      // Only save if we have data to prefill
      if (Object.keys(prefillData).length > 0) {
        window.WizardState.saveStep(STEP_CONFIG.EVENT_BASICS, prefillData);
      }

      // Reload state after prefilling
      wizardState = window.WizardState.getState();
    }

    // Load categories and packages
    // Note: Categories are defined statically in CATEGORIES array above.
    // Dynamic loading via API is not implemented; add here if needed in future.

    // Render initial step
    renderStep(currentStep);

    // Render plan summary
    renderPlanSummary();

    // Warn if user tries to leave with in-progress data
    setupBeforeUnload();
  }

  /**
   * Handle autosave callback
   */
  function handleAutosave() {
    showAutosaveIndicator();
  }

  /**
   * Show autosave indicator briefly
   */
  function showAutosaveIndicator() {
    const summary = document.getElementById('plan-summary');
    if (!summary) {
      return;
    }

    // Check if indicator already exists
    let indicator = summary.querySelector('.wizard-autosave');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'wizard-autosave';
      indicator.innerHTML = `
        <span class="wizard-autosave-icon">✓</span>
        <span class="wizard-autosave-text">All changes saved</span>
      `;
      summary.appendChild(indicator);
    }

    // Show indicator
    indicator.style.display = 'flex';

    // Hide after 3 seconds
    setTimeout(() => {
      indicator.style.display = 'none';
    }, 3000);
  }

  /**
   * Load packages for a category
   * @param {string} categoryKey - Category key
   * @param {string} eventType - Event type filter
   */
  async function loadPackagesForCategory(categoryKey, eventType) {
    try {
      // Special handling for venues - use proximity filtering if location is set
      if (categoryKey === 'venues') {
        const state = window.WizardState.getState();
        if (state.location) {
          // Use venue proximity endpoint
          const params = new URLSearchParams({
            location: state.location,
            radiusMiles: '10',
          });

          const response = await fetch(`/api/v1/venues/near?${params}`);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const data = await response.json();

          // Convert venues to package format for display
          const venues = (data.venues || []).map(venue => ({
            id: venue.id,
            title: venue.name,
            supplierId: venue.id,
            supplierName: venue.name,
            description: venue.description_short || '',
            price: venue.price_display || 'POA',
            image: venue.photos && venue.photos[0] ? venue.photos[0] : null,
            category: venue.category,
            distance: venue.distance,
            _isVenue: true,
          }));

          availablePackages[categoryKey] = venues;
          return venues;
        }
      }

      const params = new URLSearchParams({
        category: categoryKey,
        eventType: eventType || 'Other',
        approved: 'true',
      });

      const response = await fetch(`/api/v1/packages/search?${params}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      availablePackages[categoryKey] = data.items || [];
      return data.items || [];
    } catch (err) {
      console.error('Error loading packages:', err);
      // Signal error so caller can show error state
      return null;
    }
  }

  /**
   * Render a wizard step
   * @param {number} stepIndex - Step to render
   */
  function renderStep(stepIndex) {
    const container = document.getElementById('wizard-container');
    if (!container) {
      return;
    }

    let html = '';

    // Step-specific rendering
    if (stepIndex === STEP_CONFIG.WELCOME) {
      // Welcome screen — no progress indicator
      html += renderWelcomeScreen();
    } else if (stepIndex === STEP_CONFIG.SUCCESS) {
      // Success screen — no progress indicator (it would show "Step 8 of 7")
      html += renderSuccessScreen();
    } else {
      // All wizard steps: show progress indicator then step content
      html += renderProgressIndicator(stepIndex);

      if (stepIndex === STEP_CONFIG.EVENT_TYPE) {
        html += renderEventTypeStep();
      } else if (stepIndex === STEP_CONFIG.EVENT_BASICS) {
        html += renderEventBasicsStep();
      } else if (stepIndex >= STEP_CONFIG.CATEGORY_START && stepIndex < STEP_CONFIG.REVIEW) {
        const categoryIndex = stepIndex - STEP_CONFIG.CATEGORY_START;
        html += renderCategoryStep(CATEGORIES[categoryIndex]);
      } else if (stepIndex === STEP_CONFIG.REVIEW) {
        html += renderReviewStep();
      }
    }

    container.innerHTML = html;

    // Announce step change for screen readers
    const liveRegion = document.getElementById('wizard-live-region');
    if (liveRegion && stepIndex >= 0 && stepIndex <= STEP_CONFIG.REVIEW) {
      const stepTitles = ['Event Type', 'Event Basics', ...CATEGORIES.map(c => c.name), 'Review'];
      const title = stepTitles[stepIndex] || '';
      if (title) {
        liveRegion.textContent = `Step ${stepIndex + 1} of ${STEP_CONFIG.TOTAL_VISIBLE}: ${title}`;
      }
    }

    // Attach event listeners
    attachStepListeners(stepIndex);
  }

  /**
   * Render welcome screen
   */
  function renderWelcomeScreen() {
    return `
      <div class="wizard-card wizard-welcome">
        <h1>Plan Your Perfect Event</h1>
        <p class="wizard-welcome-subtitle">Let us help you create an amazing event in just a few minutes</p>
        
        <div class="wizard-welcome-benefits">
          <div class="wizard-benefit">
            <div class="wizard-benefit-icon">⏱️</div>
            <div class="wizard-benefit-text">Takes about 5 minutes to complete</div>
          </div>
          <div class="wizard-benefit">
            <div class="wizard-benefit-icon">📝</div>
            <div class="wizard-benefit-text">We'll ask 6 simple questions about your event</div>
          </div>
          <div class="wizard-benefit">
            <div class="wizard-benefit-icon">💾</div>
            <div class="wizard-benefit-text">Your progress is automatically saved</div>
          </div>
          <div class="wizard-benefit">
            <div class="wizard-benefit-icon">⏭️</div>
            <div class="wizard-benefit-text">Skip any step you're unsure about</div>
          </div>
        </div>

        <div class="wizard-welcome-actions">
          <button class="cta wizard-get-started" type="button">Get Started</button>
        </div>
      </div>
    `;
  }

  /**
   * Render progress indicator with step circles
   * @param {number} stepIndex - Current step (0-based)
   */
  function renderProgressIndicator(stepIndex) {
    const totalSteps = STEP_CONFIG.TOTAL_VISIBLE; // Excludes welcome and success
    const progressPercent = Math.round(((stepIndex + 1) / totalSteps) * 100);

    // Derive step titles from CATEGORIES so they stay in sync automatically
    const stepTitles = ['Event Type', 'Event Basics', ...CATEGORIES.map(c => c.name), 'Review'];

    const currentTitle = stepTitles[stepIndex] || 'Planning';

    return `
      <div class="wizard-progress-container">
        <div class="wizard-progress-info">
          <span class="wizard-progress-percentage">${progressPercent}% Complete</span>
          <span class="wizard-step-indicator">Step ${stepIndex + 1} of ${totalSteps}</span>
        </div>
        <div class="wizard-progress">
          <div class="wizard-progress-bar" style="width: ${progressPercent}%"></div>
        </div>
        <div class="wizard-step-title">${currentTitle}</div>
      </div>
    `;
  }

  /**
   * Render event type selection step
   */
  function renderEventTypeStep() {
    const state = window.WizardState.getState();
    return `
      <div class="wizard-card">
        <h2>What type of event are you planning?</h2>
        <p class="small">This helps us show you the most relevant suppliers and packages.</p>
        
        <div class="wizard-options" role="group" aria-label="Event type options">
          <button class="wizard-option ${state.eventType === 'Wedding' ? 'selected' : ''}" 
                  data-value="Wedding" type="button" id="event-type-wedding"
                  aria-pressed="${state.eventType === 'Wedding' ? 'true' : 'false'}">
            <div class="wizard-option-image-container">
              <img class="wizard-option-image" id="wedding-image" alt="Wedding" />
            </div>
            <span class="wizard-option-label">Wedding</span>
          </button>
          <button class="wizard-option ${state.eventType === 'Corporate' ? 'selected' : ''}" 
                  data-value="Corporate" type="button" id="event-type-corporate"
                  aria-pressed="${state.eventType === 'Corporate' ? 'true' : 'false'}">
            <div class="wizard-option-image-container">
              <img class="wizard-option-image" id="corporate-image" alt="Corporate Event" />
            </div>
            <span class="wizard-option-label">Corporate Event</span>
          </button>
          <button class="wizard-option ${state.eventType === 'Birthday' ? 'selected' : ''}" 
                  data-value="Birthday" type="button" id="event-type-birthday"
                  aria-pressed="${state.eventType === 'Birthday' ? 'true' : 'false'}">
            <div class="wizard-option-image-container">
              <img class="wizard-option-image" id="birthday-image" alt="Birthday Party" />
            </div>
            <span class="wizard-option-label">Birthday Party</span>
          </button>
          <button class="wizard-option ${state.eventType === 'Other' ? 'selected' : ''}" 
                  data-value="Other" type="button" id="event-type-other"
                  aria-pressed="${state.eventType === 'Other' ? 'true' : 'false'}">
            <div class="wizard-option-image-container">
              <img class="wizard-option-image" id="other-event-image" alt="Other Event" />
            </div>
            <span class="wizard-option-label">Other Event</span>
          </button>
        </div>

        <div class="wizard-actions">
          <button class="cta secondary wizard-back" type="button">Back</button>
          <button class="cta wizard-next" type="button" ${!state.eventType ? 'disabled' : ''}>Continue</button>
        </div>
      </div>
    `;
  }

  /**
   * Load event type images from Pexels CDN
   */
  function loadEventTypeImages() {
    const images = {
      wedding: document.getElementById('wedding-image'),
      corporate: document.getElementById('corporate-image'),
      birthday: document.getElementById('birthday-image'),
      other: document.getElementById('other-event-image'),
    };

    if (images.wedding) {
      images.wedding.src =
        'https://images.pexels.com/photos/265885/pexels-photo-265885.jpeg?auto=compress&cs=tinysrgb&w=600';
      images.wedding.alt = 'Wedding couple getting married';
    }

    if (images.corporate) {
      images.corporate.src =
        'https://images.pexels.com/photos/1181396/pexels-photo-1181396.jpeg?auto=compress&cs=tinysrgb&w=600';
      images.corporate.alt = 'Corporate business event';
    }

    if (images.birthday) {
      images.birthday.src =
        'https://images.pexels.com/photos/1543762/pexels-photo-1543762.jpeg?auto=compress&cs=tinysrgb&w=600';
      images.birthday.alt = 'Birthday celebration';
    }

    if (images.other) {
      images.other.src =
        'https://images.pexels.com/photos/2306281/pexels-photo-2306281.jpeg?auto=compress&cs=tinysrgb&w=600';
      images.other.alt = 'Elegant gala dinner party';
    }
  }

  /**
   * Render event basics step (name, date, location, guests, budget)
   */
  function renderEventBasicsStep() {
    const state = window.WizardState.getState();
    return `
      <div class="wizard-card">
        <h2>Let's start with the basics</h2>
        <p class="small">Tell us about your ${escapeHtml(state.eventType || 'event')}. Don't worry, you can skip any field you're not sure about yet.</p>
        
        <div class="form-row">
          <label for="wizard-event-name">What's your event called? <span class="small">(optional)</span></label>
          <input type="text" id="wizard-event-name" placeholder="e.g., Sarah & John's Wedding" 
                 value="${escapeHtml(state.eventName || '')}">
          <span class="helper-text">Give your event a memorable name</span>
        </div>

        <div class="form-row">
          <label for="wizard-date">When are you planning your event? <span class="small">(optional)</span></label>
          <input type="date" id="wizard-date" value="${state.date || ''}">
          <span class="helper-text">This helps us check supplier availability</span>
        </div>

        <div class="form-row">
          <label for="wizard-location">Where will it take place?</label>
          <input type="text" id="wizard-location" placeholder="Town, city or postcode" 
                 value="${escapeHtml(state.location || '')}">
          <span class="helper-text">Helps us find local suppliers near you</span>
        </div>

        <div class="form-row">
          <label for="wizard-guests">How many guests? <span class="small">(approximate)</span></label>
          <input type="number" id="wizard-guests" min="1" placeholder="e.g., 60" 
                 value="${state.guests || ''}">
          <span class="helper-text">Just an estimate is fine</span>
        </div>

        <div class="form-row">
          <label for="wizard-budget">What's your budget?</label>
          <select id="wizard-budget">
            <option value="">Not sure yet</option>
            <option ${state.budget === 'Up to £1,000' ? 'selected' : ''}>Up to £1,000</option>
            <option ${state.budget === '£1,000–£3,000' ? 'selected' : ''}>£1,000–£3,000</option>
            <option ${state.budget === '£3,000–£5,000' ? 'selected' : ''}>£3,000–£5,000</option>
            <option ${state.budget === '£5,000–£10,000' ? 'selected' : ''}>£5,000–£10,000</option>
            <option ${state.budget === '£10,000–£20,000' ? 'selected' : ''}>£10,000–£20,000</option>
            <option ${state.budget === '£20,000+' ? 'selected' : ''}>£20,000+</option>
          </select>
          <span class="helper-text">Helps us recommend packages within your range</span>
        </div>

        <div class="wizard-actions">
          <button class="cta secondary wizard-back" type="button">Back</button>
          <button class="cta wizard-next" type="button">Continue</button>
          <button class="wizard-skip" type="button">Skip for now</button>
        </div>
      </div>
    `;
  }

  /**
   * Render category package selection step
   * @param {Object} category - Category object
   */
  function renderCategoryStep(category) {
    const state = window.WizardState.getState();

    // Add proximity indicator for venues if location is set
    let proximityInfo = '';
    if (category.key === 'venues' && state.location) {
      proximityInfo = `
        <div class="wizard-proximity-info">
          <p class="small">
            📍 Showing venues within 10 miles of <strong>${escapeHtml(state.location)}</strong>
          </p>
        </div>
      `;
    }

    return `
      <div class="wizard-card">
        <h2>${category.icon} ${category.name}</h2>
        <p class="small">Browse packages for ${category.name.toLowerCase()}. You can skip this and come back later.</p>
        ${proximityInfo}
        
        <div id="wizard-packages-${category.key}" class="wizard-packages">
          <div class="wizard-package-grid">
            <div class="wizard-skeleton-card"></div>
            <div class="wizard-skeleton-card"></div>
            <div class="wizard-skeleton-card"></div>
            <div class="wizard-skeleton-card"></div>
          </div>
        </div>

        <div class="wizard-actions">
          <button class="cta secondary wizard-back" type="button">Back</button>
          <button class="cta wizard-next" type="button">Continue</button>
          <button class="wizard-skip" type="button">Skip for now</button>
        </div>
      </div>
    `;
  }

  /**
   * Render review & create plan step
   */
  function renderReviewStep() {
    const state = window.WizardState.getState();
    const selectedPackages = Object.keys(state.selectedPackages || {});

    // Build per-category edit links for selected packages
    const categoryEditLinks = selectedPackages
      .map(catKey => {
        const cat = CATEGORIES.find(c => c.key === catKey);
        const catName = cat ? cat.name : catKey;
        const stepIdx = STEP_CONFIG.CATEGORY_START + CATEGORIES.findIndex(c => c.key === catKey);
        return `<a href="#" class="wizard-review-edit" data-step="${stepIdx}">✏️ Edit ${escapeHtml(catName)}</a>`;
      })
      .join('');

    return `
      <div class="wizard-card">
        <h2>Review Your Event Plan</h2>
        <p class="small">Here's what you've chosen. Ready to create your plan?</p>
        
        <div class="wizard-review">
          <div class="wizard-review-section">
            <h3>📋 Event Details</h3>
            <p><strong>Type:</strong> ${escapeHtml(state.eventType || 'Not specified')}</p>
            ${state.eventName ? `<p><strong>Name:</strong> ${escapeHtml(state.eventName)}</p>` : ''}
            ${state.location ? `<p><strong>Location:</strong> ${escapeHtml(state.location)}</p>` : ''}
            ${state.date ? `<p><strong>Date:</strong> ${formatDate(state.date)}</p>` : ''}
            ${state.guests ? `<p><strong>Guests:</strong> ${state.guests}</p>` : ''}
            ${state.budget ? `<p><strong>Budget:</strong> ${escapeHtml(state.budget)}</p>` : ''}
            <a href="#" class="wizard-review-edit" data-step="${STEP_CONFIG.EVENT_TYPE}">✏️ Edit event type</a>
            <a href="#" class="wizard-review-edit" data-step="${STEP_CONFIG.EVENT_BASICS}">✏️ Edit details</a>
          </div>

          <div class="wizard-review-section">
            <h3>🎯 Selected Services</h3>
            ${
              selectedPackages.length > 0
                ? `<p>You've selected <strong>${selectedPackages.length} package(s)</strong> for your event.</p>
                   <p class="small">These will be added to your event plan for easy reference.</p>
                   ${categoryEditLinks}`
                : '<p class="small">No packages selected yet. You can browse suppliers after creating your plan.</p>'
            }
          </div>
        </div>

        <div class="wizard-actions">
          <button class="cta secondary wizard-back" type="button">Back</button>
          <button class="cta wizard-create-plan" type="button">Create My Plan 🎉</button>
        </div>
      </div>
    `;
  }

  /**
   * Render success screen
   */
  function renderSuccessScreen() {
    const state = window.WizardState.getState();

    return `
      <div class="wizard-card wizard-success">
        <span class="wizard-success-icon">🎉</span>
        <h2>Congratulations!</h2>
        <p class="wizard-success-message">Your event plan has been created successfully. You're all set to start organizing your ${escapeHtml(state.eventType || 'event')}!</p>
        
        <div class="wizard-success-summary">
          <h3>What's Next?</h3>
          <p>Browse suppliers, invite guests, or download your plan summary to get started.</p>
        </div>

        <div class="wizard-success-actions">
          <button class="cta" type="button" id="success-browse-suppliers">Browse Suppliers</button>
          <button class="cta secondary" type="button" id="success-view-plan">View Your Plan</button>
          <button class="cta secondary" type="button" id="success-go-dashboard">Go to Dashboard</button>
        </div>
      </div>
    `;
  }

  /**
   * Format date for display
   */
  function formatDate(dateString) {
    if (!dateString) {
      return '';
    }
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  /**
   * Render plan summary sidebar/drawer
   */
  function renderPlanSummary() {
    const container = document.getElementById('plan-summary');
    if (!container) {
      return;
    }

    const state = window.WizardState.getState();
    const selectedCount = Object.keys(state.selectedPackages || {}).length;

    let html = `
      <h3>Your Plan</h3>
      <div class="plan-summary-item">
        <span class="small">Event Type:</span>
        <span>${escapeHtml(state.eventType || 'Not selected')}</span>
      </div>
    `;

    if (state.eventName) {
      html += `
        <div class="plan-summary-item">
          <span class="small">Name:</span>
          <span>${escapeHtml(state.eventName)}</span>
        </div>
      `;
    }

    if (state.date) {
      html += `
        <div class="plan-summary-item">
          <span class="small">Date:</span>
          <span>${formatDate(state.date)}</span>
        </div>
      `;
    }

    if (state.location) {
      html += `
        <div class="plan-summary-item">
          <span class="small">Location:</span>
          <span>${escapeHtml(state.location)}</span>
        </div>
      `;
    }

    if (state.guests) {
      html += `
        <div class="plan-summary-item">
          <span class="small">Guests:</span>
          <span>${state.guests}</span>
        </div>
      `;
    }

    if (state.budget) {
      html += `
        <div class="plan-summary-item">
          <span class="small">Budget:</span>
          <span>${escapeHtml(state.budget)}</span>
        </div>
      `;
    }

    html += `
      <div class="plan-summary-item">
        <span class="small">Packages:</span>
        <span>${selectedCount} selected</span>
      </div>
    `;

    container.innerHTML = html;

    // Also update the mobile summary strip
    renderMobileSummary();
  }

  /**
   * Render (or update) the collapsible mobile plan summary strip.
   * Only visible on small screens via CSS.
   */
  function renderMobileSummary() {
    const mobileSummary = document.getElementById('mobile-plan-summary');
    if (!mobileSummary) {
      return;
    }

    const state = window.WizardState.getState();
    const selectedCount = Object.keys(state.selectedPackages || {}).length;

    // Build compact one-liner
    const parts = [];
    if (state.eventType) {
      parts.push(escapeHtml(state.eventType));
    }
    if (state.location) {
      parts.push(escapeHtml(state.location));
    }
    if (selectedCount) {
      parts.push(`${selectedCount} package${selectedCount !== 1 ? 's' : ''}`);
    }
    const compactText = parts.length ? parts.join(' · ') : 'Your Plan';

    // Build detailed rows
    let detailsHtml = '';
    if (state.eventType) {
      detailsHtml += `<div class="plan-summary-item"><span class="small">Event Type:</span><span>${escapeHtml(state.eventType)}</span></div>`;
    }
    if (state.eventName) {
      detailsHtml += `<div class="plan-summary-item"><span class="small">Name:</span><span>${escapeHtml(state.eventName)}</span></div>`;
    }
    if (state.date) {
      detailsHtml += `<div class="plan-summary-item"><span class="small">Date:</span><span>${formatDate(state.date)}</span></div>`;
    }
    if (state.location) {
      detailsHtml += `<div class="plan-summary-item"><span class="small">Location:</span><span>${escapeHtml(state.location)}</span></div>`;
    }
    if (state.guests) {
      detailsHtml += `<div class="plan-summary-item"><span class="small">Guests:</span><span>${state.guests}</span></div>`;
    }
    if (state.budget) {
      detailsHtml += `<div class="plan-summary-item"><span class="small">Budget:</span><span>${escapeHtml(state.budget)}</span></div>`;
    }
    detailsHtml += `<div class="plan-summary-item"><span class="small">Packages:</span><span>${selectedCount} selected</span></div>`;

    // Keep expanded state across re-renders using module-level flag
    const wasExpanded = _mobileSummaryExpanded;

    mobileSummary.innerHTML = `
      <button class="wizard-mobile-summary-bar" type="button"
              aria-expanded="${wasExpanded ? 'true' : 'false'}"
              aria-controls="mobile-summary-details">
        <span class="wizard-mobile-summary-compact">${compactText}</span>
        <span class="wizard-mobile-summary-chevron" aria-hidden="true">▾</span>
      </button>
      <div class="wizard-mobile-summary-details" id="mobile-summary-details"
           ${wasExpanded ? '' : 'hidden'}>
        ${detailsHtml}
      </div>
    `;

    // Attach toggle handler
    const toggleBtn = mobileSummary.querySelector('.wizard-mobile-summary-bar');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        _mobileSummaryExpanded = !_mobileSummaryExpanded;
        toggleBtn.setAttribute('aria-expanded', String(_mobileSummaryExpanded));
        const details = document.getElementById('mobile-summary-details');
        if (details) {
          if (_mobileSummaryExpanded) {
            details.removeAttribute('hidden');
          } else {
            details.setAttribute('hidden', '');
          }
        }
      });
    }
  }

  /**
   * Attach event listeners for current step
   * @param {number} stepIndex - Current step
   */
  function attachStepListeners(stepIndex) {
    // Welcome screen
    if (stepIndex === STEP_CONFIG.WELCOME) {
      const getStartedBtn = document.querySelector('.wizard-get-started');
      if (getStartedBtn) {
        getStartedBtn.addEventListener('click', () => {
          hasShownWelcome = true;
          currentStep = STEP_CONFIG.EVENT_TYPE;
          window.WizardState.saveStep(STEP_CONFIG.EVENT_TYPE, {
            wizardStartedAt: new Date().toISOString(),
          });
          renderStep(currentStep);
          renderPlanSummary();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }
      return;
    }

    // Event type selection
    if (stepIndex === STEP_CONFIG.EVENT_TYPE) {
      // Load event type images from Pexels
      loadEventTypeImages();

      const options = document.querySelectorAll('.wizard-option');
      const nextBtn = document.querySelector('.wizard-next');

      options.forEach(opt => {
        opt.addEventListener('click', function () {
          options.forEach(o => {
            o.classList.remove('selected');
            o.setAttribute('aria-pressed', 'false');
          });
          this.classList.add('selected');
          this.setAttribute('aria-pressed', 'true');
          const value = this.getAttribute('data-value');
          window.WizardState.saveStep(STEP_CONFIG.EVENT_TYPE, { eventType: value });
          if (nextBtn) {
            nextBtn.disabled = false;
          }
          renderPlanSummary();
        });
      });
    }

    // Event basics - setup validation
    if (stepIndex === STEP_CONFIG.EVENT_BASICS) {
      if (window.WizardValidation) {
        const eventNameField = document.getElementById('wizard-event-name');
        const locationField = document.getElementById('wizard-location');
        const dateField = document.getElementById('wizard-date');
        const guestsField = document.getElementById('wizard-guests');

        if (eventNameField) {
          window.WizardValidation.setupFieldValidation(eventNameField, 'eventName');
        }
        if (locationField) {
          window.WizardValidation.setupFieldValidation(locationField, 'location');
        }
        if (dateField) {
          window.WizardValidation.setupFieldValidation(dateField, 'date');
        }
        if (guestsField) {
          window.WizardValidation.setupFieldValidation(guestsField, 'guests');
        }
      }
    }

    // Category step - load packages
    if (stepIndex >= STEP_CONFIG.CATEGORY_START && stepIndex < STEP_CONFIG.REVIEW) {
      const categoryIndex = stepIndex - STEP_CONFIG.CATEGORY_START;
      const category = CATEGORIES[categoryIndex];
      const state = window.WizardState.getState();
      loadPackagesForCategory(category.key, state.eventType).then(packages => {
        if (packages === null) {
          // Error state — show retry button (Bug 1.9)
          const pkgContainer = document.getElementById(`wizard-packages-${category.key}`);
          if (pkgContainer) {
            pkgContainer.innerHTML = `
              <div class="wizard-packages-error">
                <p>😔 We couldn't load packages right now.</p>
                <button class="cta secondary" type="button" id="retry-packages-${category.key}">Try Again</button>
              </div>
            `;
            document
              .getElementById(`retry-packages-${category.key}`)
              ?.addEventListener('click', () => {
                const retryContainer = document.getElementById(`wizard-packages-${category.key}`);
                if (retryContainer) {
                  retryContainer.innerHTML = `
                    <div class="wizard-package-grid">
                      <div class="wizard-skeleton-card"></div>
                      <div class="wizard-skeleton-card"></div>
                      <div class="wizard-skeleton-card"></div>
                      <div class="wizard-skeleton-card"></div>
                    </div>
                  `;
                }
                loadPackagesForCategory(category.key, state.eventType).then(retryPackages => {
                  if (retryPackages === null) {
                    if (retryContainer) {
                      retryContainer.innerHTML =
                        '<p class="small">Still unable to load packages. You can skip and continue.</p>';
                    }
                  } else {
                    renderPackageList(category.key, retryPackages);
                  }
                });
              });
          }
        } else {
          renderPackageList(category.key, packages);
        }
      });
    }

    // Review step - edit links
    if (stepIndex === STEP_CONFIG.REVIEW) {
      const editLinks = document.querySelectorAll('.wizard-review-edit');
      editLinks.forEach(link => {
        link.addEventListener('click', e => {
          e.preventDefault();
          const targetStep = parseInt(link.getAttribute('data-step'), 10);
          if (!isNaN(targetStep)) {
            currentStep = targetStep;
            renderStep(currentStep);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        });
      });
    }

    // Success screen — attach navigation listeners
    if (stepIndex === STEP_CONFIG.SUCCESS) {
      // Trigger confetti or celebration animation
      triggerCelebration();

      const browseSuppliersBtn = document.getElementById('success-browse-suppliers');
      if (browseSuppliersBtn) {
        browseSuppliersBtn.addEventListener('click', () => {
          location.href = '/suppliers';
        });
      }

      const viewPlanBtn = document.getElementById('success-view-plan');
      if (viewPlanBtn) {
        const planLink = savedPlanId
          ? `/dashboard/customer/plans/${savedPlanId}`
          : '/dashboard/customer';
        viewPlanBtn.addEventListener('click', () => {
          location.href = planLink;
        });
      }

      const goDashboardBtn = document.getElementById('success-go-dashboard');
      if (goDashboardBtn) {
        goDashboardBtn.addEventListener('click', () => {
          location.href = '/dashboard/customer';
        });
      }
    }

    // Next button
    const nextBtn = document.querySelector('.wizard-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', handleNext);
    }

    // Back button
    const backBtn = document.querySelector('.wizard-back');
    if (backBtn) {
      backBtn.addEventListener('click', handleBack);
    }

    // Skip button — advances without enforcing field validation
    const skipBtn = document.querySelector('.wizard-skip');
    if (skipBtn) {
      skipBtn.addEventListener('click', handleSkip);
    }

    // Create plan button
    const createBtn = document.querySelector('.wizard-create-plan');
    if (createBtn) {
      createBtn.addEventListener('click', handleCreatePlan);
    }
  }

  /**
   * Trigger celebration animation
   */
  function triggerCelebration() {
    const colors = ['#0B8073', '#13B6A2', '#10b981', '#34d399'];

    // Use a dedicated container inside the wizard rather than document.body
    let confettiContainer = document.getElementById('wizard-confetti-container');
    if (!confettiContainer) {
      confettiContainer = document.createElement('div');
      confettiContainer.id = 'wizard-confetti-container';
      confettiContainer.className = 'wizard-confetti-container';
      confettiContainer.setAttribute('aria-hidden', 'true');
      (document.getElementById('wizard-container') || document.body).appendChild(confettiContainer);
    }

    for (let i = 0; i < 30; i++) {
      setTimeout(() => {
        const confetti = document.createElement('div');
        confetti.className = 'wizard-confetti';
        confetti.style.left = `${Math.random() * 100}%`;
        confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animationDelay = `${Math.random() * 0.3}s`;
        confetti.style.animationDuration = `${Math.random() * 2 + 2}s`;
        confettiContainer.appendChild(confetti);

        // animationend is the primary cleanup; safety timeout as fallback
        const cleanupTimer = setTimeout(() => {
          if (confetti.parentNode) {
            confetti.remove();
          }
        }, 5000);
        confetti.addEventListener(
          'animationend',
          () => {
            clearTimeout(cleanupTimer);
            if (confetti.parentNode) {
              confetti.remove();
            }
          },
          { once: true }
        );
      }, i * 50);
    }
  }

  /**
   * Render package list for category
   * @param {string} categoryKey - Category key
   * @param {Array} packages - Packages array
   */
  function renderPackageList(categoryKey, packages) {
    const container = document.getElementById(`wizard-packages-${categoryKey}`);
    if (!container) {
      return;
    }

    if (packages.length === 0) {
      container.innerHTML = '<p class="small">No packages available for this category yet.</p>';
      return;
    }

    const state = window.WizardState.getState();
    const selectedId = state.selectedPackages[categoryKey];

    let html = '<div class="wizard-package-grid" role="listbox" aria-label="Available packages">';
    packages.slice(0, 6).forEach(pkg => {
      const isSelected = String(pkg.id) === selectedId;
      const distanceInfo =
        pkg.distance !== undefined && pkg.distance !== null && typeof pkg.distance === 'number'
          ? `<p class="small wizard-package-distance">📍 ${escapeHtml(pkg.distance.toFixed(1))} miles away</p>`
          : '';

      html += `
        <div class="wizard-package-card ${isSelected ? 'selected' : ''}" 
             data-package-id="${escapeHtml(String(pkg.id))}" data-category="${escapeHtml(categoryKey)}"
             role="option" aria-selected="${isSelected ? 'true' : 'false'}" tabindex="0">
          ${pkg.image ? `<img src="${escapeHtml(pkg.image)}" alt="${escapeHtml(pkg.title)}">` : ''}
          <h4>${escapeHtml(pkg.title)}</h4>
          ${distanceInfo}
          <p class="small">${escapeHtml(pkg.price_display || pkg.price || 'Contact for pricing')}</p>
          ${isSelected ? '<div class="wizard-package-selected">✓ Selected</div>' : ''}
        </div>
      `;
    });
    html += '</div>';

    if (packages.length > 6) {
      html += `<p class="small">Showing 6 of ${packages.length} packages. <a href="/suppliers?category=${categoryKey}">View all</a></p>`;
    }

    container.innerHTML = html;

    // Attach click and keyboard handlers
    const cards = container.querySelectorAll('.wizard-package-card');

    function handleCardActivation(card) {
      const packageId = card.getAttribute('data-package-id');
      const catKey = card.getAttribute('data-category');
      const wasSelected = card.classList.contains('selected');

      // Deselect all in category
      cards.forEach(c => {
        c.classList.remove('selected');
        c.setAttribute('aria-selected', 'false');
      });

      if (!wasSelected) {
        card.classList.add('selected');
        card.setAttribute('aria-selected', 'true');
        window.WizardState.selectPackage(catKey, packageId);
      } else {
        window.WizardState.deselectPackage(catKey);
      }

      renderPlanSummary();
    }

    cards.forEach(card => {
      card.addEventListener('click', function () {
        handleCardActivation(this);
      });

      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardActivation(this);
        }
      });
    });
  }

  /**
   * Handle next button
   */
  function handleNext() {
    // Save current step data
    if (currentStep === STEP_CONFIG.EVENT_BASICS) {
      const eventName = document.getElementById('wizard-event-name')?.value || '';
      const location = document.getElementById('wizard-location')?.value || '';
      const date = document.getElementById('wizard-date')?.value || '';
      const guestsRaw = document.getElementById('wizard-guests')?.value || '';
      const budget = document.getElementById('wizard-budget')?.value || '';

      // Validate with string guests so "0" is treated as a provided value, not falsy
      const stepDataForValidation = {
        eventName,
        location,
        date,
        guests: guestsRaw,
        budget,
      };

      // Enforce validation before advancing (Bug 1.3)
      if (window.WizardValidation) {
        const validationResult = window.WizardValidation.validateStep(
          currentStep,
          stepDataForValidation
        );
        if (!validationResult.valid) {
          // Show errors on fields and shake invalid ones
          Object.keys(validationResult.errors).forEach(fieldName => {
            const field =
              document.getElementById(`wizard-${fieldName}`) ||
              document.getElementById(`wizard-event-${fieldName}`);
            if (field) {
              window.WizardValidation.applyValidationUI(field, {
                valid: false,
                errors: validationResult.errors[fieldName],
              });
              field.classList.add('wizard-shake');
              field.addEventListener('animationend', () => field.classList.remove('wizard-shake'), {
                once: true,
              });
            }
          });
          return; // Block advance
        }
      }

      // Save with proper numeric conversion
      window.WizardState.saveStep(currentStep, {
        eventName,
        location,
        date,
        guests: guestsRaw ? parseInt(guestsRaw, 10) : null,
        budget,
      });
    }

    // For step 0 (event type), enforce selection (Bug 1.3)
    if (currentStep === STEP_CONFIG.EVENT_TYPE) {
      if (window.WizardValidation && !window.WizardValidation.canProceedFromStep(currentStep)) {
        const optionsContainer = document.querySelector('.wizard-options');
        if (optionsContainer) {
          optionsContainer.classList.add('wizard-shake');
          optionsContainer.addEventListener(
            'animationend',
            () => optionsContainer.classList.remove('wizard-shake'),
            { once: true }
          );
        }
        return;
      }
    }

    // Move to next step
    currentStep = Math.min(currentStep + 1, STEP_CONFIG.REVIEW);

    renderStep(currentStep);
    renderPlanSummary();

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Handle skip button — advances without enforcing validation.
   * Per spec: validation only blocks the "Continue" button, not "Skip for now".
   */
  function handleSkip() {
    // Save any partial data already entered (best-effort, no validation)
    if (currentStep === STEP_CONFIG.EVENT_BASICS) {
      const eventName = document.getElementById('wizard-event-name')?.value || '';
      const location = document.getElementById('wizard-location')?.value || '';
      const date = document.getElementById('wizard-date')?.value || '';
      const guests = document.getElementById('wizard-guests')?.value || null;
      const budget = document.getElementById('wizard-budget')?.value || '';

      window.WizardState.saveStep(currentStep, {
        eventName,
        location,
        date,
        guests: guests ? parseInt(guests, 10) : null,
        budget,
      });
    }

    // Advance unconditionally (no validation)
    currentStep = Math.min(currentStep + 1, STEP_CONFIG.REVIEW);
    renderStep(currentStep);
    renderPlanSummary();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Check if wizard has any user-entered data
   */
  function hasFormData() {
    const state = window.WizardState.getState();
    return !!(
      state.eventType ||
      state.eventName ||
      state.location ||
      state.date ||
      state.guests ||
      state.budget ||
      Object.keys(state.selectedPackages || {}).length > 0
    );
  }

  /**
   * Set up beforeunload warning so users don't accidentally lose wizard data.
   * Fires only when there is in-progress data and the wizard hasn't been completed.
   */
  function setupBeforeUnload() {
    _beforeunloadHandler = e => {
      if (!_wizardCompleted && hasFormData()) {
        e.preventDefault();
        e.returnValue = ''; // Required for Chrome
      }
    };
    window.addEventListener('beforeunload', _beforeunloadHandler);
  }

  /**
   * Remove the beforeunload listener (called after successful plan creation).
   */
  function removeBeforeUnload() {
    if (_beforeunloadHandler) {
      window.removeEventListener('beforeunload', _beforeunloadHandler);
      _beforeunloadHandler = null;
    }
  }

  /**
   * Handle back button
   */
  function handleBack() {
    // Special handling for going back from first step
    if (currentStep === STEP_CONFIG.EVENT_TYPE) {
      // Always confirm if there is any user data (Bug 1.5)
      if (hasFormData()) {
        const confirmed = confirm('Leave wizard? Your progress will be saved for later.');
        if (!confirmed) {
          return;
        }
      }
      // Go back to welcome screen or homepage
      if (hasShownWelcome) {
        currentStep = STEP_CONFIG.WELCOME;
        renderStep(currentStep);
      } else {
        // Save current state before navigating away (Bug 1.5)
        window.WizardState.saveState(window.WizardState.getState(), false);
        window.location.href = '/';
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    currentStep = Math.max(currentStep - 1, STEP_CONFIG.EVENT_TYPE);
    renderStep(currentStep);

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Handle create plan button
   */
  async function handleCreatePlan() {
    const createBtn = document.querySelector('.wizard-create-plan');
    if (!createBtn) {
      return;
    }

    // Disable button
    createBtn.disabled = true;
    createBtn.innerHTML = '<span class="wizard-loading"></span> Creating...';

    try {
      // Check authentication using AuthStateManager if available
      let user = null;
      let isLoggedIn = false;

      if (window.AuthStateManager && typeof window.AuthStateManager.getUser === 'function') {
        user = window.AuthStateManager.getUser();
        isLoggedIn = !!user;
      }

      if (!isLoggedIn) {
        const authResponse = await fetch('/api/v1/auth/me', { credentials: 'include' });
        isLoggedIn = authResponse.ok;
        if (isLoggedIn) {
          const authData = await authResponse.json();
          user = authData.user || authData;
        }
      }

      const planData = window.WizardState.exportForPlanCreation();

      if (!isLoggedIn) {
        // Save to localStorage for restoration after auth
        try {
          localStorage.setItem('eventflow_wizard_pending', JSON.stringify(planData));
          localStorage.setItem('eventflow_wizard_timestamp', Date.now().toString());
        } catch (e) {
          console.error('Failed to save to localStorage:', e);
        }

        // Redirect to auth with return URL
        const returnUrl = encodeURIComponent('/start?restore=true');
        location.href = `/auth?returnTo=${returnUrl}`;
        return;
      }

      // User is authenticated - save to backend
      const saveResult = await savePlanToBackend(planData);

      // Handle 401 explicitly (Bug 1.6 — stale auth cache)
      if (saveResult && saveResult.status === 401) {
        const returnUrl = encodeURIComponent('/start?restore=true');
        location.href = `/auth?returnTo=${returnUrl}`;
        return;
      }

      // Store plan ID (if returned) for the "View Your Plan" link on the success screen
      if (saveResult && saveResult.status !== 401) {
        savedPlanId = saveResult.plan?._id || saveResult._id || saveResult.id || null;
      }

      // Mark wizard as completed and disable beforeunload warning
      window.WizardState.markCompleted();
      _wizardCompleted = true;
      removeBeforeUnload();

      // Show success screen
      currentStep = STEP_CONFIG.SUCCESS;
      renderStep(currentStep);
      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Clear wizard state after showing success (delayed)
      setTimeout(() => {
        window.WizardState.clearState();
        try {
          localStorage.removeItem('eventflow_wizard_pending');
          localStorage.removeItem('eventflow_wizard_timestamp');
        } catch (e) {
          console.error('Failed to clear localStorage:', e);
        }
      }, 3000);
    } catch (err) {
      console.error('Error creating plan:', err);

      if (window.showNotification) {
        window.showNotification(err.message || 'Failed to create plan. Please try again.', 'error');
      } else {
        alert('There was an error creating your plan. Please try again.');
      }

      createBtn.disabled = false;
      createBtn.textContent = 'Create My Plan 🎉';
    }
  }

  /**
   * Save plan to backend
   * @param {Object} planData - Plan data to save
   */
  async function savePlanToBackend(planData) {
    const csrfToken = await getCsrfToken();

    const response = await fetch('/api/v1/me/plans', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      credentials: 'include',
      body: JSON.stringify(planData),
    });

    // Return sentinel object for 401 so caller can redirect to auth (Bug 1.6)
    if (response.status === 401) {
      return { status: 401 };
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || 'Failed to save plan');
    }

    return await response.json();
  }

  /**
   * Restore wizard state from localStorage after authentication
   */
  function restoreWizardState() {
    const urlParams = new URLSearchParams(window.location.search);
    const shouldRestore = urlParams.get('restore') === 'true';

    if (!shouldRestore) {
      return;
    }

    try {
      const pendingData = localStorage.getItem('eventflow_wizard_pending');
      const timestamp = localStorage.getItem('eventflow_wizard_timestamp');

      if (!pendingData || !timestamp) {
        return;
      }

      const age = Date.now() - parseInt(timestamp, 10);

      if (age > WIZARD_DATA_EXPIRY_MS) {
        localStorage.removeItem('eventflow_wizard_pending');
        localStorage.removeItem('eventflow_wizard_timestamp');
        return;
      }

      const planData = JSON.parse(pendingData);

      // Retry mechanism for AuthStateManager race condition (Bug 1.8)
      const attemptRestore = retriesLeft => {
        const user =
          window.AuthStateManager &&
          typeof window.AuthStateManager.getUser === 'function' &&
          window.AuthStateManager.getUser();

        if (user) {
          savePlanToBackend(planData)
            .then(result => {
              if (result && result.status === 401 && retriesLeft > 0) {
                // Auth still not ready, retry once more
                setTimeout(() => attemptRestore(retriesLeft - 1), 500);
                return;
              }
              localStorage.removeItem('eventflow_wizard_pending');
              localStorage.removeItem('eventflow_wizard_timestamp');

              if (window.showNotification) {
                window.showNotification('Your event plan has been saved!', 'success');
              }

              setTimeout(() => {
                location.href = '/dashboard/customer';
              }, 1500);
            })
            .catch(err => {
              console.error('Failed to save restored plan:', err);
              // Clean up pending plan so it isn't retried indefinitely
              localStorage.removeItem('eventflow_wizard_pending');
              localStorage.removeItem('eventflow_wizard_timestamp');
              if (window.showNotification) {
                window.showNotification(
                  err.message || 'Your plan could not be saved. Please try again from the wizard.',
                  'error'
                );
              }
            });
        } else if (retriesLeft > 0) {
          // AuthStateManager not yet ready — retry after short delay
          setTimeout(() => attemptRestore(retriesLeft - 1), 500);
        }
      };

      attemptRestore(3);
    } catch (e) {
      console.error('Failed to restore wizard state:', e);
      localStorage.removeItem('eventflow_wizard_pending');
      localStorage.removeItem('eventflow_wizard_timestamp');
    }
  }

  /**
   * Get CSRF token from meta tag, cookie, or API
   */
  async function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) {
      return meta.getAttribute('content');
    }
    // Try cookie
    const match = document.cookie.match(/csrfToken=([^;]+)/);
    if (match) {
      return match[1];
    }

    // Fetch from API as last resort
    try {
      const response = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        return data.csrfToken || '';
      }
    } catch (err) {
      console.error('Failed to fetch CSRF token:', err);
    }

    return '';
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
