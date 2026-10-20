'use strict';

/**
 * In-memory stand-in for db-unified, shaped like the MongoDB-backed behaviour the
 * supplier dashboard relies on. Supports the query features the code under test
 * uses: equality, dotted paths through arrays (`participants.userId`), $gte $gt
 * $lt $lte $ne $in $elemMatch, and the one aggregation shape the engagement
 * metrics use ($match then $group with a compound _id and $min).
 *
 * Use as: jest.mock('../../db-unified', () => require('../helpers/fake-db-unified'));
 * and call __reset(seed) in beforeEach.
 */

let store = {};

/**
 * Replace the whole store.
 *
 * @param {Object} [seed] - Map of collection name to rows
 * @returns {void}
 */
function __reset(seed = {}) {
  store = {};
  Object.entries(seed).forEach(([name, rows]) => {
    store[name] = rows.map(row => ({ ...row }));
  });
}

/**
 * Rows of a collection (created on first use).
 *
 * @param {string} name - Collection name
 * @returns {Object[]} Live rows array
 */
function rowsOf(name) {
  if (!store[name]) {
    store[name] = [];
  }
  return store[name];
}

/**
 * Collect every value a dotted path can resolve to, walking through arrays the
 * way MongoDB does.
 *
 * @param {*} value - Current value
 * @param {string[]} segments - Remaining path segments
 * @returns {Array} Candidate values
 */
function valuesAt(value, segments) {
  if (segments.length === 0) {
    return Array.isArray(value) ? [value, ...value] : [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(item => valuesAt(item, segments));
  }
  if (value === null || value === undefined || typeof value !== 'object') {
    return [undefined];
  }
  return valuesAt(value[segments[0]], segments.slice(1));
}

/**
 * Normalise a comparable value (Dates compare by time).
 *
 * @param {*} value - Any value
 * @returns {*} Comparable primitive
 */
function comparable(value) {
  return value instanceof Date ? value.getTime() : value;
}

/**
 * Evaluate one operator expression against a single candidate value.
 *
 * @param {*} candidate - Value from the row
 * @param {Object} condition - Operator object such as { $gte: x }
 * @returns {boolean} Whether the candidate satisfies every operator
 */
function operatorsMatch(candidate, condition) {
  return Object.entries(condition).every(([operator, operand]) => {
    const left = comparable(candidate);
    const right = comparable(operand);
    switch (operator) {
      case '$gte':
        return left !== undefined && left !== null && left >= right;
      case '$gt':
        return left !== undefined && left !== null && left > right;
      case '$lt':
        return left !== undefined && left !== null && left < right;
      case '$lte':
        return left !== undefined && left !== null && left <= right;
      case '$ne':
        return left !== right;
      case '$in':
        return operand.map(comparable).includes(left);
      default:
        throw new Error(`fake-db-unified: unsupported operator ${operator}`);
    }
  });
}

/**
 * Whether a row matches a Mongo-style filter.
 *
 * @param {Object} row - Stored row
 * @param {Object} filter - Filter document
 * @returns {boolean} Match result
 */
function matches(row, filter) {
  return Object.entries(filter).every(([key, condition]) => {
    const candidates = valuesAt(row, key.split('.'));
    const isOperatorObject =
      condition !== null &&
      typeof condition === 'object' &&
      !Array.isArray(condition) &&
      !(condition instanceof Date) &&
      Object.keys(condition).some(name => name.startsWith('$'));

    if (isOperatorObject && '$elemMatch' in condition) {
      return candidates.some(
        candidate =>
          Array.isArray(candidate) && candidate.some(item => matches(item, condition.$elemMatch))
      );
    }
    if (isOperatorObject) {
      // $ne must hold for every candidate (a missing field satisfies $ne: true).
      if (Object.keys(condition).length === 1 && '$ne' in condition) {
        return candidates.every(candidate => operatorsMatch(candidate, condition));
      }
      return candidates.some(candidate => operatorsMatch(candidate, condition));
    }
    return candidates.some(candidate => comparable(candidate) === comparable(condition));
  });
}

/**
 * Sort rows by a Mongo sort spec.
 *
 * @param {Object[]} rows - Rows (copied, not mutated)
 * @param {Object} sort - Sort spec such as { createdAt: -1 }
 * @returns {Object[]} Sorted copy
 */
function sorted(rows, sort) {
  const entries = Object.entries(sort || {});
  return [...rows].sort((first, second) => {
    for (const [field, direction] of entries) {
      const left = comparable(first[field]);
      const right = comparable(second[field]);
      if (left < right) {
        return -direction;
      }
      if (left > right) {
        return direction;
      }
    }
    return 0;
  });
}

const fake = {
  __reset,
  __store: () => store,
  read: jest.fn(async name => rowsOf(name).map(row => ({ ...row }))),
  find: jest.fn(async (name, filter = {}) => rowsOf(name).filter(row => matches(row, filter))),
  findOne: jest.fn(
    async (name, filter = {}) => rowsOf(name).find(row => matches(row, filter)) || null
  ),
  findWithOptions: jest.fn(async (name, filter = {}, options = {}) => {
    const { limit = 50, skip = 0, sort = {} } = options;
    return sorted(
      rowsOf(name).filter(row => matches(row, filter)),
      sort
    ).slice(skip, skip + limit);
  }),
  count: jest.fn(
    async (name, filter = {}) => rowsOf(name).filter(row => matches(row, filter)).length
  ),
  insertOne: jest.fn(async (name, document) => {
    rowsOf(name).push({ ...document });
    return document;
  }),
  updateOne: jest.fn(async (name, filter, update) => {
    const row = rowsOf(name).find(item => matches(item, filter));
    if (row && update.$set) {
      Object.assign(row, update.$set);
    }
    return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
  }),
  aggregate: jest.fn(async (name, pipeline) => {
    const [matchStage, groupStage] = pipeline;
    const filtered = rowsOf(name).filter(row => matches(row, matchStage.$match));
    const idSpec = groupStage.$group._id;
    const groups = new Map();
    filtered.forEach(row => {
      const id = {};
      Object.entries(idSpec).forEach(([outKey, ref]) => {
        id[outKey] = row[ref.slice(1)];
      });
      const key = JSON.stringify(
        Object.values(id).map(value => (value && value.toString ? value.toString() : value))
      );
      if (!groups.has(key)) {
        groups.set(key, { _id: id, rows: [] });
      }
      groups.get(key).rows.push(row);
    });
    return [...groups.values()].map(group => {
      const out = { _id: group._id };
      Object.entries(groupStage.$group).forEach(([field, expr]) => {
        if (field === '_id') {
          return;
        }
        const operand = Object.values(expr)[0].slice(1);
        const values = group.rows.map(row => row[operand]).map(comparable);
        out[field] = new Date(Math.min(...values));
      });
      return out;
    });
  }),
};

module.exports = fake;
