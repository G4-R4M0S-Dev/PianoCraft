import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = new URL('../', import.meta.url);
const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
const harness = new URL('soundfont-harness.html', output);
await writeFile(harness, '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'wasm-unsafe-eval\'; connect-src \'none\'; object-src \'none\'"><title>Offline SoundFont test</title>');
const bytes = Array.from(await readFile(new URL('../assets/soundfonts/PianoCraft-Basic.sf2', import.meta.url)));
const app = await electron.launch({ args: [resolve(fileURLToPath(root)), '--smoke'], env: { ...process.env, PIANOCRAFT_TEST: '1' } });
try {
  await app.firstWindow();
  const newPage = app.waitForEvent('window');
  await app.evaluate(async ({ BrowserWindow }, path) => {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' } });
    await window.loadFile(path);
  }, fileURLToPath(harness));
  const page = await newPage;
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const result = await page.evaluate(async fileBytes => {
    const { SoundFontEngine } = await import('../src/music/soundfont.js');
    const buffer = new Uint8Array(fileBytes).buffer;
    const engine = new SoundFontEngine();
    await engine.init(buffer);
    const presetNames = engine.presets.map(preset => preset.name);
    const analyser = engine.context.createAnalyser();
    analyser.fftSize = 2048;
    engine._gain.connect(analyser);
    engine.noteOn(60, 0.9);
    await new Promise(resolve => setTimeout(resolve, 180));
    const waveform = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(waveform);
    const rms = Math.sqrt(waveform.reduce((sum, value) => sum + value * value, 0) / waveform.length);
    engine.setSustain(true);
    engine.noteOff(60);
    await new Promise(resolve => setTimeout(resolve, 420));
    const voicesWithPedal = engine._synth.voiceCount;
    engine.setSustain(false);
    await new Promise(resolve => setTimeout(resolve, 700));
    const voicesAfterPedal = engine._synth.voiceCount;
    engine.noteOn(64, 0.8);
    await new Promise(resolve => setTimeout(resolve, 50));
    engine.allNotesOff();
    await new Promise(resolve => setTimeout(resolve, 80));
    const voicesAfterPanic = engine._synth.voiceCount;
    engine.setVolume(0);
    const originalBufferPreserved = buffer.byteLength > 0;
    const context = engine.context;
    await engine.dispose();
    const closed = context.state;

    // A shared context can load another bank after disposal without registering twice.
    const shared = new AudioContext();
    for (let index = 0; index < 2; index++) {
      const next = new SoundFontEngine({ context: shared });
      await next.init(buffer);
      await next.dispose();
    }
    const sharedStillRunning = shared.state === 'running';
    await shared.close();

    const invalid = new Uint8Array(12);
    invalid.set([82, 73, 70, 70, 4, 0, 0, 0, 115, 102, 98, 107]);
    let rejectedInvalid = false;
    const badEngine = new SoundFontEngine();
    try { await badEngine.init(invalid.buffer); } catch { rejectedInvalid = true; }
    await badEngine.dispose();
    return { rms, presetNames, voicesWithPedal, voicesAfterPedal, voicesAfterPanic, originalBufferPreserved, closed, sharedStillRunning, rejectedInvalid, protocol: location.protocol };
  }, bytes);
  assert.equal(result.protocol, 'file:');
  assert.ok(result.rms > 0.001, `Expected real audio samples; RMS=${result.rms}`);
  assert.ok(result.presetNames.includes('PianoCraft Basic'));
  assert.ok(result.voicesWithPedal > 0);
  assert.equal(result.voicesAfterPedal, 0);
  assert.equal(result.voicesAfterPanic, 0);
  assert.equal(result.originalBufferPreserved, true);
  assert.equal(result.closed, 'closed');
  assert.equal(result.sharedStillRunning, true);
  assert.equal(result.rejectedInvalid, true);
  assert.deepEqual(pageErrors, []);
  await writeFile(new URL('soundfont-result.json', output), JSON.stringify(result, null, 2));
  console.log('PASS: offline file:// SoundFont loaded and generated measurable audio in Electron; sustain, panic, cleanup, shared-context reload and malformed-bank rejection validated.');
  console.log(JSON.stringify(result));
} finally { await app.close(); }
