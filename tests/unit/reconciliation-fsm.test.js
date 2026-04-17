'use strict';

const {
  ReconciliationFSM,
  RECON_STATES,
  dedupeMessages,
} = require('../../public/messenger/js/ReconciliationFSM');
const { VirtualList } = require('../../public/messenger/js/VirtualList');

describe('ReconciliationFSM', () => {
  it('follows allowed transition path and rejects invalid jumps', () => {
    const fsm = new ReconciliationFSM();
    expect(fsm.getState()).toBe(RECON_STATES.IDLE);
    expect(fsm.transition(RECON_STATES.CONNECTING)).toBe(true);
    expect(fsm.transition(RECON_STATES.CATCHING_UP)).toBe(true);
    expect(fsm.transition(RECON_STATES.LIVE)).toBe(true);
    expect(fsm.transition(RECON_STATES.CONNECTING)).toBe(false);
  });

  it('simulates reconnect gap of 3 without duplicates', () => {
    const existing = [
      { _id: '1', seq: 1, clientMessageId: 'c1', content: 'a' },
      { _id: '2', seq: 2, clientMessageId: 'c2', content: 'b' },
    ];
    const catchup = [
      { _id: '3', seq: 3, clientMessageId: 'c3', content: 'c' },
      { _id: '4', seq: 4, clientMessageId: 'c4', content: 'd' },
      { _id: '5', seq: 5, clientMessageId: 'c5', content: 'e' },
    ];
    const queuedLive = [
      { _id: 'temp-5', seq: 5, clientMessageId: 'c5', content: 'dup e' },
      { _id: '6', seq: 6, clientMessageId: 'c6', content: 'f' },
    ];

    const afterCatchup = dedupeMessages(existing, catchup);
    const final = dedupeMessages(afterCatchup, queuedLive);

    expect(final.map(m => m.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(final.filter(m => m.seq === 5)).toHaveLength(1);
  });
});

describe('VirtualList windowing', () => {
  it('caps rendered window to max nodes and tracks totals', () => {
    const v = new VirtualList(80);
    const items = Array.from({ length: 150 }, (_, i) => ({ seq: i + 1 }));
    const w = v.setItems(items);
    expect(w.items).toHaveLength(80);
    expect(w.total).toBe(150);
    expect(w.items[0].seq).toBe(71);
  });
});
