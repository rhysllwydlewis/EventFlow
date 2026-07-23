const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const publicDir = path.join(__dirname, '../../public');
const widgetBundle = fs.readFileSync(
  path.join(publicDir, 'assets/js/vendor/jade-widget.js'),
  'utf8'
);

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

describe('JadeAssist native launcher behaviour', () => {
  let dom;

  afterEach(() => {
    dom?.window.close();
    dom = undefined;
  });

  function createWidget() {
    dom = new JSDOM('<!doctype html><html><body></body></html>', {
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

    return { assets, dismissalKey };
  }

  it('renders the approved agent, notification and close assets', async () => {
    const { assets } = createWidget();
    await wait(50);

    const root = dom.window.document.querySelector('.jade-widget-root');
    expect(root).not.toBeNull();
    expect(root.shadowRoot).not.toBeNull();

    const avatar = root.shadowRoot.querySelector('.jade-avatar-img');
    expect(avatar).not.toBeNull();
    expect(avatar.src).toBe(assets.avatarUrl);
    expect(avatar.alt).toBe('Jade chat assistant');

    const notificationBadge = root.shadowRoot.querySelector('.jade-avatar-badge');
    expect(notificationBadge).not.toBeNull();
    expect(notificationBadge.getAttribute('aria-label')).toBe('1 new notification');

    const notificationAsset = notificationBadge.querySelector('.jade-avatar-badge-asset');
    expect(notificationAsset).not.toBeNull();
    expect(notificationAsset.src).toBe(assets.notificationBadgeUrl);

    const closeButton = root.shadowRoot.querySelector('.jade-launcher-dismiss');
    expect(closeButton).not.toBeNull();
    expect(closeButton.getAttribute('aria-label')).toBe('Hide Jade chat assistant');

    const closeAsset = closeButton.querySelector('.jade-launcher-dismiss-asset');
    expect(closeAsset).not.toBeNull();
    expect(closeAsset.src).toBe(assets.closeButtonUrl);
  });

  it('hides, persists and restores the launcher through its native controls', async () => {
    const { dismissalKey } = createWidget();
    await wait(50);

    const root = dom.window.document.querySelector('.jade-widget-root');
    const closeButton = root.shadowRoot.querySelector('.jade-launcher-dismiss');
    let dismissalEvent;
    dom.window.addEventListener('jadeassist:widget-dismissed', event => {
      dismissalEvent = event.detail;
    });

    closeButton.click();

    expect(root.hidden).toBe(true);
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(dom.window.JadeWidget.isVisible()).toBe(false);
    expect(Number(dom.window.localStorage.getItem(dismissalKey))).toBeGreaterThan(0);
    expect(dismissalEvent).toEqual(
      expect.objectContaining({ source: 'launcher-close-button' })
    );

    dom.window.JadeWidget.show();
    await wait(20);

    expect(root.hidden).toBe(false);
    expect(root.hasAttribute('aria-hidden')).toBe(false);
    expect(dom.window.JadeWidget.isVisible()).toBe(true);
    expect(dom.window.localStorage.getItem(dismissalKey)).toBeNull();
  });

  it('keeps one close control across chat re-renders and has image fallbacks', async () => {
    createWidget();
    await wait(50);

    const root = dom.window.document.querySelector('.jade-widget-root');
    const notificationBadge = root.shadowRoot.querySelector('.jade-avatar-badge');
    const notificationAsset = notificationBadge.querySelector('.jade-avatar-badge-asset');

    notificationAsset.dispatchEvent(new dom.window.Event('error'));
    expect(notificationBadge.textContent).toBe('1');

    dom.window.JadeWidget.open();
    await wait(20);
    expect(root.shadowRoot.querySelector('.jade-chat-popup')).not.toBeNull();
    expect(dom.window.JadeWidget.isOpen()).toBe(true);

    dom.window.JadeWidget.close();
    await wait(20);
    expect(dom.window.JadeWidget.isOpen()).toBe(false);
    expect(root.shadowRoot.querySelectorAll('.jade-launcher-dismiss')).toHaveLength(1);
  });
});
