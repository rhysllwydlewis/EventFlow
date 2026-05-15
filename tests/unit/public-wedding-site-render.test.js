'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

function runNodeSmoke(source) {
  return execFileSync(process.execPath, ['-e', source], {
    cwd: path.join(__dirname, '../..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('public wedding website renderer', () => {
  test('renders polished guest content, blocks unsafe URLs, and validates RSVP flow', () => {
    const output = runNodeSmoke(String.raw`
      const { JSDOM } = require('jsdom');
      const fs = require('fs');
      const script = fs.readFileSync('public/assets/js/pages/public-wedding-site.js', 'utf8');
      const calls = [];
      const dom = new JSDOM('<!doctype html><main id="public-wedding-root" class="wed-loading">Loading wedding website…</main>', {
        url: 'https://event-flow.test/wedding/our-wedding',
        runScripts: 'dangerously',
        pretendToBeVisual: true,
      });
      dom.window.HTMLFormElement.prototype.reportValidity = () => true;
      dom.window.fetch = async (url, options = {}) => {
        calls.push([String(url), options]);
        if (String(url).includes('/rsvp')) {
          return { ok: true, json: async () => ({ message: 'RSVP received.' }) };
        }
        return {
          ok: true,
          json: async () => ({
            website: {
              coupleNames: 'Jamie & Taylor',
              eventDate: '2027-08-22',
              ceremonyVenueName: 'Rosewood Hall',
              ceremonyVenueAddress: 'York',
              coverImageUrl: 'data:image/png;base64,aGVybw==',
              rsvpDeadline: '2027-08-01',
              arrivalTime: '12:30',
              ceremonyTime: '13:00',
              welcomeMessage: 'We cannot wait to celebrate with you.',
              accommodationRecommendations: [{ name: 'The Minster Hotel', websiteUrl: 'https://example.com/hotel' }],
              localInfo: [{ title: 'Unsafe link', url: 'javascript:alert(1)' }],
              weddingParty: [{ name: 'Morgan Lee', imageUrl: 'javascript:alert(2)' }],
              rsvpIntroText: 'Please reply soon.',
              mealOptions: ['Vegetarian'],
              customRsvpQuestions: [{ label: 'Which song will get you dancing?', required: true }],
            },
          }),
        };
      };
      dom.window.eval(script);
      const waitFor = (assertion, timeoutMs = 1000) => new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          try { resolve(assertion()); }
          catch (error) {
            if (Date.now() - started > timeoutMs) reject(error);
            else setTimeout(tick, 10);
          }
        };
        tick();
      });
      (async () => {
        const { document, Event } = dom.window;
        await waitFor(() => {
          if (document.querySelector('.wed-hero h1')?.textContent !== 'Jamie & Taylor') throw new Error('hero not rendered');
        });
        if (document.title !== 'Jamie & Taylor — Wedding Website') throw new Error('title not updated');
        if (document.getElementById('public-wedding-root').classList.contains('wed-loading')) throw new Error('loading class not removed');
        if (!document.querySelector('.wed-nav a[href="#schedule"]')) throw new Error('navigation missing');
        if (!document.querySelector('.wed-nav a[href="#wedding-party"]')) throw new Error('wedding party navigation missing');
        if (!document.querySelector('.wed-countdown')) throw new Error('countdown missing');
        if (!document.querySelector('.wed-hero--image')) throw new Error('uploaded cover image missing');
        if (!document.querySelector('.wed-quick-facts')) throw new Error('quick facts missing');
        if ([...document.querySelectorAll('a')].some(a => a.href.startsWith('javascript:'))) throw new Error('unsafe link rendered');
        if (document.querySelector('.wed-party img')) throw new Error('unsafe image rendered');
        document.querySelector('[name="guestName"]').value = 'Alex Guest';
        document.querySelector('[name="email"]').value = 'alex@example.com';
        document.querySelector('[name="partySize"]').value = '1';
        document.querySelector('[name="childrenCount"]').value = '2';
        document.querySelector('[name="cq_0"]').value = 'September';
        document.querySelector('#rsvp-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        if (!document.querySelector('#rsvp-msg').textContent.includes('Children count')) throw new Error('children validation missing');
        if (calls.length !== 1) throw new Error('invalid RSVP was posted');
        document.querySelector('[name="childrenCount"]').value = '0';
        document.querySelector('#rsvp-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await waitFor(() => {
          if (document.querySelector('#rsvp-msg').textContent !== 'RSVP received.') throw new Error('RSVP not submitted');
        });
        const payload = JSON.parse(calls[1][1].body);
        if (payload.guestName !== 'Alex Guest') throw new Error('guest name missing from payload');
        if (payload.customAnswers[0].value !== 'September') throw new Error('custom answer missing from payload');
        console.log('public wedding site smoke passed');
      })().catch(error => { console.error(error); process.exit(1); });
    `);

    expect(output).toContain('public wedding site smoke passed');
  });
});
