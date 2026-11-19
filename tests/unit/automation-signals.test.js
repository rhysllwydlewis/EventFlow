'use strict';

const {
  CODEX_REVIEW_BOT,
  DEGRADED_REVIEW_LABEL,
  DEGRADED_REVIEW_MARKER,
  buildDegradedReviewComment,
  checkPullRequestDescription,
  detectDegradedCodeScanning,
  detectDegradedCodexReview,
  flagDegradedReview,
} = require('../../scripts/lib/automation-signals');

const CODEX_NOTICE =
  'You have reached your Codex usage limits for code reviews. You can see your limits in the Codex usage dashboard.';

describe('detectDegradedCodexReview', () => {
  it('flags the usage-limit notice from the Codex bot', () => {
    expect(detectDegradedCodexReview({ login: CODEX_REVIEW_BOT, body: CODEX_NOTICE })).toEqual({
      source: 'codex',
      summary: expect.stringContaining('usage limit'),
    });
  });

  it('does not flag a real Codex review', () => {
    expect(
      detectDegradedCodexReview({
        login: CODEX_REVIEW_BOT,
        body: 'Codex Review: Didn’t find any major issues. Swish!',
      })
    ).toBeNull();
  });

  it('ignores the same words from anyone else, so a person quoting it cannot trigger it', () => {
    expect(detectDegradedCodexReview({ login: 'rhysllwydlewis', body: CODEX_NOTICE })).toBeNull();
    expect(detectDegradedCodexReview({ login: 'some-bot[bot]', body: CODEX_NOTICE })).toBeNull();
  });

  it('copes with missing input', () => {
    expect(detectDegradedCodexReview()).toBeNull();
    expect(detectDegradedCodexReview({ login: CODEX_REVIEW_BOT })).toBeNull();
  });
});

describe('detectDegradedCodeScanning', () => {
  const crash =
    'SessionModelError: CAPIError: 400 The requested model is not supported. at createSession';

  it('flags a crash found in the job log, because the check output itself is empty', () => {
    const signal = detectDegradedCodeScanning({
      name: 'github-advanced-security',
      conclusion: 'failure',
      outputText: '',
      logText: `starting\n${crash}\nexit 1`,
      logsAvailable: true,
    });
    expect(signal).toEqual({
      source: 'code-scanning',
      summary: expect.stringContaining('crashed'),
    });
  });

  it('does not flag a failure whose log shows a real finding', () => {
    expect(
      detectDegradedCodeScanning({
        name: 'github-advanced-security',
        conclusion: 'failure',
        logText: 'Found 2 issues: js/xss in routes/x.js',
        logsAvailable: true,
      })
    ).toBeNull();
  });

  it('flags an empty failure when the log cannot be read, and says why', () => {
    const signal = detectDegradedCodeScanning({
      name: 'github-advanced-security',
      conclusion: 'failure',
      outputText: '  ',
      logsAvailable: false,
    });
    expect(signal.summary).toMatch(/log could not be read/);
  });

  it('does not guess when the log cannot be read but the check did report something', () => {
    expect(
      detectDegradedCodeScanning({
        name: 'github-advanced-security',
        conclusion: 'failure',
        outputText: '2 alerts found',
        logsAvailable: false,
      })
    ).toBeNull();
  });

  it('ignores passing checks and other checks', () => {
    expect(
      detectDegradedCodeScanning({ name: 'github-advanced-security', conclusion: 'success' })
    ).toBeNull();
    expect(
      detectDegradedCodeScanning({ name: 'CodeQL', conclusion: 'failure', logText: crash })
    ).toBeNull();
  });
});

describe('buildDegradedReviewComment', () => {
  it('carries the marker, every signal, and what to do', () => {
    const body = buildDegradedReviewComment([
      { source: 'codex', summary: 'Codex did not review.' },
      { source: 'code-scanning', summary: 'Scanning crashed.' },
    ]);
    expect(body.startsWith(DEGRADED_REVIEW_MARKER)).toBe(true);
    expect(body).toContain('- Codex did not review.');
    expect(body).toContain('- Scanning crashed.');
    expect(body).toMatch(/review the whole diff cold/);
    expect(body).toContain(DEGRADED_REVIEW_LABEL);
  });
});

describe('checkPullRequestDescription', () => {
  const code = ['routes/a.js', 'public/assets/js/b.js'];

  it('accepts an ordinary description', () => {
    expect(checkPullRequestDescription({ body: 'Fixes the gallery race.', files: code })).toEqual({
      ok: true,
      problems: [],
    });
  });

  describe('do not merge', () => {
    it.each([
      'This PR will stay open — do not merge yet.',
      'Do not merge until the migration has run.',
      'Don’t merge: waiting on legal.',
      "don't merge",
      'Not ready to merge.',
      'Keep this PR open for review.',
    ])('flags %j on a ready pull request', body => {
      const result = checkPullRequestDescription({ body, files: code, draft: false });
      expect(result.ok).toBe(false);
      expect(result.problems.map(p => p.code)).toEqual(['do_not_merge']);
    });

    it('accepts it on a draft, which cannot be merged', () => {
      expect(
        checkPullRequestDescription({ body: 'Do not merge yet.', files: code, draft: true }).ok
      ).toBe(true);
    });

    it('does not flag the words inside code, quotes or comments', () => {
      const body = [
        'Reworded the old banner.',
        '> Do not merge until approved (quoted from the old description)',
        'The flag is `do not merge` in the label list.',
        '```',
        'do not merge',
        '```',
        '<!-- do not merge -->',
      ].join('\n');
      expect(checkPullRequestDescription({ body, files: code }).ok).toBe(true);
    });
  });

  describe('documentation-only claims', () => {
    it.each([
      'This is a docs-only PR.',
      'Documentation only.',
      'Docs only change',
      'It touches one markdown file.',
      'No code changes.',
    ])('flags %j when code changed too', body => {
      const result = checkPullRequestDescription({ body, files: ['docs/a.md', ...code] });
      expect(result.problems.map(p => p.code)).toEqual(['docs_only_claim']);
      expect(result.problems[0].message).toContain('routes/a.js');
    });

    it('accepts the claim when every file is documentation', () => {
      expect(
        checkPullRequestDescription({
          body: 'Docs-only handoff.',
          files: ['docs/devops.md', 'README.md', 'notes.txt'],
        }).ok
      ).toBe(true);
    });

    it('lists at most five offending files and says how many there are', () => {
      const files = Array.from({ length: 8 }, (_, i) => `routes/r${i}.js`);
      const message = checkPullRequestDescription({ body: 'Docs only.', files }).problems[0]
        .message;
      expect(message).toContain('8 other files');
      expect(message).toContain('routes/r4.js');
      expect(message).not.toContain('routes/r5.js');
    });
  });

  describe('undisclosed dependency changes', () => {
    it('flags a lockfile change the description never mentions', () => {
      const result = checkPullRequestDescription({
        body: 'Tidy the dashboard.',
        files: ['package-lock.json', 'public/a.js'],
      });
      expect(result.problems.map(p => p.code)).toEqual(['undisclosed_dependency_change']);
    });

    it.each([
      'Bump socket.io to 4.8.4.',
      'Updates dependencies.',
      'Regenerates the lockfile.',
      'Upgrade prettier.',
    ])('accepts it when the description says so: %j', body => {
      expect(checkPullRequestDescription({ body, files: ['package.json'] }).ok).toBe(true);
    });
  });

  it('reports every problem at once (the PR #1747 shape)', () => {
    const result = checkPullRequestDescription({
      body: 'Docs-only: bump pinned overrides + devops log.',
      files: ['docs/log.md', 'package-lock.json', 'public/assets/js/admin-shared.js'],
    });
    expect(result.problems.map(p => p.code)).toEqual(['docs_only_claim']);
    // "bump" discloses the dependency change, but the docs-only claim is still false.
  });

  it('copes with a missing description and file list', () => {
    expect(checkPullRequestDescription()).toEqual({ ok: true, problems: [] });
    expect(checkPullRequestDescription({ body: null, files: [] }).ok).toBe(true);
  });
});

describe('flagDegradedReview', () => {
  const owner = 'o';
  const repo = 'r';

  /** A fake octokit with just the calls the flow makes, recording the writes. */
  function fakeGithub({
    state = 'open',
    labels = [],
    comments = [],
    checkRuns = [],
    logs = 'ok',
    logError = null,
    labelExists = false,
  } = {}) {
    const calls = { labels: [], createdLabels: [], comments: [] };
    const github = {
      rest: {
        pulls: {
          get: jest.fn(async () => ({
            data: { state, labels: labels.map(name => ({ name })), head: { sha: 'abc123' } },
          })),
        },
        issues: {
          listComments: Symbol('listComments'),
          createLabel: jest.fn(async params => {
            if (labelExists) {
              const error = new Error('exists');
              error.status = 422;
              throw error;
            }
            calls.createdLabels.push(params);
          }),
          addLabels: jest.fn(async params => calls.labels.push(params)),
          createComment: jest.fn(async params => calls.comments.push(params)),
        },
        checks: {
          listForRef: jest.fn(async () => ({ data: { check_runs: checkRuns } })),
        },
        actions: {
          downloadJobLogsForWorkflowRun: jest.fn(async () => {
            if (logError) {
              throw new Error(logError);
            }
            return { data: logs };
          }),
        },
      },
      paginate: jest.fn(async () => comments),
    };
    return { github, calls };
  }

  const codexComment = { user: { login: CODEX_REVIEW_BOT }, body: CODEX_NOTICE };
  const crashedScan = {
    id: 99,
    name: 'github-advanced-security',
    conclusion: 'failure',
    started_at: '2026-11-19T10:00:00Z',
    output: { title: '', summary: '', text: '' },
  };
  const target = { owner, repo, pullNumber: 7 };

  it('labels and comments once when Codex hit its limit', async () => {
    const { github, calls } = fakeGithub({ comments: [codexComment] });
    const result = await flagDegradedReview(github, target);
    expect(result.flagged).toBe(true);
    expect(result.signals.map(s => s.source)).toEqual(['codex']);
    expect(calls.labels).toEqual([
      { owner, repo, issue_number: 7, labels: [DEGRADED_REVIEW_LABEL] },
    ]);
    expect(calls.createdLabels).toHaveLength(1);
    expect(calls.comments).toHaveLength(1);
    expect(calls.comments[0].body).toContain(DEGRADED_REVIEW_MARKER);
  });

  it('finds a code scanning crash in the job log and reports both when both happened', async () => {
    const { github, calls } = fakeGithub({
      comments: [codexComment],
      checkRuns: [crashedScan],
      logs: 'SessionModelError: CAPIError: 400 The requested model is not supported',
    });
    const result = await flagDegradedReview(github, target);
    expect(result.signals.map(s => s.source)).toEqual(['codex', 'code-scanning']);
    expect(github.rest.actions.downloadJobLogsForWorkflowRun).toHaveBeenCalledWith({
      owner,
      repo,
      job_id: 99,
    });
    expect(calls.comments[0].body).toContain('crashed');
  });

  it('is idempotent: no second comment or label on a pull request already flagged', async () => {
    const { github, calls } = fakeGithub({
      labels: [DEGRADED_REVIEW_LABEL],
      comments: [codexComment, { user: { login: 'bot' }, body: `${DEGRADED_REVIEW_MARKER}\nold` }],
    });
    const result = await flagDegradedReview(github, target);
    expect(result.flagged).toBe(true);
    expect(calls.labels).toHaveLength(0);
    expect(calls.comments).toHaveLength(0);
    expect(github.rest.issues.createLabel).not.toHaveBeenCalled();
  });

  it('tolerates the label already existing in the repository', async () => {
    const { github, calls } = fakeGithub({ comments: [codexComment], labelExists: true });
    await flagDegradedReview(github, target);
    expect(calls.labels).toHaveLength(1);
  });

  it('does nothing for a pull request whose review ran', async () => {
    const { github, calls } = fakeGithub({
      comments: [{ user: { login: CODEX_REVIEW_BOT }, body: 'Codex Review: no issues.' }],
      checkRuns: [{ ...crashedScan, conclusion: 'success' }],
    });
    const result = await flagDegradedReview(github, target);
    expect(result).toEqual({ flagged: false, signals: [] });
    expect(calls.labels).toHaveLength(0);
    expect(calls.comments).toHaveLength(0);
  });

  it('counts only the most recent code scanning attempt, so a passing re-run clears it', async () => {
    const { github } = fakeGithub({
      checkRuns: [
        crashedScan,
        { ...crashedScan, id: 100, conclusion: 'success', started_at: '2026-11-19T11:00:00Z' },
      ],
      logs: 'CAPIError',
    });
    expect((await flagDegradedReview(github, target)).flagged).toBe(false);
  });

  it('does not treat a real code scanning finding as a degraded review', async () => {
    const { github } = fakeGithub({ checkRuns: [crashedScan], logs: 'Found 3 alerts' });
    expect((await flagDegradedReview(github, target)).flagged).toBe(false);
  });

  it('still flags an empty failure when the log cannot be fetched, and reports the problem', async () => {
    const log = jest.fn();
    const { github } = fakeGithub({
      checkRuns: [crashedScan],
      logError: 'Resource not accessible by integration',
    });
    const result = await flagDegradedReview(github, { ...target, log });
    expect(result.flagged).toBe(true);
    expect(result.signals[0].summary).toMatch(/log could not be read/);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Resource not accessible'));
  });

  it('skips a pull request that is not open', async () => {
    const { github, calls } = fakeGithub({ state: 'closed', comments: [codexComment] });
    expect(await flagDegradedReview(github, target)).toEqual({
      flagged: false,
      signals: [],
      reason: 'not open',
    });
    expect(calls.labels).toHaveLength(0);
  });
});
