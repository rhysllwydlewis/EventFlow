'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '../..');
const widgetBundle = fs.readFileSync(
  path.join(ROOT, 'public/assets/js/vendor/jade-widget.js'),
  'utf8'
);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function createWidget() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://event-flow.co.uk/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });

  // Keep production ordering while shortening the widget's deliberate UI delays.
  const nativeSetTimeout = dom.window.setTimeout.bind(dom.window);
  dom.window.setTimeout = (callback, delay = 0, ...args) =>
    nativeSetTimeout(callback, Math.min(Number(delay) || 0, 10), ...args);

  dom.window.eval(widgetBundle);

  const assets = {
    avatarUrl: 'https://event-flow.co.uk/assets/images/jadeassist-agent.png',
    notificationBadgeUrl:
      'https://event-flow.co.uk/assets/images/jadeassist-notification-badge.png',
    closeButtonUrl: 'https://event-flow.co.uk/assets/images/jadeassist-close-button.png',
  };
  const dismissalKey = 'jadeassist-test-dismissed-at';

  dom.window.JadeWidget.init({
    ...assets,
    assistantName: 'Jade',
    greetingTooltipText: '',
    showDelayMs: 0,
    launcherDismissible: true,
    launcherDismissStorageKey: dismissalKey,
    launcherDismissDurationMs: 30 * 24 * 60 * 60 * 1000,
  });

  return { dom, assets, dismissalKey };
}

async function run() {
  {
    const { dom, assets } = createWidget();
    await wait(50);

    const root = dom.window.document.querySelector('.jade-widget-root');
    assert.ok(root, 'The widget root should mount.');
    assert.ok(root.shadowRoot, 'The widget should use an open shadow root.');

    const avatar = root.shadowRoot.querySelector('.jade-avatar-img');
    assert.ok(avatar, 'The Jade avatar should render.');
    assert.equal(avatar.src, assets.avatarUrl);
    assert.equal(avatar.alt, 'Jade chat assistant');

    const notificationBadge = root.shadowRoot.querySelector('.jade-avatar-badge');
    assert.ok(notificationBadge, 'The greeting notification should render.');
    assert.equal(notificationBadge.getAttribute('aria-label'), '1 new notification');

    const notificationAsset = notificationBadge.querySelector('.jade-avatar-badge-asset');
    assert.ok(notificationAsset, 'The approved notification asset should render.');
    assert.equal(notificationAsset.src, assets.notificationBadgeUrl);

    const closeButton = root.shadowRoot.querySelector('.jade-launcher-dismiss');
    assert.ok(closeButton, 'The native launcher close control should render.');
    assert.equal(closeButton.getAttribute('aria-label'), 'Hide Jade chat assistant');

    const closeAsset = closeButton.querySelector('.jade-launcher-dismiss-asset');
    assert.ok(closeAsset, 'The approved close-button asset should render.');
    assert.equal(closeAsset.src, assets.closeButtonUrl);
    dom.window.close();
  }

  {
    const { dom, dismissalKey } = createWidget();
    await wait(50);

    const root = dom.window.document.querySelector('.jade-widget-root');
    const closeButton = root.shadowRoot.querySelector('.jade-launcher-dismiss');
    let dismissalEvent;
    dom.window.addEventListener('jadeassist:widget-dismissed', event => {
      dismissalEvent = event.detail;
    });

    closeButton.click();
    assert.equal(root.hidden, true);
    assert.equal(root.getAttribute('aria-hidden'), 'true');
    assert.equal(dom.window.JadeWidget.isVisible(), false);
    assert.ok(Number(dom.window.localStorage.getItem(dismissalKey)) > 0);
    assert.equal(dismissalEvent.source, 'launcher-close-button');

    dom.window.JadeWidget.show();
    await wait(20);
    assert.equal(root.hidden, false);
    assert.equal(root.hasAttribute('aria-hidden'), false);
    assert.equal(dom.window.JadeWidget.isVisible(), true);
    assert.equal(dom.window.localStorage.getItem(dismissalKey), null);
    dom.window.close();
  }

  {
    const { dom } = createWidget();
    await wait(50);

    const root = dom.window.document.querySelector('.jade-widget-root');
    const notificationBadge = root.shadowRoot.querySelector('.jade-avatar-badge');
    const notificationAsset = notificationBadge.querySelector('.jade-avatar-badge-asset');
    notificationAsset.dispatchEvent(new dom.window.Event('error'));
    assert.equal(notificationBadge.textContent, '1');

    dom.window.JadeWidget.open();
    await wait(20);
    assert.ok(root.shadowRoot.querySelector('.jade-chat-popup'));
    assert.equal(dom.window.JadeWidget.isOpen(), true);

    dom.window.JadeWidget.close();
    await wait(20);
    assert.equal(dom.window.JadeWidget.isOpen(), false);
    assert.equal(root.shadowRoot.querySelectorAll('.jade-launcher-dismiss').length, 1);
    dom.window.close();
  }

  console.log('JadeAssist launcher behaviour passed in the Node 22 jsdom runtime.');
}

run().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
