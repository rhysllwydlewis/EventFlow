'use strict';

const fs = require('fs');
const path = require('path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');

describe('admin debug background jobs integration', () => {
  test('adds a read-only Background Jobs tab to the existing debug page', () => {
    const html = read('public/admin-debug.html');
    expect(html).toContain('id="tab-btn-background-jobs"');
    expect(html).toContain('id="tab-background-jobs"');
    expect(html).toContain('id="bj-jobs-list"');
    expect(html).not.toContain('id="bj-run-now"');
  });

  test('loads the protected background jobs API and labels telemetry limitations', () => {
    const script = read('public/assets/js/pages/admin-debug-background-jobs.js');
    expect(script).toContain("'/api/admin/background-jobs?limit=6'");
    expect(script).toContain('Partial telemetry');
    expect(script).toContain('Configuration only');
    expect(script).not.toContain("method: 'POST'");
  });

  test('exposes authenticated read-only endpoints from the existing system-check routes', () => {
    const routes = read('routes/system-checks-admin.js');
    expect(routes).toContain("router.get('/background-jobs'");
    expect(routes).toContain("router.get('/background-jobs/health'");
    expect(routes).toContain("roleRequired('admin')");
  });
});
