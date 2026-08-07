'use strict';

const fs = require('fs');
const path = require('path');

describe('security header runtime version contract', () => {
  it('matches package.json, .node-version, CI, and the runtime guard on Node 22', () => {
    const root = path.resolve(__dirname, '../..');
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const pinnedVersion = fs.readFileSync(path.join(root, '.node-version'), 'utf8').trim();
    const verifier = fs.readFileSync(
      path.join(root, 'scripts', 'verify-security-headers.mjs'),
      'utf8'
    );
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

    expect(packageJson.engines.node).toBe('>=22.0.0 <23');
    expect(pinnedVersion).toMatch(/^22\./);
    expect(verifier).toContain('nodeMajorVersion !== 22');
    expect(verifier).toContain('scripts/security-header-test-server.js');
    expect(verifier).toContain('spawn(process.execPath, [serverScript]');
    expect(verifier).not.toContain('HSTS (Production - Skipped)');
    expect(verifier).toContain('requires Node.js 22.x');
    expect(verifier).not.toContain('requires Node.js 20.x');
    expect(readme).toContain('Node.js 22.x');
    expect(readme).not.toContain('Node 22+ is not supported');
  });
});
