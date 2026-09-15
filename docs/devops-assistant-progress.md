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

- [x] Carried over from the old forum routine: `/community/discussions` and
      `/community/search` still use the old `.efc-hero` band and look like a
      different site next to the redesigned homepage (redesigned in #1431).
      Done in PR #1669 (2026-09-15) — see session log.
- [ ] `/community/category/:slug` still has no hero at all (noted as an open
      question in the old forum routine's handoff, never picked up). Decide
      whether it gets the same standalone `stageHero()` card #1669 gave the
      other two sibling pages, or stays bare because a category page is
      reached mid-browse rather than as a landing page.
- [ ] General site-wide sweep: with no specific backlog item pending, spend
      the session looking for real defects anywhere in the product — broken
      flows, poor states, accessibility issues, inconsistent UI, missing
      error handling, flaky tests — verify each one is real before fixing it.

## Discovered along the way

- **`npm test` requires `npm install` first in a fresh checkout/container.**
  `node_modules` was not present at the start of this session despite a
  committed `package-lock.json` — `npx jest` happened to still run a subset
  of tests (enough to look like it worked), but `npm test` failed outright
  with `jest: not found` until `npm install` was run. Not a bug in the repo,
  just a trap for a cold session: run `npm install` before trusting any test
  output, especially a partial one from `npx`.
- **`tests/unit/marketplace-image-deletion.test.js` times out in this sandbox.**
  `deleteMarketplaceImages should return 0 when MongoDB is not available`
  tries to make a real connection to a MongoDB host
  (`hayabusa.proxy.rlwy.net`) and hits Jest's 10s timeout when that host is
  unreachable from the container. Reproduced identically on `main` with no
  changes applied, so it is an environment/connectivity limitation of this
  sandbox, not a defect in the test or the code it covers. If it shows up
  red in an environment that _does_ have DB access, treat it as real; here,
  it isn't.

## History

This routine folds in and replaces a narrower routine that worked only the
community/forum redesign on branch `claude/eventflow-community-forum-vgvvt0`
(see `docs/forum-redesign-progress.md` there for its full log). That routine
never merged its own PRs — the owner merged #1426–#1433 by hand. Starting
now, this broader routine covers the whole site and merges autonomously under
the policy above.

## Session log

### 2026-09-15 — session 1

First run of the consolidated dev-ops routine. Branch had only the handoff
doc itself (no PR yet), so re-based it onto latest `main` (a clean merge, no
conflicts) and picked the top backlog item: carry the redesigned community
hero to `/community/discussions` and `/community/search`.

**What changed.** Added `stageHero()` to `scripts/generate-community-pages.mjs`
— the same `.efc-stage__card` component the homepage uses (badge, heading,
lead, search, CTA), without the homepage's flanking rails/category
strip/join bar. Those simply aren't emitted for the two sibling pages;
CSS grid centres the lone card on its own rather than anything faking an
empty rail. `/community/discussions` gained a working hero search field it
never had, wired to the existing (already mode-agnostic) `#efc-search-input`
sync in `discussions.js`. Removed the now-dead `.efc-hero`/`.efc-hero__inner`/
`.efc-hero p`/`.efc-hero__actions`/`.efc-search` CSS that only the old band
used — kept `.efc-shell h1` and the shared `.efc-field` focus rules, which
apply across the whole community section, not just the hero.

**Verified before opening the PR:** `generate-community-pages.mjs --check`
reports no drift; full `npm test` — 12182 passing, the only failure being the
pre-existing MongoDB-connectivity timeout noted above (confirmed unrelated by
reproducing it on `main` with these changes stashed); axe scan clean (zero
violations) on both pages at 1440px; Playwright screenshot sweep at
390/768/1440px on both pages, no horizontal overflow, mobile search button
keeps its fixed width via the existing `.efc-searchbtn` carve-out.

**Independent review pass (before merge):** re-read the diff cold. Checked
that `.efc-hero`/`.efc-search` had no other references anywhere in the repo
(HTML, other CSS, tests) before deleting their rules — confirmed via grep.
Checked the shared `.efc-hero h1, .efc-shell h1` selector wasn't accidentally
gutted — kept `.efc-shell h1` alone, since it's load-bearing for h1 sizing
across every community page, not just the old hero band. Checked the search
form's target (`/community/search`, matching the homepage's own hero search)
rather than a self-filtering submit to `/community/discussions` — the
existing product already funnels every hero search box to the one canonical
search results page, so this follows that precedent rather than inventing
new, untested in-place filtering behaviour on the index page.

**Outcome: merged.** PR #1669
(https://github.com/rhysllwydlewis/EventFlow/pull/1669) went green end to
end — every CI check passed, including all four DeepSource analyzers
(JavaScript included, despite that one being the known dashboard-metric
false positive on other PRs — it simply reported clean here), Lighthouse
desktop/mobile, the full E2E shard set, Visual + a11y, Visual Regression,
Build/Browser Verification and the Go-Live Audit. No human review comments
were posted. Merged autonomously into `main` as `af0203a` at 18:52 UTC.
Two transient "Build Verification"/"Browser Verification" failures seen
mid-run were self-inflicted noise, not real: I pushed the handoff-doc commit
while the first CI run (for commit `1ea3915`) was still in flight, GitHub
cancelled that run's prerequisites, and those two gate jobs correctly
reported the cancellation as a failure. The re-triggered run for the actual
final commit (`9a21462`) ran clean start to finish. Lesson for next time:
push the code and the handoff-doc update together in one commit (or wait
for CI on the first push before adding a second), so as not to spend a
CI cycle on a run that's guaranteed to be superseded.

**Next session:** the next open item is `/community/category/:slug`'s
missing hero (see backlog), then the general site-wide sweep.
