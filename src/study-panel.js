import { analyzePatterns } from './music/patterns.js';
import { buildStudyPlan } from './music/study-plan.js';

const copy = value => structuredClone(value);
const clock = seconds => {
  const value = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
};
const range = phrase => `${clock(phrase.start)}–${clock(phrase.end)}`;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const relation = { original: 'Primeira apresentação', exact: 'Repetição', transposed: 'Mesmo desenho em outra altura', variation: 'Variação', unique: 'Trecho próprio' };
const colors = ['#a9e5bc', '#baa7ef', '#9bcef0', '#e7bd91', '#e6a8c1', '#c7d78b'];
const pitchName = midi => `${['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'][Math.round(midi) % 12]}${Math.floor(midi / 12) - 1}`;
let counter = 0;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}
function button(text, action, className = '') {
  const element = node('button', className, text); element.type = 'button';
  element.addEventListener('click', action); return element;
}
function paragraph(text, className = '') { return node('p', className, text); }
function detailList(values) {
  const list = node('ul', 'study-details');
  for (const value of values.filter(Boolean)) list.append(node('li', '', value));
  return list;
}

function contourPreview(features, label) {
  const intervals = features?.intervals;
  if (!Array.isArray(intervals) || !intervals.length || !finite(features.firstPitch)) return null;
  const pitches = [features.firstPitch], beats = [0];
  for (const [i, interval] of intervals.slice(0, 64).entries()) {
    if (!finite(interval)) break;
    pitches.push(pitches.at(-1) + interval); beats.push(beats.at(-1) + Math.max(.025, Number(features.rhythm?.[i]) || 1));
  }
  const low = Math.min(...pitches), high = Math.max(...pitches), duration = beats.at(-1) || 1;
  const host = node('figure', 'study-contour');
  const caption = node('figcaption', '', label); host.append(caption);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 600 72'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${label}: ${pitches.length} ataques, de ${pitchName(low)} a ${pitchName(high)}. A altura da linha segue a altura das notas; a distância horizontal segue o ritmo.`);
  const positions = pitches.map((pitch, i) => [8 + beats[i] / duration * 584, 61 - (high === low ? .5 : (pitch - low) / (high - low)) * 50]);
  const line = document.createElementNS(svg.namespaceURI, 'polyline'); line.setAttribute('points', positions.map(point => point.join(',')).join(' ')); line.setAttribute('fill', 'none'); line.setAttribute('vector-effect', 'non-scaling-stroke'); svg.append(line);
  for (const [x, y] of positions) { const dot = document.createElementNS(svg.namespaceURI, 'circle'); dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', 2.7); svg.append(dot); }
  host.append(svg); return host;
}

/** A manual grouping changes interpretation only; the MIDI and phrase boundaries stay intact. */
export function reviewPatternFamily(input, phraseId, targetPatternId) {
  const analysis = copy(input);
  if (!Array.isArray(analysis?.phrases) || !Array.isArray(analysis.patterns)) throw new Error('Analise a estrutura antes de revisar as famílias.');
  const phrase = analysis.phrases.find(item => item.id === phraseId);
  if (!phrase) throw new Error('Frase não encontrada nesta análise.');
  let pattern = analysis.patterns.find(item => item.id === targetPatternId);
  if (targetPatternId && !pattern) throw new Error('Escolha uma família existente ou crie uma nova.');
  if (!pattern) {
    const used = new Set(analysis.patterns.map(item => item.id)); let suffix = 1;
    while (used.has(`review-${suffix}`)) suffix++;
    const labels = new Set(analysis.patterns.map(item => item.label)); let labelIndex = 0;
    while (labels.has(String.fromCharCode(65 + labelIndex % 26) + (labelIndex < 26 ? '' : Math.floor(labelIndex / 26)))) labelIndex++;
    const label = String.fromCharCode(65 + labelIndex % 26) + (labelIndex < 26 ? '' : Math.floor(labelIndex / 26));
    pattern = { id: `review-${suffix}`, label, representativePhraseId: phrase.id, occurrences: [], confidence: 0, description: 'Família criada na revisão.', features: copy(phrase.features || {}), manualReview: true };
    analysis.patterns.push(pattern);
  }
  if (phrase.patternId === pattern.id) return analysis;
  const previous = analysis.patterns.find(item => item.id === phrase.patternId);
  if (previous) previous.manualReview = true;
  pattern.manualReview = true;
  phrase.patternId = pattern.id;
  phrase.variant = 'variation'; phrase.similarity = 0; phrase.transpose = 0;
  phrase.comparison = { summary: 'Agrupamento ajustado manualmente. Compare as notas e o ritmo para confirmar.' };
  phrase.manualReview = true;
  analysis.reviewed = true;
  rebuildGroups(analysis);
  return analysis;
}

export function renamePatternFamily(input, patternId, label) {
  const value = typeof label === 'string' ? label.trim().slice(0, 24) : '';
  if (!value) throw new Error('Dê um nome à família.');
  const analysis = copy(input), pattern = analysis.patterns?.find(item => item.id === patternId);
  if (!pattern) throw new Error('Família não encontrada nesta análise.');
  if (analysis.patterns.some(item => item.id !== patternId && item.label.toLocaleLowerCase() === value.toLocaleLowerCase())) throw new Error('Outra família já usa esse nome.');
  pattern.label = value; pattern.manualReview = true; analysis.reviewed = true;
  rebuildGroups(analysis); return analysis;
}

function rebuildGroups(analysis) {
  analysis.patterns = analysis.patterns.filter(pattern => {
    const phrases = analysis.phrases.filter(phrase => phrase.patternId === pattern.id).sort((a, b) => a.start - b.start);
    if (!phrases.length) return false;
    pattern.occurrences = phrases.map(phrase => phrase.id);
    if (!pattern.occurrences.includes(pattern.representativePhraseId)) {
      pattern.representativePhraseId = phrases[0].id;
      pattern.features = copy(phrases[0].features || {});
      pattern.manualReview = true;
      for (const phrase of phrases) {
        phrase.manualReview = true; phrase.variant = 'variation'; phrase.similarity = 0; phrase.transpose = 0;
        phrase.comparison = { summary: 'A referência desta família foi ajustada na revisão. Confira os intervalos e o ritmo novamente.' };
      }
    }
    for (const phrase of phrases) {
      const representative = phrase.id === pattern.representativePhraseId;
      phrase.referencePhraseId = representative ? null : pattern.representativePhraseId;
      if (representative && phrase.manualReview) { phrase.variant = 'original'; phrase.comparison = null; }
      phrase.patternLabel = `${pattern.label}${!representative && phrase.variant === 'variation' ? '′' : ''}`;
    }
    if (pattern.manualReview) pattern.description = `Família revisada manualmente com ${phrases.length} ${phrases.length === 1 ? 'apresentação' : 'apresentações'}. Compare os trechos para confirmar os intervalos e o ritmo.`;
    return true;
  });
  analysis.form = analysis.phrases.map(phrase => ({ phraseId: phrase.id, patternId: phrase.patternId, label: phrase.patternLabel, start: phrase.start, end: phrase.end }));
}

/** Musical-structure review and actionable study sessions for one unchanged song. */
export class StudyPanel {
  constructor({ host, getTime = () => 0, getHistory = () => [], getProfile = () => 'Meu perfil', onOpen = () => {}, onAnalyze, onApply = () => {}, onPractice = () => {}, onPreview = () => {}, onCompare, onEditBoundaries = () => {}, onSaveProgress = () => {}, onError = () => {} }) {
    if (!host) throw new TypeError('Informe o elemento que recebe o painel de estudo.');
    Object.assign(this, { host, getTime, getHistory, getProfile, onOpen, onAnalyze, onApply, onPractice, onPreview, onCompare, onEditBoundaries, onSaveProgress, onError });
    this.song = null; this.analysis = null; this.draft = null; this.progress = null;
    this.epoch = 0; this.previewEpoch = 0; this.dirty = false; this.tab = 'structure'; this.sessionMinutes = 20; this.targetPatternId = null;
    this.build();
  }

  build() {
    const id = ++counter;
    this.host.classList.add('study-panel');
    this.openButton = button('Estrutura e estudo', () => this.open(), 'study-open');
    this.summary = node('span', 'study-bar-summary');
    this.host.replaceChildren(this.openButton, this.summary);
    this.dialog = node('dialog', 'study-dialog');
    this.dialog.setAttribute('aria-labelledby', `study-heading-${id}`);
    this.dialog.innerHTML = `<div class="study-heading"><div><p class="study-eyebrow">RECONHECER · COMPREENDER · PRATICAR</p><h2 id="study-heading-${id}">Estrutura e estudo</h2><p class="study-song-title"></p></div><button type="button" class="study-close" aria-label="Fechar estrutura e estudo">✕</button></div>
      <p class="study-intro">Descubra o que se repete, o que muda e por onde começar. A divisão acompanha a melodia de cada música e pode ser revisada.</p>
      <div class="study-analysis-tools"><label>Melodia para comparar<select class="study-source" aria-label="Pista da melodia para analisar"><option value="">Detectar automaticamente</option></select></label><button type="button" class="study-analyze primary">Analisar padrões da música</button><button type="button" class="study-boundaries">Revisar limites das frases</button></div>
      <div class="study-tabs" role="tablist" aria-label="Estrutura e plano de estudo"><button type="button" class="study-tab" data-tab="structure" role="tab" id="study-tab-structure-${id}" aria-controls="study-structure-${id}" aria-selected="true">Estrutura musical</button><button type="button" class="study-tab" data-tab="plan" role="tab" id="study-tab-plan-${id}" aria-controls="study-plan-${id}" aria-selected="false" tabindex="-1">Plano e exercícios</button></div>
      <section class="study-structure" id="study-structure-${id}" role="tabpanel" aria-labelledby="study-tab-structure-${id}"></section><section class="study-plan" id="study-plan-${id}" role="tabpanel" aria-labelledby="study-tab-plan-${id}" hidden></section>
      <p class="study-status" role="status" aria-live="polite"></p><div class="study-footer"><span class="study-save-hint">O MIDI continua inteiro. Salve a revisão para usar os exercícios.</span><button type="button" class="study-cancel">Fechar</button><button type="button" class="study-save primary">Salvar estrutura revisada</button></div>`;
    document.body.append(this.dialog);
    this.dialog.querySelector('.study-close').addEventListener('click', () => this.close());
    this.dialog.querySelector('.study-cancel').addEventListener('click', () => this.close());
    this.dialog.addEventListener('cancel', () => { this.epoch++; this.stopPreview(); });
    this.dialog.addEventListener('close', () => { this.epoch++; this.stopPreview(); this.busy = false; });
    this.dialog.querySelector('.study-analyze').addEventListener('click', () => this.analyze());
    this.dialog.querySelector('.study-save').addEventListener('click', () => this.save());
    this.dialog.querySelector('.study-boundaries').addEventListener('click', () => {
      if (this.dirty) { this.setStatus('Salve a estrutura ou feche sem salvar antes de revisar os limites.'); return; }
      this.close(); this.safe(() => this.onEditBoundaries());
    });
    const tabs = [...this.dialog.querySelectorAll('.study-tab')];
    for (const tab of tabs) {
      tab.addEventListener('click', () => this.selectTab(tab.dataset.tab));
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(tabs.indexOf(tab) + 1) % tabs.length];
        this.selectTab(next.dataset.tab); next.focus();
      });
    }
    this.renderBar();
  }

  get hasAnalysis() { return !!(this.draft?.phrases?.length && this.draft?.patterns?.length); }
  setSong(song) {
    const changed = this.song?.id !== song?.id;
    if (changed && this.dialog.open) this.close();
    this.song = song || null;
    this.analysis = song?.phrasing?.patterns?.length ? copy(song.phrasing) : null;
    if (changed) { this.draft = null; this.progress = null; this.dirty = false; this.selectedPhraseId = null; this.targetPatternId = null; }
    this.renderBar();
  }
  setAnalysis(analysis) {
    this.analysis = analysis?.patterns?.length ? copy(analysis) : null;
    if (this.dialog.open && !this.dirty) { this.draft = this.analysis ? copy(this.analysis) : null; this.render(); }
    this.renderBar();
  }
  setProgress(progress) { this.progress = progress ? copy(progress) : null; if (this.dialog.open) this.renderPlan(); }
  refreshProgress() { if (this.dialog.open) this.renderPlan(); }
  renderBar() {
    this.openButton.disabled = !(this.song?.duration > 0);
    const patterns = this.analysis?.patterns, phrases = this.analysis?.phrases;
    this.summary.textContent = patterns?.length ? `${patterns.length} famílias · ${phrases.length} frases · ${phrases.length - patterns.length} reaparições` : 'Entenda as repetições e pratique com um plano';
  }

  open() {
    if (!(this.song?.duration > 0) || this.dialog.open) return;
    if (!this.safe(() => this.onOpen())) return;
    this.epoch++; this.draft = this.analysis ? copy(this.analysis) : null; this.dirty = false; this.busy = false;
    this.selectedPhraseId = this.draft?.phrases?.find(phrase => this.getTime() >= phrase.start && this.getTime() < phrase.end)?.id || this.draft?.phrases?.[0]?.id;
    this.dialog.querySelector('.study-song-title').textContent = this.song.title || 'Música';
    const select = this.dialog.querySelector('.study-source');
    const options = [new Option('Detectar automaticamente', '')];
    for (const track of this.song.tracks || []) {
      const id = track.id ?? track.index;
      if (!Number.isInteger(id)) continue;
      options.push(new Option(track.name || `Pista ${id + 1}`, String(id)));
    }
    select.replaceChildren(...options);
    select.value = this.draft?.melodyTracks?.length === 1 ? String(this.draft.melodyTracks[0]) : '';
    this.setStatus(''); this.selectTab('structure'); this.render(); this.dialog.showModal();
  }
  close() { this.epoch++; this.stopPreview(); this.dialog.close(); }
  selectTab(tab) {
    this.tab = tab;
    this.dialog.querySelector('.study-structure').hidden = tab !== 'structure';
    this.dialog.querySelector('.study-plan').hidden = tab !== 'plan';
    for (const item of this.dialog.querySelectorAll('.study-tab')) { item.setAttribute('aria-selected', String(item.dataset.tab === tab)); item.tabIndex = item.dataset.tab === tab ? 0 : -1; }
    if (tab === 'plan') this.renderPlan();
  }
  setStatus(message, error = false) { const status = this.dialog.querySelector('.study-status'); status.textContent = message; status.dataset.error = String(error); }
  safe(action) { try { action(); return true; } catch (error) { this.fail(error); return false; } }
  fail(error) { this.setStatus(error?.message || String(error), true); this.onError(error); }

  async analyze() {
    if (this.busy || !this.song) return;
    this.stopPreview(); const epoch = ++this.epoch, songId = this.song.id;
    const source = this.dialog.querySelector('.study-source').value;
    this.busy = true; this.updateControls(); this.setStatus('Comparando os desenhos melódicos e o ritmo…');
    try {
      const options = source === '' ? {} : { tracks: [Number(source)] };
      const result = await (this.onAnalyze ? this.onAnalyze(options) : analyzePatterns(this.song, options));
      if (epoch !== this.epoch || songId !== this.song?.id || !this.dialog.open) return;
      if (!result?.patterns?.length || !result?.phrases?.length) throw new Error('Não há notas melódicas suficientes para sugerir padrões. Escolha outra pista.');
      this.draft = copy(result); this.dirty = true; this.selectedPhraseId = result.phrases[0].id;
      this.render(); this.setStatus('Sugestão pronta. Ouça os retornos, confira as variações e salve a revisão.');
    } catch (error) { if (epoch === this.epoch && this.dialog.open) this.fail(error); }
    finally { if (epoch === this.epoch) { this.busy = false; this.updateControls(); } }
  }
  async save() {
    if (!this.hasAnalysis || this.busy) return;
    const epoch = this.epoch, result = copy(this.draft); this.stopPreview(); this.busy = true; this.updateControls();
    try {
      result.reviewed = true; const applied = await this.onApply(result);
      if (epoch !== this.epoch || !this.dialog.open) return;
      const saved = applied?.patterns?.length ? applied : result;
      this.analysis = copy(saved); this.draft = copy(saved); this.dirty = false;
      this.renderBar(); this.render(); this.setStatus('Estrutura salva. Abra o plano e escolha um exercício para começar.');
    } catch (error) { if (epoch === this.epoch && this.dialog.open) this.fail(error); }
    finally { if (epoch === this.epoch) { this.busy = false; this.updateControls(); } }
  }
  updateControls() {
    this.dialog.querySelector('.study-analyze').disabled = !!this.busy;
    this.dialog.querySelector('.study-source').disabled = !!this.busy;
    this.dialog.querySelector('.study-save').disabled = !this.hasAnalysis || !this.dirty || !!this.busy;
    for (const control of this.dialog.querySelectorAll('.study-structure button,.study-structure input,.study-structure select')) control.disabled = !!this.busy;
    for (const control of this.dialog.querySelectorAll('.study-check input')) control.disabled = !!this.busy || !!this.progressBusy;
    this.dialog.querySelector('.study-save-hint').textContent = this.dirty ? 'Revisão ainda não salva. Os limites e as notas originais permanecem intactos.' : 'Tudo fica na mesma música. As conclusões da análise podem ser corrigidas.';
  }
  render() { this.renderStructure(); this.renderPlan(); this.updateControls(); }
  patternColor(id) { return colors[Math.max(0, this.draft.patterns.findIndex(pattern => pattern.id === id)) % colors.length]; }
  renderStructure() {
    const host = this.dialog.querySelector('.study-structure'); host.replaceChildren();
    if (!this.hasAnalysis) {
      host.append(paragraph('A música ainda não tem um mapa de padrões. Analise a melodia para encontrar famílias de frases e seus retornos.', 'study-empty'));
      return;
    }
    const { phrases, patterns } = this.draft;
    const summary = node('div', 'study-structure-summary');
    summary.append(node('strong', '', `${patterns.length} famílias melódicas em ${phrases.length} frases`), paragraph('A mesma letra indica uma família. O símbolo ′ marca uma variação; outra altura mantém o mesmo desenho melódico. Escolha um trecho para comparar e revisar.'));
    const melodyNames = (this.draft.melodyTracks || []).map(id => this.song.tracks?.find(track => (track.id ?? track.index) === id)?.name || `Pista ${id + 1}`);
    if (melodyNames.length) summary.append(paragraph(`Melodia analisada: ${melodyNames.join(', ')}. O acompanhamento pode ter uma estrutura diferente.`, 'study-subtle'));
    host.append(summary);
    const form = node('div', 'study-form'); form.setAttribute('aria-label', 'Sequência de famílias ao longo da música');
    for (const phrase of phrases) {
      const item = button('', () => { this.selectedPhraseId = phrase.id; this.renderStructure(); }, 'study-form-item');
      item.dataset.phraseId = phrase.id; item.style.setProperty('--family-color', this.patternColor(phrase.patternId));
      item.setAttribute('aria-pressed', String(phrase.id === this.selectedPhraseId));
      item.setAttribute('aria-label', `${phrase.patternLabel || phrase.name}, ${range(phrase)}, ${relation[phrase.variant] || 'Frase'}`);
      item.append(node('b', '', phrase.patternLabel || phrase.name), node('span', '', range(phrase)));
      form.append(item);
    }
    host.append(form);
    const selected = phrases.find(phrase => phrase.id === this.selectedPhraseId) || phrases[0];
    host.append(this.renderOccurrence(selected));
    const familyHeading = node('h3', '', 'As famílias e seus retornos'); host.append(familyHeading);
    const families = node('div', 'study-families');
    for (const pattern of patterns) families.append(this.renderFamily(pattern));
    host.append(families);
    const notes = ['Sugestão calculada localmente a partir das notas, dos intervalos, do ritmo e das pausas. Uma semelhança matemática precisa da sua revisão musical.', ...(this.draft.warnings || [])];
    host.append(detailList(notes));
  }

  renderOccurrence(phrase) {
    const card = node('article', 'study-occurrence'); card.style.setProperty('--family-color', this.patternColor(phrase.patternId));
    const title = node('div', 'study-occurrence-heading'); title.append(node('h3', '', `${phrase.patternLabel || phrase.name} · ${range(phrase)}`), node('span', 'study-relation', phrase.manualReview ? 'Agrupamento revisado' : relation[phrase.variant] || 'Frase')); card.append(title);
    const features = phrase.features || {};
    const info = [];
    if (phrase.comparison?.summary) info.push(phrase.comparison.summary);
    if (phrase.reason) info.push(`Justificativa do limite final: ${phrase.reason}`);
    if (features.description) info.push(features.description);
    if (typeof features.contour === 'string' && features.contour) info.push(`Desenho ${features.contour}${finite(features.repeatedNotes) ? `; ${features.repeatedNotes} repetição(ões) de nota` : ''}${finite(features.leaps) ? `; ${features.leaps} salto(s) de pelo menos cinco semitons` : ''}.`);
    if (phrase.variant === 'transposed' && phrase.transpose) info.push(`Mudança de altura: ${phrase.transpose > 0 ? '+' : ''}${phrase.transpose} semitons em relação à primeira apresentação.`);
    if (Array.isArray(features.contour) && features.contour.length) info.push(`Desenho: ${features.contour.slice(0, 20).map(value => value === 0 ? 'repete' : value > 0 ? 'sobe' : 'desce').join(' → ')}${features.contour.length > 20 ? '…' : ''}.`);
    if (!info.length) info.push('Ouça este trecho e compare o ritmo e os intervalos com as outras ocorrências da família.');
    card.append(detailList(info));
    const chart = contourPreview(features, 'Desenho deste trecho'); if (chart) card.append(chart);
    const actions = node('div', 'study-actions');
    actions.append(button('Ouvir este trecho', () => this.preview(phrase), 'study-preview'), button('Praticar este trecho', () => this.practice({ id: `phrase-${phrase.id}`, type: 'phrase', kind: 'phrase', phraseId: phrase.id, patternId: phrase.patternId, title: `Frase ${phrase.patternLabel || phrase.name}`, start: phrase.start, end: phrase.end, hands: 'both', mode: 'melody', speed: .7 })));
    const reference = this.draft.phrases.find(item => item.id === phrase.referencePhraseId);
    if (reference && reference.id !== phrase.id) {
      actions.append(button(`Ouvir referência (${clock(reference.start)})`, () => this.preview(reference)));
      if (this.onCompare) actions.append(button('Comparar referência → retorno', () => this.compare(reference, phrase)));
    }
    actions.append(button('Parar escuta', () => this.stopPreview())); card.append(actions);
    if (Array.isArray(features.intervals) && features.intervals.length) {
      const detail = node('details', 'study-musical-details'); detail.append(node('summary', '', 'Ler intervalos e ritmo deste desenho'));
      const intervals = features.intervals.slice(0, 24).map(value => value === 0 ? 'repete' : `${value > 0 ? '+' : ''}${value}`).join(' → ');
      detail.append(paragraph(`Intervalos entre ataques, em semitons: ${intervals}${features.intervals.length > 24 ? '…' : ''}. Um semitom é a distância entre duas teclas vizinhas, incluindo as pretas.`));
      if (Array.isArray(features.rhythm) && features.rhythm.length) detail.append(paragraph(`Espaço rítmico entre ataques, em tempos de semínima: ${features.rhythm.slice(0, 24).map(value => Number(Number(value).toFixed(2))).join(' · ')}${features.rhythm.length > 24 ? '…' : ''}. O último valor corresponde à duração da última nota.`));
      if (reference && reference.id !== phrase.id) { const base = contourPreview(reference.features, `Referência ${reference.patternLabel} · ${range(reference)}`); if (base) detail.append(base); }
      card.append(detail);
    }
    const review = node('details', 'study-review'); review.append(node('summary', '', 'Corrigir a família deste trecho'));
    review.append(paragraph('Use outra família quando o trecho se parece com ela, ou uma nova família quando o desenho for diferente. Isso altera o mapa e o plano de estudo.', 'study-subtle'));
    const label = node('label', '', 'Família'); const select = node('select', 'study-family-choice'); select.setAttribute('aria-label', `Família do trecho em ${clock(phrase.start)}`);
    for (const pattern of this.draft.patterns) select.append(new Option(pattern.label, pattern.id));
    select.append(new Option('Criar nova família', '__new__')); select.value = phrase.patternId; label.append(select);
    const apply = button('Aplicar correção', () => {
      try { this.draft = reviewPatternFamily(this.draft, phrase.id, select.value === '__new__' ? null : select.value); this.dirty = true; this.render(); this.setStatus('Família ajustada. Salve a revisão para atualizar os exercícios.'); } catch (error) { this.fail(error); }
    });
    review.append(label, apply); card.append(review); return card;
  }

  renderFamily(pattern) {
    const card = node('article', 'study-family'); card.style.setProperty('--family-color', this.patternColor(pattern.id));
    const title = node('h4', '', `${pattern.label} · ${pattern.occurrences.length} ${pattern.occurrences.length === 1 ? 'apresentação' : 'apresentações'}`); card.append(title);
    card.append(paragraph(pattern.description || 'Compare o desenho melódico e o ritmo desta família.'));
    const chart = contourPreview(pattern.features, 'Desenho da referência'); if (chart) card.append(chart);
    const representative = this.draft.phrases.find(phrase => phrase.id === pattern.representativePhraseId);
    const familyActions = node('div', 'study-actions');
    familyActions.append(button('Estudar esta família', () => { this.targetPatternId = pattern.id; this.selectTab('plan'); }, 'study-study-family'));
    if (representative) familyActions.append(button(`Ver referência · ${range(representative)}`, () => { this.selectedPhraseId = representative.id; this.renderStructure(); }));
    card.append(familyActions);
    const returns = node('div', 'study-returns'); returns.setAttribute('aria-label', `Ocorrências da família ${pattern.label}`);
    for (const phrase of this.draft.phrases.filter(item => item.patternId === pattern.id)) {
      const item = button(`${phrase.patternLabel || pattern.label} · ${range(phrase)}`, () => { this.selectedPhraseId = phrase.id; this.renderStructure(); });
      item.title = phrase.comparison?.summary || relation[phrase.variant] || 'Selecionar trecho'; returns.append(item);
    }
    card.append(returns);
    const review = node('details', 'study-review'); review.append(node('summary', '', 'Nome desta família'));
    const label = node('label', '', 'Nome curto'); const input = node('input', 'study-family-name'); input.value = pattern.label; input.maxLength = 24; input.setAttribute('aria-label', `Nome da família ${pattern.label}`); label.append(input);
    review.append(label, button('Renomear', () => {
      try { this.draft = renamePatternFamily(this.draft, pattern.id, input.value); this.dirty = true; this.render(); this.setStatus('Nome ajustado. Salve a estrutura revisada.'); } catch (error) { this.fail(error); }
    })); card.append(review); return card;
  }

  renderPlan() {
    const host = this.dialog.querySelector('.study-plan'); host.replaceChildren();
    if (!this.hasAnalysis) { host.append(paragraph('Analise e revise a estrutura musical para montar exercícios a partir das famílias desta música.', 'study-empty')); return; }
    let plan;
    if (this.targetPatternId && !this.draft.patterns.some(pattern => pattern.id === this.targetPatternId)) this.targetPatternId = null;
    try { plan = buildStudyPlan(this.song, this.draft, { history: this.getHistory() || [], profile: this.getProfile(), progress: this.progress, sessionMinutes: this.sessionMinutes, targetPatternId: this.targetPatternId }); }
    catch (error) { this.fail(error); return; }
    this.plan = plan;
    const goal = node('div', 'study-goal'); goal.append(node('span', 'study-eyebrow', 'SEU PRÓXIMO OBJETIVO'), node('h3', '', plan.objective?.title || 'Reconhecer as famílias desta música'), paragraph(plan.objective?.description || plan.summary || ''));
    if (this.dirty) goal.append(paragraph('Salve a revisão antes de iniciar os exercícios. O plano abaixo acompanha a sugestão atual.', 'study-unsaved'));
    host.append(goal);
    const tools = node('div', 'study-plan-tools');
    const targetLabel = node('label', '', 'Família para estudar'); const targetSelect = node('select', 'study-target-pattern'); targetSelect.setAttribute('aria-label', 'Família para estudar');
    targetSelect.append(new Option('Prioridade sugerida', ''));
    for (const pattern of this.draft.patterns) targetSelect.append(new Option(`${pattern.label} · ${pattern.occurrences.length} ${pattern.occurrences.length === 1 ? 'apresentação' : 'apresentações'}`, pattern.id));
    targetSelect.value = this.targetPatternId || '';
    targetSelect.addEventListener('change', () => { this.targetPatternId = targetSelect.value || null; this.renderPlan(); }); targetLabel.append(targetSelect); tools.append(targetLabel);
    const label = node('label', '', 'Tempo disponível por sessão'); const select = node('select', 'study-minutes'); select.setAttribute('aria-label', 'Duração planejada da sessão');
    for (const value of [10, 20, 30, 45]) select.append(new Option(`${value} minutos`, String(value))); select.value = String(this.sessionMinutes);
    select.addEventListener('change', () => { this.sessionMinutes = Number(select.value); this.renderPlan(); }); label.append(select); tools.append(label, paragraph('As sessões seguem as famílias desta música. Avance no seu ritmo; marcar um exercício registra sua revisão, não comprova domínio.', 'study-subtle')); host.append(tools);
    if (plan.summary) host.append(paragraph(plan.summary, 'study-plan-summary'));
    const finished=new Set(plan.progress.finishedExercises||[]),reviewed=new Set(plan.progress.completedExercises||[]);
    host.append(paragraph(`${plan.exercises.filter(e=>finished.has(e.id)).length}/${plan.exercises.length} práticas concluídas · ${plan.exercises.filter(e=>reviewed.has(e.id)).length} exercícios revisados`,'study-completion-summary'));
    const progress = node('div', 'study-pattern-progress');
    for (const item of plan.patternsProgress || []) {
      const row = node('div', 'study-pattern-progress-item'); row.append(node('strong', '', item.label), node('span', '', item.status), paragraph(item.explanation, 'study-subtle')); progress.append(row);
    }
    if (progress.childElementCount) host.append(progress);
    host.append(node('h3', '', 'Sessões sugeridas para esta música'));
    const sessions = node('div', 'study-sessions');
    for (const [index, session] of (plan.sessions || []).entries()) {
      const card = node('details', 'study-session'); card.open = index === 0;
      const heading = node('summary', ''); heading.append(node('b', '', session.title || `Sessão ${index + 1}`), node('span', '', `${session.minutes || this.sessionMinutes} min${session.completed ? ' · revisão marcada' : ''}`)); card.append(heading);
      const count=session.exercises.filter(e=>finished.has(e.id)).length;
      if(count||session.completed){const tag=node('span','study-session-tag',session.completed?'✓ Sessão revisada':`✓ ${count}/${session.exercises.length} práticas concluídas`);heading.append(tag);}
      card.append(paragraph(session.description || '', 'study-session-description'));
      const checklist = node('label', 'study-check'); const checkbox = node('input', ''); checkbox.type = 'checkbox'; checkbox.checked = !!session.completed;
      checkbox.addEventListener('change', () => this.markComplete('session', session.id, checkbox.checked)); checklist.append(checkbox, document.createTextNode('Marquei esta sessão como revisada')); card.append(checklist);
      for (const exercise of session.exercises || []) card.append(this.renderExercise(exercise, plan));
      sessions.append(card);
    }
    host.append(sessions);
  }

  renderExercise(exercise, plan) {
    const card = node('article', 'study-exercise'); card.dataset.exerciseId = exercise.id;
    const heading = node('div', 'study-exercise-heading'); heading.append(node('h4', '', exercise.title), node('span', '', `${range(exercise)} · ${Math.round((exercise.speed || 1) * 100)}%`)); card.append(heading);
    const practiced=plan.progress.finishedExercises?.includes(exercise.id),reviewed=plan.progress.completedExercises?.includes(exercise.id);
    card.dataset.completed=String(!!(practiced||reviewed));
    if(practiced||reviewed){const tag=node('span','study-completion-tag',practiced?'✓ Prática concluída':'✓ Revisão concluída');tag.dataset.kind=practiced?'practice':'review';card.append(tag);}
    const instructions = Array.isArray(exercise.instructions) && exercise.instructions.length ? exercise.instructions : [exercise.instruction];
    card.append(detailList(instructions));
    const actions = node('div', 'study-actions');
    actions.append(button('Iniciar exercício', () => this.practice(exercise), 'study-start-exercise'), button('Ouvir trecho', () => this.preview(exercise)));
    if (exercise.compareWith) actions.append(button('Ouvir comparação', () => this.preview(exercise.compareWith)));
    card.append(actions);
    if (exercise.points?.length) {
      const points = node('div', 'study-start-points'); points.append(node('span', '', 'Comece sem tocar o que veio antes:'));
      const choices = node('div', 'study-actions');
      for (const point of exercise.points) choices.append(button(clock(point.start), () => this.practice({ ...exercise, ...point, points: undefined }), 'study-start-point'));
      choices.append(button('Sortear ponto de partida', () => {
        const other = exercise.points.filter(point => point.start !== this.lastRandomPoint);
        const list = other.length ? other : exercise.points;
        const point = list[Math.floor(Math.random() * list.length)]; this.lastRandomPoint = point.start;
        this.practice({ ...exercise, ...point, points: undefined });
      }, 'study-random-point')); points.append(choices); card.append(points);
    }
    const label = node('label', 'study-check'); const checkbox = node('input', ''); checkbox.type = 'checkbox'; checkbox.checked = !!plan.progress?.completedExercises?.includes(exercise.id);
    checkbox.addEventListener('change', () => this.markComplete('exercise', exercise.id, checkbox.checked)); label.append(checkbox, document.createTextNode('Revisei este exercício')); card.append(label); return card;
  }

  async markComplete(type, id, checked) {
    if (this.progressBusy) { this.renderPlan(); return; }
    const plan = this.plan;
    if (!plan || !this.hasAnalysis) return;
    const valid = type === 'session' ? plan.sessions?.some(item => item.id === id) : plan.exercises?.some(item => item.id === id);
    if (!valid) { this.setStatus('Este exercício não pertence ao plano atual.', true); return; }
    if (this.dirty) { this.setStatus('Salve a estrutura revisada antes de registrar a revisão dos exercícios.'); this.renderPlan(); return; }
    const progress = copy(plan.progress), field = type === 'session' ? 'completedSessions' : 'completedExercises';
    const ids = new Set(progress[field] || []); checked ? ids.add(id) : ids.delete(id); progress[field] = [...ids];
    const epoch = this.epoch;
    this.progressBusy = true; this.updateControls();
    try { await this.onSaveProgress(progress); if (epoch === this.epoch && this.dialog.open) { this.progress = progress; this.renderPlan(); this.setStatus('Revisão registrada para este perfil e esta música. Os resultados ao tocar são avaliados separadamente.'); } }
    catch (error) { if (epoch === this.epoch && this.dialog.open) { this.fail(error); this.renderPlan(); } }
    finally { this.progressBusy = false; this.updateControls(); }
  }
  async practice(exercise) {
    if (this.busy || this.dirty) { this.setStatus('Salve a estrutura revisada antes de iniciar o exercício.'); return; }
    if (!finite(exercise.start) || !finite(exercise.end) || exercise.start < 0 || exercise.end <= exercise.start || exercise.end > this.song.duration + 1e-5) { this.fail(new Error('O exercício deve estar dentro dos limites desta música.')); return; }
    try { this.stopPreview(); await this.onPractice(copy(exercise)); this.close(); }
    catch (error) { this.fail(error); }
  }
  async preview(phrase) {
    const epoch = ++this.previewEpoch;
    try { await this.onPreview({ start: phrase.start, end: phrase.end, name: phrase.name || phrase.title || phrase.patternLabel || 'Trecho' }); if (epoch === this.previewEpoch && this.dialog.open) this.setStatus(`Escutando ${range(phrase)}. Use “Parar escuta” para interromper.`); }
    catch (error) { if (epoch === this.previewEpoch && this.dialog.open) this.fail(error); }
  }
  async compare(reference, candidate) {
    const epoch = ++this.previewEpoch;
    try { await this.onCompare({ reference: copy(reference), candidate: copy(candidate) }); if (epoch === this.previewEpoch && this.dialog.open) this.setStatus('Comparando a referência com o retorno selecionado.'); }
    catch (error) { if (epoch === this.previewEpoch && this.dialog.open) this.fail(error); }
  }
  stopPreview() { this.previewEpoch++; try { Promise.resolve(this.onPreview(null)).catch(error => { if (this.dialog.open) this.fail(error); }); } catch (error) { if (this.dialog.open) this.fail(error); } }
  destroy() { this.close(); this.dialog.remove(); this.host.replaceChildren(); }
}
