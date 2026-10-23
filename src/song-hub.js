import { renderAchievements } from './achievement-panel.js';

const modeNames = { melody: 'Melodia', rhythm: 'Ritmo', recital: 'Recital', listen: 'Ouvir' };
const handNames = { left: 'Mão esquerda', right: 'Mão direita', both: 'Ambas as mãos' };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const bounded = (value, max = 100) => finite(value) ? Math.max(0, Math.min(max, value)) : null;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function clock(seconds) {
  if (!finite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function portion(task) {
  if (finite(task?.start) && finite(task?.end) && task.end > task.start) return `${clock(task.start)} – ${clock(task.end)}`;
  return 'Música inteira';
}

/** A song has one recommended action. Choosing a path only asks the host to
 * adapt that action; this view never awards points or starts playback itself. */
export class SongHub {
  constructor({ host, onStart = () => {}, onPath = () => {}, onReview = () => {}, onManual = () => {}, onError = () => {} }) {
    if (!host) throw new Error('A página da música precisa de um contêiner.');
    this.host = host;
    this.actions = { onStart, onPath, onReview, onManual };
    this.onError = onError;
    this.host.classList.add('song-hub-host');
  }

  async dispatch(name, payload) {
    try { await this.actions[name](payload); }
    catch (error) { this.onError(error); }
  }

  button(label, action, payload, className = '') {
    const button = node('button', className, label);
    button.type = 'button'; button.dataset.hubAction = action;
    button.addEventListener('click', () => this.dispatch(action, payload));
    return button;
  }

  setData(song, journey = {}, { achievements = {}, profile = 'Meu perfil' } = {}) {
    const sameContext = this.song?.id === song?.id && this.profile === profile;
    const active = this.host.contains(document.activeElement) ? document.activeElement : null;
    const focusedPath = active?.dataset.path, focusedAction = active?.dataset.hubAction;
    const detailsOpen = sameContext && !!this.details?.open;
    const detailsFocused = active === this.detailToggle;
    this.song = song || null; this.journey = journey || {}; this.profile = profile;
    this.host.replaceChildren();
    if (!song) { this.host.hidden = true; this.details = null; this.detailToggle = null; return this; }
    this.host.hidden = false;
    const root = node('section', 'song-hub'); root.setAttribute('aria-label', `Estudar ${song.title || 'música'}`);
    const header = node('div', 'song-hub-header');
    const title = node('div', 'song-hub-title');
    title.append(node('p', 'song-hub-eyebrow', 'Sua música'), node('h1', '', song.title || 'Música sem título'));
    const tools = node('div', 'song-hub-tools');
    tools.append(this.button('Estrutura e padrões', 'onReview', { songId: song.id }), this.button('Estúdio completo', 'onManual', { songId: song.id }));
    header.append(title, tools); root.append(header);

    const progress = this.journey.progress || {};
    const value = bounded(progress.value);
    const progressSection = node('section', 'song-hub-progress');
    progressSection.setAttribute('aria-label', progress.label || 'Progresso de estudo');
    const progressLine = node('div', 'song-hub-progress-line');
    const progressTitle = node('div', 'song-hub-progress-label');
    progressTitle.append(node('strong', '', progress.label || 'Progresso de estudo'), node('span', '', progress.stage || (value === null ? 'Sem notas para avaliar' : 'A começar')));
    const number = node('div', 'song-hub-progress-value'); number.append(node('strong', '', value === null ? '—' : Math.round(value)), node('small', '', '/100'));
    progressLine.append(progressTitle, number);
    const meter = node('div', 'song-hub-progress-meter'); meter.setAttribute('role', 'progressbar');
    meter.setAttribute('aria-label', progress.label || 'Progresso de estudo');
    meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100');
    if (value !== null) meter.setAttribute('aria-valuenow', String(Math.round(value)));
    meter.setAttribute('aria-valuetext', value === null ? 'Sem notas elegíveis para avaliar' : `${Math.round(value)} de 100. ${progress.stage || ''}`.trim());
    const fill = node('span'); fill.style.width = `${value || 0}%`; meter.append(fill);
    this.details = node('details', 'song-hub-progress-detail'); this.details.open = detailsOpen;
    this.detailToggle = node('summary', '', 'Como é calculado'); this.detailToggle.dataset.hubAction = 'progressDetail';
    this.details.append(this.detailToggle, node('p', '', progress.detail || 'Seu progresso reúne os pontos preservados nos percursos de Melodia, Ritmo e Recital. Cada percurso mostra quanto você já estudou com a mão escolhida.'));
    progressSection.append(progressLine, meter, this.details); root.append(progressSection);

    const task = this.journey.task;
    const taskSection = node('section', 'song-hub-task');
    taskSection.setAttribute('aria-label', 'Seu próximo passo');
    const taskContent = node('div', 'song-hub-task-content');
    taskContent.append(node('p', 'song-hub-eyebrow', this.journey.resumable ? 'Continuar meu estudo' : 'Seu próximo passo'));
    taskContent.append(node('h2', '', task?.title || 'Prepare esta música para estudar'));
    if (task) {
      const metadata = node('div', 'song-hub-task-meta');
      const speed = finite(task.speed) ? `${Math.round(task.speed * 100)}% do andamento` : null;
      for (const text of [handNames[task.hands], modeNames[task.mode], speed, portion(task)].filter(Boolean)) metadata.append(node('span', '', text));
      taskContent.append(metadata);
      const required = Math.max(1, Math.min(20, Math.floor(task.targetStreak || this.journey.requiredStreak || 3)));
      const target = Math.round(bounded(task.targetAccuracy) ?? 90);
      const goalTail = `Faça ${required} execuções consecutivas com pelo menos ${target}% de precisão.`;
      const fullInstruction = task.instruction || task.reason;
      const instruction = fullInstruction?.endsWith(goalTail) ? fullInstruction.slice(0, -goalTail.length).trim() : fullInstruction;
      if (instruction) taskContent.append(node('p', 'song-hub-instruction', instruction));
      if (task.reason && task.reason !== instruction && /^Revisar\b/i.test(task.title || '')) taskContent.append(node('p', 'song-hub-reason', task.reason));
      const occurrences = Array.isArray(task.occurrences) ? task.occurrences.length : task.occurrences;
      if (finite(occurrences) && occurrences > 1) taskContent.append(node('p', 'song-hub-pattern', `↳ Este padrão aparece ${Math.floor(occurrences)} vezes na música. Aprendê-lo ajuda nos próximos trechos.`));
      const goal = node('div', 'song-hub-goal');
      const streak = Math.floor(bounded(task.streak ?? this.journey.streak, required) || 0);
      const dots = node('span', 'song-hub-streak'); dots.setAttribute('aria-hidden', 'true');
      for (let index = 0; index < required; index++) dots.append(node('i', index < streak ? 'complete' : ''));
      const goalText = node('span', '', `Meta: ${required} execuções seguidas com ${target}% de precisão`);
      goal.append(dots, goalText, node('strong', '', `${streak}/${required}`));
      goal.setAttribute('aria-label', `${goalText.textContent}. ${streak} de ${required} concluídas.`);
      taskContent.append(goal);
    } else taskContent.append(node('p', 'song-hub-instruction', 'Confira as notas e a atribuição das mãos no estúdio para começar sua prática.'));
    const taskAction = node('div', 'song-hub-task-action');
    if (task) taskAction.append(this.button(this.journey.resumable ? 'Continuar' : 'Começar', 'onStart', { songId: song.id, task }, 'primary song-hub-start'));
    else taskAction.append(this.button('Abrir o estúdio', 'onManual', { songId: song.id }, 'primary song-hub-start'));
    taskAction.append(node('small', '', task ? 'Um trecho de cada vez' : 'Configurar a música'));
    taskSection.append(taskContent, taskAction); root.append(taskSection);

    const paths = renderAchievements(achievements, {
      songId: song.id,
      title: 'Escolher outro desafio',
      onPractice: payload => this.dispatch('onPath', payload),
      onError: this.onError,
    });
    paths.classList.add('song-hub-paths');
    const selected = [...paths.querySelectorAll('[data-path]')].find(button => button.dataset.path === `${task?.mode}:${task?.hands}`);
    if (selected) { selected.classList.add('song-hub-selected-path'); selected.setAttribute('aria-current', 'step'); }
    root.append(paths);
    if (this.journey.suggestedStructure) root.append(node('p', 'song-hub-structure-note', 'Os trechos foram sugeridos automaticamente. Você pode revisar os limites em “Estrutura e padrões”.'));
    this.host.append(root);
    if (sameContext && active) {
      if (detailsFocused) this.detailToggle.focus({ preventScroll: true });
      else if (focusedPath) [...this.host.querySelectorAll('[data-path]')].find(button => button.dataset.path === focusedPath)?.focus({ preventScroll: true });
      else if (focusedAction) [...this.host.querySelectorAll('[data-hub-action]')].find(button => button.dataset.hubAction === focusedAction)?.focus({ preventScroll: true });
    }
    return this;
  }

  destroy() { this.host.replaceChildren(); this.details = null; this.detailToggle = null; this.song = null; }
}
