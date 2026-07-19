'use strict';

const fs = require('fs');
const path = require('path');

describe('production supplier-profile synthetics', () => {
  const workflowPath = path.join(__dirname, '../../.github/workflows/production-synthetics.yml');
  const scriptPath = path.join(__dirname, '../../scripts/production-synthetic-check.mjs');
  const obsoleteScriptPath = path.join(__dirname, '../../scripts/production-synthetics.mjs');

  test('the scheduled workflow runs the script containing supplier-profile checks', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8');
    const script = fs.readFileSync(scriptPath, 'utf8');

    expect(workflow).toContain('node scripts/production-synthetic-check.mjs');
    expect(script).toContain('runSupplierProfileChecks');
    expect(script).toContain('canonical supplier profile contract');
    expect(script).toContain('legacy supplier profile redirect');
    expect(script).toContain('const hasJsonLd =');
  });

  test('does not leave a duplicate, unwired production script behind', () => {
    expect(fs.existsSync(obsoleteScriptPath)).toBe(false);
  });
});
