import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeSong } from '../src/music/midi.js';
import { analyzePatterns } from '../src/music/patterns.js';
import { achievementContentKey } from '../src/music/achievements.js';
import { createJourneyTask, normalizeJourneyState } from '../src/music/learning-journey.js';

const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
const prefix = `QA Prática simples ${process.pid}`;
const profileA = `${prefix} A`, profileB = `${prefix} B`;
const makeSong = (id, title, midiOffset = 0) => {
  const song = normalizeSong({ id, title, tempo: 120, duration: 6,
    tracks: [{ id: 0, name: 'Melodia', channel: 0, program: 0 }],
    configs: { 0: { hand: 'right', role: 'learn', volume: 1 } },
    timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
    notes: [0.25, 1.25, 3.25, 4.25].map((time, index) => ({ id: `${id}-${index}`, midi: 60 + midiOffset + index % 2 * 2,
      time, duration: .2, keyDuration: .2, velocity: .8, track: 0, channel: 0, hand: 'right' })),
  });
  song.phrasing = { ...analyzePatterns(song, { phrases: [{ id: 'first', name: 'Primeira frase', start: 0, end: 3 },
    { id: 'second', name: 'Segunda frase', start: 3, end: 6 }] }), reviewed: true };
  // A legacy saved phrase loop must never silently become the whole-song scope.
  song.userPractice = { a: 0, b: 3, loop: true };
  return song;
};
const songA = makeSong('qa-simple-practice-a', 'QA · prática simples A');
const songB = makeSong('qa-simple-practice-b', 'QA · prática simples B', 4);
const journeyKey = JSON.stringify([profileA, songA.id, achievementContentKey(songA)]);
const initialJourney = normalizeJourneyState({ ...normalizeJourneyState(null, songA, { profile: profileA }),
  task: createJourneyTask(songA, { profile: profileA, speed: .7, start: 0, end: 3, hands: 'right' }),
  started: true, startedAt: '2026-10-23T12:00:00Z', updatedAt: '2026-10-23T12:00:00Z' }, songA, { profile: profileA });
const fixture = new URL(`qa-simple-practice-project-${process.pid}.json`, output);
await writeFile(fixture, JSON.stringify({ pianocraft: 1, songs: [songA, songB], learningJourneys: { [journeyKey]: initialJourney } }));
const env = { ...process.env, PIANOCRAFT_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2], tag = executablePath ? 'package' : 'source';
const app = await electron.launch(executablePath ? { executablePath, args: ['--smoke'], env } : { args: ['.', '--smoke'], env });
const results = { runtime: executablePath || 'source', hardwareIsolated: true, temporaryProfile: true, checks: [], layouts: [] };
const errors = [];
let page;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ prefix, profile }) => {
    const saved = JSON.parse(localStorage.getItem('pc-settings') || '{}');
    localStorage.setItem('pc-settings', JSON.stringify({ ...saved, profile: saved.profile?.startsWith(prefix) ? saved.profile : profile,
      midiAutoConnect: true, midiInputId: 'qa-simple-input', midiOutputId: '', guideEnabled: false,
      practiceCountInBars: 0, practiceRestSeconds: 0, celebrationSound: false, focusMode: false }));
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => {
      if (window.qaMidiAccess) return window.qaMidiAccess;
      const access = new EventTarget(); access.sysexEnabled = false;
      class Port extends EventTarget {
        constructor() { super(); Object.assign(this, { id: 'qa-simple-input', type: 'input', name: 'QA keyboard', manufacturer: 'PianoCraft QA', state: 'connected', connection: 'closed' }); }
        async open() { this.connection = 'open'; return this; }
        async close() { this.connection = 'closed'; return this; }
      }
      const input = new Port(); access.inputs = new Map([[input.id, input]]); access.outputs = new Map();
      window.qaSendMidi = bytes => { const message = new Event('midimessage'); Object.assign(message, { data: new Uint8Array(bytes), receivedTime: performance.now() }); input.dispatchEvent(message); };
      window.qaMidiAccess = access; return access;
    } });
  }, { prefix, profile: profileA });
  const epoch = new Date('2026-10-23T15:00:00Z');
  await page.clock.install({ time: epoch }); await page.clock.pauseAt(new Date(+epoch + 1000));
  await page.reload(); await page.waitForSelector('.song-card');
  const click = selector => page.locator(selector).dispatchEvent('click');
  const stored = key => page.evaluate(async ({ key, url }) => (await import(url)).getStored(key), { key, url: new URL('storage.js', page.url()).href });
  const history = async () => (await stored('practice-history')) || [];
  const state = () => page.evaluate(() => ({ play: document.querySelector('#play').textContent.trim(), mode: document.querySelector('#mode').value,
    speed: document.querySelector('#speed').value, number: document.querySelector('#speed-number')?.value,
    scope: document.querySelector('#practice-scope')?.value, repeat: document.querySelector('#practice-repeat')?.getAttribute('aria-pressed'),
    mission: document.querySelector('#practice-mission')?.textContent, scopeDescription: document.querySelector('#practice-scope-description')?.textContent,
    musicTime: window.qaMusicTime, noteCount: window.qaPractice?.notes?.length, notices: window.qaNotices?.length,
    notice: document.querySelector('.completion-notice')?.hidden ? null : document.querySelector('.completion-notice')?.textContent,
    toast: document.querySelector('#toast').textContent }));
  const waitFor = async (predicate, label, maxMs = 16000, step = 32) => {
    for (let elapsed = 0; elapsed <= maxMs; elapsed += step) { if (await predicate()) return; await page.clock.runFor(step); }
    throw new Error(`${label}: ${JSON.stringify(await state())}`);
  };
  const hook = () => page.evaluate(async urls => {
    const { PracticeSession } = await import(urls.practice), { CompletionNotice } = await import(urls.completion);
    window.qaNotices = []; window.qaMusicTime = -1; window.qaPractice = null;
    const gate = PracticeSession.prototype.gate;
    PracticeSession.prototype.gate = function(time) { const next = gate.call(this, time); window.qaPractice = this; window.qaMusicTime = next; return next; };
    const show = CompletionNotice.prototype.show;
    CompletionNotice.prototype.show = function(input, options) { const shown = show.call(this, input, options); if (shown) qaNotices.push({ ...structuredClone(input), compact: !!options?.compact }); return shown; };
  }, { practice: new URL('music/practice.js', page.url()).href, completion: new URL('completion.js', page.url()).href });
  const pause = async () => { if ((await page.locator('#play').textContent()).trim() === 'Ⅱ') await click('#play'); };
  const openHub = async (song = songA) => {
    await pause(); await click('[data-view="library"]'); await click(`[data-song="${song.id}"] .open-song`);
    await waitFor(() => page.locator('#song-view').isVisible(), 'Página da música');
  };
  const openWhole = async (song = songA) => {
    await openHub(song); await click('[data-hub-action="onWholeSong"]');
    await waitFor(() => page.locator('#studio-view').isVisible(), 'Música inteira aberta');
    assert.equal(await page.locator('#practice-scope').inputValue(), 'whole');
    assert.equal(await page.locator('#practice-repeat').getAttribute('aria-pressed'), 'false');
    assert.equal((await page.locator('#play').textContent()).trim(), '▶', 'Abrir música inteira aguarda o botão Tocar');
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('guided-practice')), false);
    assert.match(await page.locator('#practice-scope-description').textContent(), /inteira/i);
    assert.equal(await page.locator('.completion-notice').isVisible(), false);
  };
  const expectSpeed = async percent => {
    assert.equal(await page.locator('#speed').inputValue(), String(percent));
    assert.equal(await page.locator('#speed-number').inputValue(), String(percent));
    assert.match(await page.locator('#speed-value').textContent(), new RegExp(`${percent}%`));
  };
  const numberSpeed = async percent => {
    await page.locator('#speed-number').fill(String(percent)); await page.locator('#speed-number').dispatchEvent('change');
    // Dispatching a navigation click does not naturally blur a focused input.
    // Commit this field before the host changes the selected song or profile.
    await page.locator('#speed-number').blur(); await expectSpeed(percent);
  };
  const chooseProfile = async profile => {
    await pause(); await click('#settings-button'); await page.locator('#profile').fill(profile); await page.locator('#profile').dispatchEvent('change');
    await page.locator('#profile').blur();
    await page.locator('#settings .dialog-heading button').dispatchEvent('click');
  };

  await hook(); await page.locator('#file-input').setInputFiles(fileURLToPath(fixture));
  await waitFor(() => page.locator(`[data-song="${songA.id}"]`).count().then(count => count === 1), 'Importação das duas músicas');
  await openWhole();
  assert.equal(await page.locator('#mode').inputValue(), 'melody');
  assert.equal(await page.locator('#practice-tools').getAttribute('open'), null);
  for (const selector of ['#practice-speed-controls', '#speed', '#speed-number', '#practice-scope', '#practice-repeat']) assert.equal(await page.locator(selector).isVisible(), true, `${selector} visível sem abrir ajustes`);
  assert.equal(await page.locator('#speed-number').getAttribute('min'), '20'); assert.equal(await page.locator('#speed-number').getAttribute('max'), '150');
  await click('#practice-repeat'); assert.equal(await page.locator('#practice-repeat').getAttribute('aria-pressed'), 'true');
  await click('#practice-repeat'); assert.equal(await page.locator('#practice-repeat').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#practice-scope').inputValue(), 'whole');
  await numberSpeed(70); await click('[data-speed="100"]'); await expectSpeed(100);
  await openWhole(); await expectSpeed(100);
  results.checks.push('Ação principal abre Melodia e música inteira parada, sem repetir; velocidade e escopo ficam visíveis, e escolher 100% persiste na próxima prática.');

  await page.reload(); await page.waitForSelector('.song-card'); await hook(); await openWhole(); await expectSpeed(100);
  results.checks.push('100% permanece após recarregar o aplicativo, sem retomar o cursor guiado legado em 70%.');
  await openWhole(songB); await numberSpeed(80); await openWhole(); await expectSpeed(100);
  await chooseProfile(profileB); await openWhole(); await numberSpeed(60); await openWhole(songB); await expectSpeed(100);
  await chooseProfile(profileA); await openWhole(songB); await expectSpeed(80); await openWhole(); await expectSpeed(100);
  results.checks.push('Velocidades são independentes por música e perfil; ajustes em outra música ou perfil não substituem os 100% escolhidos.');

  await numberSpeed(87); await page.locator('#mode').selectOption('recital'); await expectSpeed(100);
  assert.equal(await page.locator('#speed').isDisabled(), true); assert.equal(await page.locator('#speed-number').isDisabled(), true);
  await page.locator('#mode').selectOption('melody'); await expectSpeed(87);
  assert.equal(await page.locator('#speed').isDisabled(), false); await click('[data-speed="100"]');
  results.checks.push('Recital exige 100%, e voltar à Melodia restaura os 87% escolhidos sem apagar a preferência.');

  await numberSpeed(125); await openHub(); await click('[data-hub-action="onStart"]');
  await waitFor(async () => await page.locator('#studio-view').isVisible() && (await state()).play === 'Ⅱ', 'Estudo guiado em 125%');
  await expectSpeed(125); assert.equal(await page.locator('#practice-scope').inputValue(), 'portion');
  await openWhole(); await expectSpeed(125); await click('[data-speed="100"]');
  results.checks.push('A velocidade manual de 125% também permanece ao entrar no estudo guiado e voltar à música inteira.');

  await openHub(); await click('[data-hub-action="onStart"]');
  await waitFor(async () => await page.locator('#studio-view').isVisible() && (await state()).play === 'Ⅱ', 'Estudo guiado explícito');
  assert.equal(await page.locator('#practice-scope').inputValue(), 'portion');
  assert.equal(await page.locator('#practice-repeat').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('body').evaluate(body => body.classList.contains('guided-practice')), true);
  await waitFor(() => page.evaluate(() => qaPractice?.notes?.length === 2), 'Notas da primeira frase');
  const notes = await page.evaluate(() => qaPractice.notes.map(note => ({ midi: note.midi, time: note.time, duration: note.keyDuration ?? note.duration })));
  const guidedSpeed = Number(await page.locator('#speed').inputValue()) / 100;
  for (const note of notes) {
    await waitFor(() => page.evaluate(time => qaMusicTime >= time - .000001, note.time), 'Chegada da nota guiada');
    await page.evaluate(midi => qaSendMidi([0x90, midi, 100]), note.midi);
    await page.clock.runFor(note.duration / guidedSpeed * 1000 + 40);
    await page.evaluate(midi => qaSendMidi([0x80, midi, 0]), note.midi);
  }
  await waitFor(() => page.evaluate(() => qaNotices.length > 0), 'Resultado da primeira repetição guiada');
  assert.equal(await page.locator('.completion-notice').isVisible(), true);
  await openWhole(); await expectSpeed(100);
  assert.doesNotMatch(await page.locator('#mission-goal').textContent(), /execuções seguidas/);
  results.checks.push('Somente o botão de estudo guiado inicia uma frase repetida; voltar à música inteira limpa o loop, a meta e a janela de progresso, mantendo 100%.');

  // Rhythm progresses in real song time even without playing every note, so a
  // full pass can expose unintended phrase boundaries without waiting on gates.
  await page.locator('#mode').selectOption('rhythm');
  await page.evaluate(() => { qaNotices.length = 0; qaMusicTime = -1; });
  const completedBefore = (await history()).filter(row => row.songId === songA.id && row.profile === profileA && row.completed).length;
  await click('#play'); await waitFor(() => page.evaluate(() => qaMusicTime >= .25), 'Primeira nota da música inteira');
  await page.evaluate(() => qaSendMidi([0x90, 60, 100])); await page.clock.runFor(260); await page.evaluate(() => qaSendMidi([0x80, 60, 0]));
  await waitFor(() => page.evaluate(() => qaMusicTime > 3.2), 'Atravessar o limite entre as duas frases');
  assert.equal((await state()).play, 'Ⅱ'); assert.equal(await page.evaluate(() => qaNotices.length), 0);
  assert.equal(await page.locator('.completion-notice').isVisible(), false);
  await waitFor(async () => (await history()).filter(row => row.songId === songA.id && row.profile === profileA && row.completed).length > completedBefore, 'Conclusão da música inteira');
  const completed = (await history()).find(row => row.songId === songA.id && row.profile === profileA && row.completed);
  assert.equal(completed.start, 0); assert.equal(completed.end, songA.duration); assert.equal(completed.expectedNotes, 4); assert.equal(completed.journeyTaskId, undefined);
  await waitFor(() => page.evaluate(() => qaNotices.length === 1), 'Resultado único ao final');
  assert.equal((await state()).play, '▶');
  assert.equal(await page.evaluate(() => qaNotices[0].kind), 'song');
  await page.clock.runFor(1000); assert.equal(await page.evaluate(() => qaNotices.length), 1);
  await click('.completion-continue');
  await waitFor(() => page.locator('#song-view').isVisible(), 'Continuar após música inteira volta à página da música');
  assert.equal(await page.locator('body').evaluate(body => body.classList.contains('guided-practice')), false);
  results.checks.push('Execução inteira ignora o loop legado, atravessa duas frases sem aviso ou interrupção, salva as quatro notas no escopo completo e apresenta um único resultado no fim. Continuar volta à música.');

  await openWhole();
  await page.locator('#practice-tools').evaluate(element => { element.open = true; });
  await page.locator('.phrase-choice').selectOption('first');
  await waitFor(async () => (await state()).play === 'Ⅱ', 'Trecho anterior selecionado'); await pause();
  const previewState = () => page.evaluate(() => ({ phrase: document.querySelector('.phrase-choice').value,
    scope: document.querySelector('#practice-scope').value, description: document.querySelector('#practice-scope-description').textContent,
    repeat: document.querySelector('#practice-repeat').getAttribute('aria-pressed'), time: document.querySelector('#current-time').textContent,
    mode: document.querySelector('#mode').value, speed: document.querySelector('#speed').value }));
  const beforePreview = await previewState();
  assert.equal(beforePreview.phrase, 'first'); assert.equal(beforePreview.scope, 'portion');
  await page.locator('#practice-tools').evaluate(element => { element.open = true; }); await click('.phrase-organize');
  await click('.phrase-timeline-segments [data-phrase-id="second"]');
  const historyBeforePreview = (await history()).length;
  await page.evaluate(() => { qaNotices.length = 0; qaMusicTime = -1; }); await click('.phrase-preview');
  await waitFor(async () => (await state()).play === 'Ⅱ', 'Prévia da frase posterior'); await page.clock.runFor(400);
  const previewTime = await page.evaluate(() => qaMusicTime);
  assert.ok(previewTime > 3.2 && previewTime < 4, `A prévia deve começar em 0:03, depois do antigo limite B: ${previewTime}`);
  await page.clock.runFor(3000);
  assert.equal(await page.locator('.phrase-preview').textContent(), 'Ouvir frase');
  assert.equal((await state()).play, '▶'); assert.deepEqual(await previewState(), beforePreview);
  assert.equal((await history()).length, historyBeforePreview); assert.equal(await page.evaluate(() => qaNotices.length), 0);
  await click('.phrase-close');
  results.checks.push('Ouvir a frase posterior em 0:03–0:06 ignora os limites do trecho anterior em 0:00–0:03; ao terminar restaura seleção, velocidade e posição, sem histórico ou resultado artificial.');

  await openWhole();
  for (const viewport of [{ width: 1440, height: 960 }, { width: 1000, height: 720 }]) {
    await page.setViewportSize(viewport); await page.clock.runFor(64);
    const layout = await page.evaluate(() => {
      const selectors = ['#practice-speed-controls', '#speed-number', '#practice-scope', '#practice-repeat', '.transport'];
      return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
        controls: selectors.map(selector => { const box = document.querySelector(selector).getBoundingClientRect(); return { selector, x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height }; }) };
    });
    assert.ok(layout.documentWidth <= viewport.width + 1, JSON.stringify(layout));
    for (const box of layout.controls) assert.ok(box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0 && box.right <= viewport.width + 1 && box.bottom <= viewport.height + 1, JSON.stringify(layout));
    results.layouts.push(layout);
    const win = await app.browserWindow(page);
    const png = await win.evaluate(async window => (await window.webContents.capturePage()).toPNG().toString('base64'));
    await writeFile(new URL(`simple-practice-${tag}-${viewport.width}.png`, output), Buffer.from(png, 'base64'));
  }
  await openHub(); await click('[data-hub-action="onStart"]');
  await waitFor(async () => (await state()).play === 'Ⅱ', 'Missão ativa para verificar os temas'); await pause();
  await page.setViewportSize({ width: 1000, height: 720 });
  for (const theme of ['dark', 'light']) for (const focus of [false, true]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const focused = await page.locator('body').evaluate(body => body.classList.contains('practice-focus'));
    if (focused !== focus) await click('#focus-mode');
    await page.clock.runFor(64);
    const layout = await page.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
      guided: document.body.classList.contains('guided-practice'),
      controls: ['#practice-mission', '#practice-speed-controls', '#speed-number', '#practice-scope', '#practice-repeat', '.transport'].map(selector => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return { selector, x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
      }) }));
    assert.equal(layout.guided, true);
    assert.ok(layout.documentWidth <= 1001, JSON.stringify({ theme, focus, ...layout }));
    for (const box of layout.controls) assert.ok(box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0 && box.right <= 1001 && box.bottom <= 721, JSON.stringify({ theme, focus, ...layout }));
    results.layouts.push({ theme, focus, ...layout });
    const win = await app.browserWindow(page);
    const png = await win.evaluate(async window => (await window.webContents.capturePage()).toPNG().toString('base64'));
    await writeFile(new URL(`simple-practice-${tag}-${theme}-1000${focus ? '-focus' : ''}.png`, output), Buffer.from(png, 'base64'));
  }
  results.checks.push('Missão guiada ativa mantém velocidade, escopo e transporte dentro da janela de 1000×720 nos temas claro e escuro, com foco ligado e desligado.');
  assert.deepEqual(errors, []);
  await writeFile(new URL(`qa-simple-practice-${tag}.json`, output), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  if (page) console.error(JSON.stringify(await page.evaluate(() => ({ label: document.querySelector('#page-label')?.textContent,
    play: document.querySelector('#play')?.textContent, mission: document.querySelector('#practice-mission')?.textContent,
    settings: JSON.parse(localStorage.getItem('pc-settings') || '{}'),
    scope: document.querySelector('#practice-scope')?.value, repeat: document.querySelector('#practice-repeat')?.getAttribute('aria-pressed'),
    speed: document.querySelector('#speed')?.value, number: document.querySelector('#speed-number')?.value, time: window.qaMusicTime,
    notices: window.qaNotices, toast: document.querySelector('#toast')?.textContent })), null, 2));
  throw error;
} finally { await app.close(); }
