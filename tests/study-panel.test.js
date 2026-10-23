import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { reviewPatternFamily, renamePatternFamily } from '../src/study-panel.js';

const song = {
  id: 'study-interface', title: 'Desenhos que retornam', duration: 24, tempo: 120,
  tracks: [{ id: 0, name: 'Melodia' }, { id: 1, name: 'Baixo' }],
  timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
  notes: Array.from({ length: 48 }, (_, id) => ({ id, time: id * .5, duration: .3, keyDuration: .3, midi: 60 + id % 5, track: 0, channel: 0 })),
};
const analysis = {
  version: 2, method: 'melodic-structure-v1', contentKey: 'fixture-notes-v1', revisionKey: 'fixture-groups-v1', melodyTracks: [0], reviewed: false, warnings: [],
  phrases: [
    { id: 'p-a', name: 'Frase 1', start: 0, end: 8, patternId: 'a', patternLabel: 'A', variant: 'original', referencePhraseId: null, features: { contour: 'sobe e desce', intervals: [2, 2, -2], rhythm: [1, 1, 1, .5], firstPitch: 60, repeatedNotes: 0, leaps: 0, range: [60, 64] }, reason: 'Retorno melódico.' },
    { id: 'p-b', name: 'Frase 2', start: 8, end: 16, patternId: 'b', patternLabel: 'B', variant: 'original', referencePhraseId: null, features: { contour: [-1, -1], range: [60, 67] }, reason: 'Novo desenho.' },
    { id: 'p-av', name: 'Frase 3', start: 16, end: 24, patternId: 'a', patternLabel: 'A′', variant: 'variation', referencePhraseId: 'p-a', features: { contour: 'sobe e desce', intervals: [2, 2, -1], rhythm: [1, 1, 1, .5], firstPitch: 60, repeatedNotes: 0, leaps: 0, range: [60, 64] }, comparison: { summary: 'O desenho volta com uma nota final diferente.' }, reason: 'Fechamento.' },
  ],
  patterns: [
    { id: 'a', label: 'A', representativePhraseId: 'p-a', occurrences: ['p-a', 'p-av'], description: 'Desenho ascendente que retorna com um final diferente.', confidence: .9 },
    { id: 'b', label: 'B', representativePhraseId: 'p-b', occurrences: ['p-b'], description: 'Desenho descendente contrastante.', confidence: .9 },
  ],
};
for (const pattern of analysis.patterns) pattern.features = structuredClone(analysis.phrases.find(phrase => phrase.id === pattern.representativePhraseId).features);

test('manual regrouping preserves every note range and repairs references when moving a representative', () => {
  const before = structuredClone(analysis);
  const edited = reviewPatternFamily(analysis, 'p-a', 'b');
  assert.deepEqual(analysis, before);
  assert.deepEqual(edited.phrases.map(p => [p.id, p.start, p.end]), before.phrases.map(p => [p.id, p.start, p.end]));
  assert.equal(edited.phrases[0].patternId, 'b');
  assert.equal(edited.patterns.find(p => p.id === 'a').representativePhraseId, 'p-av');
  assert.equal(edited.phrases[2].referencePhraseId, null);
  assert.equal(edited.phrases[2].variant, 'original');
  assert.equal(edited.phrases[0].manualReview, true);
  assert.equal(edited.phrases[0].similarity, 0);
  assert.match(edited.phrases[0].comparison.summary, /manualmente/i);
});

test('new families remove empty old groups and invalid references/ambiguous names are rejected', () => {
  const edited = reviewPatternFamily(analysis, 'p-b', null);
  assert.equal(edited.patterns.length, 2);
  assert.ok(!edited.patterns.some(p => p.id === 'b'));
  assert.notEqual(edited.phrases[1].patternId, 'b');
  assert.equal(edited.phrases[1].referencePhraseId, null);
  assert.throws(() => reviewPatternFamily(analysis, 'missing', 'a'), /não encontrada/i);
  assert.throws(() => reviewPatternFamily(analysis, 'p-a', 'missing'), /família existente/i);
  assert.throws(() => renamePatternFamily(analysis, 'a', '   '), /nome/i);
  assert.throws(() => renamePatternFamily(analysis, 'a', 'B'), /já usa/i);
  const renamed = renamePatternFamily(analysis, 'a', 'Desenho principal');
  assert.equal(renamed.phrases[2].patternLabel, 'Desenho principal′');
  assert.equal(analysis.patterns[0].label, 'A');
});

let application, page;
before(async () => {
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ args: [fileURLToPath(new URL('./study-panel-harness.cjs', import.meta.url))], env: environment });
  page = await application.firstWindow();
  await page.evaluate(async ({ url, song, analysis }) => {
    const { StudyPanel } = await import(url);
    window.qa = { song, analysis, history: [], savedProgress: null, at: 18, profile: 'Perfil de teste', calls: { open: 0, apply: [], practice: [], preview: [], progress: [], errors: [] } };
    qa.panel = new StudyPanel({ host: document.querySelector('#study-fixture'), getTime: () => qa.at, getProfile: () => qa.profile, getHistory: () => qa.history,
      onOpen: () => qa.calls.open++,
      onAnalyze: async options => { qa.options = options; if (qa.slowAnalyze) return new Promise(resolve => { qa.finishAnalyze = resolve; }); return structuredClone(qa.analysis); },
      onApply: async value => { if (qa.failSave) throw new Error('Falha simulada ao salvar'); qa.calls.apply.push(value); qa.song.phrasing = value; qa.panel.setSong(qa.song); return value; },
      onPractice: value => qa.calls.practice.push(value),
      onPreview: value => { qa.calls.preview.push(value); },
      onSaveProgress: async value => { qa.calls.progress.push(value); qa.savedProgress = value; },
      onError: error => qa.calls.errors.push(error.message),
    });
    qa.panel.setSong(qa.song);
  }, { url: new URL('../src/study-panel.js', import.meta.url).href, song, analysis });
});
after(async () => { await application?.close(); });

test('cancelled asynchronous analysis never applies a result to a reopened panel', async () => {
  await page.locator('.study-open').click();
  await page.evaluate(() => { qa.slowAnalyze = true; });
  await page.locator('.study-analyze').click();
  await page.locator('.study-close').click();
  await page.locator('.study-open').click();
  await page.evaluate(() => { qa.finishAnalyze(structuredClone(qa.analysis)); qa.slowAnalyze = false; });
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.study-form-item').count(), 0);
  assert.equal(await page.evaluate(() => qa.calls.apply.length), 0);
  assert.equal(await page.locator('.study-analyze').isEnabled(), true);
});

test('analysis is a reviewable variable family map and failed saves preserve the draft', async () => {
  await page.locator('.study-source').selectOption('0');
  await page.locator('.study-analyze').click();
  assert.equal(await page.locator('.study-form-item').count(), 3);
  assert.equal(await page.locator('.study-family').count(), 2);
  assert.deepEqual(await page.evaluate(() => qa.options), { tracks: [0] });
  assert.equal(await page.evaluate(() => qa.song.phrasing), undefined);
  await page.locator('.study-occurrence .study-actions button').nth(1).click();
  assert.equal(await page.evaluate(() => qa.calls.practice.length), 0);
  assert.match(await page.locator('.study-status').textContent(), /salve/i);
  await page.evaluate(() => { qa.failSave = true; });
  await page.locator('.study-save').click();
  assert.match(await page.locator('.study-status').textContent(), /falha simulada/i);
  assert.equal(await page.locator('.study-form-item').count(), 3);
  assert.equal(await page.locator('.study-save').isEnabled(), true);
  await page.evaluate(() => { qa.failSave = false; });
  await page.locator('.study-save').click();
  assert.equal(await page.evaluate(() => qa.calls.apply.length), 1);
  assert.equal(await page.locator('.study-save').isDisabled(), true);
});

test('returns explain differences and manual group corrections update the plan without splitting MIDI', async () => {
  await page.locator('.study-form-item[data-phrase-id="p-av"]').click();
  assert.match(await page.locator('.study-occurrence').textContent(), /nota final diferente/i);
  const contour = page.locator('.study-occurrence .study-contour').first();
  assert.match(await contour.locator('svg').getAttribute('aria-label'), /Dó4 a Mi4/);
  assert.equal(await contour.locator('circle').count(), 4);
  assert.doesNotMatch(await contour.locator('polyline').getAttribute('points'), /NaN|Infinity/);
  await page.locator('.study-occurrence .study-preview').click();
  assert.deepEqual(await page.evaluate(() => qa.calls.preview.at(-1)), { start: 16, end: 24, name: 'Frase 3' });
  await page.locator('.study-occurrence .study-review summary').click();
  await page.locator('.study-family-choice').selectOption('b');
  await page.locator('.study-occurrence .study-review button').click();
  assert.equal(await page.evaluate(() => qa.panel.draft.phrases[2].patternId), 'b');
  assert.equal(await page.evaluate(() => qa.song.phrasing.phrases[2].patternId), 'a');
  assert.equal(await page.evaluate(() => qa.song.notes.length), 48);
  await page.locator('.study-save').click();
  assert.equal(await page.evaluate(() => qa.song.phrasing.phrases[2].patternId), 'b');
});

test('self-reported exercise progress persists by profile while musical evidence stays separate', async () => {
  await page.locator('[data-tab="plan"]').click();
  assert.ok(await page.locator('.study-session').count() > 0);
  const checkbox = page.locator('.study-exercise .study-check input').first();
  await checkbox.check();
  assert.equal(await page.evaluate(() => qa.calls.progress.length), 1);
  const saved = await page.evaluate(() => qa.savedProgress);
  assert.equal(saved.profile, 'Perfil de teste'); assert.equal(saved.songId, song.id); assert.equal(saved.completedExercises.length, 1);
  assert.ok((await page.locator('.study-pattern-progress').textContent()).includes('não avaliado'));
  await page.locator('.study-close').click();
  await page.evaluate(() => qa.panel.setProgress(qa.savedProgress));
  await page.locator('.study-open').click(); await page.locator('[data-tab="plan"]').click();
  assert.equal(await page.locator('.study-exercise .study-check input').first().isChecked(), true);
  await page.evaluate(() => { qa.profile = 'Outro perfil'; qa.panel.refreshProgress(); });
  assert.equal(await page.locator('.study-exercise .study-check input').first().isChecked(), false);
  await page.evaluate(() => { qa.profile = 'Perfil de teste'; qa.panel.refreshProgress(); });
  const automatic = await page.evaluate(() => qa.panel.plan.targetPatternId);
  const other = automatic === 'a' ? 'b' : 'a';
  await page.locator('.study-target-pattern').selectOption(other);
  assert.equal(await page.evaluate(() => qa.panel.plan.objective.patternId), other);
  assert.equal(await page.locator('.study-exercise .study-check input').first().isChecked(), false);
  await page.locator('.study-target-pattern').selectOption('');
  assert.equal(await page.locator('.study-exercise .study-check input').first().isChecked(), true);
});

test('starting an exercise delivers actual song bounds and closes the study dialog', async () => {
  const selected = await page.evaluate(() => structuredClone(qa.panel.plan.sessions[0].exercises[0]));
  await page.locator('.study-start-exercise').first().click();
  assert.equal(await page.locator('.study-dialog').evaluate(element => element.open), false);
  assert.deepEqual(await page.evaluate(() => qa.calls.practice.at(-1)), selected);
  assert.ok(selected.start >= 0 && selected.end <= song.duration && selected.end > selected.start);
  await page.locator('.study-open').click(); await page.locator('[data-tab="plan"]').click();
  const points = page.locator('.study-start-point');
  assert.ok(await points.count() > 0);
  const first = points.first();
  await first.evaluate(element => element.closest('details').open = true);
  await first.click();
  const started = await page.evaluate(() => qa.calls.practice.at(-1));
  assert.equal(started.points, undefined);
  assert.ok(analysis.phrases.some(phrase => phrase.start === started.start && phrase.end === started.end));
});

test('the study dialog remains legible with keyboard tabs and reserved status height', async () => {
  await page.locator('.study-open').click();
  await page.locator('[data-tab="structure"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[data-tab="plan"]').getAttribute('aria-selected'), 'true');
  const before = await page.locator('.study-status').boundingBox();
  await page.evaluate(() => qa.panel.setStatus('Mensagem de revisão um pouco mais longa, sem deslocar a área de prática.'));
  const after = await page.locator('.study-status').boundingBox();
  assert.equal(before.height, after.height);
  const contrasts = await page.locator('.study-form-item b').evaluateAll(elements => elements.map(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element.parentElement).backgroundColor })));
  const luminance = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
  for (const sample of contrasts) { const light = luminance(sample.color), dark = luminance(sample.background); assert.ok((Math.max(light, dark) + .05) / (Math.min(light, dark) + .05) >= 4.5, 'Letras das famílias precisam de contraste legível.'); }
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  await page.locator('[data-tab="structure"]').click();
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/study-structure.png', import.meta.url)) });
  await page.locator('[data-tab="plan"]').click();
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/study-plan.png', import.meta.url)) });
  assert.equal(await page.evaluate(() => qa.calls.errors.filter(message => message !== 'Falha simulada ao salvar').length), 0);
});
