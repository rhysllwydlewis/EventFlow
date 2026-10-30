'use strict';

/**
 * AdminTabs: tabs that keep the chosen tab in the address (?tab=...), used by the pages that
 * several old pages were merged into. Runs the real script in jsdom through a child process.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const SCENARIO = path.join(__dirname, '../helpers/admin-tabs-scenario.js');

function run(scenario) {
  const encoded = Buffer.from(JSON.stringify(scenario)).toString('base64');
  return JSON.parse(execFileSync('node', [SCENARIO, encoded], { encoding: 'utf8' }));
}

describe('AdminTabs', () => {
  it('works out the tab an address asks for, and the address to record a tab', () => {
    const { pure } = run({});
    expect(pure.fromQuery).toBe('external');
    expect(pure.fromHash).toBe('contacts');
    expect(pure.notATab).toBeNull();
    expect(pure.queryWins).toBe('external');
    expect(pure.keepsOthers).toBe('/admin-tickets?id=7&tab=external#top');
    expect(pure.replacesTab).toBe('/admin-tickets?tab=b');
  });

  it('shows the first tab and hides the others', () => {
    const { afterMount, error } = run({});
    expect(error).toBeNull();
    expect(afterMount.visible).toEqual(['one']);
    expect(afterMount.active).toEqual(['one']);
    expect(afterMount.selected).toEqual(['true', 'false', 'false']);
  });

  it('opens the tab the address asks for, without rewriting the address', () => {
    const { afterMount } = run({ url: 'http://localhost/admin-tickets?tab=two&id=5' });
    expect(afterMount.visible).toEqual(['two']);
    expect(afterMount.search).toBe('?tab=two&id=5');
  });

  it('opens a tab named in the #hash (older links ended #contacts)', () => {
    expect(run({ url: 'http://localhost/admin-tickets#three' }).afterMount.visible).toEqual([
      'three',
    ]);
  });

  it('clicking a tab shows it and records it in the address, keeping other parts', () => {
    const { steps } = run({ url: 'http://localhost/admin-tickets?id=9', actions: [{ click: 1 }] });
    expect(steps[0].visible).toEqual(['two']);
    expect(steps[0].search).toBe('?id=9&tab=two');
  });

  it('tells a tab whether it is the first time it has been shown', () => {
    const { calls } = run({ actions: [{ click: 1 }, { click: 0 }, { click: 1 }] });
    expect(calls).toEqual([
      ['one', true],
      ['two', true],
      ['one', false],
      ['two', false],
    ]);
  });

  it('moves between tabs with the arrow keys, wrapping round', () => {
    const { steps } = run({
      actions: [
        { key: 'ArrowLeft', on: 0 },
        { key: 'ArrowRight', on: 2 },
      ],
    });
    expect(steps[0].visible).toEqual(['three']);
    expect(steps[1].visible).toEqual(['one']);
  });

  it('copes with a tab whose button or panel is missing', () => {
    const { error, afterMount } = run({ ghost: true });
    expect(error).toBeNull();
    expect(afterMount.visible).toEqual(['one']);
  });
});
