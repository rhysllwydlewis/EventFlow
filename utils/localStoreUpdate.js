'use strict';

const { isDeepStrictEqual } = require('util');

/**
 * MongoDB-style update operators for the local file-store fallback in
 * `db-unified.js` (used when `MONGODB_URI` is unset).
 *
 * The local store used to apply only `$set` and `$unset` and silently ignore every
 * other operator, so `{ $push: ... }`, `{ $pull: ... }`, `{ $addToSet: ... }` and
 * `{ $inc: ... }` reported success and changed nothing outside MongoDB. That made
 * it unsafe to write code against the atomic operators at all, which is why the
 * supplier gallery routes kept reading a whole array, editing it and writing it
 * back (losing a photo when two requests overlap).
 *
 * Supported: $set (dotted paths), $unset (dotted paths), $inc, $push (with $each),
 * $addToSet (with $each) and $pull (value, document condition, or operator
 * condition). Anything else is logged and ignored, as before.
 *
 * Writes go through `applyDotPathSet`, so the prototype-pollution protection that
 * covers `$set` covers the computed values here too.
 */

const SUPPORTED_OPERATORS = Object.freeze([
  '$set',
  '$unset',
  '$inc',
  '$push',
  '$addToSet',
  '$pull',
]);

const isPlainObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

const isOperatorObject = value =>
  isPlainObject(value) &&
  Object.keys(value).length > 0 &&
  Object.keys(value).every(key => key.startsWith('$'));

/** The values a `$push` / `$addToSet` spec adds: `{ $each: [...] }` or a single value. */
function valuesToAdd(spec) {
  if (isPlainObject(spec) && Array.isArray(spec.$each)) {
    return spec.$each;
  }
  return [spec];
}

function readArray(doc, path, operator, getNestedValue) {
  const current = getNestedValue(doc, path);
  if (current === undefined) {
    return null;
  }
  if (!Array.isArray(current)) {
    // MongoDB rejects these too; failing loudly beats silently dropping the write.
    throw new TypeError(`${operator} requires "${path}" to be an array`);
  }
  return current;
}

/** Remove `path` from `target`, which is a fresh copy that is safe to mutate. */
function unsetPath(target, path) {
  // A literal key (the behaviour before dotted-path support) is removed as well.
  delete target[path];
  if (!path.includes('.')) {
    return;
  }
  const segments = path.split('.');
  let cursor = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const next = Object.prototype.hasOwnProperty.call(cursor, segments[index])
      ? cursor[segments[index]]
      : undefined;
    if (!isPlainObject(next)) {
      return;
    }
    cursor = next;
  }
  delete cursor[segments[segments.length - 1]];
}

/**
 * Apply an update document to one local-store document.
 *
 * @param {Object} doc The stored document. Never mutated.
 * @param {Object} updates An update document, for example `{ $push: { notes: n } }`.
 * @param {Object} helpers Functions owned by db-unified.js.
 * @param {Function} helpers.applyDotPathSet Returns a copy of a document with dotted-path writes applied.
 * @param {Function} helpers.getNestedValue Reads a dotted path.
 * @param {Function} helpers.matchesFilter Evaluates a MongoDB-style filter against a document.
 * @param {Object} [helpers.logger] Used to report unsupported operators.
 * @returns {Object} A new document.
 */
function applyLocalUpdate(doc, updates, helpers) {
  const { applyDotPathSet, getNestedValue, matchesFilter, logger } = helpers;
  const spec = updates || {};

  // A copy first, so nothing below can mutate the stored document.
  let next = applyDotPathSet(doc, spec.$set || {});

  for (const operator of Object.keys(spec)) {
    if (!SUPPORTED_OPERATORS.includes(operator) && logger && logger.warn) {
      logger.warn(`Unsupported update operator in local store (ignored): ${operator}`);
    }
  }

  if (isPlainObject(spec.$unset)) {
    for (const path of Object.keys(spec.$unset)) {
      unsetPath(next, path);
    }
  }

  if (isPlainObject(spec.$inc)) {
    for (const [path, by] of Object.entries(spec.$inc)) {
      if (typeof by !== 'number' || Number.isNaN(by)) {
        throw new TypeError(`$inc requires a numeric amount for "${path}"`);
      }
      const current = getNestedValue(next, path);
      if (current !== undefined && typeof current !== 'number') {
        throw new TypeError(`$inc requires "${path}" to be a number`);
      }
      next = applyDotPathSet(next, { [path]: (current === undefined ? 0 : current) + by });
    }
  }

  if (isPlainObject(spec.$push)) {
    for (const [path, value] of Object.entries(spec.$push)) {
      const current = readArray(next, path, '$push', getNestedValue) || [];
      next = applyDotPathSet(next, { [path]: [...current, ...valuesToAdd(value)] });
    }
  }

  if (isPlainObject(spec.$addToSet)) {
    for (const [path, value] of Object.entries(spec.$addToSet)) {
      const result = [...(readArray(next, path, '$addToSet', getNestedValue) || [])];
      for (const candidate of valuesToAdd(value)) {
        if (!result.some(existing => isDeepStrictEqual(existing, candidate))) {
          result.push(candidate);
        }
      }
      next = applyDotPathSet(next, { [path]: result });
    }
  }

  if (isPlainObject(spec.$pull)) {
    for (const [path, condition] of Object.entries(spec.$pull)) {
      const current = readArray(next, path, '$pull', getNestedValue);
      if (current === null) {
        continue; // nothing to pull from
      }
      const matches = element => {
        if (isOperatorObject(condition)) {
          return matchesFilter({ value: element }, { value: condition });
        }
        if (isPlainObject(condition) && isPlainObject(element)) {
          return matchesFilter(element, condition);
        }
        return isDeepStrictEqual(element, condition);
      };
      next = applyDotPathSet(next, { [path]: current.filter(element => !matches(element)) });
    }
  }

  return next;
}

module.exports = { applyLocalUpdate, SUPPORTED_OPERATORS };
