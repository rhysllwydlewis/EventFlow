'use strict';

const fs = require('fs');
const path = require('path');

const rendererPath = path.join(__dirname, '../../public/assets/js/supplier-profile-packages-v2.js');
const supplierHtmlPath = path.join(__dirname, '../../public/supplier.html');
const supplierProfilePath = path.join(__dirname, '../../public/assets/js/supplier-profile.js');

describe('supplier profile packages v2 renderer contract', () => {
  let renderer;
  let supplierHtml;
  let supplierProfile;

  beforeAll(() => {
    renderer = fs.readFileSync(rendererPath, 'utf8');
    supplierHtml = fs.readFileSync(supplierHtmlPath, 'utf8');
    supplierProfile = fs.readFileSync(supplierProfilePath, 'utf8');
  });

  it('fetches the new dedicated endpoint and passes debugImages through', () => {
    expect(renderer).toContain(
      '/api/supplier-profile/${encodeURIComponent(supplierId)}/package-cards'
    );
    expect(renderer).toContain('?debugImages=1');
    expect(renderer).toContain("credentials: 'include'");
  });

  it('uses item.imageUrl directly with only one defensive placeholder fallback', () => {
    expect(renderer).toContain('img.src = item.imageUrl || PACKAGE_PLACEHOLDER_URL');
    expect(renderer).toContain('img.onerror = () =>');
    expect(renderer).toContain('img.src = PACKAGE_PLACEHOLDER_URL');
    expect(renderer).not.toContain('rawImage');
    expect(renderer).not.toContain('resolvedGallery');
    expect(renderer).not.toContain('resolvedImage');
  });

  it('clears and owns the v2 mount so duplicate renders do not append stale cards', () => {
    expect(renderer).toContain("root.dataset.renderer = 'v2'");
    expect(renderer).toContain('root.replaceChildren()');
    expect(renderer).toContain('setPackagesSectionVisible(root, false)');
    expect(renderer).toContain("root?.closest?.('#sp-section-packages')");
  });

  it('logs image decisions in debug mode', () => {
    expect(renderer).toContain('console.table');
    expect(renderer).toContain('[supplier-packages-v2] image decisions');
  });

  it('wires the new module into supplier.html with a dedicated mount point', () => {
    expect(supplierHtml).toContain('id="supplier-package-cards-root" data-renderer="v2"');
    expect(supplierHtml).toMatch(/\/assets\/js\/supplier-profile-packages-v2\.js\?v=\d+\.\d+\.\d+/);
  });

  it('removes the legacy packages API fetch and render call from supplier-profile load flow', () => {
    expect(supplierProfile).toContain(
      'supplier-profile-packages-v2.js via /api/supplier-profile/:supplierId/package-cards'
    );
    expect(supplierProfile).not.toContain('packagesResp');
    expect(supplierProfile).not.toContain('renderPackagesSection(packages)');
  });
});
