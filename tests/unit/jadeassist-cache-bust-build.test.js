const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'version-jadeassist-assets.mjs');
const polishScriptPath = path.join(
  repoRoot,
  'public',
  'assets',
  'js',
  'jadeassist-launcher-polish.js'
);
const expectedVersion = '20260723-4';

function expectOrderedScripts(html) {
  const vendorIndex = html.indexOf('/assets/js/vendor/jade-widget.js');
  const polishIndex = html.indexOf('/assets/js/jadeassist-launcher-polish.js');
  const initializerIndex = html.indexOf('/assets/js/jadeassist-init.v2.js');

  expect(vendorIndex).toBeGreaterThanOrEqual(0);
  expect(polishIndex).toBeGreaterThan(vendorIndex);
  expect(initializerIndex).toBeGreaterThan(polishIndex);
}

describe('JadeAssist production asset delivery', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eventflow-jadeassist-cache-'));
    fs.mkdirSync(path.join(tempRoot, 'public', 'nested'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('injects the polish layer, versions all scripts and remains idempotent', () => {
    const indexPath = path.join(tempRoot, 'public', 'index.html');
    const nestedPath = path.join(tempRoot, 'public', 'nested', 'page.html');

    fs.writeFileSync(
      indexPath,
      '<script src="/assets/js/vendor/jade-widget.js" defer></script>\n' +
        '<script src="/assets/js/jadeassist-init.v2.js" defer></script>\n'
    );
    fs.writeFileSync(
      nestedPath,
      '<script src="/assets/js/vendor/jade-widget.js?v=old" defer></script>\n' +
        '<script src="/assets/js/jadeassist-launcher-polish.js?cache=old" defer></script>\n' +
        '<script src="/assets/js/jadeassist-init.v2.js?cache=old" defer></script>\n'
    );

    const firstRun = execFileSync(process.execPath, [scriptPath], {
      cwd: tempRoot,
      encoding: 'utf8',
    });
    expect(firstRun).toContain('2/2 HTML files');

    for (const filePath of [indexPath, nestedPath]) {
      const html = fs.readFileSync(filePath, 'utf8');
      expect(html).toContain(`/assets/js/vendor/jade-widget.js?v=${expectedVersion}`);
      expect(html).toContain(`/assets/js/jadeassist-launcher-polish.js?v=${expectedVersion}`);
      expect(html).toContain(`/assets/js/jadeassist-init.v2.js?v=${expectedVersion}`);
      expect(html.match(/jadeassist-launcher-polish\.js/g)).toHaveLength(1);
      expect(html).not.toContain('v=old');
      expect(html).not.toContain('cache=old');
      expectOrderedScripts(html);
    }

    const secondRun = execFileSync(process.execPath, [scriptPath], {
      cwd: tempRoot,
      encoding: 'utf8',
    });
    expect(secondRun).toContain('0/2 HTML files');
  });

  test('does not inject the polish layer into pages without JadeAssist', () => {
    const plainPath = path.join(tempRoot, 'public', 'plain.html');
    fs.writeFileSync(plainPath, '<main>No assistant on this page</main>\n');

    execFileSync(process.execPath, [scriptPath], {
      cwd: tempRoot,
      encoding: 'utf8',
    });

    expect(fs.readFileSync(plainPath, 'utf8')).toBe('<main>No assistant on this page</main>\n');
  });

  test('runs during the production image build and exposes the reviewed polish asset', () => {
    const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const script = fs.readFileSync(scriptPath, 'utf8');
    const polishScript = fs.readFileSync(polishScriptPath, 'utf8');

    expect(dockerfile).toContain('RUN node scripts/version-jadeassist-assets.mjs');
    expect(packageJson.scripts['version:jadeassist-assets']).toBe(
      'node scripts/version-jadeassist-assets.mjs'
    );
    expect(script).toContain(`JADEASSIST_ASSET_VERSION = '${expectedVersion}'`);
    expect(script).toContain('/assets/js/jadeassist-launcher-polish.js');
    expect(polishScript).toContain('width: 52px !important');
    expect(polishScript).toContain('eventflow-jade-launcher-float');
    expect(polishScript).toContain('DEFAULT_DISMISS_DURATION_MS = 0');
    expect(polishScript).toContain("'jadeassist_dismissed_at'");
    expect(polishScript).toContain('clearPersistedDismissals(config)');
    expect(polishScript).toContain("aria-label', 'Close JadeAssist assistant'");
    expect(polishScript).toContain(
      "DOCUMENT_STYLE_ID = 'eventflow-jadeassist-launcher-host-state'"
    );
    expect(polishScript).toContain('${ROOT_SELECTOR}[hidden]');
    expect(polishScript).toContain('display: none !important');
  });
});
