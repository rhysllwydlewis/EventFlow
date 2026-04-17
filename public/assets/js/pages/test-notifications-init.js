// Test functions
function testSuccess() {
  NotificationDispatcher.success('✓ Operation completed successfully!');
}

function testError() {
  NotificationDispatcher.error('✗ Something went wrong. Please try again.');
}

function testWarning() {
  NotificationDispatcher.warning('⚠ This action requires your attention.');
}

function testInfo() {
  NotificationDispatcher.info('ℹ Here is some helpful information for you.');
}

function testSpam() {
  for (let i = 1; i <= 10; i++) {
    setTimeout(() => {
      const types = ['success', 'error', 'warning', 'info'];
      const messages = ['Task completed', 'Error occurred', 'Warning issued', 'Info provided'];
      const type = types[i % types.length];
      const message = messages[i % messages.length];
      EventFlowNotifications.show(`${message} #${i}`, type);
    }, i * 150);
  }
}

function testLongMessage() {
  NotificationDispatcher.info(
    'This is a very long notification message to test how the notification system handles text wrapping and maintains good visual appearance even with extended content that spans multiple lines. The glassmorphism effect should remain beautiful regardless of content length.'
  );
}

function testShort() {
  NotificationDispatcher.info('This notification will disappear in 2 seconds', 2000);
}

function testLong() {
  NotificationDispatcher.warning('This notification will stay for 10 seconds', 10000);
}

function testPersistent() {
  NotificationDispatcher.info('This notification will not auto-close. Click × to dismiss.', 0);
}

function clearAll() {
  EventFlowNotifications.clearAll();
}

// Map of `data-test-action` values → handler. Adding a new test button is a
// single-line change in the HTML + one entry here.
const TEST_ACTIONS = {
  success: testSuccess,
  error: testError,
  warning: testWarning,
  info: testInfo,
  spam: testSpam,
  'long-message': testLongMessage,
  'clear-all': clearAll,
  short: testShort,
  long: testLong,
  persistent: testPersistent,
};

// Bind button click handlers
document.addEventListener('DOMContentLoaded', () => {
  // Bind by data-test-action attribute — robust against label copy changes
  document.querySelectorAll('[data-test-action]').forEach(btn => {
    const action = btn.getAttribute('data-test-action');
    const handler = TEST_ACTIONS[action];
    if (typeof handler === 'function') {
      btn.addEventListener('click', handler);
    } else if (typeof console !== 'undefined' && console.warn) {
      console.warn(`test-notifications: no handler registered for data-test-action="${action}"`);
    }
  });

  // Check system status
  setTimeout(() => {
    // Check if EventFlowNotifications is loaded
    if (typeof EventFlowNotifications !== 'undefined') {
      document.getElementById('status-system').innerHTML =
        '<span style="color: #10b981;">✓</span> EventFlowNotifications loaded successfully';
    } else {
      document.getElementById('status-system').innerHTML =
        '<span style="color: #ef4444;">✗</span> EventFlowNotifications not loaded';
    }

    // Check if glassmorphism CSS is available
    const testEl = document.createElement('div');
    testEl.className = 'ef-notification';
    testEl.style.display = 'none';
    document.body.appendChild(testEl);
    const styles = window.getComputedStyle(testEl);
    if (styles.backdropFilter && styles.backdropFilter !== 'none') {
      document.getElementById('status-css').innerHTML =
        '<span style="color: #10b981;">✓</span> Glassmorphism CSS loaded (backdrop-filter supported)';
    } else {
      document.getElementById('status-css').innerHTML =
        '<span style="color: #f59e0b;">⚠</span> Glassmorphism CSS loaded (backdrop-filter not supported in this browser)';
    }
    document.body.removeChild(testEl);

    // Check responsive
    const isMobile = window.innerWidth < 640;
    document.getElementById('status-responsive').innerHTML =
      `<span style="color: #10b981;">✓</span> Screen width: ${window.innerWidth}px ${isMobile ? '(Mobile)' : '(Desktop)'}`;

    // Show welcome notification
    setTimeout(() => {
      NotificationDispatcher.success(
        'Welcome! All systems operational. Click buttons above to test.'
      );
    }, 500);
  }, 100);
});
