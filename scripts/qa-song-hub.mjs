import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('test-results', { recursive: true });
const env = { ...process.env, PIANOCRAFT_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2];
const app = await electron.launch(executablePath ? { executablePath, args: ['--smoke'], env } : { args: ['.', '--smoke'], env });
const result = { checks: [], layouts: [] }, errors = [];
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.song-card');
  await page.evaluate(async () => {
    const module = await import(new URL('song-hub.js', location.href));
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('song-hub.css', location.href); document.head.append(css);
    const host = document.createElement('div'); host.id = 'qa-song-hub';
    Object.assign(host.style, { position: 'fixed', top: '84px', right: '0', bottom: '0', left: '230px', padding: '24px 38px 25px', zIndex: '9999', background: 'var(--bg)', overflow: 'auto' });
    document.body.append(host);
    window.qaSong = { id: 'qa-song', title: 'Love Story · estudo de padrões' };
    window.qaJourney = {
      resumable: true, requiredStreak: 3, streak: 1, suggestedStructure: true,
      progress: { value: 24, label: 'Progresso de estudo', stage: 'Em estudo', detail: 'Os percursos preservam os pontos de Melodia, Ritmo e Recital.' },
      task: { id: 'qa-task', title: 'Padrão B · primeira frase melódica', instruction: 'Reconheça o desenho da melodia e toque com calma. Repita até manter a precisão.', mode: 'melody', hands: 'right', speed: .6, start: 15, end: 30, targetStreak: 3, targetAccuracy: 90, streak: 1, occurrences: [{}, {}, {}, {}] },
    };
    window.qaAchievements = { totalPoints: 216, maxPoints: 900, tracks: ['melody', 'rhythm', 'recital'].flatMap(mode => ['left', 'right', 'both'].map(hands => ({ mode, hands, score: mode === 'melody' ? (hands === 'left' ? 0 : 74) : null, eligible: !(mode === 'recital' && hands === 'left'), coverage: .7 }))) };
    window.qaHubCalls = []; window.qaHubErrors = [];
    const callbacks = Object.fromEntries(['onStart', 'onPath', 'onReview', 'onManual'].map(name => [name, payload => { qaHubCalls.push({ name, payload }); if (name === 'onReview') throw new Error('Falha tratada de teste'); }]));
    window.qaHub = new module.SongHub({ host, ...callbacks, onError: error => qaHubErrors.push(error.message) });
    qaHub.setData(qaSong, qaJourney, { achievements: qaAchievements, profile: 'Ana' });
  });
  const hub = page.locator('#qa-song-hub');
  assert.equal(await hub.locator('[data-path]').count(), 9);
  assert.equal(await hub.locator('.song-hub-progress-value strong').textContent(), '24');
  assert.match(await hub.locator('.song-hub-goal').getAttribute('aria-label'), /3 execuções seguidas com 90%.*1 de 3 concluídas/);
  assert.equal(await hub.locator('.song-hub-streak .complete').count(), 1);
  assert.match(await hub.locator('.song-hub-pattern').textContent(), /4 vezes/);
  assert.equal(await hub.locator('.song-hub-start').textContent(), 'Continuar');
  assert.equal(await hub.locator('[aria-current="step"]').getAttribute('data-path'), 'melody:right');
  assert.equal(await hub.locator('[data-path="recital:left"]').isDisabled(), true);
  assert.equal(await hub.locator('[data-path="melody:left"] .achievement-value strong').textContent(), '0');
  assert.equal(await hub.locator('[data-path="rhythm:left"] .achievement-value strong').textContent(), '—');
  assert.equal(await page.evaluate(() => qaHubCalls.length), 0);
  result.checks.push('One recommended task, actual normalized progress, streak, repeated pattern and all nine selectable paths are visible without side effects.');
  await hub.locator('.song-hub-start').click();
  await hub.locator('[data-path="rhythm:both"]').click();
  await hub.locator('[data-hub-action="onManual"]').click();
  await hub.locator('[data-hub-action="onReview"]').click();
  await page.waitForFunction(() => qaHubErrors.length === 1);
  const calls = await page.evaluate(() => qaHubCalls);
  assert.equal(calls[0].name, 'onStart'); assert.equal(calls[0].payload.task.id, 'qa-task'); assert.equal(calls[0].payload.songId, 'qa-song');
  assert.deepEqual(calls[1], { name: 'onPath', payload: { songId: 'qa-song', mode: 'rhythm', hands: 'both' } });
  assert.equal(calls[2].name, 'onManual'); assert.equal(calls[3].name, 'onReview');
  assert.deepEqual(await page.evaluate(() => qaHubErrors), ['Falha tratada de teste']);
  result.checks.push('Start passes the exact recommended task; path and secondary actions dispatch the song identity and report asynchronous errors.');
  await hub.locator('.song-hub-progress-detail summary').click();
  await hub.locator('[data-path="melody:both"]').focus();
  await page.evaluate(() => qaHub.setData(qaSong, qaJourney, { achievements: qaAchievements, profile: 'Ana' }));
  assert.equal(await hub.locator('.song-hub-progress-detail').getAttribute('open'), '');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.path), 'melody:both');
  await page.evaluate(() => qaHub.setData(qaSong, qaJourney, { achievements: qaAchievements, profile: 'Bia' }));
  assert.equal(await hub.locator('.song-hub-progress-detail').getAttribute('open'), null);
  result.checks.push('Same-song updates preserve path focus and explanation expansion; switching profiles closes the old explanation.');
  for (const theme of ['dark', 'light']) for (const [width, height] of [[1000, 720], [1440, 960]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(({ theme, width }) => {
      document.documentElement.dataset.theme = theme;
      const host = document.querySelector('#qa-song-hub'); host.style.left = `${width < 1150 ? 195 : 230}px`; host.style.paddingInline = width < 1150 ? '26px' : '38px';
    }, { theme, width });
    const bounds = await hub.evaluate(host => {
      const root = host.getBoundingClientRect();
      const paths = [...host.querySelectorAll('[data-path]')].map(button => button.getBoundingClientRect());
      return { width: root.width, scrollWidth: host.scrollWidth, height: root.height, contentHeight: host.scrollHeight, pathsVisible: paths.every(button => button.bottom <= root.bottom && button.right <= root.right), noOverflow: [...host.querySelectorAll('button,.song-hub-task,.achievement-grid')].every(element => element.getBoundingClientRect().right <= root.right + 1 && element.scrollWidth <= element.clientWidth + 1) };
    });
    assert.equal(bounds.noOverflow, true, JSON.stringify(bounds));
    assert.equal(bounds.pathsVisible, true, JSON.stringify(bounds));
    result.layouts.push({ theme, viewportWidth: width, viewportHeight: height, ...bounds });
    await page.screenshot({ path: `test-results/song-hub-${theme}-${width}.png` });
  }
  await page.evaluate(() => qaHub.setData(qaSong, { ...qaJourney, task: { ...qaJourney.task, title: 'Revisar o padrão B', instruction: 'Observe o desenho e toque com calma. Faça 3 execuções consecutivas com pelo menos 90% de precisão.', reason: '6 erros registrados neste trecho em 3 sessões recentes.' } }, { achievements: qaAchievements, profile: 'Ana' }));
  assert.equal(await hub.locator('.song-hub-instruction').textContent(), 'Observe o desenho e toque com calma.');
  assert.match(await hub.locator('.song-hub-reason').textContent(), /6 erros.*3 sessões/);
  result.checks.push('Review tasks expose the recorded difficulty, while the target is stated once in its dedicated goal row.');
  await page.evaluate(() => qaHub.setData({ id: 'empty', title: '<img src=x onerror="window.qaInjected=true">' }, { progress: { value: null }, task: null }));
  assert.equal(await hub.locator('img').count(), 0);
  assert.equal(await page.evaluate(() => window.qaInjected), undefined);
  assert.equal(await hub.locator('.song-hub-progress-value strong').textContent(), '—');
  assert.equal(await hub.locator('.song-hub-start').textContent(), 'Abrir o estúdio');
  assert.equal(await hub.locator('[role="progressbar"]').getAttribute('aria-valuenow'), null);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await hub.locator('button').first().evaluate(button => getComputedStyle(button).animationName), 'none');
  await page.evaluate(() => qaHub.setData(null)); assert.equal(await hub.isHidden(), true);
  await page.evaluate(() => qaHub.destroy()); assert.equal(await hub.locator('*').count(), 0);
  assert.deepEqual(errors, []);
  result.checks.push('Unknown progress remains unknown, unassigned material offers the studio, text is inert, reduced motion is respected and teardown clears the view.');
  await writeFile('test-results/qa-song-hub.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await app.close(); }
