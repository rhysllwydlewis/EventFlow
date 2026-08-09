#!/usr/bin/env python3
"""
generate-pwa-icons.py — EventFlow icon generation script
Generates the full icon pack from public/favicon.svg.

Dependencies: cairosvg, Pillow
  pip install cairosvg Pillow

Usage:
  python3 scripts/generate-pwa-icons.py
"""

import cairosvg, io, sys, os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public')
SVG_PATH = os.path.join(ROOT, 'favicon.svg')

def render(size, maskable=False):
    svg = open(SVG_PATH, 'rb').read()
    if maskable:
        pad = int(size * 0.2)
        inner = size - 2 * pad
        data = cairosvg.svg2png(bytestring=svg, output_width=inner, output_height=inner)
        bg = Image.new('RGBA', (size, size), (11, 128, 115, 255))
        fg = Image.open(io.BytesIO(data)).convert('RGBA')
        bg.paste(fg, (pad, pad), fg)
        return bg
    data = cairosvg.svg2png(bytestring=svg, output_width=size, output_height=size)
    return Image.open(io.BytesIO(data)).convert('RGBA')

SIZES = [
    ('favicon-16x16.png',     16,  False),
    ('favicon-32x32.png',     32,  False),
    ('favicon-48x48.png',     48,  False),
    ('favicon-96x96.png',     96,  False),
    ('favicon-144x144.png',   144, False),
    ('mstile-150x150.png',    150, False),
    ('apple-touch-icon.png',  180, False),
    ('icon-192.png',          192, False),
    ('icon-512.png',          512, False),
    ('icon-maskable-512.png', 512, True),
]

# iOS ignores transparency on home-screen icons (older versions render it
# black), so apple-touch-icon.png is flattened onto white and saved without
# an alpha channel — every other size keeps the transparent rounded corners.
FLATTEN_TO_WHITE = {'apple-touch-icon.png'}

for filename, size, maskable in SIZES:
    img = render(size, maskable)
    if filename in FLATTEN_TO_WHITE:
        flat = Image.new('RGB', img.size, (255, 255, 255))
        flat.paste(img, (0, 0), img)
        flat.save(os.path.join(ROOT, filename), 'PNG', optimize=True)
    else:
        img.save(os.path.join(ROOT, filename), 'PNG', optimize=True)
    print(f'  {filename}: {size}x{size} {"(maskable)" if maskable else ""}')

# Multi-size ICO — built manually to guarantee 3 layers
# Pillow's ICO save can produce 1-layer files; manual ICO construction is reliable.
import struct
ico_sizes = [16, 32, 48]
png_bufs = []
for s in ico_sizes:
    buf = io.BytesIO()
    render(s).save(buf, 'PNG')
    png_bufs.append(buf.getvalue())

count = len(png_bufs)
ico_header = struct.pack('<HHH', 0, 1, count)
data_offset = 6 + 16 * count
entries = b''
blobs   = b''
for s, data in zip(ico_sizes, png_bufs):
    entries += struct.pack('<BBBBHHII', s, s, 0, 0, 1, 32, len(data), data_offset)
    blobs   += data
    data_offset += len(data)
open(os.path.join(ROOT, 'favicon.ico'), 'wb').write(ico_header + entries + blobs)
print(f'  favicon.ico: {", ".join(str(s) for s in ico_sizes)} layers')
print('\nDone. Remember to bump CACHE_VERSION in public/sw.js after regenerating icons.')
