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

  function updateVenuePostcodeVisibility() {
    const selectedCategory = categorySelect.value;
    if (selectedCategory === 'Venues') {
      venuePostcodeRow.classList.remove('form-row-hidden');
      venuePostcodeInput.setAttribute('aria-required', 'true');
    } else {
      venuePostcodeRow.classList.add('form-row-hidden');
      venuePostcodeInput.value = ''; // Clear value when not Venues
      venuePostcodeInput.setAttribute('aria-required', 'false');
      venuePostcodeError.classList.remove('visible');
    }
  }

  // Real-time validation on input
  venuePostcodeInput.addEventListener('input', function () {
    if (categorySelect.value !== 'Venues') {
      return;
    }
    const result = validatePostcode(this.value);
    if (!result.valid && this.value.trim()) {
      venuePostcodeError.textContent = result.message;
      venuePostcodeError.classList.add('visible');
    } else {
      venuePostcodeError.classList.remove('visible');
    }
  });

  // Validate on blur
  venuePostcodeInput.addEventListener('blur', function () {
    if (categorySelect.value !== 'Venues') {
      return;
    }
    const result = validatePostcode(this.value);
    if (!result.valid) {
      venuePostcodeError.textContent = result.message;
      venuePostcodeError.classList.add('visible');
    }
  });

  // Update visibility on category change
  categorySelect.addEventListener('change', updateVenuePostcodeVisibility);

  // Initialize visibility on page load
  updateVenuePostcodeVisibility();

  // Make validation function available globally for form submission
  window.validateVenuePostcode = function () {
    if (categorySelect.value === 'Venues') {
      const result = validatePostcode(venuePostcodeInput.value);
      if (!result.valid) {
        venuePostcodeError.textContent = result.message;
        venuePostcodeError.classList.add('visible');
        venuePostcodeInput.focus();
        // Scroll to the error field smoothly
        venuePostcodeInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return false;
      }
    }
    return true;
  };
})();
