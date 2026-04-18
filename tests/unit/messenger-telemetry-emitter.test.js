'use strict';

const { MessengerTelemetryEmitter } = require('../../public/messenger/js/MessengerTelemetry');

describe('MessengerTelemetryEmitter', () => {
  it('aggregates counters and flushes once per interval', async () => {
    let now = 1000;
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true });
    const emitter = new MessengerTelemetryEmitter({
      sessionId: 's1',
      fetchImpl,
      flushIntervalMs: 30000,
      now: () => now,
    });

    emitter.record({ dupSeqDrops: 1, cmidReconciles: 1, maxGapSize: 2, timeToLiveMs: 10 });
    emitter.record({ dupSeqDrops: 2, cmidReconciles: 3, maxGapSize: 1, timeToLiveMs: 8 });

    const flushed = await emitter.flush('live');
    expect(flushed).toBe(false);

    now = 32050;
    const flushedLater = await emitter.flush('live');
    expect(flushedLater).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toEqual({
      sessionId: 's1',
      counters: {
        dupSeqDrops: 3,
        cmidReconciles: 4,
        maxGapSize: 2,
        timeToLiveMs: 10,
      },
    });
  });
});
