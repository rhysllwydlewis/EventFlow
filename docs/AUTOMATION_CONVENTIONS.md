# Automation conventions

How the automated routines (Dev-Ops Assistant, Supplier-Bot, Ops Assistant, Fleet
Supervisor) should treat the signals this repository gives them. These exist because of
real gaps found by the Fleet Supervisor: #1702, #1675, #1677 and #1749.

## 1. Independent review: know when it did not run

The Dev-Ops merge policy (step 3 in `docs/devops-assistant-progress.md`) relies on an
independent look at the diff. Two outside reviewers normally provide one, and both fail
quietly:

| Reviewer                                          | How it fails                                                                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex (`chatgpt-codex-connector[bot]`)            | Posts "You have reached your Codex usage limits for code reviews" instead of a review.                                                                                                            |
| GitHub code scanning (`github-advanced-security`) | Crashes with `SessionModelError: CAPIError: 400 The requested model is not supported` before reading the diff. The check turns red but its own output is empty; the error is only in the job log. |

The **Review signals** workflow (`.github/workflows/review-signals.yml`) now notices both,
puts the **`independent-review-degraded`** label on the pull request and posts one comment
saying which reviewer did not run. It checks on comments and failed check runs, and sweeps
every open pull request every three hours in case an event was missed.

If a pull request has the label:

1. Treat the independent review as **not done**, however green the other checks are.
2. Do a deeper review of the whole diff yourself, as if it were someone else's: bugs, edge
   cases, security, accessibility.
3. Say in the pull request that you did, and what it found. Do not just merge.
4. A code scanning failure that is **not** a crash (a real finding) is not labelled. Read it.

The label is informational. It does not block a merge by itself. It clears itself, on the
next sweep or event, once the reviewer has recovered: a code scanning re-run passes, or Codex
completes a review after its usage-limit notice (the notice itself is never deleted, so what
counts is the most recent thing Codex did).

## 2. The pull request description must match the pull request

The workflow's **PR description matches the diff** check fails a ready-for-review pull
request when its description:

- says it should not be merged ("do not merge yet", "this PR will stay open", "not ready to
  merge"). Either the description is stale or the pull request is not ready: fix whichever
  is true. A draft may say it, because a draft cannot be merged;
- calls itself documentation-only ("docs-only", "one markdown file", "no code changes") while
  changing anything outside `docs/` and `*.md` / `*.txt`. List the files it really changes;
- changes `package.json` or a lockfile without mentioning dependencies. Say which change and why.

Only a direct claim counts. A documentation-only claim has to be the point of its sentence
("Docs-only handoff.", "This is a docs-only PR.", "Docs-only: bump overrides"), so "This is not
a docs-only PR", "Add a check that rejects docs-only descriptions" and "removes the old do not
merge banner" are not flagged. Text inside code spans, code blocks, quotations and HTML
comments is ignored too, and bot-authored pull requests (Dependabot) are skipped.

This check is only advisory unless it is made a required status check in branch protection.
That is the repository owner's decision.

## 3. Verifying a deploy: cite evidence, not a summary

"Deploy verified, `/api/ready` returned 200 N times" cannot be checked later. Use sources
that can be:

- **The `deploy/production` commit status** on the merge commit. The Deploy workflow sets it
  only after Railway reports the exact commit (via `/deployment.json`) and `/api/ready`
  answers. Link it.
- **`https://event-flow.co.uk/deployment.json`**: paste the raw JSON. Its `commit` must equal
  the merge commit.
- **Raw output**: when you poll `/api/ready` yourself, paste the actual response lines
  (status code and body, truncated if long), not a description of them.

If the routine cannot reach the site (`CONNECT event-flow.co.uk:443` returns 403, issues
#1804 and #1826), say that plainly and cite the commit status instead; do not write that
the deploy was verified.

## 4. Two instances at once (not solved here)

#1677 found two Dev-Ops Assistant instances running at the same time on one branch. Nothing
in this repository can stop that: both are started by the platform's scheduler, and a lock
held in git would have to force-push to take over a stale one, which a routine session has
had refused before (see the 2026-11 entries in `docs/devops-assistant-progress.md`). The
remedy is on the platform side: one in-flight run per routine. Until then, a
routine should fetch and read the branch tip immediately before pushing and stop if it has
moved in a way it did not cause.

## 5. Ops Assistant

How requests to `/internal/ops-bot/*` are signed, and how to tell a stale secret from a bad
path, is in `docs/OPS_ASSISTANT_SIGNING.md`.
