'use strict';

const fs = require('fs');
const path = require('path');

describe('supplier public trust asset wiring', () => {
  const root = path.resolve(__dirname, '../..');

  test('loads the public trust correction from an explicitly versioned stable script id', () => {
    const html = fs.readFileSync(path.join(root, 'public/supplier.html'), 'utf8');

    expect(html).toContain('id="supplier-profile-public-polish-script"');
    expect(html).toContain('/assets/js/pages/supplier-profile-public-polish.js?v=2.0.0');
    expect(html).toContain('/assets/js/pages/supplier-init.js?v=2.0.0');
  });

  test('supplier init keeps stale public renderers behind the same fail-closed trust boundary', () => {
    const source = fs.readFileSync(
      path.join(root, 'public/assets/js/pages/supplier-init.js'),
      'utf8'
    );

    expect(source).toContain('supplier.verified = emailVerified');
    expect(source).toContain('delete supplier.insurance');
    expect(source).toContain('delete supplier.license');
    expect(source).toContain("supplier-profile-public-polish.js?v=2.0.0");
    expect(source).not.toContain("supplier-profile-public-polish.js?v=1.0.0");
    expect(source).toMatch(/DATA_IMAGE_RE\.test\(raw\)[\s\S]{0,80}return ''/);
  });

  test('shared verification badge utility never treats generic supplier verified as email proof', () => {
    const source = fs.readFileSync(
      path.join(root, 'public/assets/js/utils/verification-badges.js'),
      'utf8'
    );

    expect(source).not.toMatch(/emailVerified\s*\|\|[^\n]*supplier\.verified/);
    expect(source).not.toMatch(/verifications\?\.email\?\.verified\s*\|\|\s*supplier\.verified/);
  });
});
