import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const environment = { ...process.env, PIANOCRAFT_TEST: '1' };
delete environment.ELECTRON_RUN_AS_NODE;
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
const app = await electron.launch({ args: ['.', '--smoke'], env: environment });
const result = {};
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.song-card');
  await page.evaluate(async ({ moduleUrl, styleUrl }) => {
    const { PhrasePanel } = await import(moduleUrl);
    const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = styleUrl; document.head.append(style);
    const host = document.createElement('div');
    host.id = 'qa-phrases-panel';
    host.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100;background:#17212a';
    document.body.append(host);
    window.phraseQa = { at: 1.5, calls: { open: 0, apply: [], practice: [], exit: 0, preview: [] }, failSave: false };
    phraseQa.song = { id: 'qa-phrases', title: 'Música indivisível', duration: 24, tempo: 120, timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }], tracks: [{ id: 0, name: 'Melodia', channel: 0 }], notes: Array.from({ length: 48 }, (_, id) => ({ id, midi: 60 + id % 7, time: id * .5, duration: .3, keyDuration: .3, track: 0, channel: 0 })) };
    phraseQa.notesBefore = JSON.stringify(phraseQa.song.notes);
    phraseQa.panel = new PhrasePanel({ host, getTime: () => phraseQa.at, onOpen: () => phraseQa.calls.open++,
      onApply: async plan => { if (phraseQa.failSave) throw new Error('Falha simulada de armazenamento'); phraseQa.calls.apply.push(structuredClone(plan)); phraseQa.song.phrasing = structuredClone(plan); },
      onPractice: phrase => phraseQa.calls.practice.push(phrase), onExit: () => phraseQa.calls.exit++,
      onPreview: async phrase => { phraseQa.calls.preview.push(phrase); if (phrase && phraseQa.slowPreview) await new Promise(resolve => { phraseQa.resolvePreview = resolve; }); }, onError: error => { throw error; } });
    phraseQa.panel.setSong(phraseQa.song);
  }, { moduleUrl: new URL('../src/phrases-panel.js', import.meta.url).href, styleUrl: new URL('../src/phrases.css', import.meta.url).href });
  const panel = page.locator('#qa-phrases-panel');
  const dialog = page.locator('.phrases-dialog').last();
  await panel.locator('.phrase-organize').click();
  await dialog.locator('.phrase-review-row').first().waitFor();
  assert.equal(await page.evaluate(() => phraseQa.calls.open), 1);
  assert.equal(await page.evaluate(() => phraseQa.song.phrasing), undefined);
  await dialog.locator('.phrase-cancel').click();
  assert.equal(await page.evaluate(() => phraseQa.calls.apply.length), 0);
  result.automaticSuggestionsRequireReviewAndSave = true;

  await panel.locator('.phrase-organize').click();
  await dialog.locator('.phrase-division').selectOption('count');
  await dialog.locator('.phrase-count').fill('11');
  await dialog.locator('.phrase-suggest').click();
  assert.equal(await dialog.locator('.phrase-review-row').count(), 11);
  result.requestedElevenPhrases = true;
  const end = dialog.locator('[aria-label="Fim da frase 1 em segundos"]');
  await end.fill('3.25');
  await end.press('Tab');
  assert.equal(await dialog.locator('[aria-label="Início da frase 2 em segundos"]').inputValue(), '3.25');
  await end.fill('-1');
  await end.press('Tab');
  assert.equal(await end.inputValue(), '3.25');
  assert.match(await dialog.locator('.phrase-editor-status').textContent(), /limite deve ficar/i);
  result.boundaryEditsRemainContiguousAndInvalidCutsRejected = true;

  await dialog.locator('[aria-label="Nome da frase 1"]').fill('01 · Introdução');
  await dialog.locator('[aria-label="Nome da frase 1"]').press('Tab');
  await dialog.locator('.phrase-review-seconds').fill('1.75');
  await dialog.locator('.phrase-review-seconds').press('Tab');
  assert.equal(await page.evaluate(() => phraseQa.at), 1.5);
  await dialog.locator('.phrase-split').click();
  assert.equal(await dialog.locator('.phrase-review-row').count(), 12);
  assert.equal(await dialog.locator('[aria-label="Fim da frase 1 em segundos"]').inputValue(), '1.75');
  await dialog.locator('.phrase-merge').click();
  assert.equal(await dialog.locator('.phrase-review-row').count(), 11);
  assert.equal(await dialog.locator('[aria-label="Nome da frase 1"]').inputValue(), '01 · Introdução');
  result.localReviewPositionSplitMergeAndRename = true;
  await dialog.screenshot({ path: new URL('../test-results/phrases-review.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });

  await dialog.locator('.phrase-preview').click();
  await dialog.locator('.phrase-cancel').click();
  assert.equal(await page.evaluate(() => phraseQa.calls.preview.length), 2);
  assert.equal(await page.evaluate(() => phraseQa.calls.preview.at(-1)), null);
  assert.equal(await page.evaluate(() => phraseQa.calls.apply.length), 0);
  assert.equal(await page.evaluate(() => JSON.stringify(phraseQa.song.notes) === phraseQa.notesBefore), true);
  result.cancelStopsPreviewAndLeavesOriginalSongIntact = true;

  await panel.locator('.phrase-organize').click();
  await dialog.locator('.phrase-division').selectOption('count');
  await dialog.locator('.phrase-count').fill('11');
  await dialog.locator('.phrase-suggest').click();
  await dialog.locator('[aria-label="Nome da frase 1"]').fill('01 · Introdução');
  await dialog.locator('.phrase-save').click();
  await page.waitForFunction(() => !phraseQa.panel.dialog.open);
  assert.equal(await page.evaluate(() => phraseQa.calls.apply.length), 1);
  assert.equal(await page.evaluate(() => phraseQa.song.phrasing.reviewed), true);
  assert.equal(await page.evaluate(() => phraseQa.song.phrasing.phrases.length), 11);
  assert.equal(await page.evaluate(() => JSON.stringify(phraseQa.song.notes) === phraseQa.notesBefore), true);
  result.planSavesOnceWithoutSplittingOrChangingMidi = true;

  await panel.locator('.phrase-choice').selectOption('phrase-1');
  assert.equal(await page.evaluate(() => phraseQa.calls.practice.at(-1).id), 'phrase-1');
  await panel.locator('.phrase-next').click();
  assert.equal(await page.evaluate(() => phraseQa.calls.practice.at(-1).id), 'phrase-2');
  await panel.locator('.phrase-previous').click();
  assert.equal(await page.evaluate(() => phraseQa.calls.practice.at(-1).id), 'phrase-1');
  assert.equal(await panel.locator('.phrase-previous').isDisabled(), true);
  await panel.locator('.phrase-choice').selectOption('');
  assert.equal(await page.evaluate(() => phraseQa.calls.exit), 1);
  result.phraseChoicePreviousNextAndReturnWholeSong = true;

  await panel.locator('.phrase-organize').click();
  assert.equal(await dialog.locator('.phrase-division').inputValue(), 'count');
  assert.equal(await dialog.locator('.phrase-count').inputValue(), '11');
  assert.equal(await dialog.locator('[aria-label="Nome da frase 1"]').inputValue(), '01 · Introdução');
  await page.evaluate(() => { phraseQa.failSave = true; });
  await dialog.locator('[aria-label="Nome da frase 1"]').fill('Alteração ainda não salva');
  await dialog.locator('.phrase-save').click();
  assert.match(await dialog.locator('.phrase-editor-status').textContent(), /Falha simulada/);
  assert.equal(await page.evaluate(() => phraseQa.panel.dialog.open), true);
  assert.equal(await page.evaluate(() => phraseQa.song.phrasing.phrases[0].name), '01 · Introdução');
  await dialog.locator('.phrase-cancel').click();
  await panel.locator('.phrase-organize').click();
  assert.equal(await dialog.locator('[aria-label="Nome da frase 1"]').inputValue(), '01 · Introdução');
  result.saveFailureRetainsReviewWithoutCorruptingApprovedPlan = true;
  await page.evaluate(() => { phraseQa.panel.setSong({ ...phraseQa.song, id: 'other-song', phrasing: undefined }); });
  assert.equal(await page.evaluate(() => phraseQa.panel.dialog.open), false);
  await page.evaluate(() => { phraseQa.failSave = false; phraseQa.slowPreview = true; phraseQa.calls.preview = []; });
  await panel.locator('.phrase-organize').click();
  await dialog.locator('.phrase-preview').click();
  await dialog.locator('.phrase-cancel').click();
  await page.evaluate(() => phraseQa.resolvePreview());
  await page.waitForFunction(() => phraseQa.calls.preview.length === 3);
  assert.equal(await page.evaluate(() => phraseQa.panel.previewing), false);
  assert.equal(await page.evaluate(() => phraseQa.calls.preview.at(-1)), null);
  assert.equal(await page.evaluate(() => phraseQa.panel.dialog.open), false);
  result.cancelDuringPendingPreviewPreventsLatePlayback = true;
  assert.deepEqual(errors, []);
  result.pageErrors = errors;
  await writeFile(new URL('../test-results/phrases-panel-qa.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await app.close(); }
