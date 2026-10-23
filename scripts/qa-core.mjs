import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
const fixture = {
  id: 'qa-core', title: 'QA · Mãos e fronteira do loop', tempo: 120, ppq: 480, duration: 2.4,
  tracks: [{ id: 0, name: 'Direita', channel: 0, program: 0 }, { id: 1, name: 'Esquerda', channel: 1, program: 0 }],
  notes: [
    { id: 0, midi: 60, time: 0, duration: .4, track: 0, channel: 0 },
    { id: 1, midi: 48, time: 0, duration: .4, track: 1, channel: 1 },
    { id: 2, midi: 64, time: 1, duration: .4, track: 0, channel: 0 },
    { id: 3, midi: 67, time: 1.2, duration: .4, track: 0, channel: 0 },
    { id: 4, midi: 72, time: 2, duration: .4, track: 0, channel: 0 },
  ],
};
const fixtureUrl = new URL('../test-results/qa-core.json', import.meta.url);
await writeFile(fixtureUrl, JSON.stringify(fixture));
const environment = { ...process.env, PIANOCRAFT_TEST: '1' }; delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.', '--smoke'], env: environment });
try {
  const page = await app.firstWindow(), errors = [], result = {};
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  // This is a PC-keyboard/transport regression test. A person playing the real
  // CASIO in another window must not add notes to its observed accompaniment.
  await page.addInitScript(()=>{
    const saved=JSON.parse(localStorage.getItem('pc-settings')||'{}');
    localStorage.setItem('pc-settings',JSON.stringify({...saved,midiAutoConnect:false,midiInputId:'',guideEnabled:false}));
  });
  await page.clock.install();
  await page.reload();
  await page.waitForSelector('.song-card');
  await page.evaluate(async url => {
    const { AudioEngine } = await import(url);
    const original = AudioEngine.prototype.noteOn;
    window.qaNotes = [];
    AudioEngine.prototype.noteOn = function(midi, velocity, channel, program) {
      window.qaNotes.push({ midi, velocity, channel, at: performance.now() });
      return original.call(this, midi, velocity, channel, program);
    };
  }, new URL('../src/music/audio.js', import.meta.url).href);
  await page.locator('#file-input').setInputFiles(fileURLToPath(fixtureUrl));
  await page.locator('.song-card').filter({ hasText: fixture.title }).locator('.open-song').click();

  await page.locator('#mode').selectOption('melody');
  await page.locator('#hands').selectOption('right');
  await page.locator('#play').click();
  await page.clock.runFor(50);
  await page.waitForFunction(() => document.querySelector('#play-state').textContent === 'Aguardando suas notas');
  result.rightHandWaits = await page.locator('#waiting').textContent();
  assert.match(result.rightHandWaits, /C4/);
  assert.deepEqual(await page.evaluate(() => qaNotes.map(note => note.midi)), [48]);
  await page.keyboard.press('a');
  await page.waitForFunction(() => document.querySelector('#hits').textContent === '1');
  await page.clock.runFor(1100);
  await page.waitForFunction(() => document.querySelector('#waiting').textContent.includes('E4'));
  result.computerKeyboardAfterButtonClick = true;
  await page.locator('#play').click();

  await page.locator('#mode').selectOption('recital');
  assert.equal(await page.locator('#speed').isDisabled(), true);
  assert.equal(await page.locator('#timeline').isDisabled(), true);
  assert.equal(await page.locator('#loop').isDisabled(), true);
  assert.equal(await page.locator('#speed-value').textContent(), '100%');
  assert.equal(await page.locator('#current-time').textContent(), '0:00');
  result.recitalLocksSpeedSeekAndLoop = true;

  await page.locator('#mode').selectOption('listen');
  await page.locator('#timeline').fill('500');
  await page.locator('#set-b').click();
  await page.locator('#restart').click();
  await page.locator('#loop').click();
  await page.evaluate(() => qaNotes.length = 0);
  await page.locator('#play').click();
  await page.clock.runFor(1550);
  await page.locator('#play').click();
  const loopPitches = await page.evaluate(() => qaNotes.map(note => note.midi));
  result.loopPitches = loopPitches;
  result.noteAtLoopEndWasPlayed = loopPitches.includes(67);
  result.loopRestarted = loopPitches.filter(pitch => pitch === 60).length >= 2;
  assert.equal(result.loopRestarted, true, JSON.stringify({ loopPitches, transport: await page.locator('#timeline').inputValue() }));

  await page.locator('#mode').selectOption('melody');
  await page.locator('#hands').selectOption('both');
  await page.locator('#loop').click();
  await page.locator('#restart').click();
  result.historyBeforeFinalPractice = await page.evaluate(() => JSON.parse(localStorage.getItem('pc-history') || '[]').length);
  await page.locator('#play').click();
  await page.clock.runFor(1200);
  await page.locator('[data-view="progress"]').click();
  result.historyImmediatelyAfterLeavingPractice = await page.locator('.history-row').count();
  assert.equal(result.historyImmediatelyAfterLeavingPractice, result.historyBeforeFinalPractice + 1);

  await page.locator('[data-view="studio"]').click();
  await page.locator('#mode').selectOption('listen');
  await page.locator('#timeline').fill('500');
  await page.locator('#add-marker').click();
  await page.locator('#marker-name').fill('Retorno QA');
  await page.locator('#save-marker').click();
  assert.equal(await page.locator('#marker-picker option').filter({ hasText: 'Retorno QA' }).count(), 1);
  await page.locator('#timeline').fill('0');
  await page.locator('#marker-picker').selectOption('0');
  assert.equal(await page.locator('#timeline').inputValue(), '500');
  await page.locator('#mode').selectOption('recital');
  await page.locator('#marker-picker').selectOption('');
  await page.locator('#marker-picker').selectOption('0');
  assert.equal(await page.locator('#timeline').inputValue(), '0');
  result.markersSeekAndRespectRecital = true;

  await page.locator('#mode').selectOption('melody');
  await page.locator('#hands').selectOption('right');
  await page.locator('#strict-melody').check();
  await page.locator('#play').click();
  await page.clock.runFor(50);
  await page.keyboard.down('d');
  await page.keyboard.press('a');
  await page.clock.runFor(600);
  assert.equal(await page.locator('#timeline').inputValue(), '0');
  assert.match(await page.locator('#waiting').textContent(), /Solte as notas incorretas/);
  await page.keyboard.up('d');
  await page.clock.runFor(1100);
  assert.match(await page.locator('#waiting').textContent(), /E4/);
  result.strictMelodyWaitsForWrongKeyRelease = true;
  await page.locator('#play').click();
  await page.locator('#strict-melody').uncheck();

  const stored = await page.evaluate(async url => (await import(url)).getStored('songs'), new URL('../src/storage.js', import.meta.url).href);
  assert.equal(stored.find(song => song.title === 'QA · Mãos e fronteira do loop').markers[0].text, 'Retorno QA');
  await page.reload();
  await page.locator('.song-card').filter({ hasText: fixture.title }).locator('.open-song').click();
  assert.equal(await page.locator('#marker-picker option').filter({ hasText: 'Retorno QA' }).count(), 1);
  result.markersSurviveAppReload = true;
  result.pageErrors = errors;
  assert.deepEqual(errors, []);
  await writeFile(new URL('../test-results/qa-core-result.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await app.close(); }
