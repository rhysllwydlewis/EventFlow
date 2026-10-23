'use strict';

/**
 * A very small describe / test / expect for scripts that run outside Jest (a child process, where
 * jsdom can be loaded). `run()` executes every test in order and returns { name: { ok, error } },
 * which the Jest file that spawned the script turns into one Jest test per entry.
 */

const assert = require('assert');

const suites = [];
const tests = [];

function describe(name, body) {
  suites.push(name);
  body();
  suites.pop();
}

function test(name, fn) {
  tests.push({ name: [...suites, name].join(' › '), fn });
}

function matchers(actual, negate) {
  const check = (pass, message) => {
    if (negate ? pass : !pass) {
      throw new assert.AssertionError({ message: `${negate ? 'not ' : ''}${message}` });
    }
  };
  const show = value => JSON.stringify(value);
  const includes = (haystack, needle) =>
    typeof haystack === 'string'
      ? haystack.includes(needle)
      : Array.isArray(haystack) && haystack.includes(needle);
  return {
    toBe: expected =>
      check(Object.is(actual, expected), `expected ${show(actual)} to be ${show(expected)}`),
    toEqual: expected => {
      let same = true;
      try {
        assert.deepStrictEqual(actual, expected);
      } catch {
        same = false;
      }
      check(same, `expected ${show(actual)} to equal ${show(expected)}`);
    },
    toContain: expected =>
      check(includes(actual, expected), `expected ${show(actual)} to contain ${show(expected)}`),
    toMatch: expected =>
      check(expected.test(String(actual)), `expected ${show(actual)} to match ${expected}`),
    toHaveLength: expected =>
      check(
        actual !== null && actual !== undefined && actual.length === expected,
        `expected length ${actual && actual.length} to be ${expected}`
      ),
    toBeTruthy: () => check(Boolean(actual), `expected ${show(actual)} to be truthy`),
  };
}

function expect(actual) {
  return { ...matchers(actual, false), not: matchers(actual, true) };
}

async function run() {
  const results = {};
  for (const { name, fn } of tests) {
    try {
      await fn();
      results[name] = { ok: true };
    } catch (error) {
      results[name] = { ok: false, error: String(error && error.stack ? error.stack : error) };
    }
  }
  return results;
}

module.exports = { describe, test, expect, run };
