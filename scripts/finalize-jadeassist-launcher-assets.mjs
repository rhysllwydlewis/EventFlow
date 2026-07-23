import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const initPath = path.join(root, 'public/assets/js/jadeassist-init.v2.js');
const testPath = path.join(root, 'tests/integration/jadeassist-widget.test.js');
const docsPath = path.join(root, 'docs/jadeassist-widget.md');

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Unable to update ${label}: expected content was not found`);
  }
  return source.replace(search, replacement);
}

let init = fs.readFileSync(initPath, 'utf8');

if (!init.includes('function bindWidgetLifecycleEvents()')) {
  init = replaceRequired(
    init,
    "  let widgetAvatarUrl = ''; // Set once on init, used by showTeaser() for avatar display\n",
    "  let widgetAvatarUrl = ''; // Set once on init, used by showTeaser() for avatar display\n  let widgetLifecycleEventsBound = false;\n\n  /** Keeps EventFlow's teaser lifecycle aligned with the native JadeAssist launcher. */\n  function bindWidgetLifecycleEvents() {\n    if (widgetLifecycleEventsBound) {\n      return;\n    }\n    widgetLifecycleEventsBound = true;\n\n    window.addEventListener('jadeassist:widget-dismissed', () => {\n      dismissTeaser();\n      try {\n        localStorage.setItem(TEASER_STORAGE_KEY, Date.now().toString());\n      } catch (_) {\n        // The native widget is still hidden for the current page when storage is unavailable.\n      }\n    });\n  }\n",
    'widget lifecycle binding'
  );
}

init = init.replace(
  "      // Enhance the copied widget bundle and gracefully defer to native controls when present.\n      enhanceLauncherAssets(debug, { notificationBadgeUrl, closeButtonUrl });\n\n",
  "      // Keep the custom teaser in sync with native launcher dismissal events.\n      bindWidgetLifecycleEvents();\n\n"
);

const enhancerPattern = /  \/\*\*\n   \* Applies the approved notification and close assets[\s\S]*?\n  \}\n\n  \/\*\*\n   \* Polls for window\.JadeWidget/;
if (enhancerPattern.test(init)) {
  init = init.replace(
    enhancerPattern,
    "  /**\n   * Polls for window.JadeWidget"
  );
}

if (init.includes('function enhanceLauncherAssets')) {
  throw new Error('Legacy EventFlow launcher enhancer was not fully removed');
}
if (!init.includes("window.addEventListener('jadeassist:widget-dismissed'")) {
  throw new Error('Native JadeAssist dismissal listener is missing');
}

fs.writeFileSync(initPath, init);

let tests = fs.readFileSync(testPath, 'utf8');
const oldTest = `    it('should enhance the copied bundle without rendering duplicate close controls', () => {\n      const content = fs.readFileSync(initPath, 'utf8');\n      expect(content).toContain('enhanceLauncherAssets');\n      expect(content).toContain("shadowRoot.querySelector('.jade-launcher-dismiss')");\n      expect(content).toContain('data-jade-notification-asset');\n      expect(content).toContain('data-jade-dismiss');\n      expect(content).not.toContain('function injectDismissButton');\n      expect(content).not.toContain("btn.textContent = '×'");\n    });`;
const newTest = `    it('should use the verified native launcher controls and sync teaser dismissal', () => {\n      const content = fs.readFileSync(initPath, 'utf8');\n      const bundle = fs.readFileSync(\n        path.join(publicDir, 'assets/js/vendor/jade-widget.js'),\n        'utf8'\n      );\n\n      expect(content).toContain('bindWidgetLifecycleEvents');\n      expect(content).toContain("window.addEventListener('jadeassist:widget-dismissed'");\n      expect(content).not.toContain('function enhanceLauncherAssets');\n      expect(content).not.toContain('function injectDismissButton');\n\n      expect(bundle).toContain('jade-launcher-dismiss');\n      expect(bundle).toContain('jade-avatar-badge-asset');\n      expect(bundle).toContain('jadeassist:widget-dismissed');\n      expect(bundle).toContain('notificationBadgeUrl');\n      expect(bundle).toContain('closeButtonUrl');\n      expect(bundle).toContain('isVisible');\n    });`;

if (tests.includes(oldTest)) {
  tests = tests.replace(oldTest, newTest);
} else if (!tests.includes("should use the verified native launcher controls")) {
  throw new Error('Unable to update native launcher integration test');
}
fs.writeFileSync(testPath, tests);

let docs = fs.readFileSync(docsPath, 'utf8');
docs = docs.replace(
  "The v2 initializer passes all three assets into JadeAssist, enhances the currently pinned copied bundle when required, and persists launcher dismissal for 30 days. The close control has a 44 px interaction target and the teaser is suppressed whenever the launcher is hidden.",
  "The v2 initializer passes all three assets into the verified self-hosted JadeAssist bundle and persists launcher dismissal for 30 days. The native close control has a 44 px interaction target, and EventFlow listens for the widget dismissal event so the custom teaser is removed at the same time."
);
fs.writeFileSync(docsPath, docs);

console.log('Finalized the native JadeAssist launcher integration.');
