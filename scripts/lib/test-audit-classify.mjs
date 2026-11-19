// Decides which kind of problem a failing audit check most likely is.
//
// The rules are an ordered table: the first one that matches wins, so the order is part of
// the behaviour (a timeout notice beats a mention of "browser" in the same log, for example).
// Kept in its own module so tests/unit/test-audit-classify.test.js can check every rule and
// the order without running the audit.

export const ENVIRONMENT_MARKERS = [
  'unsupported node.js version',
  'node 20',
  'already used',
  'chromium',
  'browser',
  'mongodb',
  'econnrefused',
  'missing required environment',
  'environment variable',
  'not set',
];

function includesAny(text, markers) {
  return markers.some(marker => text.includes(marker));
}

// The first matching rule wins, so the order is part of the behaviour.
export const CLASSIFICATION_RULES = [
  {
    category: 'Audit runner timeout / incomplete result',
    matches: (check, text) =>
      includesAny(text, ['[test audit] command timed out', 'timed out after']),
  },
  { category: 'Code quality', matches: check => check.id === 'lint' },
  {
    category: 'Formatting/style issue',
    matches: (check, text) =>
      check.id === 'format-check' || includesAny(text, ['prettier', 'code style issues']),
  },
  { category: 'Snapshot/visual drift', matches: check => check.id.includes('visual') },
  {
    category: 'Dependency/security warning',
    matches: (check, text) => check.id === 'npm-audit' || text.includes('vulnerab'),
  },
  {
    category: 'Coverage threshold issue',
    matches: (check, text) => text.includes('coverage threshold'),
  },
  {
    category: 'Environment/config issue',
    matches: (check, text) => includesAny(text, ENVIRONMENT_MARKERS),
  },
  {
    category: 'Stale test expectation',
    matches: (check, text) => includesAny(text, ['expect(received)', 'expected substring']),
  },
  {
    category: 'Audit runner timeout / incomplete result',
    matches: (check, text) => includesAny(text, ['timeout', 'timed out']),
  },
  {
    category: 'Real product regression',
    matches: (check, text) => check.id.includes('security') || includesAny(text, ['csrf', 'auth']),
  },
];

export function classify(check, output) {
  const text = output.toLowerCase();
  const rule = CLASSIFICATION_RULES.find(candidate => candidate.matches(check, text));
  return rule ? rule.category : 'Unknown/manual review required';
}
