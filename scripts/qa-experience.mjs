import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

await mkdir('test-results', { recursive: true });
const chord = { id: 'qa-experience-chord', title: 'QA · Acordes e estabilidade', tempo: 120, duration: 5,
  tracks: [{ id: 0, channel: 0, name: 'Piano', program: 0 }], notes: [
    ...[60, 64, 67].map((midi, id) => ({ id, midi, time: 0, duration: 1, keyDuration: 1, track: 0, channel: 0 })),
    { id: 3, midi: 62, time: 2, duration: 1, keyDuration: 1, track: 0, channel: 0 },
  ] };
const delayed = { id: 'qa-experience-delayed', title: 'QA · Luz somente no ataque', tempo: 120, duration: 4,
  tracks: [{ id: 0, channel: 0, name: 'Piano', program: 0 }], notes: [
    { id: 0, midi: 72, time: 1, duration: 1, keyDuration: 1, track: 0, channel: 0 },
    { id: 1, midi: 74, time: 3, duration: .8, keyDuration: .8, track: 0, channel: 0 },
  ] };
const fixture = new URL('../test-results/qa-experience-project.json', import.meta.url);
await writeFile(fixture, JSON.stringify({ pianocraft: 1, songs: [chord, delayed] }));
const env = { ...process.env, PIANOCRAFT_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2];
const app = await electron.launch(executablePath ? { executablePath, args: ['--smoke'], env } : { args: ['.', '--smoke'], env });
const result = { layouts: [], guideTiming: [] }, errors = [];
let page;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.song-card');
  await page.addInitScript(() => {
    localStorage.setItem('pc-settings', JSON.stringify({practiceCountInBars:0,practiceRestSeconds:0, guideEnabled: true, guideProfile: 'casio-lks250', guideOutputId: 'casio-out', midiInputId: 'casio-in', chordWindowMs: 120, lookahead: 4 }));
    window.qaGuideMessages = [];
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async ({ sysex = false } = {}) => {
      const access = new EventTarget(); access.sysexEnabled = sysex;
      class Port extends EventTarget {
        constructor(id, type) { super(); Object.assign(this, { id, type, name: 'CASIO USB-MIDI', manufacturer: 'CASIO', state: 'connected', connection: 'closed' }); }
        async open() { this.connection = 'open'; return this; }
        async close() { this.connection = 'closed'; return this; }
        send(bytes) {
          if (this.connection !== 'open') throw new Error('Closed output');
          if (bytes[0] === 240 && !sysex) throw new Error('SysEx denied');
          window.qaGuideMessages.push({ bytes: [...bytes], at: performance.now() });
        }
      }
      access.inputs = new Map([['casio-in', new Port('casio-in', 'input')]]);
      access.outputs = new Map([['casio-out', new Port('casio-out', 'output')]]);
      window.qaMidiAccess = access;
      window.qaSendMidi = (bytes, receivedTime = performance.now()) => {
        const message = new Event('midimessage'); Object.assign(message, { data: new Uint8Array(bytes), receivedTime });
        access.inputs.get('casio-in').dispatchEvent(message);
      };
      return access;
    } });
  });
  // Install before navigation so the transport's setInterval is mocked too.
  // Installing after app startup leaves its existing native interval running
  // against a mocked performance clock, which makes onset assertions race.
  await page.clock.install();
  await page.reload(); await page.waitForSelector('.song-card');
  await page.waitForFunction(() => document.querySelector('#guide-status')?.textContent.includes('aberta'));
  await page.locator('#file-input').setInputFiles(fileURLToPath(fixture));
  await page.waitForSelector(`[data-song="${chord.id}"]`);

  const openSong = async song => {
    if (await page.locator('body').evaluate(body => body.classList.contains('practice-focus'))) await page.keyboard.press('Escape');
    await page.locator('[data-view="library"]').click();
    await page.locator(`[data-song="${song.id}"] .open-song`).click();
    await page.clock.runFor(32);
  };
  const dispatch = async (midi, on = true, channel = 0) => page.evaluate(({ midi, on, channel }) => qaSendMidi([(on ? 0x90 : 0x80) | channel, midi, on ? 100 : 0]), { midi, on, channel });
  const geometry = () => page.evaluate(() => Object.fromEntries(['#keyboard', '#roll', '.transport', '#score-strip', '#practice-feedback', '#instrument-panel'].map(selector => {
    const box = document.querySelector(selector).getBoundingClientRect();
    return [selector, Object.fromEntries(['x', 'y', 'width', 'height'].map(name => [name, Math.round(box[name] * 100) / 100]))];
  })));
  const stable = (before, after, label) => {
    for (const [selector, box] of Object.entries(before)) for (const key of Object.keys(box)) assert.ok(Math.abs(box[key] - after[selector][key]) <= .5, `${label}: ${selector}.${key} moved ${box[key]} -> ${after[selector][key]}`);
  };
  const litHeads = () => page.evaluate(() => [...document.querySelectorAll('#notation [data-pc-played]')].map(element => ({ midi: +element.dataset.pcMidi, beat: +element.dataset.pcSourceBeat })).sort((a, b) => a.midi - b.midi));
  const guideNotes = () => page.evaluate(() => {
    const active = new Set();
    for (const { bytes } of qaGuideMessages) if (bytes.length === 10 && bytes[0] === 240 && bytes[5] === 2) { if (bytes[8]) active.add(bytes[7]); else active.delete(bytes[7]); }
    return [...active].sort((a, b) => a - b);
  });

  if (!process.env.QA_EXPERIENCE_GUIDE_ONLY) {
  for (const viewport of [{ width: 1440, height: 960 }, { width: 1000, height: 720 }]) {
    await page.setViewportSize(viewport);
    await openSong(chord);
    await page.locator('#mode').selectOption('melody');
    assert.equal(await page.locator('#sheet').isVisible(),true);
    await page.waitForSelector('#notation svg');
    await page.locator('#play').click(); await page.clock.runFor(32);
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    const idle = await geometry();
    await page.keyboard.down('a');
    assert.equal(await page.locator('#practice-feedback').getAttribute('data-state'), 'pending');
    stable(idle, await geometry(), `${viewport.width} pending`);
    assert.deepEqual(await litHeads(), [{ midi: 60, beat: 0 }]);
    await dispatch(64); await dispatch(67);
    assert.equal(await page.locator('#practice-feedback').getAttribute('data-state'), 'accepted');
    assert.equal(await page.locator('#hits').textContent(), '3');
    assert.deepEqual((await litHeads()).map(note => note.midi), [60, 64, 67]);
    stable(idle, await geometry(), `${viewport.width} accepted`);
    await page.keyboard.down('s');
    assert.equal(await page.locator('#practice-feedback').getAttribute('data-state'), 'rejected');
    stable(idle, await geometry(), `${viewport.width} rejected`);
    assert.equal((await litHeads()).some(note => note.midi === 62), false);
    await page.evaluate(() => {
      const activity = document.querySelector('#midi-activity');
      activity.textContent = 'C#-1 · pressionada · canal 16 · 123456789 eventos · monitor de entrada do teclado físico com uma mensagem extensa';
      document.querySelector('#waiting').textContent = 'Toque: C#4 + D#4 + F#4 + G#4 + A#4 + C#5 + D#5 + F#5';
    });
    stable(idle, await geometry(), `${viewport.width} long MIDI/status`);
    await page.keyboard.up('a'); await page.keyboard.up('s'); await dispatch(64, false); await dispatch(67, false);
    await page.clock.runFor(400);
    await page.locator('#play').click();
    assert.deepEqual(await litHeads(), []);

    const normal = await page.evaluate(() => { const n = document.querySelector('#notation').getBoundingClientRect(); return { width: n.width, height: n.height }; });
    await page.locator('#focus-mode').click(); await page.clock.runFor(32);
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('practice-focus')), true);
    assert.equal(await page.locator('.sidebar').isVisible(), false);
    const focused = await page.evaluate(() => {
      const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      return { sheet: box('#notation'), keyboard: box('#keyboard'), transport: box('.transport'), viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth };
    });
    assert.ok(focused.sheet.width > normal.width, JSON.stringify({ viewport, normal, focused }));
    assert.ok(focused.sheet.height >= normal.height, JSON.stringify({ viewport, normal, focused }));
    assert.ok(focused.keyboard.bottom <= viewport.height + 1 && focused.keyboard.y >= 0, JSON.stringify(focused));
    assert.ok(focused.transport.bottom <= viewport.height + 1, JSON.stringify(focused));
    assert.ok(focused.documentWidth <= viewport.width + 1, JSON.stringify(focused));
    await page.screenshot({ path: `test-results/qa-focus-${viewport.width}.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('practice-focus')), false);
    assert.equal(await page.locator('.sidebar').isVisible(), true);
    result.layouts.push({ viewport, stablePendingAcceptedRejectedAndLongText: true, individualPCAndMidiNoteheads: true, focus: focused });
  }

  await page.locator('[data-view="free"]').click(); await page.clock.runFor(32);
  await page.locator('#focus-mode').click(); await page.clock.runFor(32);
  assert.equal(await page.locator('.sidebar').isVisible(), false);
  const freeKeyboard = await page.locator('#keyboard').boundingBox();
  assert.ok(freeKeyboard.y >= 0 && freeKeyboard.y + freeKeyboard.height <= 721, JSON.stringify(freeKeyboard));
  await page.evaluate(() => document.activeElement?.blur());
  assert.equal(await page.locator('#record').evaluate(element => element.classList.contains('recording')), false);
  await page.keyboard.down('a'); await page.clock.runFor(300);
  assert.ok(Number(await page.locator('#roll').getAttribute('data-live-notes')) > 0);
  await page.keyboard.up('a'); await dispatch(64); await page.clock.runFor(250); await dispatch(64, false);
  await page.clock.runFor(32);
  assert.ok(Number(await page.locator('#roll').getAttribute('data-live-notes')) >= 2);
  assert.equal(await page.locator('#record').evaluate(element => element.classList.contains('recording')), false);
  await page.screenshot({ path: 'test-results/qa-free-live-trail.png' });
  await page.clock.runFor(5000);
  assert.equal(await page.locator('#roll').getAttribute('data-live-notes'), '0');
  result.freeTrailPCAndMidiWithoutRecordingAndExpires = true;
  }

  // Freeze autonomous passage between browser round-trips. The following
  // onset assertions must not cross a timer boundary while reading the DOM.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);
  for (const mode of ['listen', 'melody', 'rhythm']) for (const percent of [100, 50]) {
    await openSong(delayed);
    await page.locator('#mode').selectOption(mode);
    await page.locator('#speed').fill(String(percent));
    const started = await page.evaluate(() => ({ at: performance.now(), messages: qaGuideMessages.length }));
    await page.locator('#play').click();
    await page.waitForFunction(() => document.querySelector('#play').textContent === 'Ⅱ');
    const realOnset = 1000 * 100 / percent;
    await page.clock.runFor(realOnset - 64);
    assert.deepEqual(await guideNotes(), [], `Lights anticipated ${mode} ${percent}%`);
    // The timer phase and asynchronous audio initialization can leave the
    // transport a few frames behind the requested clock interval. Observe the
    // actual musical position instead of assuming the click started its clock.
    let ticks = 0;
    while (Number(await page.locator('#timeline').inputValue()) < 250 && ticks++ < 30) {
      assert.deepEqual(await guideNotes(), [], `Lights anticipated musical onset ${mode} ${percent}% ${JSON.stringify(await page.evaluate(() => ({ timeline: document.querySelector('#timeline').value, duration: document.querySelector('#duration').textContent, at: performance.now(), last: qaGuideMessages.slice(-3) })))}`);
      await page.clock.runFor(16);
    }
    await page.clock.runFor(16);
    const lightState = await guideNotes();
    assert.deepEqual(lightState, [72], `Lights missing at onset ${mode} ${percent}% ${JSON.stringify(await page.evaluate(() => ({ timeline: document.querySelector('#timeline').value, state: document.querySelector('#play-state').textContent, speed: document.querySelector('#speed').value, last: qaGuideMessages.slice(-3) })))}`);
    const firstLightAt = await page.evaluate(start => qaGuideMessages.slice(start).find(({ bytes }) => bytes.length === 10 && bytes[5] === 2 && bytes[7] === 72 && bytes[8] > 0)?.at, started.messages);
    assert.ok(firstLightAt - started.at >= realOnset - 1, `Actual output preceded onset: ${mode} ${percent}% ${firstLightAt - started.at}ms`);
    await page.locator('#play').click();
    assert.deepEqual(await guideNotes(), []);
    result.guideTiming.push({ mode, speed: percent, noLightBeforeOnset: true, litAtOnset: true, outputOnAtMs: firstLightAt - started.at, pauseClears: true });
  }
  result.pageErrors = errors; assert.deepEqual(errors, []);
  await writeFile('test-results/qa-experience.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('QA experience failed:', error);
  throw error;
} finally {
  await page?.clock.resume().catch(() => {});
  await app.close();
}
