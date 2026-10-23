import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeSong } from '../src/music/midi.js';
import { analyzePatterns } from '../src/music/patterns.js';

await mkdir('test-results', { recursive: true });
const song = normalizeSong({ id: 'qa-preparation-three-four', title: 'QA · preparação em três tempos',
  tempo: 120, duration: 3, tracks: [{ id: 0, name: 'Piano', channel: 0, program: 0 }],
  timeSignatures: [{ time: 0, numerator: 3, denominator: 4 }],
  notes: Array.from({ length: 6 }, (_, i) => ({ midi: [60, 62, 64][i % 3], time: i * .5, duration: .3, keyDuration: .3, velocity: .7, track: 0, channel: 0 })),
});
song.phrasing = { ...analyzePatterns(song, { phrases: [{ id: 'preparation-a', name: 'A', start: 0, end: 1.5 }, { id: 'preparation-b', name: 'A retorno', start: 1.5, end: 3 }] }), reviewed: true };
song.userPractice = { a: 0, b: 1.5, loop: true };
const fixture = new URL('../test-results/qa-preparation-project.json', import.meta.url);
await writeFile(fixture, JSON.stringify({ pianocraft: 1, songs: [song] }));
const env = { ...process.env, PIANOCRAFT_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2];
const app = await electron.launch(executablePath ? { executablePath, args: ['--smoke'], env } : { args: ['.', '--smoke'], env });
const result = { runtime: { executable: executablePath || 'source', clockInstalledBeforeLoad: true, hardwareIsolated: true }, cancellation: [] }, errors = [];
let page;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const saved = JSON.parse(localStorage.getItem('pc-settings') || '{}');
    localStorage.setItem('pc-settings', JSON.stringify({ ...saved, profile: 'QA Preparação', midiAutoConnect: true,
      midiInputId: 'qa-casio-in', midiOutputId: '', guideEnabled: true, guideProfile: 'casio-lks250', guideOutputId: 'qa-casio-out', practiceCountInBars: 1, practiceRestSeconds: 1 }));
    window.qaGuideMessages = [];
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async ({ sysex = false } = {}) => {
      const access = new EventTarget(); access.sysexEnabled = sysex;
      class Port extends EventTarget {
        constructor(id, type) { super(); Object.assign(this, { id, type, name: 'QA CASIO USB-MIDI', manufacturer: 'CASIO', state: 'connected', connection: 'closed' }); }
        async open() { this.connection = 'open'; return this; }
        async close() { this.connection = 'closed'; return this; }
        send(bytes) { window.qaGuideMessages.push({ bytes: [...bytes], at: performance.now() }); }
      }
      access.inputs = new Map([['qa-casio-in', new Port('qa-casio-in', 'input')]]);
      access.outputs = new Map([['qa-casio-out', new Port('qa-casio-out', 'output')]]);
      window.qaSendMidi = bytes => {
        const message = new Event('midimessage'); Object.assign(message, { data: new Uint8Array(bytes), receivedTime: performance.now() });
        access.inputs.get('qa-casio-in').dispatchEvent(message);
      };
      return access;
    } });
  });
  const epoch = new Date('2026-10-22T15:00:00Z');
  await page.clock.install({ time: epoch });
  await page.clock.pauseAt(new Date(+epoch + 1000));
  await page.reload(); await page.waitForSelector('.song-card');
  const storageUrl = new URL('storage.js', page.url()).href;
  const stored = key => page.evaluate(async ({ url, key }) => (await import(url)).getStored(key), { url: storageUrl, key });
  const history = async () => (await stored('practice-history')) ?? (await stored('history')) ?? await page.evaluate(() => JSON.parse(localStorage.getItem('pc-history') || '[]'));
  const click = selector => page.locator(selector).dispatchEvent('click');
  const waitFor = async (condition, label, limit = 250) => {
    for (let i = 0; i < limit; i++) { if (await condition()) return; await page.clock.runFor(16); }
    throw new Error(`QA preparation: ${label}`);
  };
  const now = () => page.evaluate(() => performance.now());
  const runTo = async target => { const remaining = target - await now(); if (remaining > 0) await page.clock.runFor(remaining); };
  const state = () => page.evaluate(() => ({ time: +document.querySelector('#timeline').value,
    currentTime: document.querySelector('#current-time').textContent, hits: +document.querySelector('#hits').textContent,
    errors: +document.querySelector('#errors').textContent, missed: +document.querySelector('#missed').textContent,
    phase: document.querySelector('#practice-countdown').dataset.phase, hidden: document.querySelector('#practice-countdown').hidden,
    play: document.querySelector('#play').textContent, pendingClicks: window.qaAudio?._clicks.size ?? 0,
  }));
  const guideNotes = () => page.evaluate(() => {
    const pitches = new Set();
    for (const { bytes } of qaGuideMessages) if (bytes.length === 10 && bytes[0] === 240 && bytes[5] === 2) { if (bytes[8]) pitches.add(bytes[7]); else pitches.delete(bytes[7]); }
    return [...pitches];
  });
  await waitFor(() => page.locator('#guide-status').textContent().then(text => text.includes('aberta')), 'fake guide output should open');
  await page.evaluate(async urls => {
    const { AudioEngine } = await import(urls.audio), { PracticeSession } = await import(urls.practice);
    window.qaClicks = []; window.qaStops = []; window.qaPracticeCalls = [];
    const click = AudioEngine.prototype.click, stop = AudioEngine.prototype.stopClicks, gate = PracticeSession.prototype.gate;
    AudioEngine.prototype.click = function(accent, when) {
      window.qaAudio = this; qaClicks.push({ accent, at: performance.now(), when, offset: when - this.context.currentTime });
      return click.call(this, accent, when);
    };
    AudioEngine.prototype.stopClicks = function() {
      const before = this._clicks.size, value = stop.call(this); qaStops.push({ at: performance.now(), before, after: this._clicks.size }); return value;
    };
    PracticeSession.prototype.gate = function(target) {
      window.qaPractice = this; qaPracticeCalls.push({ at: performance.now(), target }); return gate.call(this, target);
    };
  }, { audio: new URL('music/audio.js', page.url()).href, practice: new URL('music/practice.js', page.url()).href });
  await page.locator('#file-input').setInputFiles(fileURLToPath(fixture));
  await waitFor(() => page.locator(`.song-card[data-song="${song.id}"]`).count().then(count => count === 1), 'fixture should import');
  await click(`[data-song="${song.id}"] .open-song`);
  await page.locator('#mode').selectOption('rhythm');
  await page.locator('#speed').evaluate(input => { input.value = '50'; input.dispatchEvent(new Event('input')); });
  await page.evaluate(() => { qaClicks.length = 0; qaGuideMessages.length = 0; qaPracticeCalls.length = 0; });
  await click('#play');
  await waitFor(() => page.locator('#practice-countdown').isVisible(), 'initial count-in should be visible');
  const initial = await page.evaluate(() => qaClicks.slice());
  assert.equal(initial.length, 3);
  assert.deepEqual(initial.map(click => click.accent), [true, false, false]);
  assert.ok(Math.abs(initial[1].when - initial[0].when - 1) < .002);
  assert.ok(Math.abs(initial[2].when - initial[0].when - 2) < .002);
  const initialAt = initial[0].at;
  await page.evaluate(() => { qaSendMidi([0x90, 60, 100]); qaSendMidi([0x80, 60, 0]); });
  await runTo(initialAt + 2990);
  const frozen = await state();
  assert.equal(frozen.time, 0); assert.equal(frozen.hits, 0); assert.equal(frozen.errors, 0); assert.equal(frozen.missed, 0);
  assert.equal(frozen.phase, 'count'); assert.equal(frozen.hidden, false);
  assert.deepEqual(await guideNotes(), []);
  assert.equal((await history()).filter(row => row.songId === song.id).length, 0);
  assert.equal(await page.evaluate(() => qaPracticeCalls.length), 0);
  result.initialCountIn = { signature: '3/4', bpm: 120, speed: .5, duration: 3, clicks: initial.map(({ accent, when }) => ({ accent, offset: +(when - initial[0].when).toFixed(3) })), frozen };
  await runTo(initialAt + 3060);
  assert.ok((await state()).time > 0, 'the song must advance after the whole bar of preparation');
  await waitFor(() => page.locator('#practice-countdown').getAttribute('data-phase').then(value => value === 'rest'), 'the completed loop should enter the rest phase', 300);
  const rounds = await page.evaluate(() => qaClicks.slice());
  assert.equal(rounds.length, 6);
  const repeatAt = rounds[3].at;
  assert.ok(Math.abs(rounds[3].offset - 1) < .02, 'repeat click starts after the one-second rest');
  const firstAttempt = (await history()).find(row => row.songId === song.id && row.completed);
  assert.ok(firstAttempt, 'completed phrase attempt must be saved');
  assert.equal(firstAttempt.seconds, 3, 'three seconds of count-in must not enter practice time');
  await runTo(repeatAt + 950); assert.equal((await state()).phase, 'rest');
  await runTo(repeatAt + 1100); assert.equal((await state()).phase, 'count');
  await runTo(repeatAt + 3990); assert.equal((await state()).time, 0); assert.deepEqual(await guideNotes(), []);
  result.loopPreparation = { restSeconds: 1, countInSeconds: 3, savedPracticeSeconds: firstAttempt.seconds, phaseAt950ms: 'rest', phaseAt1100ms: 'count', frozenAt3990ms: true };

  // A canceled preparation must stop even the clicks already scheduled in Web Audio.
  await click('#play');
  let canceled = await state(); assert.equal(canceled.hidden, true); assert.equal(canceled.pendingClicks, 0); assert.equal(canceled.play, '▶');
  result.cancellation.push({ action: 'pause', ...canceled });
  await click('#play'); await waitFor(() => page.locator('#practice-countdown').isVisible(), 'count before seek');
  await click('#restart'); canceled = await state(); assert.equal(canceled.hidden, true); assert.equal(canceled.pendingClicks, 0);
  result.cancellation.push({ action: 'seek', ...canceled });
  await click('#play'); await click('#play'); await waitFor(() => page.locator('#practice-countdown').isVisible(), 'count before mode change');
  await page.locator('#mode').selectOption('melody'); canceled = await state(); assert.equal(canceled.hidden, true); assert.equal(canceled.pendingClicks, 0); assert.equal(canceled.play, '▶');
  result.cancellation.push({ action: 'mode-change', ...canceled });
  assert.equal(await page.evaluate(() => qaStops.at(-1).after), 0);
  assert.equal(await page.evaluate(() => qaStops.some(stop => stop.before > 0 && stop.after === 0)), true, 'cancellation must remove scheduled future Web Audio clicks');
  result.canceledScheduledClicks = await page.evaluate(() => Math.max(...qaStops.map(stop => stop.before)));

  await click('.study-open'); await click('.study-tab[data-tab="plan"]');
  const firstExercise = page.locator('.study-session').first().locator('.study-exercise').first();
  const listenId = await firstExercise.getAttribute('data-exercise-id');
  await firstExercise.locator('.study-start-exercise').dispatchEvent('click');
  await waitFor(() => page.locator('#study-exercise-title').textContent().then(text => text.includes('2/2')), 'listening exercise should start with two repetitions');
  await page.clock.runFor(9000);
  await waitFor(async () => Object.values(await stored('study-progress') || {}).some(progress => progress.songId === song.id && progress.finishedExercises?.includes(listenId)), 'finished exercise should persist');
  assert.equal((await state()).play, '▶');
  assert.match(await page.locator('#study-exercise-title').textContent(), /^✓ Prática concluída/);
  await click('.study-open'); await click('.study-tab[data-tab="plan"]');
  const practiced = page.locator(`.study-exercise[data-exercise-id="${listenId}"]`).first();
  assert.equal(await practiced.locator('.study-completion-tag[data-kind="practice"]').textContent(), '✓ Prática concluída');
  assert.ok(await page.locator('.study-session-tag').first().isVisible());
  const reviewExercise = page.locator('.study-session').first().locator('.study-exercise').nth(1), reviewId = await reviewExercise.getAttribute('data-exercise-id');
  await reviewExercise.locator('.study-check input').check();
  await waitFor(() => page.locator(`.study-exercise[data-exercise-id="${reviewId}"] .study-completion-tag[data-kind="review"]`).count().then(count => count > 0), 'manual review tag should appear');
  await click('.study-close'); await page.reload(); await page.waitForSelector('.song-card');
  await click(`[data-song="${song.id}"] .open-song`); await click('.study-open'); await click('.study-tab[data-tab="plan"]');
  assert.equal(await page.locator(`.study-exercise[data-exercise-id="${listenId}"] .study-completion-tag[data-kind="practice"]`).first().textContent(), '✓ Prática concluída');
  assert.equal(await page.locator(`.study-exercise[data-exercise-id="${reviewId}"] .study-completion-tag[data-kind="review"]`).first().textContent(), '✓ Revisão concluída');
  assert.equal(await page.locator(`.study-exercise[data-exercise-id="${reviewId}"] .study-check input`).first().isChecked(), true);
  result.exerciseTags = { listeningRepetitions: 2, finishedExercise: listenId, reviewExercise: reviewId, practiceTag: true, reviewTag: true, persistedAfterReload: true };
  await page.locator(`.study-exercise[data-exercise-id="${listenId}"] .study-completion-tag`).first().evaluate(element => element.scrollIntoView({ block: 'start' }));
  // All timing assertions are complete. Resume the clock so Chromium can paint
  // the newly scrolled dialog before capturing its persisted completion tags.
  await page.clock.resume();
  await page.screenshot({ path: 'test-results/preparation-completion-tags.png', animations: 'disabled' });
  assert.deepEqual(errors, []);
  await writeFile('test-results/preparation-validation.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: 'test-results/preparation-failure.png' }).catch(() => {});
    console.error(await page.evaluate(() => ({ play: document.querySelector('#play')?.textContent, count: document.querySelector('#practice-countdown')?.textContent, phase: document.querySelector('#practice-countdown')?.dataset.phase, toast: document.querySelector('#toast')?.textContent, clicks: window.qaClicks, stops: window.qaStops?.slice(-5), errors: document.querySelector('#errors')?.textContent })).catch(() => ({})));
  }
  throw error;
} finally { await app.close(); }
