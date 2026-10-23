const modes = [
  { id: 'melody', title: 'Praticar a melodia', subtitle: 'Notas com orientação', short: 'Melodia' },
  { id: 'rhythm', title: 'Praticar o ritmo', subtitle: 'Precisão no tempo', short: 'Ritmo' },
  { id: 'recital', title: 'Recital da música', subtitle: 'Andamento original', short: 'Recital' },
];
const handNames = { left: 'Mão esquerda', right: 'Mão direita', both: 'Ambas as mãos' };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const bounded = (value, max = 100) => finite(value) ? Math.max(0, Math.min(max, Math.round(value))) : null;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function pathData(summary, mode, hands) {
  const paths = Array.isArray(summary?.tracks) ? summary.tracks : Array.isArray(summary?.paths) ? summary.paths : [];
  return paths.find(path => path.mode === mode && path.hands === hands) || { mode, hands, score: null, eligible: true, milestones: [] };
}

function detailFor(path) {
  if (path.eligible === false) return path.label || 'Sem notas desta mão';
  const score = bounded(path.score ?? path.points);
  if (score === null) return 'Sem registro';
  if (path.completed) return 'Percurso concluído';
  return path.label || (score >= 80 ? 'Em consolidação' : 'Em estudo');
}

function pathButton(path, mode, { onPractice, onError, songId }) {
  const button = node('button', `achievement-path${path.hands === 'both' ? ' achievement-path-both' : ''}`);
  const score = path.eligible === false ? null : bounded(path.score ?? path.points);
  const state = path.eligible === false ? 'unavailable' : path.completed ? 'complete' : score === null ? 'unplayed' : 'started';
  button.type = 'button'; button.dataset.path = `${mode.id}:${path.hands}`; button.dataset.state = state;
  button.disabled = path.eligible === false;
  const value = node('span', 'achievement-value');
  value.append(node('strong', '', score === null ? '—' : score), node('small', '', '/100'));
  const hand = node('span', 'achievement-hand', handNames[path.hands]);
  const status = node('span', 'achievement-path-state', `${path.completed ? '✓ ' : ''}${detailFor(path)}`);
  const meter = node('span', 'achievement-meter'); meter.setAttribute('aria-hidden', 'true');
  const fill = node('span'); fill.style.width = `${score || 0}%`; meter.append(fill);
  button.append(value, hand, status, meter);
  const coverage = finite(path.coverage) ? `${bounded(path.coverage * 100)}% das notas praticadas` : '';
  const accuracy = finite(path.bestAccuracy) ? `Precisão de referência ${bounded(path.bestAccuracy)}%` : '';
  const label = [mode.short, handNames[path.hands], score === null ? detailFor(path) : `${score} de 100 pontos`, detailFor(path), coverage, accuracy].filter(Boolean).join('. ');
  button.setAttribute('aria-label', label);
  button.title = [path.description, coverage, accuracy, path.eligible === false ? '' : 'Clique para praticar este percurso.'].filter(Boolean).join('\n');
  button.addEventListener('click', async () => {
    try { await onPractice({ mode: mode.id, hands: path.hands, songId }); }
    catch (error) { onError(error); }
  });
  return button;
}

/** Display the engine's measured achievement paths; rendering never awards points. */
export function renderAchievements(summary = {}, { onPractice = () => {}, onError = () => {}, songId = summary.songId, compact = false, title = 'Percursos e conquistas' } = {}) {
  const root = node('section', `achievements${compact ? ' achievements-compact' : ''}`);
  root.setAttribute('aria-label', title);
  const header = node('div', 'achievements-heading'), earned = node('div', 'achievements-earned');
  const max = finite(summary.maxPoints) && summary.maxPoints >= 0 ? summary.maxPoints : 900;
  earned.append(node('strong', '', `${bounded(summary.totalPoints, max) || 0}`), node('span', '', ` / ${Math.round(max)} pontos`));
  header.append(node('h3', '', title), earned); root.append(header);
  const grid = node('div', 'achievement-grid');
  for (const mode of modes) {
    const column = node('section', 'achievement-column'); column.dataset.mode = mode.id;
    const heading = node('div', 'achievement-column-heading'); heading.append(node('h4', '', mode.title), node('p', '', mode.subtitle));
    const paths = node('div', 'achievement-paths');
    for (const hands of ['left', 'right', 'both']) paths.append(pathButton(pathData(summary, mode.id, hands), mode, { onPractice, onError, songId }));
    column.append(heading, paths); grid.append(column);
  }
  root.append(grid);
  const milestones = Array.isArray(summary.milestones) ? summary.milestones : [];
  if (milestones.length) {
    const earnedMilestones = node('div', 'achievement-milestones'); earnedMilestones.setAttribute('aria-label', 'Conquistas recebidas');
    // Show the strongest milestone for each path. Engine milestones are ordered
    // by goal level, not by date, so this does not imply an earned-at chronology.
    const principal = new Map();
    for (const milestone of milestones) principal.set(milestone.trackId || milestone.id || milestone, milestone);
    for (const milestone of [...principal.values()].slice(0, 12)) {
      const mode = modes.find(mode => mode.id === milestone.mode)?.short;
      const context = [mode, handNames[milestone.hands]].filter(Boolean).join(' · ');
      const badge = node('span', 'achievement-badge', `✓ ${context ? `${context}: ` : ''}${milestone.title || milestone.label || 'Conquista'}`);
      if (milestone.description) badge.title = milestone.description;
      earnedMilestones.append(badge);
    }
    root.append(earnedMilestones);
    root.append(node('p', 'achievement-note', `${milestones.length} ${milestones.length === 1 ? 'marco alcançado' : 'marcos alcançados'}. Exibindo as principais conquistas de cada percurso.`));
  }
  root.append(node('p', 'achievement-note', 'A meta de cada percurso é praticar todas as notas e alcançar 90/100 pontos. Melodia registra as notas com orientação; Ritmo e Recital avaliam também o tempo. Clique em um percurso para praticar com a mão escolhida.'));
  root.append(node('p', 'achievement-note', summary.explanation || 'Os pontos preservam sua melhor evidência em cada percurso. Repetir o mesmo resultado mantém os pontos. O score recente de domínio é calculado separadamente.'));
  return root;
}

/** A compact studio entry whose expanded state and keyboard focus survive updates. */
export class AchievementPanel {
  constructor({ host, onPractice = () => {}, onError = () => {} }) {
    if (!host) throw new Error('O painel de conquistas precisa de um contêiner.');
    this.host = host; this.onPractice = onPractice; this.onError = onError; this.profile = 'Meu perfil';
    this.host.classList.add('achievement-panel-host');
  }
  setData(song, summary, { profile = 'Meu perfil' } = {}) {
    const previousSongId = this.song?.id, profileChanged = profile !== this.profile;
    const active = document.activeElement, focusedPath = this.host.contains(active) ? active?.dataset.path : null;
    const summaryFocused = active === this.toggle;
    const open = previousSongId === song?.id && !profileChanged && !!this.details?.open;
    this.song = song || null; this.summary = summary || {}; this.profile = profile;
    this.host.replaceChildren();
    if (!song) { this.details = null; this.toggle = null; this.host.hidden = true; return this; }
    this.host.hidden = false;
    this.details = node('details', 'achievement-panel'); this.details.open = open;
    this.toggle = node('summary', 'achievement-panel-toggle');
    const max = finite(summary?.maxPoints) && summary.maxPoints >= 0 ? summary.maxPoints : 900;
    const completed = (summary?.tracks || summary?.paths || []).filter(path => path.completed).length;
    this.toggle.append(node('span', '', 'Percursos e conquistas'), node('span', 'achievement-panel-score', `${bounded(summary?.totalPoints, max) || 0}/${Math.round(max)} pontos${completed ? ` · ${completed} concluído${completed > 1 ? 's' : ''}` : ''}`));
    this.details.append(this.toggle, renderAchievements(summary, { songId: song.id, compact: true, onPractice: this.onPractice, onError: this.onError, title: `Seu progresso nesta música` }));
    this.host.append(this.details);
    if (previousSongId === song.id && !profileChanged) {
      if (summaryFocused) this.toggle.focus({ preventScroll: true });
      else if (focusedPath) [...this.host.querySelectorAll('[data-path]')].find(button => button.dataset.path === focusedPath)?.focus({ preventScroll: true });
    }
    return this;
  }
  destroy() { this.host.replaceChildren(); this.details = null; this.toggle = null; }
}
