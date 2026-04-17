'use strict';

const RECON_STATES = Object.freeze({
  IDLE: 'IDLE',
  CONNECTING: 'CONNECTING',
  CATCHING_UP: 'CATCHING_UP',
  LIVE: 'LIVE',
  DISCONNECTED: 'DISCONNECTED',
  RECONNECTING: 'RECONNECTING',
});

const RECON_TRANSITIONS = {
  [RECON_STATES.IDLE]: [RECON_STATES.CONNECTING],
  [RECON_STATES.CONNECTING]: [RECON_STATES.CATCHING_UP, RECON_STATES.DISCONNECTED],
  [RECON_STATES.CATCHING_UP]: [RECON_STATES.LIVE, RECON_STATES.DISCONNECTED],
  [RECON_STATES.LIVE]: [RECON_STATES.DISCONNECTED],
  [RECON_STATES.DISCONNECTED]: [RECON_STATES.RECONNECTING, RECON_STATES.CONNECTING],
  [RECON_STATES.RECONNECTING]: [RECON_STATES.CATCHING_UP, RECON_STATES.DISCONNECTED],
};

class ReconciliationFSM {
  constructor(initialState = RECON_STATES.IDLE) {
    this.state = initialState;
    this.listeners = new Set();
  }

  on(event, cb) {
    if (event !== 'state' || typeof cb !== 'function') {
      return () => {};
    }
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getState() {
    return this.state;
  }

  transition(nextState, meta = {}) {
    if (nextState === this.state) {
      return true;
    }
    const allowed = RECON_TRANSITIONS[this.state] || [];
    if (!allowed.includes(nextState)) {
      return false;
    }
    const previous = this.state;
    this.state = nextState;
    for (const listener of this.listeners) {
      try {
        listener(nextState, { previous, ...meta });
      } catch (_) {
        // noop
      }
    }
    return true;
  }
}

function dedupeMessages(existing, incoming) {
  const seqSeen = new Set();
  const clientIdSeen = new Set();
  const out = [];

  const pushUnique = msg => {
    if (!msg) {
      return;
    }
    const seqKey = Number.isFinite(Number(msg.seq)) ? Number(msg.seq) : null;
    const clientKey = typeof msg.clientMessageId === 'string' ? msg.clientMessageId : null;

    if (seqKey !== null && seqSeen.has(seqKey)) {
      return;
    }
    if (clientKey && clientIdSeen.has(clientKey)) {
      const idx = out.findIndex(x => x && x.clientMessageId === clientKey);
      if (idx >= 0 && msg._id) {
        out[idx] = { ...out[idx], ...msg };
      }
      return;
    }

    out.push(msg);
    if (seqKey !== null) {
      seqSeen.add(seqKey);
    }
    if (clientKey) {
      clientIdSeen.add(clientKey);
    }
  };

  (Array.isArray(existing) ? existing : []).forEach(pushUnique);
  (Array.isArray(incoming) ? incoming : []).forEach(pushUnique);

  out.sort((a, b) => {
    const as = Number.isFinite(Number(a?.seq)) ? Number(a.seq) : Number.MAX_SAFE_INTEGER;
    const bs = Number.isFinite(Number(b?.seq)) ? Number(b.seq) : Number.MAX_SAFE_INTEGER;
    if (as !== bs) {
      return as - bs;
    }
    return new Date(a?.createdAt || 0).getTime() - new Date(b?.createdAt || 0).getTime();
  });

  return out;
}

if (typeof window !== 'undefined') {
  window.ReconciliationFSM = ReconciliationFSM;
  window.RECON_STATES = RECON_STATES;
  window.dedupeMessagesV4 = dedupeMessages;
}

if (typeof module !== 'undefined') {
  module.exports = {
    ReconciliationFSM,
    RECON_STATES,
    dedupeMessages,
  };
}
