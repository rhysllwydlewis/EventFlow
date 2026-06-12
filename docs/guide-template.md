# EventFlow Guide Frontmatter Template

Use this checklist when adding or refreshing a guide so `/guides`, article schema, sitemap entries and preview cards stay complete.

```yaml
title: 'Clear, search-friendly guide title'
description: 'One sentence meta description, ideally 120-160 characters.'
summary: 'TL;DR shown on guide preview cards.'
category: 'Planning'
tags: ['planning', 'wedding', 'budget']
primaryTag: 'planning'
difficulty: 'Beginner' # Beginner | Intermediate | Advanced
readingMins: 8
publishedDate: '2026-03-01'
lastUpdated: '2026-03-15'
author: 'EventFlow Team'
image: 'https://...'
ogImage: 'https://...'
href: '/articles/example-guide'
```

## Required checks

- View source includes `title`, meta description, canonical, Open Graph and Twitter card tags.
- Article JSON-LD includes `headline`, `description`, `image`, `author`, `publisher`, `datePublished` and `dateModified`.
- Breadcrumb JSON-LD matches the visible breadcrumb trail.
- H2/H3 headings have stable IDs and the in-article TOC links to those anchors.
- The guide is listed in `public/assets/data/guides.json` so guide cards, ItemList schema and sitemaps stay in sync.
- The “Report outdated” link opens a prefilled GitHub issue with the guide URL.
