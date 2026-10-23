import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeSong } from '../src/music/midi.js';
import { analyzePatterns } from '../src/music/patterns.js';

const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
const profileA = 'QA Estudo A', profileB = 'QA Estudo B';
const song = normalizeSong({ id: 'qa-learning-flow-song', title: 'QA · meu próximo passo', tempo: 120, duration: 4,
  tracks: [{ id: 0, name: 'Melodia', channel: 0, program: 0 }, { id: 1, name: 'Baixo', channel: 1, program: 0 }],
  timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
  configs: { 0: { hand: 'right', role: 'learn', volume: 1 }, 1: { hand: 'left', role: 'learn', volume: 1 } },
  notes: [
    ...Array.from({ length: 8 }, (_, i) => ({ midi: [60, 62, 64, 62][i % 4], time: i * .5, duration: .2, keyDuration: .2, velocity: .8, track: 0, channel: 0, hand: 'right' })),
    ...Array.from({ length: 4 }, (_, i) => ({ midi: [48, 55][i % 2], time: i, duration: .3, keyDuration: .3, velocity: .75, track: 1, channel: 1, hand: 'left' })),
  ],
});
song.phrasing = { ...analyzePatterns(song, { phrases: [{ id: 'qa-a', name: 'Desenho A', start: 0, end: 2 }, { id: 'qa-a-return', name: 'Desenho A · retorno', start: 2, end: 4 }] }), reviewed: true };
const fixture = new URL('qa-learning-flow-project.json', output);
await writeFile(fixture, JSON.stringify({ pianocraft: 1, songs: [song] }));
const env = { ...process.env, PIANOCRAFT_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2];
const app = await electron.launch(executablePath ? { executablePath, args: ['--smoke'], env } : { args: ['.', '--smoke'], env });
const result = { runtime: executablePath || 'source', clockInstalledBeforeLoad: true, hardwareIsolated: true, checks: [], layouts: [] }, errors = [];
let page;
const capture = async filename => {
  // Paused virtual RAF can leave Electron's native capture on an old frame.
  // Only capture during preparation or while the completed attempt is paused.
  await page.clock.resume();
  try { await page.screenshot({ path: fileURLToPath(new URL(filename, output)), animations: 'disabled', timeout: 10000 }); }
  finally { await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 200))); }
};
try {
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const saved = JSON.parse(localStorage.getItem('pc-settings') || '{}');
    localStorage.setItem('pc-settings', JSON.stringify({ ...saved, profile: saved.profile?.startsWith('QA Estudo') ? saved.profile : 'QA Estudo A', midiAutoConnect: true,
      midiInputId: 'qa-learning-input', midiOutputId: '', guideEnabled: false, practiceCountInBars: 1, practiceRestSeconds: .5, celebrationSound: false, focusMode: false }));
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => {
      if (window.qaMidiAccess) return window.qaMidiAccess;
      const access = new EventTarget(); access.sysexEnabled = false;
      class Port extends EventTarget {
        constructor() { super(); Object.assign(this, { id: 'qa-learning-input', type: 'input', name: 'QA keyboard', manufacturer: 'PianoCraft QA', state: 'connected', connection: 'closed' }); }
        async open() { this.connection = 'open'; return this; }
        async close() { this.connection = 'closed'; return this; }
      }
      const input = new Port(); access.inputs = new Map([[input.id, input]]); access.outputs = new Map();
      window.qaSendMidi = bytes => { const message = new Event('midimessage'); Object.assign(message, { data: new Uint8Array(bytes), receivedTime: performance.now() }); input.dispatchEvent(message); };
      window.qaMidiAccess = access; return access;
    } });
  });
  const epoch = new Date('2026-10-22T18:00:00Z');
  await page.clock.install({ time: epoch }); await page.clock.pauseAt(new Date(+epoch + 1000));
  await page.reload(); await page.waitForSelector('.song-card');
  const storageUrl = new URL('storage.js', page.url()).href;
  const stored = key => page.evaluate(async ({ url, key }) => (await import(url)).getStored(key), { url: storageUrl, key });
  const storedSong = async () => (await stored('songs')).find(item => item.id === song.id);
  const history = async () => (await stored('practice-history')) || [];
  const journeys = async () => (await stored('learning-journeys')) || {};
  const journey = async (profile = profileA) => Object.values(await journeys()).find(item => item.songId === song.id && item.profile === profile);
  const click = selector => page.locator(selector).dispatchEvent('click');
  const state = () => page.evaluate(() => ({ play: document.querySelector('#play').textContent.trim(), countHidden: document.querySelector('#practice-countdown').hidden,
    phase: document.querySelector('#practice-countdown').dataset.phase, time: window.qaMusicTime, hits: Number(document.querySelector('#hits').textContent), errors: Number(document.querySelector('#errors').textContent),
    mode: document.querySelector('#mode').value, hands: document.querySelector('#hands').value, speed: document.querySelector('#speed').value,
    mission: document.querySelector('#practice-mission')?.textContent, noteCount: window.qaPractice?.notes?.length,
    notice: document.querySelector('.completion-notice')?.hidden ? null : document.querySelector('.completion-notice')?.textContent,
    toast: document.querySelector('#toast').textContent, notices: window.qaNotices?.length }));
  const waitFor = async (predicate, label, maxMs = 25000, step = 16) => {
    for (let elapsed = 0; elapsed <= maxMs; elapsed += step) { if (await predicate()) return; await page.clock.runFor(step); }
    throw new Error(`${label}: ${JSON.stringify(await state())}`);
  };
  const pause = async () => { if ((await page.locator('#play').textContent()).trim() === 'Ⅱ') await click('#play'); };
  const hook = () => page.evaluate(async urls => {
    const { PracticeSession } = await import(urls.practice), { CompletionNotice } = await import(urls.completion);
    window.qaNotices = []; window.qaMusicTime = -1; window.qaPractice = null;
    const gate = PracticeSession.prototype.gate;
    PracticeSession.prototype.gate = function(time) { const value = gate.call(this, time); window.qaPractice = this; window.qaMusicTime = value; return value; };
    const show = CompletionNotice.prototype.show;
    CompletionNotice.prototype.show = function(input, options) { const accepted = show.call(this, input, options); if (accepted) qaNotices.push({ ...structuredClone(input), compact: !!options?.compact }); return accepted; };
  }, { practice: new URL('music/practice.js', page.url()).href, completion: new URL('completion.js', page.url()).href });
  const chooseProfile = async profile => {
    await pause(); await click('#settings-button'); await page.locator('#profile').fill(profile); await page.locator('#profile').dispatchEvent('change');
    await page.locator('#settings .dialog-heading button').dispatchEvent('click');
  };
  const openHub = async () => {
    if (await page.locator('#studio-view').isVisible()) await click('#back-to-song');
    else if (!(await page.locator('#song-view').isVisible())) { await click('[data-view="library"]'); await click(`[data-song="${song.id}"] .open-song`); }
    await waitFor(() => page.locator('#song-view').isVisible(), 'Página da música');
  };
  const completePass = async (label, { wrong = false } = {}) => {
    const current = await journey(); const expectedNotes = 4;
    await waitFor(async () => {
      const snapshot = await state(); return snapshot.play === 'Ⅱ' && snapshot.countHidden && snapshot.noteCount === expectedNotes && snapshot.hits === 0 && snapshot.time >= current.task.start && snapshot.time <= current.task.start + .05;
    }, `${label}: início da execução`);
    const notes = await page.evaluate(() => qaPractice.notes.map(note => ({ time: note.time, midi: note.midi, duration: note.keyDuration ?? note.duration })));
    const speed = Number(await page.locator('#speed').inputValue()) / 100;
    const previousCompleted = (await history()).filter(row => row.songId === song.id && row.completed).length;
    if (wrong) {
      await page.evaluate(() => qaSendMidi([0x90, 83, 100])); await page.clock.runFor(32); await page.evaluate(() => qaSendMidi([0x80, 83, 0]));
    }
    for (const [index, note] of notes.entries()) {
      await waitFor(() => page.evaluate(target => qaMusicTime >= target - .000001, note.time), `${label}: chegada da nota ${index + 1}`);
      await page.evaluate(pitch => qaSendMidi([0x90, pitch, 100]), note.midi);
      await page.clock.runFor(Math.max(160, note.duration / speed * 1000 + 30));
      await page.evaluate(pitch => qaSendMidi([0x80, pitch, 0]), note.midi);
      assert.equal(Number(await page.locator('#hits').textContent()), index + 1, `${label}: nota ${index + 1}`);
    }
    await waitFor(async () => (await history()).filter(row => row.songId === song.id && row.completed).length > previousCompleted, `${label}: conclusão persistida`);
    await waitFor(async () => (await journey()).lastAttemptId === (await history()).find(row => row.songId === song.id && row.completed).attemptId, `${label}: missão persistida`);
  };

  await hook();
  await page.locator('#file-input').setInputFiles(fileURLToPath(fixture));
  await waitFor(() => page.locator(`[data-song="${song.id}"]`).count().then(count => count === 1), 'Importação do projeto');
  await click(`[data-song="${song.id}"] .open-song`);
  assert.equal(await page.locator('#song-view').isVisible(), true);
  assert.equal(await page.locator('#song-view [data-path]').count(), 9);
  assert.equal(await page.locator('.song-hub-start').textContent(), 'Começar');
  assert.match(await page.locator('.song-hub-goal').textContent(), /3 execuções seguidas com 90%/);
  assert.equal(await page.locator('.song-hub-progress-value strong').textContent(), '0');
  result.checks.push('Biblioteca abre uma página da música com uma tarefa clara, meta, progresso e nove percursos disponíveis.');

  await click('.song-hub-start');
  await waitFor(() => page.locator('#studio-view').isVisible(), 'Iniciar missão recomendada');
  assert.equal(await page.locator('#mode').inputValue(), 'melody'); assert.equal(await page.locator('#hands').inputValue(), 'right'); assert.equal(await page.locator('#speed').inputValue(), '60');
  assert.equal(await page.locator('#practice-tools').getAttribute('open'), null);
  assert.equal(await page.locator('#practice-mission').isVisible(), true);
  assert.match(await page.locator('#mission-goal').textContent(), /0\/3/);
  const firstTask = (await journey()).task; assert.equal(firstTask.start, 0); assert.equal(firstTask.end, 2);
  await waitFor(() => page.locator('#notation svg').count().then(count => count > 0), 'Partitura visível por padrão');
  for (const theme of ['dark', 'light']) for (const [width, height] of [[1000, 720], [1440, 960]]) for (const focus of [false, true]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    if ((await page.locator('body').getAttribute('class')).includes('practice-focus') !== focus) await click('#focus-mode');
    await page.clock.runFor(32);
    const bounds = await page.evaluate(() => {
      const selectors = ['#practice-mission', '#sheet', '#notation', '.piano-stage', '#keyboard', '.transport'];
      return selectors.map(selector => { const element = document.querySelector(selector), box = element.getBoundingClientRect(); return { selector, x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom, visible: getComputedStyle(element).visibility !== 'hidden' && box.height > 0 }; });
    });
    assert.ok(bounds.every(box => box.visible && box.bottom <= height + 1 && box.right <= width + 1 && box.x >= 0), JSON.stringify({ theme, width, height, focus, bounds }));
    result.layouts.push({ theme, width, height, focus, bounds });
    if ((!focus && width === 1000 && theme === 'light') || (focus && width === 1440 && theme === 'dark')) await capture(`learning-flow-${theme}-${width}${focus ? '-focus' : ''}.png`);
  }
  if ((await page.locator('body').getAttribute('class')).includes('practice-focus')) await click('#focus-mode');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  result.checks.push('A prática começa em Melodia, mão direita, 60%, só no trecho sugerido; ajustes recolhidos e partitura, tarefa e teclado cabem em 1000×720 e 1440×960 nos dois temas, com e sem foco.');

  await completePass('Primeira execução'); assert.equal((await journey()).streak, 1);
  await completePass('Segunda execução'); assert.equal((await journey()).streak, 2);
  await completePass('Terceira execução');
  await waitFor(() => page.locator('.completion-notice:not([hidden]):not(.completion-compact)').count().then(count => count === 1), 'Resumo final 3/3');
  assert.equal(await page.locator('.completion-title').textContent(), 'Meta atingida');
  assert.equal(await page.locator('.completion-goal-ring').textContent(), '3/3');
  assert.match(await page.locator('.completion-continue').textContent(), /70%/);
  assert.equal((await journey()).task.speed, .7); assert.equal((await journey()).task.start, firstTask.start); assert.equal((await journey()).task.end, firstTask.end);
  assert.equal((await page.evaluate(() => qaNotices)).filter(notice => !notice.compact).length, 1);
  const progress = Number((await page.locator('.completion-learning-meter').getAttribute('value')));
  assert.ok(progress > 0);
  result.checks.push('Três execuções corretas produzem 1/3, 2/3 e um único resumo 3/3; o próximo passo aumenta para 70% preservando trecho e mão.');
  await capture('learning-flow-goal.png');

  await click('.completion-continue');
  await waitFor(() => page.locator('#speed').inputValue().then(value => value === '70'), 'CTA inicia a próxima missão');
  assert.equal(await page.locator('.completion-notice').isVisible(), false);
  await completePass('Primeira execução a 70%'); assert.equal((await journey()).streak, 1);
  const completedBeforePartial = (await history()).filter(row => row.songId === song.id && row.completed).length;
  await page.clock.runFor(500); await pause(); await openHub();
  assert.equal((await history()).filter(row => row.songId === song.id && row.completed).length, completedBeforePartial);
  assert.equal(await page.locator('.song-hub-start').textContent(), 'Continuar');
  assert.match(await page.locator('.song-hub-task-meta').textContent(), /70%/);
  assert.match(await page.locator('.song-hub-goal').getAttribute('aria-label'), /1 de 3/);
  assert.equal(Number(await page.locator('.song-hub-progress-value strong').textContent()), progress);

  await click('[data-view="library"]');
  assert.equal(Number(await page.locator(`[data-song="${song.id}"] .song-mastery progress`).getAttribute('value')), progress);
  assert.match(await page.locator(`[data-song="${song.id}"] .open-song`).textContent(), /Continuar/);
  await click(`[data-song="${song.id}"] .song-progress`);
  assert.equal(await page.locator(`.music-progress-card[data-song-id="${song.id}"] .music-progress-score strong`).textContent(), `${progress}/100`);
  await page.reload(); await page.waitForSelector('.song-card'); await hook(); await openHub();
  assert.match(await page.locator('.song-hub-task-meta').textContent(), /70%/);
  assert.match(await page.locator('.song-hub-goal').getAttribute('aria-label'), /1 de 3/);
  assert.equal(Number(await page.locator('.song-hub-progress-value strong').textContent()), progress);
  assert.equal(await page.locator('.completion-notice').isVisible(), false);
  result.checks.push('O CTA executa o desafio seguinte; pausa parcial e recarregamento preservam trecho, 70% e 1/3. Biblioteca, página da música e Meu progresso exibem o mesmo índice após Melodia.');

  await click('.song-hub-start');
  await completePass('Execução com uma nota incorreta', { wrong: true }); assert.equal((await journey()).streak, 0);
  await completePass('Execução após o erro');
  await waitFor(() => page.locator('.completion-notice:not([hidden]):not(.completion-compact)').count().then(count => count === 1), 'Resumo sem meta indevida');
  assert.match(await page.locator('.completion-title').textContent(), /consolidar|Faltam 2 execuções/);
  assert.equal(await page.locator('.completion-notice').evaluate(element => element.classList.contains('completion-earned')), false);
  assert.equal(await page.locator('.completion-goal-ring').textContent(), '1/3');
  assert.match(await page.locator('.completion-continue').textContent(), /Repetir/);
  result.checks.push('Uma nota incorreta derruba a sequência; completar as repetições com somente 1/3 pede consolidação e não comemora uma meta inexistente.');

  await openHub();
  await page.locator('#song-view [data-path="rhythm:right"]').dispatchEvent('click');
  await waitFor(() => page.locator('#mode').inputValue().then(value => value === 'rhythm'), 'Selecionar percurso Ritmo');
  assert.equal(await page.locator('#speed').inputValue(), '90');
  assert.equal((await journey()).task.start, 0); assert.equal((await journey()).task.end, 2);
  assert.equal(await page.locator('#practice-tools').getAttribute('open'), null);
  await pause(); await openHub();
  result.checks.push('Escolher Ritmo usa 90% e conserva o trecho atual, oferecendo um desafio adaptado sem reiniciar a música inteira.');

  const stateBeforeProfile = await journey();
  await chooseProfile(profileB);
  assert.equal(await page.locator('.song-hub-progress-value strong').textContent(), '0');
  assert.match(await page.locator('.song-hub-task-meta').textContent(), /60%/);
  assert.match(await page.locator('.song-hub-goal').getAttribute('aria-label'), /0 de 3/);
  await chooseProfile(profileA);
  assert.equal((await journey()).task.id, stateBeforeProfile.task.id);
  assert.match(await page.locator('.song-hub-task-meta').textContent(), /90%/);
  assert.equal(Number(await page.locator('.song-hub-progress-value strong').textContent()), progress);
  result.checks.push('Trocar de perfil inicia uma jornada separada; retornar recupera o desafio e os pontos do perfil anterior.');

  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('save-file');
    ipcMain.handle('save-file', (_event, payload) => { globalThis.qaLearningBackup = payload; return true; });
  });
  await click('#settings-button'); await click('#backup');
  await waitFor(() => app.evaluate(() => !!globalThis.qaLearningBackup), 'Exportar projeto com a jornada');
  const backup = await app.evaluate(() => JSON.parse(Buffer.from(globalThis.qaLearningBackup.data).toString('utf8')));
  assert.ok(backup.learningJourneys); assert.ok(Object.values(backup.learningJourneys).some(item => item.task?.id === stateBeforeProfile.task.id));
  await page.locator('#settings .dialog-heading button').dispatchEvent('click');
  const modified = structuredClone(song); modified.notes[0].midi += 1;
  const changedFile = new URL('qa-learning-flow-changed.json', output);
  await writeFile(changedFile, JSON.stringify({ pianocraft: 1, songs: [modified], learningJourneys: backup.learningJourneys, achievementLedgers: backup.achievementLedgers }));
  await page.locator('#file-input').setInputFiles(fileURLToPath(changedFile));
  await waitFor(async () => (await storedSong()).notes[0].midi === modified.notes[0].midi, 'Importar o arranjo alterado');
  await waitFor(() => page.locator('.song-hub-progress-value strong').textContent().then(value => value === '0'), 'Atualizar a música aberta após importar o arranjo');
  await openHub();
  assert.equal(await page.locator('.song-hub-progress-value strong').textContent(), '0');
  assert.match(await page.locator('.song-hub-task-meta').textContent(), /60%/);
  const backupFile = new URL('qa-learning-flow-backup.json', output);
  await writeFile(backupFile, JSON.stringify(backup));
  await page.locator('#file-input').setInputFiles(fileURLToPath(backupFile));
  await waitFor(async () => (await storedSong()).notes[0].midi === song.notes[0].midi, 'Restaurar o projeto original');
  await waitFor(() => page.locator('.song-hub-task-meta').textContent().then(value => value.includes('90%')), 'Restaurar a tarefa da música aberta');
  await openHub();
  assert.match(await page.locator('.song-hub-task-meta').textContent(), /90%/);
  assert.equal(Number(await page.locator('.song-hub-progress-value strong').textContent()), progress);
  assert.equal(await page.locator('.completion-notice').isVisible(), false);
  result.checks.push('Exportar inclui a jornada; um arranjo alterado não herda pontos ou tarefa antigos. Restaurar o projeto original recupera o estudo sem novas comemorações.');

  assert.deepEqual(errors, []);
  result.progress = progress; result.completedAttempts = (await history()).filter(row => row.songId === song.id && row.completed).length;
  await writeFile(new URL('qa-learning-flow.json', output), JSON.stringify(result, null, 2));
  await writeFile(new URL(executablePath ? 'qa-learning-flow-package.json' : 'qa-learning-flow-source.json', output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(new URL('qa-learning-flow-failure.json', output), JSON.stringify({ ...result, failure: error.message }, null, 2));
  if (page) {
    await capture('learning-flow-failure.png').catch(() => {});
    console.error(await page.evaluate(() => ({ mode: document.querySelector('#mode')?.value, hands: document.querySelector('#hands')?.value, speed: document.querySelector('#speed')?.value,
      play: document.querySelector('#play')?.textContent, mission: document.querySelector('#practice-mission')?.textContent, countdown: document.querySelector('#practice-countdown')?.textContent,
      notice: document.querySelector('.completion-notice')?.textContent, notices: window.qaNotices, hits: document.querySelector('#hits')?.textContent,
      errors: document.querySelector('#errors')?.textContent, toast: document.querySelector('#toast')?.textContent })).catch(() => ({})));
  }
  throw error;
} finally { await app.close(); }
