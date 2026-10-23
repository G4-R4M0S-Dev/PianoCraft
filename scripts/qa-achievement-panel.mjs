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
    const module = await import(new URL('achievement-panel.js', location.href));
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('achievements.css', location.href); document.head.append(css);
    const host = document.createElement('div'); host.id = 'qa-achievement-host';
    Object.assign(host.style, { position: 'fixed', inset: '15px', padding: '15px', zIndex: '99999', background: 'var(--bg)', overflow: 'auto' });
    document.body.append(host);
    const scores = { 'melody:left': null, 'melody:right': 0, 'melody:both': 92, 'rhythm:left': 47, 'rhythm:right': 84, 'rhythm:both': 75, 'recital:left': null, 'recital:right': 100, 'recital:both': 94 };
    const tracks = Object.entries(scores).map(([id, score]) => { const [mode, hands] = id.split(':'); return { id, mode, hands, score, eligible: id !== 'recital:left', completed: score !== null && score >= 90, coverage: score === null ? 0 : score >= 90 ? 1 : .7, bestAccuracy: score, label: score >= 80 ? 'Em consolidação' : 'Em estudo', description: 'Teste local de percurso.' }; });
    window.qaAchievementSummary = { totalPoints: 592, maxPoints: 900, tracks, milestones: [{ id: 'one', title: 'Primeira conclusão', description: 'Música completa praticada.' }, { id: 'inert', title: '<img src=x onerror="window.qaInjected=true">' }] };
    window.qaAchievementCallbacks = []; window.qaAchievementErrors = [];
    const callbacks = { onPractice: value => { qaAchievementCallbacks.push(value); if (value.mode === 'rhythm') return Promise.reject(new Error('Falha tratada de teste')); }, onError: error => qaAchievementErrors.push(error.message) };
    const standalone = document.createElement('div'); standalone.id = 'qa-standalone'; standalone.append(module.renderAchievements(qaAchievementSummary, { ...callbacks, songId: 'qa-song' })); host.append(standalone);
    const compact = document.createElement('div'); compact.id = 'qa-compact'; host.append(compact);
    window.qaAchievementPanel = new module.AchievementPanel({ host: compact, ...callbacks });
    qaAchievementPanel.setData({ id: 'qa-song', title: 'Música QA' }, qaAchievementSummary, { profile: 'Ana' });
  });
  const standalone = page.locator('#qa-standalone');
  assert.equal(await standalone.locator('[data-path]').count(), 9);
  assert.equal(await standalone.locator('[data-path="melody:left"] .achievement-value strong').textContent(), '—');
  assert.equal(await standalone.locator('[data-path="melody:right"] .achievement-value strong').textContent(), '0');
  assert.equal(await standalone.locator('[data-path="recital:left"]').isDisabled(), true);
  assert.match(await standalone.locator('[data-path="melody:both"]').getAttribute('aria-label'), /92 de 100 pontos/);
  assert.equal(await standalone.locator('[data-state="complete"]').count(), 3);
  assert.equal(await standalone.locator('img').count(), 0);
  assert.equal(await page.evaluate(() => window.qaInjected), undefined);
  result.checks.push('Nine independent paths preserve null/zero/unavailable states, accessible labels and inert milestone text.');
  await standalone.locator('[data-path="melody:right"]').click();
  assert.deepEqual(await page.evaluate(() => qaAchievementCallbacks[0]), { mode: 'melody', hands: 'right', songId: 'qa-song' });
  await standalone.locator('[data-path="rhythm:both"]').click();
  await page.waitForFunction(() => qaAchievementErrors.length === 1);
  assert.deepEqual(await page.evaluate(() => qaAchievementErrors), ['Falha tratada de teste']);
  result.checks.push('Buttons dispatch the selected mode, hand and song; rejected callbacks are reported.');
  const compact = page.locator('#qa-compact');
  assert.equal(await compact.locator('details').getAttribute('open'), null);
  await compact.locator('summary').click();
  await compact.locator('[data-path="melody:right"]').focus();
  await page.evaluate(() => qaAchievementPanel.setData({ id: 'qa-song' }, qaAchievementSummary, { profile: 'Ana' }));
  assert.equal(await compact.locator('details').getAttribute('open'), '');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.path), 'melody:right');
  assert.equal(await page.evaluate(() => qaAchievementCallbacks.length), 2, 'Rendering must not issue a practice action.');
  await page.evaluate(() => qaAchievementPanel.setData({ id: 'qa-song' }, { tracks: [], totalPoints: 0, maxPoints: 900 }, { profile: 'Bia' }));
  assert.equal(await compact.locator('details').getAttribute('open'), null);
  assert.match(await compact.locator('.achievement-panel-score').textContent(), /^0\/900/);
  await page.evaluate(() => qaAchievementPanel.setData(null, null));
  assert.equal(await compact.isHidden(), true);
  result.checks.push('Studio updates preserve expansion and keyboard focus without callbacks; profile change collapses and clears points.');
  for (const theme of ['dark', 'light']) for (const width of [1000, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const bounds = await standalone.evaluate(element => {
      const root = element.getBoundingClientRect();
      return { width: root.width, scrollWidth: element.scrollWidth, columns: [...element.querySelectorAll('.achievement-column')].map(column => column.getBoundingClientRect().width), buttonsFit: [...element.querySelectorAll('button')].every(button => button.getBoundingClientRect().right <= root.right + 1 && button.scrollWidth <= button.clientWidth + 1) };
    });
    assert.ok(bounds.buttonsFit, JSON.stringify(bounds)); assert.ok(bounds.scrollWidth <= bounds.width + 1, JSON.stringify(bounds));
    assert.equal(bounds.columns.length, 3);
    result.layouts.push({ theme, width, ...bounds });
    await page.screenshot({ path: `test-results/achievements-${theme}-${width}.png` });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await standalone.locator('.achievement-path').first().evaluate(button => getComputedStyle(button).animationName), 'none');
  assert.deepEqual(errors, []);
  result.checks.push('Dark/light layouts fit at 1000px and 1440px, with reduced-motion support and no page errors.');
  await writeFile('test-results/qa-achievement-panel.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await app.close(); }
