# Photos page (`/gallery`)

Where a supplier adds, reviews and removes the photos on their profile and on each package.
`public/gallery.html`, `public/assets/css/gallery.css` (only this page loads it),
`public/assets/js/pages/gallery-init.js`. The page is behind the same sign-in redirect as the other
protected pages (`protectedHtmlPages` in `server.js`).

The Edit profile screen on the supplier dashboard has its own, smaller Photos field
(`supplier-gallery.js`, see `supplier-photo-management.md`); this page is the fuller manager it links
to ("Manage all profile photos") and the one the packages' "Photos" links open.

## How it looks

Same visual language as the dashboards and the Settings page: the warm page background, white cards
with a hairline border and 16px radius, one teal accent, 44px buttons, no tinted cards, gradients or
emoji. The tokens at the top of `gallery.css` (`--gl-*`) are copies of the dashboards' own, and
`tests/unit/gallery-page.test.js` fails if they drift apart.

Top to bottom: a hero (title, one line, "Back to dashboard"), a **Gallery** picker, an **Add photos**
card (drop zone, the files waiting to upload, progress, Upload), and a **Your photos** card (a grid
of tiles with View and Delete, a status filter when needed). Deleting asks in a native `<dialog>`;
viewing opens a full-screen native `<dialog>` with arrow-key navigation. Everything is reported on the
page (status lines, the dialogs) and nothing uses `alert()` or `confirm()`.

## Which gallery

The page manages one gallery at a time, chosen with the picker (profiles first, then packages).
Links choose it too, and the address always reflects the choice:

| Link                             | Opens                           |
| -------------------------------- | ------------------------------- |
| `/gallery?type=supplier&id=<id>` | that profile                    |
| `/gallery?type=package&id=<id>`  | that package                    |
| `/gallery?supplierId=<id>`       | that profile (older links)      |
| `/gallery`                       | the account's own first profile |

An id that is not one of the account's galleries falls back to its own profile (admins excepted: the
server decides for them). `tests/unit/gallery-page.test.js` fails if a `/gallery?...` link anywhere on
the site stops following `type=` and `id=`.

What each visitor sees: a supplier gets the cards; a supplier with no profile is told to create one;
a customer (or any account that is not a supplier) is told galleries are for suppliers, with a link
back to their dashboard; someone not logged in is asked to log in; if the lists cannot be loaded at
all (connection or server error) the page says that, with Try again, rather than claiming the account
is not a supplier.

## Where the data comes from

| What                                   | Request                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------ |
| The account                            | `GET /api/v1/auth/me`                                                    |
| The galleries it can manage            | `GET /api/me/suppliers`, `GET /api/me/packages` (supplier accounts only) |
| A profile's / a package's photos       | `GET /api/me/suppliers/:id/photos`, `GET /api/me/packages/:id/photos`    |
| The plan's photo limit (profiles only) | `GET /api/v2/subscriptions/me` (`limits.maxPhotos`)                      |
| Upload                                 | `POST /api/photos/upload/batch?type=&id=` (multipart, field `photos`)    |
| Delete a profile photo                 | `DELETE /api/me/suppliers/:id/photos/:photoId`                           |
| Delete a package photo                 | `DELETE /api/me/packages/:id/photos` with `{ url }`                      |

Every write carries the CSRF token (`X-CSRF-Token`, from `window.__CSRF_TOKEN__` or
`GET /api/csrf-token`) and is retried once with a fresh token if the server refuses it as a CSRF
failure. The page before this one sent the upload with no token at all and asked an endpoint that
does not exist for the delete's token, so neither could be relied on to work.

## Behaviour worth knowing

- **Choosing files adds to the list**, with a thumbnail, size and a remove button each; picking the
  same file twice lists it once. Not a JPEG/PNG/WebP/GIF, over 10 MB, more than 10 at a time (the
  server's limit) or more than the plan has room for are each refused with the file's name and why.
- **The upload reports real progress** (an `XMLHttpRequest`; `fetch` cannot), and while it runs the
  picker, the buttons and the remove buttons are off, so nothing is sent twice.
- **A partly failed upload keeps what worked.** The server answers per file; the page lists which
  photos failed and why, and keeps only the ones that did not upload. A refused upload (plan limit,
  rate limit, a dropped connection) keeps all the chosen photos so it can be tried again.
- **Photos held for approval** (when moderation is on, the server answers `pending: true`) are said
  to be held; they appear in the grid once approved, because the owner's list only returns approved
  photos. A tile that does say "Awaiting approval" gets the status filter.
- **Package photo ids are positions** (`photo_0`, `photo_1`, ...), so the list is reloaded after every
  delete; a package photo is deleted by its address, a profile photo by its id.
- **A slow answer for a gallery that is no longer shown is dropped** (`loadSeq`), so switching the
  picker quickly cannot leave one gallery's photos under another's name.
- **After a delete, focus moves to the "Your photos" heading**, because the button that had it is
  gone. Closing the viewer or the delete dialog returns focus to the button that opened it.
- **An admin who opens a gallery by link** sees no plan limit, because the lookup would return the
  admin's own plan, not the owner's.
- **Image addresses are only used when they are web addresses or site paths**; everything else is
  built with text nodes, so a photo's name or address cannot inject markup.

## Tests

- `tests/unit/gallery-page.test.js`: tokens match the dashboards, no emoji or gradients, no
  `alert()`/`confirm()`, CSRF handling, the inbound-link contract.
- `tests/unit/gallery-page-behaviour.test.js`: the real page and script in jsdom against a scripted
  API (`tests/helpers/gallery-page-scenarios.js`, run in a child process because jsdom cannot be
  loaded inside Jest here): which gallery opens, each kind of visitor, filtering, choosing files,
  uploading (CSRF retry, partial failure, plan limit, dropped connection), deleting, the viewer.
- `e2e/gallery-page.spec.js`: a real browser: a real multipart upload with the CSRF token, the delete
  dialog and Escape, the viewer's keyboard, a phone layout that does not scroll sideways, and axe.
