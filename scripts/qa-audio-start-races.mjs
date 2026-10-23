import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
const env = { ...process.env, PIANOCRAFT_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2];
const app = await electron.launch(executablePath ? { executablePath, args: ['--smoke'], env } : { args: ['.', '--smoke'], env });
const result = { runtime: executablePath || 'source', hardwareIsolated: true, controlledAudioInitialization: true, checks: [] }, errors = [];
let page;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('pc-settings', JSON.stringify({ profile: 'QA Audio Races', midiAutoConnect: false, midiInputId: '', midiOutputId: '',
      guideEnabled: false, practiceCountInBars: 0, practiceRestSeconds: 0 }));
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => {
      const access = new EventTarget(); access.inputs = new Map(); access.outputs = new Map(); return access;
    } });
  });
  await page.reload(); await page.waitForSelector('.song-card');
  await page.evaluate(async url => {
    const { AudioEngine } = await import(url), original = AudioEngine.prototype.init;
    window.qaPending = []; window.qaStarts = 0; window.qaBlockAudio = false;
    window.qaArmAudio = () => { window.qaPending = []; window.qaStarts = 0; window.qaBlockAudio = true; };
    AudioEngine.prototype.init = async function(...args) {
      if (qaBlockAudio) {
        const pending = { released: false, settled: false };
        pending.promise = new Promise(resolve => { pending.release = resolve; });
        qaPending.push(pending); await pending.promise;
        try { return await original.apply(this, args); } finally { pending.settled = true; }
      }
      return original.apply(this, args);
    };
    new MutationObserver(records => {
      for (const record of records) if (record.target.textContent.trim() === 'Ⅱ') qaStarts++;
    }).observe(document.querySelector('#play'), { childList: true });
  }, new URL('music/audio.js', page.url()).href);
  const click = selector => page.locator(selector).dispatchEvent('click');
  const openSong = async (index = 0) => {
    await click('[data-view="library"]');
    await page.locator('.song-card .open-song').nth(index).dispatchEvent('click');
    await page.waitForFunction(() => !document.body.classList.contains('free-piano') && !document.querySelector('#studio-view').classList.contains('hidden'));
  };
  const armAndStart = async () => {
    await page.evaluate(() => qaArmAudio()); await click('#play');
    await page.waitForFunction(() => qaPending.length === 1);
    assert.equal((await page.locator('#play').textContent()).trim(), '▶');
  };
  const release = async index => {
    await page.evaluate(index => { qaPending[index].released = true; qaPending[index].release(); }, index);
    await page.waitForFunction(index => qaPending[index]?.settled === true, index);
    // The caller's continuation follows init() by another microtask.
    await page.waitForTimeout(40);
  };
  const assertStopped = async label => {
    assert.equal((await page.locator('#play').textContent()).trim(), '▶', label);
    assert.equal(await page.evaluate(() => qaStarts), 0, `${label}: no hidden start must occur`);
  };

  await openSong(); await armAndStart(); await click('[data-view="library"]'); await release(0);
  await assertStopped('Navegação para a biblioteca cancela o pedido pendente');
  assert.equal(await page.locator('#library-view').isVisible(), true);
  result.checks.push('Navegar para a biblioteca enquanto o áudio carrega impede iniciar a reprodução ao fundo.');

  await openSong(); await armAndStart(); await click('[data-view="free"]'); await release(0);
  await assertStopped('Piano livre cancela o pedido da música anterior');
  assert.equal(await page.locator('body').evaluate(element => element.classList.contains('free-piano')), true);
  result.checks.push('Entrar no piano livre durante o carregamento descarta o pedido da música anterior.');

  await openSong(); await armAndStart(); await page.locator('#mode').selectOption('rhythm'); await release(0);
  await assertStopped('Trocar o modo invalida o pedido pendente');
  assert.equal(await page.locator('#mode').inputValue(), 'rhythm');
  result.checks.push('Trocar o modo durante o carregamento preserva o novo modo e deixa o transporte parado.');

  await openSong(); await armAndStart(); await click('#edit-notes');
  assert.equal(await page.locator('#note-editor').evaluate(element => element.open), true);
  await release(0); await assertStopped('Uma pausa explícita cancela o pedido sem depender da navegação');
  await click('#close-editor');
  result.checks.push('A pausa solicitada pelo editor cancela o início pendente, mesmo mantendo a mesma música e a mesma tela.');

  await openSong(); const previousTitle = await page.locator('#song-title').textContent(); await armAndStart();
  await openSong(1); const nextTitle = await page.locator('#song-title').textContent();
  assert.notEqual(nextTitle, previousTitle); await release(0);
  await assertStopped('Abrir outra música invalida o pedido anterior');
  assert.equal(await page.locator('#song-title').textContent(), nextTitle);
  result.checks.push('Abrir outra música descarta o pedido antigo sem iniciar a nova música por engano.');

  await openSong(); await armAndStart(); await click('#play');
  await page.waitForFunction(() => qaPending.length === 2);
  await release(0); await assertStopped('Somente o pedido mais recente pode iniciar');
  await release(1);
  await page.waitForFunction(() => document.querySelector('#play').textContent.trim() === 'Ⅱ');
  assert.equal(await page.evaluate(() => qaStarts), 1);
  await click('#play'); assert.equal((await page.locator('#play').textContent()).trim(), '▶');
  result.checks.push('Dois pedidos pendentes iniciam uma única reprodução: somente o mais recente é aceito; o botão continua pausando normalmente.');

  assert.deepEqual(errors, []);
  const name = executablePath ? 'audio-start-races-packaged.json' : 'audio-start-races-source.json';
  await writeFile(new URL(name, output), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (page) console.error(await page.evaluate(() => ({ play: document.querySelector('#play')?.textContent,
    starts: window.qaStarts, pending: window.qaPending?.map(item => ({ released: item.released, settled: item.settled })),
    title: document.querySelector('#song-title')?.textContent, mode: document.querySelector('#mode')?.value })).catch(() => ({})));
  throw error;
} finally { await app.close(); }
