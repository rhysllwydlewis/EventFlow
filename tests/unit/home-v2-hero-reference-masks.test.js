const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const heroJs = fs.readFileSync(
  path.join(root, 'public/assets/js/pages/home-v2-hero.js'),
  'utf8'
);
const traceSource = fs.readFileSync(
  path.join(root, 'docs/assets/hero-collage-blob.py'),
  'utf8'
);

const names = ['venues', 'catering', 'entertainment', 'photography'];

function quotedValueAfter(source, marker, quote) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const valueStart = source.indexOf(quote, markerIndex + marker.length);
  if (valueStart === -1) {
    return null;
  }

  const valueEnd = source.indexOf(quote, valueStart + 1);
  if (valueEnd === -1) {
    return null;
  }

  return source.slice(valueStart + 1, valueEnd);
}

function extractJsMask(name) {
  const mask = quotedValueAfter(heroJs, `${name}:`, "'");
  if (!mask) {
    throw new Error(`Missing ${name} reference mask in home-v2-hero.js`);
  }
  return mask;
}

function extractTraceMask(name) {
  // Include the opening quote in the marker so the earlier REFERENCE card
  // metadata entry (`"venues": { ... }`) cannot be mistaken for MASKS data.
  const marker = `"${name}": "`;
  const markerIndex = traceSource.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Missing ${name} reference mask in hero-collage-blob.py`);
  }

  const valueStart = markerIndex + marker.length;
  const valueEnd = traceSource.indexOf('"', valueStart);
  if (valueEnd === -1) {
    throw new Error(`Unterminated ${name} reference mask in hero-collage-blob.py`);
  }

  return traceSource.slice(valueStart, valueEnd);
}

function coordinates(d) {
  return [...d.matchAll(/(-?\d*\.?\d+),(-?\d*\.?\d+)/g)].map(match => [
    Number(match[1]),
    Number(match[2]),
  ]);
}

describe('Homepage V2 approved-render collage masks', () => {
  test.each(names)('%s uses the checked-in reference trace', name => {
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
