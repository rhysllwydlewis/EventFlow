# Content review automation

EventFlow keeps three different date concepts separate so readers and search engines are not given a false impression of freshness.

## Article dates

`public/assets/data/guides.json` is the canonical article catalogue. Every file in `public/articles/` must have exactly one catalogue record.

- `publishedDate` is the original publication date. It does not change.
- `lastMaterialUpdate` changes only when the article content is materially revised.
- `Content checked Month YYYY` is rendered on request in the `Europe/London` timezone. It reflects EventFlow's standing editorial review process and does not alter structured data or sitemap dates.

The server renders the canonical publication and material-update dates into the visible article information, Open Graph metadata and Article JSON-LD. The sitemap uses `lastMaterialUpdate`; it must never use the current date merely because a page was served or checked.

Run `npm run audit:articles` after adding or changing an article. The same read-only audit runs in GitHub Actions each month. It checks the one-to-one inventory, valid date order, future dates, rendered metadata and the review label.

## Review queue

The Content Management area's **Policy Reviews** tab contains a persistent Review Queue. A daily scheduler catches up after restarts and creates, at most, these two tasks for each calendar month:

- confirm the article-library content check;
- triage policy and product changes.

An administrator must choose an outcome before completing a task. Notes, the completing administrator and completion time are retained in the database. In-app notifications are always created when tasks are first due; an email digest can be enabled in the same panel.

The existing review-reminder switch disables or enables automated task creation, deployment-change inspection and the optional git diagnostic together. It does not delete existing review records.

On a deployment with a valid Railway or Git commit SHA, the scheduler compares that deployment with the last successfully inspected deployment. Changes to Community, privacy, payments, subscriptions, messaging, suppliers, profiles, locations, uploads, analytics, cookies and relevant integrations create an additional policy-impact task. The first eligible deployment records a baseline. If comparison fails, the baseline is not advanced, so the check can retry.

This detector is a triage aid, not legal advice and not proof that a policy is compliant. A material product or policy change still needs human review and, where appropriate, review by a UK solicitor or other qualified adviser.

## Policy dates

Public policy dates and versions remain reviewed metadata in `config/policyMetadata.js`:

- `lastMaterialUpdate` changes with material wording or effect;
- `lastReviewed` records a documented human review, including a review that required no wording change;
- `effectiveFrom` records when that version takes effect.

Runtime code cannot advance those dates. Git history is only an optional diagnostic. Production images may not contain `.git`, so missing history is reported as **unknown**, never as “up to date”.

## Adding an article

1. Add the HTML file under `public/articles/`.
2. Add one matching `/articles/<slug>` record to `public/assets/data/guides.json` with truthful ISO dates.
3. Run `npm run audit:articles` and `npm run sitemap`.
4. Review the generated sitemap diff and confirm its `lastmod` is the material-update date.
