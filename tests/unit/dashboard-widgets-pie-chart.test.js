'use strict';

/**
 * Removing the unused profile checklist from dashboard-widgets.js also deleted
 * `loadChartJS`, which `createBudgetPieChart` still calls. The call threw a
 * ReferenceError, the surrounding catch turned it into `null`, and the budget pie
 * chart silently never rendered even when Chart.js was already on the page.
 *
 * This runs the real module with a stubbed DOM and Chart.js, so it fails on that
 * mistake instead of only checking that a name appears in the source.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const MODULE = path.join(__dirname, '../../public/assets/js/dashboard-widgets.js');

function run(budgetData, { chartAvailable = true } = {}) {
  const script = `
    const constructed = [];
    const el = () => ({
      style: {}, children: [], innerHTML: '',
      setAttribute() {}, appendChild(child) { this.children.push(child); },
      getContext: () => ({}), addEventListener() {},
      classList: { add() {}, remove() {} },
    });
    const container = el();
    globalThis.window = globalThis;
    globalThis.document = {
      getElementById: id => (id === 'pie' ? container : null),
      createElement: () => el(),
      head: el(),
    };
    globalThis.matchMedia = () => ({ matches: false });
    if (${chartAvailable}) {
      globalThis.Chart = class { constructor(ctx, config) { constructed.push(config.type); } destroy() {} };
    }
    const mod = await import(${JSON.stringify(`file://${MODULE}`)});
    const result = await mod.createBudgetPieChart(${JSON.stringify(budgetData)}, 'pie');
    console.log(JSON.stringify({
      constructed,
      returnedChart: result !== null,
      message: container.innerHTML,
    }));
  `;
  const result = spawnSync(
    process.execPath,
    ['--no-warnings', '--input-type=module', '-e', script],
    {
      encoding: 'utf8',
    }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
  return JSON.parse(result.stdout);
}

describe('createBudgetPieChart', () => {
  it('builds the pie chart when Chart.js is already on the page', () => {
    const result = run({ breakdown: { Venue: 5000, Catering: 2500 } });
    expect(result.constructed).toEqual(['pie']);
    expect(result.returnedChart).toBe(true);
  });

  it('shows the empty message and builds nothing when there is no spending', () => {
    const result = run({ breakdown: { Venue: 0 } });
    expect(result.constructed).toEqual([]);
    expect(result.returnedChart).toBe(false);
    expect(result.message).toContain('No budget breakdown data yet');
  });

  it('still exports every widget except the removed checklist', () => {
    const script = `
      globalThis.window = globalThis;
      globalThis.document = { getElementById: () => null };
      const mod = await import(${JSON.stringify(`file://${MODULE}`)});
      console.log(JSON.stringify(Object.keys(mod).sort()));
    `;
    const result = spawnSync(
      process.execPath,
      ['--no-warnings', '--input-type=module', '-e', script],
      {
        encoding: 'utf8',
      }
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      'createBudgetPieChart',
      'createBudgetTracker',
      'createEventsTimeline',
      'createProgressRing',
      'createStatsGrid',
      'default',
    ]);
  });
});
