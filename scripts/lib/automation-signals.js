'use strict';

/**
 * Checks behind .github/workflows/review-signals.yml.
 *
 * Two things that used to fail silently on this repository's pull requests:
 *
 * 1. The independent review did not happen. Codex answers with a usage-limit notice
 *    instead of a review, and GitHub's code scanning ("github-advanced-security")
 *    crashes with `CAPIError: 400 The requested model is not supported` before it
 *    reads the diff (#1702, #1675). Nothing marked the pull request, so it merged as
 *    if both had passed.
 * 2. A pull request description that no longer matched the pull request (#1749): one
 *    said "do not merge yet" and was merged anyway, another called itself docs-only
 *    while changing dependencies and shipped JavaScript.
 *
 * The decisions are plain functions so they are unit tested; the workflow only
 * collects inputs from GitHub and calls them. Nothing here reads text from a pull
 * request into a shell command.
 */

const CODEX_REVIEW_BOT = 'chatgpt-codex-connector[bot]';
const CODE_SCANNING_CHECK_NAME = 'github-advanced-security';
const DEGRADED_REVIEW_LABEL = 'independent-review-degraded';
const DEGRADED_REVIEW_MARKER = '<!-- eventflow-independent-review-degraded -->';

const CODEX_LIMIT_PATTERN = /reached your codex usage limits?/i;
const SCANNER_CRASH_PATTERN = /SessionModelError|CAPIError|requested model is not supported/i;

/**
 * @param {{login?: string, body?: string}} comment A pull request comment.
 * @returns {{source: string, summary: string}|null} A signal when Codex did not review.
 */
function detectDegradedCodexReview({ login, body } = {}) {
  if (login !== CODEX_REVIEW_BOT || !CODEX_LIMIT_PATTERN.test(String(body || ''))) {
    return null;
  }
  return {
    source: 'codex',
    summary: 'Codex reached its usage limit, so it did not review this pull request.',
  };
}

/**
 * The code scanning check reports nothing in its own output when it crashes: the title,
 * summary and text are all empty, and the error is only in the job log. So the log is
 * what has to be read. When it cannot be read, an empty failure is still flagged, with
 * the reason stated, rather than guessed to be a real finding or ignored.
 *
 * @param {Object} input
 * @param {string} input.name Check run name.
 * @param {string} input.conclusion Check run conclusion.
 * @param {string} [input.outputText] Title, summary and text of the check run.
 * @param {string} [input.logText] The job log, when it could be fetched.
 * @param {boolean} [input.logsAvailable] Whether the job log could be fetched.
 * @returns {{source: string, summary: string}|null}
 */
function detectDegradedCodeScanning({
  name,
  conclusion,
  outputText = '',
  logText = '',
  logsAvailable = false,
} = {}) {
  if (name !== CODE_SCANNING_CHECK_NAME || conclusion !== 'failure') {
    return null;
  }
  if (SCANNER_CRASH_PATTERN.test(`${outputText}\n${logText}`)) {
    return {
      source: 'code-scanning',
      summary:
        'GitHub code scanning crashed before analysing the diff (CAPIError), so it did not scan this pull request.',
    };
  }
  if (!logsAvailable && !String(outputText).trim()) {
    return {
      source: 'code-scanning',
      summary:
        'GitHub code scanning failed without reporting anything, and its log could not be read to tell a crash from a finding.',
    };
  }
  return null;
}

/**
 * @param {Array<{source: string, summary: string}>} signals What did not run.
 * @returns {string} The comment to post. Carries a marker so it is posted once.
 */
function buildDegradedReviewComment(signals) {
  const lines = signals.map(signal => `- ${signal.summary}`);
  return [
    DEGRADED_REVIEW_MARKER,
    '**The independent review did not fully run on this pull request.**',
    '',
    ...lines,
    '',
    'A green set of checks here does not mean it was independently reviewed. Before merging, review the whole diff cold as if it were someone else’s, and say in the pull request that you did.',
    '',
    `This is labelled \`${DEGRADED_REVIEW_LABEL}\`. See docs/AUTOMATION_CONVENTIONS.md.`,
    '',
    '---',
    '_Posted by the Review signals workflow._',
  ].join('\n');
}

// ── Pull request description ────────────────────────────────────────────────

const DO_NOT_MERGE_PATTERNS = [
  /\bdo not merge\b/i,
  /\bdon['’]t merge\b/i,
  /\bnot (?:yet )?(?:ready|safe) to merge\b/i,
  /\b(?:this )?(?:pr|pull request) will stay open\b/i,
  /\bkeep (?:this )?(?:pr |pull request )?open\b/i,
];

// A sentence that is talking about the phrase rather than saying it ("removes the old do not
// merge banner", "rejects descriptions that say ...").
const ABOUT_THE_PHRASE_PATTERN =
  /\b(?:remov\w*|banner|template|phrase|wording|quot\w*|detect\w*|reject\w*|flags?|says?|said|stale)\b/i;

// A claim has to be the point of its sentence: "Docs-only handoff.", "This is a docs-only PR.",
// "Docs-only: bump overrides". Words further into a sentence ("This is not a docs-only PR",
// "Add a check that rejects docs-only descriptions", "calls itself documentation-only") are
// mentions or denials, not claims about this pull request.
const DOCS_ONLY_CLAIM_PATTERNS = [
  /^(?:(?:this|it)\s+(?:is|['’]s)\s+)?(?:an?\s+)?(?:docs?|documentation|markdown)[\s-]*only\b(?:\s+(?:pr|pull request|change|changes|update|commit|handoff|fix))?\s*(?:[.:;,!—–-]|$)/i,
  /^no code (?:changes?|changed)\b/i,
  /^(?:it|this)\s+(?:touches|changes)\s+(?:just\s+|only\s+)?(?:one|a single)\s+(?:markdown|doc(?:umentation)?)\s+file\b/i,
];

const DEPENDENCY_FILES = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json']);
const DEPENDENCY_DISCLOSURE_PATTERN =
  /\b(?:depend\w*|package(?:-lock)?(?:\.json)?|lockfile|bump\w*|upgrad\w*|npm|overrides?)\b/i;

const isDocumentationPath = file => /^docs\//i.test(file) || /\.(?:md|mdx|txt)$/i.test(file);

/**
 * What a reader of the description would see: not HTML comments, code, or quoted text,
 * so a PR that quotes "do not merge" from somewhere else is not flagged for it.
 */
function visibleText(body) {
  return String(body || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .split('\n')
    .filter(line => !/^\s*>/.test(line))
    .join('\n');
}

/** The sentences of a description, without list markers, headings, bold or checkboxes. */
function sentencesOf(text) {
  return text
    .split('\n')
    .flatMap(line => line.split(/(?<=[.!?])\s+/))
    .map(sentence =>
      sentence
        .replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6})\s+/, '')
        .replace(/^\[[ xX]\]\s*/, '')
        .replace(/\*\*|__/g, '')
        .trim()
    )
    .filter(Boolean);
}

/**
 * Does the description still say what the pull request does?
 *
 * @param {Object} input
 * @param {string} [input.body] The pull request description.
 * @param {string[]} [input.files] Paths the pull request changes.
 * @param {boolean} [input.draft] Drafts cannot be merged, so "do not merge" is accurate on one.
 * @returns {{ok: boolean, problems: Array<{code: string, message: string}>}}
 */
function checkPullRequestDescription({ body = '', files = [], draft = false } = {}) {
  const sentences = sentencesOf(visibleText(body));
  const problems = [];

  const saysDoNotMerge = sentences.some(
    sentence =>
      !ABOUT_THE_PHRASE_PATTERN.test(sentence) &&
      DO_NOT_MERGE_PATTERNS.some(pattern => pattern.test(sentence))
  );
  if (!draft && saysDoNotMerge) {
    problems.push({
      code: 'do_not_merge',
      message:
        'The description says this pull request should not be merged, but it is ready for review. Update the description, or put the pull request back to draft.',
    });
  }

  if (
    sentences.some(sentence => DOCS_ONLY_CLAIM_PATTERNS.some(pattern => pattern.test(sentence)))
  ) {
    const code = files.filter(file => !isDocumentationPath(file));
    if (code.length > 0) {
      const shown = code.slice(0, 5).join(', ');
      problems.push({
        code: 'docs_only_claim',
        message: `The description says this is documentation-only, but it also changes ${code.length} other file${code.length === 1 ? '' : 's'} (${shown}${code.length > 5 ? ', …' : ''}). Describe what it actually changes.`,
      });
    }
  }

  const changedDependencies = files.filter(file => DEPENDENCY_FILES.has(file));
  if (changedDependencies.length > 0 && !DEPENDENCY_DISCLOSURE_PATTERN.test(sentences.join(' '))) {
    problems.push({
      code: 'undisclosed_dependency_change',
      message: `This changes ${changedDependencies.join(' and ')} but the description never mentions dependencies. Say which dependencies change and why.`,
    });
  }

  return { ok: problems.length === 0, problems };
}

// ── Flagging a degraded review ──────────────────────────────────────────────

/**
 * Look at one pull request and, if the independent review did not run, label it and
 * comment once.
 *
 * @param {Object} github An octokit client (the one github-script provides).
 * @param {{owner: string, repo: string, pullNumber: number, log?: Function}} target
 * @returns {Promise<{flagged: boolean, signals: Array<{source: string, summary: string}>, reason?: string}>}
 */
async function flagDegradedReview(github, { owner, repo, pullNumber, log = () => undefined }) {
  const { data: pull } = await github.rest.pulls.get({ owner, repo, pull_number: pullNumber });
  if (pull.state !== 'open') {
    return { flagged: false, signals: [], reason: 'not open' };
  }

  const signals = [];

  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pullNumber,
    per_page: 100,
  });
  const alreadyCommented = comments.some(comment =>
    String(comment.body || '').includes(DEGRADED_REVIEW_MARKER)
  );
  // Codex edits its summary comment in place and posts a separate notice when it hits its
  // limit, and the notice is never deleted. Only the most recently touched Codex comment
  // says where it stands now: an old notice followed by a completed review is recovered.
  const touchedAt = comment => new Date(comment.updated_at || comment.created_at || 0).getTime();
  const latestCodexComment = comments
    .filter(comment => comment.user && comment.user.login === CODEX_REVIEW_BOT)
    .sort((a, b) => touchedAt(a) - touchedAt(b))
    .pop();
  const codexSignal =
    latestCodexComment &&
    detectDegradedCodexReview({
      login: latestCodexComment.user.login,
      body: latestCodexComment.body,
    });
  if (codexSignal) {
    signals.push(codexSignal);
  }

  const checks = await github.rest.checks.listForRef({
    owner,
    repo,
    ref: pull.head.sha,
    check_name: CODE_SCANNING_CHECK_NAME,
    per_page: 20,
  });
  // The most recent attempt is the one that counts: a re-run that passed clears it.
  const latest = [...checks.data.check_runs].sort(
    (a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0)
  )[0];
  if (latest && latest.conclusion === 'failure') {
    let logText = '';
    let logsAvailable = false;
    try {
      const response = await github.rest.actions.downloadJobLogsForWorkflowRun({
        owner,
        repo,
        job_id: latest.id,
      });
      logText = String(response.data || '');
      logsAvailable = true;
    } catch (error) {
      log(`Could not read the log for check run ${latest.id}: ${error.message}`);
    }
    const output = latest.output || {};
    const signal = detectDegradedCodeScanning({
      name: latest.name,
      conclusion: latest.conclusion,
      outputText: [output.title, output.summary, output.text].filter(Boolean).join('\n'),
      logText,
      logsAvailable,
    });
    if (signal) {
      signals.push(signal);
    }
  }

  const hasLabel = (pull.labels || []).some(label => label.name === DEGRADED_REVIEW_LABEL);

  if (signals.length === 0) {
    // Recovered: a passing re-run, or a completed Codex review after the notice. Leaving the
    // label on would keep telling the merge routine that no independent review happened.
    if (hasLabel) {
      try {
        await github.rest.issues.removeLabel({
          owner,
          repo,
          issue_number: pullNumber,
          name: DEGRADED_REVIEW_LABEL,
        });
      } catch (error) {
        // 404: someone removed it already.
        if (error.status !== 404) {
          throw error;
        }
      }
      return { flagged: false, signals, cleared: true };
    }
    return { flagged: false, signals };
  }

  if (!hasLabel) {
    try {
      await github.rest.issues.createLabel({
        owner,
        repo,
        name: DEGRADED_REVIEW_LABEL,
        color: 'FBCA04',
        description: 'Codex or code scanning did not run on this pull request',
      });
    } catch (error) {
      // 422: the label already exists, which is fine.
      if (error.status !== 422) {
        throw error;
      }
    }
    await github.rest.issues.addLabels({
      owner,
      repo,
      issue_number: pullNumber,
      labels: [DEGRADED_REVIEW_LABEL],
    });
  }
  if (!alreadyCommented) {
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: buildDegradedReviewComment(signals),
    });
  }
  return { flagged: true, signals };
}

module.exports = {
  CODEX_REVIEW_BOT,
  CODE_SCANNING_CHECK_NAME,
  DEGRADED_REVIEW_LABEL,
  DEGRADED_REVIEW_MARKER,
  buildDegradedReviewComment,
  checkPullRequestDescription,
  detectDegradedCodeScanning,
  detectDegradedCodexReview,
  flagDegradedReview,
};
