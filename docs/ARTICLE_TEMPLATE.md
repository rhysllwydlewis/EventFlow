# The premium article template

The template behind `/articles/event-travel-costs-guide`. It is designed to
carry any article — a how-to guide, an explainer, a comparison, a news post —
not only the one it was first built for.

## Starting a new article

```bash
node scripts/new-article.mjs \
  --slug wedding-transport-guide \
  --title "Wedding Transport: A Complete Guide" \
  --description "How to plan wedding transport for the couple and guests." \
  --kicker "Weddings"
```

That writes a complete, valid, accessible page: head metadata and Article
JSON-LD filled in, canonical site chrome, hero, reading rail, mobile contents
and three example sections. It refuses to overwrite an existing article, and
the page it writes already passes
`node scripts/generate-article-shells.mjs --check`.

Then register the article in `public/assets/data/guides.json` — the scaffold
prints the entry to paste. Without it the article is unreachable from the hub,
the filters and the sitemap.

Pass `--no-numbers` for an article that reads better without numbered sections.

## The rule that matters most

**Every block below is optional. Delete what the article does not need.**

The only things the template actually requires are `<body class="gp-page">`,
`<article class="gp" data-gp-article>` and the two stylesheets. Everything else
is opt-in, and the runtime no-ops on any block whose markup is absent — so an
article pays only for what it uses.

## Blocks

| Block            | Markup                                           | Notes                                                                                                                                           |
| ---------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Hero             | `.gp-hero`                                       | `.gp-hero__media` takes an optional `<img class="gp-hero__img">`; without one the hero renders on the brand gradient.                           |
| Kicker           | `.gp-eyebrow`                                    | One short category line. Plain text — not a badge.                                                                                              |
| Breadcrumb       | `.gp-breadcrumb`                                 |                                                                                                                                                 |
| Byline / meta    | `.gp-meta`                                       | Author, dates, read time. No avatars.                                                                                                           |
| Reading rail     | `.gp-rail`                                       | Progress dial, contents, share and print. Renders from 1024px.                                                                                  |
| Mobile contents  | `.gp-toc-mobile`                                 | The rail's counterpart below 1024px. Two columns from 600px.                                                                                    |
| Summary          | `.gp-takeaways`                                  | "The short version" list.                                                                                                                       |
| Section          | `.gp-section[data-gp-section]`                   | `data-gp-section` is what the scrollspy and progress dial track.                                                                                |
| Stats strip      | `.gp-stats` / `.gp-stat`                         | Figures count up on scroll. Reflows 2-up on phones, 4-up from 768px.                                                                            |
| Callout          | `.gp-note`, `.gp-note--tip`, `.gp-note--formula` |                                                                                                                                                 |
| Table            | `.gp-table-wrap` > `.gp-table`                   | The wrap is the scroll container and carries `role="region"` and `tabindex="0"`; give it `aria-labelledby` pointing at the table's `<caption>`. |
| FAQ              | `.gp-faq` / `.gp-faq__item`                      | Native `<details>`. If you use it, add matching `FAQPage` JSON-LD — a test asserts the two agree.                                               |
| Call to action   | `.gp-cta`                                        |                                                                                                                                                 |
| Related          | `.gp-related`                                    |                                                                                                                                                 |
| Footer links     | `.gp-backlinks`                                  | Also hosts the print control below 1024px.                                                                                                      |
| Reveal on scroll | `.gp-reveal`                                     | Add to any block. Pure CSS scroll-driven animation; degrades to visible, and is skipped under `prefers-reduced-motion`.                         |

## Section numbering

Never write numbers by hand. Add `gp--numbered` to the article root and a CSS
counter generates them:

```html
<article class="gp gp--numbered" data-gp-article></article>
```

Sections can then be added, moved or removed without renumbering anything.
Omit the modifier and headings close up with no other markup change.

## Article-specific widgets

Anything specific to one article's subject belongs in its own module, not in
the shared template. The worked example is the travel guide's fuel calculator:

- `src/guides/guide-travel-calculator.ts`
- `public/assets/css/guide-travel-calculator.css`

Both self-activate on `[data-gp-calc]` and are loaded only by that article, so
no other page downloads a fuel calculator. Copy the pattern rather than adding
to `guide-premium.ts` or `guide-premium.css` — a test asserts the core carries
no calculator selectors or constants.

Module scripts compile with the rest: `npm run build:guides` picks up any
`src/guides/*.ts` and the committed bundle is byte-compared in CI.

## Accessibility and motion

- All motion is behind `prefers-reduced-motion`, and reveal animations degrade
  to visible content rather than leaving prose stuck at `opacity: 0`.
- Interactive controls stay at or above the 24px WCAG 2.5.8 minimum. Inline
  links inside a sentence are exempt and are deliberately left alone.
- Both article routes are in the blocking axe suite
  (`tests/visual/visual-regression.spec.mjs`); a scaffolded article passes it
  unmodified.

## What "site chrome" covers

`scripts/generate-article-shells.mjs` owns five things in every article and
`--check` fails if any of them drifts. Do not hand-edit them:

| Block                                                           | Canonical source                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| Site header (`<header class="ef-header">`)                      | `public/guides.html`, read at generation time                      |
| Notification dropdown                                           | `NOTIFICATION_DROPDOWN_MARKUP` in `scripts/lib/article-chrome.mjs` |
| Header scripts (auth-state, burger-menu, navbar, notifications) | `HEADER_SCRIPTS` in the same module                                |
| Mobile bottom navigation                                        | `BOTTOM_NAV_MARKUP` in the same module                             |
| Footer (`<footer class="footer">`)                              | `FOOTER_MARKUP` in the same module                                 |

Adding a link to the navigation means editing `public/guides.html` and
re-running the generator; every article and every generated community page
picks it up. Everything else in the file is the article's own.

## Verifying

```bash
npm run build:guides                              # compile the TS modules
node scripts/generate-article-shells.mjs --check  # chrome is in step
npx jest tests/unit/guide-premium-template.test.js
npm run test:visual                               # visual + axe
```
