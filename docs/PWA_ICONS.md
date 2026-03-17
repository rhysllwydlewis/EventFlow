# PWA Icons — EventFlow

This document explains where the Progressive Web App (PWA) icon assets live, what each file is for, and how to regenerate them if the logo ever changes.

---

## Asset locations

| File | Size | Purpose |
|------|------|---------|
| `public/favicon.svg` | 64×64 viewBox | Primary source SVG — the EventFlow "EF" logo used to generate all raster icons |
| `public/favicon.ico` | 16×16, 32×32, 48×48 | Multi-size ICO binary; served to browsers that request `/favicon.ico` directly (crawlers, older browsers) |
| `public/apple-touch-icon.png` | 180×180 | Home-screen icon on iOS/iPadOS Safari |
| `public/icon-192.png` | 192×192 | Android home-screen / PWA install prompt (standard) |
| `public/icon-512.png` | 512×512 | Splash screen and high-DPI displays |
| `public/icon-maskable-512.png` | 512×512 | Maskable variant (safe-area padded) for Android adaptive icons |
| `public/bimi.svg` | SVG | BIMI email logo (Brand Indicators for Message Identification) |

All PNG/ICO files are referenced by `public/site.webmanifest` and cached by the service worker (`public/sw.js`).

---

## How to regenerate icons

If the EventFlow logo (`public/favicon.svg`) is updated, regenerate the raster icons with the following Python script. It requires **cairosvg** and **Pillow** (`pip install cairosvg Pillow`).

```python
#!/usr/bin/env python3
"""
Regenerate EventFlow PWA icons from favicon.svg.
Run from the repository root: python3 scripts/generate-pwa-icons.py
"""
import cairosvg
from PIL import Image
import io
import struct
import os

SVG_SOURCE = 'public/favicon.svg'

with open(SVG_SOURCE, 'rb') as f:
    svg_data = f.read()

def render_png(size):
    """Render SVG to a Pillow Image at the given square pixel size."""
    data = cairosvg.svg2png(bytestring=svg_data, output_width=size, output_height=size)
    return Image.open(io.BytesIO(data)).convert('RGBA')

# ── PNG icons ──────────────────────────────────────────────────────────────────

icon_sizes = {
    'public/apple-touch-icon.png': 180,
    'public/icon-192.png':         192,
    'public/icon-512.png':         512,
}

for path, size in icon_sizes.items():
    img = render_png(size)
    img.save(path, format='PNG', optimize=True)
    print(f'Wrote {path}  ({size}×{size})')

# ── Maskable icon (512×512 with ~10 % safe-zone padding) ─────────────────────
# A maskable icon needs the logo centred inside an 80 % safe-area so that
# Android's adaptive icon engine can apply any mask shape without clipping.

MASK_SIZE = 512
SAFE_RATIO = 0.80  # logo occupies 80 % of the canvas
logo_size = int(MASK_SIZE * SAFE_RATIO)
padding = (MASK_SIZE - logo_size) // 2

canvas = Image.new('RGBA', (MASK_SIZE, MASK_SIZE), (11, 128, 115, 255))  # brand teal background
logo = render_png(logo_size)
canvas.paste(logo, (padding, padding), logo)
canvas.save('public/icon-maskable-512.png', format='PNG', optimize=True)
print(f'Wrote public/icon-maskable-512.png  ({MASK_SIZE}×{MASK_SIZE}, maskable)')

# ── favicon.ico (multi-size: 16, 32, 48) ─────────────────────────────────────

def write_ico(output_path, svg_data, sizes=(16, 32, 48)):
    """Write a multi-size ICO file (PNG-compressed entries) from SVG data."""
    png_chunks = [
        cairosvg.svg2png(bytestring=svg_data, output_width=s, output_height=s)
        for s in sizes
    ]
    num = len(sizes)
    data_start = 6 + 16 * num
    offsets = []
    cur = data_start
    for chunk in png_chunks:
        offsets.append(cur)
        cur += len(chunk)

    ico = struct.pack('<HHH', 0, 1, num)
    for s, chunk, off in zip(sizes, png_chunks, offsets):
        w = s if s < 256 else 0
        ico += struct.pack('<BBBBHHII', w, w, 0, 0, 1, 32, len(chunk), off)
    for chunk in png_chunks:
        ico += chunk

    with open(output_path, 'wb') as f:
        f.write(ico)
    print(f'Wrote {output_path}  ({len(ico)} bytes, {num} sizes: {list(sizes)})')

write_ico('public/favicon.ico', svg_data)

print('\nDone! Remember to bump CACHE_VERSION in public/sw.js so clients pick up the new icons.')
```

---

## Bumping the service-worker cache

Whenever icon files change, increment `CACHE_VERSION` in **`public/sw.js`** so that browsers with an active service worker discard stale cached icons and fetch the new ones:

```js
// public/sw.js — line 8
const CACHE_VERSION = 'eventflow-v18.6.0';  // ← increment after every icon update
```

---

## HTML references

Every HTML page should include the following `<head>` tags to wire up the favicon and PWA manifest:

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
```

The `site.webmanifest` file declares all four PNG icons used by browsers for the install prompt, splash screen, and home-screen shortcut.
