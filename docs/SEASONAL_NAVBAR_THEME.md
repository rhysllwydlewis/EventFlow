# Seasonal navbar theme

A small themed decoration on the public navbar for UK occasions: Halloween, Bonfire
Night, Remembrance, Christmas, New Year, Valentine's Day, Chinese New Year,
Mother's Day, Easter and Father's Day. It is decorative only: it sits behind the
header content, ignores the pointer, is clipped to the header and never changes the
header's height.

## How a theme is chosen

Which theme (if any) shows is a pure function of the saved admin settings and today's
date in the UK. There is no timed job. A job can be missed by a restart or a deploy,
or run twice across instances; a rule evaluated on demand cannot.

- `services/seasonalTheme.service.js` is the whole rule. It takes the saved settings
  and a `Date` and returns a theme key or `null`. It works on whole calendar days in
  `Europe/London`, so a theme switches on at 00:00 UK time on the first day and off
  after the last day, and the clock changes cannot shift a date.
- `GET /api/public/seasonal-theme` answers `{ "theme": "halloween" }` or
  `{ "theme": null }`. Its cache never outlives the next UK midnight, and is five
  minutes at most, so a changeover reaches visitors within about five minutes. If
  anything fails it answers `null` and the header stays plain.
- `public/assets/js/navbar.js` loads `seasonal-theme.js` on every public page. That
  loader asks the endpoint once and does nothing unless a theme is named. Only then
  does it download `seasonal-theme-art.js` and `seasonal-theme.css`, so the rest of
  the year costs one tiny request.

## Settings

Stored as `settings.seasonalTheme` and edited in **Admin > System Settings > Seasonal
Navbar Theme** (`GET`/`PUT /api/admin/settings/seasonal-theme`, audit action
`SEASONAL_THEME_UPDATED`).

| Field            | Meaning                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `auto`           | `true`: follow each occasion's dates. `false`: use `manualTheme`.       |
| `manualTheme`    | An occasion key, or `null` for the normal site (only when auto is off)  |
| `returnToAutoOn` | Optional `YYYY-MM-DD`; from that day a manual choice hands back to auto |
| `excluded`       | Occasion keys the automatic schedule skips                              |

**Nothing saved means no theme.** Shipping this changes nothing until an admin turns
it on.

## Dates

| Occasion         | Window                                                      |
| ---------------- | ----------------------------------------------------------- |
| Chinese New Year | The day before to seven days after (lookup table)           |
| Easter           | Ten days before Easter Sunday to Easter Monday              |
| Mother's Day     | The week up to Mothering Sunday (three weeks before Easter) |
| Father's Day     | The week up to the third Sunday in June                     |
| Halloween        | 20 Oct to 1 Nov                                             |
| Bonfire Night    | 2 Nov to 6 Nov                                              |
| Remembrance      | 7 Nov to Remembrance Sunday (never earlier than the 11th)   |
| Christmas        | 1 Dec to 26 Dec                                             |
| New Year         | 27 Dec to 2 Jan                                             |
| Valentine's Day  | 8 Feb to 14 Feb                                             |

The list above is in priority order. When windows overlap, the earlier one wins, so
the occasions whose dates move each year come first (Chinese New Year beats
Valentine's Day in the years they collide).

**Chinese New Year uses a lookup table** (`CHINESE_NEW_YEAR` in the service) covering
2025 to 2035. Outside it that occasion stays off rather than showing a wrong date.
The admin card warns when the table is within two years of running out. Extending it
is one line per year.

## Adding or changing an occasion

1. Add it to `OCCASIONS` in `services/seasonalTheme.service.js` (key, name, `window`).
2. Add the artwork to `THEMES` in `public/assets/js/seasonal-theme-art.js` (a
   `mark`, optionally an `edge` and `corner`).
3. Bump the version in `seasonal-theme.js` (`ASSET_VERSION`) and the `?v=` that
   `navbar.js` uses to load it. Assets are cached for seven days.
4. `tests/unit/seasonal-theme-*.test.js` check the rule against the real calendar,
   that every theme is well-formed SVG, and that the browser and server theme lists
   match.

## Rolling it back

Switch auto off and choose **None** in the admin card; the plain site is back within
about five minutes. To remove the feature entirely, delete `ensureSeasonalTheme()`
from `navbar.js` and bump its `?v=` on every page.

## Why the artwork looks the way it does

- One small mark sits just past the end of the wordmark, placed from the wordmark's
  measured size so it follows the logo at every breakpoint.
- Edge art is two small clusters pinned to the far left and right of the header, each
  fading out well before the links, so the middle of the bar is always clear.
- Everything animated uses declarative SVG animation and is switched off for visitors
  who prefer reduced motion. Remembrance never moves.
