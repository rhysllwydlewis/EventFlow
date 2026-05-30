const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const helperPath = path.join(process.cwd(), 'public/assets/js/utils/notification-state.js');
const helperSource = fs.readFileSync(helperPath, 'utf8');

function loadHelpers(html = '<!doctype html><html><body></body></html>') {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  dom.window.eval(helperSource);
  return { dom, helpers: dom.window.EventFlowNotificationState };
}

describe('EventFlowNotificationState helpers', () => {
  it('deduplicates notifications by canonical id', () => {
    const { helpers } = loadHelpers();
    const list = helpers.dedupeNotifications([
      { id: 'n1', title: 'First' },
      { id: 'n1', title: 'Duplicate' },
      { id: 'n2', title: 'Second' },
    ]);

    expect(list).toHaveLength(2);
    expect(list.map(item => item.id)).toEqual(['n1', 'n2']);
  });

  it('deduplicates message notifications by metadata.messageId', () => {
    const { helpers } = loadHelpers();
    const list = helpers.dedupeNotifications([
      { type: 'message', metadata: { messageId: 'm1' }, message: 'Hello' },
      { type: 'message', metadata: { messageId: 'm1' }, message: 'Hello again' },
    ]);

    expect(list).toHaveLength(1);
  });

  it('upserts an existing notification instead of duplicating it', () => {
    const { helpers } = loadHelpers();
    const list = helpers.upsertNotification([{ id: 'n1', isRead: false }], {
      id: 'n1',
      isRead: true,
    });

    expect(list).toHaveLength(1);
    expect(list[0].isRead).toBe(true);
  });

  it('updates all matching badge elements and hides them at zero', () => {
    const { dom, helpers } = loadHelpers(`<!doctype html><html><body>
      <span id="ef-notification-badge" style="display:none"></span>
      <span id="ef-bottom-dashboard-badge" style="display:none"></span>
      <span class="notification-badge" style="display:none"></span>
    </body></html>`);
    const { document } = dom.window;

    helpers.updateBadges(7);
    expect(document.querySelector('#ef-notification-badge').textContent).toBe('7');
    expect(document.querySelector('#ef-bottom-dashboard-badge').textContent).toBe('7');
    expect(document.querySelector('.notification-badge').textContent).toBe('7');

    helpers.updateBadges(0);
    expect(document.querySelector('#ef-notification-badge').style.display).toBe('none');
    expect(document.querySelector('#ef-bottom-dashboard-badge').style.display).toBe('none');
    expect(document.querySelector('.notification-badge').style.display).toBe('none');
  });
});
