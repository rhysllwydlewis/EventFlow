"""Per-quadrant superellipse blob generator.

A shape built from four corner arcs (border-radius style) can only be an
ellipse or a rounded rectangle: the corner arcs are elliptical, so making them
big enough to lose the straight edges makes the whole thing an ellipse. The
design's blobs are neither -- they are *fuller* than an ellipse without having
a straight edge anywhere.

A Lame curve gives exactly that as a continuous knob:

    |x/a|^n + |y/b|^n = 1

n = 2 is an ellipse, n -> infinity is a rectangle, and n ~ 2.5-4 is the blob
range. Each quadrant gets its own n, and the centre (cx, cy) is where the
extreme points sit, which is what makes the shape asymmetric.

Points are sampled along each quadrant and joined with Catmull-Rom -> cubic
Bezier, so the output is a smooth closed path with no corners.
"""

import math


def p(v):
    return f'{round(v, 3):g}'


def sample_quadrant(cx, cy, a, b, xdir, ydir, n, steps):
    """Points from the horizontal extreme round to the vertical extreme."""
    pts = []
    for i in range(steps + 1):
        theta = (math.pi / 2) * i / steps
        x = cx + xdir * a * (math.cos(theta) ** (2.0 / n))
        y = cy + ydir * b * (math.sin(theta) ** (2.0 / n))
        pts.append((x, y))
    return pts


def blob(cx, cy, n_tr, n_tl, n_bl, n_br, steps=8):
    """Closed superellipse blob in objectBoundingBox units.

    cx, cy place the extreme points: the top and bottom of the shape sit at
    x = cx, the left and right at y = cy.
    """
    right, left = 1.0 - cx, cx
    down, up = 1.0 - cy, cy

    pts = []
    # (1, cy) -> (cx, 0)
    pts += sample_quadrant(cx, cy, right, up, +1, -1, n_tr, steps)[:-1]
    # (cx, 0) -> (0, cy)
    pts += [(x, y) for x, y in reversed(sample_quadrant(cx, cy, left, up, -1, -1, n_tl, steps))][:-1]
    # (0, cy) -> (cx, 1)
    pts += sample_quadrant(cx, cy, left, down, -1, +1, n_bl, steps)[:-1]
    # (cx, 1) -> (1, cy)
    pts += [
        (x, y) for x, y in reversed(sample_quadrant(cx, cy, right, down, +1, +1, n_br, steps))
    ][:-1]

    return catmull_rom_path(pts)


def catmull_rom_path(pts):
    """Closed Catmull-Rom spline through pts, emitted as cubic Beziers."""
    count = len(pts)
    d = [f'M{p(pts[0][0])},{p(pts[0][1])}']
    for i in range(count):
        p0 = pts[(i - 1) % count]
        p1 = pts[i]
        p2 = pts[(i + 1) % count]
        p3 = pts[(i + 2) % count]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6.0, p1[1] + (p2[1] - p0[1]) / 6.0)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6.0, p2[1] - (p3[1] - p1[1]) / 6.0)
        d.append(f'C{p(c1[0])},{p(c1[1])} {p(c2[0])},{p(c2[1])} {p(p2[0])},{p(p2[1])}')
    d.append('Z')
    return ' '.join(d)


if __name__ == '__main__':
    import sys, json

    spec = json.loads(sys.argv[1])
    for name, cfg in spec.items():
        print(f'{name}||{blob(**cfg)}')
