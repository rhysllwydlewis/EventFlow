# EventFlow Dev-Ops Assistant — handoff

This is the running handoff file for the automated EventFlow dev-ops routine:
design brief, backlog, a "discovered along the way" list, and a dated session
log. Trust this file over your own assumptions about where things stand — if
an earlier entry turns out to be wrong, correct it in place rather than
leaving a cold session to chase it.

## Mandate

Find and fix problems anywhere in the live EventFlow site: bugs, broken
flows, missing states, low-quality or inconsistent UI, accessibility gaps,
flaky or missing tests, stale docs — the general "things that don't work, or
work poorly" sweep, not limited to any one area of the product. This routine
supersedes the old forum-only routine (see History below); its scope is the
whole site.

EventFlow has real customers and suppliers. This is not a sandbox project —
treat every change as something a paying user could be affected by today.

## Merge policy — read this every run

The product owner has authorised this routine to merge its own pull
requests **fully autonomously and without exception for any area of the
codebase** — payments/billing, auth, legal/compliance content, and data
deletion/migration included — on the condition that the following sequence
is actually followed, in full, every time:

1. Implement the change.
2. Run the relevant tests. If anything is red, diagnose the real cause and
   fix it — never mask, skip, or weaken a check to get to green. Repeat until
   green.
3. Once green, stop and independently re-review the whole diff as if it were
   someone else's PR you were asked to review cold. Look specifically for
   bugs, edge cases, security issues, accessibility gaps, and anything the
   implementation pass would be biased to miss. Do this in earnest — it is
   the step that matters most. (See PR #1433 on the retired forum routine for
   what this looks like done well: its own review pass caught a dialog with
   no accessible name in three of four render states, something axe had
   reported zero violations on.)
4. Fix everything that review turns up and push the update.
5. Re-run the tests. They must come back green again after the review fixes,
   not just after step 2.
6. Only now, merge the pull request autonomously.

Do not merge, and instead leave the PR open with a clear comment explaining
why, only when:
- Tests cannot honestly be made green after real effort (not a flake — see
  the known-flake note below).
- Completing the work genuinely requires something this routine cannot do
  itself: spending money, credentials it doesn't have, real external
  legal/regulatory sign-off, or an external message sent in the owner's
  name.

Do not hold a PR open merely because it touches a sensitive area of the code
(payments, auth, legal/compliance content, data deletion/migration) — full
autonomy is authorised there too. The more sensitive the area, the harder
step 3 below (the independent review pass) should work, not a reason to wait
for the owner.

Known false-positive check: **DeepSource: JavaScript** has been red on a
dashboard-configured metric across several recent merged PRs (#1430, #1433)
despite grade A on all categories and zero inline issues. Two rounds of
investigation falsified both standing hypotheses (test coverage, doc/diff
size). Do not spend effort chasing this again or let it block a merge that is
otherwise clean — note it and move on. It needs the owner's DeepSource
dashboard to diagnose, not more pushes.

## Backlog

- [ ] Carried over from the old forum routine: `/community/discussions` and
      `/community/search` still use the old `.efc-hero` band and look like a
      different site next to the redesigned homepage (redesigned in #1431).
- [ ] General site-wide sweep: with no specific backlog item pending, spend
      the session looking for real defects anywhere in the product — broken
      flows, poor states, accessibility issues, inconsistent UI, missing
      error handling, flaky tests — verify each one is real before fixing it.

## Discovered along the way

(Empty — add anything found that isn't today's task, with enough detail for
a future session to act on it without re-discovering it from scratch.)

## History

This routine folds in and replaces a narrower routine that worked only the
community/forum redesign on branch `claude/eventflow-community-forum-vgvvt0`
(see `docs/forum-redesign-progress.md` there for its full log). That routine
never merged its own PRs — the owner merged #1426–#1433 by hand. Starting
now, this broader routine covers the whole site and merges autonomously under
the policy above.

## Session log

(Empty — each run appends a dated entry: what changed, what's green, what's
still open, anything needing a decision.)
