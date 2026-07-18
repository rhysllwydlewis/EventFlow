'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

describe('current-state hardening contracts', () => {
  test('production has one canonical host and does not reflect unknown hosts', () => {
    const security = read('middleware/security.js');
    const railway = JSON.parse(read('railway.json'));

    expect(railway.environments.production.variables.BASE_URL).toBe('https://event-flow.co.uk');
    expect(railway.environments.production.variables.CANONICAL_BASE_URL).toBe(
      'https://event-flow.co.uk'
    );
    expect(security).toMatch(/function resolveCanonicalProductionOrigin/);
    expect(security).toMatch(/PRODUCTION_APP_ORIGINS\.includes\(parsedOrigin\)/);
    expect(security).toMatch(/PRODUCTION_APP_ORIGINS\.map/);
    expect(security).toMatch(/res\.redirect\(308, canonicalOrigin \+ requestUrl\)/);
    expect(security).not.toMatch(/res\.redirect\([^\n]*req\.headers\.host/);
  });

  test('production synthetics check host redirects and unsupported public claims', () => {
    const workflow = read('.github/workflows/production-synthetics.yml');
    const script = read('scripts/production-synthetic-check.mjs');

    expect(workflow).toMatch(/SYNTHETIC_ALTERNATE_URL: https:\/\/www\.event-flow\.co\.uk/);
    expect(script).toMatch(/alternate homepage host redirect/);
    expect(script).toMatch(/alternate marketplace host redirect/);
    expect(script).toMatch(/Join over 500\\\+ verified suppliers/);
    expect(script).toMatch(/currently building the marketplace platform/);
    expect(script).toMatch(/check\.type === 'redirect'[\s\S]*\? check\.url/);
  });

  test('public source no longer publishes unsupported launch claims', () => {
    const sources = [
      read('public/assets/js/app.js'),
      read('public/index.html'),
      read('public/marketplace.html'),
    ];
    const combined = sources.join('\n');

    expect(combined).not.toMatch(/Join over 500\+ verified suppliers already on EventFlow/i);
    expect(combined).not.toMatch(/We're currently building the marketplace platform/i);
  });

  test('Dependabot excludes disruptive tooling from groups without suppressing updates', () => {
    const dependabot = read('.github/dependabot.yml');

    expect(dependabot).toMatch(/development-tooling:[\s\S]*exclude-patterns:/);
    expect(dependabot).toMatch(/exclude-patterns:[\s\S]*prettier/);
    expect(dependabot).toMatch(/ignore:[\s\S]*dependency-name: '\*'[\s\S]*semver-major/);

    const ignoreSection = dependabot.split(/\n\s*ignore:\s*\n/)[1].split(/\n\s*commit-message:/)[0];
    expect(ignoreSection).not.toMatch(/prettier|playwright|mongodb-memory-server|pdfkit|sharp/);
  });

  test('stale roadmap and backend API backlog have been replaced', () => {
    const roadmap = read('docs/90-DAY-ROADMAP.md');
    const backendStatus = read('docs/api/BACKEND_APIS_STATUS.md');
    const currentState = read('docs/CURRENT_STATE.md');

    expect(roadmap).toMatch(/Historical — no longer an active backlog/);
    expect(backendStatus).toMatch(/GET \/api\/me\/suppliers\/:id\/photos/);
    expect(backendStatus).toMatch(/DELETE \/api\/me\/suppliers\/:id\/photos\/:photoId/);
    expect(currentState).toMatch(/Open GitHub issues are the source of truth/);
  });

  test('backend classification has no stale or unclassified spec paths', () => {
    const classification = JSON.parse(read('e2e/backend-suite-classification.json'));
    const blocking = new Set(classification.blocking);
    const quarantined = new Set(Object.keys(classification.quarantined));
    const backendSpecs = fs
      .readdirSync(path.join(root, 'e2e'))
      .filter(file => file.endsWith('.spec.js'))
      .filter(file => read(path.join('e2e', file)).includes('@backend'))
      .sort();

    expect(blocking.size).toBeGreaterThanOrEqual(12);
    expect(quarantined.size).toBeLessThanOrEqual(8);
    expect([...blocking].filter(file => quarantined.has(file))).toEqual([]);
    expect([...blocking, ...quarantined].sort()).toEqual(backendSpecs);
  });

  test('security inventory uses a step-scoped read credential without writing secret values', () => {
    const workflow = read('.github/workflows/security-alert-inventory.yml');

    expect(workflow).not.toMatch(/^\s+security-events:/m);
    expect(workflow).toMatch(
      /- name: Build sanitised alert inventory\n\s+env:\n\s+SECURITY_ALERTS_TOKEN: \$\{\{ secrets\.SECURITY_ALERTS_TOKEN \}\}/
    );
    expect(workflow).toContain('authorization: `Bearer ${alertToken}`');
    expect(workflow).toMatch(/core\.setSecret\(alertToken\)/);
    expect(workflow).toMatch(/secret_type_display_name/);
    expect(workflow).not.toMatch(/alert\.secret\b/);
    expect(workflow).toMatch(/never includes a secret value/);
  });
});
