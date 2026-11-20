'use strict';

/**
 * A small in-memory stand-in for `dbUnified`, for tests of code that finds and changes records by
 * filter. It follows MongoDB's rules for the few things those tests rely on, so a query that
 * would not match in production does not match here either:
 *
 *  - a dotted path looks inside arrays, and matches when ANY element matches
 *    (`{'photosGallery.url': x}` finds a supplier with one such photo among many);
 *  - a plain value also matches an array that contains it;
 *  - `$or`, `$regex`, `$in`, `$ne` and `$exists`;
 *  - updates: `$set` (top-level fields), `$pull` of the elements that match a condition, and
 *    `$push` with `$each`.
 *
 * Anything else throws, so a test never passes because a filter or update was quietly ignored.
 * Updates change the stored documents in place, so code that removes a reference and then looks for
 * what still refers to it sees the removal.
 */

/** Every value found at a dotted path, looking inside arrays at each step (and at the end). */
function valuesAt(value, path) {
  if (Array.isArray(value)) {
    return value.flatMap(item => valuesAt(item, path));
  }
  if (path.length === 0) {
    return [value];
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }
  return valuesAt(value[path[0]], path.slice(1));
}

function matchesCondition(values, condition) {
  const isOperators =
    condition !== null && typeof condition === 'object' && !(condition instanceof RegExp);
  if (!isOperators) {
    return values.some(value => value === condition);
  }
  return Object.entries(condition).every(([operator, operand]) => {
    switch (operator) {
      case '$regex': {
        const pattern = new RegExp(operand, condition.$options || '');
        return values.some(value => typeof value === 'string' && pattern.test(value));
      }
      case '$options':
        return true;
      case '$in':
        return values.some(value => operand.includes(value));
      case '$ne':
        return !values.some(value => value === operand);
      case '$exists':
        return values.some(value => value !== undefined) === Boolean(operand);
      default:
        throw new Error(`mongo-style-db does not support the ${operator} operator`);
    }
  });
}

/** Whether a document matches a MongoDB-style filter. */
function matches(document, filter) {
  return Object.entries(filter || {}).every(([key, condition]) => {
    if (key === '$or') {
      return condition.some(branch => matches(document, branch));
    }
    return matchesCondition(valuesAt(document, key.split('.')), condition);
  });
}

function applyUpdate(document, update) {
  for (const [operator, fields] of Object.entries(update)) {
    for (const [field, operand] of Object.entries(fields)) {
      if (operator === '$set') {
        document[field] = operand;
      } else if (operator === '$pull') {
        // An object removes the elements it matches; anything else removes equal elements
        const removes =
          operand !== null && typeof operand === 'object'
            ? element =>
                element !== null && typeof element === 'object' && matches(element, operand)
            : element => element === operand;
        document[field] = (document[field] || []).filter(element => !removes(element));
      } else if (operator === '$push') {
        document[field] = [...(document[field] || []), ...(operand.$each || [operand])];
      } else {
        throw new Error(`mongo-style-db does not support the ${operator} update operator`);
      }
    }
  }
}

/**
 * @param {Object<string, Object[]>} collections - Documents by collection name. Copied, so a test
 *   that changes them does not change the fixture it started from.
 * @returns {{collections: Object, find: Function, findOne: Function, insertOne: Function,
 *   updateOne: Function}}
 */
function createMongoStyleDb(collections) {
  const store = JSON.parse(JSON.stringify(collections));
  const documents = name => {
    store[name] = store[name] || [];
    return store[name];
  };
  return {
    collections: store,
    // A copy, as a real database returns: code that edits what it read in memory must not change
    // what is stored, or its in-memory edit would be applied a second time.
    read: async name => JSON.parse(JSON.stringify(documents(name))),
    find: async (name, filter) => documents(name).filter(item => matches(item, filter)),
    // A copy, like `read`: code that edits the record it found (setting a status before it saves)
    // must not change what is stored until it actually saves
    findOne: async (name, filter) => {
      const found = documents(name).find(item => matches(item, filter));
      return found ? JSON.parse(JSON.stringify(found)) : null;
    },
    // Stores a copy, as a real database does, and answers the document (a falsy answer means it
    // was not saved)
    insertOne: async (name, document) => {
      documents(name).push(JSON.parse(JSON.stringify(document)));
      return document;
    },
    updateOne: async (name, filter, update) => {
      const document = documents(name).find(item => matches(item, filter));
      if (!document) {
        return false;
      }
      applyUpdate(document, update);
      return true;
    },
  };
}

module.exports = { createMongoStyleDb, matches };
