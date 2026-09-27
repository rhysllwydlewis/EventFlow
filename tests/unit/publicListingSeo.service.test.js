'use strict';

const { buildPackageSeoModel } = require('../../services/publicListingSeo.service');

describe('publicListingSeo.service — buildPackageSeoModel', () => {
  const baseSupplier = {
    id: 'sup_1',
    name: 'Pink Diamond Catering',
    location: 'London',
    description: 'Award-winning catering for weddings and corporate events across London.',
  };

  test('falls back to the generated description when the package copies the supplier bio verbatim', () => {
    const pkg = {
      id: 'pkg_1',
      title: 'Corporate event catering London',
      slug: 'coporate-event-catering-london-zq3oke',
      description: baseSupplier.description,
    };

    const packageSeo = buildPackageSeoModel(pkg, baseSupplier, {
      baseUrl: 'https://event-flow.co.uk',
    });

    expect(packageSeo.description).not.toBe(baseSupplier.description);
    expect(packageSeo.description).toContain('Corporate event catering London');
    expect(packageSeo.description).toContain('Pink Diamond Catering');
  });

  test('keeps a package-specific description that differs from the supplier bio', () => {
    const pkg = {
      id: 'pkg_2',
      title: 'Corporate event catering London',
      slug: 'coporate-event-catering-london-zq3oke',
      description: 'Bespoke buffet and canape packages for up to 200 guests, delivered UK-wide.',
    };

    const packageSeo = buildPackageSeoModel(pkg, baseSupplier, {
      baseUrl: 'https://event-flow.co.uk',
    });

    expect(packageSeo.description).toContain('Bespoke buffet and canape packages');
  });

  test('is case/whitespace insensitive when comparing against the supplier bio', () => {
    const pkg = {
      id: 'pkg_3',
      title: 'Corporate event catering London',
      slug: 'coporate-event-catering-london-zq3oke',
      description: `  ${baseSupplier.description.toUpperCase()}  `,
    };

    const packageSeo = buildPackageSeoModel(pkg, baseSupplier, {
      baseUrl: 'https://event-flow.co.uk',
    });

    expect(packageSeo.description.toLowerCase()).not.toBe(baseSupplier.description.toLowerCase());
  });
});
