'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Messenger deferred follow-ups (static checks)', () => {
  it('wires queue enqueue from messenger service', () => {
    const src = read('services/messenger-v4.service.js');
    expect(src).toContain('enqueueNotificationJob');
    expect(src).toContain('MONGO_REPLICA_SET');
    expect(src).toContain('withTransaction');
  });

  it('adds queue files and worker entrypoint', () => {
    expect(fs.existsSync(path.join(ROOT, 'services/queue/index.js'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'services/queue/workers/notification.worker.js'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(ROOT, 'services/queue/workers/email.worker.js'))).toBe(true);
    const pkg = read('package.json');
    expect(pkg).toContain('"worker": "node scripts/worker.js"');
  });

  it('includes reconciliation and read-by UI modules', () => {
    const idx = read('public/messenger/index.html');
    expect(idx).toContain('/messenger/js/ReconciliationFSM.js');
    expect(idx).toContain('/messenger/js/ReadByModal.js');
    expect(idx).toContain('/messenger/js/VirtualList.js');
  });
});
