import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('test-results', { recursive: true });
const result = { startedAt: new Date().toISOString(), clock: 'real', checks: [], pageErrors: [], observations: {} };
const environment = { ...process.env, PIANOCRAFT_TEST: '1' };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.', '--smoke'], env: environment });
let page;
async function check(name, callback, required = true) {
  try { const details = await callback(); result.checks.push({ name, pass: true, ...(details ? { details } : {}) }); console.log(`ok ${name}`); return true; }
  catch (error) { result.checks.push({ name, pass: false, error: error.stack || error.message }); if (required) throw error; return false; }
}
const noteData = song => song.notes.map(({ id, ...note }) => note);
const trackData = (song, id) => ({ track: song.tracks.find(track => track.id === id), notes: noteData(song).filter(note => note.track === id), events: song.events.filter(event => event.track === id) });
async function stored(key) { return page.evaluate(async key => { const { getStored } = await import(new URL('./storage.js', location.href)); return getStored(key); }, key); }
async function waitDraft(count, pitch) {
  await page.waitForFunction(async ({ count, pitch }) => {
    const { getStored } = await import(new URL('./storage.js', location.href));
    const song = await getStored('recording-draft');
    return song?.tracks.length === count && (pitch === undefined || song.notes.some(note => note.midi === pitch));
  }, { count, pitch });
  return stored('recording-draft');
}
async function observeAudio(phase) {
  await page.evaluate(async phase => {
    window.__qaRecordingPhase = phase;
    window.__qaRecordingAudio ||= [];
    const { AudioEngine } = await import(new URL('./music/audio.js', location.href));
    if (!AudioEngine.prototype.__qaRecordingObserved) {
      const original = AudioEngine.prototype.noteOn;
      AudioEngine.prototype.noteOn = function (midi, velocity, channel, program) {
        window.__qaRecordingAudio.push({ phase: window.__qaRecordingPhase, at: performance.now(), midi, velocity, channel, program });
        return original.apply(this, arguments);
      };
      AudioEngine.prototype.__qaRecordingObserved = true;
    }
  }, phase);
}
async function beginTake(program) {
  await page.locator('#free-instrument').selectOption(String(program));
  await page.locator('#song-title').click();
  await page.locator('#record').click();
  await page.waitForSelector('#record.recording');
}
async function endTake() {
  await page.locator('#record').click();
  await page.waitForFunction(() => !document.querySelector('#record').classList.contains('recording'));
}
async function keyNote(key, milliseconds = 160) {
  await page.keyboard.down(key); await page.waitForTimeout(milliseconds); await page.keyboard.up(key);
}
async function openSettings() { await page.locator('#settings-button').click(); await page.waitForSelector('#settings[open]'); }
async function closeSettings() { await page.locator('#settings button[value="close"]').click(); }
async function setRangeInput(id, value) { await page.locator(id).fill(String(value)); await page.locator(id).press('Tab'); }

try {
  page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => result.pageErrors.push(error.message));
  await page.waitForSelector('.song-card');
  result.observations.hiddenWindow = await app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isVisible());
  result.observations.documentVisibility = await page.evaluate(() => document.visibilityState);
  assert.equal(result.observations.hiddenWindow, true);
  await page.locator('[data-view="free"]').click();
  await page.waitForSelector('#free-tools:not(.hidden)');
  await observeAudio('take-1');
  let first, second, third, revised, finalDraft;

  await check('first_take_ui', async () => {
    await beginTake(0); await page.waitForTimeout(100); await keyNote('a'); await endTake();
    first = await waitDraft(1, 60);
    assert.equal(first.notes.length, 1);
    assert.equal(first.tracks[0].program, 0);
    assert.equal(first.notes[0].channel, first.tracks[0].channel);
    return { tracks: first.tracks, notes: first.notes };
  });
  await check('overdub_separate_channels_and_observed_instruments', async () => {
    await observeAudio('take-2');
    await beginTake(40); await page.waitForTimeout(120); await keyNote('d');
    // Playwright/UI scrolling may delay the first take's first note. Wait for
    // its actual timestamp rather than assuming it happened at the take start.
    await page.waitForFunction(() => window.__qaRecordingAudio.some(call => call.phase === 'take-2' && call.midi === 60 && call.program === 0), undefined, { polling: 50 });
    await endTake();
    second = await waitDraft(2, 64);
    assert.deepEqual(trackData(second, 0), trackData(first, 0));
    assert.equal(second.tracks[1].program, 40);
    assert.notEqual(second.tracks[0].channel, second.tracks[1].channel);
    const calls = await page.evaluate(() => window.__qaRecordingAudio.filter(call => call.phase === 'take-2'));
    result.observations.overdubNoteOn = calls;
    assert.ok(calls.some(call => call.midi === 60 && call.channel === second.tracks[0].channel && call.program === 0), 'Primeira tomada deve soar como acompanhamento no canal/timbre original.');
    assert.ok(calls.some(call => call.midi === 64 && call.channel === second.tracks[1].channel && call.program === 40), 'Nota ao vivo deve usar canal/timbre da segunda tomada.');
    return { tracks: second.tracks, observedCalls: calls.length };
  });
  await check('sustain_active_take_draft_survives_reload', async () => {
    await observeAudio('take-3');
    await beginTake(8);
    await page.keyboard.down('Shift');
    await page.waitForTimeout(100); await keyNote('g', 120);
    // Cross the automatic two-second checkpoint while sustain remains down.
    await page.waitForTimeout(2200);
    const checkpoint = await waitDraft(3, 67);
    const held = checkpoint.notes.find(note => note.track === 2);
    assert.ok(held.duration > held.keyDuration + 0.5);
    assert.ok(checkpoint.events.some(event => event.track === 2 && event.type === 'cc' && event.controller === 64 && event.value === 0));
    await page.reload();
    await page.waitForSelector('.song-card');
    await page.keyboard.up('Shift');
    await page.locator('[data-view="free"]').click();
    await page.waitForFunction(() => document.querySelector('#record-info').textContent.startsWith('3/6'));
    third = await waitDraft(3, 67);
    assert.deepEqual(trackData(third, 0), trackData(second, 0));
    assert.deepEqual(trackData(third, 1), trackData(second, 1));
    const sustained = third.notes.find(note => note.track === 2);
    assert.ok(sustained.duration > sustained.keyDuration + 0.5);
    assert.equal(await page.locator('#record.recording').count(), 0);
    assert.ok(await page.locator('#save-recording').isEnabled());
    return { checkpointDuration: held.duration, restoredDuration: sustained.duration, keyDuration: sustained.keyDuration, restoredTracks: third.tracks.length };
  });
  await check('rerecord_one_track_preserves_other_takes', async () => {
    await page.locator('#record-track').selectOption('0');
    await beginTake(10); await page.waitForTimeout(100); await keyNote('k', 140); await endTake();
    revised = await waitDraft(3, 72);
    assert.deepEqual(trackData(revised, 1), trackData(third, 1));
    assert.deepEqual(trackData(revised, 2), trackData(third, 2));
    assert.deepEqual(revised.notes.filter(note => note.track === 0).map(note => note.midi), [72]);
    assert.equal(revised.tracks.find(track => track.id === 0).program, 10);
    return { trackIds: revised.tracks.map(track => track.id), replacedPitch: 72 };
  });
  await check('delete_one_track_preserves_others', async () => {
    await page.locator('[data-delete-take="1"]').click();
    finalDraft = await waitDraft(2, 72);
    assert.deepEqual(trackData(finalDraft, 0), trackData(revised, 0));
    assert.deepEqual(trackData(finalDraft, 2), trackData(revised, 2));
    assert.ok(!finalDraft.notes.some(note => note.track === 1));
    return { trackIds: finalDraft.tracks.map(track => track.id) };
  });
  await check('save_recording_into_library', async () => {
    await page.locator('#save-recording').click();
    await page.waitForFunction(async id => { const { getStored } = await import(new URL('./storage.js', location.href)); return (await getStored('songs'))?.some(song => song.id === id); }, finalDraft.id);
    const library = await stored('songs');
    const saved = library.find(song => song.id === finalDraft.id);
    assert.deepEqual(noteData(saved), noteData(finalDraft));
    assert.deepEqual(saved.events, finalDraft.events);
    await page.locator('[data-view="library"]').click();
    assert.equal(await page.locator('.song-card').count(), 4);
    return { libraryCount: library.length, savedId: saved.id };
  });
  await check('custom_computer_key_Q_maps_to_C4', async () => {
    await openSettings();
    await page.locator('#settings details summary').click();
    await page.locator('#shortcut-notes input[data-offset="0"]').press('q');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('pc-settings')).keyMap.KeyQ === 0);
    await closeSettings();
    await page.locator('[data-view="free"]').click();
    await observeAudio('custom-q');
    await page.locator('#song-title').click();
    await page.keyboard.down('q');
    await page.waitForSelector('.piano-key[data-midi="60"].down');
    await page.waitForTimeout(50); await page.keyboard.up('q');
    const calls = await page.evaluate(() => window.__qaRecordingAudio.filter(call => call.phase === 'custom-q'));
    assert.ok(calls.some(call => call.midi === 60));
    const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('pc-settings')));
    assert.equal(settings.keyMap.KeyQ, 0);
    assert.equal(settings.keyMap.KeyA, undefined);
    return { remapped: 'KeyQ → MIDI 60', observedCalls: calls };
  });
  await check('automatic_visible_range_fits_saved_song', async () => {
    await page.locator('[data-view="library"]').click();
    await page.locator(`[data-song="${finalDraft.id}"] .open-song`).click();
    await openSettings(); await page.locator('#key-range').selectOption('auto'); await closeSettings();
    const pitches = await page.locator('.piano-key').evaluateAll(keys => keys.map(key => Number(key.dataset.midi)));
    const low = Math.min(...finalDraft.notes.map(note => note.midi)), high = Math.max(...finalDraft.notes.map(note => note.midi));
    assert.ok(pitches[0] <= low && pitches.at(-1) >= high);
    assert.ok(pitches.length <= high - low + 25);
    return { first: pitches[0], last: pitches.at(-1), count: pitches.length };
  });
  await check('custom_visible_range_C4_to_C5', async () => {
    await openSettings(); await page.locator('#key-range').selectOption('custom');
    await setRangeInput('#range-min', 60); await setRangeInput('#range-max', 72); await closeSettings();
    const pitches = await page.locator('.piano-key').evaluateAll(keys => keys.map(key => Number(key.dataset.midi)));
    assert.deepEqual(pitches, Array.from({ length: 13 }, (_, index) => 60 + index));
    return { first: pitches[0], last: pitches.at(-1), count: pitches.length };
  });
  await check('custom_visible_range_accepts_MIDI_zero', async () => {
    await openSettings(); await setRangeInput('#range-min', 0); await setRangeInput('#range-max', 12); await closeSettings();
    const pitches = await page.locator('.piano-key').evaluateAll(keys => keys.map(key => Number(key.dataset.midi)));
    result.observations.zeroRange = pitches;
    assert.deepEqual(pitches, Array.from({ length: 13 }, (_, index) => index));
    return { first: pitches[0], last: pitches.at(-1), count: pitches.length };
  }, false);
  await check('no_renderer_errors', () => assert.deepEqual(result.pageErrors, []));
} catch (error) { result.fatal = error.stack || error.message; }
finally {
  result.finishedAt = new Date().toISOString();
  result.pass = !result.fatal && result.checks.every(check => check.pass) && result.pageErrors.length === 0;
  await writeFile('test-results/qa-recording-result.json', JSON.stringify(result, null, 2));
  await app.close();
}
console.log(`${result.pass ? 'PASS' : 'FAIL'}: ${result.checks.filter(check => check.pass).length}/${result.checks.length} UI recording/settings checks. See test-results/qa-recording-result.json.`);
if (!result.pass) process.exitCode = 1;
