/**
 * Wizard Form Validation
 * Real-time validation with friendly error messages
 */

(function (window) {
  'use strict';

  /**
   * Validation rules for different field types
   */
  const VALIDATION_RULES = {
    required: {
      test: value => value && value.trim().length > 0,
      message: 'This field is required',
    },
    email: {
      test: value => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      message: 'Please enter a valid email address',
    },
    minLength: min => ({
      test: value => !value || value.length >= min,
      message: `Must be at least ${min} characters`,
    }),
    maxLength: max => ({
      test: value => !value || value.length <= max,
      message: `Must be no more than ${max} characters`,
    }),
    number: {
      test: value => !value || !isNaN(parseFloat(value)),
      message: 'Please enter a valid number',
    },
    positiveNumber: {
      test: value => !value || parseFloat(value) > 0,
      message: 'Must be a positive number',
    },
    integer: {
      test: value => !value || Number.isInteger(parseFloat(value)),
      message: 'Must be a whole number',
    },
    date: {
      test: value => {
        if (!value) {
          return true;
        }
        const date = new Date(value);
        return !isNaN(date.getTime());
      },
      message: 'Please enter a valid date',
    },
    futureDate: {
      test: value => {
        if (!value) {
          return true;
        }
        const date = new Date(value);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return date >= today;
      },
      message: 'Date must be in the future',
    },
    postcode: {
      test: value => {
        if (!value) {
          return true;
        }
        // UK postcode regex (simplified)
        return /^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$/i.test(value.trim());
      },
      message: 'Please enter a valid UK postcode (e.g., SW1A 1AA)',
    },
  };

  /**
   * Field configurations with validation rules
   */
  const FIELD_CONFIGS = {
    eventType: {
      rules: ['required'],
      friendlyName: 'Event type',
    },
    eventName: {
      rules: ['minLength:3', 'maxLength:100'],
      friendlyName: 'Event name',
    },
    location: {
      rules: ['maxLength:200'],
      friendlyName: 'Location',
    },
    date: {
      rules: ['date', 'futureDate'],
      friendlyName: 'Event date',
    },
    guests: {
      rules: ['number', 'positiveNumber', 'integer'],
      friendlyName: 'Guest count',
    },
    budget: {
      rules: [],
      friendlyName: 'Budget',
    },
    email: {
      rules: ['required', 'email'],
      friendlyName: 'Email address',
    },
  };

  /**
   * Validate a single field value
   * @param {string} fieldName - Field name
   * @param {*} value - Field value
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  function validateField(fieldName, value) {
    const config = FIELD_CONFIGS[fieldName];
    if (!config) {
      return { valid: true, errors: [] };
    }

    const errors = [];

    for (const ruleName of config.rules) {
      let rule;

      // Check if rule has parameters (e.g., "minLength:3")
      if (ruleName.includes(':')) {
        const [name, params] = ruleName.split(':');
        rule = VALIDATION_RULES[name](params);
      } else {
        rule = VALIDATION_RULES[ruleName];
      }

      if (rule && !rule.test(value)) {
        errors.push(rule.message);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Apply validation UI to a form field
   * @param {HTMLElement} field - Input/select/textarea element
   * @param {Object} result - Validation result
   */
  function applyValidationUI(field, result) {
    if (!field) {
      return;
    }

    const formRow = field.closest('.form-row');
    if (!formRow) {
      return;
    }

    // Remove existing validation states and messages
    formRow.classList.remove('valid', 'error');
    const existingError = formRow.querySelector('.error-message');
    const existingSuccess = formRow.querySelector('.success-message');
    if (existingError) {
      existingError.remove();
    }
    if (existingSuccess) {
      existingSuccess.remove();
    }

    if (!field.value || field.value.trim() === '') {
      // Empty field - no validation UI
      return;
    }

    if (result.valid) {
      // Valid field
      formRow.classList.add('valid');

      // Add success message if configured
      if (field.dataset.showSuccess) {
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.innerHTML = '✓ Looks good!';
        field.parentNode.appendChild(successDiv);
      }
    } else {
      // Invalid field
      formRow.classList.add('error');

      // Add error message
      const errorDiv = document.createElement('div');
      errorDiv.className = 'error-message';
      errorDiv.innerHTML = `⚠ ${result.errors[0]}`;
      field.parentNode.appendChild(errorDiv);
    }
  }

  /**
   * Validate all fields in a step
   * @param {number} stepIndex - Step index
   * @param {Object} data - Step data
   * @returns {Object} { valid: boolean, errors: Object }
   */
  function validateStep(stepIndex, data) {
    const errors = {};
    let isValid = true;

    switch (stepIndex) {
      case 0: {
        // EVENT_TYPE step
        // Event type
        const typeResult = validateField('eventType', data.eventType);
        if (!typeResult.valid) {
          errors.eventType = typeResult.errors;
          isValid = false;
        }
        break;
      }

      case 1: // EVENT_BASICS step
        // Location is optional, but validate if provided
        if (data.location) {
          const locationResult = validateField('location', data.location);
          if (!locationResult.valid) {
            errors.location = locationResult.errors;
            isValid = false;
          }
        }

        // Date is optional, but validate if provided
        if (data.date) {
          const dateResult = validateField('date', data.date);
          if (!dateResult.valid) {
            errors.date = dateResult.errors;
            isValid = false;
          }
        }

        // Guests is optional, but validate if provided
        if (data.guests !== null && data.guests !== undefined && data.guests !== '') {
          const guestsResult = validateField('guests', String(data.guests));
          if (!guestsResult.valid) {
            errors.guests = guestsResult.errors;
            isValid = false;
          }
        }
        break;

      default:
        // Other steps have no required validation
        break;
    }

    return {
      valid: isValid,
      errors,
    };
  }

  /**
   * Set up real-time validation for a field
   * @param {HTMLElement} field - Input element
   * @param {string} fieldName - Field name for validation
   */
  function setupFieldValidation(field, fieldName) {
    if (!field) {
      return;
    }

    let validationTimeout;

    // Validate on input (debounced)
    field.addEventListener('input', () => {
      clearTimeout(validationTimeout);
      validationTimeout = setTimeout(() => {
        const result = validateField(fieldName, field.value);
        applyValidationUI(field, result);
      }, 300);
    });

    // Validate on blur
    field.addEventListener('blur', () => {
      clearTimeout(validationTimeout);
      const result = validateField(fieldName, field.value);
      applyValidationUI(field, result);
    });

    // Clear validation on focus
    field.addEventListener('focus', () => {
      // Validation state is preserved on focus to avoid confusing disappearing errors
    });
  }

  /**
   * Check if a step can proceed (all required fields valid)
   * @param {number} stepIndex - Step index
   * @returns {boolean} Can proceed
   */
  function canProceedFromStep(stepIndex) {
    if (stepIndex === 0) {
      // 0 = EVENT_TYPE step (mirrors STEP_CONFIG.EVENT_TYPE in start-wizard.js)
      // Event type must be selected
      const state = window.WizardState?.getState();
      return !!(state && state.eventType);
    }

    // All other steps are optional/skippable
    return true;
  }

  // Expose public API
  window.WizardValidation = {
    validateField,
    validateStep,
    applyValidationUI,
    setupFieldValidation,
    canProceedFromStep,
  };
})(window);
