// Test functions
function testSuccess() {
  EventFlowNotifications.success('✓ Operation completed successfully!');
}

function testError() {
  EventFlowNotifications.error('✗ Something went wrong. Please try again.');
}

function testWarning() {
  EventFlowNotifications.warning('⚠ This action requires your attention.');
}

function testInfo() {
  EventFlowNotifications.info('ℹ Here is some helpful information for you.');
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
  EventFlowNotifications.info(
    'This is a very long notification message to test how the notification system handles text wrapping and maintains good visual appearance even with extended content that spans multiple lines. The glassmorphism effect should remain beautiful regardless of content length.'
  );
}

function testShort() {
  EventFlowNotifications.info('This notification will disappear in 2 seconds', 2000);
}

function testLong() {
  EventFlowNotifications.warning('This notification will stay for 10 seconds', 10000);
}

function testPersistent() {
  EventFlowNotifications.info('This notification will not auto-close. Click × to dismiss.', 0);
}

function clearAll() {
  EventFlowNotifications.clearAll();
}

// Bind button click handlers
document.addEventListener('DOMContentLoaded', () => {
  const buttonMap = {
    'btn-success': testSuccess,
    'btn-error': testError,
    'btn-warning': testWarning,
    'btn-info': testInfo,
  };

  document.querySelectorAll('.test-btn').forEach(btn => {
    for (const [cls, fn] of Object.entries(buttonMap)) {
      if (btn.classList.contains(cls)) {
        // Skip if it already has a more specific function name set by data attribute
      }
    }
  });

  // Bind by button text content
  document.querySelectorAll('.test-btn').forEach(btn => {
    const text = btn.textContent.trim();
    if (text === 'Success') {
      btn.addEventListener('click', testSuccess);
    } else if (text === 'Error') {
      btn.addEventListener('click', testError);
    } else if (text === 'Warning') {
      btn.addEventListener('click', testWarning);
    } else if (text === 'Info') {
      btn.addEventListener('click', testInfo);
    } else if (text === 'Spam Test (10 notifications)') {
      btn.addEventListener('click', testSpam);
    } else if (text === 'Long Message') {
      btn.addEventListener('click', testLongMessage);
    } else if (text === 'Clear All') {
      btn.addEventListener('click', clearAll);
    } else if (text === 'Short Duration (2s)') {
      btn.addEventListener('click', testShort);
    } else if (text === 'Long Duration (10s)') {
      btn.addEventListener('click', testLong);
    } else if (text === 'Persistent') {
      btn.addEventListener('click', testPersistent);
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
      EventFlowNotifications.success(
        'Welcome! All systems operational. Click buttons above to test.'
      );
    }, 500);
  }, 100);
});
