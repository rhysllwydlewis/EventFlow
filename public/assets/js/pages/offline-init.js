// Check connection status
function updateStatus() {
  const statusEl = document.getElementById('status');
  if (navigator.onLine) {
    statusEl.className = 'status online';
    statusEl.innerHTML =
      '<strong>Connection Status:</strong> Back online! Click "Try Again" to reload.';
  } else {
    statusEl.className = 'status offline';
    statusEl.innerHTML = '<strong>Connection Status:</strong> Currently offline';
  }
}

// Update status on load
updateStatus();

// Listen for online/offline events
window.addEventListener('online', () => {
  updateStatus();
  // Optionally auto-reload when back online
  setTimeout(() => {
    location.reload();
  }, 2000);
});

window.addEventListener('offline', updateStatus);

// Periodic connection check
setInterval(() => {
  fetch('/api/health', { method: 'HEAD', cache: 'no-store' })
    .then(() => {
      if (!navigator.onLine) {
        // Force online status update
        navigator.onLine = true;
        updateStatus();
      }
    })
    .catch(() => {
      // Still offline
    });
}, 5000);

// Retry button
document.querySelector('[data-action="retry"]').addEventListener('click', () => {
  location.reload();
});
