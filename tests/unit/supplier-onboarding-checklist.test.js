/**
 * The supplier dashboard's "Onboarding" checklist (renderSupplierChecklist in
 * app.js).
 *
 * Pins two bugs found during a visual review of the supplier dashboard:
 *  - "Get approved by admin" was hardcoded to done:false forever, with a
 *    comment claiming approval status "can't know client-side" — even though
 *    the caller already fetches it via /api/v1/me/suppliers and simply
 *    discarded it. An approved supplier's checklist never reflected that.
 *  - The three steps rendered as raw ✅/⬜️ emoji glyphs instead of the site's
 *    CSS-driven checklist icons (the same .health-checklist-* pattern the
 *    Profile Setup Checklist uses). Emoji rendering is font-dependent — on a
 *    mobile viewport in this repo's own Chromium build, all three steps drew
 *    as identical grey squares, so completed and incomplete were
 *    indistinguishable.
 *
 * The scenario runs in a plain Node process (jsdom cannot be loaded through
 * Jest's transform here) and reports its outcome as JSON — the same approach
 * tests/unit/card-collapse.test.js takes.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '../..');

const results = JSON.parse(
  execFileSync(
    process.execPath,
    [path.join(root, 'tests/helpers/supplier-onboarding-checklist-scenarios.js')],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  )
);

/**
 * The value a scenario produced, failing loudly if the scenario itself threw.
 * @param {string} name Scenario name.
 * @returns {Object} Scenario value.
 */
function outcome(name) {
  const result = results[name];
  if (!result) {
    throw new Error(`No such scenario: ${name}`);
  }
  if (!result.ok) {
    throw new Error(`Scenario "${name}" threw: ${result.error}\n${result.stack}`);
  }
  return result.value;
}

describe('supplier onboarding checklist', () => {
  it('renders steps as CSS-driven checklist items, not raw emoji', () => {
    const value = outcome('noEmoji');
    expect(value.containsCheckEmoji).toBe(false);
    expect(value.containsBoxEmoji).toBe(false);
    expect(value.containsChecklistItemClass).toBe(true);
    expect(value.containsChecklistIconClass).toBe(true);
  });

  it('marks "Get approved by admin" from the supplier\'s actual approval status', () => {
    const value = outcome('approvalStates');
    expect(value.approvedTrue).toBe('completed');
    expect(value.approvedFalse).toBe('incomplete');
  });

  it('marks profile and package steps from their own counts, independent of approval', () => {
    const value = outcome('independentSteps');
    expect(value.profile).toBe('incomplete');
    expect(value.package).toBe('incomplete');
  });

  it('marks all three steps complete for a supplier who has cleared every step', () => {
    const value = outcome('allComplete');
    expect(value.profile).toBe('completed');
    expect(value.approved).toBe('completed');
    expect(value.package).toBe('completed');
  });
});
