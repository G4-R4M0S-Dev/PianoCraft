import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
const fixture = {
  title: 'QA · Acordes físicos e relógio real', tempo: 120, duration: 3,
  tracks: [{ id: 0, name: 'Piano', channel: 0, program: 0 }],
  notes: [
    ...[60, 64, 67].map((midi, id) => ({ id, midi, time: 0, keyDuration: 1, duration: 1, track: 0, channel: 0 })),
    ...[62, 65, 69].map((midi, id) => ({ id: id + 3, midi, time: 1, keyDuration: 1, duration: 1, track: 0, channel: 0 })),
  ],
};
const fixtureUrl = new URL('../test-results/qa-practice-timing.json', import.meta.url);
await writeFile(fixtureUrl, JSON.stringify(fixture));
const environment = { ...process.env, PIANOCRAFT_TEST: '1' }; delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.', '--smoke'], env: environment });
try {
  const page = await app.firstWindow(), errors = [], result = {};
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  const start = new Date('2026-10-22T12:00:00Z');
  await page.addInitScript(()=>{
    const saved=JSON.parse(localStorage.getItem('pc-settings')||'{}');
    localStorage.setItem('pc-settings',JSON.stringify({...saved,practiceCountInBars:0,practiceRestSeconds:0,midiAutoConnect:false,midiInputId:'',guideEnabled:false}));
  });
  // Timers must be installed before app.js creates its transport interval.
  await page.clock.install({ time: start });
  await page.reload();
  await page.waitForSelector('.song-card');
  // Capture the app instance through its normal connection button, then disable
  // real input bindings so a person or another QA process cannot alter scores.
  await page.evaluate(async url => {
    const { MidiDevices } = await import(url);
    const original = MidiDevices.prototype.connect;
    MidiDevices.prototype.connect = function(...args) {
      window.qaMidi = this;
      return original.apply(this, args);
    };
  }, new URL('../src/music/devices.js', import.meta.url).href);
  await page.locator('#instrument-retry').click();
  await page.evaluate(async () => {
    try { await window.qaMidi.connect(); } catch { /* no real MIDI required */ }
    await window.qaMidi.setInput(null);
  });
  // Keep event handling real, while advancing the browser's monotonic clock
  // explicitly: Playwright/IPC overhead must not change chord spread.
  await page.clock.pauseAt(new Date(start.getTime() + 1000));
  await page.locator('#file-input').setInputFiles(fileURLToPath(fixtureUrl));
  await page.locator('.song-card').filter({ hasText: fixture.title }).locator('.open-song').click();
  const down = key => page.keyboard.down(key);
  const up = key => page.keyboard.up(key);
  const run = milliseconds => page.clock.runFor(milliseconds);
  const score = () => page.evaluate(() => ({
    hits: Number(document.querySelector('#hits').textContent),
    errors: Number(document.querySelector('#errors').textContent),
    missed: Number(document.querySelector('#missed').textContent),
    waiting: document.querySelector('#waiting').textContent,
  }));
  const releasePC = async () => { for (const key of ['a', 'd', 'g', 'Shift']) await up(key); };
  const reset = async (mode = 'melody') => {
    await releasePC();
    await page.locator('#mode').selectOption(mode);
    await page.locator('#restart').click();
    await page.locator('#play').click();
    await run(16);
    assert.equal((await score()).hits, 0);
  };
  const playChord = async () => { await down('a'); await run(40); await down('d'); await run(40); await down('g'); };

  await reset();
  await down('a'); await run(500); await down('d'); await run(500); await down('g');
  result.pcSeparated500ms = await score();
  assert.equal(result.pcSeparated500ms.hits, 0);
  assert.ok(result.pcSeparated500ms.errors >= 2);
  assert.match(result.pcSeparated500ms.waiting, /C4/);

  await reset();
  await down('a'); await run(20); await up('a'); await run(20); await down('d'); await run(20); await down('g');
  result.pcReleasedBeforeCompletion = await score();
  assert.equal(result.pcReleasedBeforeCompletion.hits, 0);
  assert.equal(result.pcReleasedBeforeCompletion.errors, 1);

  await reset();
  await playChord();
  result.pcHeld80ms = await score();
  assert.equal(result.pcHeld80ms.hits, 3);
  assert.equal(result.pcHeld80ms.errors, 0);
  await run(20); await releasePC();
  result.earlyReleaseAfterAcceptedChord = await score();
  assert.equal(result.earlyReleaseAfterAcceptedChord.hits, 3);
  assert.equal(result.earlyReleaseAfterAcceptedChord.errors, 3);

  await reset();
  await down('a'); await run(500); await down('d'); await run(20); await down('g');
  assert.equal((await score()).hits, 0);
  await releasePC(); await run(20); await playChord();
  result.retryAfterTimeout = await score();
  assert.equal(result.retryAfterTimeout.hits, 3);

  await reset();
  await down('Shift'); await down('a'); await run(20); await up('a');
  await run(20); await down('d'); await run(20); await down('g');
  result.sustainDoesNotFakeHeldChord = await score();
  assert.equal(result.sustainDoesNotFakeHeldChord.hits, 0);
  assert.equal(result.sustainDoesNotFakeHeldChord.errors, 1);

  await reset();
  await down('a'); await page.locator('#play').click();
  await run(1000); await up('a');
  assert.equal((await score()).errors, 0, 'pausing cancels the incomplete attempt');
  await page.locator('#play').click(); await run(16);
  await down('d'); await run(20); await down('g');
  assert.equal((await score()).hits, 0, 'the C from before pause cannot complete the chord');
  await run(20); await down('a');
  result.pauseCleansInput = await score();
  assert.equal(result.pauseCleansInput.hits, 3);

  await reset();
  await down('a'); await page.locator('#timeline').fill('0'); await up('a');
  // A range input retains focus; put focus back on a button without toggling play.
  await page.locator('#sheet-toggle').focus();
  await down('d'); await run(20); await down('g');
  assert.equal((await score()).hits, 0);
  await run(20); await down('a');
  result.seekCleansInput = await score();
  assert.equal(result.seekCleansInput.hits, 3);
  assert.equal(result.seekCleansInput.errors, 0);

  // Only MIDI bytes are synthetic: decoding, source identities, timestamps,
  // app callbacks and scoring stay real. No hardware port receives test notes.
  assert.equal(await page.evaluate(() => !!window.qaMidi), true);
  const midi = (command, pitch, velocity = command === 0x90 ? 100 : 0, deviceId = 'qa-synthetic-device') => page.evaluate(({ command, pitch, velocity, deviceId }) => {
    window.qaMidi._receive(new Uint8Array([command, pitch, velocity]), deviceId, performance.now());
  }, { command, pitch, velocity, deviceId });
  const midiUp = async () => { for (const pitch of [60, 64, 67]) await midi(0x80, pitch); };

  await reset();
  await midi(0x90, 60); await run(500); await midi(0x90, 64); await run(500); await midi(0x90, 67);
  result.midiBytesSeparated500ms = await score();
  assert.equal(result.midiBytesSeparated500ms.hits, 0);
  await midiUp();

  await reset();
  await midi(0x90, 60); await run(40); await midi(0x90, 64); await run(40); await midi(0x90, 67);
  result.midiBytesHeld80ms = await score();
  assert.equal(result.midiBytesHeld80ms.hits, 3);
  assert.equal(result.midiBytesHeld80ms.errors, 0);
  await run(500); await midiUp();
  assert.equal((await score()).errors, 0);

  await reset();
  await page.evaluate(() => {
    const at = performance.now();
    for (const [pitch, offset] of [[60, -1000], [64, -500], [67, 0]]) window.qaMidi._receive(new Uint8Array([0x90, pitch, 100]), 'qa-synthetic-device', at + offset);
  });
  result.midiQueuedSeparated500ms = await score();
  assert.equal(result.midiQueuedSeparated500ms.hits, 0);
  await midiUp();

  await reset();
  await page.evaluate(() => {
    const at = performance.now();
    for (const [pitch, offset] of [[60, -1000], [64, -960], [67, -920]]) window.qaMidi._receive(new Uint8Array([0x90, pitch, 100]), 'qa-synthetic-device', at + offset);
  });
  result.midiQueuedHeld80ms = await score();
  assert.equal(result.midiQueuedHeld80ms.hits, 3);
  assert.equal(result.midiQueuedHeld80ms.errors, 0);
  // All physical note-offs happened 800 ms after their own attacks, even
  // though the renderer receives every message after its scheduler tick.
  await page.evaluate(() => {
    const at = performance.now();
    for (const [pitch, offset] of [[60, -200], [64, -160], [67, -120]]) window.qaMidi._receive(new Uint8Array([0x80, pitch, 0]), 'qa-synthetic-device', at + offset);
  });
  result.midiQueuedHoldDuration = await score();
  assert.equal(result.midiQueuedHoldDuration.errors, 0);

  await reset();
  await midi(0x90, 60);
  await midi(0x80, 60, 0, 'another-device');
  await run(40); await down('d'); await run(40); await down('g');
  result.mixedSourcesAndUnrelatedNoteOff = await score();
  assert.equal(result.mixedSourcesAndUnrelatedNoteOff.hits, 3);
  await run(500); await midiUp(); await releasePC(); await run(16);
  assert.equal((await score()).errors, 0);

  // MusicXML/JSON may provide acoustic duration without keyDuration. A quick
  // pedal tap must not excuse a long note after the physical key is released.
  const pedalFile=new URL('../test-results/qa-pedal-duration.json',import.meta.url);
  const pedalFixture={title:'QA · Duração pelo pedal',tempo:120,duration:3,tracks:[{id:0,name:'Piano',channel:0}],notes:[{id:0,midi:60,time:0,duration:2,track:0,channel:0}]};
  await writeFile(pedalFile,JSON.stringify(pedalFixture));
  await page.locator('#file-input').setInputFiles(fileURLToPath(pedalFile));
  await page.locator('[data-view="library"]').click();
  await page.locator('.song-card').filter({hasText:pedalFixture.title}).locator('.open-song').click();
  await reset();await down('Shift');await down('a');await run(50);await up('a');await run(50);await up('Shift');
  result.pcShortPedalDoesNotExcuseLongNote=await score();assert.equal(result.pcShortPedalDoesNotExcuseLongNote.errors,1);
  await reset();await down('Shift');await down('a');await run(50);await up('a');await run(1200);await up('Shift');
  result.pcSufficientPedalDuration=await score();assert.equal(result.pcSufficientPedalDuration.errors,0);
  await reset();await midi(0xb0,64,127);await midi(0x90,60);await run(50);await midi(0x80,60);await run(50);await midi(0xb0,64,0);
  result.midiShortPedalDoesNotExcuseLongNote=await score();assert.equal(result.midiShortPedalDoesNotExcuseLongNote.errors,1);

  await page.screenshot({ path: 'test-results/qa-practice-timing.png' });
  result.testType = 'Electron UI; PC key events and synthetic MIDI bytes through real MidiDevices decoder; no physical hardware claim';
  result.pageErrors = errors;
  assert.deepEqual(errors, []);
  await writeFile(new URL('../test-results/qa-practice-timing-result.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await app.close(); }
