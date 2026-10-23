import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeSong } from '../src/music/midi.js';

const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
const fixture = normalizeSong({
  id: 'qa-phrase-practice', title: 'QA · 44 compassos · 11 frases', tempo: 120, duration: 88,
  tracks: [{ id: 0, name: 'Melodia', channel: 0, program: 0 }, { id: 1, name: 'Acompanhamento', channel: 1, program: 0 }],
  timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
  markers: Array.from({ length: 11 }, (_, i) => ({ time: i * 8, text: `Seção ${String(i + 1).padStart(2, '0')}` })),
  notes: Array.from({ length: 44 }, (_, bar) => [
    { midi: [60, 62, 64, 65][bar % 4], time: bar * 2, duration: .35, keyDuration: .35, velocity: .8, track: 0, channel: 0 },
    { midi: 36 + Math.floor(bar / 4), time: bar * 2, duration: .35, keyDuration: .35, velocity: .7, track: 1, channel: 1 },
  ]).flat(),
});
const fixtureUrl = new URL('qa-phrase-practice.json', output);
await writeFile(fixtureUrl, JSON.stringify(fixture));
const env = { ...process.env, PIANOCRAFT_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2];
const app = await electron.launch(executablePath ? { executablePath, args: ['--smoke'], env } : { args: ['.', '--smoke'], env });
try {
  const page = await app.firstWindow(), result = {}, errors = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  // Install before a fresh document creates any transport timers. This suite
  // exercises PC-key input; physical playing in another app must not affect it.
  await page.addInitScript(() => {
    const saved = JSON.parse(localStorage.getItem('pc-settings') || '{}');
    localStorage.setItem('pc-settings', JSON.stringify({ ...saved, midiAutoConnect: false, midiInputId: '', midiOutputId: '', guideEnabled: false }));
  });
  await page.clock.install();
  await page.reload();
  await page.waitForSelector('.song-card');
  result.runtime = { executable: executablePath || 'source', page: page.url(), clockInstalledBeforeLoad: true, hardwareIsolated: true };
  const storageUrl = new URL('./storage.js', page.url()).href;
  let importedId = null;
  const storedSongs = () => page.evaluate(async url => (await import(url)).getStored('songs'), storageUrl);
  const storedSong = async () => (await storedSongs()).find(song => importedId ? song.id === importedId : song.title === fixture.title);
  const storedHistory = () => page.evaluate(() => JSON.parse(localStorage.getItem('pc-history') || '[]'));
  const waitStored = async condition => {
    for (let i = 0; i < 100; i++) { const song = await storedSong(); if (condition(song)) return song; await page.clock.runFor(20); }
    throw new Error('A alteração não foi persistida no projeto.');
  };
  const state = () => page.evaluate(() => ({
    time: document.querySelector('#timeline').value,
    currentTime: document.querySelector('#current-time').textContent,
    mode: document.querySelector('#mode').value,
    loop: document.querySelector('#loop').getAttribute('aria-pressed'),
    range: document.querySelector('#loop-range').textContent,
    phrase: document.querySelector('.phrase-choice').value,
  }));
  const pause = async () => { if (await page.locator('#play').textContent() === 'Ⅱ') await page.locator('#play').click(); };
  const resetAudioCapture = () => page.evaluate(() => qaNotes.length = 0);
  const capturedAudio = () => page.evaluate(() => qaNotes.map(n => ({ midi: n.midi, channel: n.channel })));
  const choosePhrase = async id => {
    await page.locator('.phrase-choice').selectOption(id);
    await page.clock.runFor(50);
    await page.waitForFunction(() => document.querySelector('#play').textContent === 'Ⅱ');
  };
  await page.evaluate(async urls => {
    const { AudioEngine } = await import(urls.audio), { PracticeSession } = await import(urls.practice);
    window.qaNotes = [];
    const on = AudioEngine.prototype.noteOn;
    AudioEngine.prototype.noteOn = function(midi, velocity, channel, program) {
      qaNotes.push({ midi, velocity, channel, at: performance.now() });
      return on.call(this, midi, velocity, channel, program);
    };
    const gate = PracticeSession.prototype.gate;
    PracticeSession.prototype.gate = function(target) { window.qaPractice = this; return gate.call(this, target); };
  }, { audio: new URL('./music/audio.js', page.url()).href, practice: new URL('./music/practice.js', page.url()).href });

  await page.locator('#file-input').setInputFiles(fileURLToPath(fixtureUrl));
  await page.locator('.song-card').filter({ hasText: fixture.title }).locator('.open-song').click();
  importedId = (await storedSong()).id;
  const initialCount = await page.locator('.song-card').count();
  await page.locator('.phrase-organize').click();
  await page.locator('.phrase-division').selectOption('count');
  await page.locator('.phrase-count').fill('11');
  await page.locator('.phrase-suggest').click();
  assert.equal(await page.locator('.phrase-review-row').count(), 11);
  await page.screenshot({ path: fileURLToPath(new URL('qa-phrase-editor.png', output)) });
  await page.locator('.phrase-save').click();
  const saved = await waitStored(song => song?.phrasing?.phrases.length === 11);
  assert.equal(saved.id, importedId); assert.deepEqual(saved.notes, fixture.notes);
  assert.equal((await storedSongs()).length, initialCount);
  assert.deepEqual(saved.phrasing.phrases.map(p => [p.start, p.end]), Array.from({ length: 11 }, (_, i) => [i * 8, (i + 1) * 8]));
  result.elevenPhrasesOneUnchangedSong = { songs: initialCount, notes: saved.notes.length, phraseCount: 11 };

  await page.locator('#mode').selectOption('melody');
  await page.locator('#hands').selectOption('right');
  await choosePhrase('phrase-1');
  assert.deepEqual(await page.evaluate(() => qaPractice.notes.map(n => n.time)), [0, 2, 4, 6]);
  assert.match(await page.locator('#waiting').textContent(), /C4/);
  await page.keyboard.down('a'); await page.clock.runFor(120); await page.keyboard.up('a');
  assert.equal(await page.locator('#hits').textContent(), '1');
  result.practiceUsesOnlyPhraseOnsets = true;
  for (const [index, key] of ['s', 'd', 'f'].entries()) {
    await page.clock.runFor(1880);
    await page.keyboard.down(key); await page.clock.runFor(120); await page.keyboard.up(key);
    assert.equal(await page.locator('#hits').textContent(), String(index + 2));
  }
  await page.clock.runFor(1950);
  const phraseHistory = (await storedHistory()).find(row => row.phraseId === 'phrase-1' && row.completed);
  assert.ok(phraseHistory, 'A conclusão do loop deve registrar a frase praticada.');
  assert.equal(phraseHistory.phraseStart, 0); assert.equal(phraseHistory.phraseEnd, 8);
  assert.equal(phraseHistory.phraseName, 'Seção 01'); assert.equal(phraseHistory.hits, 4);
  result.completedLoopHistoryIdentifiesPhrase = { id: phraseHistory.phraseId, start: phraseHistory.phraseStart, end: phraseHistory.phraseEnd, hits: phraseHistory.hits };
  await pause();

  // Listening to a selected range exercises accompaniment scheduling at B as
  // well as the practice engine. Bass pitch 37 begins exactly at the next B.
  await page.locator('#mode').selectOption('listen');
  await page.locator('#restart').click(); await resetAudioCapture();
  await page.locator('#play').click();await page.waitForFunction(()=>document.querySelector('#play').textContent==='Ⅱ'); await page.clock.runFor(9250); await pause();
  const loopAudio = await capturedAudio(), loopBass = loopAudio.filter(n => n.channel === 1).map(n => n.midi);
  assert.ok(loopBass.filter(n => n === 36).length >= 5, JSON.stringify({loopAudio,state:await state(),play:await page.locator('#play').textContent(),errors}));
  assert.equal(loopBass.includes(37), false);
  result.loopDoesNotPlayNextPhraseBoundary = { bassPitches: [...new Set(loopBass)], loops: 'at least two' };

  await page.locator('.phrase-next').click(); await page.clock.runFor(50);
  assert.equal((await state()).phrase, 'phrase-2'); assert.equal((await state()).currentTime, '0:08');
  assert.deepEqual(await page.evaluate(() => qaPractice.notes.map(n => n.time)), [8, 10, 12, 14]);
  await page.locator('.phrase-next').click(); await page.clock.runFor(50);
  assert.equal((await state()).currentTime, '0:16');
  await page.locator('.phrase-previous').click(); await page.clock.runFor(50);
  assert.equal((await state()).currentTime, '0:08');
  result.nextAndPreviousSetPhraseRangeAndStart = true;
  await pause();

  await page.locator('#mode').selectOption('recital');
  assert.equal((await state()).currentTime, '0:08');
  assert.equal((await state()).loop, 'false');
  assert.equal(await page.locator('#loop').isDisabled(), true);
  result.recitalStartsAtPhraseAWithOnePass = true;
  await page.locator('#mode').selectOption('listen');
  await choosePhrase('phrase-2'); await pause();

  await page.locator('#loop').click();
  assert.equal((await state()).loop, 'false');
  await page.locator('#mode').selectOption('listen'); await resetAudioCapture();
  await page.locator('#play').click(); await page.clock.runFor(9250);
  assert.equal(await page.locator('#play').textContent(), '▶');
  assert.equal((await state()).currentTime, '0:16');
  const stopAudio = await capturedAudio();
  assert.equal(stopAudio.some(n => n.channel === 1 && n.midi === 38), false);
  assert.ok(stopAudio.some(n => n.channel === 1 && n.midi === 37));
  result.withoutLoopStopsAtPhraseEnd = await state();
  await page.locator('.phrase-exit').click();
  assert.equal((await state()).phrase, ''); assert.equal((await state()).range, 'música inteira'); assert.equal((await state()).currentTime, '0:00');
  result.exitRestoresWholeSong = true;

  await choosePhrase('phrase-2'); await pause();
  const beforePreview = await state(), planBeforePreview = (await storedSong()).phrasing;
  await page.locator('.phrase-organize').click();
  const historyBeforePreview = (await storedHistory()).length;
  await page.locator('.phrase-review-row').first().locator('.phrase-row-number').click();
  await page.locator('.phrase-review-row').first().locator('input[type=text]').fill('DESCARTAR ESTE RASCUNHO');
  await page.locator('.phrase-review-row').first().locator('input[type=text]').blur();
  await page.locator('.phrase-review-row').first().locator('input[aria-label^="Fim"]').fill('7.25');
  await page.locator('.phrase-review-row').first().locator('input[aria-label^="Fim"]').blur();
  await resetAudioCapture();
  await page.locator('.phrase-preview').click(); await page.clock.runFor(8250);
  assert.equal(await page.locator('.phrase-preview').textContent(), 'Ouvir frase');
  assert.deepEqual(await state(), beforePreview);
  const previewAudio = await capturedAudio();
  assert.ok(previewAudio.some(n => n.midi === 36 && n.channel === 1));
  assert.equal(previewAudio.some(n => n.midi === 37 && n.channel === 1), false);
  await page.locator('.phrase-preview').click(); await page.clock.runFor(300);
  await page.locator('.phrase-preview').click();
  assert.deepEqual(await state(), beforePreview);
  await page.locator('.phrase-preview').click(); await page.clock.runFor(150);
  await page.locator('.phrase-cancel').click();
  assert.deepEqual(await state(), beforePreview);
  assert.deepEqual((await storedSong()).phrasing, planBeforePreview);
  assert.equal((await storedHistory()).length, historyBeforePreview);
  result.previewAndCancelRestoreTransportAndPreservePlanAndHistory = true;

  await choosePhrase('phrase-1'); await pause();
  await page.locator('.phrase-organize').click();
  await page.locator('.phrase-review-row').first().locator('input[type=text]').fill('01 · Introdução revisada');
  await page.locator('.phrase-review-row').first().locator('input[type=text]').blur();
  await page.locator('.phrase-review-row').first().locator('input[aria-label^="Fim"]').fill('7.5');
  await page.locator('.phrase-review-row').first().locator('input[aria-label^="Fim"]').blur();
  await page.locator('.phrase-save').click();
  const revised = await waitStored(song => song?.phrasing?.phrases[0].end === 7.5 && song?.userPractice?.b === 7.5);
  assert.equal(revised.phrasing.phrases[1].start, 7.5); assert.equal(revised.phrasing.phrases[0].name, '01 · Introdução revisada');
  assert.equal((await state()).phrase, 'phrase-1'); assert.match((await state()).range, /0:07/);
  assert.deepEqual(revised.notes, fixture.notes);
  const restored = await page.evaluate(async ({ url, song }) => (await import(url)).normalizeSong(JSON.parse(JSON.stringify(song))), { url: new URL('./music/midi.js', page.url()).href, song: revised });
  assert.deepEqual(restored.phrasing, revised.phrasing);
  result.savedEditsUpdateActiveRangeAndBackup = { phraseCount: revised.phrasing.phrases.length, start: revised.userPractice.a, end: revised.userPractice.b };

  await page.reload(); await page.locator('.song-card').filter({ hasText: fixture.title }).locator('.open-song').click();
  assert.equal(await page.locator('.phrase-choice option').count(), 12);
  assert.match(await page.locator('.phrase-choice option').nth(1).textContent(), /Introdução revisada/);
  assert.equal((await storedSong()).phrasing.phrases[0].end, 7.5);
  result.phrasesAndNamesSurviveReload = true;
  assert.deepEqual(errors, []); result.pageErrors = errors;
  await page.screenshot({ path: fileURLToPath(new URL('qa-phrase-practice.png', output)) });
  await writeFile(new URL('qa-phrase-practice-result.json', output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await app.close(); }
