import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeSong } from '../src/music/midi.js';
import { achievementContentKey, evaluateAchievementAttempt, summarizeAchievements } from '../src/music/achievements.js';

const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
const profile = 'QA Backup A', secondProfile = 'QA Backup B';
const song = normalizeSong({ id: 'qa-achievement-backup', title: 'QA · restauração de conquistas', tempo: 120, duration: 8,
  tracks: [{ id: 0, name: 'Piano', program: 0, channel: 0 }],
  timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
  notes: Array.from({ length: 16 }, (_, index) => ({ id: `n${index}`, time: index / 2, duration: .25, keyDuration: .25,
    midi: index % 2 ? 64 : 48, track: 0, channel: 0, velocity: .8, hand: index % 2 ? 'right' : 'left' })) });
const key = (owner = profile, piece = song) => JSON.stringify([owner, piece.id, achievementContentKey(piece)]);
const row = (id, start, end, owner = profile) => ({ id, attemptId: id, songId: song.id, title: song.title, profile: owner,
  date: '2026-10-22T19:00:00Z', mode: 'rhythm', hands: 'both', start, end, seconds: end - start,
  hits: (end - start) * 2, missed: 0, errors: 0, accuracy: 100, expectedNotes: (end - start) * 2,
  completed: true, speed: 1, transpose: 0, scopeComplete: true, fullArrangement: true,
  songContentKey: achievementContentKey(song), practiceSessionId: id, position: end });
const ledger = attempt => evaluateAchievementAttempt(song, null, attempt, { profile: attempt.profile }).ledger;
const firstRow = row('backup-first-half', 0, 4), weakerRow = row('backup-weaker-quarter', 0, 2), secondRow = row('backup-second-half', 4, 8);
const firstLedger = ledger(firstRow), weakerLedger = ledger(weakerRow), secondLedger = ledger(secondRow);
const fixtures = {
  initial: { pianocraft: 1, songs: [song], history: [firstRow], settings: { profile, celebrationSound: false }, achievementLedgers: { [key()]: firstLedger } },
  weaker: { pianocraft: 1, songs: [song], history: [weakerRow], achievementLedgers: { [key()]: weakerLedger } },
  complement: { pianocraft: 1, songs: [song], history: [secondRow], achievementLedgers: { [key()]: secondLedger } },
  isolation: { pianocraft: 1, songs: [song], achievementLedgers: {
    wrongSong: { ...firstLedger, songId: 'not-in-library' },
    wrongContent: { ...firstLedger, contentKey: 'outdated-content' },
    invalidProfile: { ...firstLedger, profile: 'x'.repeat(41) },
    otherProfile: ledger(row('backup-other-profile', 0, 2, secondProfile)),
  } },
};
const paths = {};
for (const [name, value] of Object.entries(fixtures)) {
  const path = new URL(`qa-achievement-backup-${name}.json`, output);
  await writeFile(path, JSON.stringify(value)); paths[name] = fileURLToPath(path);
}
const env = { ...process.env, PIANOCRAFT_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2];
const app = await electron.launch(executablePath ? { executablePath, args: ['--smoke'], env } : { args: ['.', '--smoke'], env });
const result = { runtime: executablePath || 'source', hardwareIsolated: true, checks: [] }, errors = [];
let page;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const saved = JSON.parse(localStorage.getItem('pc-settings') || '{}');
    localStorage.setItem('pc-settings', JSON.stringify({ ...saved, midiAutoConnect: false, midiInputId: '', midiOutputId: '', guideEnabled: false }));
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => {
      const access = new EventTarget(); access.inputs = new Map(); access.outputs = new Map(); return access;
    } });
  });
  await page.reload(); await page.waitForSelector('.song-card');
  const urls = { storage: new URL('storage.js', page.url()).href, completion: new URL('completion.js', page.url()).href, audio: new URL('music/audio.js', page.url()).href };
  const hook = () => page.evaluate(async urls => {
    const { CompletionNotice } = await import(urls.completion), { AudioEngine } = await import(urls.audio);
    window.qaNotices = 0; window.qaChimes = 0; window.qaImportDone = null;
    const show = CompletionNotice.prototype.show, chime = AudioEngine.prototype.completionChime;
    CompletionNotice.prototype.show = function(...args) { qaNotices++; return show.apply(this, args); };
    AudioEngine.prototype.completionChime = function(...args) { qaChimes++; return chime.apply(this, args); };
    const input = document.querySelector('#file-input'), original = input.onchange;
    input.onchange = function(event) { window.qaImportDone = Promise.resolve(original.call(this, event)); return qaImportDone; };
  }, urls);
  await hook();
  const stored = name => page.evaluate(async ({ url, name }) => (await import(url)).getStored(name), { url: urls.storage, name });
  const currentScore = async (owner = profile) => {
    const ledgers = await stored('achievement-ledgers');
    return summarizeAchievements(song, [], { profile: owner, ledger: ledgers?.[key(owner)] }).tracks.find(track => track.id === 'rhythm:both').score;
  };
  const importProject = async name => {
    await page.locator('#file-input').setInputFiles(paths[name]);
    await page.evaluate(() => qaImportDone);
    await page.waitForSelector(`[data-song="${song.id}"]`);
    assert.equal(await page.evaluate(() => qaNotices), 0, `${name}: importing must not call a completion notice`);
    assert.equal(await page.evaluate(() => qaChimes), 0, `${name}: importing must not call a chime`);
    assert.equal(await page.locator('.completion-notice').isVisible(), false);
  };

  await importProject('initial'); assert.equal(await currentScore(), 50);
  assert.ok((await stored('practice-history')).some(item => item.id === firstRow.id && item.songContentKey === achievementContentKey(song)));
  assert.equal(await page.locator('#celebration-sound').isChecked(), false);
  result.checks.push('O projeto restaura ledger e tentativa da primeira metade com 50 pontos e o som desativado, sem anunciar uma nova conquista.');

  await importProject('weaker'); assert.equal(await currentScore(), 50);
  result.checks.push('Restaurar um backup anterior de 25 pontos preserva os 50 pontos já adquiridos.');

  await importProject('complement'); assert.equal(await currentScore(), 100);
  const completeLedger = (await stored('achievement-ledgers'))[key()];
  result.checks.push('Um backup complementar da outra metade une as evidências para 100 pontos, sem duplicação.');

  await importProject('isolation'); assert.equal(await currentScore(), 100); assert.equal(await currentScore(secondProfile), 25);
  const isolated = await stored('achievement-ledgers');
  assert.ok(!Object.values(isolated).some(item => item.songId === 'not-in-library' || item.contentKey === 'outdated-content' || item.profile.length > 40));
  assert.deepEqual(isolated[key()], completeLedger);
  result.checks.push('Música inexistente, conteúdo antigo e perfil inválido são rejeitados; outro perfil conserva seus 25 pontos separados.');

  await page.locator(`[data-song="${song.id}"] .open-song`).dispatchEvent('click');
  await page.locator('#achievements-host details').evaluate(element => { element.open = true; });
  assert.equal(await page.locator('#achievements-host [data-path="rhythm:both"] .achievement-value strong').textContent(), '100');
  assert.equal(await page.locator('.completion-notice').isVisible(), false);
  result.checks.push('Abrir a música mostra 100 pontos no percurso restaurado, sem comemorar o histórico antigo.');

  await app.evaluate(({ ipcMain }) => {
    globalThis.qaAchievementExports = [];
    ipcMain.removeHandler('save-file');
    ipcMain.handle('save-file', (_event, value) => { globalThis.qaAchievementExports.push(value); return { saved: true }; });
  });
  await page.locator('#settings-button').dispatchEvent('click');
  await page.locator('#backup').dispatchEvent('click');
  let exports;
  for (let index = 0; index < 80; index++) {
    exports = await app.evaluate(() => globalThis.qaAchievementExports);
    if (exports.length) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(exports.length, 1);
  const project = JSON.parse(new TextDecoder().decode(new Uint8Array(exports[0].data)));
  assert.equal(project.pianocraft, 1); assert.equal(project.settings.celebrationSound, false);
  assert.deepEqual(project.achievementLedgers[key()], completeLedger);
  assert.equal(summarizeAchievements(song, [], { profile: secondProfile, ledger: project.achievementLedgers[key(secondProfile)] }).tracks.find(track => track.id === 'rhythm:both').score, 25);
  result.checks.push('O botão Exportar projeto inclui os ledgers de ambos os perfis e a preferência de som no JSON real enviado ao desktop.');

  await page.reload(); await page.waitForSelector('.song-card'); await hook();
  await page.locator(`[data-song="${song.id}"] .open-song`).dispatchEvent('click');
  assert.equal(await currentScore(), 100); assert.equal(await currentScore(secondProfile), 25);
  assert.deepEqual((await stored('achievement-ledgers'))[key()], completeLedger);
  assert.equal(await page.locator('#celebration-sound').isChecked(), false);
  assert.equal(await page.evaluate(() => qaNotices), 0); assert.equal(await page.evaluate(() => qaChimes), 0);
  result.checks.push('Após recarregar, os 100 pontos, o perfil separado e o som desativado persistem, sem novo alerta.');
  assert.deepEqual(errors, []);
  result.finalScores = { [profile]: await currentScore(), [secondProfile]: await currentScore(secondProfile) };
  await writeFile(new URL('achievement-backup.json', output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: fileURLToPath(new URL('achievement-backup-failure.png', output)) }).catch(() => {});
  throw error;
} finally { await app.close(); }
