import { summarizeProgress } from './music/progress.js';
import { renderAchievements } from './achievement-panel.js';

const clock = seconds => `${Math.floor(Math.max(0, seconds || 0) / 60)}:${String(Math.floor(Math.max(0, seconds || 0) % 60)).padStart(2, '0')}`;
const timeLabel = seconds => seconds >= 3600 ? `${Math.floor(seconds / 3600)} h ${Math.floor(seconds % 3600 / 60)} min` : seconds >= 60 ? `${Math.floor(seconds / 60)} min` : `${Math.round(seconds)} s`;
const percentage = value => value === null || value === undefined ? '—' : `${value}%`;
const dateLabel = date => date ? new Date(date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Ainda sem prática';
const modeLabels = { melody: 'Melodia guiada', rhythm: 'Ritmo', recital: 'Recital' };
const handsLabels = { both: 'duas mãos', left: 'mão esquerda', right: 'mão direita' };
const pitchName = midi => `${['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'][midi % 12]}${Math.floor(midi / 12) - 1}`;
function node(tag, className, text) {
  const element = document.createElement(tag); if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text); return element;
}
function button(text, action, className = '') { const element = node('button', className, text); element.type = 'button'; element.addEventListener('click', action); return element; }
function metric(label, value, detail) { const element = node('div', `music-progress-metric${String(value).length > 12 ? ' long-value' : ''}`); element.append(node('span', '', label), node('strong', '', value)); if (detail) element.append(node('small', '', detail)); return element; }
function sparkline(points) {
  const values = points.filter(point => point.accuracy !== null); if (!values.length) return node('p', 'music-progress-note', 'Toque as notas de um exercício para registrar sua evolução.');
  const figure = node('figure', 'music-progress-chart');
  figure.append(node('figcaption', '', 'Evolução da precisão por sessão'));
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 600 115'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', values.map(point => `${dateLabel(point.date)}: ${point.accuracy}%`).join('; '));
  for (const value of [0, 50, 100]) {
    const line = document.createElementNS(ns, 'line'); line.setAttribute('x1', 35); line.setAttribute('x2', 590); line.setAttribute('y1', 92 - value * .8); line.setAttribute('y2', 92 - value * .8); line.classList.add('progress-grid-line'); svg.append(line);
    const label = document.createElementNS(ns, 'text'); label.setAttribute('x', 2); label.setAttribute('y', 96 - value * .8); label.textContent = `${value}%`; svg.append(label);
  }
  const positions = values.map((point, index) => [40 + index / Math.max(1, values.length - 1) * 545, 92 - point.accuracy * .8]);
  const path = document.createElementNS(ns, 'polyline'); path.setAttribute('points', positions.map(point => point.join(',')).join(' ')); path.classList.add('progress-line'); svg.append(path);
  positions.forEach(([x, y], index) => { const dot = document.createElementNS(ns, 'circle'); dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', 3); const title = document.createElementNS(ns, 'title'); title.textContent = `${dateLabel(values[index].date)} · ${values[index].accuracy}%`; dot.append(title); svg.append(dot); });
  figure.append(svg, node('small', '', 'Cada ponto reúne as repetições de uma sessão. Modo, mãos e andamento podem alterar a dificuldade.')); return figure;
}

/** A compact song summary replaces the old flat list of every loop attempt. */
export class ProgressPanel {
  constructor({ host, onPractice = () => {}, onOpenSong = () => {}, onError = () => {}, getAchievements = null, getLearningProgress = null, onPracticePath = () => {} }) {
    if (!host) throw new Error('O painel de progresso precisa de um contêiner.');
    this.host = host; this.onPractice = onPractice; this.onOpenSong = onOpenSong; this.onError = onError;
    this.getAchievements = getAchievements; this.onPracticePath = onPracticePath; this.achievementSummaries = new Map();
    this.getLearningProgress = getLearningProgress; this.learningSummaries = new Map();
    this.query = ''; this.sort = 'recent'; this.showUnpracticed = false; this.expanded = new Set();
    this.songs = []; this.history = []; this.profile = 'Meu perfil';
  }
  focusSong(songId) {
    if (!this.summary?.songs.some(song => song.songId === songId)) return;
    this.focusedSongId = songId; this.expanded.add(songId); this.renderSongs();
    [...this.results.children].find(card => card.dataset.songId === songId)?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  setData(songs, history, { profile = 'Meu perfil' } = {}) {
    if (profile !== this.profile) { this.expanded.clear(); this.focusedSongId = null; }
    this.songs = songs || []; this.history = history || []; this.profile = profile;
    this.summary = summarizeProgress(this.songs, this.history, { profile }); this.render(); return this;
  }
  async action(callback, value) { try { await callback(value); } catch (error) { this.onError(error); } }
  cacheAchievements() {
    this.achievementSummaries.clear();
    if (typeof this.getAchievements !== 'function') return;
    for (const song of this.songs) {
      try {
        const summary = this.getAchievements(song, this.profile);
        if (summary && typeof summary === 'object') this.achievementSummaries.set(song.id, summary);
      } catch (error) { this.onError(error); }
    }
  }
  cacheLearningProgress() {
    this.learningSummaries.clear();
    if (typeof this.getLearningProgress !== 'function') return;
    for (const song of this.songs) {
      try {
        const progress = this.getLearningProgress(song, this.profile);
        if (!progress || typeof progress !== 'object') continue;
        const value = typeof progress.value === 'number' && Number.isFinite(progress.value) ? Math.max(0, Math.min(100, Math.round(progress.value))) : null;
        const detail = typeof progress.detail === 'string' ? progress.detail : typeof progress.description === 'string' ? progress.description : '';
        this.learningSummaries.set(song.id, { value, label: 'Progresso de estudo', detail: detail.slice(0, 2000) });
      } catch (error) { this.onError(error); }
    }
  }
  hasAchievements(songId) {
    const summary = this.achievementSummaries.get(songId);
    return summary?.totalPoints > 0 || summary?.evaluatedPaths > 0;
  }
  render() {
    // A summary fingerprints all song notes. Reuse it for filtering, totals and
    // cards, including search updates, until fresh source data is supplied.
    this.cacheAchievements();
    this.cacheLearningProgress();
    this.host.classList.add('music-progress'); this.host.replaceChildren();
    const data = this.summary || summarizeProgress(this.songs, this.history, { profile: this.profile });
    const totals = node('div', 'music-progress-totals');
    const practicedSongs = data.songs.filter(song => song.attempts > 0 || this.hasAchievements(song.songId)).length;
    const guided = typeof this.getLearningProgress === 'function';
    totals.append(metric('Músicas praticadas', practicedSongs), metric('Sessões', data.totals.sessions, `${data.totals.attempts} tentativas e repetições com histórico disponível`), metric('Tempo de prática', timeLabel(data.totals.seconds), 'Conforme o histórico disponível'), metric(guided ? 'Músicas com progresso' : 'Músicas avaliadas', guided ? [...this.learningSummaries.values()].filter(progress => progress.value > 0).length : data.totals.scoredSongs));
    this.host.append(totals);
    const controls = node('div', 'music-progress-controls'), search = node('input'); search.type = 'search'; search.placeholder = 'Buscar música no progresso'; search.setAttribute('aria-label', 'Buscar música no progresso'); search.value = this.query;
    // Refresh just the results while typing, preserving the focused search field.
    search.addEventListener('input', () => { this.query = search.value; this.focusedSongId = null; this.renderSongs(); });
    const sort = node('select'); sort.setAttribute('aria-label', 'Ordenar progresso');
    for (const [value, label] of [['recent', 'Última prática'], ['title', 'Nome da música'], ['score', guided ? 'Maior progresso' : 'Maior score'], ['time', 'Mais tempo de prática']]) { const option = node('option', '', label); option.value = value; sort.append(option); }
    sort.value = this.sort; sort.addEventListener('change', () => { this.sort = sort.value; this.renderSongs(); });
    const unpracticed = node('label', 'music-progress-check'), checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = this.showUnpracticed; checkbox.addEventListener('change', () => { this.showUnpracticed = checkbox.checked; this.renderSongs(); }); unpracticed.append(checkbox, document.createTextNode('Incluir músicas sem prática'));
    controls.append(search, sort, unpracticed); this.host.append(controls);
    this.results = node('div', 'music-progress-results'); this.results.setAttribute('aria-live', 'polite'); this.host.append(this.results);
    this.host.append(node('p', 'music-progress-note', guided
      ? 'Seu progresso de estudo reúne os melhores resultados de Melodia, Ritmo e Recital. Uma sessão reúne suas repetições na mesma visita à música; a precisão e os pontos de atenção ajudam a escolher o próximo treino.'
      : 'Uma sessão reúne suas repetições na mesma visita à música. Registros antigos são agrupados quando a pausa entre eles é menor que 30 minutos. Concluir uma tarefa de estudo e obter um score são registros diferentes.'));
    this.renderSongs();
  }
  renderSongs() {
    if (!this.results) return;
    this.results.replaceChildren();
    const query = this.query.trim().toLocaleLowerCase('pt-BR'), songs = (this.summary?.songs || []).filter(song => song.songId === this.focusedSongId || (this.showUnpracticed || song.attempts > 0 || this.hasAchievements(song.songId)) && song.title.toLocaleLowerCase('pt-BR').includes(query));
    const scoreOf = song => this.learningSummaries.has(song.songId) ? this.learningSummaries.get(song.songId).value : typeof this.getLearningProgress === 'function' ? null : song.score;
    const comparators = { recent: (a, b) => b.lastPracticeMs - a.lastPracticeMs, title: (a, b) => a.title.localeCompare(b.title, 'pt-BR'), score: (a, b) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1), time: (a, b) => b.seconds - a.seconds };
    songs.sort(comparators[this.sort] || comparators.recent);
    if (!songs.length) { this.results.append(node('p', 'music-progress-empty', query ? 'Nenhuma música corresponde à busca.' : 'Seu progresso aparecerá por música. Escolha Melodia, Ritmo ou Recital para começar.')); return; }
    for (const song of songs) this.results.append(this.songCard(song));
  }
  songCard(song) {
    const achievements = this.achievementSummaries.get(song.songId), achievementsOnly = !song.attempts && this.hasAchievements(song.songId);
    const guided = typeof this.getLearningProgress === 'function', learning = this.learningSummaries.get(song.songId);
    const card = node('details', 'music-progress-card'); card.dataset.songId = song.songId; card.open = this.expanded.has(song.songId);
    card.addEventListener('toggle', () => card.open ? this.expanded.add(song.songId) : this.expanded.delete(song.songId));
    const summary = node('summary'), heading = node('div', 'music-progress-title'); heading.append(node('strong', '', song.title), node('small', '', achievementsOnly ? 'Conquistas preservadas · data da prática indisponível' : `Última prática: ${dateLabel(song.lastPracticeAt)}`));
    const score = node('div', 'music-progress-score'); score.title = guided ? learning?.detail || 'Progresso de estudo em Melodia, Ritmo e Recital.' : song.scoreExplanation;
    score.append(node('strong', '', guided ? learning?.value === null || learning?.value === undefined ? '—' : `${learning.value}/100` : song.score === null ? '—' : `${song.score}/100`), node('small', '', guided ? 'Progresso de estudo' : song.masteryLabel));
    const overview = node('div', 'music-progress-overview'); overview.append(node('span', '', achievementsOnly ? 'Sem histórico detalhado de sessões' : `${song.sessions} ${song.sessions === 1 ? 'sessão' : 'sessões'} · ${timeLabel(song.seconds)}`), node('span', '', `Precisão recente ${percentage(song.recentAccuracy)}`));
    if (!guided && this.hasAchievements(song.songId)) overview.append(node('span', '', `${Math.round(achievements.totalPoints || 0)} pontos conquistados`));
    summary.append(heading, overview, score); card.append(summary);
    const body = node('div', 'music-progress-body'), metrics = node('div', 'music-progress-metrics');
    const trend = song.trend === null ? 'Aguardando comparação' : `${song.trend > 0 ? '+' : ''}${song.trend} p.p.`;
    metrics.append(metric('Tentativas', song.attempts, 'Inclui loops e trechos parciais'), metric('Precisão total', percentage(song.accuracy), 'Acertos / acertos, erros e perdas'), metric('Evolução comparável', trend, song.trend === null ? 'Ao menos 4 sessões no mesmo contexto' : `${modeLabels[song.trendContext.mode]} · ${handsLabels[song.trendContext.hands]}`), metric('Cobertura avaliada', `${Math.round(song.coverage * 100)}%`, `${Math.round(song.studiedCoverage * 100)}% concluídos em algum modo`));
    const technical = guided ? node('details', 'music-progress-advanced') : body;
    if (guided) {
      if (learning?.detail) body.append(node('p', 'music-progress-note music-progress-learning-detail', learning.detail));
      technical.append(node('summary', '', 'Avaliação de execução e percursos'));
      metrics.prepend(metric('Avaliação de execução', song.score === null ? 'Ainda sem medição' : `${song.score}/100`, song.masteryLabel));
    }
    technical.append(metrics, node('p', 'music-progress-note', song.scoreExplanation));
    if (achievements) technical.append(renderAchievements(achievements, { songId: song.songId, onPractice: value => this.action(this.onPracticePath, value), onError: this.onError }));
    if (guided) body.append(technical);
    if (achievementsOnly) body.append(node('p', 'music-progress-note', 'As conquistas desta música foram preservadas. O histórico detalhado não está disponível; os totais de sessões, tempo e a precisão recente mostram somente os registros disponíveis.'));
    body.append(sparkline(song.evolution));
    const actions = node('div', 'music-progress-actions'); actions.append(button('Abrir música', () => this.action(this.onOpenSong, song.songId))); body.append(actions);
    const hotspotHeading = node('h3', '', `Pontos de atenção · últimas ${song.hotspotSessions} sessões`); body.append(hotspotHeading);
    if (!song.hotspots.length) body.append(node('p', 'music-progress-note', song.attempts ? 'Sem erros localizados registrados. Novas práticas registrarão o ponto da música e o tipo do erro; o histórico antigo contém apenas os totais.' : 'Pratique esta música para identificar os trechos que precisam de revisão.'));
    for (const hotspot of song.hotspots.slice(0, 6)) {
      const item = node('article', 'music-progress-hotspot'), title = node('div', 'music-progress-hotspot-title');
      title.append(node('strong', '', `${clock(hotspot.start)}–${clock(hotspot.end)}`), node('span', `music-progress-badge ${hotspot.recurrence === 'across-sessions' ? 'recurring' : ''}`, hotspot.recurrence === 'across-sessions' ? `Recorre em ${hotspot.sessions} sessões` : hotspot.recurrence === 'within-session' ? `Repete em ${hotspot.attempts} tentativas` : 'Ocorrência isolada'));
      item.append(title, node('p', '', `${hotspot.reasonLabel} · ${hotspot.errors} ${hotspot.errors === 1 ? 'ocorrência' : 'ocorrências'} em ${hotspot.attempts} ${hotspot.attempts === 1 ? 'tentativa' : 'tentativas'}${hotspot.phraseName ? ` · ${hotspot.phraseName}` : ''}`), node('small', '', `${hotspot.expectedPitches.length ? `Notas esperadas: ${hotspot.expectedPitches.map(pitchName).join(' · ')}. ` : ''}${hotspot.instruction}`), button('Praticar este ponto', () => this.action(this.onPractice, { songId: song.songId, start: hotspot.start, end: hotspot.end, hotspot, instruction: hotspot.instruction })));
      body.append(item);
    }
    if (song.errorEventsDropped) body.append(node('p', 'music-progress-note', 'O mapa usa os detalhes disponíveis: algumas tentativas muito longas excederam o limite de locais registrados. Os totais de erros continuam completos.'));
    const sessions = node('details', 'music-progress-sessions'); sessions.append(node('summary', '', `Últimas sessões agregadas${song.estimatedSessions ? ' · inclui agrupamentos antigos estimados' : ''}`));
    for (const session of song.sessionHistory) { const row = node('div', 'music-progress-session'); row.append(node('span', '', `${dateLabel(session.date)}${session.estimated ? ' · estimada' : ''}`), node('span', '', `${session.attempts} tentativas · ${timeLabel(session.seconds)}`), node('strong', '', percentage(session.accuracy))); sessions.append(row); }
    body.append(sessions); card.append(body); return card;
  }
  destroy() { this.host.replaceChildren(); }
}
