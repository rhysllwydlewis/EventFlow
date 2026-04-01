/**
 * Form Validation Utility
 * Provides comprehensive client-side validation with real-time feedback
 */

class FormValidator {
  constructor(formElement, options = {}) {
    this.form = formElement;
    this.options = {
      validateOnBlur: true,
      validateOnInput: false,
      showSuccessIndicators: true,
      ...options,
    };
    this.errors = new Map();
    this.validators = new Map();
    this.init();
  }

  init() {
    if (!this.form) {
      return;
    }

    // Add novalidate to prevent browser validation
    this.form.setAttribute('novalidate', '');

    // Setup validation on form submit
    this.form.addEventListener('submit', e => this.handleSubmit(e));

    // Setup real-time validation
    const inputs = this.form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      if (this.options.validateOnBlur) {
        input.addEventListener('blur', () => this.validateField(input));
      }
      if (this.options.validateOnInput) {
        input.addEventListener('input', () => this.validateField(input));
      }
    });
  }

  handleSubmit(e) {
    e.preventDefault();
    this.clearAllErrors();

    const isValid = this.validateAll();

    if (isValid) {
      this.form.dispatchEvent(new CustomEvent('validsubmit', { detail: this.getFormData() }));
    } else {
      // Focus first error field
      const firstError = this.form.querySelector('.form-field-error');
      if (firstError) {
        firstError.focus();
      }
    }

    return isValid;
  }

  validateAll() {
    const inputs = this.form.querySelectorAll('input, select, textarea');
    let isValid = true;

    inputs.forEach(input => {
      if (!this.validateField(input)) {
        isValid = false;
      }
    });

    return isValid;
  }

  validateField(field) {
    if (!field.name) {
      return true;
    }

    const value = field.value.trim();
    const rules = this.getValidationRules(field);
    let errorMessage = '';

    // Required validation
    if (rules.required && !value) {
      errorMessage = rules.requiredMessage || `${this.getFieldLabel(field)} is required`;
    }

    // Email validation
    else if (rules.email && value && !this.isValidEmail(value)) {
      errorMessage = 'Please enter a valid email address';
    }

    // Password strength validation
    else if (rules.password && value) {
      const strength = this.checkPasswordStrength(value);
      if (strength.score < 2) {
        errorMessage = strength.message;
      }
    }

    // Min length validation
    else if (rules.minLength && value && value.length < rules.minLength) {
      errorMessage = `Must be at least ${rules.minLength} characters`;
    }

    // Max length validation
    else if (rules.maxLength && value && value.length > rules.maxLength) {
      errorMessage = `Must be no more than ${rules.maxLength} characters`;
    }

    // Pattern validation
    else if (rules.pattern && value && !rules.pattern.test(value)) {
      errorMessage = rules.patternMessage || 'Invalid format';
    }

    // Custom validator
    else if (rules.custom) {
      const customResult = rules.custom(value, field);
      if (customResult !== true) {
        errorMessage = customResult;
      }
    }

    // Update UI
    if (errorMessage) {
      this.showError(field, errorMessage);
      return false;
    } else {
      this.clearError(field);
      if (this.options.showSuccessIndicators && value) {
        this.showSuccess(field);
      }
      return true;
    }
  }

  getValidationRules(field) {
    // Check for custom validator registered
    if (this.validators.has(field.name)) {
      return this.validators.get(field.name);
    }

    // Build rules from HTML5 attributes
    const rules = {
      required: field.hasAttribute('required') || field.getAttribute('aria-required') === 'true',
      email: field.type === 'email',
      password:
        field.type === 'password' &&
        (field.hasAttribute('data-password-strength') ||
          field.id.includes('password') ||
          field.name.includes('password')),
      minLength: field.minLength > 0 ? field.minLength : null,
      maxLength: field.maxLength > 0 ? field.maxLength : null,
    };

    // Check for pattern
    if (field.pattern) {
      rules.pattern = new RegExp(field.pattern);
      rules.patternMessage = field.title || 'Invalid format';
    }

    return rules;
  }

  addValidator(fieldName, rules) {
    this.validators.set(fieldName, rules);
  }

  isValidEmail(email) {
    // RFC 5322 compliant email regex (simplified)
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  checkPasswordStrength(password) {
    let score = 0;
    const feedback = [];

    if (!password || password.length === 0) {
      return { score: 0, message: 'Password is required' };
    }

    // Length check
    if (password.length < 8) {
      feedback.push('at least 8 characters');
    } else {
      score++;
    }

    // Contains letter
    if (/[a-zA-Z]/.test(password)) {
      score++;
    } else {
      feedback.push('a letter');
    }

    // Contains number
    if (/\d/.test(password)) {
      score++;
    } else {
      feedback.push('a number');
    }

    // Contains special character
    if (/[^a-zA-Z0-9]/.test(password)) {
      score++;
    }

    if (score < 2) {
      return {
        score,
        message: `Password must contain ${feedback.join(', ')}`,
      };
    }

    return { score, message: '' };
  }

  showError(field, message) {
    this.errors.set(field.name, message);
    field.classList.add('form-field-error');
    field.classList.remove('form-field-success');
    field.setAttribute('aria-invalid', 'true');

    // Find the right container for the error message.
    // When an input is wrapped in an .auth-input-wrap (e.g. password fields), appending
    // the error span inside that wrapper makes the wrapper taller and causes any
    // absolutely-positioned sibling (like the password toggle) to shift down.
    // Use the wrapper's parent instead so the error lives outside the input wrap.
    let container = field.parentElement;
    if (container && container.classList.contains('auth-input-wrap')) {
      container = container.parentElement || container;
    }

    // Find or create error message element
    let errorEl = container.querySelector(':scope > .form-error-message');
    if (!errorEl) {
      errorEl = document.createElement('span');
      errorEl.className = 'form-error-message';
      errorEl.setAttribute('role', 'alert');
      container.appendChild(errorEl);
    }
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }

  clearError(field) {
    this.errors.delete(field.name);
    field.classList.remove('form-field-error');
    field.removeAttribute('aria-invalid');

    // Mirror the container-lookup logic from showError so we find the element
    // that was appended to the correct parent (either the direct parent or, for
    // inputs inside .auth-input-wrap, the wrapper's parent).
    let container = field.parentElement;
    if (container && container.classList.contains('auth-input-wrap')) {
      container = container.parentElement || container;
    }

    const errorEl = container ? container.querySelector(':scope > .form-error-message') : null;
    if (errorEl) {
      errorEl.style.display = 'none';
    }
  }

  showSuccess(field) {
    field.classList.add('form-field-success');
    field.classList.remove('form-field-error');
  }

  clearAllErrors() {
    this.errors.clear();
    const errorFields = this.form.querySelectorAll('.form-field-error, .form-field-success');
    errorFields.forEach(field => {
      field.classList.remove('form-field-error', 'form-field-success');
      field.removeAttribute('aria-invalid');
    });

    const errorMessages = this.form.querySelectorAll('.form-error-message');
    errorMessages.forEach(msg => {
      msg.style.display = 'none';
    });
  }

  getFieldLabel(field) {
    const label = this.form.querySelector(`label[for="${field.id}"]`);
    return label ? label.textContent.replace(/\*/g, '').trim() : field.name;
  }

  getFormData() {
    const formData = new FormData(this.form);
    const data = {};
    for (const [key, value] of formData.entries()) {
      data[key] = value;
    }
    return data;
  }

  hasErrors() {
    return this.errors.size > 0;
  }

  getErrors() {
    return Array.from(this.errors.entries());
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FormValidator;
}
