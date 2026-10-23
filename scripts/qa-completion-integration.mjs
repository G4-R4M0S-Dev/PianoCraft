import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeSong } from '../src/music/midi.js';
import { analyzePatterns } from '../src/music/patterns.js';

const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
const song = normalizeSong({ id: 'qa-completion-song', title: 'QA · conquistas e conclusão', tempo: 120, duration: 6,
  tracks: [{ id: 0, name: 'Melodia', channel: 0, program: 0 }],
  timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
  configs: { 0: { hand: 'right', role: 'learn', volume: 1 } },
  notes: Array.from({ length: 12 }, (_, i) => ({ midi: [60, 62, 64, 65, 64, 62][i % 6], time: i * .5, duration: .25, keyDuration: .25, velocity: .8, track: 0, channel: 0, hand: 'right' })),
});
song.phrasing = { ...analyzePatterns(song, { phrases: [{ id: 'qa-a', name: 'Desenho A', start: 0, end: 3 }, { id: 'qa-a-return', name: 'Desenho A · retorno', start: 3, end: 6 }] }), reviewed: true };
const fixture = new URL('qa-completion-project.json', output);
await writeFile(fixture, JSON.stringify({ pianocraft: 1, songs: [song] }));
const env = { ...process.env, PIANOCRAFT_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2];
const app = await electron.launch(executablePath ? { executablePath, args: ['--smoke'], env } : { args: ['.', '--smoke'], env });
const result = { runtime: executablePath || 'source', clockInstalledBeforeLoad: true, hardwareIsolated: true, checks: [] }, errors = [];
let page;
const capture = async filename => {
  // The native capture does not wait for a fake requestAnimationFrame clock.
  const window = await app.browserWindow(page);
  const bytes = await window.evaluate(async win => (await win.webContents.capturePage()).toPNG().toString('base64'));
  await writeFile(new URL(filename, output), Buffer.from(bytes, 'base64'));
};
try {
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const saved = JSON.parse(localStorage.getItem('pc-settings') || '{}');
    localStorage.setItem('pc-settings', JSON.stringify({ ...saved, profile: saved.profile?.startsWith('QA Conclusão') ? saved.profile : 'QA Conclusão A', midiAutoConnect: true,
      midiInputId: 'qa-completion-input', midiOutputId: '', guideEnabled: false, practiceCountInBars: 1, practiceRestSeconds: 1, celebrationSound: true }));
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => {
      if (window.qaMidiAccess) return window.qaMidiAccess;
      const access = new EventTarget(); access.sysexEnabled = false;
      class Port extends EventTarget {
        constructor() { super(); Object.assign(this, { id: 'qa-completion-input', type: 'input', name: 'QA keyboard', manufacturer: 'PianoCraft QA', state: 'connected', connection: 'closed' }); }
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
  const click = selector => page.locator(selector).dispatchEvent('click');
  const state = () => page.evaluate(() => ({
    play: document.querySelector('#play').textContent, countHidden: document.querySelector('#practice-countdown').hidden,
    phase: document.querySelector('#practice-countdown').dataset.phase, time: window.qaMusicTime,
    hits: Number(document.querySelector('#hits').textContent), errors: Number(document.querySelector('#errors').textContent),
    mode: document.querySelector('#mode').value, hands: document.querySelector('#hands').value,
    exerciseCompleted: document.querySelector('#study-exercise').dataset.completed,
    remaining: document.querySelector('#study-exercise-title').textContent,
    notice: document.querySelector('.completion-notice')?.hidden ? null : document.querySelector('.completion-notice')?.textContent,
    notices: window.qaNotices?.length, chimes: window.qaChimes?.length, practiceNotes: window.qaPractice?.notes?.length,
  }));
  const waitFor = async (predicate, label, maxMs = 30_000, step = 32) => {
    for (let elapsed = 0; elapsed <= maxMs; elapsed += step) { if (await predicate()) return; await page.clock.runFor(step); }
    throw new Error(`${label}: ${JSON.stringify(await state())}`);
  };
  const pause = async () => { if ((await page.locator('#play').textContent()).trim() === 'Ⅱ') await click('#play'); };
  const clearNotice = () => page.evaluate(() => { if (document.querySelector('.completion-notice:not([hidden])')) document.querySelector('.completion-close').click(); });
  const notices = () => page.evaluate(() => qaNotices);
  const summary = async (profile = 'QA Conclusão A') => page.evaluate(async ({ url, song, profile, ledgers }) => {
    const { summarizeAchievements, achievementContentKey } = await import(url);
    const ledger = ledgers?.[JSON.stringify([profile, song.id, achievementContentKey(song)])];
    return summarizeAchievements(song, [], { profile, ledger });
  }, { url: new URL('music/achievements.js', page.url()).href, song: await storedSong(), profile, ledgers: await stored('achievement-ledgers') });
  const pathScore = async (path, profile) => (await summary(profile)).tracks.find(track => track.id === path)?.score;
  const hook = () => page.evaluate(async urls => {
    const { PracticeSession } = await import(urls.practice), { CompletionNotice } = await import(urls.completion), { AudioEngine } = await import(urls.audio);
    window.qaNotices = []; window.qaChimes = []; window.qaMusicTime = 0; window.qaPractice = null;
    const gate = PracticeSession.prototype.gate;
    PracticeSession.prototype.gate = function(time) { window.qaPractice = this; const value = gate.call(this, time); window.qaMusicTime = value; return value; };
    const show = CompletionNotice.prototype.show;
    CompletionNotice.prototype.show = function(input, options) { const accepted = show.call(this, input, options); if (accepted) qaNotices.push({ ...structuredClone(input), compact: !!options?.compact, at: performance.now() }); return accepted; };
    if (typeof AudioEngine.prototype.completionChime === 'function') {
      const chime = AudioEngine.prototype.completionChime;
      AudioEngine.prototype.completionChime = function(...args) { qaChimes.push({ at: performance.now() }); return chime.apply(this, args); };
      window.qaChimeInstrumented = true;
    }
  }, { practice: new URL('music/practice.js', page.url()).href, completion: new URL('completion.js', page.url()).href, audio: new URL('music/audio.js', page.url()).href });
  const chooseProfile = async name => {
    await pause(); await click('#settings-button');
    await page.locator('#profile').fill(name); await page.locator('#profile').dispatchEvent('change');
    await page.locator('#settings .dialog-heading button').dispatchEvent('click');
  };
  const choosePath = async (mode, hands) => {
    await clearNotice();
    const host = page.locator('#achievements-host');
    await host.locator('details').evaluate(element => { element.open = true; });
    await host.locator(`[data-path="${mode}:${hands}"]`).dispatchEvent('click');
    await waitFor(() => page.locator('#mode').inputValue().then(value => value === mode), 'O percurso deve aplicar o modo');
    assert.equal(await page.locator('#hands').inputValue(), hands);
    if ((await page.locator('#play').textContent()).trim() !== 'Ⅱ') await click('#play');
  };
  const completePass = async (expectedNotes, label) => {
    await waitFor(async () => {
      const status = await state(); return status.play.trim() === 'Ⅱ' && status.countHidden && status.practiceNotes === expectedNotes && status.hits === 0;
    }, `${label}: início da execução`);
    const notes = await page.evaluate(() => qaPractice.notes.map(note => ({ time: note.time, midi: note.midi, duration: note.keyDuration ?? note.duration })));
    const speed = Number(await page.locator('#speed').inputValue()) / 100;
    const previousCompleted = (await history()).filter(row => row.songId === song.id && row.completed).length;
    for (const [index, note] of notes.entries()) {
      await waitFor(() => page.evaluate(target => qaMusicTime >= target - .000001, note.time), `${label}: chegada da nota ${index + 1}`);
      await page.evaluate(pitch => qaSendMidi([0x90, pitch, 100]), note.midi);
      await page.clock.runFor(Math.max(180, note.duration / speed * 1000 + 30));
      await page.evaluate(pitch => qaSendMidi([0x80, pitch, 0]), note.midi);
      assert.equal(Number(await page.locator('#hits').textContent()), index + 1, `${label}: a nota ${index + 1} deve ser acertada`);
    }
    await waitFor(async () => (await history()).filter(row => row.songId === song.id && row.completed).length > previousCompleted, `${label}: conclusão persistida`);
  };

  await hook();
  await page.locator('#file-input').setInputFiles(fileURLToPath(fixture));
  await waitFor(() => page.locator(`[data-song="${song.id}"]`).count().then(value => value === 1), 'Importação do projeto');
  await click(`[data-song="${song.id}"] .open-song`);
  await waitFor(() => page.locator('#instrument-status').textContent().then(value => /aberta/i.test(value)), 'Entrada MIDI simulada aberta');
  const saved = await storedSong();
  const plan = await page.evaluate(async ({ url, song }) => (await import(url)).buildStudyPlan(song, song.phrasing, { profile: 'QA Conclusão A', history: [], sessionMinutes: 20 }), { url: new URL('music/study-plan.js', page.url()).href, song: saved });
  const listening = plan.exercises.find(exercise => exercise.type === 'identify');
  const right = plan.exercises.find(exercise => exercise.mode === 'melody' && exercise.hands === 'right');
  assert.ok(listening && right); assert.equal(listening.repeatCount, 2); assert.equal(right.repeatCount, 3);
  const startExercise = async exercise => {
    await clearNotice(); await click('.study-open'); await click('[data-tab="plan"]');
    const card = page.locator(`.study-exercise[data-exercise-id="${exercise.id}"]`).first();
    await card.evaluate(element => { element.closest('details').open = true; });
    await card.locator('.study-start-exercise').dispatchEvent('click');
    await waitFor(() => page.locator('.study-dialog').evaluate(element => !element.open), 'O exercício deve fechar o plano');
  };

  await startExercise(listening);
  await waitFor(() => page.locator('#study-exercise').getAttribute('data-completed').then(value => value === 'true'), 'Escuta das duas repetições');
  await waitFor(() => page.locator('.completion-notice:not([hidden])').count().then(value => value === 1), 'Aviso de escuta concluída');
  assert.equal(await page.locator('.completion-gain').count(), 0);
  assert.equal(await page.locator('.completion-accuracy').count(), 0);
  assert.equal(await pathScore('melody:both'), null);
  assert.equal((await history()).filter(row => row.songId === song.id).length, 0);
  assert.equal((await notices()).filter(notice => !notice.compact).length, 1);
  assert.equal(await page.evaluate(() => qaChimes.length), 1, 'A tarefa de escuta deve soar uma única conclusão.');
  result.checks.push('Escuta de duas repetições produz um aviso final de tarefa concluída, sem pontos, precisão ou prática tocada fictícios.');

  await startExercise(right);
  await page.locator('#roll').evaluate(element => { element.tabIndex = 0; element.focus(); });
  await completePass(6, 'Primeira repetição do exercício');
  await waitFor(async () => await pathScore('melody:right') === 50, 'Os 50 pontos da primeira metade devem persistir');
  const intermediate = (await notices()).at(-1);
  assert.equal(intermediate.compact, true); assert.equal(intermediate.gain, 50);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'roll');
  assert.equal(await page.locator('#practice-countdown').isVisible(), true);
  await completePass(6, 'Segunda repetição do exercício');
  await completePass(6, 'Terceira repetição do exercício');
  await waitFor(() => page.locator('.completion-notice:not([hidden]):not(.completion-compact)').count().then(value => value === 1), 'Resumo final do exercício');
  assert.equal(await pathScore('melody:right'), 50);
  assert.equal((await notices()).filter(notice => !notice.compact).length, 2);
  assert.equal(await page.evaluate(() => qaChimes.length), 2, 'As repetições intermediárias não devem tocar uma comemoração a cada loop.');
  result.checks.push('A primeira repetição ganha 50 pontos uma vez; aviso compacto conserva foco e preparação; as três voltas fecham em um único resumo final.');

  await startExercise(right);
  for (let i = 0; i < 3; i++) await completePass(6, `Revisão já pontuada ${i + 1}`);
  await waitFor(() => page.locator('.completion-notice:not([hidden]):not(.completion-compact)').count().then(value => value === 1), 'Resumo da revisão');
  assert.equal(await page.locator('.completion-gain').count(), 0);
  assert.equal(await pathScore('melody:right'), 50);
  result.checks.push('Repetir o mesmo exercício conclui a tarefa de novo, preservando a pontuação sem premiar pontos duplicados.');

  await choosePath('melody', 'both');
  await completePass(12, 'Melodia da música inteira');
  await waitFor(() => page.locator('.completion-gain').textContent().then(value => value?.includes('+100')), 'Ganho do percurso da música inteira');
  assert.equal(await pathScore('melody:both'), 100);
  assert.equal(await page.locator('#achievements-host [data-path="melody:both"] .achievement-value strong').textContent(), '100');
  assert.equal(await page.locator('#achievements-host [data-path="melody:both"]').getAttribute('data-state'), 'complete');
  const finalNotice = (await notices()).at(-1);
  assert.equal(finalNotice.compact, false); assert.ok(finalNotice.milestones.length > 0);
  assert.equal(await page.evaluate(() => qaChimes.length), 4, 'Cada tarefa finalizada deve tocar somente uma comemoração.');
  // Windows can return an old compositor frame for the packaged binary while
  // virtual time is paused. Component/source captures provide the visual QA.
  if (!executablePath) await page.screenshot({ path: fileURLToPath(new URL('completion-integrated.png', output)), animations: 'disabled' }).catch(() => {});
  const chimes = await page.evaluate(() => qaChimes.length);
  await page.clock.runFor(1000); assert.equal(await page.evaluate(() => qaChimes.length), chimes);
  result.checks.push('Concluir todas as notas registra 100 pontos no percurso e metas novas, atualiza a matriz e celebra uma única vez.');

  await page.locator('.completion-progress').dispatchEvent('click');
  await waitFor(() => page.locator('#progress-view').isVisible(), 'Botão Ver progresso');
  assert.equal(await page.locator('.completion-notice').isVisible(), false);
  await click(`[data-view="studio"]`);
  await choosePath('melody', 'both'); await completePass(12, 'Revisão da música inteira');
  await waitFor(() => page.locator('.completion-notice:not([hidden]):not(.completion-compact)').count().then(value => value === 1), 'Conclusão sem novos pontos');
  assert.equal(await page.locator('.completion-gain').count(), 0);
  await page.locator('.completion-replay').dispatchEvent('click');
  await waitFor(() => page.locator('#play').textContent().then(value => value.trim() === 'Ⅱ'), 'Botão praticar novamente');
  assert.equal(await page.locator('#mode').inputValue(), 'melody'); assert.equal(await page.locator('#hands').inputValue(), 'both');
  const countBeforePartial = (await notices()).length;
  await page.clock.runFor(1200); await pause(); await click(`[data-view="library"]`);
  await page.clock.runFor(200);
  assert.equal((await notices()).length, countBeforePartial);
  assert.equal(await pathScore('melody:both'), 100);
  result.checks.push('Ver progresso e Praticar novamente atuam no contexto correto; uma pausa parcial não produz comemoração nem novos pontos.');

  await click(`[data-song="${song.id}"] .open-song`);
  await click('.study-open'); await click('[data-tab="structure"]');
  await page.locator('.study-occurrence').first().locator('button').filter({ hasText: 'Ouvir' }).first().dispatchEvent('click');
  await page.clock.runFor(5000);
  assert.equal((await notices()).length, countBeforePartial);
  await click('.study-close');
  result.checks.push('A prévia para revisar uma frase não registra exercício, pontuação ou celebração.');

  const ledgerBefore = await stored('achievement-ledgers');
  await page.reload(); await page.waitForSelector('.song-card'); await hook();
  await click(`[data-song="${song.id}"] .open-song`);
  assert.equal(await pathScore('melody:right'), 50); assert.equal(await pathScore('melody:both'), 100);
  assert.equal(await page.locator('.completion-notice').isVisible(), false);
  await chooseProfile('QA Conclusão B');
  assert.equal(await pathScore('melody:both', 'QA Conclusão B'), null);
  assert.equal(await page.locator('#achievements-host [data-path="melody:both"] .achievement-value strong').textContent(), '—');
  await chooseProfile('QA Conclusão A');
  assert.equal(await pathScore('melody:both'), 100);
  assert.deepEqual(await stored('achievement-ledgers'), ledgerBefore);
  result.checks.push('O ledger persiste após recarregar, é separado por perfil e não dispara celebrações ao reabrir resultados antigos.');

  await click('#settings-button'); await page.locator('#celebration-sound').uncheck();
  await page.locator('#settings .dialog-heading button').dispatchEvent('click');
  const beforeMuted = await page.evaluate(() => qaChimes.length);
  await choosePath('melody', 'both'); await completePass(12, 'Conclusão com som desativado');
  await waitFor(() => page.locator('.completion-notice:not([hidden]):not(.completion-compact)').count().then(value => value === 1), 'Aviso visual sem som');
  assert.equal(await page.evaluate(() => qaChimes.length), beforeMuted);
  result.checks.push('Desativar o som mantém a comemoração visual e impede o chime de conclusão.');

  await clearNotice();
  await page.evaluate(async url => {
    const { AudioEngine } = await import(url), init = AudioEngine.prototype.init;
    AudioEngine.prototype.init = function(...args) {
      return new Promise(resolve => { window.qaReleaseSlowAudio = async () => { AudioEngine.prototype.init = init; resolve(await init.apply(this, args)); }; });
    };
  }, new URL('music/audio.js', page.url()).href);
  await page.locator('#achievements-host details').evaluate(element => { element.open = true; });
  await page.locator('#achievements-host [data-path="melody:both"]').dispatchEvent('click');
  await waitFor(() => page.evaluate(() => typeof window.qaReleaseSlowAudio === 'function'), 'Inicialização de áudio adiada pelo teste');
  await click('[data-view="library"]');
  await page.evaluate(() => qaReleaseSlowAudio()); await page.clock.runFor(500);
  assert.equal((await page.locator('#play').textContent()).trim(), '▶');
  assert.equal(await page.locator('#library-view').isVisible(), true);
  assert.equal(await page.locator('.completion-notice').isVisible(), false);
  result.checks.push('Navegar à biblioteca durante uma inicialização de áudio lenta cancela o início pendente e impede reprodução em segundo plano.');

  result.earned = { melodyRight: await pathScore('melody:right'), melodyBoth: await pathScore('melody:both') };
  result.completionChimeInstrumented = await page.evaluate(() => !!window.qaChimeInstrumented);
  assert.deepEqual(errors, []);
  await writeFile(new URL('completion-integration.json', output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (page) {
    await capture('completion-integration-failure.png').catch(() => {});
    console.error(await page.evaluate(() => ({ mode: document.querySelector('#mode')?.value, hands: document.querySelector('#hands')?.value, play: document.querySelector('#play')?.textContent,
      exercise: document.querySelector('#study-exercise')?.textContent, countdown: document.querySelector('#practice-countdown')?.textContent,
      notice: document.querySelector('.completion-notice')?.textContent, notices: window.qaNotices, hits: document.querySelector('#hits')?.textContent,
      errors: document.querySelector('#errors')?.textContent, toast: document.querySelector('#toast')?.textContent })).catch(() => ({})));
  }
  throw error;
} finally { await app.close(); }
