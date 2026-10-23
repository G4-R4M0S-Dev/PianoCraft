import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('test-results', { recursive: true });
const env = { ...process.env, PIANOCRAFT_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2];
const app = await electron.launch(executablePath ? { executablePath, args: ['--smoke'], env } : { args: ['.', '--smoke'], env });
const result = {}, errors = [], findings = []; let page;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.song-card');
  await page.addInitScript(() => {
    localStorage.setItem('pc-settings', JSON.stringify({ midiInputId: 'qa-casio-in', monitorInput: true, freeBpm: 120, freeNumerator: 3, freeDenominator: 4 }));
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async ({ sysex = false } = {}) => {
      const access = new EventTarget(); access.sysexEnabled = sysex;
      class Port extends EventTarget {
        constructor(id, type) { super(); Object.assign(this, { id, type, name: 'CASIO USB-MIDI', manufacturer: 'CASIO', state: 'connected', connection: 'closed' }); }
        async open() { this.connection = 'open'; return this; }
        async close() { this.connection = 'closed'; return this; }
        send() {}
      }
      access.inputs = new Map([['qa-casio-in', new Port('qa-casio-in', 'input')]]); access.outputs = new Map();
      window.qaMidiAttacks = [];
      window.qaSendMidi = bytes => { const receivedTime = performance.now(); if ((bytes[0] & 0xf0) === 0x90 && bytes[2]) qaMidiAttacks.push({ midi: bytes[1], receivedTime }); const message = new Event('midimessage'); Object.assign(message, { data: new Uint8Array(bytes), receivedTime }); access.inputs.get('qa-casio-in').dispatchEvent(message); };
      return access;
    } });
  });
  await page.reload(); await page.waitForSelector('.song-card');
  await page.waitForFunction(() => document.querySelector('#instrument-panel')?.dataset.state === 'open');
  const heads = () => page.locator('#live-notation .live-score-note').count();
  const pitches = () => page.locator('#live-notation .live-score-note').evaluateAll(elements => elements.map(element => Number(element.dataset.midi)).sort((a, b) => a - b));
  const midi = (pitch, on = true) => page.evaluate(({ pitch, on }) => qaSendMidi([on ? 0x90 : 0x80, pitch, on ? 96 : 0]), { pitch, on });
  const keyboardBox = () => page.locator('#keyboard').evaluate(element => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; });
  const readDraft = () => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('PianoCraft', 1);
    request.onsuccess = () => { const db = request.result, read = db.transaction('library').objectStore('library').get('recording-draft'); read.onsuccess = () => { resolve(read.result); db.close(); }; read.onerror = () => { reject(read.error); db.close(); }; };
    request.onerror = () => reject(request.error);
  }));
  const waitRecording = state => page.waitForFunction(state => document.querySelector('#record').classList.contains('recording') === state, state, { polling: 20 });
  const blur = () => page.evaluate(() => document.activeElement?.blur());

  await page.locator('.song-card .open-song').first().click(); await page.locator('[data-hub-action="onManual"]').click(); await page.locator('#close-practice-tools').click(); await page.waitForSelector('#notation svg');
  assert.equal(await page.locator('#sheet').isVisible(), true);
  assert.equal(await page.locator('.pc-reading-position').isVisible(), true);
  result.studioScoreVisibleByDefault = true;
  await page.locator('[data-view="free"]').click(); await page.waitForSelector('#live-notation svg');
  assert.equal(await page.locator('#sheet').isVisible(), true); assert.equal(await page.locator('#live-notation').isVisible(), true);
  result.freeScoreVisibleByDefault = true;
  await blur(); const boxBefore = await keyboardBox();
  await page.keyboard.down('a'); await page.waitForTimeout(240); await page.keyboard.up('a');
  await midi(64); await page.waitForTimeout(240); await midi(64, false);
  await page.locator('.piano-key[data-midi="67"]').click();
  assert.deepEqual(await pitches(), [60, 64, 67]);
  assert.equal(await page.locator('#live-notation .live-score-note.is-active').count(), 0);
  assert.deepEqual(await keyboardBox(), boxBefore);
  result.pcMidiAndMouseNotesRetainedAfterRelease = true;
  result.noteEventsKeepKeyboardLayoutStable = true;

  const zoomBefore = await page.locator('#live-notation svg').evaluate(element => element.getBoundingClientRect().height);
  await page.locator('#sheet-zoom-in').click();
  const zoomAfter = await page.locator('#live-notation svg').evaluate(element => element.getBoundingClientRect().height);
  assert.ok(zoomAfter > zoomBefore, `Free score zoom: ${zoomBefore} -> ${zoomAfter}`);
  await page.locator('#sheet-zoom-out').click();
  result.freeScoreZoom = { before: zoomBefore, after: zoomAfter };
  await page.locator('#clear-live-score').click(); assert.equal(await heads(), 0);

  await page.locator('#free-meter').selectOption('3/4'); await page.locator('#drum-bpm').fill('120'); await page.locator('#drum-bpm').dispatchEvent('change');
  await page.evaluate(async () => {
    window.qaBeats = []; window.qaClicks = [];
    new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) { const text = node.textContent; if (/^[123]\/3$/.test(text)) qaBeats.push({ text, time: performance.now() }); } }).observe(document.querySelector('#free-beat'), { childList: true });
    const { AudioEngine } = await import(new URL('./music/audio.js', location.href).href), original = AudioEngine.prototype.click;
    AudioEngine.prototype.click = function(accent, when) { qaClicks.push({ accent: !!accent, when, now: this.context?.currentTime }); return original.call(this, accent, when); };
    const { Recorder } = await import(new URL('./music/recorder.js', location.href).href), originalStart = Recorder.prototype.start;
    window.qaTakeStarts = [];
    Recorder.prototype.start = function(options) { const at = performance.now(), take = originalStart.call(this, options); qaTakeStarts.push({ at, ...take }); return take; };
  });
  await page.locator('#free-metronome').click();
  await page.waitForFunction(() => document.querySelector('#free-metronome').getAttribute('aria-pressed') === 'true');
  await page.waitForFunction(() => qaBeats.length >= 5);
  const beats = await page.evaluate(() => qaBeats.slice(0, 5));
  const clicks = await page.evaluate(() => qaClicks.slice(0, 5));
  result.freeMetronome = { bpm: 120, meter: '3/4', beats, clicks };
  try {
    assert.deepEqual(beats.map(beat => beat.text), ['1/3', '2/3', '3/3', '1/3', '2/3']);
    assert.deepEqual(clicks.map(click => click.accent), [true, false, false, true, false]);
    for (let index = 1; index < clicks.length; index++) assert.ok(Math.abs(clicks[index].when - clicks[index - 1].when - .5) < 1e-5, JSON.stringify(clicks));
    result.freeMetronome.passed = true;
  } catch (error) { result.freeMetronome.passed = false; findings.push(`Metrônomo: ${error.message}`); }

  await page.locator('#record').click(); await waitRecording(true);
  assert.equal(await page.locator('#drum-bpm').isDisabled(), true);
  assert.equal(await page.locator('#free-meter').isDisabled(), true);
  await blur(); await page.keyboard.down('a'); await page.waitForTimeout(260); await page.keyboard.up('a');
  await page.waitForTimeout(100); await page.keyboard.down('s'); await page.waitForTimeout(260); await page.keyboard.up('s');
  await page.locator('#record').click(); await waitRecording(false);
  await page.waitForFunction(() => document.querySelector('#record-info').textContent.includes('1/6 pistas'));
  assert.deepEqual(await pitches(), [60, 62]);
  let draft = await readDraft(); assert.equal(draft.tracks.length, 1); assert.equal(draft.notes.length, 2);
  result.firstRecordedTrackRetainedInScore = true;

  await page.locator('#record').click(); await waitRecording(true);
  await midi(67); await page.waitForTimeout(250); await midi(67, false);
  await blur(); await page.keyboard.down('k'); await page.waitForTimeout(250); await page.keyboard.up('k');
  await page.locator('#record').click(); await waitRecording(false);
  await page.waitForFunction(() => document.querySelector('#record-info').textContent.includes('2/6 pistas'));
  draft = await readDraft(); assert.equal(draft.tracks.length, 2); assert.equal(draft.notes.length, 4);
  assert.deepEqual(await pitches(), [60, 62, 67, 72]);
  const laterTrack = Math.max(...draft.tracks.map(track => track.id));
  const expectedAttack = await page.evaluate(() => (qaMidiAttacks.findLast(attack => attack.midi === 67).receivedTime - qaTakeStarts.at(-1).at) / 1000);
  const firstNewAttack = draft.notes.find(note => note.track === laterTrack).time;
  assert.ok(Math.abs(firstNewAttack - expectedAttack) < .04, JSON.stringify({ firstNewAttack, expectedAttack, notes: draft.notes }));
  result.overdub = { tracks: draft.tracks.length, notes: draft.notes.length, firstNewAttack, expectedFromTakeStart: expectedAttack, usesTakeOriginWithoutAppendingAfterEarlierTracks: true };
  await page.screenshot({ path: 'test-results/qa-free-learning-recorded.png' });

  await page.locator('#save-recording').click(); await page.waitForSelector('#notation svg');
  assert.equal(await page.locator('#notation').isVisible(), true);
  assert.equal(await page.locator('#notation [data-pc-midi]').count(), 4);
  assert.equal(await page.locator('#free-metronome').getAttribute('aria-pressed'), 'false');
  result.savedRecordingHasFullConventionalScore = true;
  await page.locator('[data-view="free"]').click(); assert.deepEqual(await pitches(), [60, 62, 67, 72]);
  await page.locator('[data-delete-take="0"]').click();
  assert.deepEqual(await pitches(), [67, 72]);
  result.deletingTrackRemovesOnlyItsWrittenNotes = true;
  await page.locator('#new-recording').click(); assert.equal(await heads(), 0);
  await page.waitForFunction(() => document.querySelector('#record-info').textContent.includes('0/6 pistas'));
  draft = await readDraft(); assert.equal(draft.notes.length, 0); assert.equal(draft.tracks.length, 0);
  result.newRecordingClearsLiveScoreAndDraft = true;
  await page.setViewportSize({ width: 1000, height: 720 }); await page.locator('#focus-mode').click();
  const focused = await page.evaluate(() => {
    const box = selector => { const { x, y, width, height, bottom, right } = document.querySelector(selector).getBoundingClientRect(); return { x, y, width, height, bottom, right }; };
    return { keyboard: box('#keyboard'), sheet: box('#live-notation'), viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth };
  });
  assert.ok(focused.keyboard.bottom <= 721 && focused.keyboard.y >= 0, JSON.stringify(focused));
  assert.ok(focused.sheet.height >= 100 && focused.sheet.width > 900, JSON.stringify(focused));
  assert.ok(focused.documentWidth <= 1001, JSON.stringify(focused));
  result.focusedFreeScoreFitsSmallScreen = focused;
  await page.screenshot({ path: 'test-results/qa-free-learning-focus.png' }); await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator('#theme-toggle').click();
  await page.screenshot({ path: 'test-results/qa-free-learning-light.png' });
  result.pageErrors = errors; result.findings = findings; assert.deepEqual(errors, []);
  await writeFile('test-results/qa-free-learning.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(findings, []);
} catch (error) {
  console.error('QA free learning failed:', error);
  await writeFile('test-results/qa-free-learning-failure.json', JSON.stringify({ result, errors, findings, failure: error.stack }, null, 2));
  if (page) await page.screenshot({ path: 'test-results/qa-free-learning-failure.png', animations: 'disabled', timeout: 5000 }).catch(() => {});
  throw error;
} finally { await app.close(); }
