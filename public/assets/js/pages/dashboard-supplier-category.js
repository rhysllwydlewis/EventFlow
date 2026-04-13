// Show/hide venue postcode field based on category selection
(function () {
  const categorySelect = document.getElementById('sup-category');
  const venuePostcodeRow = document.getElementById('venue-postcode-row');
  const venuePostcodeInput = document.getElementById('sup-venue-postcode');
  const venuePostcodeError = document.getElementById('venue-postcode-error');

  if (!categorySelect || !venuePostcodeRow || !venuePostcodeInput) {
    return;
  }

  // UK postcode validation regex (matches backend validation)
  const ukPostcodeRegex = /^[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}$/i;

  function validatePostcode(postcode) {
    if (!postcode || !postcode.trim()) {
      return { valid: false, message: 'Postcode is required for Venues' };
    }
    if (!ukPostcodeRegex.test(postcode.trim())) {
      return {
        valid: false,
        message: 'Please enter a valid UK postcode (e.g., SW1A 1AA)',
      };
    }
    return { valid: true, message: '' };
  }

  function clearVenuePostcodeError() {
    venuePostcodeError.textContent = '';
    venuePostcodeError.classList.remove('visible');
    venuePostcodeError.setAttribute('aria-hidden', 'true');
    venuePostcodeInput.setAttribute('aria-invalid', 'false');
  }

  function showVenuePostcodeError(message) {
    venuePostcodeError.textContent = message;
    venuePostcodeError.classList.add('visible');
    venuePostcodeError.setAttribute('aria-hidden', 'false');
    venuePostcodeInput.setAttribute('aria-invalid', 'true');
  }

  function updateVenuePostcodeVisibility() {
    const selectedCategory = categorySelect.value;
    if (selectedCategory === 'Venues') {
      venuePostcodeRow.classList.remove('form-row-hidden');
      venuePostcodeInput.setAttribute('aria-required', 'true');
    } else {
      venuePostcodeRow.classList.add('form-row-hidden');
      venuePostcodeInput.value = ''; // Clear value when not Venues
      venuePostcodeInput.setAttribute('aria-required', 'false');
      clearVenuePostcodeError();
    }
  }

  // Real-time validation on input
  venuePostcodeInput.addEventListener('input', () => {
    if (categorySelect.value !== 'Venues') {
      clearVenuePostcodeError();
      return;
    }

    const value = venuePostcodeInput.value;
    const result = validatePostcode(value);
    if (!result.valid && value.trim()) {
      showVenuePostcodeError(result.message);
    } else {
      clearVenuePostcodeError();
    }
  });

  // Validate on blur
  venuePostcodeInput.addEventListener('blur', () => {
    if (categorySelect.value !== 'Venues') {
      clearVenuePostcodeError();
      return;
    }
    const result = validatePostcode(venuePostcodeInput.value);
    if (!result.valid) {
      showVenuePostcodeError(result.message);
    } else {
      clearVenuePostcodeError();
    }
  });

  // Update visibility on category change
  categorySelect.addEventListener('change', updateVenuePostcodeVisibility);

  // Initialize visibility on page load
  updateVenuePostcodeVisibility();

  // Make validation function available globally for form submission
  window.validateVenuePostcode = function () {
    if (categorySelect.value !== 'Venues') {
      clearVenuePostcodeError();
      return true;
    }

    const result = validatePostcode(venuePostcodeInput.value);
    if (!result.valid) {
      showVenuePostcodeError(result.message);
      venuePostcodeInput.focus();
      // Scroll to the error field smoothly
      venuePostcodeInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }

    clearVenuePostcodeError();
    return true;
  };
})();
