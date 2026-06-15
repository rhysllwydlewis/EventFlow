const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(path.join(__dirname, '../../scripts/serve-static.js'), 'utf8');

describe('scripts/serve-static public HTML render path', () => {
  test('serves the static-server homepage through renderer before express.static', () => {
    const rootRoute = "app.get('/', (req, res, next) => {";
    const rootIdx = script.indexOf(rootRoute);
    const staticIdx = script.indexOf('app.use(express.static(PUBLIC_DIR))');

    expect(rootIdx).toBeGreaterThan(-1);
    expect(staticIdx).toBeGreaterThan(-1);
    expect(rootIdx).toBeLessThan(staticIdx);
    expect(script.slice(rootIdx, staticIdx)).toContain("sendRenderedHtml(req, res, 'index.html')");
  });

  test('canonical public pages use sendRenderedHtml instead of raw sendFile', () => {
    const canonicalStart = script.indexOf('canonicalPages.forEach(page => {');
    const canonicalEnd = script.indexOf('// Deprecated admin pages', canonicalStart);
    const canonicalBlock = script.slice(canonicalStart, canonicalEnd);

    expect(canonicalBlock).toContain('sendRenderedHtml(req, res, `${page}.html`).catch(next);');
    expect(canonicalBlock).not.toContain('res.sendFile(path.join(PUBLIC_DIR, `${page}.html`));');
  });

  test('/suppliers uses the renderer instead of raw sendFile', () => {
    const suppliersRoute = script.match(/app\.get\('\/suppliers'[\s\S]*?\n\}\);/);
    expect(suppliersRoute).toBeTruthy();
    expect(suppliersRoute[0]).toContain("sendRenderedHtml(req, res, 'suppliers.html')");
    expect(suppliersRoute[0]).not.toContain('res.sendFile');
  });
});
