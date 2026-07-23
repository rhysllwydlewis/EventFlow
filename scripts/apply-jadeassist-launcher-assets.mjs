import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const initPath = path.join(root, 'public/assets/js/jadeassist-init.v2.js');
const testPath = path.join(root, 'tests/integration/jadeassist-widget.test.js');
const docsPath = path.join(root, 'docs/jadeassist-widget.md');

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Unable to apply ${label}: expected source block was not found`);
  }
  return source.replace(search, replacement);
}

let init = fs.readFileSync(initPath, 'utf8');

const oldAssetResolver = `  /**
   * Resolves the avatar URL relative to the page's <base> tag.
   * Supports both root deployments (/assets/…) and subpath deployments
   * (/app/assets/…).
   */
  function getAvatarUrl() {
    const baseElement = document.querySelector('base');
    const basePath = baseElement ? baseElement.getAttribute('href') : '/';
    const avatarPath = 'assets/images/jade-avatar.png';

    if (!basePath || basePath === '/') {
      return \`/\${avatarPath}\`;
    }
    const cleanBasePath = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
    return \`\${cleanBasePath}/\${avatarPath}\`;
  }`;

const newAssetResolver = `  /** Resolves a self-hosted widget asset for root and subpath deployments. */
  function getAssetUrl(assetPath) {
    const baseElement = document.querySelector('base');
    const basePath = baseElement ? baseElement.getAttribute('href') : '/';

    if (!basePath || basePath === '/') {
      return \`/\${assetPath}\`;
    }
    const cleanBasePath = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
    return \`\${cleanBasePath}/\${assetPath}\`;
  }

  function getAvatarUrl() {
    return getAssetUrl('assets/images/jadeassist-agent.png');
  }`;

init = replaceOnce(init, oldAssetResolver, newAssetResolver, 'generic asset URL resolver');

init = replaceOnce(
  init,
  `  function showTeaser() {\n    if (isTeaserDismissed()) {`,
  `  function showTeaser() {\n    if (\n      isTeaserDismissed() ||\n      (window.JadeWidget &&\n        typeof window.JadeWidget.isVisible === 'function' &&\n        !window.JadeWidget.isVisible())\n    ) {`,
  'teaser visibility guard'
);

init = replaceOnce(
  init,
  `      const avatarUrl = getAvatarUrl();\n      widgetAvatarUrl = avatarUrl; // Make available to showTeaser() for avatar display`,
  `      const avatarUrl = getAvatarUrl();\n      const notificationBadgeUrl = getAssetUrl(\n        'assets/images/jadeassist-notification-badge.png'\n      );\n      const closeButtonUrl = getAssetUrl('assets/images/jadeassist-close-button.png');\n      widgetAvatarUrl = avatarUrl; // Make available to showTeaser() for avatar display`,
  'launcher asset URLs'
);

init = replaceOnce(
  init,
  `          avatarUrl,\n          offsetBottom: DESKTOP_OFFSET_BOTTOM,`,
  `          avatarUrl,\n          notificationBadgeUrl,\n          closeButtonUrl,\n          offsetBottom: DESKTOP_OFFSET_BOTTOM,`,
  'debug asset summary'
);

init = replaceOnce(
  init,
  `        // Avatar\n        avatarUrl,\n\n        // Desktop positioning`,
  `        // Approved self-hosted launcher assets\n        avatarUrl,\n        notificationBadgeUrl,\n        closeButtonUrl,\n        launcherDismissible: true,\n        launcherDismissStorageKey: DISMISS_STORAGE_KEY,\n        launcherDismissDurationMs: DISMISS_DURATION_MS,\n        // EventFlow already delays the outer initialization by INIT_DELAY.\n        showDelayMs: 0,\n\n        // Desktop positioning`,
  'widget asset configuration'
);

init = replaceOnce(
  init,
  `      // Inject a × dismiss button on the launcher so users can close the widget for 24 h\n      injectDismissButton(debug);`,
  `      // Enhance the copied widget bundle and gracefully defer to native controls when present.\n      enhanceLauncherAssets(debug, { notificationBadgeUrl, closeButtonUrl });`,
  'launcher enhancer call'
);

const oldDismissFunctionPattern = /  \/\*\*\n   \* Injects a small × dismiss button[\s\S]*?\n  function injectDismissButton\(debug\) \{[\s\S]*?\n  \}\n\n  \/\*\*\n   \* Polls for window\.JadeWidget/;

const newDismissFunction = `  /**
   * Applies the approved notification and close assets to the self-hosted widget.
   * The current copied bundle is enhanced in place; newer JadeAssist bundles expose
   * the same behaviour natively, so duplicate controls are deliberately avoided.
   */
  function enhanceLauncherAssets(debug, assetUrls) {
    let shadowObserver = null;

    function hasActiveDismissal() {
      try {
        const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
        if (!raw) return false;
        const dismissedAt = Number(raw);
        const active = Number.isFinite(dismissedAt) && Date.now() - dismissedAt < DISMISS_DURATION_MS;
        if (!active) localStorage.removeItem(DISMISS_STORAGE_KEY);
        return active;
      } catch (_) {
        return false;
      }
    }

    function persistDismissal() {
      try {
        localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
      } catch (_) {
        // The widget remains hidden for this page when storage is unavailable.
      }
    }

    function hideRoot(root, source) {
      dismissTeaser();
      persistDismissal();

      if (window.JadeWidget && typeof window.JadeWidget.hide === 'function') {
        window.JadeWidget.hide();
      } else if (window.JadeWidget && typeof window.JadeWidget.close === 'function') {
        window.JadeWidget.close();
      }

      root.hidden = true;
      root.setAttribute('aria-hidden', 'true');
      window.dispatchEvent(
        new CustomEvent('jadeassist:launcher-dismissed', {
          detail: { source, timestamp: Date.now() },
        })
      );

      if (debug) console.log('[JadeAssist] Widget dismissed for 30 days');
    }

    function decorate(root) {
      const shadowRoot = root.shadowRoot;
      if (!shadowRoot) return false;

      if (hasActiveDismissal()) {
        root.hidden = true;
        root.setAttribute('aria-hidden', 'true');
        return true;
      }

      root.hidden = false;
      root.removeAttribute('aria-hidden');

      const avatar = shadowRoot.querySelector('.jade-avatar-img');
      if (avatar) {
        avatar.src = widgetAvatarUrl;
        avatar.alt = 'Jade chat assistant';
        avatar.style.objectFit = 'contain';
      }

      const badge = shadowRoot.querySelector('.jade-avatar-badge');
      if (badge && !badge.querySelector('[data-jade-notification-asset]')) {
        badge.textContent = '';
        badge.style.background = 'transparent';
        badge.style.border = '0';
        badge.style.boxShadow = 'none';
        badge.style.padding = '0';
        badge.style.overflow = 'visible';

        const notificationImage = document.createElement('img');
        notificationImage.src = assetUrls.notificationBadgeUrl;
        notificationImage.alt = '';
        notificationImage.setAttribute('aria-hidden', 'true');
        notificationImage.setAttribute('data-jade-notification-asset', '1');
        notificationImage.style.cssText =
          'display:block;width:100%;height:100%;object-fit:contain;pointer-events:none';
        notificationImage.addEventListener('error', () => {
          notificationImage.remove();
          badge.textContent = '1';
        });
        badge.appendChild(notificationImage);
      }

      const container = shadowRoot.querySelector('.jade-widget-container');
      const nativeButton = shadowRoot.querySelector('.jade-launcher-dismiss');
      if (container && !nativeButton && !container.querySelector('[data-jade-dismiss]')) {
        container.style.overflow = 'visible';

        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-jade-dismiss', '1');
        button.setAttribute('aria-label', 'Hide Jade chat assistant');
        button.title = 'Hide Jade';
        button.style.cssText = [
          'position:absolute',
          'top:-10px',
          'left:-10px',
          'width:30px',
          'height:30px',
          'padding:0',
          'border:0',
          'border-radius:50%',
          'background:transparent',
          'cursor:pointer',
          'z-index:' + (Z_INDEX.WIDGET + 1),
          'display:flex',
          'align-items:center',
          'justify-content:center',
          'overflow:visible',
        ].join(';');

        const closeImage = document.createElement('img');
        closeImage.src = assetUrls.closeButtonUrl;
        closeImage.alt = '';
        closeImage.setAttribute('aria-hidden', 'true');
        closeImage.style.cssText =
          'display:block;width:100%;height:100%;object-fit:contain;pointer-events:none';
        closeImage.addEventListener('error', () => {
          closeImage.remove();
          button.textContent = '×';
          button.style.background = '#9ca3af';
          button.style.color = '#fff';
          button.style.fontSize = '18px';
        });

        const touchTarget = document.createElement('span');
        touchTarget.setAttribute('aria-hidden', 'true');
        touchTarget.style.cssText =
          'position:absolute;width:44px;height:44px;border-radius:50%;pointer-events:none';

        button.append(touchTarget, closeImage);
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          hideRoot(root, 'launcher-close-button');
        });
        container.appendChild(button);
      }

      shadowObserver?.disconnect();
      shadowObserver = new MutationObserver(() => decorate(root));
      shadowObserver.observe(shadowRoot, { childList: true, subtree: true });
      return true;
    }

    function findAndDecorate() {
      const root = document.querySelector('.jade-widget-root');
      return root ? decorate(root) : false;
    }

    if (!findAndDecorate()) {
      const observer = new MutationObserver((_, mutationObserver) => {
        if (findAndDecorate()) mutationObserver.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 5000);
    }

    window.addEventListener('jadeassist:widget-restored', () => {
      const root = document.querySelector('.jade-widget-root');
      if (root) {
        root.hidden = false;
        root.removeAttribute('aria-hidden');
        decorate(root);
      }
    });
  }

  /**
   * Polls for window.JadeWidget`;

if (!oldDismissFunctionPattern.test(init)) {
  throw new Error('Unable to replace legacy dismiss-button implementation');
}
init = init.replace(oldDismissFunctionPattern, newDismissFunction);

init = init.replace(
  `    // Skip if the user dismissed the widget within the last 30 days\n    try {\n      const dismissedAt = localStorage.getItem(DISMISS_STORAGE_KEY);\n      if (dismissedAt && Date.now() - Number(dismissedAt) < DISMISS_DURATION_MS) {\n        if (shouldEnableDebug()) {\n          console.log('[JadeAssist] Skipping init — widget dismissed within last 30 days');\n        }\n        return;\n      }\n    } catch (_) {\n      // ignore storage errors\n    }\n\n`,
  ''
);

fs.writeFileSync(initPath, init);

let tests = fs.readFileSync(testPath, 'utf8');
tests = tests.replace("expect(v2Content).toContain('jade-avatar.png');", "expect(v2Content).toContain('jadeassist-agent.png');");

const testMarker = "  describe('Approved launcher assets and dismissal behaviour'";
if (!tests.includes(testMarker)) {
  const insertion = `\n  describe('Approved launcher assets and dismissal behaviour', () => {\n    const imageDir = path.join(publicDir, 'assets/images');\n    const initPath = path.join(publicDir, 'assets/js/jadeassist-init.v2.js');\n\n    it.each([\n      ['jadeassist-agent.png', 160],\n      ['jadeassist-notification-badge.png', 96],\n      ['jadeassist-close-button.png', 96],\n    ])('should include a valid transparent %s asset', (fileName, minimumSize) => {\n      const buffer = fs.readFileSync(path.join(imageDir, fileName));\n      expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');\n      expect(buffer.readUInt32BE(16)).toBeGreaterThanOrEqual(minimumSize);\n      expect(buffer.readUInt32BE(20)).toBeGreaterThanOrEqual(minimumSize);\n      expect([4, 6].includes(buffer.readUInt8(25)) || buffer.includes(Buffer.from('tRNS'))).toBe(true);\n    });\n\n    it('should configure all launcher assets and native dismissal settings', () => {\n      const content = fs.readFileSync(initPath, 'utf8');\n      expect(content).toContain('jadeassist-notification-badge.png');\n      expect(content).toContain('jadeassist-close-button.png');\n      expect(content).toContain('notificationBadgeUrl');\n      expect(content).toContain('closeButtonUrl');\n      expect(content).toContain('launcherDismissible: true');\n      expect(content).toContain('launcherDismissStorageKey: DISMISS_STORAGE_KEY');\n      expect(content).toContain('launcherDismissDurationMs: DISMISS_DURATION_MS');\n      expect(content).toContain('showDelayMs: 0');\n    });\n\n    it('should enhance the copied bundle without rendering duplicate close controls', () => {\n      const content = fs.readFileSync(initPath, 'utf8');\n      expect(content).toContain('enhanceLauncherAssets');\n      expect(content).toContain("shadowRoot.querySelector('.jade-launcher-dismiss')");\n      expect(content).toContain('data-jade-notification-asset');\n      expect(content).toContain('data-jade-dismiss');\n      expect(content).not.toContain('function injectDismissButton');\n      expect(content).not.toContain("btn.textContent = '×'");\n    });\n\n    it('should keep dismissal duration and messaging aligned at 30 days', () => {\n      const content = fs.readFileSync(initPath, 'utf8');\n      expect(content).toContain('30 * 24 * 60 * 60 * 1000');\n      expect(content).toContain('Widget dismissed for 30 days');\n      expect(content).not.toContain('dismissed for 24 h');\n    });\n  });\n`;

  const closing = '\n});\n';
  const lastClosing = tests.lastIndexOf(closing);
  if (lastClosing === -1) throw new Error('Unable to append JadeAssist tests');
  tests = tests.slice(0, lastClosing) + insertion + tests.slice(lastClosing);
}
fs.writeFileSync(testPath, tests);

if (fs.existsSync(docsPath)) {
  let docs = fs.readFileSync(docsPath, 'utf8');
  const docsMarker = '## Branded launcher assets';
  if (!docs.includes(docsMarker)) {
    docs += `\n\n${docsMarker}\n\nEventFlow self-hosts the approved JadeAssist agent, notification badge and grey close-button PNGs under \`public/assets/images\`. The v2 initializer passes all three assets into JadeAssist, enhances the currently pinned copied bundle when required, and persists launcher dismissal for 30 days. The close control has a 44 px interaction target and the teaser is suppressed whenever the launcher is hidden.\n`;
    fs.writeFileSync(docsPath, docs);
  }
}

for (const [fileName, minSize] of [
  ['jadeassist-agent.png', 160],
  ['jadeassist-notification-badge.png', 96],
  ['jadeassist-close-button.png', 96],
]) {
  const filePath = path.join(root, 'public/assets/images', fileName);
  const data = fs.readFileSync(filePath);
  if (data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`${fileName} is not a PNG`);
  }
  if (data.readUInt32BE(16) < minSize || data.readUInt32BE(20) < minSize) {
    throw new Error(`${fileName} is below the required dimensions`);
  }
}

console.log('Applied JadeAssist launcher assets, controls, tests and documentation.');
