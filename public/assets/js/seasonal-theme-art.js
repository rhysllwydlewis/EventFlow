/**
 * EventFlow seasonal navbar — artwork.
 *
 * Hand-built SVG for each occasion: one small mark that sits just past the end
 * of the wordmark, soft art clustered at the far left and right of the header
 * (fading out well before the links), and, for Halloween, a fine web in the
 * top-right corner. Nothing here is an emoji or a stock icon.
 *
 * This file is only downloaded when the server says a theme is on (see
 * seasonal-theme.js), so it costs nothing for the rest of the year. Every layer
 * is decorative: aria-hidden, pointer-events none, behind the header content,
 * and clipped to the header so it can never move the page or block a click.
 *
 * Exposes window.EFSeasonalArt = { themes, build, apply, clear }.
 */
'use strict';
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const round1 = n => String(Math.round(n * 10) / 10);
  const uri = svg => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  const svg = (viewBox, defs, body) =>
    `<svg xmlns="${SVG_NS}" viewBox="${viewBox}"><defs>${defs}</defs>${body}</svg>`;

  const linearGradient = (id, c1, c2, { x2 = 0, y2 = 1 } = {}) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`;

  const radialGradient = (id, c1, c2, { cx = 0.5, cy = 0.5, r = 0.5, a1 = 1, a2 = 1 } = {}) =>
    `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"><stop offset="0" stop-color="${c1}" stop-opacity="${a1}"/><stop offset="1" stop-color="${c2}" stop-opacity="${a2}"/></radialGradient>`;

  /* ---------------- Motion (SMIL, so it also runs inside background SVGs) ---------------- */

  const SMOOTH = ' calcMode="spline" keyTimes="0;.5;1" keySplines=".45 0 .55 1;.45 0 .55 1"';

  /** A negative `begin` starts each loop part-way through so nothing begins in lockstep. */
  const animate = (attribute, values, dur, begin, extra = '') =>
    `<animate attributeName="${attribute}" values="${values}" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"${extra}/>`;
  const animateTransform = (type, values, dur, begin, extra = '') =>
    `<animateTransform attributeName="transform" type="${type}" values="${values}" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"${extra}/>`;

  /** Small deterministic generator so every load draws the same arrangement. */
  const seeded = seed => {
    let value = seed;
    return () => {
      value = (value * 16807) % 2147483647;
      return (value - 1) / 2147483646;
    };
  };

  /** A concave four-point sparkle drawn around the origin. */
  const sparkle = (r, fill) => {
    const bend = r * 0.09;
    const near = round1(bend);
    const nearNeg = round1(-bend);
    return `<path d="M0 ${-r}Q${near} ${nearNeg} ${r} 0Q${near} ${near} 0 ${r}Q${nearNeg} ${near} ${-r} 0Q${nearNeg} ${nearNeg} 0 ${-r}Z" fill="${fill}"/>`;
  };

  const twinkle = (x, y, r, fill, dur, begin, motion) => {
    let inner = sparkle(r, fill);
    if (motion) {
      inner = `<g>${animateTransform('scale', '1;.78;1', dur, begin, SMOOTH)}${animate('opacity', '1;.5;1', dur, begin, SMOOTH)}${inner}</g>`;
    }
    return `<g transform="translate(${round1(x)} ${round1(y)})">${inner}</g>`;
  };

  const HEART =
    'M12 21C5 15.5 2 11.5 2 7.8C2 4.8 4.3 2.8 7 2.8C9 2.8 10.7 3.8 12 5.8C13.3 3.8 15 2.8 17 2.8C19.7 2.8 22 4.8 22 7.8C22 11.5 19 15.5 12 21Z';
  const heartAt = (x, y, k, fill) =>
    `<path transform="translate(${round1(x)} ${round1(y)}) scale(${round1(k)})" d="${HEART}" fill="${fill}"/>`;

  /* ---------------- Marks (viewBox 0 0 40 40) ---------------- */

  function markHalloween(motion) {
    let bat =
      '<path transform="translate(22 6.5)" d="M0 5C3 1 5 2 7 5C9 2 11 1 14 5C12 4.6 11 5.6 10.5 7.5C9.5 6.2 8 6.4 7 8C6 6.4 4.5 6.2 3.5 7.5C3 5.6 2 4.6 0 5Z" fill="#3b2a5a"/>';
    if (motion) {
      bat = `<g>${animateTransform('translate', '0 0;1.2 -1.4;0 0', 5, 0, SMOOTH)}${bat}</g>`;
    }
    return svg(
      '0 0 40 40',
      `${linearGradient('hm', '#fde68a', '#f59e0b', {
        x2: 1,
        y2: 1,
      })}<mask id="hk"><rect width="40" height="40" fill="#fff"/><circle cx="26.5" cy="14.5" r="11.2" fill="#000"/></mask>${radialGradient(
        'hg',
        '#fcd34d',
        '#fcd34d',
        { a1: 0.35, a2: 0 }
      )}`,
      `<circle cx="17" cy="22" r="19" fill="url(#hg)"/><circle cx="17" cy="22" r="13.2" fill="url(#hm)" mask="url(#hk)"/>${bat}${twinkle(
        8.5,
        8,
        3.6,
        '#fcd34d',
        3.6,
        1,
        motion
      )}${twinkle(33.5, 29.5, 2.4, '#fde68a', 4.4, 2.4, motion)}`
    );
  }

  function markBonfire(motion) {
    const colours = ['#fbbf24', '#fb923c', '#fde68a', '#f97316'];
    let rays = '';
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const long = i % 2 === 0;
      const inner = 4.6;
      const outer = long ? 12.5 : 8.4;
      const colour = colours[i % 4];
      rays += `<line x1="${round1(Math.cos(angle) * inner)}" y1="${round1(Math.sin(angle) * inner)}" x2="${round1(Math.cos(angle) * outer)}" y2="${round1(Math.sin(angle) * outer)}" stroke="${colour}" stroke-width="${long ? 1.3 : 1}" stroke-linecap="round"/>`;
      if (long) {
        rays += `<circle cx="${round1(Math.cos(angle) * (outer + 2))}" cy="${round1(Math.sin(angle) * (outer + 2))}" r=".8" fill="${colour}"/>`;
      }
    }
    const spinning = motion ? `<g>${animateTransform('rotate', '0;360', 16, 0)}${rays}</g>` : rays;
    return svg(
      '0 0 40 40',
      radialGradient('bg1', '#fde68a', '#f97316', { a1: 0.65, a2: 0 }) +
        radialGradient('bg2', '#fffbea', '#fde68a'),
      `<path d="M22 18L6.5 36" stroke="#475569" stroke-width="1.5" stroke-linecap="round"/><path d="M22 18L13 28.4" stroke="#94a3b8" stroke-width=".7" stroke-linecap="round"/><g transform="translate(23 16)"><circle r="11" fill="url(#bg1)"/>${spinning}<circle r="2.7" fill="url(#bg2)">${motion ? animate('r', '2.7;3.3;2.7', 2.2, 0, SMOOTH) : ''}</circle></g>${twinkle(
        10,
        11,
        2.2,
        '#fde68a',
        2.8,
        0.6,
        motion
      )}${twinkle(34, 33, 1.8, '#fb923c', 3.4, 1.9, motion)}`
    );
  }

  function markRemembrance() {
    let flower =
      '<g transform="translate(20 16) rotate(-14)">' +
      '<circle cx="-5.6" cy="-4.8" r="8.2" fill="url(#pp)"/><circle cx="5.8" cy="-4.2" r="8" fill="url(#pp)"/>' +
      '<circle cx="-5" cy="5.4" r="8" fill="url(#pp)"/><circle cx="5.6" cy="5.6" r="8.2" fill="url(#pp)"/>' +
      '<path d="M0 0L-9 -9M0 0L9 -8M0 0L-8.5 9M0 0L9 9.5" stroke="#8f0f19" stroke-width=".5" opacity=".45"/>' +
      '<circle r="3.5" fill="#1f2937"/>';
    for (let i = 0; i < 9; i += 1) {
      const angle = (i / 9) * Math.PI * 2;
      flower += `<circle cx="${round1(Math.cos(angle) * 5)}" cy="${round1(Math.sin(angle) * 5)}" r=".75" fill="#374151"/>`;
    }
    flower += '</g>';
    return svg(
      '0 0 40 40',
      radialGradient('pp', '#b3121c', '#ee3d45', { r: 0.75 }),
      `<path d="M20 28C21.2 32 20.6 35.4 18 38.5" stroke="#4d7c0f" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M20.4 32.5C25 31.5 27 29 27 27C23 27 21 29 20.4 32.5Z" fill="#65a30d"/>${
        flower
      }`
    );
  }

  function markChristmas(motion) {
    const leafPath =
      'M0 0L2.5 -3Q4 -2.4 5 -5Q7 -3.2 9 -4.4Q10 -2.6 12.5 -3.6Q14.5 -2 18 0Q14.5 2 12.5 3.6Q10 2.6 9 4.4Q7 3.2 5 5Q4 2.4 2.5 3Z';
    const leaf = (rotation, scale) =>
      `<g transform="rotate(${rotation}) scale(${scale})"><path d="${leafPath}" fill="url(#hl)"/><path d="M1 0L16 0" stroke="#d1fae5" stroke-width=".7" opacity=".5" stroke-linecap="round"/></g>`;
    const berry = (x, y) =>
      `<circle cx="${x}" cy="${y}" r="2.7" fill="url(#hb)"/><circle cx="${x - 0.8}" cy="${y - 0.9}" r=".8" fill="#fff" opacity=".7"/>`;
    let sprig = `<g transform="translate(20 33) scale(1.28) translate(-20 -31.5)"><g transform="translate(20 31.5)">${leaf(
      -90,
      0.78
    )}${leaf(-42, 1.02)}${leaf(
      -138,
      1.02
    )}</g>${berry(17.3, 31)}${berry(22.7, 31)}${berry(20, 28.3)}</g>`;
    if (motion) {
      sprig = `<g>${animateTransform('rotate', '-2.5 20 36;2.5 20 36;-2.5 20 36', 6, 0, SMOOTH)}${sprig}</g>`;
    }
    return svg(
      '0 0 40 40',
      linearGradient('hl', '#34a373', '#17523a', { x2: 1, y2: 1 }) +
        radialGradient('hb', '#f43f5e', '#9f1239', { cx: 0.35, cy: 0.3, r: 0.8 }),
      sprig + twinkle(33, 7, 3, '#fcd34d', 3.4, 0.8, motion)
    );
  }

  function markNewYear(motion) {
    const dot = (cx, cy, r, from, dur, begin) =>
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f59e0b">${motion ? animate('opacity', from, dur, begin) : ''}</circle>`;
    return svg(
      '0 0 40 40',
      linearGradient('gg', '#fff3bf', '#eab308', { x2: 1, y2: 1 }) +
        linearGradient('gs', '#f8fafc', '#94a3b8', { x2: 1, y2: 1 }),
      twinkle(19, 20, 14, 'url(#gg)', 3.8, 0, motion) +
        twinkle(8, 8, 4.4, 'url(#gs)', 3, 1.2, motion) +
        twinkle(33, 31, 5, 'url(#gs)', 3.4, 2.3, motion) +
        dot(33, 8, 1.1, '1;.3;1', 2.4, 0.4) +
        dot(5, 30, 0.9, '.3;1;.3', 2.8, 1)
    );
  }

  function markValentines(motion) {
    let heart = `<g transform="translate(20 21) scale(1.3) translate(-12 -12)"><path d="${HEART}" fill="url(#vh)"/><path d="M5.4 6.2C5.7 4.9 7 4.3 8.2 4.6" stroke="#fff" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".6"/></g>`;
    if (motion) {
      heart = `<g transform="translate(20 21)"><g>${animateTransform('scale', '1;1.08;1;1.04;1', 3.8, 0, ' keyTimes="0;.12;.26;.38;1"')}<g transform="translate(-20 -21)">${heart}</g></g></g>`;
    }
    let outline = `<path transform="translate(26.5 4) scale(.62)" d="${HEART}" fill="none" stroke="#f472b6" stroke-width="1.6" stroke-linejoin="round"/>`;
    if (motion) {
      outline = `<g>${animateTransform('translate', '0 0;0 -1.6;0 0', 4.6, 0.6, SMOOTH)}${outline}</g>`;
    }
    return svg(
      '0 0 40 40',
      linearGradient('vh', '#fb7185', '#be123c', { x2: 0.6 }),
      heart + outline
    );
  }

  /** A hanging lantern: string from y=0, cap at y=6. Shared by the mark and the edge art. */
  const lanternShape = id =>
    '<line x1="20" y1="0" x2="20" y2="6.4" stroke="#9ca3af" stroke-width=".9"/>' +
    `<rect x="15.2" y="6" width="9.6" height="3.6" rx="1.3" fill="url(#${id}g)"/>` +
    `<path d="M20 8.8C30 8.8 31.6 14.2 31.6 19.6C31.6 25 30 30.4 20 30.4C10 30.4 8.4 25 8.4 19.6C8.4 14.2 10 8.8 20 8.8Z" fill="url(#${id}r)"/>` +
    '<ellipse cx="20" cy="19.6" rx="5.4" ry="10.8" fill="none" stroke="#fecaca" stroke-opacity=".38" stroke-width=".9"/><line x1="20" y1="9" x2="20" y2="30.2" stroke="#fecaca" stroke-opacity=".3" stroke-width=".8"/>' +
    '<path d="M20 16.6L22.1 19.6L20 22.6L17.9 19.6Z" fill="#fde68a" opacity=".92"/>' +
    `<rect x="15.2" y="29.6" width="9.6" height="3.6" rx="1.3" fill="url(#${id}g)"/>` +
    '<path d="M18.6 33.2L17.6 39.2M20 33.2L20 40M21.4 33.2L22.4 39.2" stroke="#f59e0b" stroke-width="1" stroke-linecap="round"/><circle cx="20" cy="33.6" r="1.1" fill="#fcd34d"/>';
  const lanternDefs = id =>
    linearGradient(`${id}r`, '#ef4444', '#a51919') + linearGradient(`${id}g`, '#fde68a', '#d97706');

  function markChineseNewYear(motion) {
    const string = '<line x1="20" y1="-8" x2="20" y2="0" stroke="#9ca3af" stroke-width=".9"/>';
    const body = string + lanternShape('c');
    return svg(
      '0 0 40 40',
      lanternDefs('c'),
      motion
        ? `<g>${animateTransform('rotate', '-3 20 -8;3 20 -8;-3 20 -8', 5.4, 0, SMOOTH)}${body}</g>`
        : body
    );
  }

  const PETAL = 'M0 0C-5.2 -4.5 -4.6 -11.5 0 -13.5C4.6 -11.5 5.2 -4.5 0 0Z';
  const bloom = (id, scale) => {
    let petals = '';
    for (let i = 0; i < 5; i += 1) {
      petals += `<path transform="rotate(${i * 72}) scale(${scale})" d="${PETAL}" fill="url(#${id})" stroke="#ec4899" stroke-opacity=".35" stroke-width=".5"/>`;
    }
    return `${petals}<circle r="${round1(2.4 * scale)}" fill="#fbbf24"/><circle cx="${round1(0.9 * scale)}" cy="${round1(-0.6 * scale)}" r="${round1(0.55 * scale)}" fill="#f59e0b"/>`;
  };

  function markMothersDay(motion) {
    let stem =
      `<g transform="translate(20 15.4)">${bloom('mp', 1)}</g>` +
      '<path d="M20 17C20.6 25 19.6 31 17.4 38" stroke="#4d7c0f" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M19.5 29.6C14 28.6 12 25 12.6 22.8C17.2 22.8 19 25.4 19.5 29.6Z" fill="#65a30d"/>';
    if (motion) {
      stem = `<g>${animateTransform('rotate', '-2.6 18 38;2.6 18 38;-2.6 18 38', 6.4, 0, SMOOTH)}${stem}</g>`;
    }
    return svg('0 0 40 40', linearGradient('mp', '#fff1f7', '#f472b6'), stem);
  }

  const EGG = 'M20 4C27 4 32 15 32 23C32 31 26.5 36 20 36C13.5 36 8 31 8 23C8 15 13 4 20 4Z';
  const egg = (id, pattern, fillId = id) => {
    const bands =
      pattern === 'dots'
        ? '<circle cx="14" cy="21" r="1.3" fill="#fff"/><circle cx="20" cy="19" r="1.3" fill="#fff"/><circle cx="26" cy="21" r="1.3" fill="#fff"/><circle cx="17" cy="27" r="1.3" fill="#fff"/><circle cx="23" cy="27" r="1.3" fill="#fff"/>'
        : '<path d="M6 17L10 14L14 17L18 14L22 17L26 14L30 17L34 14" stroke="#fff" stroke-width="1.8" fill="none" opacity=".92"/><path d="M6 26L10 23L14 26L18 23L22 26L26 23L30 26L34 23" stroke="#fff" stroke-width="1.4" fill="none" opacity=".75"/>';
    return `<clipPath id="${id}c"><path d="${EGG}"/></clipPath><path d="${EGG}" fill="url(#${fillId})"/><g clip-path="url(#${id}c)">${bands}<ellipse cx="15" cy="13" rx="3" ry="5.4" fill="#fff" opacity=".35" transform="rotate(14 15 13)"/></g>`;
  };

  function markEaster(motion) {
    let body = `<g transform="rotate(-10 20 36)">${egg('e1', 'zigzag')}</g>`;
    if (motion) {
      body = `<g>${animateTransform('rotate', '-3 20 36;3 20 36;-3 20 36', 6.8, 0, SMOOTH)}${body}</g>`;
    }
    return svg('0 0 40 40', linearGradient('e1', '#c4b5fd', '#f9a8d4', { x2: 1, y2: 1 }), body);
  }

  function markFathersDay(motion) {
    let scallops = '';
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      scallops += `<circle cx="${round1(Math.cos(angle) * 10.6)}" cy="${round1(Math.sin(angle) * 10.6)}" r="3.1" fill="#1b3a8f"/>`;
    }
    const star = `<g>${motion ? animateTransform('scale', '1;1.12;1', 3.2, 0, SMOOTH) : ''}${sparkle(5.2, 'url(#fg)')}</g>`;
    return svg(
      '0 0 40 40',
      linearGradient('fr', '#c0392b', '#7f1d1d') +
        linearGradient('fn', '#2f55b8', '#14296b', { x2: 1, y2: 1 }) +
        linearGradient('fg', '#fde68a', '#d97706', { x2: 1, y2: 1 }),
      '<path d="M13.4 24L9.2 38.6L15 35.4L18.6 39.2L20.6 25Z" fill="url(#fr)"/><path d="M26.6 24L30.8 38.6L25 35.4L21.4 39.2L19.4 25Z" fill="#8f1d1d"/>' +
        `<g transform="translate(20 15)">${scallops}<circle r="11.2" fill="url(#fn)"/><circle r="7.4" fill="none" stroke="url(#fg)" stroke-width="1.4"/>${star}</g>`
    );
  }

  /* ---------------- Edge clusters (300 x 17; x runs from the outer edge inwards) ---------------- */

  const EDGE_W = 300;
  const EDGE_H = 17;

  function scatter(random, count, from, to, draw) {
    let out = '';
    const span = (to - from) / count;
    for (let i = 0; i < count; i += 1) {
      out += draw(from + (i + 0.15 + 0.7 * random()) * span, random, i);
    }
    return out;
  }

  /** The right-hand cluster is the left one's drawing mirrored, so one design serves both sides. */
  const cluster = (side, defs, body) =>
    svg(
      `0 0 ${EDGE_W} ${EDGE_H}`,
      defs,
      side === 'r' ? `<g transform="translate(${EDGE_W} 0) scale(-1 1)">${body}</g>` : body
    );

  const hairline = (position, colour) =>
    `<rect x="0" y="${position === 'top' ? 0 : EDGE_H - 1.2}" width="${EDGE_W}" height="1.2" fill="${colour}" opacity=".55"/>`;

  const pumpkin = (x, base, k) =>
    `<g transform="translate(${round1(x)} ${round1(base)}) scale(${k})"><ellipse cx="-3.6" cy="-5" rx="3.6" ry="5" fill="url(#pk)"/><ellipse cx="3.6" cy="-5" rx="3.6" ry="5" fill="url(#pk)"/><ellipse cx="0" cy="-5.2" rx="3.7" ry="5.5" fill="url(#pk2)"/><path d="M0 -10.3C.2 -12 1 -12.8 2.3 -13.2" stroke="#4d7c0f" stroke-width="1.3" fill="none" stroke-linecap="round"/></g>`;

  const bat = (x, y, k, motion, dur, begin) => {
    const shape = `<path transform="translate(${round1(x)} ${round1(y)}) scale(${k})" d="M0 5C3 1 5 2 7 5C9 2 11 1 14 5C12 4.6 11 5.6 10.5 7.5C9.5 6.2 8 6.4 7 8C6 6.4 4.5 6.2 3.5 7.5C3 5.6 2 4.6 0 5Z" fill="#3b2a5a" opacity=".88"/>`;
    return motion
      ? `<g>${animateTransform('translate', '0 0;5 -1.2;0 0', dur, begin, SMOOTH)}${shape}</g>`
      : shape;
  };

  function edgeHalloween(side, motion) {
    const random = seeded(side === 'l' ? 11 : 29);
    const left = side === 'l';
    let body =
      hairline('bottom', '#6d5aa6') +
      pumpkin(left ? 13 : 16, EDGE_H - 1, left ? 0.95 : 0.8) +
      pumpkin(left ? 62 : 70, EDGE_H - 1, left ? 0.62 : 0.7) +
      bat(left ? 36 : 44, 3, 0.8, motion, 6, 1) +
      bat(left ? 104 : 96, 5, 0.62, motion, 7, 3.5) +
      bat(left ? 170 : 160, 2, 0.5, motion, 8, 2);
    body += scatter(random, 7, 8, 240, (x, rand, i) => {
      const cy = 3 + rand() * 9;
      const radius = 0.7 + rand() * 0.6;
      return `<circle cx="${round1(x)}" cy="${round1(cy)}" r="${round1(radius)}" fill="#fcd34d">${motion ? animate('opacity', '.9;.25;.9', 2.6 + i * 0.4, i * 0.7) : ''}</circle>`;
    });
    return cluster(
      side,
      linearGradient('pk', '#fb923c', '#c2410c') + linearGradient('pk2', '#fdba74', '#ea580c'),
      body
    );
  }

  function edgeBonfire(side, motion) {
    const random = seeded(side === 'l' ? 7 : 19);
    let body = `<ellipse cx="30" cy="${EDGE_H}" rx="90" ry="15" fill="url(#gl)"/>${hairline('bottom', '#f97316')}`;
    body += scatter(random, 14, 6, 240, (x, rand, i) => {
      const radius = 0.8 + rand() * 0.9;
      const colour = ['#fbbf24', '#fb923c', '#fde68a'][i % 3];
      const dur = 3 + rand() * 2.6;
      const begin = rand() * 5;
      const rise = 9 + rand() * 5;
      if (!motion) {
        return `<circle cx="${round1(x)}" cy="${round1(EDGE_H - 4 - rand() * 8)}" r="${round1(radius)}" fill="${colour}" opacity=".6"/>`;
      }
      return `<circle cx="${round1(x)}" cy="${EDGE_H - 2}" r="${round1(radius)}" fill="${colour}" opacity="0">${animate(
        'cy',
        `${EDGE_H - 2};${round1(EDGE_H - 2 - rise)}`,
        dur,
        begin
      )}${animate('opacity', '0;.9;0', dur, begin, ' keyTimes="0;.25;1"')}${animate(
        'cx',
        `${round1(x)};${round1(x + (rand() - 0.5) * 8)}`,
        dur,
        begin
      )}</circle>`;
    });
    return cluster(side, radialGradient('gl', '#f97316', '#f97316', { a1: 0.3, a2: 0 }), body);
  }

  function edgeChristmas(side, motion) {
    const colours = ['#fcd34d', '#fb7185', '#6ee7b7', '#fcd34d'];
    const defs = colours
      .map((colour, i) => radialGradient(`lg${i}`, colour, colour, { a1: 0.95, a2: 0 }))
      .join('');
    let wire = 'M0 1.5';
    for (let i = 0; i < 6; i += 1) {
      wire += `Q${25 + 50 * i} 7 ${50 + 50 * i} 1.5`;
    }
    let body = `<path d="${wire}" fill="none" stroke="#3f5f4e" stroke-width="1" opacity=".9"/>`;
    let n = 0;
    for (let segment = 0; segment < 6; segment += 1) {
      for (const t of [0.25, 0.75]) {
        const x = 50 * segment + 50 * t;
        const y = (1 - t) * (1 - t) * 1.5 + 2 * t * (1 - t) * 7 + t * t * 1.5;
        const colour = colours[n % 4];
        const by = y + 3.6;
        body +=
          `<circle cx="${round1(x)}" cy="${round1(by + 0.6)}" r="6.2" fill="url(#lg${n % 4})">${motion ? animate('opacity', '.4;1;.4', 3.2, n * 0.55, SMOOTH) : ''}</circle>` +
          `<path d="M${round1(x - 1.3)} ${round1(y + 0.3)}L${round1(x + 1.3)} ${round1(y + 0.3)}L${round1(x + 1.9)} ${round1(by + 0.4)}Q${round1(x)} ${round1(by + 4.6)} ${round1(x - 1.9)} ${round1(by + 0.4)}Z" fill="${colour}"/>`;
        n += 1;
      }
    }
    return cluster(side, defs, body);
  }

  function edgeNewYear(side, motion) {
    const random = seeded(side === 'l' ? 5 : 23);
    let body = hairline('top', '#d4a017');
    body += scatter(random, 9, 6, 250, (x, rand, i) => {
      const size = 2.4 + rand() * 2.6;
      const y = 4.5 + rand() * 8;
      return twinkle(
        x,
        y,
        size,
        i % 3 === 0 ? 'url(#gs)' : 'url(#gg)',
        2.6 + rand() * 1.8,
        rand() * 4,
        motion
      );
    });
    body += scatter(
      random,
      6,
      12,
      240,
      (x, rand, i) =>
        `<circle cx="${round1(x)}" cy="${round1(3 + rand() * 11)}" r="${round1(0.6 + rand() * 0.5)}" fill="#f59e0b" opacity=".7">${motion ? animate('opacity', '.8;.2;.8', 2.4 + i * 0.3, i * 0.5) : ''}</circle>`
    );
    return cluster(
      side,
      linearGradient('gg', '#fff3bf', '#eab308', { x2: 1, y2: 1 }) +
        linearGradient('gs', '#f8fafc', '#94a3b8', { x2: 1, y2: 1 }),
      body
    );
  }

  function edgeValentines(side, motion) {
    const random = seeded(side === 'l' ? 13 : 31);
    let body = hairline('bottom', '#f43f5e');
    body += scatter(random, 7, 8, 250, (x, rand, i) => {
      const k = 0.2 + rand() * 0.2;
      const y = 6 + rand() * 8;
      const dur = 5 + rand() * 3;
      const begin = rand() * 6;
      const heart = heartAt(x - 12 * k, y - 12 * k, k, i % 2 ? 'url(#hp)' : 'url(#hv)');
      return motion
        ? `<g opacity=".8">${animateTransform('translate', '0 0;0 -3.4;0 0', dur, begin, SMOOTH)}${animate('opacity', '.35;.9;.35', dur, begin, SMOOTH)}${heart}</g>`
        : `<g opacity=".7">${heart}</g>`;
    });
    return cluster(
      side,
      linearGradient('hv', '#fda4af', '#e11d48') + linearGradient('hp', '#fbcfe8', '#f472b6'),
      body
    );
  }

  function edgeChineseNewYear(side, motion) {
    const random = seeded(side === 'l' ? 3 : 17);
    const lantern = (x, k, begin) => {
      const shape = `<g transform="translate(${round1(x)} 0) scale(${k}) translate(-20 0)">${lanternShape('c')}</g>`;
      return motion
        ? `<g transform="translate(${round1(x)} 0)"><g>${animateTransform('rotate', '-3.5 0 0;3.5 0 0;-3.5 0 0', 5 + begin * 0.4, begin, SMOOTH)}<g transform="translate(${round1(-x)} 0)">${shape}</g></g></g>`
        : shape;
    };
    const left = side === 'l';
    let body =
      hairline('top', '#dc2626') +
      lantern(left ? 18 : 44, 0.4, 0) +
      lantern(left ? 56 : 82, 0.3, 1.7) +
      lantern(left ? 118 : 128, 0.34, 3.1);
    body += scatter(random, 6, 6, 220, (x, rand) =>
      twinkle(
        x,
        4 + rand() * 10,
        1.4 + rand() * 1.4,
        '#fbbf24',
        2.8 + rand() * 1.4,
        rand() * 3,
        motion
      )
    );
    return cluster(side, lanternDefs('c'), body);
  }

  function edgeMothersDay(side, motion) {
    const random = seeded(side === 'l' ? 41 : 9);
    let body = hairline('bottom', '#f472b6');
    body += scatter(random, 5, 10, 200, (x, rand, i) => {
      const k = 0.2 + rand() * 0.1;
      const y = 5.5 + rand() * 3;
      const flower =
        `<path d="M${round1(x)} ${round1(y + 2)}C${round1(x + 0.8)} ${round1(y + 7)} ${round1(x - 0.6)} 13 ${round1(x - 1.4)} ${EDGE_H}" stroke="#4d7c0f" stroke-width=".9" fill="none" stroke-linecap="round"/>` +
        `<path d="M${round1(x - 0.2)} 12C${round1(x - 3.6)} 11.4 ${round1(x - 4.6)} 9.4 ${round1(x - 4.2)} 8.2C${round1(x - 1.6)} 8.4 ${round1(x - 0.6)} 9.8 ${round1(x - 0.2)} 12Z" fill="#65a30d"/>` +
        `<g transform="translate(${round1(x)} ${round1(y)})">${bloom('mp', k * 1.5)}</g>`;
      if (!motion) {
        return flower;
      }
      const pivot = `${round1(x)} ${EDGE_H}`;
      return `<g>${animateTransform('rotate', `-3 ${pivot};3 ${pivot};-3 ${pivot}`, 5.5 + i * 0.7, i * 1.3, SMOOTH)}${flower}</g>`;
    });
    return cluster(side, linearGradient('mp', '#fff1f7', '#f472b6'), body);
  }

  function edgeEaster(side, motion) {
    const random = seeded(side === 'l' ? 2 : 37);
    const fills = ['e1', 'e2', 'e3', 'e4'];
    const patterns = ['zigzag', 'dots'];
    let body = hairline('bottom', '#c4b5fd');
    (side === 'l' ? [14, 40, 78, 130] : [18, 52, 96, 150]).forEach((x, i) => {
      const k = 0.3 + (i % 2) * 0.05;
      const tilt = i % 2 ? 9 : -8;
      body += `<g transform="translate(${x} ${EDGE_H - 0.5}) rotate(${tilt}) scale(${k}) translate(-20 -36)">${egg(`q${i}`, patterns[i % 2], fills[i])}</g>`;
    });
    body += scatter(
      random,
      6,
      8,
      220,
      (x, rand, i) =>
        `<circle cx="${round1(x)}" cy="${round1(4 + rand() * 9)}" r="${round1(0.8 + rand() * 0.6)}" fill="${['#c4b5fd', '#f9a8d4', '#86efac'][i % 3]}" opacity=".8">${motion ? animate('opacity', '.8;.3;.8', 3 + i * 0.4, i * 0.8) : ''}</circle>`
    );
    return cluster(
      side,
      linearGradient('e1', '#ddd6fe', '#c4b5fd', { x2: 1, y2: 1 }) +
        linearGradient('e2', '#fbcfe8', '#f9a8d4', { x2: 1, y2: 1 }) +
        linearGradient('e3', '#bbf7d0', '#86efac', { x2: 1, y2: 1 }) +
        linearGradient('e4', '#fef08a', '#fde047', { x2: 1, y2: 1 }),
      body
    );
  }

  function edgeFathersDay(side, motion) {
    const random = seeded(side === 'l' ? 8 : 27);
    const defs = `<pattern id="st" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="9" height="9" fill="#1e3a8a"/><rect width="2.4" height="9" x="3" fill="#fbbf24"/><rect width="1.2" height="9" x="6.6" fill="#0f766e"/></pattern>${linearGradient(
      'gg',
      '#fff3bf',
      '#eab308',
      { x2: 1, y2: 1 }
    )}`;
    let body = `<rect x="0" y="${EDGE_H - 2.4}" width="${EDGE_W}" height="2.4" fill="url(#st)" opacity=".7"/>`;
    body += scatter(random, 5, 10, 210, (x, rand) =>
      twinkle(
        x,
        3.5 + rand() * 7,
        1.8 + rand() * 1.6,
        'url(#gg)',
        3 + rand() * 1.5,
        rand() * 4,
        motion
      )
    );
    return cluster(side, defs, body);
  }

  /** A delicate corner web, drawn from the top-right corner (viewBox 80 x 64). */
  function cornerWeb(motion) {
    const corner = [80, 0];
    const reach = 100;
    const angles = [90, 112.5, 135, 157.5, 180].map(d => (d * Math.PI) / 180);
    const point = (radius, angle) => [
      corner[0] + radius * Math.cos(angle),
      corner[1] + radius * Math.sin(angle),
    ];
    const stroke = 'fill="none" stroke="#7c6aa8" stroke-width=".7" stroke-linecap="round"';
    let web = '';
    let dew = '';
    angles.forEach(angle => {
      const end = point(reach, angle);
      web += `<line x1="80" y1="0" x2="${round1(end[0])}" y2="${round1(end[1])}" ${stroke}/>`;
    });
    [14, 28, 43, 59, 76].forEach((radius, ring) => {
      for (let i = 0; i < angles.length - 1; i += 1) {
        const start = point(radius, angles[i]);
        const end = point(radius, angles[i + 1]);
        const mid = point(radius * 0.88, (angles[i] + angles[i + 1]) / 2);
        web += `<path d="M${round1(start[0])} ${round1(start[1])}Q${round1(mid[0])} ${round1(mid[1])} ${round1(end[0])} ${round1(end[1])}" ${stroke}/>`;
      }
      if (ring % 2 === 0) {
        const dewPoint = point(radius, angles[1 + (ring % 3)]);
        dew += `<circle cx="${round1(dewPoint[0])}" cy="${round1(dewPoint[1])}" r="1" fill="#fff" stroke="#a5b4fc" stroke-width=".4">${motion ? animate('opacity', '1;.3;1', 3 + ring * 0.6, ring * 0.9) : ''}</circle>`;
      }
    });
    return svg('0 0 80 64', '', web + dew);
  }

  /* ---------------- Themes ---------------- */

  /** `pos` is the header edge the clusters hug; `edge` is null for a mark-only theme. */
  const THEMES = {
    halloween: { mark: markHalloween, edge: edgeHalloween, pos: 'bottom', corner: cornerWeb },
    bonfire: { mark: markBonfire, edge: edgeBonfire, pos: 'bottom' },
    remembrance: { mark: markRemembrance, edge: null, pos: null },
    christmas: { mark: markChristmas, edge: edgeChristmas, pos: 'top' },
    'new-year': { mark: markNewYear, edge: edgeNewYear, pos: 'top' },
    'chinese-new-year': { mark: markChineseNewYear, edge: edgeChineseNewYear, pos: 'top' },
    valentines: { mark: markValentines, edge: edgeValentines, pos: 'bottom' },
    'mothers-day': { mark: markMothersDay, edge: edgeMothersDay, pos: 'bottom' },
    easter: { mark: markEaster, edge: edgeEaster, pos: 'bottom' },
    'fathers-day': { mark: markFathersDay, edge: edgeFathersDay, pos: 'bottom' },
  };

  /**
   * The mark is inlined into the page, where its ids share one namespace with
   * every other inline SVG, so they are prefixed. (The edge and corner art load
   * as background images, which are isolated documents and need no prefix.)
   */
  const namespaceIds = markup =>
    markup.replace(/id="([^"]+)"/g, 'id="efs-$1"').replace(/url\(#([^)]+)\)/g, 'url(#efs-$1)');

  /**
   * The SVG for one theme, as strings. Pure, so it can be tested without a DOM.
   * @param {string} key Theme key.
   * @param {boolean} motion Whether to include animation.
   * @returns {{mark: string, left: string|null, right: string|null, corner: string|null, pos: string|null}|null} Artwork.
   */
  function build(key, motion) {
    const theme = Object.prototype.hasOwnProperty.call(THEMES, key) ? THEMES[key] : null;
    if (!theme) {
      return null;
    }
    return {
      mark: namespaceIds(theme.mark(motion)),
      left: theme.edge ? theme.edge('l', motion) : null,
      right: theme.edge ? theme.edge('r', motion) : null,
      corner: theme.corner ? theme.corner(motion) : null,
      pos: theme.pos,
    };
  }

  /* ---------------- Applying to the header ---------------- */

  const cleanups = new WeakMap();

  const element = (tag, className) => {
    const node = document.createElement(tag);
    node.className = className;
    node.setAttribute('aria-hidden', 'true');
    return node;
  };

  /**
   * Remove any theme from a header, restoring it exactly as it was.
   * @param {Element} header The .ef-header element.
   * @returns {void}
   */
  function clear(header) {
    const undo = cleanups.get(header);
    if (undo) {
      undo();
      cleanups.delete(header);
    }
  }

  /**
   * Dress the public header in a theme. Safe to call again: it clears first.
   * @param {Element} header The .ef-header element.
   * @param {string} key Theme key.
   * @param {{animate?: boolean}} [options] Pass animate: false for reduced motion.
   * @returns {boolean} True when a theme was applied.
   */
  function apply(header, key, options = {}) {
    clear(header);
    const art = build(key, options.animate !== false);
    if (!art || !header) {
      return false;
    }

    const added = [];
    const undo = [];

    /** Set inline styles and remember how to put them back exactly. */
    const setStyles = (node, styles) => {
      const before = {};
      Object.keys(styles).forEach(name => {
        before[name] = node.style[name];
        node.style[name] = styles[name];
      });
      undo.push(() => {
        Object.keys(before).forEach(name => (node.style[name] = before[name]));
        if (!node.getAttribute('style')) {
          node.removeAttribute('style');
        }
      });
    };

    // The few rules that must never wait for the stylesheet are set inline too,
    // so decoration can neither shift the header nor catch a click even if the
    // stylesheet is late or blocked. The stylesheet only adds the finer layout.
    const decoStyles = {
      position: 'absolute',
      top: '0',
      right: '0',
      bottom: '0',
      left: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex: '-1',
    };
    const deco = element('div', 'ef-season-deco');
    setStyles(deco, decoStyles);
    if (art.left) {
      for (const [side, markup] of [
        ['l', art.left],
        ['r', art.right],
      ]) {
        const layer = element('div', `ef-season-layer ef-season-edge ef-season-edge--${side}`);
        layer.dataset.pos = art.pos;
        setStyles(layer, {
          position: 'absolute',
          pointerEvents: 'none',
          backgroundImage: uri(markup),
        });
        deco.appendChild(layer);
      }
    }
    if (art.corner) {
      const corner = element('div', 'ef-season-layer ef-season-corner');
      setStyles(corner, {
        position: 'absolute',
        pointerEvents: 'none',
        backgroundImage: uri(art.corner),
      });
      deco.appendChild(corner);
    }
    header.insertBefore(deco, header.firstChild);
    added.push(deco);

    if (window.getComputedStyle(header).position === 'static') {
      setStyles(header, { position: 'relative' });
    }
    header.classList.add('ef-season-on', `ef-season-${key}`);

    // The mark is a child of the brand link, not of the wordmark, because the
    // wordmark clips its own overflow. It is placed from the wordmark's measured
    // size so it follows the logo at every breakpoint.
    let observer = null;
    let place = null;
    const brand = header.querySelector('.ef-brand');
    const wordmark = brand?.querySelector('.ef-brand-text');
    if (brand && wordmark) {
      if (window.getComputedStyle(brand).position === 'static') {
        setStyles(brand, { position: 'relative' });
      }
      const mark = element('span', 'ef-season-mark');
      setStyles(mark, { position: 'absolute', pointerEvents: 'none', zIndex: '2' });
      mark.innerHTML = art.mark;
      brand.appendChild(mark);
      added.push(mark);

      place = () => {
        const box = wordmark.getBoundingClientRect();
        mark.hidden = !box.width;
        if (!box.width) {
          return;
        }
        const origin = brand.getBoundingClientRect();
        mark.style.width = `${round1(box.width * 0.2)}px`;
        mark.style.height = `${round1(box.width * 0.2)}px`;
        mark.style.left = `${round1(box.left - origin.left - brand.clientLeft + box.width * 1.012)}px`;
        mark.style.top = `${round1(box.top - origin.top - brand.clientTop - box.width * 0.05)}px`;
      };
      place();
      if (typeof window.ResizeObserver === 'function') {
        observer = new window.ResizeObserver(place);
        observer.observe(wordmark);
      }
      // A breakpoint can move the wordmark without resizing it, which the observer misses.
      window.addEventListener('resize', place);
    }

    cleanups.set(header, () => {
      if (observer) {
        observer.disconnect();
      }
      if (place) {
        window.removeEventListener('resize', place);
      }
      added.forEach(node => node.remove());
      undo.reverse().forEach(restore => restore());
      header.classList.remove('ef-season-on', `ef-season-${key}`);
    });
    return true;
  }

  window.EFSeasonalArt = { themes: Object.keys(THEMES), build, apply, clear };
})();
