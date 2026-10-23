import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTheme, initTheme, normalizeTheme } from '../src/theme.js';

function fixture(prefersDark = false) {
  class Element extends EventTarget {
    constructor() { super(); this.dataset = {}; this.style = {}; this.attributes = {}; }
    setAttribute(name, value) { this.attributes[name] = value; }
  }
  const root = new Element(), toggle = new Element(), select = new Element();
  const media = new EventTarget(); media.matches = prefersDark;
  const document = new EventTarget();
  Object.assign(document, { documentElement: root, querySelector: selector => selector === '#theme-toggle' ? toggle : select });
  return { document, root, toggle, select, media, matchMedia: () => media };
}

test('theme preferences are restricted to supported themes and system resolves correctly', () => {
  const f = fixture();
  assert.equal(normalizeTheme('unknown'), 'dark');
  assert.equal(applyTheme('light', f), 'light');
  assert.equal(f.root.dataset.theme, 'light');
  assert.equal(f.root.style.colorScheme, 'light');
  assert.equal(applyTheme('system', { ...f, prefersDark: true }), 'dark');
  assert.equal(f.root.dataset.themePreference, 'system');
});

test('toolbar switch updates palette and persistence callback without duplicate startup writes', () => {
  const f = fixture(), changes = [];
  const controller = initTheme({ ...f, theme: 'dark', onChange: theme => changes.push(theme) });
  assert.deepEqual(changes, []);
  assert.equal(f.toggle.attributes['aria-label'], 'Ativar tema claro');
  f.toggle.dispatchEvent(new Event('click'));
  assert.equal(f.root.dataset.theme, 'light');
  assert.equal(f.select.value, 'light');
  assert.equal(f.toggle.attributes['aria-pressed'], 'true');
  assert.deepEqual(changes, ['light']);
  controller.setTheme('dark', { notify: false });
  assert.deepEqual(changes, ['light']);
  controller.destroy();
  f.toggle.dispatchEvent(new Event('click'));
  assert.equal(controller.theme, 'dark');
});

test('following system responds to changes until the user chooses a fixed theme', () => {
  const f = fixture(false), changes = [];
  const controller = initTheme({ ...f, theme: 'system', onChange: theme => changes.push(theme) });
  assert.equal(controller.resolvedTheme, 'light');
  f.media.matches = true; f.media.dispatchEvent(new Event('change'));
  assert.equal(controller.resolvedTheme, 'dark');
  assert.deepEqual(changes, []);
  f.select.value = 'light'; f.select.dispatchEvent(new Event('change'));
  assert.equal(controller.theme, 'light');
  f.media.dispatchEvent(new Event('change'));
  assert.equal(controller.resolvedTheme, 'light');
  assert.deepEqual(changes, ['light']);
  controller.destroy();
});
