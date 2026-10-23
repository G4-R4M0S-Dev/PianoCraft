import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeSong, encodeMidi } from '../src/music/midi.js';

const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
const melody = [[60, 62, 64, 67, 65, 64, 62, 60], [67, 65, 62, 64, 60, 62, 59, 60]];
const order = [0, 1, 0, 1, 0, 0];
const fixture = normalizeSong({
  id: 'qa-structure-song', title: 'QA · desenhos e retornos', tempo: 120, duration: 48,
  timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
  tracks: [{ id: 0, name: 'Melodia', channel: 0, program: 0 }, { id: 1, name: 'Baixo', channel: 1, program: 0 }],
  notes: order.flatMap((kind, part) => [
    ...melody[kind].map((midi, index) => ({ midi: midi + (part === 5 ? 5 : 0) + (part === 4 && index === 7 ? 2 : 0), time: part * 8 + index * .75, duration: .4, keyDuration: .4, velocity: .8, track: 0, channel: 0, hand: 'right' })),
    ...Array.from({ length: 4 }, (_, index) => ({ midi: 36 + kind * 5, time: part * 8 + index * 2, duration: 1, keyDuration: 1, velocity: .6, track: 1, channel: 1, hand: 'left' })),
  ]),
});
const fixtureUrl = new URL('qa-study-structure.mid', output);
await writeFile(fixtureUrl, encodeMidi(fixture));
const env = { ...process.env, PIANOCRAFT_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2];
const app = await electron.launch(executablePath ? { executablePath, args: ['--smoke'], env } : { args: ['.', '--smoke'], env });
const result = { runtime: executablePath || 'source', hardwareIsolated: true };
try {
  const page = await app.firstWindow(), errors = [];
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const saved = JSON.parse(localStorage.getItem('pc-settings') || '{}');
    localStorage.setItem('pc-settings', JSON.stringify({ ...saved, midiAutoConnect: false, midiInputId: '', midiOutputId: '', guideEnabled: false, profile: 'QA estrutura' }));
  });
  await page.clock.install(); await page.reload(); await page.waitForSelector('.song-card');
  const storageUrl = new URL('./storage.js', page.url()).href;
  const stored = key => page.evaluate(async ({ url, key }) => (await import(url)).getStored(key), { url: storageUrl, key });
  const song = async () => (await stored('songs')).find(item => item.id === result.songId);
  const waitStored = async (key, predicate) => {
    for (let i = 0; i < 100; i++) { const value = await stored(key); if (predicate(value)) return value; await page.clock.runFor(20); }
    throw new Error(`Alteração não persistida em ${key}.`);
  };
  const pause = async () => { if ((await page.locator('#play').textContent()).trim() === 'Ⅱ') await page.locator('#play').click(); };

  await page.locator('#file-input').setInputFiles(fileURLToPath(fixtureUrl));
  const imported = await waitStored('songs', items => items?.some(item => item.title.includes('qa-study-structure') || item.title.includes('desenhos e retornos')));
  const candidate = imported.find(item => item.title.includes('qa-study-structure') || item.title.includes('desenhos e retornos'));
  result.songId = candidate.id;
  await page.locator('.song-card').filter({ hasText: candidate.title }).locator('.open-song').click();
  const noteSnapshot = JSON.stringify((await song()).notes);
  const count = imported.length;
  await page.locator('.study-open').click(); await page.locator('.study-source').selectOption('0'); await page.locator('.study-analyze').click();
  await page.locator('.study-family').first().waitFor();
  const structure = await page.locator('.study-form-item').count(), families = await page.locator('.study-family').count();
  assert.ok(structure > families, 'A análise precisa reconhecer pelo menos um retorno.');
  assert.ok(families >= 2, 'Desenhos contrastantes devem formar famílias diferentes.');
  assert.notEqual(structure, 11, 'A análise desta música não deve impor onze partes.');
  assert.equal((await song()).phrasing, undefined);
  await page.locator('.study-save').click();
  await waitStored('songs', items => items.find(item => item.id === result.songId)?.phrasing?.patterns?.length === families);
  const saved = await song();
  assert.deepEqual(saved.notes, JSON.parse(noteSnapshot)); assert.equal((await stored('songs')).length, count);
  assert.ok(saved.phrasing.revisionKey || saved.phrasing.contentKey);
  result.actualMidiImportAndRevisableVariableStructure = { phrases: structure, families, unchangedNotes: saved.notes.length };

  // Existing source data, not a collection of timing examples, drives the UI.
  await page.screenshot({ path: fileURLToPath(new URL('qa-study-real-midi-structure.png', output)) });
  await page.locator('[data-tab="plan"]').click();
  assert.ok(await page.locator('.study-session').count() > 0);
  assert.match(await page.locator('.study-plan').textContent(), /revisão.*não comprova domínio/i);
  assert.match(await page.locator('.study-pattern-progress').textContent(), /não avaliado/);
  await page.locator('.study-exercise .study-check input').first().check();
  const progressStore = await waitStored('study-progress', data => data && Object.values(data).some(entry => entry.profile === 'QA estrutura' && entry.songId === result.songId && entry.completedExercises.length));
  assert.equal(Object.values(progressStore).find(entry => entry.profile === 'QA estrutura').completedExercises.length, 1);
  assert.match(await page.locator('.study-pattern-progress').textContent(), /não avaliado/);
  result.selfReportedReviewDoesNotClaimMastery = true;
  await page.screenshot({ path: fileURLToPath(new URL('qa-study-real-midi-plan.png', output)) });

  // Read the plan through the same module and persisted data; the app must apply
  // exactly the selected range, hand, mode and tempo to actual playback.
  const plan = await page.evaluate(async ({ url, song }) => (await import(url)).buildStudyPlan(song, song.phrasing, { profile: 'QA estrutura', history: [], sessionMinutes: 20 }), { url: new URL('./music/study-plan.js', page.url()).href, song: saved });
  const otherFamily = saved.phrasing.patterns.find(pattern => pattern.id !== plan.objective.patternId);
  assert.ok(otherFamily);
  await page.locator('.study-target-pattern').selectOption(otherFamily.id);
  const otherPlan = await page.evaluate(async ({ url, song, targetPatternId }) => (await import(url)).buildStudyPlan(song, song.phrasing, { profile: 'QA estrutura', history: [], sessionMinutes: 20, targetPatternId }), { url: new URL('./music/study-plan.js', page.url()).href, song: saved, targetPatternId: otherFamily.id });
  assert.equal(otherPlan.objective.patternId, otherFamily.id);
  await page.locator('.study-exercise .study-check input').first().check();
  await waitStored('study-progress', data => data && Object.values(data).some(entry => entry.profile === 'QA estrutura' && entry.completedExercises.includes(otherPlan.sessions[0].exercises[0].id)));
  await page.locator('.study-target-pattern').selectOption('');
  assert.equal(await page.locator('.study-exercise .study-check input').first().isChecked(), true);
  result.chooseAnyFamilyAndPreserveItsReview = true;
  const exercise = plan.sessions[0].exercises[0];
  await page.locator('.study-start-exercise').first().click();
  await page.clock.runFor(50);
  assert.equal(await page.locator('.study-dialog').evaluate(element => element.open), false);
  assert.equal(await page.locator('#mode').inputValue(), exercise.mode);
  assert.equal(await page.locator('#hands').inputValue(), exercise.hands);
  assert.equal(Number(await page.locator('#speed').inputValue()), Math.round(exercise.speed * 100));
  assert.equal(await page.locator('#study-exercise').evaluate(element => element.hidden), false);
  const exerciseSaved = await song();
  assert.ok(Math.abs(exerciseSaved.userPractice.a - exercise.start) < .001);
  assert.ok(Math.abs(exerciseSaved.userPractice.b - exercise.end) < .001);
  result.exerciseControlsApplyMusicalRange = { id: exercise.id, start: exercise.start, end: exercise.end, hands: exercise.hands, mode: exercise.mode, speed: exercise.speed };
  await pause();

  await page.locator('.study-open').click(); await page.locator('[data-tab="plan"]').click();
  assert.equal(await page.locator('.study-exercise .study-check input').first().isChecked(), true);
  const pointButton = page.locator('.study-start-point').last();
  assert.ok(await pointButton.count());
  await pointButton.evaluate(element => element.closest('details').open = true);
  const pointTime = await pointButton.textContent();
  await pointButton.click(); await page.clock.runFor(50); await pause();
  const selectedPoint = (await song()).userPractice;
  assert.ok(saved.phrasing.phrases.some(phrase => Math.abs(phrase.start - selectedPoint.a) < .001 && Math.abs(phrase.end - selectedPoint.b) < .001));
  result.startWithoutPlayingFromBeginning = { label: pointTime, start: selectedPoint.a, end: selectedPoint.b };

  await page.locator('.study-open').click(); await page.locator('[data-tab="plan"]').click();
  const memoryExercise = plan.exercises.find(item => item.hideGuides);
  assert.ok(memoryExercise, 'O plano precisa incluir recuperação sem guias.');
  const memoryCard = page.locator(`.study-exercise[data-exercise-id="${memoryExercise.id}"]`);
  await memoryCard.evaluate(element => element.closest('details').open = true);
  await memoryCard.locator('.study-start-exercise').click(); await page.clock.runFor(50);
  assert.equal(await page.locator('body').evaluate(element => element.classList.contains('study-memory')), true);
  await page.locator('#study-exercise-exit').click();
  assert.equal(await page.locator('body').evaluate(element => element.classList.contains('study-memory')), false);
  assert.equal(await page.locator('#study-exercise').evaluate(element => element.hidden), true);
  result.memoryExerciseAndReturnRestoreGuides = true;

  // Reloading preserves the user-reviewed interpretation and checklist.
  await page.reload(); await page.waitForSelector('.song-card');
  await page.locator('.song-card').filter({ hasText: candidate.title }).locator('.open-song').click();
  await page.locator('.study-open').click(); await page.locator('[data-tab="plan"]').click();
  const afterReload = await song();
  assert.equal(await page.locator('.study-exercise .study-check input').first().isChecked(), true, JSON.stringify({ message: 'Revisão deve persistir após reiniciar', originalKey: saved.phrasing.revisionKey, currentKey: afterReload.phrasing.revisionKey, progress: await stored('study-progress'), visible: await page.locator('.study-plan').textContent() }));
  assert.deepEqual((await song()).notes, JSON.parse(noteSnapshot));
  result.structureAndProgressSurviveRestart = true;
  await page.locator('.study-close').click();
  await page.locator('#settings-button').click();
  await page.locator('#profile').fill('QA outro perfil'); await page.locator('#profile').press('Tab');
  await page.locator('#settings .dialog-heading button').click();
  await page.locator('.study-open').click(); await page.locator('[data-tab="plan"]').click();
  assert.equal(await page.locator('.study-exercise .study-check input').first().isChecked(), false);
  assert.match(await page.locator('.study-pattern-progress').textContent(), /não avaliado/);
  await page.locator('.study-close').click();
  await page.locator('#settings-button').click();
  await page.locator('#profile').fill('QA estrutura'); await page.locator('#profile').press('Tab');
  await page.locator('#settings .dialog-heading button').click();
  await page.locator('.study-open').click(); await page.locator('[data-tab="plan"]').click();
  assert.equal(await page.locator('.study-exercise .study-check input').first().isChecked(), true);
  await page.locator('.study-close').click();
  result.profileSwitchKeepsReviewSeparate = true;
  await page.locator('.study-open').click();
  await page.locator('.study-occurrence .study-review summary').click();
  await page.locator('.study-family-choice').selectOption('__new__');
  await page.locator('.study-occurrence .study-review button').click();
  await page.locator('.study-save').click();
  await waitStored('songs', items => {
    const phrasing = items.find(item => item.id === result.songId)?.phrasing;
    return phrasing && phrasing.revisionKey !== saved.phrasing.revisionKey;
  });
  await page.locator('[data-tab="plan"]').click();
  assert.equal(await page.locator('.study-exercise .study-check input').first().isChecked(), false);
  assert.deepEqual((await song()).notes, JSON.parse(noteSnapshot));
  assert.equal((await stored('songs')).length, count);
  await page.locator('.study-close').click();
  result.manualFamilyReviewInvalidatesOldChecklistWithoutChangingMidi = true;

  // Inspect the user's complete imported arrangement when supplied, never
  // copying suggestions from the sample screenshots into its structure.
  const realUrl = new URL('user-song-0.json', output);
  let real;
  try { real = JSON.parse(await readFile(realUrl, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (real?.notes?.length) {
    await page.locator('.nav[data-view="library"]').click();
    await page.locator('#file-input').setInputFiles(fileURLToPath(realUrl));
    await page.locator('.song-card').filter({ hasText: real.title }).last().locator('.open-song').click();
    await page.locator('.study-open').click(); await page.locator('.study-analyze').click();
    await page.locator('.study-family').first().waitFor();
    result.userArrangement = { title: real.title, duration: real.duration, notes: real.notes.length, phrases: await page.locator('.study-form-item').count(), families: await page.locator('.study-family').count() };
    await page.screenshot({ path: fileURLToPath(new URL('qa-study-indila-structure.png', output)) });
    await page.locator('.study-close').click();
  }
  assert.deepEqual(errors, []);
  result.errors = errors;
  await writeFile(new URL('qa-study-practice.json', output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(new URL('qa-study-practice.json', output), JSON.stringify({ ...result, failed: error.message }, null, 2));
  throw error;
} finally { await app.close(); }
