/**
 * The location pages admin editor, driven through a real DOM.
 *
 * The scenarios run in a plain Node process (jsdom cannot be loaded through
 * Jest's transform here) and report their outcomes as JSON; this suite asserts
 * on them. What is under test is the behaviour an editor depends on: the record
 * loads into the form, rows can be added, reordered and removed, the save sends
 * only editorial fields, and unsaved work is never thrown away silently.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const { LIMITS } = require('../../models/LocationContent');

const root = path.join(__dirname, '../..');

const results = JSON.parse(
  execFileSync(
    process.execPath,
    [path.join(root, 'tests/helpers/admin-locations-editor-scenarios.js')],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
);

/**
 * The value a scenario produced, failing loudly if the scenario itself threw.
 * @param {string} name Scenario name.
 * @returns {Object} Scenario value.
 */
function outcome(name) {
  const result = results[name];
  if (!result) {
    throw new Error(`No such scenario: ${name}`);
  }
  if (!result.ok) {
    throw new Error(`Scenario "${name}" threw: ${result.error}\n${result.stack}`);
  }
  return result.value;
}

describe('the city list', () => {
  it('offers an Edit action alongside the existing workflow controls', () => {
    const value = outcome('listsCitiesWithAnEditAction');
    expect(value.hasCard).toBe(true);
    expect(value.hasEdit).toBe(true);
    expect(value.workflowActions).toEqual(
      expect.arrayContaining(['edit', 'pilot', 'publish', 'index', 'review', 'draft-preview'])
    );
  });

  it('opens the admin preview without promoting the page', () => {
    expect(outcome('opensTheDraftPreviewFromTheCard').opened).toEqual([
      '/api/v1/admin/locations/cardiff/preview',
    ]);
  });
});

describe('loading a record into the editor', () => {
  it('loads the full record from the per-city endpoint', () => {
    expect(outcome('fillsEveryFieldFromTheRecord').loadedFrom).toContain(
      '/api/v1/admin/locations/cardiff'
    );
  });

  it('fills every field from the record', () => {
    const value = outcome('fillsEveryFieldFromTheRecord');
    expect(value.title).toBe('Cardiff suppliers');
    expect(value.description).toBe('What to know.');
    expect(value.intro).toBe('An existing introduction.');
    expect(value.sections).toBe(2);
    expect(value.faqs).toBe(1);
  });

  it('takes its field limits from the API', () => {
    const value = outcome('fillsEveryFieldFromTheRecord');
    expect(value.introMaxLength).toBe(String(LIMITS.introMaxLength));
    expect(value.sectionBodyMaxLength).toBe(String(LIMITS.sectionBodyMaxLength));
  });

  it('shows the gate blockers and the editorial warnings', () => {
    const gate = outcome('showsGateAndWarnings').gate;
    expect(gate).toContain('page is not published');
    expect(gate).toContain('No local introduction has been written');
  });

  it('says plainly that a pilot page is public but noindex', () => {
    expect(outcome('explainsPilotState').state).toMatch(/publicly visible[\s\S]*noindex/);
  });

  it('counts characters against the limit and flags an overrun', () => {
    const value = outcome('countsCharactersAgainstTheLimit');
    expect(value.before).toBe('17 / 70');
    expect(value.after).toBe('80 / 70');
    expect(value.over).toBe(true);
  });

  it('searches Pexels for the open city and keeps its attribution', () => {
    const value = outcome('choosesACitySpecificPexelsPhoto');
    expect(value.query).toBe('Cardiff Wales city skyline landmark');
    expect(value.imageUrl).toContain('/photos/5743996/');
    expect(value.alt).toBe('Cardiff Bay waterfront');
    expect(value.credit).toBe('Balazs Bezeczky');
    expect(value.sourceUrl).toBe('https://www.pexels.com/photo/cardiff-bay-5743996/');
    expect(value.previewHidden).toBe(false);
    expect(value.dirty).toBe('Unsaved changes');
  });

  it('defaults a new city to the automatic hero source', () => {
    const value = outcome('defaultsToAutomaticHeroSource');
    expect(value.auto).toBe(true);
    expect(value.custom).toBe(false);
    expect(value.note).toMatch(/curated or automatically resolved/);
  });

  it('loads a city already switched to a custom hero source', () => {
    const value = outcome('loadsAStoredCustomHeroSource');
    expect(value.auto).toBe(false);
    expect(value.custom).toBe(true);
  });

  it('switches a city to the custom hero source when a Pexels photo is chosen', () => {
    const value = outcome('choosingAPexelsPhotoSwitchesToCustom');
    expect(value.before).toBe(false);
    expect(value.after).toBe(true);
  });

  it('saves the selected hero source alongside the image', () => {
    expect(outcome('savesTheChosenHeroSource').heroSource).toBe('custom');
  });

  it('warns, but does not block, saving custom mode with no image set', () => {
    const value = outcome('warnsWhenCustomIsSelectedWithNoImage');
    expect(value.question).toMatch(/automatic photo will show instead/);
    expect(value.patched).toBe(true);
  });

  it('clears Pexels attribution if an editor replaces the image URL manually', () => {
    const value = outcome('clearsStaleAttributionWhenTheHeroUrlChanges');
    expect(value.credit).toBe('');
    expect(value.sourceUrl).toBe('');
    expect(value.previewCredit).toBe('Hero image preview');
  });
});

describe('repeatable rows', () => {
  it('adds a planning section', () => {
    expect(outcome('addsASection').sections).toBe(3);
  });

  it('refuses to add more sections than the API keeps', () => {
    const value = outcome('refusesToExceedTheSectionLimit');
    expect(value.sections).toBe(LIMITS.maxSections);
    expect(value.error).toMatch(/Only \d+ planning sections/);
  });

  it('moves a section up', () => {
    expect(outcome('movesASectionUp').titles).toEqual(['Second', 'First']);
  });

  it('moves a section down', () => {
    expect(outcome('movesASectionDown').titles).toEqual(['Second', 'First']);
  });

  it('disables the move controls at the ends of the list', () => {
    const value = outcome('disablesMoveControlsAtTheEnds');
    expect(value.firstUpDisabled).toBe(true);
    expect(value.lastDownDisabled).toBe(true);
  });

  it('removes a section', () => {
    expect(outcome('removesASection').titles).toEqual(['Second']);
  });

  it('adds a question without disturbing the sections', () => {
    const value = outcome('addsAFaqWithoutTouchingSections');
    expect(value.faqs).toBe(2);
    expect(value.sections).toBe(2);
  });
});

describe('saving', () => {
  it('PATCHes the city with a CSRF token', () => {
    const value = outcome('savesOnlyEditorialFields');
    expect(value.url).toBe('/api/v1/admin/locations/cardiff');
    expect(value.csrf).toBe('csrf-token');
  });

  it('sends nothing but seo and content, so the workflow cannot move', () => {
    expect(outcome('savesOnlyEditorialFields').keys).toEqual(['content', 'seo']);
  });

  it('sends the rows in the order the editor arranged them', () => {
    const value = outcome('savesOnlyEditorialFields');
    expect(value.intro).toBe('A rewritten introduction.');
    expect(value.order).toEqual(['Second', 'First']);
  });

  it('sends a planning section with its full source triple', () => {
    expect(outcome('savesTheFullSourceTriple').section).toEqual({
      title: 'First',
      body: 'a',
      sourceName: 'Cardiff Council',
      sourceUrl: 'https://cardiff.gov.uk',
      sourceDate: 'March 2026',
    });
  });

  it('sends the hero image and its alt text', () => {
    const content = outcome('savesHeroFields').content;
    expect(content.heroImageUrl).toBe('https://cdn.example.com/cardiff.jpg');
    expect(content.heroImageAlt).toBe('Cardiff Bay at dusk');
  });

  it('blocks a hero image with no alt text', () => {
    const value = outcome('blocksHeroWithoutAltText');
    expect(value.patched).toBe(false);
    expect(value.error).toMatch(/hero image needs alt text/);
  });

  it('blocks a source URL that is not a web address', () => {
    const value = outcome('blocksANonWebSourceUrl');
    expect(value.patched).toBe(false);
    expect(value.error).toMatch(/source URL/);
  });

  it('warns before saving a row the API would silently discard', () => {
    const value = outcome('warnsBeforeSavingADiscardedRow');
    expect(value.question).toMatch(/will be discarded/);
    expect(value.patched).toBe(false);
    expect(value.nativeDialogs).toEqual([]);
  });

  it('saves once that warning is accepted', () => {
    expect(outcome('savesTheDiscardedRowWarningWhenConfirmed').patched).toBe(true);
  });

  it('surfaces a server error rather than pretending the save worked', () => {
    expect(outcome('surfacesAServerError').error).toMatch(
      /Save failed: Failed to update location page/
    );
  });
});

describe('unsaved changes', () => {
  it('asks before closing with unsaved work, and stays open on a refusal', () => {
    const value = outcome('asksBeforeDiscardingUnsavedWork');
    expect(value.question).toMatch(/Discard your unsaved changes/);
    expect(value.stillOpen).toBe(true);
  });

  it('asks in the page rather than through a native browser dialog', () => {
    expect(outcome('asksBeforeDiscardingUnsavedWork').nativeDialogs).toEqual([]);
    expect(outcome('refusesToPreviewUnsavedWork').nativeDialogs).toEqual([]);
  });

  it('closes once the discard is confirmed', () => {
    expect(outcome('closesOnceTheDiscardIsConfirmed').stillOpen).toBe(false);
  });

  it('closes without asking when nothing has changed', () => {
    const value = outcome('closesWithoutAskingWhenClean');
    expect(value.question).toBeNull();
    expect(value.stillOpen).toBe(false);
  });

  it('flags unsaved work in the footer', () => {
    const value = outcome('flagsUnsavedWork');
    expect(value.before).toBe('');
    expect(value.after).toBe('Unsaved changes');
  });

  it('refuses to preview unsaved work the preview would not show', () => {
    const value = outcome('refusesToPreviewUnsavedWork');
    expect(value.error).toMatch(/Save your changes first/);
    expect(value.opened).toEqual([]);
  });
});
