# EventFlow Guide Content Pack

## Purpose

This document records the next high-value EventFlow guide pack after reviewing the current `/guides` library. The existing guide library already covers the broad basics: venue selection, catering, photography, timelines, sustainability, budgeting, corporate events, parties, marketplace use, entertainment, guest lists, decor, stationery, destination weddings, checklists, speeches, second-hand wedding items, seasonal planning, accessibility, insurance, hiring suppliers and outdoor events.

The main gap is not simply more generic wedding-blog content. The stronger opportunity is product-led, conversion-led content that points users into EventFlow's own planning flows, supplier directory, marketplace, public events calendar and supplier dashboard.

## Sense-check summary

The next guides should prioritise:

1. Customer workflows that reduce planning friction.
2. Supplier workflows that improve profile quality and enquiry conversion.
3. UK-specific practical guidance that builds trust.
4. Internal links to EventFlow tools rather than only general advice.
5. Search intent that is close to action, such as RSVP management, seating plans, supplier pricing and public wedding fayres.

## Recommended first implementation pack

These eight guides should be built first because they fill the biggest product and conversion gaps.

| Priority | Guide title | Suggested slug | Category | Primary CTA | Reason |
|---:|---|---|---|---|---|
| 1 | How to Build Your Wedding Website on EventFlow | `/articles/wedding-website-on-eventflow-guide` | Tools | Create website | Strong wedding SEO and directly supports EventFlow's planning product. |
| 2 | RSVP Management Guide: Replies, Dietary Needs and Plus-Ones | `/articles/rsvp-management-guide` | Planning | Manage RSVPs | Extends the existing guest-list content into a practical workflow. |
| 3 | Seating Plan Guide: Tables, Guests and Layouts | `/articles/seating-plan-guide` | Planning | Plan guests | Practical pain point, closely linked to guest management and venue layout. |
| 4 | Wedding Fayres and Public Events Calendar Guide | `/articles/wedding-fayres-public-events-calendar-guide` | Tools | View events | Supports the public events calendar and supplier open-day use case. |
| 5 | Supplier Profile Guide: How to Get More Enquiries on EventFlow | `/articles/supplier-profile-optimisation-guide` | Tools | Supplier dashboard | Helps suppliers improve profile quality and convert more enquiries. |
| 6 | Supplier Packages and Pricing Guide | `/articles/supplier-packages-pricing-guide` | Tools | Browse suppliers | Useful to both customers comparing packages and suppliers creating packages. |
| 7 | Event Contracts, Deposits and Cancellation Terms Guide | `/articles/event-contracts-deposits-guide` | Planning | Find suppliers | High-trust planning content covering deposits, written terms and change control. |
| 8 | Event Licences and Legal Basics in the UK | `/articles/event-licences-uk-guide` | Planning | Start planning | UK-specific trust content covering alcohol, entertainment, food, music and council permissions. |

## Recommended guide structure

Each guide should follow the existing EventFlow article pattern:

- Server/static article page under `public/articles/<slug>.html`.
- Entry added to `public/assets/data/guides.json`.
- Sitemap entry added to `public/sitemap.xml`.
- Article metadata: title, description, canonical, Open Graph, Twitter card and Article JSON-LD.
- Breadcrumb JSON-LD.
- Article hero image using known working Pexels URLs already used elsewhere in the repository.
- Practical table of contents.
- 4 to 6 content sections with short, scannable paragraphs or lists.
- EventFlow CTA card linking to the relevant tool.
- Related guides block.
- Guide feedback component.
- UK English throughout.

## Quality bar

The content should not feel like generic AI filler. Each guide must:

- Give specific EventFlow use cases.
- Mention the actual workflow the user should follow.
- Use plain UK English.
- Avoid vague filler such as "make your day special" unless supported by practical steps.
- Include clear warnings where appropriate, especially around legal, contract or deposit topics.
- Avoid overpromising on legal or regulatory guidance.
- Link to official sources where guidance may change.

## Source checks for the legal guide

For the UK legal basics guide, use current official sources rather than memory. At minimum, check:

- GOV.UK Temporary Event Notice guidance.
- GOV.UK alcohol licensing guidance.
- Food Standards Agency food business registration guidance.
- PPL PRS / TheMusicLicence guidance for public music use.
- Relevant local authority guidance where local permissions may vary.

The article must state that it is practical planning information, not legal advice, and users should check the relevant local authority before relying on a licence position.

## Implementation checklist

Before opening the content PR:

- [ ] Confirm no selected slug already exists.
- [ ] Add eight new article HTML files.
- [ ] Add eight new `guides.json` entries with unique IDs after the current highest ID.
- [ ] Add eight sitemap entries.
- [ ] Use only working image URLs.
- [ ] Validate JSON syntax.
- [ ] Check all CTA links exist or intentionally point to planned routes.
- [ ] Check `/guides` search, filter and newest sort still work.
- [ ] Check each article loads directly without JavaScript errors.
- [ ] Check mobile layout does not break the hero, TOC, CTA or feedback blocks.

## Follow-up content ideas

After the first eight, the next useful batch would be:

- Wedding Supplier Questions Checklist.
- How to Compare Event Suppliers Properly.
- Wedding Decor Hire vs Buying Second-Hand.
- Hen Party Planning Guide.
- Engagement Party Planning Guide.
- Baby Shower Planning Guide.
- Christenings and Naming Ceremonies Guide.
- Charity Fundraiser Planning Guide.
- School Prom Planning Guide.
- Awards Night Planning Guide.
- Hybrid and AV Event Planning Guide.
- Food Allergy and Dietary Requirements Guide.
