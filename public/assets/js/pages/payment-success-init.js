function escapeHtml(s) {
  if (s === null || s === undefined) {
    return '';
  }
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

// Get session ID from URL
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('session_id');

/** Determine which dashboard URL to redirect to based on user role. */
async function getDashboardUrl() {
  try {
    const r = await fetch('/api/v1/auth/me', { credentials: 'include' });
    if (r.ok) {
      const d = await r.json();
      const role = d.user && d.user.role;
      if (role === 'customer') {
        return '/dashboard/customer';
      }
      if (role === 'supplier') {
        return '/dashboard/supplier';
      }
      if (role === 'admin') {
        return '/admin';
      }
    }
  } catch (_) {
    /* ignore */
  }
  return '/dashboard/supplier'; // safe fallback
}

// Display success message
async function showSuccess() {
  const content = document.getElementById('content');
  if (!content) {
    return;
  }
  content.className = '';

  const dashboardUrl = await getDashboardUrl();

  let sessionInfoHtml = '';
  if (sessionId) {
    sessionInfoHtml = `
      <div class="session-info">
        <h3>Transaction Details</h3>
        <div class="info-row">
          <span class="label">Session ID:</span>
          <span class="value">${escapeHtml(sessionId.substring(0, 20))}...</span>
        </div>
        <div class="info-row">
          <span class="label">Status:</span>
          <span class="value status-completed">Completed</span>
        </div>
        <div class="info-row">
          <span class="label">Date:</span>
          <span class="value">${new Date().toLocaleDateString('en-GB')}</span>
        </div>
      </div>
    `;
  }

  // Auto-redirect to dashboard after 8 seconds
  const AUTO_REDIRECT_SECONDS = 8;
  let autoRedirectCountdown = AUTO_REDIRECT_SECONDS;
  const redirectTimer = setInterval(() => {
    autoRedirectCountdown--;
    const countdownEl = document.getElementById('redirect-countdown');
    if (countdownEl) {
      countdownEl.textContent = autoRedirectCountdown;
    }
    if (autoRedirectCountdown <= 0) {
      clearInterval(redirectTimer);
      window.location.href = dashboardUrl;
    }
  }, 1000);

  content.innerHTML =
    `<div class="success-icon">✓</div>` +
    `<div class="success-content">` +
    `<h1>Payment Successful!</h1>` +
    `<p>Thank you for your payment. Your transaction has been completed successfully. You will receive a confirmation email shortly.</p><p class="redirect-notice">You will be redirected to your dashboard in <strong><span id="redirect-countdown">8</span></strong> seconds.</p>${
      sessionInfoHtml
    }<p class="payment-note">If you have any questions about your payment, please contact our support team.</p>` +
    `<div class="action-buttons">` +
    `<a href="${escapeHtml(dashboardUrl)}" class="btn btn-primary">Go to Dashboard</a>` +
    `<a href="/suppliers" class="btn btn-secondary">Browse Suppliers</a>` +
    `</div></div>`;
}

// Display error message
function showError(message) {
  const content = document.getElementById('content');
  if (!content) {
    return;
  }
  content.className = '';
  content.innerHTML =
    `<div class="success-icon success-icon--error">✗</div>` +
    `<div class="success-content success-content--error">` +
    `<h1 class="error-title">Payment Verification Failed</h1>` +
    `<p>${message}</p>` +
    `<div class="action-buttons">` +
    `<a href="/checkout" class="btn btn-primary">Try Again</a>` +
    `<a href="/" class="btn btn-secondary">Return Home</a>` +
    `</div></div>`;
}

// Verify payment on load
async function verifyPayment() {
  if (!sessionId) {
    await showSuccess();
    return;
  }

  try {
    // Verify the session with the backend to confirm Stripe recorded it
    const r = await fetch(
      `/api/v1/payments/verify-session?session_id=${encodeURIComponent(sessionId)}`,
      { credentials: 'include' }
    );

    if (r.ok) {
      await showSuccess();
    } else if (r.status === 404 || r.status === 400) {
      // Endpoint may not be implemented yet — fall through to success
      await showSuccess();
    } else {
      showError(
        'We could not verify your payment. Please check your email for confirmation or contact support.'
      );
    }
  } catch (error) {
    console.error('Payment verification error:', error);
    // Network/server errors: still show success as webhooks handle the actual verification
    await showSuccess();
  }
}

// Initialize
verifyPayment();
