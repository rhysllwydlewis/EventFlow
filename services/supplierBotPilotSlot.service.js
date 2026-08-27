'use strict';

const PILOT_SLOT_ID = 'supplier-bot-one-profile-pilot-v1';
const PILOT_SLOT_COLLECTION = 'supplier_bot_pilot_slots';

function pilotLimitError(existingSupplierId = null) {
  const error = new Error('The one-profile Supplier Bot pilot is already in use');
  error.code = 'SUPPLIER_BOT_PILOT_LIMIT';
  error.supplierId = existingSupplierId;
  return error;
}

function findPilotSlot(records) {
  return (records || []).find(
    record => record && (record._id === PILOT_SLOT_ID || record.id === PILOT_SLOT_ID)
  );
}

async function reserveSupplierBotPilotSlot({ dbUnified, candidateId }) {
  if (!dbUnified) {
    throw new Error('Database unavailable');
  }
  if (!candidateId || typeof candidateId !== 'string') {
    throw new Error('candidateId is required');
  }

  const current = await dbUnified.read(PILOT_SLOT_COLLECTION);
  const existing = findPilotSlot(current);
  if (existing) {
    if (existing.candidateId === candidateId) {
      return { slot: existing, created: false, idempotent: true };
    }
    throw pilotLimitError(existing.supplierId || null);
  }

  const now = new Date().toISOString();
  const slot = {
    _id: PILOT_SLOT_ID,
    id: PILOT_SLOT_ID,
    candidateId,
    supplierId: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await dbUnified.insertOne(PILOT_SLOT_COLLECTION, slot);
    return { slot, created: true, idempotent: false };
  } catch (error) {
    // MongoDB's built-in unique _id index makes this reservation atomic across
    // multiple EventFlow processes. A concurrent contender must reread the
    // winning slot rather than relying on a read-then-write check.
    if (error && error.code === 11000) {
      const afterConflict = await dbUnified.read(PILOT_SLOT_COLLECTION);
      const winner = findPilotSlot(afterConflict);
      if (winner?.candidateId === candidateId) {
        return { slot: winner, created: false, idempotent: true };
      }
      throw pilotLimitError(winner?.supplierId || null);
    }
    throw error;
  }
}

async function attachSupplierToPilotSlot({ dbUnified, candidateId, supplierId }) {
  if (!dbUnified || !candidateId || !supplierId) {
    return false;
  }
  const updatedAt = new Date().toISOString();
  return dbUnified.updateOne(
    PILOT_SLOT_COLLECTION,
    { _id: PILOT_SLOT_ID, candidateId },
    { $set: { supplierId, updatedAt } }
  );
}

module.exports = {
  PILOT_SLOT_COLLECTION,
  PILOT_SLOT_ID,
  attachSupplierToPilotSlot,
  reserveSupplierBotPilotSlot,
};
