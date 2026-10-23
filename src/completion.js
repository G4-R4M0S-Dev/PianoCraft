const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = (value, limit = 180) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const score = value => finite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
const modeNames = { melody: 'Melodia', rhythm: 'Ritmo', recital: 'Recital', listen: 'Escuta' };
const handNames = { left: 'Mão esquerda', right: 'Mão direita', both: 'Ambas as mãos' };
const milestonePriority = id => id.endsWith(':complete') ? 100 : id.endsWith(':coverage-full') ? 90 : id.endsWith(':score-95') ? 80 : id.endsWith(':score-80') ? 70 : id.endsWith(':score-50') ? 60 : id.endsWith(':coverage-half') ? 20 : 50;
let sequence = 0;

/** The view accepts measured results; it never awards or persists points itself. */
export function normalizeCompletion(input = {}) {
  if (!input || typeof input !== 'object') input = {};
  const mode = Object.hasOwn(modeNames, input.mode) ? input.mode : '';
  const listening = mode === 'listen';
  const goalInput = !listening && input.goal && typeof input.goal === 'object' ? input.goal : null;
  const required = goalInput ? Math.max(1, Math.min(20, Math.round(finite(goalInput.required) ? goalInput.required : 3))) : 3;
  const streak = goalInput ? Math.max(0, Math.min(required, Math.round(finite(goalInput.streak) ? goalInput.streak : 0))) : 0;
  const targetAccuracy = goalInput ? Math.max(1, score(goalInput.targetAccuracy) ?? 90) : 90;
  const goal = goalInput ? { met: goalInput.met === true && streak >= required, streak, required, targetAccuracy,
    label: text(goalInput.label, 220) || `${required} execuções seguidas com pelo menos ${targetAccuracy}% de precisão.` } : null;
  const actionInput = input.nextAction && typeof input.nextAction === 'object' ? input.nextAction : null;
  const nextAction = actionInput && text(actionInput.label, 80) ? { label: text(actionInput.label, 80), description: text(actionInput.description, 240) } : null;
  const progressInput = !listening && input.learningProgress && typeof input.learningProgress === 'object' ? input.learningProgress : null;
  const progressValue = progressInput ? score(progressInput.value) ?? score(progressInput.after) : null;
  const learningProgress = progressInput && progressValue !== null ? { value: progressValue, before: score(progressInput.before), after: score(progressInput.after) ?? progressValue, label: 'Progresso de estudo' } : null;
  const milestones = Array.isArray(input.milestones) ? input.milestones.slice(0, 32).map(value => {
    if (typeof value === 'string') return { id: value.slice(0, 80), title: text(value, 100), description: '' };
    return { id: text(value?.id, 80), title: text(value?.title, 100), description: text(value?.description, 220) };
  }).filter(value => value.title).sort((a, b) => milestonePriority(b.id) - milestonePriority(a.id)).slice(0, 4) : [];
  return {
    kind: text(input.kind, 32) || 'exercise',
    title: goal ? (goal.met ? 'Meta atingida' : goal.streak > 0
      ? `${goal.required - goal.streak === 1 ? 'Falta 1 execução' : `Faltam ${goal.required - goal.streak} execuções`} para a meta`
      : 'Vamos consolidar este trecho') : text(input.title, 120) || (input.kind === 'song' ? 'Música concluída' : 'Prática concluída'),
    songTitle: text(input.songTitle, 140),
    mode, hands: Object.hasOwn(handNames, input.hands) ? input.hands : '',
    accuracy: listening ? null : score(input.accuracy),
    gain: listening ? 0 : (finite(input.gain) ? Math.max(0, Math.min(100, Math.round(input.gain))) : 0),
    scoreBefore: listening ? null : score(input.scoreBefore),
    scoreAfter: listening ? null : score(input.scoreAfter),
    trackBefore: listening ? null : score(input.trackBefore),
    trackAfter: listening ? null : score(input.trackAfter),
    milestones, reason: text(input.reason, 220), attemptId: text(input.attemptId, 160),
    newRecord: !listening && input.newRecord === true,
    goal, nextAction, learningProgress,
  };
}

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}

/** Non-modal feedback: the piano and the loop's count-in keep their focus and time. */
export class CompletionNotice {
  constructor({ host = document.body, onProgress, onReplay, onContinue, onError } = {}) {
    this.callbacks = { onProgress, onReplay, onContinue, onError };
    this.host = element('aside', 'completion-notice');
    this.host.hidden = true;
    this.host.setAttribute('aria-label', 'Resultado da prática');
    this.announcement = element('span', 'completion-sr');
    this.announcement.setAttribute('role', 'status');
    this.announcement.setAttribute('aria-live', 'polite');
    this.announcement.setAttribute('aria-atomic', 'true');
    this.content = element('div', 'completion-content');
    this.host.append(this.announcement, this.content);
    host.append(this.host);
    // Give someone using the actions time to read and operate them.
    this.host.addEventListener('pointerenter', () => { clearTimeout(this.timer); });
    this.host.addEventListener('focusin', () => { clearTimeout(this.timer); });
    this.seen = new Set();
    this._escape = event => {
      if (event.key !== 'Escape' || this.host.hidden || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      event.preventDefault(); event.stopPropagation(); this.clear();
    };
    document.addEventListener('keydown', this._escape, true);
  }

  /** Returns false for a repeated notification from the same saved attempt. */
  show(input, { compact = false, durationMs } = {}) {
    if (this.destroyed) return false;
    const result = normalizeCompletion(input);
    if (compact && result.goal?.streak > 0 && !result.goal.met) result.title = `Boa execução · ${result.goal.streak}/${result.goal.required}`;
    const key = result.attemptId ? `${result.attemptId}|${result.kind}|${result.gain}|${result.milestones.map(value => value.id || value.title).join(',')}` : '';
    if (key && this.seen.has(key)) return false;
    this.clear();
    this.origin = document.activeElement;
    if (key) { this.seen.add(key); if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value); }
    this.result = result;
    const guided = !!(result.goal || result.learningProgress || result.nextAction);
    if (durationMs === undefined) durationMs = compact ? 4200 : guided ? 0 : 14000;
    const learningGain = result.learningProgress?.before !== null && result.learningProgress?.before !== undefined
      ? Math.max(0, result.learningProgress.after - result.learningProgress.before) : 0;
    this.host.classList.toggle('completion-compact', compact);
    this.host.classList.toggle('completion-guided', guided);
    this.host.classList.toggle('completion-consolidate', !!result.goal && !result.goal.met && result.goal.streak === 0);
    this.host.classList.toggle('completion-advancing', !!result.goal && !result.goal.met && result.goal.streak > 0);
    this.host.classList.toggle('completion-earned', result.goal ? result.goal.met : learningGain > 0 || result.gain > 0 || result.milestones.length > 0 || result.newRecord);
    this.host.dataset.kind = result.kind;
    this.host.dataset.attempt = result.attemptId;
    const close = this._button('×', () => this.clear(), 'completion-close');
    close.setAttribute('aria-label', 'Fechar resultado da prática');
    const head = element('div', 'completion-head');
    const seal = element('span', 'completion-seal', result.goal ? result.goal.met ? '✓' : result.goal.streak > 0 ? '↗' : '↻' : result.milestones.length || result.newRecord ? '✦' : '✓');
    seal.setAttribute('aria-hidden', 'true');
    const heading = element('div', 'completion-heading');
    const title = element('h3', 'completion-title', result.title); title.id = `completion-${++sequence}`;
    this.host.setAttribute('aria-labelledby', title.id);
    heading.append(title);
    if (result.songTitle) heading.append(element('p', 'completion-song', result.songTitle));
    head.append(seal, heading, close); this.content.append(head);

    const route = [modeNames[result.mode], handNames[result.hands]].filter(Boolean).join(' · ');
    const metrics = element('div', 'completion-metrics');
    if (guided && learningGain > 0) metrics.append(element('strong', 'completion-gain', `+${learningGain} no progresso de estudo`));
    else if (!guided && result.gain > 0) metrics.append(element('strong', 'completion-gain', `+${result.gain} pts no percurso`));
    if (result.accuracy !== null) metrics.append(element('span', 'completion-accuracy', `${result.accuracy}% de precisão`));
    if (result.newRecord && (!guided || learningGain > 0) && (!result.goal || result.goal.met)) metrics.append(element('span', 'completion-record', 'Novo recorde'));
    if (metrics.childElementCount) this.content.append(metrics);

    if (result.goal) {
      const goal = element('div', 'completion-goal');
      const ring = element('span', 'completion-goal-ring', `${result.goal.streak}/${result.goal.required}`);
      ring.style.setProperty('--completion-goal-fill', `${result.goal.streak / result.goal.required * 100}%`);
      ring.setAttribute('role', 'img'); ring.setAttribute('aria-label', `${result.goal.streak} de ${result.goal.required} execuções seguidas atingiram a meta`);
      const copy = element('div', 'completion-goal-copy');
      copy.append(element('strong', '', result.goal.met ? 'Meta conquistada' : result.goal.streak > 0 ? 'Você está avançando' : 'Sua meta continua aqui'), element('span', '', result.goal.label));
      goal.append(ring, copy); this.content.append(goal);
    }
    if (!compact && result.learningProgress) {
      const panel = element('div', 'completion-learning');
      const label = element('div', 'completion-track-label');
      label.append(element('span', '', result.learningProgress.label), element('strong', '', `${result.learningProgress.value}/100`));
      const progress = element('progress', 'completion-meter completion-learning-meter'); progress.max = 100; progress.value = result.learningProgress.value;
      progress.setAttribute('aria-label', 'Progresso de estudo da música');
      panel.append(label, progress); this.content.append(panel);
    }
    const details = !compact && guided ? element('details', 'completion-details') : null;
    if (details) details.append(element('summary', '', 'Detalhes da prática'));
    const detailHost = details || this.content;
    if (details && result.gain > 0) detailHost.append(element('p', 'completion-route', `+${result.gain} pontos no percurso ${route || 'praticado'}.`));
    if (!compact && result.trackAfter !== null) {
      const panel = element('div', 'completion-track');
      const label = element('div', 'completion-track-label');
      label.append(element('span', '', route || 'Seu percurso'), element('strong', '', `${result.trackAfter}/100`));
      const progress = element('progress', 'completion-meter'); progress.max = 100; progress.value = result.trackAfter;
      progress.setAttribute('aria-label', route ? `Pontuação em ${route}` : 'Pontuação do percurso');
      panel.append(label, progress);
      if (result.trackBefore !== null && result.trackAfter > result.trackBefore) panel.append(element('small', '', `Você avançou de ${result.trackBefore} para ${result.trackAfter} pontos neste percurso.`));
      detailHost.append(panel);
    } else if (route) this.content.append(element('p', 'completion-route', route));

    if (!compact && result.scoreAfter !== null) {
      const changed = result.scoreBefore !== null && result.scoreAfter > result.scoreBefore;
      detailHost.append(element('p', 'completion-song-score', guided ? (changed
        ? `Avaliação de execução: ${result.scoreBefore} → ${result.scoreAfter}/100`
        : `Avaliação de execução: ${result.scoreAfter}/100`) : (changed
        ? `Score da música: ${result.scoreBefore} → ${result.scoreAfter}/100`
        : `Score da música: ${result.scoreAfter}/100`)));
    }
    if (result.milestones.length) {
      const list = element('ul', 'completion-milestones');
      for (const [index, milestone] of result.milestones.slice(0, compact ? 1 : 4).entries()) {
        const item = element('li'); item.append(element('strong', '', `✓ ${milestone.title}`));
        if (!compact && index === 0 && milestone.description) item.append(element('span', '', milestone.description));
        list.append(item);
      }
      (guided && !compact ? detailHost : this.content).append(list);
    }
    if (!compact && result.reason && result.gain === 0) detailHost.append(element('p', 'completion-reason', result.reason));
    if (details?.childElementCount > 1) this.content.append(details);
    if (!compact) {
      if (result.nextAction?.description) this.content.append(element('p', 'completion-next-description', result.nextAction.description));
      const actions = element('div', 'completion-actions');
      actions.append(this._button(result.nextAction?.label || 'Continuar', () => this._action('onContinue', result), 'completion-continue'));
      if (typeof this.callbacks.onProgress === 'function') actions.append(this._button('Ver progresso', () => this._action('onProgress', result), 'completion-progress'));
      if (typeof this.callbacks.onReplay === 'function') actions.append(this._button('Praticar novamente', () => this._action('onReplay', result), 'completion-replay'));
      this.content.append(actions);
    }
    this.host.hidden = false;
    const spoken = [result.title, guided ? (learningGain > 0 ? `Mais ${learningGain} no progresso de estudo.` : '') : (result.gain > 0 ? `Mais ${result.gain} pontos no percurso.` : ''), result.accuracy !== null ? `Precisão de ${result.accuracy} por cento.` : '', result.goal ? `${result.goal.streak} de ${result.goal.required} execuções seguidas. ${result.goal.label}` : '', result.nextAction ? `Próximo passo: ${result.nextAction.label}.` : '', ...result.milestones.map(value => value.title)].filter(Boolean).join(' ');
    this.announcement.textContent = spoken;
    if (finite(durationMs) && durationMs > 0) this.timer = setTimeout(() => this.clear(), Math.max(500, durationMs));
    return true;
  }

  _button(label, action, className) {
    const button = element('button', className, label); button.type = 'button';
    button.addEventListener('click', action); return button;
  }

  _action(name, result) {
    this.clear();
    try {
      const pending = this.callbacks[name]?.(result);
      if (pending && typeof pending.catch === 'function') pending.catch(error => this.callbacks.onError?.(error));
    } catch (error) { this.callbacks.onError?.(error); }
  }

  clear() {
    clearTimeout(this.timer); this.timer = null;
    const returnFocus = this.host.contains(document.activeElement) && this.origin?.isConnected;
    this.host.hidden = true;
    this.content.replaceChildren(); this.announcement.textContent = '';
    this.result = null;
    if (returnFocus) this.origin.focus({ preventScroll: true });
    this.origin = null;
  }

  destroy() {
    this.clear(); this.destroyed = true;
    document.removeEventListener('keydown', this._escape, true);
    this.host.remove(); this.seen.clear();
  }
}
