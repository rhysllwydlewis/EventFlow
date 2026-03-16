// Legacy messaging.js has been removed – this demo page is superseded by Messenger v4.
// Navigate to /messenger/ for the current messaging experience.
console.info(
  '[EventFlow] messaging-demo.html: legacy messaging.js removed. Use /messenger/ instead.'
);

// Stub functions so demo buttons do not throw
window.testConnection = function () {
  const status = document.getElementById('connectionStatus');
  if (status) {
    status.className = 'demo-status info';
    status.textContent = 'Legacy demo superseded – visit /messenger/ for Messenger v4.';
  }
};
window.simulateDisconnect = window.testConnection;
window.testTyping = window.testConnection;
window.stopTyping = window.testConnection;
window.sendDemoMessage = window.testConnection;

// Bind button event listeners
document.addEventListener('DOMContentLoaded', () => {
  const btnMap = {
    'Test Connection': window.testConnection,
    'Simulate Disconnect': window.simulateDisconnect,
    'Simulate Typing': window.testTyping,
    'Stop Typing': window.stopTyping,
    'Send Message': window.sendDemoMessage,
  };

  document.querySelectorAll('.demo-button').forEach(btn => {
    const label = btn.textContent.trim();
    if (btnMap[label]) {
      btn.addEventListener('click', btnMap[label]);
    }
  });
});
