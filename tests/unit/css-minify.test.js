'use strict';

/**
 * middleware/css-minify.js serves every stylesheet under /assets minified. The
 * property that makes that safe sitewide is that ONLY comments and whitespace
 * change, so these tests pin that down: on crafted CSS for each thing that could
 * go wrong, and on every real stylesheet in the repo.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const postcss = require('postcss');
const request = require('supertest');

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const logger = require('../../utils/logger');
const {
  createCssMinifyMiddleware,
  minifyCss,
  resolveCssFile,
  tighten,
} = require('../../middleware/css-minify');

const minified = source => {
  const { css, reason } = minifyCss(source);
  if (css === null) {
    throw new Error(`not minified: ${reason}`);
  }
  return css;
};

describe('minifyCss: what it removes', () => {
  test('removes ordinary comments, wherever they are', () => {
    const css = minified(`
      /* header */
      a /* in selector */ { color /* in prop */ : red /* in value */; /* between */ margin: 0 }
      /* trailing */
    `);
    expect(css).not.toContain('/*');
    expect(css).toBe('a{color:red;margin:0}');
  });

  test('keeps /*! licence comments but not /* !important ... */ remarks', () => {
    const css = minified(`
      /*! Library v1.0 | MIT */
      /* !important overrides the mobile rule above */
      a { color: red; }
    `);
    expect(css).toContain('/*! Library v1.0 | MIT */');
    expect(css).not.toContain('overrides the mobile rule');
  });

  test('collapses whitespace and drops it around commas', () => {
    expect(
      minified('a ,\n  b   >   c {\n  margin :   0   auto ;\n  font-family: A ,  B ,C;\n}')
    ).toBe('a,b > c{margin:0 auto;font-family:A,B,C}');
  });

  test('is idempotent', () => {
    const once = minified(
      'a { /* x */ color : red ; }\n\n@media (min-width: 1px) { b { top: 0 } }'
    );
    expect(minifyCss(once).css).toBeNull(); // nothing left to remove...
    expect(minifyCss(once).reason).toBe('not smaller'); // ...and it says so, rather than failing
  });
});

describe('minifyCss: what it must NOT change', () => {
  test('quoted strings are left alone: spaces, commas, escaped quotes, url()', () => {
    const css = minified(
      `a::before { content: "a   b, c"; }
       b { font-family: 'Open  Sans', "A \\" , B"; background: url( "x   y.png" ); }
       @font-face { src: url("a  b.woff2") format("woff2"), url('c,d.woff') format('woff'); }`
    );
    expect(css).toContain('content:"a   b, c"');
    expect(css).toContain(`'Open  Sans'`);
    expect(css).toContain('"A \\" , B"');
    expect(css).toContain('"x   y.png"');
    expect(css).toContain('"a  b.woff2"');
    expect(css).toContain(`'c,d.woff'`);
  });

  test('does not rewrite values or selectors (no colour shortening, 0% -> 0, sorting)', () => {
    const css = minified(`
      b, a { color: white; background: #FFFFFF; margin: 0px 0.50em; flex: 1 1 0%; opacity: 0.0 }
      i { background: linear-gradient(135deg, #0B8073 0%, #13B6A2 100%) }
      u::after, u::before { top: 0% }
    `);
    expect(css).toContain('b,a{');
    expect(css).toContain('color:white');
    expect(css).toContain('#FFFFFF');
    expect(css).toContain('margin:0px 0.50em');
    expect(css).toContain('flex:1 1 0%');
    expect(css).toContain('opacity:0.0');
    expect(css).toContain('linear-gradient(135deg,#0B8073 0%,#13B6A2 100%)');
    expect(css).toContain('u::after,u::before');
    expect(css).toContain('top:0%');
  });

  test('keeps declaration order, duplicates (fallbacks) and !important', () => {
    const css = minified(
      'a { width: 100%; width: calc(100% - 2px); color: red ! important; color: blue !IMPORTANT }'
    );
    expect(css).toBe(
      'a{width:100%;width:calc(100% - 2px);color:red!important;color:blue!important}'
    );
  });

  test('keeps IE hack prefixes, which would otherwise become ordinary declarations', () => {
    const css = minified('a { *zoom: 1; _height: 1px; color : red ; }');
    expect(css).toContain('*zoom:1');
    expect(css).toContain('_height:1px');
  });

  test('leaves a --custom-property value exactly as written (script can read it back)', () => {
    const css = minified(
      `:root { --a:   1px   2px ; --json: { "a" :  1 } ; --e: ; --c: red /* kept */ ; --f: A ,  B ; }`
    );
    expect(css).toContain('--a:1px   2px');
    expect(css).toContain('--json:{ "a" :  1 }');
    expect(css).toContain('--f:A ,  B');
  });

  test('keeps at-rule structure: nesting, params, empty-parameter rules', () => {
    const source = `
      @charset "utf-8";
      @import url("x.css") screen and (min-width:1px), print;
      @media screen and ( min-width : 600px ) , print { @supports (display:grid) { a { display: grid } } }
      @keyframes spin { from { transform: rotate(0deg) } 50.5% { opacity: .5 } to { transform: rotate(360deg) } }
      @font-face { font-family: X; src: url(x.woff2) }
      @page { margin: 1cm }
    `;
    const out = minified(source);
    const flat = css => {
      const items = [];
      (function walk(node, depth) {
        node.each(n => {
          if (n.type === 'rule') {
            items.push(`${depth}R${n.selector.replace(/\s+/g, '')}`);
            walk(n, depth + 1);
          } else if (n.type === 'atrule') {
            items.push(`${depth}A${n.name}${n.params.replace(/\s+/g, '')}`);
            if (n.nodes) {
              walk(n, depth + 1);
            }
          } else if (n.type === 'decl') {
            items.push(`${depth}D${n.prop}:${n.value.replace(/\s+/g, '')}`);
          }
        });
      })(postcss.parse(css), 0);
      return items;
    };
    expect(flat(out)).toEqual(flat(source));
    expect(out.startsWith('@charset')).toBe(true);
  });
});

describe('minifyCss: when it declines (the file is then served as it is)', () => {
  test('CSS PostCSS cannot parse', () => {
    const { css, reason } = minifyCss('a { color: red ');
    expect(css).toBeNull();
    expect(reason).toMatch(/^exception:/);
  });

  test('output that would not be smaller', () => {
    expect(minifyCss('a{b:c}')).toEqual({ css: null, reason: 'not smaller' });
  });
});

describe('tighten', () => {
  test('collapses outside strings only, and never touches the inside of one', () => {
    expect(tighten('  a   b ,  "x   ,  y"  ,c ')).toBe('a b,"x   ,  y",c');
  });
});

describe('every stylesheet in the repo', () => {
  const root = path.resolve(__dirname, '../../public/assets');
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'vendor') {
          walk(full);
        }
      } else if (/\.css$/i.test(full) && !/\.min\.css$/i.test(full)) {
        files.push(full);
      }
    }
  })(root);

  const noSpace = s => String(s).replace(/\s+/g, '');
  const tokenCount = s =>
    String(s)
      .replace(/\s*,\s*/g, ',')
      .trim()
      .split(/\s+/).length;
  const flatten = css => {
    const items = [];
    (function walk(node, ctx) {
      node.each(n => {
        if (n.type === 'rule') {
          items.push(['R', ctx, n.selector]);
          walk(n, ctx);
        } else if (n.type === 'atrule') {
          items.push(['A', ctx, `@${n.name} ${n.params}`]);
          if (n.nodes) {
            walk(n, `${ctx}/${n.name} ${noSpace(n.params)}`);
          }
        } else if (n.type === 'decl') {
          const hack = (n.raws.before || '').replace(/\s+/g, '');
          items.push(['D', ctx, `${hack}${n.prop}:${n.value}${n.important ? '!' : ''}`]);
        }
      });
    })(postcss.parse(css), '');
    return items;
  };

  test('there are stylesheets to check', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  test('each one minifies to identical rules, properties, values and order', () => {
    const problems = [];
    let smaller = 0;
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const { css, reason } = minifyCss(source);
      const name = path.relative(root, file);
      if (css === null) {
        problems.push(`${name}: not minified (${reason})`);
        continue;
      }
      smaller += 1;
      // No comment other than a /*! licence comment may survive.
      if (/\/\*(?!!)/.test(css.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ''))) {
        problems.push(`${name}: a non-licence comment survived`);
      }
      const before = flatten(source);
      const after = flatten(css);
      if (before.length !== after.length) {
        problems.push(`${name}: ${before.length} nodes became ${after.length}`);
        continue;
      }
      for (let i = 0; i < before.length; i++) {
        const [kind, ctx, text] = before[i];
        const [kind2, ctx2, text2] = after[i];
        const custom = text.startsWith('--');
        const same =
          kind === kind2 &&
          ctx === ctx2 &&
          noSpace(text) === noSpace(text2) &&
          tokenCount(text) === tokenCount(text2) &&
          // a custom property is exposed to script, so it must be byte-identical
          (!custom || text === text2);
        if (!same) {
          problems.push(`${name} #${i}: "${text.slice(0, 80)}" became "${text2.slice(0, 80)}"`);
          break;
        }
      }
    }
    expect(problems).toEqual([]);
    expect(smaller).toBe(files.length);
  });
});

describe('resolveCssFile', () => {
  const base = path.resolve('/srv/public');

  test('maps a stylesheet under /assets to its file', () => {
    expect(resolveCssFile(base, '/assets/css/styles.css')).toBe(
      path.join(base, 'assets/css/styles.css')
    );
    expect(resolveCssFile(base, '/assets/css/sub%20dir/a.CSS')).toBe(
      path.join(base, 'assets/css/sub dir/a.CSS')
    );
  });

  test.each([
    ['not CSS', '/assets/js/app.js'],
    ['outside /assets', '/styles.css'],
    ['a vendor file', '/assets/css/vendor/lib.css'],
    ['already minified', '/assets/css/lib.min.css'],
    ['traversal', '/assets/css/../../server.css'],
    ['encoded traversal', '/assets/css/%2e%2e/%2e%2e/x.css'],
    ['dot segment', '/assets/css/./x.css'],
    ['a backslash', '/assets/css/..\\x.css'],
    ['a NUL byte', '/assets/css/x.css%00.png'],
    ['malformed encoding', '/assets/css/%E0%A4%A.css'],
    ['a directory-like path', '/assets/css/'],
    ['just /assets/.css', '/assets/.css'],
  ])('refuses %s', (_label, urlPath) => {
    expect(resolveCssFile(base, urlPath)).toBeNull();
  });
});

describe('createCssMinifyMiddleware', () => {
  let dir;
  let readSpy;
  let server;
  const write = (rel, content, mtime) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    if (mtime) {
      fs.utimesSync(file, mtime, mtime);
    }
    return file;
  };
  const SOURCE =
    '/* a comment that is long enough to matter */\na {\n  color : red ;\n  margin: 0 ;\n}\n';

  const build = options => {
    const app = express();
    // server.js rate-limits every route globally; do the same here so this stand-in app
    // (which reads files from disk) is not an unthrottled file-serving route.
    app.use(
      rateLimit({
        windowMs: 60 * 1000,
        limit: 100000,
        standardHeaders: false,
        legacyHeaders: false,
      })
    );
    // stands in for staticCachingMiddleware, which runs ahead of this in server.js
    app.use((req, res, next) => {
      res.setHeader('Cache-Control', 'public, max-age=604800, must-revalidate');
      next();
    });
    server = createCssMinifyMiddleware({ root: dir, ...options });
    app.use(server);
    app.use(express.static(dir));
    return app;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'css-minify-'));
    write('assets/css/site.css', SOURCE);
    write('assets/js/app.js', 'const  a   =  1 ;');
    logger.warn.mockClear();
    readSpy = jest.spyOn(fs.promises, 'readFile');
  });

  afterEach(() => {
    readSpy.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.EF_MINIFY_CSS;
  });

  const cssReads = () =>
    readSpy.mock.calls.filter(([file]) => String(file).endsWith('.css')).length;

  test('serves the stylesheet minified, as CSS, keeping the cache header set before it', async () => {
    const res = await request(build()).get('/assets/css/site.css?v=3');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(res.headers['cache-control']).toBe('public, max-age=604800, must-revalidate');
    expect(res.text).toBe('a{color:red;margin:0}');
    expect(res.headers.etag).toBeTruthy();
    expect(res.headers['last-modified']).toBeTruthy();
  });

  test('answers a conditional request with 304, and HEAD with no body', async () => {
    const app = build();
    const first = await request(app).get('/assets/css/site.css');
    const again = await request(app)
      .get('/assets/css/site.css')
      .set('If-None-Match', first.headers.etag);
    expect(again.status).toBe(304);

    const head = await request(app).head('/assets/css/site.css');
    expect(head.status).toBe(200);
    expect(head.text || '').toBe('');
  });

  test('minifies once and reuses it, and many simultaneous first requests share one read', async () => {
    const app = build();
    await Promise.all(Array.from({ length: 6 }, () => request(app).get('/assets/css/site.css')));
    await request(app).get('/assets/css/site.css');
    expect(cssReads()).toBe(1);
  });

  test('picks up an edit to the file on the next request', async () => {
    const app = build();
    const before = await request(app).get('/assets/css/site.css');
    write('assets/css/site.css', `${SOURCE}b { top : 1px }\n`, new Date(Date.now() + 5000));
    const after = await request(app).get('/assets/css/site.css');
    expect(before.text).toBe('a{color:red;margin:0}');
    expect(after.text).toBe('a{color:red;margin:0}b{top:1px}');
  });

  test('serves a file it cannot minify exactly as it is, logs it once, and does not retry', async () => {
    const broken = 'a { color: red ;  /* never closed \n';
    write('assets/css/broken.css', broken);
    const app = build();
    const a = await request(app).get('/assets/css/broken.css');
    const b = await request(app).get('/assets/css/broken.css');
    expect(a.status).toBe(200);
    expect(a.text).toBe(broken);
    expect(b.text).toBe(broken);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'CSS served unminified',
      expect.objectContaining({ file: path.join('assets', 'css', 'broken.css') })
    );
    expect(cssReads()).toBe(1);
  });

  test('leaves everything else to express.static: JS, vendor, *.min.css, unknown files, other methods', async () => {
    write('assets/css/vendor/lib.css', 'a  {  b : c  }\n');
    write('assets/css/lib.min.css', 'a  {  b : c  }\n');
    const app = build();
    expect((await request(app).get('/assets/js/app.js')).text).toBe('const  a   =  1 ;');
    expect((await request(app).get('/assets/css/vendor/lib.css')).text).toBe('a  {  b : c  }\n');
    expect((await request(app).get('/assets/css/lib.min.css')).text).toBe('a  {  b : c  }\n');
    expect((await request(app).get('/assets/css/missing.css')).status).toBe(404);
    expect((await request(app).get('/assets/css/..%2f..%2fetc.css')).status).toBe(404);
    expect((await request(app).post('/assets/css/site.css')).status).toBe(404);
    expect(cssReads()).toBe(0);
  });

  test('can be switched off, in code or with EF_MINIFY_CSS=false', async () => {
    expect((await request(build({ enabled: false })).get('/assets/css/site.css')).text).toBe(
      SOURCE
    );
    process.env.EF_MINIFY_CSS = 'false';
    expect((await request(build()).get('/assets/css/site.css')).text).toBe(SOURCE);
    delete process.env.EF_MINIFY_CSS;
    expect((await request(build()).get('/assets/css/site.css')).text).toBe('a{color:red;margin:0}');
  });

  test('resetCache forgets what it has minified', async () => {
    const app = build();
    await request(app).get('/assets/css/site.css');
    server.resetCache();
    await request(app).get('/assets/css/site.css');
    expect(cssReads()).toBe(2);
  });
});

describe('server.js wiring', () => {
  test('mounts the minifier after cache headers and before express.static serves public/', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../server.js'), 'utf8');
    const cacheHeaders = source.indexOf('app.use(staticCachingMiddleware())');
    const compression = source.indexOf('app.use(configureCompression())');
    const minifier = source.indexOf(
      "createCssMinifyMiddleware({ root: path.join(__dirname, 'public') })"
    );
    const staticPublic = source.indexOf("app.use(express.static(path.join(__dirname, 'public')))");
    expect(cacheHeaders).toBeGreaterThan(-1);
    expect(compression).toBeGreaterThan(-1);
    expect(minifier).toBeGreaterThan(cacheHeaders);
    expect(minifier).toBeGreaterThan(compression);
    expect(staticPublic).toBeGreaterThan(minifier);
  });
});
