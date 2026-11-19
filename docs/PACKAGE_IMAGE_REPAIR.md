# Package image repair

Package images saved before #1884 and #1887 may still hold values that should not be
there. New writes are validated and rendering is escaped, so nothing stored is exploitable
through the site today, but the old values are still in the database. This tool finds them.

```bash
npm run repair:package-images -- --all
```

## What it finds

| Stored value                                  | What the tool does                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A base64 image (`data:image/...`)             | Converts it to a stored upload and sets `image` and `gallery`. Needs `--apply`.                |
| A `javascript:` URL or HTML / script text     | **Reports it only.** Where it is (`pkg.image`, `pkg.gallery[1].url`) and why. Never the value. |
| A usable image, an empty field, a placeholder | Leaves it alone.                                                                               |

Unsafe values are not cleared automatically. Which field to blank is a decision for a person
reading the report; the carousel escaping keeps them harmless in the meantime.

## Running it

Dry run is the default: nothing is written without `--apply`.

| Command                   | Scans                                                                      |
| ------------------------- | -------------------------------------------------------------------------- |
| `-- --all`                | Every package, short summary report                                        |
| `-- --supplierId=<id>`    | One supplier's packages, full report                                       |
| `-- --packageIds=<a>,<b>` | Named packages, full report                                                |
| `-- --all --limit=50`     | The first 50 packages                                                      |
| `-- --all --verbose`      | Full per-package report (can be very large: it includes each stored image) |
| `-- --all --apply`        | Converts every base64 image it finds                                       |

Choose exactly one of `--all`, `--supplierId` and `--packageIds`; the tool refuses a mix so a
typo cannot widen a write to the whole catalogue.

`--apply` refuses to run unless the backend is MongoDB, so a development machine's local file
store is never "repaired". Set `MONGODB_URI` and make sure the database is reachable first.

## Suggested order

1. `npm run repair:package-images -- --all` against production data, and read `needsAttention`.
2. For each package listed with `would-convert-data-uri`, check the source looks right.
3. `npm run repair:package-images -- --all --apply`, then repeat step 1: `wouldConvertDataUri`
   should now be `0`.
4. For any package with an `unsafe` entry, open it in the admin and replace the image by hand,
   then run step 1 again until `unsafePackages` is `0`.

## Reading the summary

```json
{
  "dryRun": true,
  "scanned": 412,
  "changed": 0,
  "wouldConvertDataUri": 3,
  "convertedDataUri": 0,
  "alreadyHasUsableImage": 401,
  "noUsableImageAndNothingToConvert": 8,
  "unsafePackages": 1,
  "needsAttention": [
    { "id": "pkg_123", "reason": "would-convert-data-uri", "source": "pkg.image" },
    {
      "id": "pkg_456",
      "reason": "no-data-uri-candidate",
      "unsafe": [{ "source": "pkg.image", "reason": "javascript-url" }]
    }
  ]
}
```

`noUsableImageAndNothingToConvert` packages have no image at all and show the placeholder; they
are not an error.
