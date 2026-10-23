import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const environment = { ...process.env, PIANOCRAFT_TEST: '1' }; delete environment.ELECTRON_RUN_AS_NODE;
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
const executablePath = process.argv[2];
const app = await electron.launch({ ...(executablePath ? { executablePath, args: ['--smoke'] } : { args: ['.', '--smoke'] }), env: environment });
const results = {};
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(15000); await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.song-card');
  const storageUrl = new URL('storage.js', page.url()).href;
  await page.evaluate(async storageUrl => {
    const { setStored } = await import(storageUrl);
    const profile = document.querySelector('#profile'); profile.value = 'Ana'; profile.dispatchEvent(new Event('change', { bubbles: true }));
    const song = (id, title) => ({ id, title, duration: 32, tempo: 120, ppq: 480, tracks: [{ id: 0, name: 'Piano', program: 0, channel: 0 }], notes: Array.from({ length: 32 }, (_, i) => ({ id: `${id}-${i}`, time: i, duration: .5, keyDuration: .5, midi: 60 + i % 5, channel: 0, track: 0 })), timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }] });
    const songs = [song('qa-older-high-score', 'A · música consolidada'), song('qa-recent-practice', 'B · prática recente'), song('qa-unpracticed', 'C · ainda sem prática')];
    const row = (id, extra = {}) => ({ id: `attempt-${id}`, attemptId: `attempt-${id}`, songId: songs[0].id, title: songs[0].title, profile: 'Ana', date: `2026-10-21T10:0${id}:00Z`, seconds: 32, mode: 'rhythm', hands: 'both', hits: 32, missed: 0, errors: 0, accuracy: 100, speed: 1, start: 0, end: 32, position: 32, fullArrangement: true, transpose: 0, completed: true, practiceSessionId: `visit-${id}`, errorEvents: [], ...extra });
    const events = [{ time: 10, reason: 'wrong-note', type: 'pitch', count: 2, expectedPitches: [60], midi: 61 }];
    const history = [row(0), row(1), row(2), ...[3, 4, 5].map(id => row(id, { songId: songs[1].id, title: songs[1].title, date: `2026-10-22T10:0${id}:00Z`, practiceSessionId: id < 5 ? 'recent-visit-one' : 'recent-visit-two', mode: 'melody', hits: 20, missed: 0, errors: 2, accuracy: 91, errorEvents: events })), row(6, { songId: songs[1].id, title: songs[1].title, profile: 'Bia', mode: 'melody', practiceSessionId: 'bia-visit', errorEvents: [] })];
    await setStored('songs', songs);
    await setStored('practice-history', history);
    localStorage.setItem('pc-history', JSON.stringify(history));
    localStorage.setItem('pc-settings', JSON.stringify({ profile: 'Ana', midiAutoConnect: false, midiInputId: '', guideEnabled: false, practiceCountInBars: 0, practiceRestSeconds: 0 }));
  }, storageUrl);
  await page.reload(); await page.waitForSelector('.song-card');
  await page.locator('#sort').selectOption('recent');
  assert.equal(await page.locator('.song-card').first().getAttribute('data-song'), 'qa-recent-practice', JSON.stringify(await page.evaluate(() => ({ settings: JSON.parse(localStorage.getItem('pc-settings')), history: JSON.parse(localStorage.getItem('pc-history')), cards: [...document.querySelectorAll('.song-card')].map(card => [card.dataset.song, card.textContent]) }))));
  await page.locator('#sort-direction').click(); assert.equal(await page.locator('.song-card').last().getAttribute('data-song'), 'qa-recent-practice'); await page.locator('#sort-direction').click();
  results.latestPracticeUsesSongHistoryAndDefaultDescendingOrder = true;
  await page.locator('#sort').selectOption('progress');
  const consolidated = page.locator('[data-song="qa-older-high-score"]');
  assert.equal(await page.locator('.song-card').first().getAttribute('data-song'), 'qa-older-high-score');
  assert.equal((await consolidated.locator('.song-mastery b').textContent()).replace(/\s+/g, ''), '100/100');
  assert.match(await page.locator('[data-song="qa-recent-practice"] .song-mastery').textContent(), /Sem avaliação/);
  results.libraryScoreReflectsCoverageAndConditions = true;
  await consolidated.locator('.song-progress').click();
  const panel = page.locator('#music-progress'), cardA = panel.locator('[data-song-id="qa-older-high-score"]'), cardB = panel.locator('[data-song-id="qa-recent-practice"]');
  assert.equal(await panel.locator('.music-progress-card').count(), 2); assert.notEqual(await cardA.getAttribute('open'), null);
  assert.equal(await panel.locator('.music-progress-totals .music-progress-metric').nth(1).locator('strong').textContent(), '5');
  assert.match(await panel.locator('.music-progress-totals .music-progress-metric').nth(1).textContent(), /6 tentativas/);
  assert.equal(await cardA.locator('.music-progress-session').count(), 3); assert.equal(await cardB.locator('.music-progress-session').count(), 2);
  assert.equal(await page.locator('#history').textContent(), '');
  results.oneCardPerSongAndLoopsSeparatedFromSessions = true;
  await cardB.locator(':scope > summary').click(); assert.match(await cardB.locator('.music-progress-badge').textContent(), /Recorre em 2 sessões/);
  // The packaged Electron compositor can stall full-page capture while other
  // desktop QA instances are running. Functional assertions also run packaged;
  // the source run supplies this optional visual artifact.
  if (!executablePath) await page.screenshot({ path: fileURLToPath(new URL('../test-results/progress-integration.png', import.meta.url)), fullPage: true, timeout: 45000 });
  await cardB.getByRole('button', { name: 'Praticar este ponto' }).click();
  assert.equal(await page.locator('#song-title').textContent(), 'B · prática recente');
  assert.match(await page.locator('#loop-range').textContent(), /0:08.*0:12/);
  results.hotspotPracticeOpensCorrectSongAndRange = true;
  await page.locator('[data-view="progress"]').click(); await page.locator('#settings-button').click();
  await page.locator('#profile').fill('Bia'); await page.locator('#profile').press('Tab'); await page.locator('#settings button[value="close"]').click();
  assert.equal(await panel.locator('.music-progress-card').count(), 1); assert.equal(await panel.locator('.music-progress-card').first().getAttribute('data-song-id'), 'qa-recent-practice');
  assert.equal(await panel.locator('.music-progress-totals .music-progress-metric').nth(1).locator('strong').textContent(), '1');
  results.profileSwitchRefreshesVisibleProgress = true;
  await page.reload(); await page.waitForSelector('.song-card'); await page.locator('[data-view="progress"]').click();
  assert.equal(await panel.locator('.music-progress-card').count(), 1); assert.equal(await panel.locator('.music-progress-totals .music-progress-metric').nth(1).locator('strong').textContent(), '1');
  results.historyMetadataSurvivesReload = true;
  assert.deepEqual(errors, []);
  await writeFile(new URL('../test-results/progress-integration.json', import.meta.url), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2));
} finally { await app.close(); }
