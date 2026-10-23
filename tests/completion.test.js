import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { normalizeCompletion } from '../src/completion.js';

test('completion metrics keep absent values absent and never invent listening points', () => {
  const empty = normalizeCompletion(null);
  assert.equal(empty.accuracy, null); assert.equal(empty.trackAfter, null); assert.equal(empty.gain, 0);
  const listening = normalizeCompletion({ mode: 'listen', gain: 12, accuracy: 100, scoreAfter: 90, trackAfter: 10, newRecord: true });
  assert.equal(listening.gain, 0); assert.equal(listening.accuracy, null);
  assert.equal(listening.scoreAfter, null); assert.equal(listening.trackAfter, null); assert.equal(listening.newRecord, false);
});

test('completion accepts bounded measured scores and plain milestone text', () => {
  const value = normalizeCompletion({ mode: 'melody', hands: 'both', gain: 7.2, trackBefore: 12, trackAfter: 19, accuracy: 93.8,
    milestones: ['Primeira prática', { id: 'steady', title: 'Ritmo constante', description: 'Mantenha o pulso.' }, null] });
  assert.equal(value.gain, 7); assert.equal(value.accuracy, 94); assert.equal(value.trackAfter, 19);
  assert.deepEqual(value.milestones.map(item => item.title), ['Primeira prática', 'Ritmo constante']);
  assert.equal(normalizeCompletion({ gain: -4, accuracy: Infinity, trackAfter: 1000 }).gain, 0);
  assert.equal(normalizeCompletion({ accuracy: Infinity }).accuracy, null);
});

test('a large advance keeps the completed path visible ahead of earlier intermediate milestones', () => {
  const milestones = ['coverage-half', 'coverage-full', 'score-50', 'score-80', 'score-95', 'complete'].map(suffix => ({ id: `melody:both:${suffix}`, title: suffix }));
  const result = normalizeCompletion({ milestones });
  assert.equal(result.milestones.length, 4);
  assert.equal(result.milestones[0].title, 'complete');
  assert.ok(result.milestones.some(item => item.title === 'coverage-full'));
  assert.ok(result.milestones.some(item => item.title === 'score-95'));
});

test('guided results keep the measured goal, one study scale, and a bounded next action', () => {
  const result = normalizeCompletion({ title: 'Exercício concluído', mode: 'melody', goal: { met: true, streak: 2, required: 3, targetAccuracy: 90 },
    learningProgress: { before: 14, after: 16, value: 16 }, nextAction: { label: 'Praticar a 70%', description: 'Mantenha a mesma frase.' } });
  assert.equal(result.goal.met, false); assert.equal(result.title, 'Falta 1 execução para a meta');
  assert.equal(result.goal.streak, 2); assert.equal(result.goal.required, 3);
  assert.deepEqual(result.learningProgress, { before: 14, after: 16, value: 16, label: 'Progresso de estudo' });
  assert.equal(result.nextAction.label, 'Praticar a 70%');
  assert.equal(normalizeCompletion({ mode: 'melody', goal: { met: true, streak: 3, required: 3 } }).title, 'Meta atingida');
  assert.equal(normalizeCompletion({ mode: 'melody', goal: { met: false, streak: 1, required: 3 } }).title, 'Faltam 2 execuções para a meta');
  assert.equal(normalizeCompletion({ mode: 'melody', goal: { met: false, streak: 0, required: 3 } }).title, 'Vamos consolidar este trecho');
  const bounded = normalizeCompletion({ mode: 'rhythm', goal: { required: 100, streak: 300, targetAccuracy: Infinity }, nextAction: { label: 'a'.repeat(200), description: 'b'.repeat(400) }, learningProgress: { value: Infinity } });
  assert.equal(bounded.goal.required, 20); assert.equal(bounded.goal.streak, 20); assert.equal(bounded.goal.targetAccuracy, 90);
  assert.equal(bounded.nextAction.label.length, 80); assert.equal(bounded.nextAction.description.length, 240); assert.equal(bounded.learningProgress, null);
  const listening = normalizeCompletion({ mode: 'listen', goal: { met: true, streak: 3, required: 3 }, learningProgress: { value: 100 } });
  assert.equal(listening.goal, null); assert.equal(listening.learningProgress, null);
});

let application, page;
before(async () => {
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ args: [fileURLToPath(new URL('./study-panel-harness.cjs', import.meta.url))], env: environment });
  page = await application.firstWindow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(async ({ moduleUrl, styleUrl, themeUrl }) => {
    for (const href of [themeUrl, styleUrl]) { const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = href; document.head.append(style); }
    const { CompletionNotice } = await import(moduleUrl);
    const piano = document.createElement('button'); piano.id = 'test-piano-focus'; piano.textContent = 'Tecla de teste';
    piano.style.cssText = 'width:230px;height:120px'; document.body.append(piano);
    window.completionQa = { calls: [] };
    completionQa.notice = new CompletionNotice({ onProgress: result => completionQa.calls.push(['progress', result.attemptId]), onReplay: result => completionQa.calls.push(['replay', result.attemptId]), onContinue: result => completionQa.calls.push(['continue', result.attemptId]) });
    completionQa.result = { kind: 'exercise', title: 'Exercício concluído', songTitle: 'Desenhos que retornam', mode: 'melody', hands: 'both', accuracy: 96,
      gain: 8, scoreBefore: 24, scoreAfter: 27, trackBefore: 12, trackAfter: 20, milestones: [{ id: 'first', title: 'Primeira volta completa', description: 'Você percorreu o trecho até o final.' }] };
  }, { moduleUrl: new URL('../src/completion.js', import.meta.url).href, styleUrl: new URL('../src/completion.css', import.meta.url).href, themeUrl: new URL('../src/themes.css', import.meta.url).href });
});
after(async () => { await application?.close(); });

test('celebration shows earned points without moving the piano or stealing focus', async () => {
  await page.locator('#test-piano-focus').focus();
  const beforeBox = await page.locator('#test-piano-focus').boundingBox();
  await page.evaluate(() => completionQa.notice.show({ ...completionQa.result, attemptId: 'complete-a' }, { durationMs: 0 }));
  assert.equal(await page.locator('.completion-notice').isVisible(), true);
  assert.equal(await page.locator('.completion-gain').textContent(), '+8 pts no percurso');
  assert.equal(await page.locator('.completion-accuracy').textContent(), '96% de precisão');
  assert.equal(await page.locator('.completion-meter').getAttribute('max'), '100');
  assert.equal(await page.locator('.completion-song-score').textContent(), 'Score da música: 24 → 27/100');
  assert.deepEqual(await page.locator('#test-piano-focus').boundingBox(), beforeBox);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'test-piano-focus');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.completion-seal')).animationName), 'none');
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  await page.locator('.completion-notice').screenshot({ path: fileURLToPath(new URL('../test-results/completion-dark.png', import.meta.url)) });
});

test('the same attempt is announced once; actions get its result and dismiss safely', async () => {
  assert.equal(await page.evaluate(() => completionQa.notice.show({ ...completionQa.result, attemptId: 'complete-a' })), false);
  await page.locator('.completion-progress').click();
  assert.equal(await page.locator('.completion-notice').isVisible(), false);
  assert.deepEqual(await page.evaluate(() => completionQa.calls.at(-1)), ['progress', 'complete-a']);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'test-piano-focus');
  await page.evaluate(() => completionQa.notice.show({ ...completionQa.result, attemptId: 'complete-b' }, { durationMs: 0 }));
  await page.locator('.completion-replay').click();
  assert.deepEqual(await page.evaluate(() => completionQa.calls.at(-1)), ['replay', 'complete-b']);
});

test('compact loop result has no actions, respects timers, and clear cancels an old timer', async () => {
  await page.clock.install();
  await page.evaluate(() => completionQa.notice.show({ ...completionQa.result, attemptId: 'loop-a' }, { compact: true, durationMs: 1000 }));
  assert.equal(await page.locator('.completion-actions').count(), 0);
  assert.equal(await page.locator('.completion-track').count(), 0);
  await page.clock.runFor(700);
  await page.evaluate(() => { completionQa.notice.clear(); completionQa.notice.show({ ...completionQa.result, attemptId: 'loop-b' }, { compact: true, durationMs: 0 }); });
  await page.clock.runFor(1000);
  assert.equal(await page.locator('.completion-notice').isVisible(), true);
  await page.evaluate(() => completionQa.notice.show({ ...completionQa.result, attemptId: 'loop-c' }, { compact: true, durationMs: 1000 }));
  await page.clock.runFor(1100);
  assert.equal(await page.locator('.completion-notice').isVisible(), false);
});

test('listening reports task completion without fictitious points and Escape leaves dialogs alone', async () => {
  await page.evaluate(() => completionQa.notice.show({ title: 'Escuta concluída', mode: 'listen', gain: 12, accuracy: 100, attemptId: 'listen-a' }, { durationMs: 0 }));
  assert.equal(await page.locator('.completion-gain').count(), 0);
  assert.equal(await page.locator('.completion-accuracy').count(), 0);
  await page.evaluate(() => { const dialog = document.createElement('dialog'); dialog.id = 'test-dialog'; dialog.textContent = 'Revisão'; document.body.append(dialog); dialog.showModal(); });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.completion-notice').isVisible(), true);
  await page.evaluate(() => document.querySelector('#test-dialog').remove());
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.completion-notice').isVisible(), false);
});

test('a guided miss keeps the goal visible without claiming victory or another primary score', async () => {
  await page.locator('#test-piano-focus').focus();
  const before = await page.locator('#test-piano-focus').boundingBox();
  await page.evaluate(() => completionQa.notice.show({ ...completionQa.result, attemptId: 'guided-miss', title: 'Exercício concluído',
    goal: { met: false, streak: 2, required: 3, targetAccuracy: 90, label: '3 execuções seguidas com pelo menos 90% de precisão.' },
    learningProgress: { value: 16, before: 14, after: 16 }, nextAction: { label: 'Consolidar este trecho', description: 'Repita a 60% para completar a meta.' } }, { durationMs: 0 }));
  assert.equal(await page.locator('.completion-title').textContent(), 'Falta 1 execução para a meta');
  assert.equal(await page.locator('.completion-goal-ring').textContent(), '2/3');
  assert.match(await page.locator('.completion-goal-ring').getAttribute('aria-label'), /2 de 3 execuções seguidas/);
  assert.equal(await page.locator('.completion-notice').evaluate(node => node.classList.contains('completion-earned')), false);
  assert.equal(await page.locator('.completion-learning strong').textContent(), '16/100');
  assert.equal(await page.locator('.completion-gain').textContent(), '+2 no progresso de estudo');
  assert.equal(await page.locator('.completion-details .completion-track').isVisible(), false);
  assert.equal(await page.locator('.completion-details .completion-song-score').isVisible(), false);
  assert.equal(await page.locator('.completion-continue').textContent(), 'Consolidar este trecho');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'test-piano-focus');
  assert.deepEqual(await page.locator('#test-piano-focus').boundingBox(), before);
  await page.locator('.completion-notice').screenshot({ path: fileURLToPath(new URL('../test-results/completion-guided-consolidate.png', import.meta.url)) });
  await page.locator('.completion-details > summary').click();
  assert.equal(await page.locator('.completion-details .completion-track').isVisible(), true);
  assert.equal(await page.locator('.completion-song-score').textContent(), 'Avaliação de execução: 24 → 27/100');
  await page.locator('.completion-continue').click();
  assert.deepEqual(await page.evaluate(() => completionQa.calls.at(-1)), ['continue', 'guided-miss']);
});

test('a reached goal names the next step and compact repetitions report the streak without taking focus', async () => {
  await page.locator('#test-piano-focus').focus();
  await page.evaluate(() => completionQa.notice.show({ ...completionQa.result, newRecord: true, attemptId: 'guided-met', goal: { met: true, streak: 3, required: 3, targetAccuracy: 90 },
    learningProgress: { value: 16, before: 16, after: 16 }, nextAction: { label: 'Praticar a 70%', description: '<img src=x onerror=alert(1)>' } }));
  assert.equal(await page.locator('.completion-title').textContent(), 'Meta atingida');
  assert.equal(await page.locator('.completion-gain').count(), 0);
  assert.equal(await page.locator('.completion-record').count(), 0, 'A path gain cannot be presented as a new main progress record when the displayed study value is unchanged.');
  assert.equal(await page.locator('.completion-continue').textContent(), 'Praticar a 70%');
  assert.equal(await page.locator('.completion-next-description img').count(), 0);
  assert.equal(await page.locator('.completion-next-description').textContent(), '<img src=x onerror=alert(1)>');
  assert.match(await page.locator('[role="status"]').textContent(), /Próximo passo: Praticar a 70%/);
  await page.clock.runFor(20000);
  assert.equal(await page.locator('.completion-notice').isVisible(), true, 'A guided decision remains available until the learner chooses.');
  await page.locator('.completion-continue').click();
  assert.deepEqual(await page.evaluate(() => completionQa.calls.at(-1)), ['continue', 'guided-met']);
  await page.evaluate(() => completionQa.notice.show({ ...completionQa.result, attemptId: 'guided-loop', goal: { met: false, streak: 1, required: 3, targetAccuracy: 90 },
    learningProgress: { value: 16, before: 16, after: 16 } }, { compact: true, durationMs: 0 }));
  assert.equal(await page.locator('.completion-goal-ring').textContent(), '1/3');
  assert.equal(await page.locator('.completion-title').textContent(), 'Boa execução · 1/3');
  assert.equal(await page.locator('.completion-notice').evaluate(node => node.classList.contains('completion-advancing') && !node.classList.contains('completion-earned')), true);
  assert.equal(await page.locator('.completion-actions').count(), 0); assert.equal(await page.locator('.completion-details').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'test-piano-focus');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.completion-seal')).animationName), 'none');
  await page.evaluate(() => completionQa.notice.show({ ...completionQa.result, attemptId: 'guided-loop-two', goal: { met: false, streak: 2, required: 3, targetAccuracy: 90 } }, { compact: true, durationMs: 0 }));
  assert.equal(await page.locator('.completion-title').textContent(), 'Boa execução · 2/3');
  assert.equal(await page.locator('.completion-actions').count(), 0);
  await page.evaluate(() => completionQa.notice.show({ ...completionQa.result, attemptId: 'guided-loop-zero', goal: { met: false, streak: 0, required: 3, targetAccuracy: 90 } }, { compact: true, durationMs: 0 }));
  assert.equal(await page.locator('.completion-title').textContent(), 'Vamos consolidar este trecho');
  assert.equal(await page.locator('.completion-notice').evaluate(node => node.classList.contains('completion-consolidate') && !node.classList.contains('completion-earned') && !node.classList.contains('completion-advancing')), true);
});

test('light focus mode stays in the viewport and renders imported text literally', async () => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'; document.body.classList.add('practice-focus');
    completionQa.notice.show({ ...completionQa.result, songTitle: '<img src=x onerror=alert(1)>', attemptId: 'light-a', goal: { met: true, streak: 3, required: 3, targetAccuracy: 90 },
      learningProgress: { before: 14, after: 16, value: 16 }, nextAction: { label: 'Praticar a 70%', description: 'Continue com a mesma frase em um andamento um pouco maior.' } }, { durationMs: 0 });
  });
  assert.equal(await page.locator('.completion-song img').count(), 0);
  assert.equal(await page.locator('.completion-song').textContent(), '<img src=x onerror=alert(1)>');
  const bounds = await page.locator('.completion-notice').boundingBox();
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 720);
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 1000);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.completion-notice')).backgroundColor), 'rgb(255, 255, 255)');
  await page.locator('.completion-notice').screenshot({ path: fileURLToPath(new URL('../test-results/completion-light-focus.png', import.meta.url)) });
  await page.evaluate(() => completionQa.notice.destroy());
  assert.equal(await page.locator('.completion-notice').count(), 0);
});
