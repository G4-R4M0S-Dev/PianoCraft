import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { LiveScoreModel, livePitch, liveDuration } from '../src/music/live-score.js';

test('live staff locates middle C, sharps and keyboard extremes on conventional clefs', () => {
  assert.deepEqual([livePitch(60).staff, livePitch(60).position, livePitch(60).label], ['treble', -2, 'Dó4']);
  assert.deepEqual([livePitch(59).staff, livePitch(59).position], ['bass', 9]);
  assert.equal(livePitch(61).alter, 1);
  assert.equal(livePitch(36).position, -4);
  assert.equal(livePitch(96).position, 19);
  assert.equal(livePitch(-1), null); assert.equal(livePitch(128), null);
});

test('notes remain after release, chords share an onset and repeated attacks are distinct', () => {
  const model = new LiveScoreModel({ bpm: 120 });
  model.noteOn({ key: 'physical:60', midi: 60, time: 1250 });
  model.noteOn({ key: 'physical:64', midi: 64, time: 1250.04 });
  assert.equal(model.groups.length, 1); assert.equal(model.groups[0].notes.length, 2);
  model.noteOff('physical:60', 1250.5); model.noteOff('physical:64', 1250.55);
  assert.equal(model.groups[0].notes[0].beats, 1);
  assert.equal(model.groups[0].notes[0].held, false);
  model.noteOn({ key: 'physical:60', midi: 60, time: 1250.6 });
  assert.equal(model.groups.length, 2);
  assert.ok(Math.abs(model.groups[1].time - .6) < 1e-8); // Audio timing itself is not quantized.
});

test('source identity, pedal and repeated key presses do not erase already written notes', () => {
  const model = new LiveScoreModel();
  model.noteOn({ key: 'pc:60', midi: 60, time: 0 });
  model.noteOn({ key: 'midi:60', midi: 60, time: .01 });
  assert.equal(model.groups.length, 2);
  model.setPedal(true, .1); model.noteOff('pc:60', .2);
  assert.equal(model.groups[0].notes[0].sustained, true); assert.equal(model.active.size, 1);
  model.setPedal(false, .3);
  assert.equal(model.groups[0].notes[0].sustained, false);
  model.releaseAll(.4); assert.equal(model.active.size, 0); assert.equal(model.getSong().notes.length, 2);
});

test('tempo changes preserve elapsed beats and duration labels use the actual key gate', () => {
  const model = new LiveScoreModel({ bpm: 120 });
  model.noteOn({ key: 'c', midi: 60, time: 10 });
  model.setTempo(60, 10.5); model.noteOff('c', 11.5);
  assert.equal(model.groups[0].notes[0].beats, 2);
  assert.equal(liveDuration(.12).type, '16th');
  assert.equal(liveDuration(.75).dotted, true);
  assert.equal(liveDuration(3).type, 'half');
  assert.equal(liveDuration(5).tied, true);
});

test('recorded overlapping tracks retain independent onset times, quantized durations and both staves', () => {
  const model = new LiveScoreModel();
  const song = { tempo: 120, timeSignatures: [{ numerator: 3, denominator: 4, time: 0 }], notes: [{ midi: 48, time: 0, duration: 3 }, { midi: 60, time: .5, duration: .5 }, { midi: 64, time: 1, duration: .25 }] };
  model.setSong(song);
  assert.deepEqual(model.groups.map(group => group.time), [0, .5, 1]);
  assert.equal(model.groups[0].notes[0].beats, 6);
  assert.equal(model.beatsPerBar, 3); assert.equal(model.active.size, 0);
  assert.equal(model.getSong().duration, 3);
  assert.equal(model.lastTime, 3);
});

test('live score memory remains bounded and never loses a currently held keyboard key', () => {
  const model = new LiveScoreModel({ maxGroups: 8, maxNotes: 16 });
  model.noteOn({ key: 'bass', midi: 36, time: 0 });
  for (let index = 1; index < 100; index++) { model.noteOn({ key: 'r', midi: 60 + index % 12, time: index }); model.noteOff('r', index + .5); }
  assert.equal(model.active.get('bass').midi, 36);
  assert.ok(model.groups.length <= 8); assert.ok(model.trimmed > 80);
  assert.equal(model.groups[0].notes[0].midi, 36);
  model.clear(); assert.equal(model.groups.length, 0); assert.equal(model.origin, null);
});

test('an overdub begins at zero with existing tracks and can insert notes before their later attacks', () => {
  const model = new LiveScoreModel();
  model.startRecording({ tempo: 120, notes: [{ midi: 48, time: 0, duration: 2 }, { midi: 52, time: 2, duration: 1 }] });
  model.noteOn({ key: 'new:c', midi: 60, time: .01 }); model.noteOff('new:c', .5);
  model.noteOn({ key: 'new:e', midi: 64, time: 1 }); model.noteOff('new:e', 1.5);
  assert.deepEqual(model.groups.map(group => group.time), [0, 1, 2]);
  assert.equal(model.groups[0].notes.length, 2);
  assert.equal(model.getSong().notes.find(note => note.midi === 64).time, 1);
});

let application, page;
before(async () => {
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ args: [fileURLToPath(new URL('./notation-harness.cjs', import.meta.url))], env: environment });
  page = await application.firstWindow();
  await page.evaluate(async ({ moduleUrl, cssUrl }) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = cssUrl; document.head.append(css);
    const { LiveScore } = await import(moduleUrl);
    window.LiveScore = LiveScore;
    document.querySelector('#score').style.height = 'auto';
    window.live = new LiveScore({ host: document.querySelector('#score'), getTime: () => window.liveNow || 0 });
  }, { moduleUrl: new URL('../src/music/live-score.js', import.meta.url).href, cssUrl: new URL('../src/live-score.css', import.meta.url).href });
});
after(async () => { await application?.close(); });

test('Electron live score keeps the viewport stable and engraves ledger lines, accidentals and released notes', async () => {
  const result = await page.evaluate(() => {
    live.clear(); const host = document.querySelector('#score'), before = host.getBoundingClientRect().height;
    live.noteOn({ key: 'low', midi: 36, time: 1 }); live.noteOn({ key: 'sharp', midi: 61, time: 1.02 }); live.noteOn({ key: 'high', midi: 96, time: 1.03 });
    const active = host.querySelectorAll('.live-score-note.is-active').length;
    live.noteOff('low', 2); live.noteOff('sharp', 2); live.noteOff('high', 2);
    return { before, after: host.getBoundingClientRect().height, active, retained: host.querySelectorAll('.live-score-note').length, released: host.querySelectorAll('.live-score-note.is-active').length, ledger: host.querySelectorAll('.live-ledger-line').length, sharp: host.querySelector('.live-accidental')?.textContent, labels: [...host.querySelectorAll('.live-score-note title')].map(element => element.textContent), views: host.querySelectorAll('svg').length };
  });
  assert.equal(result.after, result.before); assert.equal(result.active, 3); assert.equal(result.retained, 3); assert.equal(result.released, 0);
  assert.ok(result.ledger >= 8); assert.equal(result.sharp, '♯'); assert.equal(result.views, 1);
  assert.ok(result.labels.some(label => label.includes('Dó7')));
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/live-score-learning.png', import.meta.url)) });
});

test('unchanged chord SVG groups are retained and imported recordings accept a new live performance clock', async () => {
  const result = await page.evaluate(() => {
    live.clear(); live.noteOn({ key: 'c', midi: 60, time: 0 }); live.noteOff('c', .5);
    const first = document.querySelector('[data-live-group]');
    live.noteOn({ key: 'd', midi: 62, time: 1 });
    const stable = first === document.querySelector('[data-live-group]');
    window.liveNow = 1000;
    live.setSong({ tempo: 120, notes: [{ midi: 48, time: 0, duration: 1 }] });
    live.noteOn({ key: 'e', midi: 64, time: 1000.5 }); live.noteOff('e', 1001);
    return { stable, retained: document.querySelectorAll('.live-score-note').length, time: live.getSong().notes.at(-1).time, width: live.svg.width.baseVal.value };
  });
  assert.equal(result.stable, true); assert.equal(result.retained, 2); assert.equal(result.time, 1.5); assert.ok(result.width < 10000);
});

test('live notation zoom enlarges the ink inside its stable scroll viewport', async () => {
  const result = await page.evaluate(() => {
    live.setZoom(1); const before = live.svg.getBoundingClientRect().height, viewport = live.host.getBoundingClientRect().height;
    live.setZoom(1.5);
    return { before, after: live.svg.getBoundingClientRect().height, viewport, afterViewport: live.host.getBoundingClientRect().height, retained: live.host.querySelectorAll('.live-score-note').length };
  });
  assert.ok(result.after > result.before * 1.4); assert.equal(result.viewport, result.afterViewport); assert.equal(result.retained, 2);
});

test('the embedded clear action delegates once so an ongoing take can preserve its original clock', async () => {
  const result = await page.evaluate(() => {
    const host = document.createElement('div'); document.body.append(host); let calls = 0;
    const score = new LiveScore({ host, getTime: () => 10, onClear: () => { calls++; score.clear(); score.startRecording(null, { time: 10 }); } });
    score.startRecording(null, { time: 10 }); score.noteOn({ midi: 60, key: 'c', time: 10.25 }); score.noteOff('c', 10.5);
    host.querySelector('.live-score-clear').click(); score.noteOn({ midi: 64, key: 'e', time: 10.75 }); score.noteOff('e', 11);
    const result = { calls, notes: score.getSong().notes.length, time: score.getSong().notes[0].time };
    score.dispose(); host.remove(); return result;
  });
  assert.deepEqual(result, { calls: 1, notes: 1, time: .75 });
});
