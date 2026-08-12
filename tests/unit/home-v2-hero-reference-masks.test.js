const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const heroJs = fs.readFileSync(path.join(root, 'public/assets/js/pages/home-v2-hero.js'), 'utf8');
const traceSource = fs.readFileSync(path.join(root, 'docs/assets/hero-collage-blob.py'), 'utf8');

const names = ['venues', 'catering', 'entertainment', 'photography'];

function extractJsMask(name) {
  const match = heroJs.match(new RegExp(`${name}:\\s*\\n?\\s*'([^']+)'`));
  if (!match) {
    throw new Error(`Missing ${name} reference mask in home-v2-hero.js`);
  }
  return match[1];
}

function extractTraceMask(name) {
  const match = traceSource.match(new RegExp(`"${name}":\\s*"([^"]+)"`));
  if (!match) {
    throw new Error(`Missing ${name} reference mask in hero-collage-blob.py`);
  }
  return match[1];
}

function coordinates(d) {
  return [...d.matchAll(/(-?\d*\.?\d+),(-?\d*\.?\d+)/g)].map((match) => [
    Number(match[1]),
    Number(match[2]),
  ]);
}

describe('Homepage V2 approved-render collage masks', () => {
  test.each(names)('%s uses the checked-in reference trace', (name) => {
    const runtime = extractJsMask(name);
    const source = extractTraceMask(name);

    expect(runtime).toBe(source);
    expect(runtime).toMatch(/^M/);
    expect(runtime).toMatch(/ Z$/);

    const points = coordinates(runtime);
    expect(points).toHaveLength(64);
    points.forEach(([x, y]) => {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    });
  });

  test('reference masks are applied before the collage initialises', () => {
    const applyCall = heroJs.indexOf('applyReferenceMasks();');
    const domReadyHandler = heroJs.indexOf("document.addEventListener('DOMContentLoaded'");

    expect(applyCall).toBeGreaterThan(-1);
    expect(domReadyHandler).toBeGreaterThan(-1);
    expect(applyCall).toBeLessThan(domReadyHandler);
    expect(heroJs).toContain("target.dataset.maskSource = 'approved-render-trace'");
  });

  test('the masks are not regenerated as superellipses', () => {
    expect(traceSource).not.toContain('sample_quadrant');
    expect(traceSource).not.toContain('catmull_rom_path');
    expect(traceSource).not.toContain('|x/a|^n');
  });
});
