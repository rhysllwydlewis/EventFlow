'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildPackageImageAudit,
  listPackageImageCandidates,
  resolvePackageImage,
  PLACEHOLDER_PACKAGE_IMAGE,
} = require('../../utils/packageImageUtils');

const SUPPLIERS_ROUTE = path.join(__dirname, '../../routes/suppliers.js');

describe('supplier package production image shape diagnostics', () => {
  it('falls back to the placeholder only when the observed public shape has no real candidate', () => {
    const productionPublicShape = {
      id: 'pkg_3737a82d29701670mq4yrbq2',
      slug: 'live-foil-stamping-4yrbq2',
      supplierId: 'sup_embosseur_20260607',
      title: 'Foil Stamping',
      image: '',
      imageUrl: '',
    };

    expect(listPackageImageCandidates(productionPublicShape)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'pkg.image', usable: false, reason: 'empty' }),
        expect.objectContaining({ source: 'pkg.imageUrl', usable: false, reason: 'empty' }),
      ])
    );
    expect(resolvePackageImage(productionPublicShape)).toBe(PLACEHOLDER_PACKAGE_IMAGE);
  });

  it('public resolver returns the same real image candidate that admin audit sees', () => {
    const packageWithAdminVisibleField = {
      id: 'pkg_engraving_prod',
      supplierId: 'sup_embosseur_20260607',
      title: 'Engraving',
      image: '',
      gallery: [{ optimized: '/api/photos/prod_engraving_optimized' }],
    };

    const audit = buildPackageImageAudit(packageWithAdminVisibleField);

    expect(audit.namedImageFields).toEqual(
      expect.arrayContaining([
        {
          path: 'pkg.gallery[0].optimized',
          field: 'optimized',
          value: '/api/photos/prod_engraving_optimized',
        },
      ])
    );
    expect(resolvePackageImage(packageWithAdminVisibleField)).toBe(audit.resolvedImage);
    expect(audit.resolvedImage).toBe('/api/photos/prod_engraving_optimized');
  });

  it('diagnoses duplicate approved/unapproved records in the public debug path without exposing records', () => {
    const routeContent = fs.readFileSync(SUPPLIERS_ROUTE, 'utf8');

    expect(routeContent).toContain(
      "const supplierPkgs = await dbUnified.find('packages', { supplierId: supplier.id });"
    );
    expect(routeContent).toContain(
      'const pkgs = supplierPkgs.filter(pkg => pkg.approved === true);'
    );
    expect(routeContent).toContain('duplicateTitleCountForSupplier');
    expect(routeContent).toContain('buildDuplicateTitleCounts(supplierPkgs)');
  });
});
