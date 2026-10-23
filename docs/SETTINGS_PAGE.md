# Settings page (`/settings`)

One page for customers and suppliers (admins see it without the Account type card).
`public/settings.html`, `public/assets/css/settings.css` (only this page loads it),
`public/assets/js/pages/settings-init.js`, and the API in `routes/settings.js`.

## Where the data comes from

| What                                                                        | Request                                                                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Name, email, phone, location, postcode, role, photo                         | `GET /api/v1/auth/me`, saved with `PUT /api/profile`                                                       |
| Every preference (notify, digest, newsletter status, reminders, `verified`) | `GET /api/me/settings`, saved with `POST /api/me/settings`                                                 |
| Newsletter                                                                  | `POST /api/newsletter/subscribe` / `unsubscribe` (double opt-in, so the status becomes "check your inbox") |
| Photo                                                                       | `POST` / `DELETE /api/profile/avatar`                                                                      |
| Password                                                                    | `POST /api/auth/change-password`                                                                           |
| Resend verification email                                                   | `POST /api/v1/auth/resend-verification`                                                                    |
| Account type                                                                | `POST /api/v1/me/settings/account-type`                                                                    |
| Delete account                                                              | `DELETE /api/profile` with the account email                                                               |

The two loads run in parallel and the settings are read once. `GET /api/me/settings` loads the
signed-in user with `findOne`, not the whole `users` collection.

## Behaviour worth knowing

- **Preferences are saved together.** "Save preferences" sends `notify` always, and everything
  else (digest, supplier reminders, saved-supplier and verification reminders) only after the
  saved values were read. If that read failed, saving cannot overwrite the person's real choices
  with the page's defaults.
- **Sound and volume are kept on the device** (`localStorage`), and are written only after the
  server save succeeded, so a failed save never leaves the page half-changed.
- **The newsletter button uses the account's saved email**, never what is typed in the email box.
- **A failed account load shows a retry**, not an empty form: saving blank fields would wipe the
  person's details.
- **Unverified accounts** see a notice with "Send verification email", and the verification
  reminder toggle.
- **Confirmations are native `<dialog>` elements** (remove photo, switch to customer, the
  three-step delete): focus stays inside, Escape closes, focus returns to the button, and the page
  behind is inert. The switch-to-customer button stays off until `CONVERT` is typed.
- **The page's `ef-page` tag is `account_settings`, not `settings`.** `app.js` still contains an
  old `initSettings()` that runs for the `settings` tag: it adds a second Save handler and
  replaces the whole page with "Unable to load settings." if its request fails. The function is
  dead for every page now; deleting it needs an `app.js` version bump on all 90 pages that load
  it, so it is left for a change that bumps them.
- **Status colours** are `data-state` on the status element (`success`, `error`, `warn`, `info`)
  coloured from the stylesheet with AA shades; nothing sets a colour inline.

## Decisions

- **No self-service data export.** The privacy policy (section 10.4) says to request a data export
  by email. A self-service download has to be complete across every collection that holds a
  person's data to be honest about that, which needs its own audit; an incomplete export would be
  worse than the documented process.
- **No Restart Tour card.** It removed a `localStorage` key nothing reads, and there is no tour.
