const fs = require('fs');
const path = require('path');

describe('admin homepage manager hardening', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/admin-homepage.html'), 'utf8');
  const script = fs.readFileSync(
    path.join(__dirname, '../../public/assets/js/pages/admin-homepage-hardening.js'),
    'utf8'
  );

  test('loads the hardening layer after the rebuilt homepage manager', () => {
    const rebuildIndex = html.indexOf('/assets/js/pages/admin-homepage-rebuild.js');
    const hardeningIndex = html.indexOf('/assets/js/pages/admin-homepage-hardening.js');

    expect(rebuildIndex).toBeGreaterThan(-1);
    expect(hardeningIndex).toBeGreaterThan(rebuildIndex);
  });

  test('restores a one-column editor at tablet widths', () => {
    expect(script).toContain('@media (max-width: 1180px)');
    expect(script).toContain('.admin-homepage-manager .homepage-manager-layout');
    expect(script).toContain('grid-template-columns: minmax(0, 1fr) !important');
    expect(script).toContain('position: static !important');
  });

  test('protects unsaved changes and blocks stale publishing', () => {
    expect(script).toContain("window.addEventListener('beforeunload'");
    expect(script).toContain('Save or reset your changes before setting a homepage live.');
    expect(script).toContain('[data-select-version], [data-edit-version]');
    expect(script).toContain('You have unsaved homepage changes. Discard them and continue?');
  });

  test('supports renaming homepage tabs through the existing version API', () => {
    expect(script).toContain('Homepage tab name');
    expect(script).toContain('/api/v1/admin/homepage/manager/version/${selectedVersion()}');
    expect(script).toContain('JSON.stringify({ tabName: name })');
    expect(script).toContain('maxlength="40"');
  });

  test('adds mutation locks and accessible modal keyboard behaviour', () => {
    expect(script).toContain("document.body.setAttribute('aria-busy', 'true')");
    expect(script).toContain('homepage-operation-busy');
    expect(script).toContain("modal.setAttribute('aria-modal', 'true')");
    expect(script).toContain("if (event.key === 'Escape')");
    expect(script).toContain("if (event.key !== 'Tab')");
  });
});
