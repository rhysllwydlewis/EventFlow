/**
 * Email Verification Page Handler
 * Handles token verification, status display, and user redirection
 * Enhanced with JWT token support and comprehensive error handling
 */

(function () {
  'use strict';

  // Debug logging is only enabled in local development environments
  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  // Helper function to get headers with CSRF token
  function getHeadersWithCsrf(additionalHeaders = {}) {
    const headers = { ...additionalHeaders };
    const csrfToken = window.__CSRF_TOKEN__;
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
    return headers;
  }

  // Helper function to show toast notification
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'ef-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 1rem 1.5rem;
      background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
      color: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      opacity: 0;
      transform: translateX(400px);
      transition: all 0.3s ease;
      max-width: 90%;
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    }, 10);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(400px)';
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  // Helper function to create resend verification form
  function createResendForm(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      return null;
    }

    const formHtml = `
      <div style="margin-top: 24px; padding: 20px; background: #f9fafb; border-radius: 12px; border: 1px solid #e7eaf0;">
        <p class="small" style="margin: 0 0 12px 0; font-weight: 600;">Need a new verification email?</p>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <input 
            type="email" 
            id="resend-email" 
            placeholder="Enter your email address" 
            style="flex: 1; min-width: 200px; padding: 10px 14px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 15px;"
            required
            autocomplete="email"
          >
          <button 
            type="button" 
            id="resend-verify-btn" 
            class="cta"
            style="white-space: nowrap;"
          >
            Send new link
          </button>
        </div>
        <p class="small" style="margin: 12px 0 0 0; color: #6b7280;">
          The new link will be valid for 24 hours and will replace any previous verification links.
        </p>
      </div>
    `;

    container.insertAdjacentHTML('beforeend', formHtml);

    const resendBtn = document.getElementById('resend-verify-btn');
    const emailInput = document.getElementById('resend-email');

    if (resendBtn && emailInput) {
      resendBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        if (!email) {
          showToast('Please enter your email address', 'error');
          emailInput.focus();
          return;
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          showToast('Please enter a valid email address', 'error');
          emailInput.focus();
          return;
        }

        resendBtn.disabled = true;
        const originalText = resendBtn.textContent;
        resendBtn.textContent = 'Sending...';

        try {
          const response = await fetch('/api/v1/auth/resend-verification', {
            method: 'POST',
            headers: getHeadersWithCsrf({ 'Content-Type': 'application/json' }),
            credentials: 'include',
            body: JSON.stringify({ email }),
          });

          const data = await response.json().catch(() => ({}));

          if (response.ok) {
            showToast(
              data.message || 'Verification email sent! Please check your inbox.',
              'success'
            );
            // Replace form with success message
            container.querySelector('div[style*="margin-top"]').innerHTML = `
              <div style="padding: 20px; background: #f0fdf4; border-radius: 12px; border: 1px solid #bbf7d0;">
                <p class="small" style="margin: 0; color: #166534;">
                  ✓ ${data.message || 'A new verification email has been sent. Please check your inbox and spam folder.'}
                </p>
              </div>
            `;
          } else {
            showToast(
              data.error || 'Failed to send verification email. Please try again.',
              'error'
            );
            resendBtn.disabled = false;
            resendBtn.textContent = originalText;
          }
        } catch (err) {
          console.error('Resend verification error', err);
          showToast('Network error. Please check your connection and try again.', 'error');
          resendBtn.disabled = false;
          resendBtn.textContent = originalText;
        }
      });

      // Allow Enter key to submit
      emailInput.addEventListener('keypress', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          resendBtn.click();
        }
      });
    }

    return { resendBtn, emailInput };
  }

  // Get current user to determine redirect destination
  async function getCurrentUser() {
    try {
      const response = await fetch('/api/v1/auth/me', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        return data.user || null;
      }
    } catch (err) {
      console.error('Failed to get current user', err);
    }
    return null;
  }

  // Main verification handler with retry logic
  async function verifyEmailWithRetry(token, retries = 2) {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (isDevelopment) {
          console.log(`📧 Verification attempt ${attempt + 1}/${retries + 1}`);
        }

        const response = await fetch(`/api/v1/auth/verify?token=${encodeURIComponent(token)}`, {
          credentials: 'include',
          headers: {
            Accept: 'application/json',
          },
        });

        if (isDevelopment) {
          console.log(`📧 Verification response status: ${response.status}`);
        }
        const data = await response.json().catch(() => ({}));

        return { response, data };
      } catch (err) {
        console.warn(`⚠️ Verification attempt ${attempt + 1} failed:`, err.message);
        lastError = err;

        // Don't retry on the last attempt
        if (attempt < retries) {
          // Wait before retrying (exponential backoff)
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 5000);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    throw lastError;
  }

  // Main verification handler
  async function initVerify() {
    const statusEl = document.getElementById('verify-status');
    const iconEl = document.getElementById('verify-icon');
    const headingEl = document.getElementById('verify-heading');
    const actionsEl = document.getElementById('verify-actions');
    const containerEl = document.getElementById('verify-container');

    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    // Handle missing token
    if (!token) {
      console.warn('⚠️ No verification token found in URL');
      if (headingEl) {
        headingEl.textContent = 'No Verification Token';
      }
      if (iconEl) {
        iconEl.textContent = '⚠️';
      }
      if (statusEl) {
        statusEl.innerHTML = `
          <p>No verification token was provided. Please check your email for the verification link, or request a new one below.</p>
          <p class="small" style="margin-top: 12px; color: #6b7280;">
            If you just registered, the verification email should arrive within a few minutes. Don't forget to check your spam folder!
          </p>
        `;
      }
      if (containerEl) {
        createResendForm('verify-container');
      }
      return;
    }

    // Perform verification with retry logic
    try {
      const { response, data } = await verifyEmailWithRetry(token);

      if (!response.ok) {
        // Handle verification failure
        console.error(`❌ Verification failed: ${data.error || 'Unknown error'}`);

        if (headingEl) {
          headingEl.textContent = 'Verification Failed';
        }
        if (iconEl) {
          iconEl.textContent = '❌';
        }

        let errorMessage = '';
        let showResend = true;
        const errorCode = data.code || 'UNKNOWN_ERROR';

        // Provide user-friendly error messages based on error code
        switch (errorCode) {
          case 'TOKEN_EXPIRED':
            errorMessage =
              'This verification link has expired. Verification links are valid for 24 hours for security reasons.';
            break;
          case 'INVALID_SIGNATURE':
            errorMessage =
              'This verification link is invalid or has been tampered with. Please request a new one.';
            showResend = true;
            break;
          case 'TOKEN_REVOKED':
            errorMessage =
              'This verification link has been revoked. This can happen if we updated our security system. Please request a new verification link.';
            showResend = true;
            break;
          case 'INVALID_FORMAT':
          case 'MISSING_TOKEN':
            errorMessage = 'This verification link is malformed. Please request a new one.';
            showResend = true;
            break;
          default:
            if (response.status === 400) {
              if (data.error && data.error.toLowerCase().includes('expired')) {
                errorMessage =
                  'This verification link has expired. Verification links are valid for 24 hours for security reasons.';
              } else if (data.error && data.error.toLowerCase().includes('invalid')) {
                errorMessage =
                  'This verification link is invalid. It may have already been used or the link may be incorrect.';
              } else {
                errorMessage = data.error || 'Unable to verify your email address.';
              }
            } else {
              errorMessage = data.error || 'An unexpected error occurred during verification.';
              showResend = false;
            }
        }

        if (statusEl) {
          statusEl.innerHTML = `
            <p><strong>Error:</strong> ${errorMessage}</p>
            ${data.canResend ? '<p class="small" style="margin-top: 12px; color: #6b7280;">You can request a new verification email below.</p>' : ''}
          `;
        }

        if (showResend && containerEl) {
          createResendForm('verify-container');
        }

        if (actionsEl) {
          actionsEl.innerHTML = `
            <a href="/auth" class="cta secondary">Go to Sign In</a>
          `;
        }
      } else {
        // Handle verification success
        if (headingEl) {
          headingEl.textContent = 'Email Verified!';
        }
        if (iconEl) {
          iconEl.textContent = '✓';
          iconEl.style.color = '#22c55e';
        }

        if (statusEl) {
          statusEl.innerHTML = `
            <p><strong>Success!</strong> Your email address has been verified.</p>
            <p class="small" style="margin-top: 12px; opacity: 0.8;">
              ${data.withinGracePeriod ? '⚠️ Note: Your verification link had expired, but we accepted it within the grace period.' : ''}
            </p>
            <p class="small" style="margin-top: 8px; opacity: 0.8;">Redirecting you to your dashboard in a few seconds...</p>
          `;
        }

        // Get user to determine redirect destination
        const user = data.user || (await getCurrentUser());
        let redirectUrl = '/auth'; // Default fallback

        if (user) {
          if (user.role === 'admin') {
            redirectUrl = '/admin';
          } else if (user.role === 'supplier') {
            redirectUrl = '/dashboard/supplier';
          } else {
            redirectUrl = '/dashboard/customer';
          }
        }

        // Show manual navigation buttons
        if (actionsEl) {
          actionsEl.innerHTML = `
            <a href="${redirectUrl}" class="cta">Go to Dashboard</a>
            <a href="/" class="cta secondary">Go to Home</a>
          `;
        }

        // Auto-redirect after 3 seconds
        setTimeout(() => {
          window.location.href = redirectUrl;
        }, 3000);

        // Optional: Show confetti celebration if available
        if (typeof efConfetti === 'function') {
          setTimeout(efConfetti, 300);
        }
      }
    } catch (err) {
      console.error('❌ Verification error:', err);

      if (headingEl) {
        headingEl.textContent = 'Connection Error';
      }
      if (iconEl) {
        iconEl.textContent = '⚠️';
      }
      if (statusEl) {
        statusEl.innerHTML = `
          <p><strong>Connection Error:</strong> Unable to connect to the server. Please check your internet connection and try again.</p>
          <p class="small" style="margin-top: 12px; color: #6b7280;">
            If the problem persists, please contact support or request a new verification email.
          </p>
        `;
      }
      if (actionsEl) {
        actionsEl.innerHTML = `
          <button onclick="location.reload()" class="cta">Try Again</button>
          <a href="/auth" class="cta secondary">Go to Sign In</a>
        `;
      }

      // Show option to resend after connection error
      if (containerEl) {
        createResendForm('verify-container');
      }
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVerify);
  } else {
    initVerify();
  }
})();
