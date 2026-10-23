import { suggestPhrases, normalizePhrases, normalizePhrasing, splitPhrase, mergePhrases, movePhraseBoundary } from './music/phrases.js';
import { analyzePatterns } from './music/patterns.js';

const clone = value => structuredClone(value);
const clock = seconds => {
  const value = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(value / 60)}:${(value % 60).toFixed(1).padStart(4, '0')}`;
};
const seconds = value => Math.round(Number(value) * 100) / 100;
let panelNumber = 0;

/** A reviewable phrase plan. Callbacks receive seconds in the original song's clock. */
export class PhrasePanel {
  constructor({ host, getTime = () => 0, onOpen = () => {}, onApply = () => {}, onPractice = () => {}, onExit = () => {}, onPreview, onError = () => {} }) {
    if (!host) throw new TypeError('Informe o elemento que recebe o painel de frases.');
    Object.assign(this, { host, getTime, onOpen, onApply, onPractice, onExit, onPreview, onError });
    this.song = null;
    this.phrasing = null;
    this.activeId = null;
    this.draft = [];
    this.selectedId = null;
    this.previewing = false;
    this.previewEpoch = 0;
    this.reviewEpoch = 0;
    this.build();
  }

  build() {
    this.host.classList.add('phrases-panel');
    this.host.setAttribute('aria-label', 'Prática por frases');
    this.host.innerHTML = `<span class="phrases-label">Frases</span>
      <select class="phrase-choice" aria-label="Frase para praticar"><option value="">Música inteira</option></select>
      <button type="button" class="phrase-previous" aria-label="Praticar frase anterior" title="Frase anterior">‹</button>
      <button type="button" class="phrase-next" aria-label="Praticar próxima frase" title="Próxima frase">›</button>
      <button type="button" class="phrase-practice">Praticar frase ↻</button>
      <button type="button" class="phrase-exit">Música inteira</button>
      <span class="phrase-range" aria-live="off"></span>
      <button type="button" class="phrase-organize">Organizar frases</button>`;
    this.choice = this.host.querySelector('.phrase-choice');
    this.choice.addEventListener('change', () => this.choice.value ? this.practice(this.choice.value) : this.exit());
    this.host.querySelector('.phrase-previous').addEventListener('click', () => this.step(-1));
    this.host.querySelector('.phrase-next').addEventListener('click', () => this.step(1));
    this.host.querySelector('.phrase-practice').addEventListener('click', () => this.practice(this.choice.value || this.phrases[0]?.id));
    this.host.querySelector('.phrase-exit').addEventListener('click', () => this.exit());
    this.host.querySelector('.phrase-organize').addEventListener('click', () => this.open());
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'phrases-dialog';
    const headingId = `phrases-dialog-title-${++panelNumber}`;
    this.dialog.setAttribute('aria-labelledby', headingId);
    this.dialog.innerHTML = `<div class="phrases-dialog-heading"><div><p class="phrases-eyebrow">UMA MÚSICA, VÁRIOS TRECHOS PARA TREINAR</p><h2 id="phrases-dialog-title">Organizar frases</h2></div><button type="button" class="phrase-close" aria-label="Fechar revisão de frases">✕</button></div>
      <p class="phrases-intro">Crie uma divisão automática e revise os limites. As frases são trechos da mesma música: o MIDI original continua inteiro.</p>
      <div class="phrases-generator">
        <label>Dividir por<select class="phrase-division"><option value="patterns">Padrões melódicos · automático</option><option value="bars">Compassos · manual</option><option value="count">Quantidade de frases · manual</option></select></label>
        <label class="phrase-bars-label">Compassos por frase<input class="phrase-bars" type="number" min="1" max="64" step="1" value="4"></label>
        <label class="phrase-count-label" hidden>Frases desejadas<input class="phrase-count" type="number" min="1" max="128" step="1" value="4"></label>
        <button type="button" class="phrase-suggest">Sugerir divisão</button>
      </div>
      <p class="phrase-suggestion-note">A sugestão considera compassos, pausas e mudanças do MIDI. Confira se os cortes fazem sentido musicalmente.</p>
      <div class="phrase-timeline" aria-label="Limites das frases"><div class="phrase-timeline-segments"></div><i class="phrase-position" aria-hidden="true"></i></div>
      <div class="phrase-position-control"><label for="phrase-review-position-${panelNumber}">Posição de revisão</label><input id="phrase-review-position-${panelNumber}" class="phrase-review-position" type="range" min="0" max="1" step=".01" value="0" aria-label="Posição de revisão em segundos"><input class="phrase-review-seconds" type="number" min="0" max="1" step=".01" value="0" aria-label="Tempo do corte em segundos"><span>s</span></div>
      <div class="phrase-review-tools"><span class="phrase-draft-count"></span><span class="phrase-edit-time">Posição <b>0:00.0</b></span><button type="button" class="phrase-split">Dividir na posição atual</button><button type="button" class="phrase-merge">Unir à próxima</button><button type="button" class="phrase-preview">Ouvir frase</button></div>
      <p class="phrase-review-help">Escolha uma frase na faixa ou na lista. Edite os tempos em segundos; cada limite também ajusta a frase vizinha.</p>
      <div class="phrase-rows" aria-label="Frases para revisão"></div>
      <p class="phrase-editor-status" role="status" aria-live="polite"></p>
      <div class="phrase-dialog-footer"><span>As sugestões só entram em uso depois de salvar.</span><button type="button" class="phrase-cancel">Cancelar</button><button type="button" class="primary phrase-save">Salvar frases</button></div>`;
    this.dialog.querySelector('h2').id = headingId;
    document.body.append(this.dialog);
    this.dialog.querySelector('.phrase-close').addEventListener('click', () => this.close());
    this.dialog.querySelector('.phrase-cancel').addEventListener('click', () => this.close());
    this.dialog.addEventListener('cancel', () => {this.reviewEpoch++;this.stopPreview();});
    this.dialog.addEventListener('close', () => {this.reviewEpoch++;this.stopPreview();});
    this.dialog.querySelector('.phrase-division').addEventListener('change', () => this.updateGenerator());
    this.dialog.querySelector('.phrase-suggest').addEventListener('click', () => this.suggest());
    for (const selector of ['.phrase-review-position', '.phrase-review-seconds']) {
      this.dialog.querySelector(selector).addEventListener('input', event => {
        const value = Number(event.target.value);
        if (!Number.isFinite(value) || !event.target.value.trim()) return;
        this.stopPreview();
        this.reviewTime = Math.max(0, Math.min(this.song.duration, value));
        this.refreshTime({ preserveNumber: selector === '.phrase-review-seconds' });
      });
      this.dialog.querySelector(selector).addEventListener('change', () => this.refreshTime({ forceNumber: true }));
    }
    this.dialog.querySelector('.phrase-split').addEventListener('click', () => this.edit(() => {
      const at = Number(this.reviewTime);
      const phrase = this.draft.find(item => at > item.start && at < item.end);
      if (!phrase) throw new Error('Posicione a música dentro de uma frase para inserir um corte.');
      this.selectedId = phrase.id;
      return splitPhrase(this.draft, phrase.id, at, this.song.duration);
    }));
    this.dialog.querySelector('.phrase-merge').addEventListener('click', () => this.edit(() => mergePhrases(this.draft, this.selectedId, this.song.duration)));
    this.dialog.querySelector('.phrase-preview').addEventListener('click', () => this.preview());
    this.dialog.querySelector('.phrase-save').addEventListener('click', () => this.save());
    this.renderBar();
  }

  get phrases() { return this.phrasing?.phrases || []; }

  setSong(song) {
    const changed = this.song?.id !== song?.id;
    if (changed && this.dialog.open) this.close();
    this.song = song || null;
    this.phrasing = song?.phrasing ? normalizePhrasing(song.phrasing, song.duration) : null;
    if (changed || !this.phrases.some(phrase => phrase.id === this.activeId)) this.activeId = null;
    this.renderBar();
  }

  setActive(id) {
    this.activeId = this.phrases.some(phrase => phrase.id === id) ? id : null;
    this.renderBar();
  }

  setRepeat(enabled) {if(this.repeat===!!enabled)return;this.repeat=!!enabled;this.renderBar();}

  renderBar() {
    const options = [new Option('Música inteira', '')];
    this.phrases.forEach((phrase, index) => options.push(new Option(`${String(index + 1).padStart(2, '0')} · ${phrase.name}`, phrase.id)));
    this.choice.replaceChildren(...options);
    this.choice.value = this.activeId || '';
    this.choice.disabled = !this.phrases.length;
    const index = this.phrases.findIndex(phrase => phrase.id === this.activeId);
    const active = this.phrases[index];
    this.host.querySelector('.phrase-previous').disabled = index <= 0;
    this.host.querySelector('.phrase-next').disabled = !this.phrases.length || index === this.phrases.length - 1;
    this.host.querySelector('.phrase-practice').disabled = !this.phrases.length;
    this.host.querySelector('.phrase-exit').disabled = !active;
    this.host.querySelector('.phrase-range').textContent = active ? `${clock(active.start)} – ${clock(active.end)} · ${this.repeat===false?'uma passagem':'loop'}` : this.phrases.length ? `${this.phrases.length} frases salvas` : 'Divida a música para praticar por trechos';
    this.host.querySelector('.phrase-organize').disabled = !(this.song?.duration > 0);
    this.host.querySelector('.phrase-organize').textContent = this.phrases.length ? 'Revisar frases' : 'Organizar frases';
  }

  practice(id) {
    const phrase = this.phrases.find(item => item.id === id);
    if (!phrase) return;
    try {
      this.onPractice({ id: phrase.id, name: phrase.name, start: phrase.start, end: phrase.end });
      this.setActive(phrase.id);
    } catch (error) { this.onError(error); }
  }

  step(direction) {
    const current = this.phrases.findIndex(phrase => phrase.id === this.activeId);
    const next = current < 0 ? 0 : current + direction;
    if (this.phrases[next]) this.practice(this.phrases[next].id);
  }

  exit() {
    try { this.onExit(); this.setActive(null); } catch (error) { this.onError(error); }
  }

  open() {
    if (!(this.song?.duration > 0) || this.dialog.open) return;
    try { this.onOpen(); } catch (error) { this.onError(error); return; }
    this.reviewEpoch++;
    this.reviewTime = Math.max(0, Math.min(this.song.duration, Number(this.getTime()) || 0));
    this.dialog.querySelector('.phrase-review-position').max = String(this.song.duration);
    this.dialog.querySelector('.phrase-review-seconds').max = String(this.song.duration);
    this.draft = clone(this.phrases);
    this.draftOptions = { targetBars: this.phrasing?.targetBars || 4 };
    if (this.phrasing?.targetCount) this.draftOptions.targetCount = this.phrasing.targetCount;
    if (this.phrasing?.tracks) this.draftOptions.tracks = clone(this.phrasing.tracks);
    this.selectedId = this.activeId || this.draft[0]?.id || null;
    this.dialog.querySelector('.phrase-division').value = 'patterns';
    this.dialog.querySelector('.phrase-bars').value = this.draftOptions.targetBars;
    this.dialog.querySelector('.phrase-count').value = this.draftOptions.targetCount || Math.max(1,this.phrases.length) || 4;
    this.updateGenerator();
    this.setStatus('');
    this.dialog.showModal();
    if (!this.draft.length) this.suggest();
    else this.renderDraft();
  }

  close() { this.reviewEpoch++;this.stopPreview(); this.dialog.close(); }

  updateGenerator() {
    const strategy = this.dialog.querySelector('.phrase-division').value;
    this.dialog.querySelector('.phrase-bars-label').hidden = strategy !== 'bars';
    this.dialog.querySelector('.phrase-count-label').hidden = strategy !== 'count';
  }

  suggest() {
    try {
      if(this.dialog.querySelector('.phrase-division').value==='patterns'){
        const result=suggestPhrases(this.song,{strategy:'patterns',tracks:this.phrasing?.melodyTracks});
        this.draft=clone(result.phrases);this.draftOptions={strategy:'patterns',tracks:result.melodyTracks};
        this.selectedId=this.draft[0]?.id||null;this.stopPreview();this.renderDraft();
        this.setStatus(`${result.patterns.length} famílias em ${result.phrases.length} frases sugeridas. A quantidade acompanha as pausas e reaparições desta melodia. Confira e salve para estudar.`);return;
      }
      const byCount = this.dialog.querySelector('.phrase-division').value === 'count';
      const input = this.dialog.querySelector(byCount ? '.phrase-count' : '.phrase-bars');
      if (!input.reportValidity()) return;
      const value = Number(input.value);
      if (!Number.isInteger(value)) throw new Error('Use um número inteiro para a divisão.');
      const options = byCount ? { targetCount: value } : { targetBars: value };
      const result = suggestPhrases(this.song, options);
      this.draft = clone(result.phrases);
      this.draftOptions = options;
      this.selectedId = this.draft[0]?.id || null;
      this.stopPreview();
      this.renderDraft();
      const requested = byCount && this.draft.length !== value ? ` Foram encontradas ${this.draft.length} divisões seguras para as ${value} solicitadas.` : '';
      this.setStatus(`Sugestão criada para revisão.${requested}${result.warnings?.length ? ` ${result.warnings.join(' ')}` : ''}`);
    } catch (error) { this.setStatus(error.message, true); }
  }

  edit(operation) {
    try {
      this.draft = operation();
      if (!this.draft.some(phrase => phrase.id === this.selectedId)) this.selectedId = this.draft[0]?.id || null;
      this.stopPreview();
      this.renderDraft();
      this.setStatus('Limites atualizados no rascunho. Salve para usar na prática.');
    } catch (error) { this.setStatus(error.message, true); this.renderDraft(); }
  }

  select(id) {
    this.selectedId = id;
    this.dialog.querySelectorAll('[data-phrase-id]').forEach(element => {
      const selected = element.dataset.phraseId === id;
      element.classList.toggle('selected', selected);
      if (element.matches('button')) element.setAttribute('aria-pressed', String(selected));
    });
    const index = this.draft.findIndex(phrase => phrase.id === id);
    this.dialog.querySelector('.phrase-merge').disabled = index < 0 || index === this.draft.length - 1;
    this.dialog.querySelector('.phrase-preview').disabled = index < 0 || !this.onPreview;
  }

  renderDraft() {
    const timeline = this.dialog.querySelector('.phrase-timeline-segments');
    const rows = this.dialog.querySelector('.phrase-rows');
    timeline.replaceChildren();
    rows.replaceChildren();
    this.draft.forEach((phrase, index) => {
      const segment = document.createElement('button');
      segment.type = 'button';
      segment.style.width = `${(phrase.end - phrase.start) / this.song.duration * 100}%`;
      segment.style.setProperty('--phrase-hue', String(index % 2 ? 263 : 142));
      segment.dataset.phraseId = phrase.id;
      segment.textContent = index + 1;
      segment.title = `${phrase.name} · ${clock(phrase.start)} a ${clock(phrase.end)}`;
      segment.setAttribute('aria-label', `Selecionar frase ${index + 1}: ${phrase.name}`);
      segment.addEventListener('click', event => {
        this.select(phrase.id);
        // Pointer clicks also place a review marker; keyboard activation picks
        // a safe interior position without moving the song's transport.
        const rect = timeline.getBoundingClientRect();
        this.stopPreview();
        this.reviewTime = event.detail && rect.width ? Math.max(0, Math.min(this.song.duration, (event.clientX - rect.left) / rect.width * this.song.duration)) : (phrase.start + phrase.end) / 2;
        this.refreshTime();
        rows.querySelector(`[data-phrase-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
      });
      timeline.append(segment);
      const row = document.createElement('div');
      row.className = 'phrase-review-row';
      row.dataset.phraseId = phrase.id;
      row.dataset.phraseIndex = String(index);
      const number = document.createElement('button');
      number.type = 'button';
      number.className = 'phrase-row-number';
      number.textContent = String(index + 1).padStart(2, '0');
      number.title = 'Selecionar frase';
      number.addEventListener('click', () => this.select(phrase.id));
      row.append(number);
      const title = document.createElement('label');
      title.className = 'phrase-name-label';
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 80;
      input.value = phrase.name;
      input.setAttribute('aria-label', `Nome da frase ${index + 1}`);
      input.addEventListener('change', () => {
        phrase.name = input.value.trim() || `Frase ${String(index + 1).padStart(2, '0')}`;
        input.value = phrase.name;
        segment.title = `${phrase.name} · ${clock(phrase.start)} a ${clock(phrase.end)}`;
      });
      input.addEventListener('focus', () => this.select(phrase.id));
      title.append(input);
      const reason = document.createElement('small');
      reason.className = 'phrase-reason';
      reason.textContent = [phrase.reason || 'Limite revisável', Number.isFinite(phrase.confidence) ? `indícios ${phrase.confidence>=.7?'fortes':phrase.confidence>=.45?'moderados':'fracos · revisar'}` : ''].filter(Boolean).join(' · ');
      title.append(reason);
      row.append(title);
      for (const edge of ['start', 'end']) {
        const label = document.createElement('label');
        label.className = 'phrase-time-label';
        label.append(document.createTextNode(edge === 'start' ? 'Início (s)' : 'Fim (s)'));
        const field = document.createElement('input');
        field.type = 'number'; field.step = '.01'; field.min = '0'; field.max = String(seconds(this.song.duration));
        field.value = seconds(phrase[edge]);
        field.disabled = edge === 'start' ? index === 0 : index === this.draft.length - 1;
        field.setAttribute('aria-label', `${edge === 'start' ? 'Início' : 'Fim'} da frase ${index + 1} em segundos`);
        field.addEventListener('focus', () => this.select(phrase.id));
        field.addEventListener('change', () => this.edit(() => {
          if (!field.value.trim() || !Number.isFinite(Number(field.value))) throw new Error('Informe um tempo válido em segundos.');
          return movePhraseBoundary(this.draft, edge === 'start' ? index - 1 : index, Number(field.value), this.song.duration);
        }));
        label.append(field);
        row.append(label);
      }
      rows.append(row);
    });
    this.dialog.querySelector('.phrase-draft-count').textContent = `${this.draft.length} ${this.draft.length === 1 ? 'frase' : 'frases'} · ${clock(this.song.duration)}`;
    this.dialog.querySelector('.phrase-save').disabled = !this.draft.length;
    this.select(this.selectedId);
    this.refreshTime();
  }

  refreshTime({ preserveNumber = false, forceNumber = false } = {}) {
    if (!this.dialog.open || !this.song) return;
    const at = Math.max(0, Math.min(this.song.duration, Number(this.previewing ? this.getTime() : this.reviewTime) || 0));
    this.dialog.querySelector('.phrase-edit-time b').textContent = clock(at);
    this.dialog.querySelector('.phrase-position').style.left = `${at / this.song.duration * 100}%`;
    this.dialog.querySelector('.phrase-review-position').value = seconds(at);
    if (forceNumber || !preserveNumber && document.activeElement !== this.dialog.querySelector('.phrase-review-seconds')) this.dialog.querySelector('.phrase-review-seconds').value = seconds(at);
    const interior = this.draft.some(phrase => at > phrase.start + .02 && at < phrase.end - .02);
    this.dialog.querySelector('.phrase-split').disabled = !interior;
  }

  async preview() {
    if (this.previewing) { this.stopPreview(); return; }
    const phrase = this.draft.find(item => item.id === this.selectedId);
    if (!phrase || !this.onPreview) return;
    const epoch = ++this.previewEpoch;
    this.previewing = true;
    this.dialog.querySelector('.phrase-preview').textContent = 'Parar de ouvir';
    try {
      await this.onPreview({ id: phrase.id, name: phrase.name, start: phrase.start, end: phrase.end });
      if (!this.previewing || epoch !== this.previewEpoch) await this.onPreview(null);
    } catch (error) {
      if (epoch !== this.previewEpoch) return;
      this.previewing = false;
      this.dialog.querySelector('.phrase-preview').textContent = 'Ouvir frase';
      this.setStatus(error.message, true);
    }
  }

  stopPreview() {
    if (!this.previewing) return;
    this.previewing = false;
    this.previewEpoch++;
    try { Promise.resolve(this.onPreview?.(null)).catch(error => this.onError(error)); } catch (error) { this.onError(error); }
    this.dialog.querySelector('.phrase-preview').textContent = 'Ouvir frase';
  }

  setStatus(message, error = false) {
    const status = this.dialog.querySelector('.phrase-editor-status');
    status.textContent = message;
    status.dataset.error = String(error);
  }

  async save() {
    const button = this.dialog.querySelector('.phrase-save');
    if (button.disabled) return;
    const song=this.song,epoch=this.reviewEpoch;
    try {
      button.disabled = true;
      const phrases = normalizePhrases(this.draft, this.song.duration);
      const unchanged=this.phrasing?.patterns?.length&&phrases.length===this.phrases.length&&phrases.every((p,i)=>p.id===this.phrases[i].id&&p.start===this.phrases[i].start&&p.end===this.phrases[i].end);
      const analysis=unchanged?{...clone(this.phrasing),phrases:this.phrases.map((p,i)=>({...p,name:phrases[i].name}))}:analyzePatterns(this.song,{phrases,tracks:this.draftOptions.tracks||this.phrasing?.melodyTracks});
      const plan = normalizePhrasing({ ...analysis, reviewed: true }, this.song.duration);
      await this.onApply(clone(plan));
      if(this.song!==song||this.reviewEpoch!==epoch)return;
      this.phrasing = plan;
      if (!phrases.some(phrase => phrase.id === this.activeId)) this.activeId = null;
      this.renderBar();
      this.close();
    } catch (error) { this.setStatus(`Não foi possível salvar: ${error.message}`, true); }
    finally { button.disabled = !this.draft.length; }
  }

  destroy() { this.stopPreview(); this.dialog.remove(); this.host.replaceChildren(); }
}
