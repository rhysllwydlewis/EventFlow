const fs = require('fs');
const path = require('path');

describe('Dashboard supplier security-oriented script loading', () => {
  let dashboardContent;

  beforeAll(() => {
    dashboardContent = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'public', 'dashboard-supplier.html'),
      'utf8'
    );
  });

  it('loads no confetti script at all (neither the local copy nor the jsdelivr CDN)', () => {
    expect(dashboardContent).not.toContain('confetti');
  });

  it('does not include JadeAssist third-party widget script on supplier dashboard', () => {
    expect(dashboardContent).not.toContain('packages/widget/dist/jade-widget.js');
    expect(dashboardContent).not.toContain('/assets/js/jadeassist-init.v2.js');
  });
});
