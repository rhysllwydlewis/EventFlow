'use strict';

class MessengerTelemetryEmitter {
  constructor(options = {}) {
    this.sessionId = options.sessionId || `messenger-${Date.now().toString(36)}`;
    this.endpoint = options.endpoint || '/api/v1/telemetry/messenger';
    this.flushIntervalMs = Math.max(1000, Number(options.flushIntervalMs) || 30000);
    this.fetchImpl =
      options.fetchImpl ||
      (typeof window !== 'undefined' && typeof window.fetch === 'function'
        ? window.fetch.bind(window)
        : null);
    this.now = options.now || (() => Date.now());
    this.counters = {
      dupSeqDrops: 0,
      cmidReconciles: 0,
      maxGapSize: 0,
      timeToLiveMs: 0,
    };
    this.lastFlushAt = 0;
    this._pending = false;
  }

  record(partial = {}) {
    if (Number.isFinite(Number(partial.dupSeqDrops))) {
      this.counters.dupSeqDrops += Number(partial.dupSeqDrops);
      this._pending = true;
    }
    if (Number.isFinite(Number(partial.cmidReconciles))) {
      this.counters.cmidReconciles += Number(partial.cmidReconciles);
      this._pending = true;
    }
    if (Number.isFinite(Number(partial.maxGapSize))) {
      this.counters.maxGapSize = Math.max(this.counters.maxGapSize, Number(partial.maxGapSize));
      this._pending = true;
    }
    if (Number.isFinite(Number(partial.timeToLiveMs))) {
      this.counters.timeToLiveMs = Math.max(
        this.counters.timeToLiveMs,
        Number(partial.timeToLiveMs)
      );
      this._pending = true;
    }
  }

  canFlush() {
    return this.now() - this.lastFlushAt >= this.flushIntervalMs;
  }

  async flush(reason = 'manual') {
    if (!this._pending || !this.fetchImpl || !this.canFlush()) {
      return false;
    }
    const payload = {
      sessionId: this.sessionId,
      counters: { ...this.counters },
    };
    const ok = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      credentials: 'include',
      keepalive: reason === 'hidden',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(res => res && res.ok)
      .catch(() => false);
    if (!ok) {
      return false;
    }
    this.lastFlushAt = this.now();
    this._pending = false;
    this.counters = { dupSeqDrops: 0, cmidReconciles: 0, maxGapSize: 0, timeToLiveMs: 0 };
    return true;
  }
}

if (typeof window !== 'undefined') {
  window.MessengerTelemetryEmitter = MessengerTelemetryEmitter;
}

if (typeof module !== 'undefined') {
  module.exports = { MessengerTelemetryEmitter };
}
