const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'version-jadeassist-assets.mjs');
const expectedVersion = '20260723-1';

describe('JadeAssist production asset cache busting', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eventflow-jadeassist-cache-'));
    fs.mkdirSync(path.join(tempRoot, 'public', 'nested'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('versions both widget scripts across the public HTML tree and remains idempotent', () => {
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
      expect(html).toContain(`/assets/js/jadeassist-init.v2.js?v=${expectedVersion}`);
      expect(html).not.toContain('v=old');
      expect(html).not.toContain('cache=old');
    }

    const secondRun = execFileSync(process.execPath, [scriptPath], {
      cwd: tempRoot,
      encoding: 'utf8',
    });
    expect(secondRun).toContain('0/2 HTML files');
  });

  test('runs during the production image build and is exposed for manual verification', () => {
    const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const script = fs.readFileSync(scriptPath, 'utf8');

    expect(dockerfile).toContain('RUN node scripts/version-jadeassist-assets.mjs');
    expect(packageJson.scripts['version:jadeassist-assets']).toBe(
      'node scripts/version-jadeassist-assets.mjs'
    );
    expect(script).toContain(`JADEASSIST_ASSET_VERSION = '${expectedVersion}'`);
  });
});
