import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeSong } from '../src/music/midi.js';
import { analyzePatterns } from '../src/music/patterns.js';
import { achievementContentKey } from '../src/music/achievements.js';
import { normalizeJourneyState, createJourneyTask } from '../src/music/learning-journey.js';

const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
const profileA = 'QA Cursor A', profileB = 'QA Cursor B', profileC = 'QA Cursor C';
const song = normalizeSong({ id: 'qa-journey-state', title: 'QA · retomada e projeto', duration: 16, tempo: 120,
  tracks: [{ id: 0, name: 'Melodia', channel: 0, program: 0 }, { id: 1, name: 'Baixo', channel: 1, program: 0 }],
  configs: { 0: { hand: 'right', role: 'auto', volume: 1 }, 1: { hand: 'left', role: 'auto', volume: 1 } },
  timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
  notes: Array.from({ length: 16 }, (_, time) => ({ id: `n-${time}`, time, midi: time % 2 ? 48 + time % 4 : 64 + time % 4,
    duration: .3, keyDuration: .3, velocity: .8, track: time % 2 ? 1 : 0, channel: time % 2 ? 1 : 0 })),
});
song.phrasing = { ...analyzePatterns(song, { phrases: [{ id: 'qa-first', start: 0, end: 8, name: 'Padrão A' }, { id: 'qa-return', start: 8, end: 16, name: 'Retorno A' }] }), reviewed: true };
const contentKey = achievementContentKey(song), scopeKey = profile => JSON.stringify([profile, song.id, contentKey]);
const cursor = (profile, options = {}, extra = {}) => normalizeJourneyState({ ...normalizeJourneyState(null, song, { profile }),
  task: createJourneyTask(song, { profile, ...options }), started: true, startedAt: '2026-10-22T12:00:00Z', updatedAt: '2026-10-22T13:00:00Z', ...extra }, song, { profile });
const savedA = cursor(profileA), savedB = cursor(profileB, { start: 8, end: 16, phraseId: 'qa-return', mode: 'rhythm', hands: 'left', speed: .9 },
  { streak: 2, seenAttemptIds: ['already-evaluated'], lastAttemptId: 'already-evaluated', lastAccuracy: 100 });
const row = (id, profile = profileC, extra = {}) => ({ id, attemptId: id, title: song.title, songId: song.id, profile, songContentKey: contentKey,
  date: '2026-10-22T10:00:00Z', practiceSessionId: id, seconds: 5, mode: 'melody', hands: 'left', speed: .6, transpose: 0,
  completed: false, scopeComplete: false, start: 8, end: 16, position: 10, hits: 0, missed: 0, errors: 2, accuracy: 0,
  expectedNotes: 4, errorEvents: [{ time: 9, reason: 'wrong-note', type: 'pitch', count: 2, expectedPitches: [49] }], ...extra });
const initial = { pianocraft: 1, songs: [song], history: [row('error-session-one'), row('error-session-two')], learningJourneys: { [scopeKey(profileA)]: savedA, [scopeKey(profileB)]: savedB } };
const env = { ...process.env, PIANOCRAFT_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2], tag = executablePath ? 'package' : 'source';
const app = await electron.launch(executablePath ? { executablePath, args: ['--smoke'], env } : { args: ['.', '--smoke'], env });
const results = { runtime: executablePath || 'source', hardwareIsolated: true, checks: [] }, errors = [];
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(15000); await page.setViewportSize({ width: 1440, height: 960 });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const saved = JSON.parse(localStorage.getItem('pc-settings') || '{}');
    localStorage.setItem('pc-settings', JSON.stringify({ ...saved, profile: saved.profile?.startsWith('QA Cursor') ? saved.profile : 'QA Cursor A',
      midiAutoConnect: false, midiInputId: '', midiOutputId: '', guideEnabled: false, practiceCountInBars: 0, practiceRestSeconds: .5, celebrationSound: false, focusMode: false }));
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => ({ inputs: new Map(), outputs: new Map(), sysexEnabled: false, addEventListener() {}, removeEventListener() {} }) });
  });
  await page.reload(); await page.waitForSelector('.song-card');
  const storageUrl = new URL('storage.js', page.url()).href;
  const getStored = key => page.evaluate(async ({ url, key }) => (await import(url)).getStored(key), { url: storageUrl, key });
  const journeys = async () => (await getStored('learning-journeys')) || {};
  const state = async (profile = profileA) => (await journeys())[scopeKey(profile)];
  const history = async () => (await getStored('practice-history')) || [];
  const currentSong = async () => (await getStored('songs')).find(item => item.id === song.id);
  const click = selector => page.locator(selector).dispatchEvent('click');
  const waitFor = async (predicate, label, maxMs = 20000) => {
    const started = Date.now(); while (Date.now() - started < maxMs) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
    throw new Error(`${label}: ${JSON.stringify(await page.evaluate(() => ({ view: document.querySelector('#page-label').textContent, play: document.querySelector('#play').textContent,
      mission: document.querySelector('#practice-mission')?.textContent, toast: document.querySelector('#toast').textContent })))}`);
  };
  let importSerial = 0;
  const importProject = async (project, name = 'qa-project.json') => {
    const marker = `qa-state-import-${++importSerial}`;
    const marked = { ...project, songs: project.songs.map(item => item.id === song.id ? { ...item, author: marker } : item) };
    await page.locator('#file-input').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(marked)) });
    await waitFor(async () => (await getStored('songs'))?.some(item => item.id === song.id && item.author === marker), 'Projeto importado');
    // importFiles writes songs after validating the independent state stores.
    await page.evaluate(() => document.querySelector('#file-input').value = '');
  };
  const chooseProfile = async profile => {
    await click('#settings-button'); await page.locator('#profile').fill(profile); await page.locator('#profile').dispatchEvent('change');
    await page.locator('#settings .dialog-heading button').dispatchEvent('click');
  };
  const openHub = async () => {
    if (await page.locator('#studio-view').isVisible()) await click('#back-to-song');
    else if (!await page.locator('#song-view').isVisible()) { await click('[data-view="library"]'); await click(`[data-song="${song.id}"] .open-song`); }
    await waitFor(() => page.locator('#song-view').isVisible(), 'Página de estudo visível');
  };
  const expectPlaying = async () => waitFor(async () => await page.locator('#studio-view').isVisible() && (await page.locator('#play').textContent()).trim() === 'Ⅱ', 'Prática iniciada');
  const holdNextJourneyWrite = () => page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    window.qaHoldWrite = true; window.qaWriteHeld = false;
    IDBObjectStore.prototype.put = function(value, key) {
      const request = original.call(this, value, key);
      if (key === 'learning-journeys') {
        IDBObjectStore.prototype.put = original; window.qaWriteHeld = true;
        const store = this, pump = () => { const read = store.get('qa-keep-transaction-open'); read.onsuccess = () => { if (window.qaHoldWrite) pump(); }; };
        pump();
      }
      return request;
    };
  });
  const releaseWrite = () => page.evaluate(() => { window.qaHoldWrite = false; });

  await importProject(initial);
  await waitFor(async () => (await state(profileB))?.streak === 2, 'Cursores importados');
  assert.equal((await state()).task.id, savedA.task.id); assert.equal((await state(profileB)).task.id, savedB.task.id);
  await openHub(); assert.equal(await page.locator('.song-hub-start').textContent(), 'Continuar');
  results.checks.push('Projeto restaura missão, intervalo, modo, mão, andamento e sequência de dois perfis independentes.');

  await click('.song-hub-start'); await expectPlaying();
  await waitFor(async () => (await currentSong()).configs[0].role === 'learn', 'Pista da mão escolhida aprende');
  assert.equal((await currentSong()).configs[1].role, 'auto');
  assert.equal(await page.locator('#hands').inputValue(), 'right'); assert.equal(await page.locator('#speed').inputValue(), '60');
  assert.match(await page.locator('#mission-goal').textContent(), /0\/3/);
  await new Promise(resolve => setTimeout(resolve, 1200));
  await click('#back-to-song');
  await waitFor(async () => (await history()).some(row => row.songId === song.id && row.profile === profileA && row.journeyTaskId === savedA.task.id && !row.completed), 'Tentativa parcial salva sem meta');
  assert.equal((await state()).streak, 0); assert.equal((await state()).task.id, savedA.task.id);
  await page.reload(); await page.waitForSelector('.song-card'); await openHub();
  assert.equal(await page.locator('.song-hub-start').textContent(), 'Continuar'); assert.equal((await state()).task.speed, .6);
  assert.equal((await state()).task.start, 0); assert.equal((await state()).task.end, 8);
  results.checks.push('Começar promove só as pistas do escopo de Auto para Aprender; pausa parcial e recarga conservam o trecho a 60%, sem fabricar acerto ou avanço.');

  await click('.song-hub-start'); await expectPlaying();
  await page.locator('#practice-tools').evaluate(element => { element.open = true; });
  await page.locator('#mode').selectOption('rhythm');
  assert.equal(await page.locator('body').evaluate(element => element.classList.contains('guided-practice')), false);
  assert.doesNotMatch(await page.locator('#mission-goal').textContent(), /execuções seguidas/);
  assert.equal((await state()).task.mode, 'melody'); assert.equal((await state()).streak, 0);
  await click('#back-to-song');
  results.checks.push('Ajuste manual de modo vira prática personalizada e mantém a missão guiada salva, sem uma meta antiga impossível de cumprir.');

  await chooseProfile(profileC); await openHub();
  assert.match(await page.locator('.song-hub-task h2').textContent(), /Revisar/);
  assert.match(await page.locator('.song-hub-task-meta').textContent(), /Mão esquerda/);
  assert.match(await page.locator('.song-hub-task-meta').textContent(), /0:08.*0:16/);
  assert.equal(await state(profileC), undefined);
  await chooseProfile(profileB); await openHub(); assert.match(await page.locator('.song-hub-task-meta').textContent(), /Ritmo.*90%/);
  assert.match(await page.locator('.song-hub-goal').textContent(), /2\/3/);
  results.checks.push('Histórico com conteúdo atual sugere revisar o local real dos erros para um perfil novo; cursores já iniciados e perfis diferentes prevalecem.');

  const exportedPath = fileURLToPath(new URL(`journey-backup-${tag}-${process.pid}.json`, output));
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, exportedPath);
  await click('#settings-button'); await click('#backup');
  let exported;
  await waitFor(async () => { try { exported = JSON.parse(await readFile(exportedPath, 'utf8')); return !!exported.learningJourneys; } catch { return false; } }, 'Backup exportado com cursores');
  await page.locator('#settings .dialog-heading button').dispatchEvent('click');
  assert.equal(exported.learningJourneys[scopeKey(profileA)].task.id, savedA.task.id);
  assert.equal(exported.learningJourneys[scopeKey(profileB)].streak, 2);
  assert.deepEqual(exported.learningJourneys[scopeKey(profileB)].seenAttemptIds, ['already-evaluated']);
  results.checks.push('Exportação real pelo aplicativo inclui cursores, perfis e identificadores já avaliados no projeto JSON.');

  const beforeB = await state(profileB), older = cursor(profileB, { start: 0, end: 8, speed: .4 }, { updatedAt: '2026-10-21T10:00:00Z' });
  await importProject({ pianocraft: 1, songs: [await currentSong()], learningJourneys: { old: older } }, 'qa-older-cursor.json');
  await waitFor(async () => (await state(profileB))?.task.id === beforeB.task.id, 'Backup antigo preserva cursor recente');
  assert.equal((await state(profileB)).streak, 2);
  const malformed = { ...savedA, profile: 'QA Cursor Invalid', task: { ...savedA.task, start: -1 }, updatedAt: '2099-01-01T00:00:00Z' };
  const badVersion = { ...savedA, profile: 'QA Cursor Version', version: 2 };
  const badContent = { ...savedA, profile: 'QA Cursor Content', contentKey: 'stale' };
  await importProject({ pianocraft: 1, songs: [await currentSong()], learningJourneys: { malformed, badVersion, badContent } }, 'qa-invalid-cursors.json');
  // Observe import completion by re-exporting, which waits for the same queues.
  await click('#settings-button'); await click('#backup'); await page.locator('#settings .dialog-heading button').dispatchEvent('click');
  await waitFor(async () => !Object.values(await journeys()).some(item => item.profile.startsWith('QA Cursor Invalid')), 'Cursor malformado deve ser ignorado');
  const known = Object.values(await journeys()).filter(item => item.songId === song.id).map(item => item.profile);
  assert.ok(!known.includes('QA Cursor Version')); assert.ok(!known.includes('QA Cursor Content')); assert.ok(!known.includes('QA Cursor Invalid'));
  results.checks.push('Importar backup anterior preserva o cursor mais recente; versão, conteúdo e tarefa malformados são rejeitados mesmo com um identificador de tarefa aparentemente válido.');

  const repeated = row('already-evaluated', profileB, { completed: true, scopeComplete: true, mode: 'rhythm', hands: 'left', speed: .9,
    seconds: 9, hits: 4, errors: 0, missed: 0, expectedNotes: 4, accuracy: 100, journeyTaskId: savedB.task.id, errorEvents: [] });
  await importProject({ pianocraft: 1, songs: [await currentSong()], history: [repeated, repeated], learningJourneys: { same: beforeB } }, 'qa-repeated-attempt.json');
  await waitFor(async () => (await history()).some(item => item.id === repeated.id), 'Histórico repetido importado');
  assert.equal((await history()).filter(item => item.id === repeated.id).length, 1); assert.equal((await state(profileB)).streak, 2);
  const duplicate = await page.evaluate(async ({ url, song, state, attempt, profile }) => (await import(url)).evaluateJourneyAttempt(song, state, attempt, { profile }),
    { url: new URL('music/learning-journey.js', page.url()).href, song: await currentSong(), state: await state(profileB), attempt: repeated, profile: profileB });
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.changed, false); assert.equal(duplicate.streak, 2); assert.equal(duplicate.goalMet, false);
  results.checks.push('Reimportar uma execução conhecida não duplica histórico nem eleva a sequência; a deduplicação sobrevive ao projeto e à recarga.');

  await chooseProfile(profileA); await openHub();
  await holdNextJourneyWrite(); await click('.song-hub-start');
  await waitFor(() => page.evaluate(() => qaWriteHeld), 'Gravação de início suspensa no teste');
  await click('[data-view="library"]'); await releaseWrite();
  await waitFor(async () => (await state()).started, 'Gravação suspensa terminou');
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(await page.locator('#library-view').isVisible(), true); assert.equal((await page.locator('#play').textContent()).trim(), '▶');
  results.checks.push('Uma gravação assíncrona que termina após sair da música não reabre o estúdio nem começa a tocar.');

  await openHub(); await holdNextJourneyWrite(); await click('.song-hub-start');
  await waitFor(() => page.evaluate(() => qaWriteHeld), 'Primeira seleção suspensa');
  await click('#song-view [data-path="rhythm:left"]'); await releaseWrite(); await expectPlaying();
  await waitFor(async () => (await state()).task.mode === 'rhythm' && (await state()).task.hands === 'left', 'Última seleção vence a fila');
  assert.equal(await page.locator('#mode').inputValue(), 'rhythm'); assert.equal(await page.locator('#hands').inputValue(), 'left');
  assert.equal(await page.locator('#speed').inputValue(), '90');
  results.checks.push('Quando dois desafios são escolhidos durante uma gravação pendente, a última escolha determina tanto o cursor salvo quanto a prática iniciada.');

  await click('#back-to-song'); assert.deepEqual(errors, []);
  await waitFor(() => page.locator('#song-view').isVisible(), 'Resumo final da jornada visível');
  const window = await app.browserWindow(page);
  const capture = await window.evaluate(async win => {
    win.webContents.invalidate();
    await win.webContents.capturePage();
    await new Promise(resolve => setTimeout(resolve, 160));
    return (await win.webContents.capturePage()).toPNG().toString('base64');
  });
  const screenshot = `journey-state-${tag}.png`;
  await writeFile(new URL(screenshot, output), Buffer.from(capture, 'base64'));
  results.screenshot = screenshot;
  await writeFile(new URL(`journey-state-${tag}.json`, output), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await app.close(); }
