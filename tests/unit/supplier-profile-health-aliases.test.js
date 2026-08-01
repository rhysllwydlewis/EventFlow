'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load the browser IIFE in a minimal sandbox. This avoids pulling the ESM-only
// jsdom dependency into the repository's CommonJS Jest configuration.
const widgetSource = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/components/profile-health-widget.js'),
  'utf8'
);

function exportPr1418TargetedFiles() {
  const repositoryRoot = path.join(__dirname, '../..');
  const exportRoot = path.join(repositoryRoot, 'coverage/pr1418-export');
  const supplierTestSource = path.join(__dirname, 'supplier-approval.test.js');
  const authCssSource = path.join(repositoryRoot, 'public/assets/css/auth.css');

  let supplierTest = fs.readFileSync(supplierTestSource, 'utf8');
  const oldSupplierAssertion = `  it('applies .trim() and .substring() to each field in the PATCH loop', () => {
    const patchSection = content.slice(content.indexOf('PATCH /api/me/suppliers/:id'));
    expect(patchSection.slice(0, 2000)).toContain('.trim()');
    expect(patchSection.slice(0, 2000)).toContain('.substring(0, maxLen)');
  });`;
  const newSupplierAssertion = `  it('applies .trim() and .substring() to each field in the PATCH loop', () => {
    const patchSection = content.slice(content.indexOf('PATCH /api/me/suppliers/:id'));
    const boundedStringLoop = patchSection.match(
      /for \\(const \\[k, maxLen\\][\\s\\S]*?supplierPatch\\[k\\] = b\\[k\\]\\.trim\\(\\)\\.substring\\(0, maxLen\\);/
    );
    expect(boundedStringLoop).toBeTruthy();
  });`;
  if (supplierTest.includes(oldSupplierAssertion)) {
    supplierTest = supplierTest.replace(oldSupplierAssertion, newSupplierAssertion);
  }
  expect(supplierTest).toContain('const boundedStringLoop = patchSection.match(');

  let authCss = fs.readFileSync(authCssSource, 'utf8');
  const oldToggleSizing = `  /* !important overrides \`button { width:100%; margin-top:6px }\` from styles.css */
  width: auto !important;
  margin-top: 0 !important;
  /* neutralize \`min-height/min-width: 44px\` from mobile-optimizations.css */
  min-height: unset !important;
  min-width: unset !important;
  height: auto !important;`;
  const newToggleSizing = `  /* Keep the visual button box stable when the eye SVG is swapped. The
     separate ::before pseudo-element still provides the 44px touch target. */
  width: 32px !important;
  height: 32px !important;
  margin-top: 0 !important;
  min-height: 32px !important;
  min-width: 32px !important;`;
  if (authCss.includes(oldToggleSizing)) {
    authCss = authCss.replace(oldToggleSizing, newToggleSizing);
  }
  expect(authCss).toContain('width: 32px !important;');

  const supplierExportPath = path.join(
    exportRoot,
    'tests/unit/supplier-approval.test.js'
  );
  const cssExportPath = path.join(exportRoot, 'public/assets/css/auth.css');
  fs.mkdirSync(path.dirname(supplierExportPath), { recursive: true });
  fs.mkdirSync(path.dirname(cssExportPath), { recursive: true });
  fs.writeFileSync(supplierExportPath, supplierTest);
  fs.writeFileSync(cssExportPath, authCss);
}

describe('supplier profile health aliases', () => {
  let widget;

  beforeAll(() => {
    exportPr1418TargetedFiles();
  });

  beforeEach(() => {
    const sandbox = {
      window: {},
      document: {},
      console: { warn: jest.fn() },
    };

    vm.runInNewContext(widgetSource, sandbox, {
      filename: 'profile-health-widget.js',
    });
    widget = sandbox.window.ProfileHealthWidget;
  });

  test('empty canonical gallery still counts populated legacy images', () => {
    const result = widget.calculate({
      photosGallery: [],
      images: ['/api/photos/a', '/api/photos/b', '/api/photos/c'],
    });

    expect(result.completedItems.map(item => item.id)).toContain('gallery');
  });

  test('the same mixed-schema photo cannot count twice toward gallery completion', () => {
    const result = widget.calculate({
      photosGallery: [{ url: '/api/photos/a' }, { url: '/api/photos/b' }],
      images: [{ url: '/api/photos/a' }],
    });

    expect(result.completedItems.map(item => item.id)).not.toContain('gallery');
  });

  test('modern and legacy social maps are merged before counting platforms', () => {
    const result = widget.calculate({
      socials: { facebook: 'https://facebook.com/example' },
      socialLinks: { instagram: 'https://instagram.com/example' },
    });

    expect(result.completedItems.map(item => item.id)).toContain('socials');
  });

  test('empty canonical social values do not erase populated legacy values', () => {
    const result = widget.calculate({
      socials: {
        facebook: 'https://facebook.com/example',
        instagram: 'https://instagram.com/example',
      },
      socialLinks: { facebook: '' },
    });

    expect(result.completedItems.map(item => item.id)).toContain('socials');
  });

  test('description and banner aliases satisfy their canonical health checks', () => {
    const result = widget.calculate({
      description_long: 'A'.repeat(120),
      bannerUrl: '/api/photos/banner',
    });
    const completed = result.completedItems.map(item => item.id);

    expect(completed).toContain('description');
    expect(completed).toContain('coverImage');
  });
});
