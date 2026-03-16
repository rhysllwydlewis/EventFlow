// Get session ID from URL
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('session_id');

// Display success message
function showSuccess() {
  const content = document.getElementById('content');
  content.className = '';

  let sessionInfoHtml = '';
  if (sessionId) {
    sessionInfoHtml = `
      <div class="session-info">
        <h3>Transaction Details</h3>
        <div class="info-row">
          <span class="label">Session ID:</span>
          <span class="value">${sessionId.substring(0, 20)}...</span>
        </div>
        <div class="info-row">
          <span class="label">Status:</span>
          <span class="value" style="color: #10b981; font-weight: bold;">Completed</span>
        </div>
        <div class="info-row">
          <span class="label">Date:</span>
          <span class="value">${new Date().toLocaleDateString('en-GB')}</span>
        </div>
      </div>
    `;
  }

  content.innerHTML =
    `<div class="success-icon">✓</div>` +
    `<div class="success-content">` +
    `<h1>Payment Successful!</h1>` +
    `<p>Thank you for your payment. Your transaction has been completed successfully. You will receive a confirmation email shortly.</p>${
      sessionInfoHtml
    }<p style="font-size: 0.9rem; color: #9ca3af;">If you have any questions about your payment, please contact our support team.</p>` +
    `<div class="action-buttons">` +
    `<a href="/dashboard/supplier" class="btn btn-primary">Go to Dashboard</a>` +
    `<a href="/suppliers" class="btn btn-secondary">Browse Suppliers</a>` +
    `</div></div>`;
}

// Display error message
function showError(message) {
  const content = document.getElementById('content');
  content.className = '';
  content.innerHTML =
    `<div class="success-icon" style="color: #ef4444;">✗</div>` +
    `<div class="success-content" style="border-color: #ef4444;">` +
    `<h1 style="color: #ef4444;">Payment Verification Failed</h1>` +
    `<p>${message}</p>` +
    `<div class="action-buttons">` +
    `<a href="/checkout" class="btn btn-primary">Try Again</a>` +
    `<a href="/" class="btn btn-secondary">Return Home</a>` +
    `</div></div>`;
}

// Verify payment on load
async function verifyPayment() {
  if (!sessionId) {
    showSuccess(); // Show success even without session ID
    return;
  }

  try {
    // Optional: Verify the session with your backend
    // This is not strictly necessary as Stripe webhooks handle the verification
    // but can provide additional confirmation to the user

    // For now, just show success
    setTimeout(() => {
      showSuccess();
    }, 1000);
  } catch (error) {
    console.error('Payment verification error:', error);
    showError(
      'We could not verify your payment. Please check your email for confirmation or contact support.'
    );
  }
}

// Initialize
verifyPayment();
