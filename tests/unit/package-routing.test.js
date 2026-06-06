'use strict';

const fs = require('fs');
const path = require('path');

describe('public package routing', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
  const packageInitSource = fs.readFileSync(
    path.join(__dirname, '../../public/assets/js/pages/package-init.js'),
    'utf8'
  );
  const suppliersRoutesSource = fs.readFileSync(
    path.join(__dirname, '../../routes/suppliers.js'),
    'utf8'
  );
  const staticServerSource = fs.readFileSync(
    path.join(__dirname, '../../scripts/serve-static.js'),
    'utf8'
  );

  it('serves package.html for clean /package/:slug URLs', () => {
    expect(serverSource).toContain("app.get('/package/:slug'");
    expect(serverSource).toContain("'public', 'package.html'");
  });

  it('mirrors clean package routes in the static E2E server', () => {
    expect(staticServerSource).toContain("app.get('/package/:slug'");
    expect(staticServerSource).toContain("'package.html'");
  });

  it('package page resolves identifiers from clean paths and query strings', () => {
    expect(packageInitSource).toContain(
      'window.location.pathname.match(/^\\/package\\/([^/?#]+)\\/?$/)'
    );
    expect(packageInitSource).toContain("urlParams.get('id') || urlParams.get('packageId')");
  });

  it('fallback supplier package details avoid broken supplier profile/contact CTAs', () => {
    expect(packageInitSource).toContain('supplier.isPackageSupplierFallback === true');
    expect(packageInitSource).toContain("viewBtn.href = '/suppliers'");
    expect(packageInitSource).toContain('Supplier profile is currently unavailable');
    expect(packageInitSource).toContain('Supplier contact is currently unavailable');
  });

  it('package API can match ID, stored slug, or normalised title slug', () => {
    expect(suppliersRoutesSource).toContain('function normalisePackageSlug');
    expect(suppliersRoutesSource).toContain('pkg.title && normalisePackageSlug(pkg.title)');
    expect(suppliersRoutesSource).toContain('normalisePackageSlug(value) === normalisedParam');
  });
});
