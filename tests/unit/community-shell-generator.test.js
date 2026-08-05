/**
 * The community HTML shells are generated from one template
 * (`scripts/generate-community-pages.mjs`) and committed. Nothing enforced that
 * the two stayed in step, and they did not: the template kept emitting the
 * pre-redesign hero band for `/community` long after the committed shell had
 * been rebuilt around the `.efc-stage` composition. Running the generator would
 * have silently reverted the redesign, and the only signal would have been the
 * next person wondering where the homepage went.
 *
 * `--check` regenerates in memory and compares, so drift fails here instead.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const GENERATOR = path.join(ROOT, 'scripts/generate-community-pages.mjs');

describe('the committed community shells match their template', () => {
  it('reports no drift', () => {
    let output = '';
    let failed = false;
    try {
      output = execFileSync('node', [GENERATOR, '--check'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      failed = true;
      output = `${error.stdout || ''}${error.stderr || ''}`;
    }
    expect(failed ? output : '').toBe('');
    expect(output).toContain('match the template');
  });

  it('does not write anything in --check mode', () => {
    const target = path.join(ROOT, 'public/community.html');
    const before = fs.readFileSync(target, 'utf8');
    execFileSync('node', [GENERATOR, '--check'], { cwd: ROOT, stdio: 'ignore' });
    expect(fs.readFileSync(target, 'utf8')).toBe(before);
  });

  it('keeps the redesigned hero in the template, not just in the committed file', () => {
    // The specific regression this suite exists for. If someone reverts the
    // template to the shared `hero()` band, the drift check above catches it —
    // but this says plainly which markup is load-bearing.
    const template = fs.readFileSync(GENERATOR, 'utf8');
    expect(template).toContain('efc-stage__card');
    expect(template).toContain('efc-catstrip');
  });
});
