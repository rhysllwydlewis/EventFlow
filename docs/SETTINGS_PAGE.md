# Settings page (`/settings`)

One page for customers and suppliers (admins see it without the Account type card).
`public/settings.html`, `public/assets/css/settings.css` (only this page loads it),
`public/assets/js/pages/settings-init.js`, and the API in `routes/settings.js`.

## How it looks

The page uses the dashboards' visual language (`customer-dashboard-home.css`,
`supplier-dashboard-home.css`): the warm page background, white cards with a hairline border and
16px radius, one teal accent, 44px buttons with the same primary / secondary / danger treatment,
hairline-separated rows, and no tinted cards, gradients or emoji. The tokens at the top of
`settings.css` (`--st-*`) are copies of the dashboards' own, and `tests/unit/settings-page.test.js`
fails if they drift apart.

Layout: a hero (title, one-line intro, "Back to dashboard" for customers and suppliers), then a
sticky section list on the left (a sideways-scrolling row on phones) beside a stack of cards:
Account information, Account type (not for admins), Notification preferences, Change password,
Danger zone. Confirmations are dialogs styled to match.

Two things in the markup are there for shared scripts, not for looks: each password input sits in
its own `.form-row` wrapper, because `app.js` attaches the show/hide button to
`.form-row input[type="password"]`; and the `ef-page` tag stays `account_settings` (below).

## Where the data comes from

| What                                                                        | Request                                                                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Name, email, phone, location, postcode, role, photo                         | `GET /api/profile`, saved with `PUT /api/profile`                                                          |
| Every preference (notify, digest, newsletter status, reminders, `verified`) | `GET /api/me/settings`, saved with `POST /api/me/settings`                                                 |
| Newsletter                                                                  | `POST /api/newsletter/subscribe` / `unsubscribe` (double opt-in, so the status becomes "check your inbox") |
| Photo                                                                       | `POST` / `DELETE /api/profile/avatar`                                                                      |
| Password                                                                    | `POST /api/auth/change-password`                                                                           |
| Resend verification email                                                   | `POST /api/v1/auth/resend-verification`                                                                    |
| Account type                                                                | `POST /api/v1/me/settings/account-type`                                                                    |
| Delete account                                                              | `DELETE /api/profile` with the account email                                                               |

The account comes from `GET /api/profile`, not `GET /api/v1/auth/me`: `/auth/me` leaves the phone
number out, so the field loaded empty and every save erased the saved number.

The two loads run in parallel and the settings are read once. `GET /api/me/settings` loads the
signed-in user with `findOne`, not the whole `users` collection.

## Behaviour worth knowing

- **Preferences are saved together.** "Save preferences" sends `notify` always, and everything
  else (digest, supplier reminders, saved-supplier and verification reminders) only after the
  saved values were read. If that read failed, saving cannot overwrite the person's real choices
  with the page's defaults.
- **The email address is read-only.** `PUT /api/profile` has never changed it, so an editable
  field promised a verification email that was never sent. The field shows the sign-in address
  with a link to Contact us; the page never sends `email` when saving.
- **Phone numbers are stored compact.** The server strips spaces, brackets, dots and dashes
  (`+44 7700 900123` is kept as `+447700900123`) and refuses anything that is not a phone number;
  an empty value clears it.
- **Refreshing after a save keeps unsaved preference edits.** Only the first load fills the
  preference controls.
- **Sound and volume are kept on the device** (`localStorage`), and are written only after the
  server save succeeded, so a failed save never leaves the page half-changed. "Test sound" and the
  volume slider are really disabled while the sound is off.
- **The newsletter button uses the account's saved email**, never what is typed in the email box,
  and shows the server's own message when refused (including the rate limiter's plain-text one).
- **A failed account load shows a retry**, not an empty form: saving blank fields would wipe the
  person's details.
- **Unverified accounts** see a notice with "Send verification email", and the verification
  reminder toggle.
- **Confirmations are native `<dialog>` elements** (remove photo, switch to customer, the
  three-step delete): focus stays inside, Escape closes, focus returns to the button, and the page
  behind is inert. The switch-to-customer button stays off until `CONVERT` is typed.
- **The page's `ef-page` tag is `account_settings`, not `settings`.** `app.js` used to run an old
  `initSettings()` for the `settings` tag (a second Save handler, and the whole page replaced by
  "Unable to load settings." if its request failed). It is deleted, but visitors can hold a cached
  `app.js` older than 18.5.11 for a week, so the tag stays different.
- **Status colours** are `data-state` on the status element (`success`, `error`, `warn`, `info`)
  coloured from the stylesheet with AA shades; nothing sets a colour inline.

## Decisions

- **No self-service data export.** The privacy policy (section 10.4) says to request a data export
  by email. A self-service download has to be complete across every collection that holds a
  person's data to be honest about that, which needs its own audit; an incomplete export would be
  worse than the documented process.
- **No Restart Tour card.** It removed a `localStorage` key nothing reads, and there is no tour.
