const fs = require('fs');
const path = require('path');

describe('notification dropdown accessibility', () => {
  it('pre-renders the notifications page dropdown as a labelled dialog', () => {
    const html = fs.readFileSync(path.join(process.cwd(), 'public/notifications.html'), 'utf8');

    expect(html).toContain(
      'id="notification-dropdown" class="notification-dropdown" role="dialog" aria-label="Notifications"'
    );
  });

  it('sets bell and dynamically-created dropdown accessibility attributes', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'public/assets/js/notifications.js'),
      'utf8'
    );

    expect(source).toContain("bell.setAttribute('aria-haspopup', 'dialog')");
    expect(source).toContain("bell.setAttribute('aria-controls', 'notification-dropdown')");
    expect(source).toContain("dropdown.setAttribute('role', 'dialog')");
    expect(source).toContain("dropdown.setAttribute('aria-label', 'Notifications')");
  });
});
