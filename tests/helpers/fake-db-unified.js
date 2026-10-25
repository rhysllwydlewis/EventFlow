'use strict';

/**
 * In-memory stand-in for db-unified, shaped like the MongoDB-backed behaviour the
 * supplier dashboard relies on. Supports the query features the code under test
 * uses: equality, dotted paths through arrays (`participants.userId`), $gte $gt
 * $lt $lte $ne $in $elemMatch, and the one aggregation shape the engagement
 * metrics use ($match then $group with a compound _id and $min). Reads AND writes honour
 * `__failOn(collection)` and `{ throwOnError: true }` the way db-unified does, and updateOne
 * answers a boolean (true only when something changed).
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
  failing = new Set();
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
    if (key === '$or') {
      return condition.some(branch => matches(row, branch));
    }
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

let failing = new Set();

/**
 * Make every read on the named collections fail, to simulate a database outage.
 *
 * @param {...string} names - Collection names
 * @returns {void}
 */
function __failOn(...names) {
  failing = new Set(names);
}

/**
 * Wrap a read the way the real db-unified does: a failed query is logged and
 * swallowed (empty result) UNLESS the caller passed `{ throwOnError: true }`.
 * A test double that always threw would hide code that forgot to ask for errors.
 *
 * @param {*} emptyValue - What a swallowed failure returns ([] / 0 / null)
 * @param {Function} run - The query, called with (name, secondArg)
 * @returns {Function} Async db-unified style function
 */
function realisticRead(emptyValue, run) {
  return async (name, second, options) => {
    try {
      if (failing.has(name)) {
        throw new Error(`fake db failure on ${name}`);
      }
      return await run(name, second, options || {});
    } catch (error) {
      if (options && options.throwOnError) {
        throw error;
      }
      return emptyValue;
    }
  };
}

/**
 * Wrap a write the same way: a collection named in `__failOn` fails it; the failure is swallowed
 * (`emptyValue` returned) unless the caller passed `{ throwOnError: true }` as the last argument.
 *
 * @param {*} emptyValue - What a swallowed failure returns (null / false)
 * @param {Function} run - The write, called with the original arguments
 * @returns {Function} Async db-unified style function
 */
function realisticWrite(emptyValue, run) {
  return async (...args) => {
    const last = args[args.length - 1];
    const throwOnError = Boolean(last && typeof last === 'object' && last.throwOnError);
    try {
      if (failing.has(args[0])) {
        throw new Error(`fake db failure on ${args[0]}`);
      }
      return await run(...args);
    } catch (error) {
      if (throwOnError) {
        throw error;
      }
      return emptyValue;
    }
  };
}

/**
 * Minimal aggregation: $match, then $group with a compound _id and $min, or $project (inclusion).
 *
 * @param {Object[]} rows - Source rows
 * @param {Object[]} pipeline - Pipeline stages
 * @returns {Object[]} Result rows
 */
function aggregateRows(rows, pipeline) {
  let current = rows;
  pipeline.forEach(stage => {
    if (stage.$match) {
      current = current.filter(row => matches(row, stage.$match));
    } else if (stage.$project) {
      current = current.map(row => {
        const out = {};
        Object.entries(stage.$project).forEach(([field, include]) => {
          if (include) {
            out[field] = row[field];
          }
        });
        return out;
      });
    } else if (stage.$sort) {
      current = sorted(current, stage.$sort);
    } else if (stage.$limit) {
      current = current.slice(0, stage.$limit);
    } else if (stage.$group) {
      const idSpec = stage.$group._id;
      const groups = new Map();
      current.forEach(row => {
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
      current = [...groups.values()].map(group => {
        const out = { _id: group._id };
        Object.entries(stage.$group).forEach(([field, expr]) => {
          if (field !== '_id') {
            const operand = Object.values(expr)[0].slice(1);
            out[field] = new Date(Math.min(...group.rows.map(row => comparable(row[operand]))));
          }
        });
        return out;
      });
    } else {
      throw new Error('fake-db-unified: unsupported aggregation stage');
    }
  });
  return current;
}

const fake = {
  __reset,
  __failOn,
  __store: () => store,
  getDatabaseType: jest.fn(() => 'mongodb'),
  // read(name, options): its options are the second argument, unlike find/count (filter, options).
  read: jest.fn((name, options) =>
    realisticRead([], async () => rowsOf(name).map(row => ({ ...row })))(name, undefined, options)
  ),
  find: jest.fn(
    realisticRead([], async (name, filter) =>
      rowsOf(name).filter(row => matches(row, filter || {}))
    )
  ),
  findOne: jest.fn(
    realisticRead(
      null,
      async (name, filter) => rowsOf(name).find(row => matches(row, filter || {})) || null
    )
  ),
  findWithOptions: jest.fn(
    realisticRead([], async (name, filter, options) => {
      const { limit = 50, skip = 0, sort = {} } = options;
      return sorted(
        rowsOf(name).filter(row => matches(row, filter || {})),
        sort
      ).slice(skip, skip + limit);
    })
  ),
  count: jest.fn(
    realisticRead(
      0,
      async (name, filter) => rowsOf(name).filter(row => matches(row, filter || {})).length
    )
  ),
  insertOne: jest.fn(
    realisticWrite(null, async (name, document, options = {}) => {
      // Mirrors the unique partial index on events.dedupeKey (MongoDB duplicate-key error 11000).
      if (
        name === 'events' &&
        typeof document.dedupeKey === 'string' &&
        rowsOf(name).some(row => row.dedupeKey === document.dedupeKey)
      ) {
        if (options.throwOnError) {
          throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
        }
        return null;
      }
      rowsOf(name).push({ ...document });
      return document;
    })
  ),
  // Like db-unified.updateOne: true only when a document was actually modified (a match whose
  // values were already stored is false), and a failure is swallowed unless throwOnError is set.
  updateOne: jest.fn(
    realisticWrite(false, async (name, filter, update) => {
      const row = rowsOf(name).find(item => matches(item, filter));
      if (!row) {
        return false;
      }
      const before = JSON.stringify(row);
      if (update.$set) {
        for (const [key, value] of Object.entries(update.$set)) {
          // 'a.b' sets b inside a, as MongoDB and db-unified's local store do.
          const path = key.split('.');
          const last = path.pop();
          let cursor = row;
          for (const segment of path) {
            if (!cursor[segment] || typeof cursor[segment] !== 'object') {
              cursor[segment] = {};
            }
            cursor = cursor[segment];
          }
          cursor[last] = value;
        }
      }
      return JSON.stringify(row) !== before;
    })
  ),
  upsertOne: jest.fn(async (name, filter, fields, onInsert = {}) => {
    const row = rowsOf(name).find(item => matches(item, filter));
    if (row) {
      Object.assign(row, fields);
    } else {
      rowsOf(name).push({ ...filter, ...onInsert, ...fields });
    }
    return true;
  }),
  // Mirrors db-unified.incrementCounter: one step, returns the new total (the real one is atomic).
  incrementCounter: jest.fn(
    realisticWrite(null, async (name, key, options = {}) => {
      const row = rowsOf(name).find(item => item.key === key);
      const by = Number.isFinite(options.by) ? options.by : 1;
      if (row) {
        row.count += by;
        return row.count;
      }
      rowsOf(name).push({
        key,
        count: by,
        ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
      });
      return by;
    })
  ),
  deleteOne: jest.fn(
    realisticWrite(false, async (name, filter) => {
      const rows = rowsOf(name);
      const index = rows.findIndex(row => matches(row, filter));
      if (index === -1) {
        return false;
      }
      rows.splice(index, 1);
      return true;
    })
  ),
  aggregate: jest.fn(
    realisticRead([], async (name, pipeline) => aggregateRows(rowsOf(name), pipeline))
  ),
};

module.exports = fake;
