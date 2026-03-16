// Wait for dependencies to load before initializing (max 3 s / 60 × 50 ms)
const FORM_INIT_MAX_RETRIES = 60;
let formInitRetries = 0;
function initFormValidation() {
  // Check if dependencies are loaded
  if (typeof FormValidator === 'undefined' || typeof ErrorBoundary === 'undefined') {
    formInitRetries++;
    if (formInitRetries < FORM_INIT_MAX_RETRIES) {
      // Retry after a short delay
      setTimeout(initFormValidation, 50);
    }
    return;
  }

  // Initialize error boundary
  window.errorBoundary = new ErrorBoundary({
    onError: function (errorInfo) {
      console.error('Error caught:', errorInfo);
    },
  });

  // Initialize form validation for login form
  const loginForm = document.querySelector('#login-form');
  if (loginForm) {
    const loginValidator = new FormValidator(loginForm, {
      validateOnBlur: true,
      validateOnInput: false,
    });

    // Store reference to validator for other scripts
    loginForm._validator = loginValidator;

    // Override the handleSubmit to also show #login-error
    const originalHandleSubmit = loginValidator.handleSubmit.bind(loginValidator);
    loginValidator.handleSubmit = function (e) {
      const result = originalHandleSubmit(e);
      const loginErrorEl = document.getElementById('login-error');

      // Show #login-error if validation failed
      if (!result && loginErrorEl) {
        const errors = loginValidator.getErrors();
        if (errors.length > 0) {
          const errorMessages = errors.map(([field, msg]) => msg).join(', ');
          loginErrorEl.textContent = errorMessages || 'Please fix the errors above';
          loginErrorEl.style.display = 'block';
        }
      } else if (result && loginErrorEl) {
        // Clear errors when validation passes
        loginErrorEl.textContent = '';
        loginErrorEl.style.display = 'none';
      }
      // Don't clear the error here - let app.js manage #login-error for API responses
      return result;
    };

    // Listen for valid submissions
    loginForm.addEventListener('validsubmit', e => {
      // The existing auth-init.js will handle the actual submission
    });
  }

  // Initialize form validation for registration form
  const registerForm = document.querySelector('#register-form');
  if (registerForm) {
    const registerValidator = new FormValidator(registerForm, {
      validateOnBlur: true,
      validateOnInput: false,
    });

    // Add custom password strength validation
    registerValidator.addValidator('reg-password', {
      required: true,
      password: true,
      minLength: 8,
    });

    // Listen for valid submissions
    registerForm.addEventListener('validsubmit', e => {
      // The existing auth-init.js will handle the actual submission
    });
  }
}

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFormValidation);
} else {
  initFormValidation();
}
