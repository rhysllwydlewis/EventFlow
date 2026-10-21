'use strict';

const { ObjectId } = require('mongodb');

// Fuller in-memory Mongo-compatible double (supports $elemMatch/$ne/$in/$or,
// dotted paths) — needed because the audit fixes use $elemMatch queries that
// the simpler double in messenger-v4-block-routes.test.js doesn't model.
function createInMemoryDb() {
  const store = {};

  function getCol(name) {
    if (!store[name]) {
      store[name] = [];
    }
    return store[name];
  }

  function matches(doc, query) {
    if (!query || Object.keys(query).length === 0) {
      return true;
    }
    for (const [key, value] of Object.entries(query)) {
      if (key === '$or') {
        if (!value.some(cond => matches(doc, cond))) {
          return false;
        }
        continue;
      }
      if (key === '$expr') {
        // Only the shape the routes use: { $eq: [{ $size: '$field' }, n] }.
        const [left, right] = value.$eq || [];
        const field = left?.$size;
        if (typeof field !== 'string' || !Array.isArray(doc[field.slice(1)])) {
          return false;
        }
        if (doc[field.slice(1)].length !== right) {
          return false;
        }
        continue;
      }
      if (key === '$and') {
        if (!value.every(cond => matches(doc, cond))) {
          return false;
        }
        continue;
      }
      let docVal;
      if (key.includes('.')) {
        // Like MongoDB, a path through an array looks at every element: "participants.userId"
        // is the list of the participants' user ids.
        docVal = key.split('.').reduce((o, k) => {
          if (o === null || o === undefined) {
            return undefined;
          }
          return Array.isArray(o) ? o.map(el => el?.[k]) : o[k];
        }, doc);
      } else {
        docVal = doc[key];
      }
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value instanceof ObjectId)
      ) {
        if ('$in' in value) {
          const vals = Array.isArray(docVal) ? docVal : [docVal];
          if (!value.$in.some(v => vals.some(d => String(d) === String(v)))) {
            return false;
          }
          continue;
        }
        if ('$all' in value) {
          const vals = Array.isArray(docVal) ? docVal : [docVal];
          if (!value.$all.every(v => vals.some(d => String(d) === String(v)))) {
            return false;
          }
          continue;
        }
        if ('$ne' in value) {
          if (String(docVal) === String(value.$ne)) {
            return false;
          }
          continue;
        }
        if ('$elemMatch' in value) {
          if (!Array.isArray(docVal) || !docVal.some(el => matches(el, value.$elemMatch))) {
            return false;
          }
          continue;
        }
        if ('$regex' in value) {
          const re = new RegExp(value.$regex, value.$options || '');
          const vals = Array.isArray(docVal) ? docVal : [docVal];
          if (!vals.some(v => re.test(v))) {
            return false;
          }
          continue;
        }
      }
      if (value instanceof RegExp) {
        const vals = Array.isArray(docVal) ? docVal : [docVal];
        if (!vals.some(v => v !== null && v !== undefined && value.test(String(v)))) {
          return false;
        }
        continue;
      }
      const docStr = String(docVal);
      const valStr = String(value);
      if (Array.isArray(docVal)) {
        if (!docVal.some(d => String(d) === valStr)) {
          return false;
        }
      } else if (docStr !== valStr && docVal !== value) {
        return false;
      }
    }
    return true;
  }

  function applyUpdate(doc, update) {
    if (update.$set) {
      for (const [path, val] of Object.entries(update.$set)) {
        if (path.includes('.')) {
          const parts = path.split('.');
          let target = doc;
          for (let i = 0; i < parts.length - 1; i++) {
            if (target[parts[i]] === null || target[parts[i]] === undefined) {
              target[parts[i]] = isNaN(Number(parts[i + 1])) ? {} : [];
            }
            target = target[parts[i]];
          }
          target[parts[parts.length - 1]] = val;
        } else {
          doc[path] = val;
        }
      }
    }
    return doc;
  }

  function makeCollection(name) {
    return {
      async insertOne(doc) {
        const newDoc = { _id: doc._id || new ObjectId(), ...doc };
        getCol(name).push(newDoc);
        return { insertedId: newDoc._id, acknowledged: true };
      },
      async insertMany(docs) {
        docs.forEach(doc => getCol(name).push({ _id: doc._id || new ObjectId(), ...doc }));
        return { acknowledged: true };
      },
      async findOne(query) {
        return getCol(name).find(doc => matches(doc, query)) || null;
      },
      find(query) {
        const items = getCol(name).filter(doc => matches(doc, query || {}));
        const cursor = {
          sort: () => cursor,
          skip: () => cursor,
          limit: () => cursor,
          project: () => cursor,
          async toArray() {
            return items;
          },
        };
        return cursor;
      },
      async updateOne(filter, update) {
        const idx = getCol(name).findIndex(doc => matches(doc, filter));
        if (idx === -1) {
          return { matchedCount: 0, modifiedCount: 0 };
        }
        applyUpdate(getCol(name)[idx], update);
        return { matchedCount: 1, modifiedCount: 1 };
      },
      async countDocuments(query) {
        return getCol(name).filter(doc => matches(doc, query || {})).length;
      },
      async createIndex() {
        return 'ok';
      },
      async bulkWrite(operations) {
        for (const op of operations) {
          if (op.updateOne) {
            const idx = getCol(name).findIndex(doc => matches(doc, op.updateOne.filter));
            if (idx !== -1) {
              applyUpdate(getCol(name)[idx], op.updateOne.update);
            }
          }
        }
        return { ok: 1 };
      },
    };
  }

  return { collection: makeCollection };
}

module.exports = { createInMemoryDb };
