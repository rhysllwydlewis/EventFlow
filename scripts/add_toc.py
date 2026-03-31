#!/usr/bin/env python3
"""
Add a Table of Contents (TOC) to all 25 guide articles in public/articles/.

Two layouts are handled:
  CARD   – content in <div class="card"> blocks
  ARTICLE – content in <div class="article-content">
"""

import re
import os
from bs4 import BeautifulSoup, NavigableString, Tag

ARTICLES_DIR = os.path.join(
    os.path.dirname(__file__), "..", "public", "articles"
)

CARD_FILES = [
    "accessibility-at-events-guide.html",
    "budget-planner-guide.html",
    "choosing-event-caterer-guide.html",
    "destination-wedding-planning-guide.html",
    "entertainment-guide.html",
    "event-decoration-styling-guide.html",
    "event-insurance-guide.html",
    "event-photography-shot-list-guide.html",
    "event-planning-checklist-guide.html",
    "guest-list-management-guide.html",
    "hiring-suppliers-on-eventflow-guide.html",
    "how-to-write-wedding-speech.html",
    "marketplace-guide.html",
    "outdoor-events-uk-guide.html",
    "seasonal-event-planning-guide.html",
    "second-hand-wedding-items-guide.html",
    "wedding-stationery-invitations-guide.html",
]

ARTICLE_FILES = [
    "birthday-party-planning-guide.html",
    "corporate-event-planning-guide.html",
    "event-budget-management-guide.html",
    "event-photography-complete-guide.html",
    "perfect-wedding-day-timeline-guide.html",
    "sustainable-event-planning-guide.html",
    "wedding-catering-trends-2024.html",
    "wedding-venue-selection-guide.html",
]


def make_slug(text: str) -> str:
    """
    Convert heading text to a URL-safe slug.

    Rules (in order):
    1. Strip non-ASCII (removes emojis and accented chars)
    2. Lowercase
    3. Remove leading "N. " numbering (e.g. "1. Getting Ready" → "Getting Ready")
    4. Replace any run of non-alphanumeric chars with a single hyphen
    5. Strip leading/trailing hyphens
    6. Limit to 50 characters (trim at last hyphen boundary)
    """
    # 1. Strip non-ASCII characters (removes emojis, special Unicode)
    text = text.encode("ascii", errors="ignore").decode("ascii")
    # 2. Lowercase
    text = text.lower()
    # 3. Remove leading numbering like "1. " or "1) "
    text = re.sub(r"^\d+[\.\)]\s*", "", text)
    # 4. Replace runs of non-alphanumeric chars with a single hyphen
    text = re.sub(r"[^a-z0-9]+", "-", text)
    # 5. Strip leading/trailing hyphens
    text = text.strip("-")
    # 6. Limit to 50 chars, trim at a hyphen boundary if possible
    if len(text) > 50:
        text = text[:50].rstrip("-")
    return text


def unique_slug(base: str, seen: set) -> str:
    """Return a deduplicated slug, appending -2, -3, … as needed."""
    slug = base
    counter = 2
    while slug in seen:
        slug = f"{base}-{counter}"
        counter += 1
    seen.add(slug)
    return slug


def build_toc_html(entries: list) -> str:
    """
    Build the TOC HTML string from a list of (slug, heading_text) tuples.
    """
    items = "\n".join(
        f'          <li class="article-toc__item">'
        f'<a href="#{slug}">{text}</a></li>'
        for slug, text in entries
    )
    return (
        "\n      <details class=\"article-toc\" open>\n"
        "        <summary>In this guide</summary>\n"
        "        <ol class=\"article-toc__list\">\n"
        f"{items}\n"
        "        </ol>\n"
        "      </details>\n"
    )


def is_in_excluded_section(tag: Tag) -> bool:
    """Return True if the tag is inside an excluded container."""
    excluded_classes = {"article-related", "callout", "article-end-cta", "article-cta-card"}
    for parent in tag.parents:
        if isinstance(parent, Tag):
            parent_classes = set(parent.get("class", []))
            if parent_classes & excluded_classes:
                return True
    return False


def process_card_file(filepath: str) -> None:
    """Add TOC to a CARD-layout article."""
    with open(filepath, "r", encoding="utf-8") as fh:
        content = fh.read()

    # Skip if TOC already present
    if 'class="article-toc"' in content:
        print(f"  SKIP (already has TOC): {os.path.basename(filepath)}")
        return

    soup = BeautifulSoup(content, "html.parser")

    # Collect h2 headings from .card divs (but not from excluded subsections)
    seen_slugs: set = set()
    entries: list = []

    card_divs = soup.find_all("div", class_="card")
    for card in card_divs:
        for h2 in card.find_all("h2", recursive=True):
            if is_in_excluded_section(h2):
                continue
            # Skip the CTA h2 inside article-cta-card
            if h2.find_parent(class_="article-cta-card"):
                continue
            text = h2.get_text(separator=" ", strip=True)
            base = make_slug(text)
            if not base:
                continue
            slug = unique_slug(base, seen_slugs)
            h2["id"] = slug
            entries.append((slug, text))

    if not entries:
        print(f"  WARN (no headings found): {os.path.basename(filepath)}")
        return

    toc_html = build_toc_html(entries)

    # Find the hero image tag
    hero_img = soup.find("img", class_="article-hero-image")
    if hero_img is None:
        print(f"  WARN (no hero image): {os.path.basename(filepath)}")
        return

    # Insert TOC as parsed HTML directly after the hero image
    toc_soup = BeautifulSoup(toc_html, "html.parser")
    hero_img.insert_after(toc_soup)

    with open(filepath, "w", encoding="utf-8") as fh:
        fh.write(str(soup))

    print(f"  OK ({len(entries)} sections): {os.path.basename(filepath)}")


def process_article_file(filepath: str) -> None:
    """Add TOC to an ARTICLE-layout article."""
    with open(filepath, "r", encoding="utf-8") as fh:
        content = fh.read()

    # Skip if TOC already present
    if 'class="article-toc"' in content:
        print(f"  SKIP (already has TOC): {os.path.basename(filepath)}")
        return

    soup = BeautifulSoup(content, "html.parser")

    article_content = soup.find("div", class_="article-content")
    if article_content is None:
        print(f"  WARN (no article-content div): {os.path.basename(filepath)}")
        return

    # Collect h2 headings from article-content (but not in excluded sections)
    seen_slugs: set = set()
    entries: list = []

    for h2 in article_content.find_all("h2", recursive=True):
        if is_in_excluded_section(h2):
            continue
        text = h2.get_text(separator=" ", strip=True)
        base = make_slug(text)
        if not base:
            continue
        slug = unique_slug(base, seen_slugs)
        h2["id"] = slug
        entries.append((slug, text))

    if not entries:
        print(f"  WARN (no headings found): {os.path.basename(filepath)}")
        return

    toc_html = build_toc_html(entries)

    # Insert TOC as the first child of article-content
    toc_soup = BeautifulSoup(toc_html, "html.parser")
    # Insert before the first child (which may be whitespace)
    first_child = article_content.find(True)  # first tag child
    if first_child:
        first_child.insert_before(toc_soup)
    else:
        article_content.append(toc_soup)

    with open(filepath, "w", encoding="utf-8") as fh:
        fh.write(str(soup))

    print(f"  OK ({len(entries)} sections): {os.path.basename(filepath)}")


def main() -> None:
    print("=== Processing CARD-layout articles ===")
    for filename in CARD_FILES:
        path = os.path.join(ARTICLES_DIR, filename)
        if not os.path.exists(path):
            print(f"  MISSING: {filename}")
            continue
        process_card_file(path)

    print("\n=== Processing ARTICLE-layout articles ===")
    for filename in ARTICLE_FILES:
        path = os.path.join(ARTICLES_DIR, filename)
        if not os.path.exists(path):
            print(f"  MISSING: {filename}")
            continue
        process_article_file(path)

    print("\nDone.")


if __name__ == "__main__":
    main()
