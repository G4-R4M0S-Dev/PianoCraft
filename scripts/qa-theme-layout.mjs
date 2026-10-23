import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('test-results', { recursive: true });
const env = { ...process.env, PIANOCRAFT_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2];
const app = await electron.launch(executablePath ? { executablePath, args: ['--smoke'], env } : { args: ['.', '--smoke'], env });
const result = { layouts: [], palettes: [], persisted: false, screenshots: process.env.QA_THEME_SCREENSHOTS !== '0' }, errors = [];
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  const capture = path => result.screenshots ? page.screenshot({ path, animations: 'disabled' }) : Promise.resolve();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.song-card');
  await page.addInitScript(() => {
    const settings = JSON.parse(localStorage.getItem('pc-settings') || '{}');
    Object.assign(settings, { midiAutoConnect: false, midiInputId: '' });
    if (!localStorage.getItem('qa-theme-initialized')) { settings.theme = 'dark'; localStorage.setItem('qa-theme-initialized', '1'); }
    localStorage.setItem('pc-settings', JSON.stringify(settings));
  });
  await page.reload(); await page.waitForSelector('.song-card');
  // Module-only fallback makes this check useful while app integration is in flight.
  await page.evaluate(async () => {
    if (!document.documentElement.dataset.theme) {
      const { initTheme } = await import(new URL('theme.js', location.href).href);
      window.qaTheme = initTheme({ theme: JSON.parse(localStorage.getItem('pc-settings') || '{}').theme,
        onChange: theme => localStorage.setItem('pc-settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('pc-settings') || '{}'), theme })) });
    }
  });
  const measure = () => page.evaluate(() => {
    const selectors = ['main>header', '.breadcrumb', '#instrument-panel', '.header-actions', '#instrument-input', '#instrument-settings'];
    return Object.fromEntries(selectors.map(selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return [selector, { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }];
    }));
  });
  const contrastSnapshot = (toggle = false) => page.evaluate(toggle => {
    if (toggle) document.querySelector('#theme-toggle').click();
    const rgb = value => [...value.matchAll(/[\d.]+/g)].map(match => +match[0]);
    const luminance = color => rgb(color).slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
    const selectors = ['.nav.active', '#instrument-settings', '#instrument-retry', '#import', '#theme-toggle', '#new-recording', '#free-metronome', '#clear-live-score', '#record', '#sheet-toggle', '#focus-mode'];
    return selectors.map(selector => {
      const element = document.querySelector(selector);
      if (!element || !element.getClientRects().length || element.disabled) return null;
      const style = getComputedStyle(element); let background = style.backgroundColor, parent = element.parentElement;
      while ((rgb(background)[3] ?? 1) === 0 && parent) { background = getComputedStyle(parent).backgroundColor; parent = parent.parentElement; }
      const light = luminance(style.color), dark = luminance(background);
      return { selector, text: style.color, background, contrast: +(Math.max(light + .05, dark + .05) / Math.min(light + .05, dark + .05)).toFixed(2) };
    }).filter(Boolean);
  }, toggle);
  const readable = (snapshot, label) => {
    for (const item of snapshot) assert.ok(item.contrast >= 4.5, `${label}: ${item.selector} contrast ${item.contrast} (${item.text} on ${item.background})`);
    result.contrast ??= []; result.contrast.push({ label, controls: snapshot });
  };
  for (const width of [1440, 1000]) {
    await page.setViewportSize({ width, height: width === 1440 ? 960 : 720 });
    const before = await measure();
    const header = before['main>header'];
    assert.equal(await page.locator('main>header>#instrument-panel').count(), 1);
    for (const selector of ['.breadcrumb', '#instrument-panel', '.header-actions']) {
      const r = before[selector];
      assert.ok(r.left >= header.left && r.right <= header.right && r.top >= header.top && r.bottom <= header.bottom, `${width}: ${selector} outside toolbar`);
    }
    assert.ok(before['.breadcrumb'].right <= before['#instrument-panel'].left, `${width}: breadcrumb overlaps instrument`);
    assert.ok(before['#instrument-panel'].right <= before['.header-actions'].left, `${width}: instrument overlaps actions`);
    await page.evaluate(() => {
      document.querySelector('#midi-activity').textContent = 'Dó sustenido · nota pressionada · canal 16 · 999999 eventos com uma mensagem bastante extensa';
      document.querySelector('#instrument-status').textContent = 'Entrada MIDI aberta e conectada ao instrumento CASIO USB-MIDI com uma mensagem muito comprida';
    });
    const after = await measure();
    for (const selector of Object.keys(before)) assert.deepEqual(after[selector], before[selector], `${width}: live MIDI resized ${selector}`);
    readable(await contrastSnapshot(true), `Immediate light palette at ${width}px`);
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.waitForTimeout(200);
    const colors = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(document.body).color, panel: getComputedStyle(document.querySelector('.song-card')).backgroundColor }));
    assert.equal(colors.bg, 'rgb(244, 246, 245)');
    assert.equal(colors.panel, 'rgb(255, 255, 255)');
    await capture(`test-results/theme-light-library-${width}.png`);
    result.layouts.push({ width, header: after['main>header'], instrument: after['#instrument-panel'], stableActivity: true });
    result.palettes.push({ width, ...colors });
    await page.locator('.open-song').first().click();
    await page.waitForSelector('#studio-view:not(.hidden)');
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(`test-results/theme-light-studio-${width}.png`);
    await page.locator('.study-open').click();
    await page.waitForSelector('.study-dialog[open]');
    await capture(`test-results/theme-light-study-${width}.png`);
    await page.locator('.study-close').click();
    await page.locator('[data-view="free"]').click();
    readable(await contrastSnapshot(), `Free piano at ${width}px`);
    await page.locator('#theme-toggle').click();
    readable(await contrastSnapshot(true), `Immediate free-piano light palette at ${width}px`);
    // CSS-state fixtures isolate palette checks from the sound-device clock;
    // qa-free-learning covers the running metronome and its actual beat order.
    const accent = await page.locator('#free-metronome').evaluate(element => { element.setAttribute('aria-pressed', 'true'); element.dataset.beat = '1'; return getComputedStyle(element).backgroundColor; });
    readable(await contrastSnapshot(), `Accented free metronome at ${width}px`);
    const regular = await page.locator('#free-metronome').evaluate(element => { element.dataset.beat = '2'; return getComputedStyle(element).backgroundColor; });
    assert.notEqual(accent, regular, 'the first beat must have its own visible accent');
    await page.locator('#free-metronome').evaluate(element => { element.setAttribute('aria-pressed', 'false'); delete element.dataset.beat; });
    await capture(`test-results/theme-light-free-${width}.png`);
    await page.locator('[data-view="library"]').click();
    await page.locator('#theme-toggle').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  }
  await page.locator('#theme-toggle').click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pc-settings')).theme), 'light');
  await page.reload(); await page.waitForSelector('.song-card');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  result.persisted = true;
  await page.locator('#settings-button').click();
  await page.locator('#theme-setting').selectOption('system');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themePreference), 'system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.deepEqual(errors, []);
  await writeFile('test-results/theme-layout-validation.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ layouts: result.layouts.map(layout => ({ width: layout.width, stableActivity: layout.stableActivity })), persisted: result.persisted,
    contrastChecks: result.contrast.flatMap(group => group.controls).length, minimumContrast: Math.min(...result.contrast.flatMap(group => group.controls.map(control => control.contrast))) }, null, 2));
} finally { await app.close(); }
