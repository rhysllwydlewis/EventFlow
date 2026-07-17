const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

describe('browser workflow gates', () => {
  test('E2E browser suites block pull requests without breaking post-merge push runs', () => {
    const workflow = read('.github/workflows/e2e.yml');

    expect(workflow).not.toMatch(/continue-on-error:\s*true/);
    expect(workflow).not.toMatch(/soft-fail|CONTINUE_ON_ERROR_UNTIL/i);
    expect(workflow).toMatch(/name:\s*E2E Auth Focus/);
    expect(workflow).toMatch(/name:\s*E2E Tests Part \$\{\{ matrix\.shard \}\} of 4/);
    expect(workflow).toMatch(/name:\s*Visual Regression Tests/);
    expect(workflow).toMatch(/name:\s*Browser Verification/);
    expect(workflow).toMatch(
      /if:\s*\$\{\{ always\(\) && github\.event_name == 'pull_request' \}\}/
    );
    expect(workflow).toMatch(/if:\s*github\.event_name == 'pull_request'/);
  });

  test('dedicated visual and axe workflow is blocking, least-privileged and preserves artifacts', () => {
    const workflow = read('.github/workflows/visual-regression.yml');

    expect(workflow).not.toMatch(/continue-on-error:\s*true/);
    expect(workflow).not.toMatch(/soft-fail|CONTINUE_ON_ERROR_UNTIL/i);
    expect(workflow).toMatch(/^permissions:\s*\{\}/m);
    expect(workflow).toMatch(/name:\s*Visual \+ a11y \(Chromium desktop \+ mobile\)/);
    expect(workflow).toMatch(/name:\s*Dedicated Visual Verification/);
    expect(workflow).toMatch(/if:\s*\$\{\{ always\(\) \}\}/);
    expect(workflow).toMatch(/Upload Playwright report/);
    expect(workflow).toMatch(/Upload screenshot diffs/);
  });
});
