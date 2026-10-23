export const THEMES = Object.freeze(['dark', 'light', 'system']);
export const normalizeTheme = value => THEMES.includes(value) ? value : 'dark';

/** Apply the resolved palette without relying on a browser storage mechanism. */
export function applyTheme(theme, { document = globalThis.document, prefersDark = false } = {}) {
  const preference = normalizeTheme(theme);
  const resolvedTheme = preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;
  const root = document?.documentElement;
  if (root) {
    root.dataset.theme = resolvedTheme;
    root.dataset.themePreference = preference;
    root.style.colorScheme = resolvedTheme;
  }
  return resolvedTheme;
}

/** Connect the compact toolbar switch and the persisted settings preference. */
export function initTheme({ theme = 'dark', onChange = () => {}, document = globalThis.document,
  matchMedia = globalThis.matchMedia?.bind(globalThis) } = {}) {
  const media = matchMedia?.('(prefers-color-scheme: dark)');
  const toggle = document?.querySelector('#theme-toggle');
  const select = document?.querySelector('#theme-setting');
  let preference = normalizeTheme(theme), resolvedTheme;
  const render = () => {
    resolvedTheme = applyTheme(preference, { document, prefersDark: !!media?.matches });
    if (toggle) {
      const label = resolvedTheme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro';
      toggle.textContent = resolvedTheme === 'dark' ? '☀' : '☾';
      toggle.title = label;
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('aria-pressed', String(resolvedTheme === 'light'));
    }
    if (select) select.value = preference;
    const Event = document?.defaultView?.CustomEvent;
    if (Event) document.dispatchEvent(new Event('pianocraft-theme-change', { detail: { theme: preference, resolvedTheme } }));
  };
  const setTheme = (value, { notify = true } = {}) => {
    preference = normalizeTheme(value);
    render();
    if (notify) onChange(preference);
    return resolvedTheme;
  };
  const toggleTheme = () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  const selectTheme = event => setTheme(event.target.value);
  const systemChange = () => { if (preference === 'system') render(); };
  toggle?.addEventListener('click', toggleTheme);
  select?.addEventListener('change', selectTheme);
  media?.addEventListener?.('change', systemChange);
  render();
  return {
    get theme() { return preference; },
    get resolvedTheme() { return resolvedTheme; },
    setTheme,
    destroy() {
      toggle?.removeEventListener('click', toggleTheme);
      select?.removeEventListener('change', selectTheme);
      media?.removeEventListener?.('change', systemChange);
    },
  };
}
