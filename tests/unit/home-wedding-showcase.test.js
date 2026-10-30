'use strict';

/**
 * Homepage wedding website / RSVP / seating plan showcase.
 *
 * The admin can switch the live homepage between versions, so the section ships in both
 * public/index.html (v1) and public/home-v2.html (v2); v3 has its own separate interactive copy.
 * These tests keep the two copies identical, keep the SEO structured data in step with the
 * visible FAQ, and make sure the copy avoids the strings the anonymous-page sanitizer
 * deliberately strips. The markup in the page is the static illustration (what visitors without
 * JavaScript and search engines get); public/assets/js/pages/home-wedding-showcase.js upgrades
 * it into a small interactive sample, which the last describe block exercises in jsdom. The
 * script's colour, name and date helpers are pure and exported, so they are tested directly.
 */

const fs = require('fs');
const path = require('path');

const { execFileSync } = require('child_process');
const PUBLIC_DIR = path.join(__dirname, '../../public');
const read = file => fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');

const PAGES = ['index.html', 'home-v2.html'];
const START = '<!-- hws:start';
const END = '<!-- hws:end -->';

const sectionOf = html => {
  const from = html.indexOf(START);
  const to = html.indexOf(END);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return html.slice(from, to + END.length);
};

const jsonLdBlocks = html =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match =>
    JSON.parse(match[1])
  );

const flattenGraph = blocks =>
  blocks.flatMap(block => (block['@graph'] ? block['@graph'] : [block]));

const textOf = html =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

describe('homepage wedding showcase section', () => {
  const sections = PAGES.map(page => sectionOf(read(page)));

  test('both homepage files carry the same section, so every homepage version shows it', () => {
    expect(sections[0]).toBe(sections[1]);
  });

  test('it targets the wedding website, RSVP and seating plan searches in plain, visible text', () => {
    const text = textOf(sections[0]).toLowerCase();
    [
      'wedding website',
      'free wedding website',
      'online wedding rsvp',
      'wedding rsvps',
      'guest list',
      'seating plan',
      'qr code',
      'whatsapp',
    ].forEach(keyword => expect(text).toContain(keyword));
  });

  test('it has one h2, h3 sub-headings and no skipped heading levels', () => {
    const html = sections[0];
    expect(html.match(/<h2\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<h1\b/);
    expect(html.match(/<h3\b/g).length).toBeGreaterThanOrEqual(5);
    expect(html).not.toMatch(/<h4\b/);
  });

  test('its internal links point at pages that exist and avoid supplier query links', () => {
    const hrefs = [...sections[0].matchAll(/href="([^"]+)"/g)].map(match =>
      match[1].replace(/&amp;/g, '&')
    );
    expect(hrefs.length).toBeGreaterThan(0);
    hrefs.forEach(href => {
      expect(href).toMatch(/^\//);
      expect(href).not.toMatch(/^\/suppliers\?/);
    });
    expect(hrefs).toContain('/articles/wedding-website-on-eventflow-guide');
    expect(hrefs).toContain('/auth?tab=create&role=customer');
    expect(
      fs.existsSync(path.join(PUBLIC_DIR, 'articles/wedding-website-on-eventflow-guide.html'))
    ).toBe(true);
  });

  test('the static illustration is described once and hidden from assistive technology until the script upgrades it', () => {
    const html = sections[0];
    expect(html).toMatch(
      /class="hws__stage" role="img" aria-label="Illustration of a wedding website/
    );
    ['hws__tracker', 'hws__phone', 'hws__seating'].forEach(name =>
      expect(html).toMatch(
        new RegExp(
          `class="hws__card ${name}"[^>]*aria-hidden="true"|class="${name}"[^>]*aria-hidden="true"`
        )
      )
    );
    // every inline svg is decorative
    expect(html.match(/<svg\b(?![^>]*aria-hidden="true")[^>]*>/g)).toBeNull();
    expect(html).toContain('<figcaption>Illustrative preview');
  });

  test('it makes no claims the site cannot back up and avoids strings the sanitizer strips', () => {
    const text = textOf(sections[0]);
    expect(text).not.toMatch(
      /View all|Verified|Customer Reviews|What Our Customers Say|Notifications|Log out|Mark all as read/i
    );
    expect(text).not.toMatch(/\b(thousands|millions|\d+,\d{3}) (of )?(couples|weddings|users)/i);
    expect(text).not.toMatch(/rated|stars?\b|testimonial/i);
    expect(sections[0]).not.toMatch(/>\s*Dashboard\s*</);
  });
});

describe('homepage wedding showcase structured data', () => {
  test.each(PAGES)('%s declares the service and one FAQPage that matches the visible FAQ', page => {
    const html = read(page);
    const nodes = flattenGraph(jsonLdBlocks(html));

    const service = nodes.find(node => node['@type'] === 'Service');
    expect(service).toBeDefined();
    expect(service.provider).toEqual({ '@id': 'https://event-flow.co.uk/#organization' });
    expect(service.offers).toMatchObject({ price: '0', priceCurrency: 'GBP' });

    const faqPages = nodes.filter(node => node['@type'] === 'FAQPage');
    expect(faqPages).toHaveLength(1);

    const visible = [
      ...sectionOf(html).matchAll(/<details class="hws__faq-item">([\s\S]*?)<\/details>/g),
    ].map(match => ({
      question: textOf(match[1].match(/<summary>([\s\S]*?)<\/summary>/)[1]),
      answer: textOf(match[1].replace(/<summary>[\s\S]*?<\/summary>/, '')),
    }));
    const declared = faqPages[0].mainEntity.map(item => ({
      question: item.name,
      answer: item.acceptedAnswer.text,
    }));
    expect(declared.length).toBeGreaterThanOrEqual(4);
    expect(declared).toEqual(visible);
  });

  test.each(PAGES)('%s gives every JSON-LD @id only once', page => {
    const ids = flattenGraph(jsonLdBlocks(read(page)))
      .map(node => node['@id'])
      .filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('homepage wedding showcase assets', () => {
  test.each(PAGES)('%s loads the stylesheet with a version', page => {
    expect(read(page)).toMatch(/home-wedding-showcase\.css\?v=[\d.]+/);
  });

  test.each(PAGES)('%s loads the interactive script, deferred and versioned', page => {
    expect(read(page)).toMatch(
      /<script src="\/assets\/js\/pages\/home-wedding-showcase\.js\?v=[\d.]+" defer><\/script>/
    );
  });

  test('the script exists and does not run inside the section markup itself', () => {
    expect(fs.existsSync(path.join(PUBLIC_DIR, 'assets/js/pages/home-wedding-showcase.js'))).toBe(
      true
    );
    PAGES.forEach(page => expect(sectionOf(read(page))).not.toMatch(/<script\b/));
  });

  test('the stylesheet is scoped to the section so it cannot restyle the rest of the homepage', () => {
    const css = read('assets/css/home-wedding-showcase.css');
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('{')
      .slice(0, -1)
      .map(part => part.split('}').pop().trim())
      .filter(part => part && !part.startsWith('@') && !/^\d+%$|^(from|to)$/.test(part))
      .flatMap(part => part.split(/,(?![^(]*\))/).map(sel => sel.trim()));
    const unscoped = selectors.filter(sel => !/\.hws/.test(sel));
    expect(unscoped).toEqual([]);
  });
});

/**
 * jsdom is run in a child process, as the legal-pages tests do: jest's own module loader cannot
 * load the ES-module-only packages jsdom depends on.
 */
function runNodeSmoke(source) {
  return execFileSync(process.execPath, ['-e', source], {
    cwd: path.join(__dirname, '../..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('homepage wedding showcase interactive sample', () => {
  // Loads the section into jsdom the way the page does, then runs the script against it.
  const PRELUDE = String.raw`
    const assert = require('assert');
    const fs = require('fs');
    const { JSDOM } = require('jsdom');
    const script = fs.readFileSync('public/assets/js/pages/home-wedding-showcase.js', 'utf8');
    const sectionOf = file => {
      const html = fs.readFileSync('public/' + file, 'utf8');
      const from = html.indexOf('<!-- hws:start');
      return html.slice(from, html.indexOf('<!-- hws:end -->') + 16);
    };
    function mount(file = 'index.html', run = true, before = null) {
      const dom = new JSDOM('<!doctype html><body><main>' + sectionOf(file) + '</main></body>', {
        runScripts: 'outside-only',
      });
      if (before) before(dom.window);
      if (run) dom.window.eval(script);
      const doc = dom.window.document;
      return {
        dom, doc, section: doc.querySelector('.hws'),
        numbers: () => ({
          counts: [...doc.querySelectorAll('.hws__legend li b')].map(el => el.textContent),
          percent: doc.querySelector('.hws__donut-label strong').textContent,
          rows: [...doc.querySelectorAll('.hws__replies li strong')].map(el => el.textContent),
        }),
        table: number => [...doc.querySelectorAll('circle.hws-table[role="button"]')].find(el =>
          el.getAttribute('aria-label').startsWith('Table ' + number + ',')),
        free: () => doc.querySelector('.hws__seating .hws__card-head span').textContent,
        status: () => doc.querySelector('.hws-seat-status').textContent,
        submit: () => doc.querySelector('form.hws__site-rsvp')
          .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })),
        click: el => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
        type: (el, value) => {
          el.value = value;
          el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        },
        pick: input => {
          input.checked = true;
          input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        },
        pointer: (target, type, init) => {
          const event = new dom.window.MouseEvent(type, { bubbles: true, button: 0, ...init });
          Object.defineProperty(event, 'pointerType', { value: (init && init.pointerType) || 'mouse' });
          target.dispatchEvent(event);
        },
      };
    }
  `;

  const scenario = body => runNodeSmoke(PRELUDE + body);

  test('without the script the section stays the static illustration', () => {
    scenario(String.raw`
      const { doc, section } = mount('index.html', false);
      assert.strictEqual(section.classList.contains('hws--live'), false);
      assert.strictEqual(doc.querySelectorAll('.hws button, .hws input, .hws select, .hws form').length, 0);
      assert.strictEqual(doc.querySelector('.hws__stage').getAttribute('role'), 'img');
    `);
  });

  test('it upgrades the illustration into labelled, real controls', () => {
    scenario(String.raw`
      const { doc, section } = mount();
      assert.ok(section.classList.contains('hws--live'));
      const stage = doc.querySelector('.hws__stage');
      assert.strictEqual(stage.getAttribute('role'), 'group');
      assert.match(stage.getAttribute('aria-label'), /interactive/i);
      for (const selector of ['.hws__tracker', '.hws__phone', '.hws__seating']) {
        assert.strictEqual(doc.querySelector(selector).hasAttribute('aria-hidden'), false, selector);
      }
      assert.strictEqual(doc.querySelectorAll('input[type="radio"][name="hws-reply"]').length, 2);
      assert.strictEqual(doc.querySelectorAll('button.hws-guest').length, 3);
      assert.ok(doc.querySelectorAll('[role="status"]').length >= 2);
      // every control is a real, enabled element, never a disabled placeholder
      assert.strictEqual(doc.querySelectorAll('.hws button:disabled, .hws input:disabled').length, 0);
      doc.querySelectorAll('.hws-view').forEach(b => assert.ok(b.hasAttribute('aria-pressed')));
      // the required caption is kept
      assert.ok(doc.querySelector('figcaption').textContent.includes('Illustrative preview.'));
    `);
  });

  test('sending a sample RSVP updates the counts once, and changing it does not double count', () => {
    scenario(String.raw`
      const { doc, numbers, submit } = mount();
      assert.deepStrictEqual(numbers().counts, ['64', '14', '18']);
      assert.strictEqual(numbers().percent, '81%');

      submit();
      assert.deepStrictEqual(numbers().counts, ['65', '14', '17']);
      assert.strictEqual(numbers().percent, '82%');
      assert.strictEqual(numbers().rows[0], 'Your sample reply');
      assert.strictEqual(numbers().rows.length, 3);
      assert.match(doc.querySelector('.hws-rsvp-confirm').textContent, /Sample RSVP sent/);

      // the numbers that changed are marked so the page can draw the eye to them
      const changed = () => [...doc.querySelectorAll('.hws__legend li b.is-changed')].map(el => el.textContent);
      assert.deepStrictEqual(changed(), ['65', '17']);
      assert.strictEqual(doc.querySelector('.hws-new-reply').dataset.reply, 'yes');

      doc.querySelector('input[value="no"]').checked = true;
      submit();
      assert.deepStrictEqual(numbers().counts, ['64', '15', '17']);
      assert.strictEqual(doc.querySelectorAll('.hws-new-reply').length, 1);
      assert.strictEqual(doc.querySelector('.hws-new-reply').dataset.reply, 'no');
      assert.deepStrictEqual(changed(), ['64', '15']);
    `);
  });

  test('the donut arcs always add up to the whole ring', () => {
    scenario(String.raw`
      const { doc, submit } = mount();
      submit();
      const arcs = [...doc.querySelectorAll('.hws-seg--yes, .hws-seg--no, .hws-seg--wait')]
        .map(el => Number(el.getAttribute('stroke-dasharray').split(' ')[0]));
      const total = arcs.reduce((sum, arc) => sum + arc, 0);
      assert.ok(Math.abs(total - 2 * Math.PI * 38) < 0.5, 'arcs total ' + total);
    `);
  });

  test('tapping a guest then a table seats them, respects capacity and counts free seats', () => {
    scenario(String.raw`
      const { doc, table, click, free, status } = mount();
      assert.strictEqual(free(), '4 tables · 31 seats · 3 free');

      click(table(2));
      assert.match(free(), /2 free/);
      assert.ok(status().includes('Charlotte E. is now at Table 2'));
      assert.strictEqual(
        doc.querySelector('.hws-guest[data-guest="Charlotte E."]').getAttribute('aria-label'),
        'Charlotte E., seated at table 2'
      );

      // a different guest, chosen first, goes to table 3, which has one seat
      click(doc.querySelector('.hws-guest[data-guest="Tom H."]'));
      click(table(3));
      assert.match(free(), /1 free/);

      // table 3 is now full, so the last guest is refused there but accepted at table 2
      click(table(3));
      assert.ok(status().includes('Table 3 is full'));
      assert.match(free(), /1 free/);
      click(table(2));
      assert.match(free(), /0 free/);
      assert.ok(status().includes('Everyone is seated'));
      assert.strictEqual(doc.querySelector('.hws__drag').hidden, true);
    `);
  });

  test('the floating guest chip only hints at the first move, and comes back on Reset', () => {
    scenario(String.raw`
      const { doc, table, click } = mount();
      const chip = doc.querySelector('.hws__drag');
      assert.strictEqual(chip.hidden, false);
      // choosing a guest keeps it, naming who is selected
      click(doc.querySelector('.hws-guest[data-guest="Priya S."]'));
      assert.strictEqual(chip.hidden, false);
      assert.ok(chip.textContent.includes('Priya S.'));
      // once someone is seated the guest buttons say who is next, so the chip steps aside
      click(table(2));
      assert.strictEqual(chip.hidden, true);
      click(doc.querySelector('.hws-reset'));
      assert.strictEqual(chip.hidden, false);
    `);
  });

  test('seating is also reachable from the keyboard', () => {
    scenario(String.raw`
      const { dom, table, free } = mount();
      assert.strictEqual(table(2).getAttribute('tabindex'), '0');
      table(2).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      assert.match(free(), /2 free/);
      table(2).dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
      );
      assert.match(free(), /1 free/);
    `);
  });

  test('Reset puts the replies, the seats and the phone back', () => {
    scenario(String.raw`
      const { doc, numbers, submit, table, click, free } = mount();
      submit();
      click(table(2));
      click(doc.querySelector('.hws-reset'));
      assert.deepStrictEqual(numbers().counts, ['64', '14', '18']);
      assert.strictEqual(numbers().rows[0], 'Priya Shah');
      assert.match(free(), /3 free/);
      assert.strictEqual(doc.querySelectorAll('.hws-seat.is-new').length, 0);
      assert.strictEqual(doc.querySelector('.hws-rsvp-confirm').textContent, '');
      assert.strictEqual(doc.querySelector('.hws-send').textContent, 'Send RSVP');
      assert.strictEqual(doc.querySelector('input[value="yes"]').checked, true);
      assert.strictEqual(doc.querySelector('.hws__stage').dataset.view, 'website');
    `);
  });

  test('the tab bar switches the visible panel and tracks the pressed view', () => {
    scenario(String.raw`
      const { doc, click } = mount();
      const tab = view => doc.querySelector('.hws-view[data-view="' + view + '"]');
      assert.strictEqual(tab('website').getAttribute('aria-pressed'), 'true');
      click(tab('seating'));
      assert.strictEqual(doc.querySelector('.hws__stage').dataset.view, 'seating');
      assert.strictEqual(tab('seating').getAttribute('aria-pressed'), 'true');
      assert.strictEqual(tab('website').getAttribute('aria-pressed'), 'false');
    `);
  });

  test('it does nothing when the expected markup is missing, and never runs twice', () => {
    scenario(String.raw`
      const empty = new JSDOM('<!doctype html><body><main><div class="hws"></div></main></body>', {
        runScripts: 'outside-only',
      });
      empty.window.eval(script);
      assert.strictEqual(empty.window.document.querySelector('.hws--live'), null);

      const { dom, doc } = mount();
      dom.window.eval(script);
      assert.strictEqual(doc.querySelectorAll('.hws-playbar').length, 1);
    `);
  });

  test('it behaves the same on the home-v2 copy of the section', () => {
    scenario(String.raw`
      const { section, numbers, submit } = mount('home-v2.html');
      assert.ok(section.classList.contains('hws--live'));
      submit();
      assert.deepStrictEqual(numbers().counts, ['65', '14', '17']);
    `);
  });

  test('five colours repaint the phone, and Plum puts the original look back', () => {
    scenario(String.raw`
      const { doc, pick } = mount();
      const stage = doc.querySelector('.hws__stage');
      const accent = () => stage.style.getPropertyValue('--hp-accent');
      const dots = [...doc.querySelectorAll('.hws-dot input[type="radio"]')];
      assert.strictEqual(dots.length, 5);
      assert.strictEqual(dots[0].checked, true);
      assert.strictEqual(accent(), '');

      pick(dots[3]);
      assert.strictEqual(accent().toLowerCase(), '#24436f');
      assert.ok(stage.style.getPropertyValue('--hp-bg'));
      assert.match(doc.querySelector('.hws-colours [role="status"]').textContent, /Midnight/);
      // the "You" avatar and the seats you place wear the same colour through the shared variable
      pick(dots[4]);
      assert.strictEqual(accent().toLowerCase(), '#b85c38');
      pick(dots[0]);
      assert.strictEqual(accent(), '');
    `);
  });

  test('the colour selector sits under the phone, between the phone and the QR card', () => {
    scenario(String.raw`
      const { doc } = mount();
      const column = doc.querySelector('.hws__phonecol');
      const order = [...column.children].map(el => el.className.split(' ')[0]);
      assert.deepStrictEqual(order, ['hws__phone', 'hws-colours', 'hws__chip']);
      assert.ok(column.querySelector('.hws__chip--qr'));
      assert.strictEqual(column.querySelector('.hws-colours').getAttribute('aria-label'), 'Website colour');
      // no name, date or free-form colour fields: the sample stays basic
      assert.strictEqual(doc.querySelectorAll('.hws input[type="text"], .hws input[type="date"], .hws input[type="color"]').length, 0);
    `);
  });

  test('only guests who are coming are asked about meals, and the choice shows in the reply', () => {
    scenario(String.raw`
      const { doc, pick, submit } = mount();
      const meals = doc.querySelector('.hws-meals');
      const reply = () => doc.querySelector('.hws-new-reply em').textContent;
      assert.strictEqual(meals.hidden, false);
      assert.strictEqual(meals.querySelectorAll('input').length, 3);

      submit();
      assert.strictEqual(reply(), 'Attending');
      pick(doc.querySelector('input[name="hws-meal"][value="Salmon"]'));
      submit();
      assert.strictEqual(reply(), 'Salmon');

      pick(doc.querySelector('input[name="hws-reply"][value="no"]'));
      assert.strictEqual(meals.hidden, true);
      submit();
      assert.strictEqual(reply(), 'Declined');
      assert.strictEqual(doc.querySelectorAll('.hws-new-reply').length, 1);
    `);
  });

  test('the steps tick as the flow is tried, and the sign-up link appears after RSVP and seating', () => {
    scenario(String.raw`
      const { doc, pick, submit, table, click } = mount();
      const finish = doc.querySelector('.hws-finish');
      const ticked = () => doc.querySelectorAll('.hws-steps li.is-done').length;
      assert.strictEqual(doc.querySelectorAll('.hws-steps li').length, 3);
      assert.strictEqual(ticked(), 0);
      assert.strictEqual(finish.hidden, true);

      submit();
      assert.strictEqual(ticked(), 1);
      assert.strictEqual(finish.hidden, true);
      click(table(2));
      assert.strictEqual(ticked(), 2);
      assert.strictEqual(finish.hidden, false);
      const link = finish.querySelector('a');
      assert.strictEqual(link.getAttribute('href'), '/auth?tab=create&role=customer');
      pick(doc.querySelectorAll('.hws-dot input[type="radio"]')[1]);
      assert.strictEqual(ticked(), 3);
      assert.match(doc.querySelector('.hws-step[data-step="colour"]').textContent, /done/);

      click(doc.querySelector('.hws-reset'));
      assert.strictEqual(ticked(), 0);
      assert.strictEqual(finish.hidden, true);
    `);
  });

  test('auto-seat seats everyone left, at once for visitors who prefer less motion', () => {
    scenario(String.raw`
      const { doc, click, free, status, table } = mount('index.html', true, win => {
        win.matchMedia = query => ({ matches: /reduce/.test(query) });
      });
      click(table(2));
      click(doc.querySelector('.hws-autoseat'));
      assert.match(free(), /0 free/);
      assert.ok(status().includes('Everyone is seated'));
      assert.strictEqual(doc.querySelector('.hws__drag').hidden, true);
      assert.strictEqual(doc.querySelector('.hws-autoseat').getAttribute('aria-disabled'), 'true');
    `);
  });

  test('auto-seat seats guests one by one, and Reset cancels one in progress', () => {
    scenario(String.raw`
      (async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const first = mount();
        first.click(first.doc.querySelector('.hws-autoseat'));
        assert.match(first.free(), /3 free/, 'nothing is seated in the same instant');
        await wait(1100);
        assert.match(first.free(), /0 free/);

        const second = mount();
        second.click(second.doc.querySelector('.hws-autoseat'));
        second.click(second.doc.querySelector('.hws-reset'));
        await wait(1100);
        assert.match(second.free(), /3 free/);
      })();
    `);
  });

  test('a guest can be dragged onto a table with a mouse, but a touch never starts a drag', () => {
    scenario(String.raw`
      const { doc, dom, table, free, pointer } = mount();
      const guest = doc.querySelector('.hws-guest[data-guest="Tom H."]');
      doc.elementFromPoint = () => table(2);

      // touch: scrolling must win, so nothing is dragged or seated
      pointer(guest, 'pointerdown', { clientX: 5, clientY: 5, pointerType: 'touch' });
      pointer(doc, 'pointermove', { clientX: 60, clientY: 60, pointerType: 'touch' });
      pointer(doc, 'pointerup', { clientX: 60, clientY: 60, pointerType: 'touch' });
      assert.match(free(), /3 free/);
      assert.strictEqual(doc.querySelector('.hws-ghost'), null);

      // mouse: small movement is still a click; a real drag shows a ghost and seats on release
      pointer(guest, 'pointerdown', { clientX: 5, clientY: 5 });
      pointer(doc, 'pointermove', { clientX: 7, clientY: 6 });
      assert.strictEqual(doc.querySelector('.hws-ghost'), null);
      pointer(doc, 'pointermove', { clientX: 80, clientY: 60 });
      assert.strictEqual(doc.querySelector('.hws-ghost').textContent, 'Tom H.');
      assert.ok(table(2).classList.contains('is-over'));
      pointer(doc, 'pointerup', { clientX: 80, clientY: 60 });
      assert.match(free(), /2 free/);
      assert.strictEqual(doc.querySelector('.hws-ghost'), null);
      assert.ok(doc.querySelector('.hws-guest[data-guest="Tom H."]').classList.contains('is-seated'));

      // Escape cancels a drag
      const priya = doc.querySelector('.hws-guest[data-guest="Priya S."]');
      pointer(priya, 'pointerdown', { clientX: 5, clientY: 5 });
      pointer(doc, 'pointermove', { clientX: 80, clientY: 60 });
      doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      pointer(doc, 'pointerup', { clientX: 80, clientY: 60 });
      assert.match(free(), /2 free/);
      assert.strictEqual(doc.querySelector('.hws-ghost'), null);
    `);
  });

  test('Reset puts the colour back as well', () => {
    scenario(String.raw`
      const { doc, pick, click } = mount();
      pick(doc.querySelectorAll('.hws-dot input[type="radio"]')[2]);
      click(doc.querySelector('.hws-reset'));
      assert.strictEqual(doc.querySelector('.hws__stage').style.getPropertyValue('--hp-accent'), '');
      assert.strictEqual(doc.querySelectorAll('.hws-dot input[type="radio"]')[0].checked, true);
    `);
  });

  test("clicks carry usage labels for the site's consent-respecting recorder", () => {
    scenario(String.raw`
      const { doc } = mount();
      const labelled = (selector, name) => {
        const el = doc.querySelector(selector);
        assert.ok(el, selector);
        assert.strictEqual(el.dataset.analyticsEvent, 'wedding_showcase_' + name, selector);
      };
      labelled('.hws-send', 'rsvp');
      labelled('.hws-autoseat', 'autoseat');
      labelled('.hws-reset', 'reset');
      labelled('.hws-finish a', 'cta');
      labelled('.hws-step[data-step="seat"]', 'step');
      labelled('.hws-view[data-view="seating"]', 'tab');
      labelled('circle.hws-table[role="button"]', 'seat');
    `);
  });

  test('the QR card travels with the phone so it always sits just under it', () => {
    scenario(String.raw`
      const { doc } = mount();
      const column = doc.querySelector('.hws__phonecol');
      assert.ok(column);
      assert.strictEqual(column.firstElementChild.className.includes('hws__phone'), true);
      assert.ok(column.querySelector('.hws__chip--qr'));
    `);
  });
});

describe('showcase colour helpers', () => {
  const helpers = require('../../public/assets/js/pages/home-wedding-showcase.js');
  const { PRESETS, deriveTheme, contrast } = helpers;

  test('there are five colours to try, all from the real builder apart from the homepage plum', () => {
    expect(PRESETS.map(preset => preset.name)).toEqual([
      'Plum',
      'Sage & Blush',
      'Champagne',
      'Midnight',
      'Terracotta',
    ]);
    expect(new Set(PRESETS.map(preset => preset.accent)).size).toBe(PRESETS.length);
    PRESETS.forEach(preset =>
      ['accent', 'secondary', 'background', 'text'].forEach(key =>
        expect(preset[key]).toMatch(/^#[0-9a-f]{6}$/i)
      )
    );
  });

  test('every colour is readable: buttons, text, muted text, accent text and hero text pass WCAG AA', () => {
    PRESETS.forEach(preset => {
      const { checks, minimum } = deriveTheme(preset);
      expect({ name: preset.name, readable: minimum >= 4.5, checks }).toMatchObject({
        name: preset.name,
        readable: true,
      });
    });
  });

  test('a light accent such as Champagne gets a dark button label instead of white', () => {
    const champagne = deriveTheme(PRESETS.find(preset => preset.key === 'champagne'));
    expect(champagne.vars.onAccent).not.toBe('#ffffff');
    expect(contrast(champagne.vars.onAccent, champagne.vars.accent)).toBeGreaterThanOrEqual(4.5);
  });

  test('any palette is made readable, even an awkward one', () => {
    // a pale accent, a mid-tone accent and a near-black accent on a light page
    [
      { accent: '#FFEE99', secondary: '#FFF8CC', background: '#FFFFFF', text: '#222222' },
      { accent: '#808080', secondary: '#C0C0C0', background: '#F5F5F5', text: '#111111' },
      { accent: '#111111', secondary: '#555555', background: '#FFFFFF', text: '#000000' },
    ].forEach(palette => expect(deriveTheme(palette).minimum).toBeGreaterThanOrEqual(4.5));
  });

  test('the default look in the stylesheet (what visitors without JavaScript see) is readable too', () => {
    const css = fs.readFileSync(
      path.join(PUBLIC_DIR, 'assets/css/home-wedding-showcase.css'),
      'utf8'
    );
    const block = css.slice(css.indexOf('.hws .hws__stage {'));
    const token = name => new RegExp(`--hp-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)[1];
    const [bg, text, muted, accent, onAccent, ink, soft, mid, heroInk] = [
      'bg',
      'text',
      'muted',
      'accent',
      'on-accent',
      'ink',
      'soft',
      'mid',
      'hero-ink',
    ].map(token);
    [
      [text, bg],
      [muted, bg],
      [ink, bg],
      [ink, soft],
      [onAccent, accent],
      [heroInk, mid],
    ].forEach(([a, b]) => expect(contrast(a, b)).toBeGreaterThanOrEqual(4.5));
  });
});
