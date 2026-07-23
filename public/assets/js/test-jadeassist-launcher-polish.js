(function () {
  'use strict';

  window.JADEASSIST_CONFIG = {
    launcherDismissDurationMs: 60 * 60 * 1000,
  };

  window.JadeWidget.init({
    apiBaseUrl: 'http://127.0.0.1:4173',
    assistantName: 'Jade',
    greetingTooltipText: '',
    avatarUrl: '/assets/images/jadeassist-agent.png',
    notificationBadgeUrl: '/assets/images/jadeassist-notification-badge.png',
    closeButtonUrl: '/assets/images/jadeassist-close-button.png',
    launcherDismissible: true,
    launcherDismissStorageKey: 'jadeassist-polish-browser-test-dismissed-at',
    launcherDismissDurationMs: 30 * 24 * 60 * 60 * 1000,
    showDelayMs: 0,
    offsetBottom: '6rem',
    offsetLeft: '6rem',
    offsetBottomMobile: '5rem',
    offsetLeftMobile: '2rem',
    scale: 0.85,
  });
})();
