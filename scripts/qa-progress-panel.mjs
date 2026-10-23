import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const environment = { ...process.env, PIANOCRAFT_TEST: '1' }; delete environment.ELECTRON_RUN_AS_NODE;
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
const executablePath = process.argv[2];
const app = await electron.launch({ ...(executablePath ? { executablePath, args: ['--smoke'] } : { args: [fileURLToPath(new URL('../tests/study-panel-harness.cjs', import.meta.url))] }), env: environment });
const results = {};
try {
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector(executablePath ? '.song-card' : 'body');
  const moduleUrl = executablePath ? new URL('progress-panel.js', page.url()).href : new URL('../src/progress-panel.js', import.meta.url).href;
  const styleUrl = new URL('progress.css', moduleUrl).href;
  await page.evaluate(async ({ moduleUrl, styleUrl }) => {
    const { ProgressPanel } = await import(moduleUrl), style = document.createElement('link'); style.rel = 'stylesheet'; style.href = styleUrl; document.head.append(style);
    const achievementsStyle = document.createElement('link'); achievementsStyle.rel = 'stylesheet'; achievementsStyle.href = new URL('achievements.css', moduleUrl); document.head.append(achievementsStyle);
    const host = document.createElement('div'); host.id = 'qa-progress'; host.style.cssText = 'position:fixed;inset:0;padding:24px 45px;background:var(--bg);overflow:auto;z-index:1000'; document.body.append(host);
    const songs = [{ id: 'one', title: 'Indila · estudo de recorrências', duration: 32, tempo: 120, notes: Array.from({ length: 32 }, (_, id) => ({ id, time: id, midi: 60 + id % 5 })) }, { id: 'two', title: '<img src=x onerror=alert(1)> · leitura segura', duration: 32, tempo: 120, notes: [] }, { id: 'three', title: 'Sem prática ainda', duration: 32, notes: [] }];
    const row = (id, extra = {}) => ({ id: `qa-${id}`, songId: 'one', title: songs[0].title, profile: 'Ana', date: `2026-10-22T10:0${id}:00Z`, seconds: 32, mode: 'rhythm', hands: 'both', hits: 28, missed: 4, errors: 2, accuracy: 82, fullArrangement: true, transpose: 0, speed: 1, start: 0, end: 32, completed: true, practiceSessionId: `visit-${Math.floor(id / 2)}`, errorEvents: [{ time: 10, reason: 'wrong-note', type: 'pitch', count: 2, expectedPitches: [60], midi: 61 }], ...extra });
    const history = [row(0), row(1), row(2), row(3, { songId: 'two', title: songs[1].title, errorEvents: [] }), row(4, { profile: 'Bia' })];
    globalThis.progressQa = { songs, history, practice: [], open: [], errors: [], achievementEngineUrl: new URL('music/achievements.js', moduleUrl).href };
    progressQa.panel = new ProgressPanel({ host, onPractice: value => progressQa.practice.push(value), onOpenSong: id => progressQa.open.push(id), onError: error => progressQa.errors.push(error.message) });
    progressQa.panel.setData(songs, history, { profile: 'Ana' });
  }, { moduleUrl, styleUrl });
  const host = page.locator('#qa-progress');
  assert.equal(await host.locator('.music-progress-card').count(), 2);
  assert.equal(await host.locator('.music-progress-totals .music-progress-metric').nth(1).locator('strong').textContent(), '3');
  results.loopsAggregatedBySongAndSession = true;
  const search = host.getByRole('searchbox'); await search.fill('Indila');
  assert.equal(await host.locator('.music-progress-card').count(), 1); assert.equal(await search.inputValue(), 'Indila'); await search.fill('');
  await host.getByLabel('Incluir músicas sem prática').check(); assert.equal(await host.locator('.music-progress-card').count(), 3);
  await host.getByLabel('Incluir músicas sem prática').uncheck(); results.searchAndUnpracticedFilter = true;
  const card = host.locator('[data-song-id="one"]'); await card.locator(':scope > summary').click();
  assert.equal(await card.locator('.music-progress-hotspot').count(), 1); assert.match(await card.locator('.music-progress-badge').textContent(), /Recorre em 2 sessões/);
  assert.equal(await card.locator('.music-progress-session').count(), 2); assert.equal(await card.locator('.music-progress-sessions').getAttribute('open'), null);
  await card.getByRole('button', { name: 'Praticar este ponto' }).click();
  const practice = await page.evaluate(() => progressQa.practice[0]); assert.equal(practice.songId, 'one'); assert.equal(practice.start, 8); assert.equal(practice.end, 12); assert.equal(practice.hotspot.reason, 'wrong-note');
  await card.getByRole('button', { name: 'Abrir música' }).click(); assert.deepEqual(await page.evaluate(() => progressQa.open), ['one']);
  results.recurrentHotspotRangeActionsAndCollapsedSessions = true;
  assert.equal(await host.locator('img').count(), 0); results.importedTitlesAreText = true;
  await host.screenshot({ path: fileURLToPath(new URL('../test-results/progress-song-aggregation.png', import.meta.url)) });
  await page.evaluate(() => progressQa.panel.setData(progressQa.songs, progressQa.history, { profile: 'Bia' }));
  assert.equal(await host.locator('.music-progress-card').count(), 1); assert.equal(await host.locator('.music-progress-card').getAttribute('open'), null); assert.match(await host.locator('.music-progress-badge').textContent(), /Ocorrência isolada/);
  results.profileIsolationAndNoFalseRecurrence = true;
  await page.evaluate(async () => {
    const engine = await import(progressQa.achievementEngineUrl);
    const restored = progressQa.songs[2]; restored.notes = [{ id: 'restored-1', time: 0, duration: 1, midi: 48 }, { id: 'restored-2', time: 1, duration: 1, midi: 64 }];
    progressQa.restoredLedger = engine.evaluateAchievementAttempt(restored, null, {
      id: 'restored', songId: restored.id, songContentKey: engine.achievementContentKey(restored), profile: 'Ana',
      mode: 'melody', hands: 'both', completed: true, scopeComplete: true, fullArrangement: true, transpose: 0, speed: 1,
      start: 0, end: 32, seconds: 32, hits: 2, errors: 0, missed: 0, expectedNotes: 2,
    }, { profile: 'Ana' }).ledger;
    progressQa.pathActions = []; progressQa.achievementCalls = {};
    progressQa.panel.getAchievements = (song, profile) => {
      progressQa.achievementCalls[song.id] = (progressQa.achievementCalls[song.id] || 0) + 1;
      return engine.summarizeAchievements(song, progressQa.history, { profile, ledger: song.id === restored.id ? progressQa.restoredLedger : null });
    };
    progressQa.panel.onPracticePath = value => progressQa.pathActions.push(value);
    progressQa.panel.setData(progressQa.songs, progressQa.history, { profile: 'Ana' });
  });
  assert.equal(await host.locator('.music-progress-card').count(), 3, 'Ledger-only songs remain visible without raw attempt history.');
  const restored = host.locator('[data-song-id="three"]');
  assert.match(await restored.locator('.music-progress-title small').textContent(), /data da prática indisponível/);
  assert.doesNotMatch(await restored.locator('.music-progress-title small').textContent(), /Ainda sem prática/);
  assert.match(await restored.locator('.music-progress-overview').textContent(), /100 pontos conquistados/);
  assert.deepEqual(await page.evaluate(() => progressQa.achievementCalls), { one: 1, two: 1, three: 1 });
  await search.fill('Sem prática');
  assert.equal(await host.locator('.music-progress-card').count(), 1);
  await search.fill('');
  assert.deepEqual(await page.evaluate(() => progressQa.achievementCalls), { one: 1, two: 1, three: 1 }, 'Search, filtering and cards must reuse cached achievement summaries.');
  await restored.locator(':scope > summary').click();
  assert.equal(await restored.locator('.achievements [data-path]').count(), 9);
  assert.equal(await restored.locator('[data-path="melody:both"] .achievement-value strong').textContent(), '100');
  assert.equal(await restored.locator('[data-path="rhythm:both"] .achievement-value strong').textContent(), '—');
  await restored.locator('[data-path="melody:both"]').click();
  assert.deepEqual(await page.evaluate(() => progressQa.pathActions), [{ mode: 'melody', hands: 'both', songId: 'three' }]);
  assert.equal(await page.evaluate(() => progressQa.practice.length), 1, 'Achievement actions must not call the hotspot callback.');
  await page.evaluate(() => progressQa.panel.setData(progressQa.songs, progressQa.history, { profile: 'Bia' }));
  assert.equal(await host.locator('[data-song-id="three"]').count(), 0, 'Restored achievements remain scoped to the original profile.');
  await page.evaluate(() => { progressQa.songs[2].notes[0].midi++; progressQa.panel.setData(progressQa.songs, progressQa.history, { profile: 'Ana' }); });
  assert.equal(await host.locator('[data-song-id="three"]').count(), 0, 'Changing the song content invalidates restored achievement evidence.');
  results.achievementMatrixRealEngineAndScopedRestore = true;
  results.achievementPathsSeparateFromHotspotsAndCached = true;
  await page.evaluate(() => {
    progressQa.learningCalls = {};
    progressQa.panel.getLearningProgress = (song, profile) => {
      progressQa.learningCalls[song.id] = (progressQa.learningCalls[song.id] || 0) + 1;
      return { value: profile === 'Bia' ? 7 : ({ one: 25, two: 35, three: 0 })[song.id], label: 'Progresso de estudo', detail: '<img src=x onerror=alert(1)> · Melodia, Ritmo e Recital.' };
    };
    progressQa.panel.setData(progressQa.songs, progressQa.history, { profile: 'Ana' });
  });
  assert.equal(await host.locator('[data-song-id="one"] .music-progress-score strong').textContent(), '25/100');
  assert.equal(await host.locator('[data-song-id="two"] .music-progress-score strong').textContent(), '35/100');
  assert.equal(await host.locator('[data-song-id="two"] .music-progress-score small').textContent(), 'Progresso de estudo');
  assert.doesNotMatch(await host.locator('[data-song-id="two"] > summary').textContent(), /Sem avaliação|pontos conquistados/);
  assert.match(await host.locator('.music-progress-totals').textContent(), /Músicas com progresso2/);
  await host.getByLabel('Ordenar progresso').selectOption('score');
  assert.equal(await host.locator('.music-progress-card').first().getAttribute('data-song-id'), 'two');
  const guidedCard = host.locator('[data-song-id="two"]');
  await guidedCard.locator(':scope > summary').click();
  assert.equal(await guidedCard.locator('.music-progress-advanced').getAttribute('open'), null);
  assert.equal(await guidedCard.locator('.music-progress-advanced .music-progress-metrics').isVisible(), false);
  assert.equal(await guidedCard.locator('.music-progress-learning-detail img').count(), 0);
  assert.match(await guidedCard.locator('.music-progress-learning-detail').textContent(), /^<img src=x/);
  await guidedCard.locator('.music-progress-advanced > summary').click();
  assert.equal(await guidedCard.locator('.music-progress-advanced .music-progress-metrics').isVisible(), true);
  assert.match(await guidedCard.locator('.music-progress-advanced').textContent(), /Avaliação de execução/);
  assert.equal(await guidedCard.locator('.achievements [data-path]').count(), 9);
  await search.fill('Indila'); await search.fill('');
  assert.deepEqual(await page.evaluate(() => progressQa.learningCalls), { one: 1, two: 1, three: 1 });
  await host.getByLabel('Incluir músicas sem prática').check();
  assert.equal(await host.locator('[data-song-id="three"] .music-progress-score strong').textContent(), '0/100');
  if (!executablePath) await host.screenshot({ path: fileURLToPath(new URL('../test-results/progress-guided-study.png', import.meta.url)) });
  await page.evaluate(() => progressQa.panel.setData(progressQa.songs, progressQa.history, { profile: 'Bia' }));
  assert.equal(await host.locator('[data-song-id="one"] .music-progress-score strong').textContent(), '7/100');
  results.unifiedLearningProgressSortScopeAndZero = true;
  results.executionAssessmentAndNinePathsRemainAccessibleInDetails = true;
  results.learningCallbackCachedAndImportedDescriptionsAreText = true;
  assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => progressQa.errors), []);
  await writeFile(new URL('../test-results/progress-panel.json', import.meta.url), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await app.close(); }
