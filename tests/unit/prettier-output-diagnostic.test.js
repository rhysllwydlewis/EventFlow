const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const prettierCli = require.resolve('prettier/bin/prettier.cjs');
const sourcePaths = [
  'public/assets/js/jadeassist-launcher-polish.js',
  'tests/unit/jadeassist-cache-bust-build.test.js',
];

test('captures the repository formatter output for the JadeAssist repair', () => {
  const outputRoot = path.join(repoRoot, 'coverage', 'prettier-diagnostic');

  for (const sourcePath of sourcePaths) {
    const formatted = execFileSync(process.execPath, [prettierCli, sourcePath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const outputPath = path.join(outputRoot, sourcePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, formatted);
    expect(formatted.length).toBeGreaterThan(0);
  }
});