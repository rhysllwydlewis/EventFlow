# Preview environments (Railway PR previews)

Every pull request gets its own throw-away copy of the site on Railway. Its environment is named
like **`EventFlow-pr-1839`**. A preview is for looking at a change, not for running a business, so
the code makes it safe by itself, whatever settings the preview happens to have inherited.

The code is in `utils/previewSafety.js`. It is a no-op everywhere else: production, local
development and the automated tests behave exactly as they did before.

## How the site knows it is a preview

Only when the Railway environment name (`RAILWAY_ENVIRONMENT_NAME`) is exactly `EventFlow-pr-`
followed by digits, nothing before or after (`/^EventFlow-pr-\d+$/i`, upper or lower case).

| Environment name       | Preview? |
| ---------------------- | -------- |
| `EventFlow-pr-1839`    | yes      |
| `eventflow-pr-5`       | yes      |
| `production`           | no       |
| `EventFlow-pr-12x`     | no       |
| `EventFlow-pr-`        | no       |
| `EventFlow-pr-5-copy`  | no       |
| not on Railway / unset | no       |

If that variable is missing, `RAILWAY_ENVIRONMENT` (Railway sets it to the same name) is used
instead. The branch name, the public domain and `NODE_ENV` are never used to decide.

When a preview starts, the server writes one line to its log beginning `[preview-safety]` saying
what is switched on (Stripe disabled / allowed, email suppressed / allowlisted).

## What a preview can and cannot do

**Cannot**

- Take real payments. A live Stripe key (`sk_live_...`, also `rk_live_...`) is refused: Stripe is
  treated as not set up, and billing pages and buttons answer _"Billing is disabled in preview
  environments"_ instead of failing. The site does not crash.
- Send real email. Nothing leaves the server unless the recipient is on the allowlist below. Sign-up,
  password-reset and enquiry emails are _not delivered_; the site carries on as if they were sent.
- Keep a copy of an email's contents. The local `outbox/` record in a preview is metadata only.

**Can**

- Run everything else: browse, sign in, edit, upload (uploads on a preview disappear when it is
  rebuilt).
- Take **test** payments if it has a Stripe **test** key.
- Send real email to addresses you have allowed.

## Giving a preview Stripe test keys

1. In Stripe, switch to **Test mode** (the toggle in the dashboard) and copy the secret key. It
   starts `sk_test_`.
2. In Railway open the **EventFlow-pr-NNNN** environment, then the web service, then **Variables**.
3. Set `STRIPE_SECRET_KEY` to the `sk_test_...` key. If you want to try subscriptions, also set the
   test-mode versions of `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_PRO_PLUS_PRICE_ID`
   (and the yearly ones) because live price ids do not exist in test mode.
4. Redeploy. The start-up log line should say `Stripe: enabled (non-live key)`.

Test card number: `4242 4242 4242 4242`, any future date, any CVC.

Tip: set these variables on the **preview environment only**, never on production. Better still, set
them once on the template environment that previews are copied from.

## Allowing a mailbox to receive email from a preview

1. Make sure the preview has a mail provider key (`POSTMARK_API_KEY`), ideally a Postmark _sandbox_
   server token so nothing real can go wrong. Without one, nothing is sent regardless.
2. Set `MAIL_PREVIEW_ALLOWLIST` on the preview environment to a comma-separated list. Entries are full
   addresses or whole domains:

   ```
   MAIL_PREVIEW_ALLOWLIST=reviewer@example.com,@my-team.example
   ```

3. Redeploy. An email is sent for real only when **every** recipient on it is on the list; if even
   one is not, the whole email is held back. Subdomains are not included (`@my-team.example` does not
   cover `a@mail.my-team.example`). Wildcards (`*`) are ignored.

Leave it empty to send nothing at all.

## The outbox (where held-back email goes)

When no mail provider is set up, or an email is held back in a preview, the server writes a small
file into `outbox/` and does not send anything. The file only says: when, how many
recipients, which template, and a message id. It never contains the
subject, the body, any link, or text a user typed. (The Email Centre in the admin still lists the
send as `outbox`.)

The file never holds an address, subject or body, in any environment. The automated browser tests
(`NODE_ENV=test`, or `EVENTFLOW_OUTBOX_FULL=1` in local development) keep the full email in the
server's memory instead, and read it from the test-only `GET /__e2e/mail` route to follow the
verification link. That is ignored in production and in previews.

Because previews never keep the link, a reviewer who signs up on a preview will not get a
verification email unless their address is allowlisted. Use the seeded reviewer account below, or an
admin can verify them from the admin Users page.

## A supplier account for reviewers

The repository has no stand-alone seed script. Seeding is done by `seed.js`, which the server runs
when it starts. It only creates the demo accounts when `NODE_ENV` is **not** `production` (a safety
rule so known passwords never reach production), and previews normally run with `NODE_ENV=production`.
To create the demo supplier on a preview, run this once from a checkout of the repository, with the
Railway CLI logged in and linked to the project:

```bash
railway run --environment EventFlow-pr-1839 -- env NODE_ENV=development node -e "require('./seed').seed({ skipIfExists: false }).then(() => process.exit(0), e => { console.error(e); process.exit(1); })"
```

Replace `1839` with the pull request number. This creates (if missing) `supplier@eventflow.local`
(password `Supplier123!`), `admin@eventflow.local` and a customer, plus demo suppliers and packages.

Before you run it, **check that the preview's `MONGODB_URI` points at the preview's own database and
not at production**: the command writes to whichever database the environment names. Those demo
passwords are public, so only do this on a preview you will delete, and never on production. This
command has not been run against a real preview from the repository's tooling; check the log lines it
prints.

## For developers

- Stripe: every place that builds a Stripe client reads the key through
  `getSafeStripeSecretKey()` (or `getSafeBillingStripeKey()` for the billing alias route), so a new
  Stripe client must do the same. Billing 503 answers go through `billingUnavailableBody()`.
- Email: all sending goes through `utils/postmark.js` `sendMail()`, which calls
  `evaluateMailPolicy(to)` first.
- Tests: `tests/unit/preview-safety.test.js`, `tests/unit/postmark-outbox-safety.test.js`,
  `tests/integration/preview-billing-guard.test.js`.
