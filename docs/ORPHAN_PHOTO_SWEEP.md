# Orphaned photo images

An upload stores four images (original, thumbnail, optimised, large) in the `photos` collection, and
each is publicly readable at `/api/photos/<id>`. Several things used to leave images behind that
nothing uses any more: a photo deleted before every copy was deleted with it, a package or supplier
deleted along with its photos, a rejected moderation photo, a gallery write that failed after the
images were stored, and uploads by the older routes that recorded only one of the four addresses.

Two things deal with them.

## Deleting them as they happen

These now delete the stored images along with the record, using `deleteUnusedStoredCopies`
(`utils/photoStoredCopies.js`), which keeps an image another record still uses, keeps one recorded
as belonging to another user, and keeps everything if it cannot tell:

| Action                                            | Where                                                    |
| ------------------------------------------------- | -------------------------------------------------------- |
| Delete a photo from a supplier or package gallery | all four delete routes (see `docs/GALLERY_PAGE.md`)      |
| A photo that could not be saved                   | every upload route (see `docs/api/API_DOCUMENTATION.md`) |
| Reject a held photo                               | `POST /api/admin/photos/:id/reject`                      |
| A supplier deletes their package                  | `DELETE /api/me/packages/:id`                            |
| An admin deletes a package                        | `DELETE /api/admin/packages/:id`                         |
| An admin deletes a supplier                       | `DELETE /api/admin/suppliers/:id` (`routes/admin.js`)    |

**Not wired** (these do not have the photo storage injected, and add up to a long tail of admin-only
paths): deleting a user (`routes/admin-user-management.js`), the admin v2 supplier and package
deletes (`routes/admin-v2.js`), duplicate-supplier merging and bulk deletes (`routes/admin.js`), and
an admin deleting a package whose supplier is already gone. Their images are left for the sweep.

## The sweep

`scripts/sweep-orphan-photos.js` finds, and optionally deletes, images nothing uses. It is meant to be
run by a person, now and then, not on a schedule.

```bash
node scripts/sweep-orphan-photos.js                 # report only (the default)
node scripts/sweep-orphan-photos.js --grace-days=30 # keep anything younger than 30 days
node scripts/sweep-orphan-photos.js --apply         # delete, up to --limit (default 5000) images
node scripts/sweep-orphan-photos.js --json          # the report as JSON
```

**Always run the report first and read it.** It prints how many images are stored, how many addresses
it found in other records, how many it would delete and how big that is, the count by type, and a
sample of ids.

**How an image is judged in use.** An image is in use if its address appears anywhere in any other
collection: any field, however deeply nested, as a plain address, with a query string, absolute, or
through the `/api/v1` route. There is no list of fields to keep up to date, so a new feature that stores
photo addresses is protected without anyone remembering to add it. Only these are not read: the stored
images themselves, the marketplace's own image store (`marketplace_images`, which the sweep never
touches), and approved or rejected moderation records (a held, `pending`, record does count).

**What it keeps whatever the scan says.** An image younger than the grace period (14 days by default,
so a photo mid-upload or held for moderation is safe), and an image with no readable creation date.

**When it refuses to delete anything**, while still printing what it found:

- No references are found anywhere. The scan must have failed.
- More than half of the images would go. The scan is probably wrong, or this is the first run against
  a database full of old-style uploads. Read the sample and the by-type counts; if it is right, pass
  `--allow-large`.

`--apply` also refuses unless the active backend is a healthy MongoDB, so a run against local
fallback storage cannot look like a clean result. Exit codes: 0 done, 1 failed, 2 refused.

**What it will find in a real database.** Besides what the lists above leave behind, any upload made
by `POST /api/me/packages/:id/photos`, package create and update with an inline image, and the older
admin routes recorded only one of the four addresses, so the other three copies are unused. Those are
real orphans and are deleted; that is also why a first run can exceed half of all images.

**What it cannot know.** An address stored somewhere that is not a MongoDB collection (for example
inside an uploaded file, or an external system), or written in a form that does not contain
`/api/photos/<id>` (for example only the bare id). The grace period and the report-first habit are the
protection against those.
