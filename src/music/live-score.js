const SVG_NS = 'http://www.w3.org/2000/svg';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const PITCHES = [ ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0] ];
const PORTUGUESE = { C: 'Dó', D: 'Ré', E: 'Mi', F: 'Fá', G: 'Sol', A: 'Lá', B: 'Si' };

/** Conventional staff position, independent from pixel layout and keyboard range. */
export function livePitch(midi) {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) return null;
  const [step, alter] = PITCHES[midi % 12], octave = Math.floor(midi / 12) - 1;
  const diatonic = octave * 7 + 'CDEFGAB'.indexOf(step);
  const staff = midi < 60 ? 'bass' : 'treble';
  const bottom = staff === 'bass' ? 18 : 30; // G2 and E4.
  return { midi, step, alter, octave, diatonic, staff, position: diatonic - bottom, label: `${PORTUGUESE[step]}${alter ? '♯' : ''}${octave}` };
}

export function liveDuration(beats) {
  const quantized = Math.max(.25, Math.round(Math.max(0, number(beats)) * 4) / 4);
  const choices = [
    { beats: 4, type: 'whole', open: true, flags: 0, dotted: false },
    { beats: 3, type: 'half', open: true, flags: 0, dotted: true },
    { beats: 2, type: 'half', open: true, flags: 0, dotted: false },
    { beats: 1.5, type: 'quarter', open: false, flags: 0, dotted: true },
    { beats: 1, type: 'quarter', open: false, flags: 0, dotted: false },
    { beats: .75, type: 'eighth', open: false, flags: 1, dotted: true },
    { beats: .5, type: 'eighth', open: false, flags: 1, dotted: false },
    { beats: .25, type: '16th', open: false, flags: 2, dotted: false },
  ];
  return { ...choices.reduce((best, candidate) => Math.abs(candidate.beats - quantized) < Math.abs(best.beats - quantized) ? candidate : best), quantized, tied: quantized > 4 };
}

/** The live view owns a bounded transcript; recording/export remains the app's job. */
export class LiveScoreModel {
  constructor({ bpm = 120, beatsPerBar = 4, denominator = 4, maxGroups = 128, maxNotes = 512, chordWindow = .075 } = {}) {
    this.bpm = clamp(number(bpm, 120), 20, 300);
    this.beatsPerBar = clamp(Math.round(number(beatsPerBar, 4)), 1, 16);
    this.denominator = [2, 4, 8, 16].includes(denominator) ? denominator : 4;
    this.maxGroups = clamp(Math.round(number(maxGroups, 128)), 8, 512);
    this.maxNotes = clamp(Math.round(number(maxNotes, 512)), 16, 2048);
    this.chordWindow = clamp(number(chordWindow, .075), 0, .12);
    this.clear();
  }
  clear() {
    this.groups = []; this.active = new Map(); this.sustained = new Set();
    this.pedal = false; this.origin = null; this.lastTime = 0; this.sequence = 0; this.trimmed = 0;
    this.tempoSegments = [{ time: 0, bpm: this.bpm, beat: 0 }];
  }
  _time(time) { return Math.max(this.lastTime, number(time, this.lastTime)); }
  _beat(time) {
    const relative = Math.max(0, time - (this.origin ?? time));
    const segment = [...this.tempoSegments].reverse().find(item => item.time <= relative) || this.tempoSegments[0];
    return segment.beat + (relative - segment.time) * segment.bpm / 60;
  }
  setTempo(bpm, time = this.lastTime) {
    const value = clamp(number(bpm, this.bpm), 20, 300);
    if (value === this.bpm) return;
    const timestamp = this._time(time), relative = this.origin === null ? 0 : Math.max(0, timestamp - this.origin);
    const beat = this._beat(timestamp);
    this.bpm = value;
    if (this.origin === null) this.tempoSegments = [{ time: 0, bpm: value, beat: 0 }];
    else this.tempoSegments.push({ time: relative, bpm: value, beat });
  }
  setMeter(numerator, denominator = 4) {
    this.beatsPerBar = clamp(Math.round(number(numerator, 4)), 1, 16);
    this.denominator = [2, 4, 8, 16].includes(denominator) ? denominator : 4;
  }
  noteOn({ key, midi, velocity = .8, time = this.lastTime } = {}) {
    if (!livePitch(midi)) return null;
    const identity = String(key ?? midi), timestamp = this._time(time);
    if (this.active.has(identity)) this.noteOff(identity, timestamp);
    if (this.active.size >= this.maxNotes) this.noteOff(this.active.keys().next().value, timestamp);
    if (this.origin === null) this.origin = timestamp;
    this.lastTime = timestamp;
    const beat = this._beat(timestamp), previous = [...this.groups].reverse().find(group => group.timestamp <= timestamp + 1e-7);
    // A repeated attack of the same pitch is a new event, even in one grid cell.
    const chord = previous && timestamp - previous.timestamp <= this.chordWindow && !previous.notes.some(note => note.midi === midi);
    const group = chord ? previous : { id: `live-${++this.sequence}`, timestamp, time: timestamp - this.origin, beat: Math.round(beat * 4) / 4, notes: [] };
    if (!chord) {
      const insertion = this.groups.findIndex(item => item.timestamp > timestamp);
      if (insertion < 0) this.groups.push(group); else this.groups.splice(insertion, 0, group);
    }
    const note = { id: `${group.id}-${group.notes.length}`, key: identity, midi, velocity: clamp(number(velocity, .8), 0, 1), time: timestamp - this.origin, startBeat: beat, duration: 0, beats: .25, held: true, sustained: false, groupId: group.id };
    group.notes.push(note); this.active.set(identity, note); this._trim();
    return { group, note };
  }
  noteOff(key, time = this.lastTime) {
    const identity = String(key), note = this.active.get(identity);
    if (!note) return null;
    const timestamp = this._time(time); this.lastTime = timestamp;
    note.duration = Math.max(0, timestamp - this.origin - note.time);
    note.beats = liveDuration(this._beat(timestamp) - note.startBeat).quantized;
    note.held = false; note.sustained = this.pedal;
    if (this.pedal) this.sustained.add(note);
    this.active.delete(identity); return note;
  }
  setPedal(down, time = this.lastTime) {
    this.lastTime = this._time(time); this.pedal = !!down;
    if (!this.pedal) { for (const note of this.sustained) note.sustained = false; this.sustained.clear(); }
  }
  releaseAll(time = this.lastTime) {
    for (const key of [...this.active.keys()]) this.noteOff(key, time);
    this.setPedal(false, time);
  }
  _trim() {
    let total = this.groups.reduce((sum, group) => sum + group.notes.length, 0);
    while (this.groups.length > this.maxGroups || total > this.maxNotes) {
      const index = this.groups.findIndex(group => !group.notes.some(note => note.held));
      if (index < 0) break; // A held key never disappears while sounding.
      const [removed] = this.groups.splice(index, 1); total -= removed.notes.length; this.trimmed += removed.notes.length;
      for (const note of removed.notes) this.sustained.delete(note);
    }
  }
  setSong(song) {
    this.clear(); if (!song?.notes?.length) return;
    this.bpm = clamp(number(song.tempo, 120), 20, 300);
    this.tempoSegments = (song.tempos?.length ? song.tempos : [{ time: 0, bpm: this.bpm }]).filter(item => Number.isFinite(item.time) && item.time >= 0 && Number.isFinite(item.bpm) && item.bpm > 0).sort((a, b) => a.time - b.time).map(item => ({ time: item.time, bpm: item.bpm, beat: 0 }));
    if (!this.tempoSegments.length || this.tempoSegments[0].time > 0) this.tempoSegments.unshift({ time: 0, bpm: this.bpm, beat: 0 });
    for (let index = 1; index < this.tempoSegments.length; index++) {
      const previous = this.tempoSegments[index - 1], segment = this.tempoSegments[index];
      segment.beat = previous.beat + (segment.time - previous.time) * previous.bpm / 60;
    }
    const signature = song.timeSignatures?.[0]; if (signature) this.setMeter(signature.numerator, signature.denominator);
    this.origin = 0;
    const source = song.notes.filter(note => livePitch(note.midi) && Number.isFinite(note.time) && note.time >= 0).sort((a, b) => a.time - b.time || a.midi - b.midi);
    // Import onsets first: a long lower note must not push subsequent onsets forward.
    for (const [index, note] of source.entries()) {
      const result = this.noteOn({ key: `recorded-${index}`, midi: note.midi, velocity: note.velocity, time: note.time });
      const rendered = result.note;
      rendered.duration = Math.max(0, number(note.keyDuration ?? note.duration, .125));
      rendered.beats = liveDuration(this._beat(note.time + rendered.duration) - rendered.startBeat).quantized;
      rendered.held = false; this.active.delete(rendered.key);
    }
    this.lastTime = Math.max(this.lastTime, ...this.groups.flatMap(group => group.notes.map(note => note.time + note.duration)));
    this._trim();
  }
  startRecording(song) {
    this.setSong(song); this.origin = 0; this.lastTime = 0;
  }
  getSong(title = 'Piano livre') {
    const notes = this.groups.flatMap(group => group.notes.map((note, index) => ({ id: `${group.id}-${index}`, midi: note.midi, time: note.time, duration: Math.max(.025, note.duration), keyDuration: Math.max(.025, note.duration), velocity: note.velocity, track: 0, channel: 0 })));
    return { title, tempo: this.bpm, tempos: this.tempoSegments.map(({ time, bpm }) => ({ time, bpm })), timeSignatures: [{ time: 0, numerator: this.beatsPerBar, denominator: this.denominator }], tracks: [{ id: 0, name: 'Piano livre', channel: 0, program: 0 }], notes, duration: Math.max(0, ...notes.map(note => note.time + note.duration)) };
  }
}

/** Incremental SVG grand staff. Key events never rebuild the application layout. */
export class LiveScore {
  constructor({ host, getTime = () => performance.now() / 1000, onClear, ...options } = {}) {
    if (!host?.ownerDocument) throw new TypeError('A partitura ao vivo precisa de um elemento HTML.');
    this.host = host; this.document = host.ownerDocument; this.getTime = getTime; this.model = new LiveScoreModel(options);
    this.nodes = new Map(); this.disposed = false; this.width = 800; this.clockOffset = 0;
    host.classList.add('live-score');
    this.toolbar = this.document.createElement('div'); this.toolbar.className = 'live-score-heading';
    this.toolbar.innerHTML = '<span><b>Partitura ao vivo</b><small>Alturas reais · ritmo aproximado em semicolcheias</small></span><span class="live-score-status" aria-live="polite">Toque para escrever na pauta</span><button type="button" class="live-score-clear" title="Limpar somente a partitura ao vivo">Limpar pauta</button>';
    this.status = this.toolbar.querySelector('.live-score-status');
    this.toolbar.querySelector('button').onclick = () => typeof onClear === 'function' ? onClear() : this.clear();
    this.viewport = this.document.createElement('div'); this.viewport.className = 'live-score-viewport'; this.viewport.tabIndex = 0;
    this.viewport.setAttribute('aria-label', 'Partitura ao vivo; use a barra horizontal para rever as notas anteriores');
    this.svg = this._svg('svg', { viewBox: `0 0 ${this.width} 290`, width: this.width, height: 290, role: 'img', 'aria-label': 'Pauta dupla com claves de sol e fá' });
    this.staff = this._svg('g', { class: 'live-score-staff' }); this.ink = this._svg('g', { class: 'live-score-ink' });
    this.svg.append(this.staff, this.ink); this.viewport.append(this.svg); host.replaceChildren(this.toolbar, this.viewport);
    this._drawStaff(); this.resize();
  }
  _svg(tag, attributes = {}, text) {
    const node = this.document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text; return node;
  }
  _drawStaff() {
    this.staff.replaceChildren();
    for (const bottom of [130, 242]) for (let line = 0; line < 5; line++) this.staff.append(this._svg('line', { x1: 12, y1: bottom - line * 10, x2: this.width - 12, y2: bottom - line * 10, class: 'live-staff-line' }));
    this.staff.append(this._svg('line', { x1: 16, y1: 90, x2: 16, y2: 242, class: 'live-bar-line' }));
    this.staff.append(this._svg('text', { x: 24, y: 125, class: 'live-clef live-treble' }, '𝄞'), this._svg('text', { x: 25, y: 235, class: 'live-clef live-bass' }, '𝄢'));
    for (const y of [106, 218]) {
      this.staff.append(this._svg('text', { x: 69, y, class: 'live-meter' }, this.model.beatsPerBar));
      this.staff.append(this._svg('text', { x: 69, y: y + 22, class: 'live-meter' }, this.model.denominator));
    }
  }
  _positions() {
    const groups = this.model.groups;
    let previousX = 128, previousBeat = groups[0]?.beat || 0;
    return groups.map((group, index) => {
      // Long pauses are visually compressed; measure numbers retain their real
      // position. This also bounds the SVG after hours of free exploration.
      const gap = group.beat - previousBeat;
      const x = index ? previousX + Math.max(45, Math.min(8, gap) * 64) : 128;
      previousX = x; previousBeat = group.beat; return { group, x, longPause: gap > 8 };
    });
  }
  _drawNote(note, x, offset = 0) {
    const pitch = livePitch(note.midi), y = (pitch.staff === 'bass' ? 242 : 130) - pitch.position * 5;
    const duration = liveDuration(note.beats), active = note.held || note.sustained;
    const group = this._svg('g', { class: `live-score-note${active ? ' is-active' : ''}`, 'data-midi': note.midi, 'data-note-id': note.id, 'data-key': note.key, 'data-duration': duration.type });
    group.append(this._svg('title', {}, `${pitch.label} · ${duration.quantized} tempo(s)${note.held ? ' · pressionada' : note.sustained ? ' · pedal' : ''}`));
    for (let position = -2; position >= pitch.position; position -= 2) group.append(this._svg('line', { x1: x + offset - 12, y1: (pitch.staff === 'bass' ? 242 : 130) - position * 5, x2: x + offset + 12, y2: (pitch.staff === 'bass' ? 242 : 130) - position * 5, class: 'live-ledger-line' }));
    for (let position = 10; position <= pitch.position; position += 2) group.append(this._svg('line', { x1: x + offset - 12, y1: (pitch.staff === 'bass' ? 242 : 130) - position * 5, x2: x + offset + 12, y2: (pitch.staff === 'bass' ? 242 : 130) - position * 5, class: 'live-ledger-line' }));
    if (active) group.append(this._svg('ellipse', { cx: x + offset, cy: y, rx: 14, ry: 10, class: 'live-note-halo' }));
    group.append(this._svg('ellipse', { cx: x + offset, cy: y, rx: duration.type === 'whole' ? 8.5 : 7, ry: 4.8, transform: `rotate(-18 ${x + offset} ${y})`, class: `live-notehead${duration.open ? ' is-open' : ''}` }));
    if (pitch.alter) group.append(this._svg('text', { x: x + offset - 22, y: y + 6, class: 'live-accidental' }, '♯'));
    const down = pitch.position >= 4;
    if (duration.type !== 'whole') {
      const stemX = x + offset + (down ? -6 : 6), stemEnd = y + (down ? 31 : -31);
      group.append(this._svg('line', { x1: stemX, y1: y, x2: stemX, y2: stemEnd, class: 'live-stem' }));
      for (let flag = 0; flag < duration.flags; flag++) {
        const flagY = stemEnd + (down ? -flag * 7 : flag * 7), sign = down ? -1 : 1;
        group.append(this._svg('path', { d: `M ${stemX} ${flagY} q 14 ${sign * 7} 5 ${sign * 17} q 2 ${-sign * 8} -5 ${-sign * 9}`, class: 'live-flag' }));
      }
    }
    if (duration.dotted) group.append(this._svg('circle', { cx: x + offset + 13, cy: y - (pitch.position % 2 === 0 ? 4 : 0), r: 2, class: 'live-dot' }));
    if (duration.tied) group.append(this._svg('text', { x: x + offset - 8, y: y + 20, class: 'live-duration-overflow' }, `${duration.quantized}♩`));
    return group;
  }
  _drawGroup(group, x, measure = null, longPause = false) {
    const element = this._svg('g', { 'data-live-group': group.id, 'data-beat': group.beat });
    if (measure !== null) {
      element.append(this._svg('line', { x1: x - 18, y1: 90, x2: x - 18, y2: 242, class: 'live-bar-line' }));
      element.append(this._svg('text', { x: x - 13, y: 79, class: 'live-measure-number' }, measure + 1));
    }
    if (longPause) element.append(this._svg('text', { x: x - 45, y: 166, class: 'live-measure-number' }, '…'));
    const previous = { bass: null, treble: null };
    for (const note of [...group.notes].sort((a, b) => a.midi - b.midi)) {
      const pitch = livePitch(note.midi), adjacent = previous[pitch.staff] && Math.abs(previous[pitch.staff].diatonic - pitch.diatonic) === 1;
      element.append(this._drawNote(note, x, adjacent ? 12 : 0)); previous[pitch.staff] = pitch;
    }
    return element;
  }
  _refresh({ follow = false, focusGroup = null } = {}) {
    if (this.disposed) return;
    const positions = this._positions(), valid = new Set(positions.map(({ group }) => group.id));
    for (const [id, node] of this.nodes) if (!valid.has(id)) { node.remove(); this.nodes.delete(id); }
    const scale = this.svg.getBoundingClientRect().height / 290 || 190 / 290;
    const width = Math.max((this.viewport.clientWidth || 800) / scale, (positions.at(-1)?.x || 400) + 80);
    if (width !== this.width) { this.width = width; this.svg.setAttribute('viewBox', `0 0 ${width} 290`); this.svg.setAttribute('width', width); this._drawStaff(); }
    let previousMeasure = -1;
    for (const { group, x, longPause } of positions) {
      const measure = Math.floor(group.beat / (this.model.beatsPerBar * 4 / this.model.denominator));
      const shownMeasure = measure === previousMeasure ? null : measure; previousMeasure = measure;
      const fingerprint = `${x}:${shownMeasure}:${group.notes.map(note => `${note.id}:${note.beats}:${note.held}:${note.sustained}`).join('|')}`;
      const current = this.nodes.get(group.id); if (current?.dataset.fingerprint === fingerprint) continue;
      const rendered = this._drawGroup(group, x, shownMeasure, longPause); rendered.dataset.fingerprint = fingerprint;
      if (current) current.replaceWith(rendered); else this.ink.append(rendered); this.nodes.set(group.id, rendered);
    }
    const noteCount = this.model.groups.reduce((sum, group) => sum + group.notes.length, 0), activeCount = this.model.active.size;
    this.status.textContent = noteCount ? `${noteCount} nota${noteCount === 1 ? '' : 's'}${activeCount ? ` · ${activeCount} em execução` : ''}${this.model.trimmed ? ' · últimas posições' : ''}${this.model.pedal ? ' · pedal' : ''}` : 'Toque para escrever na pauta';
    if (follow && positions.length) {
      const x = (focusGroup ? positions.find(({ group }) => group.id === focusGroup) : null)?.x ?? positions.at(-1).x;
      const visualX = x * scale;
      if (visualX > this.viewport.scrollLeft + this.viewport.clientWidth - 65 || visualX < this.viewport.scrollLeft + 50) this.viewport.scrollLeft = Math.max(0, visualX - this.viewport.clientWidth + 100);
    }
  }
  noteOn(input = {}) { const result = this.model.noteOn({ ...input, time: (input.time ?? this.getTime()) - this.clockOffset }); this._refresh({ follow: true, focusGroup: result?.group.id }); return result; }
  noteOff(key, time = this.getTime()) { const result = this.model.noteOff(key, time - this.clockOffset); this._refresh(); return result; }
  setPedal(down, time = this.getTime()) { this.model.setPedal(down, time - this.clockOffset); this._refresh(); }
  releaseAll(time = this.getTime()) { this.model.releaseAll(time - this.clockOffset); this._refresh(); }
  setTempo(bpm, time = this.getTime()) { this.model.setTempo(bpm, time - this.clockOffset); }
  setMeter(numerator, denominator = 4) { this.model.setMeter(numerator, denominator); this._drawStaff(); this._refresh(); }
  setZoom(value) { this.zoom = clamp(number(value, 1), .5, 2); this.svg.style.setProperty('--live-score-zoom', this.zoom); this._refresh(); }
  setSong(song) { this.model.setSong(song); this.clockOffset = this.getTime() - this.model.lastTime; this.nodes.clear(); this.ink.replaceChildren(); this._drawStaff(); this._refresh({ follow: true }); }
  startRecording(song, { time = this.getTime() } = {}) { this.model.startRecording(song); this.clockOffset = time; this.nodes.clear(); this.ink.replaceChildren(); this._drawStaff(); this._refresh({ follow: true, focusGroup: this.model.groups[0]?.id }); }
  getSong(title) { return this.model.getSong(title); }
  clear() { this.model.clear(); this.clockOffset = 0; this.nodes.clear(); this.ink.replaceChildren(); this.viewport.scrollLeft = 0; this._drawStaff(); this._refresh(); }
  resize() { this._refresh(); }
  dispose() { this.disposed = true; this.model.clear(); this.nodes.clear(); this.host.replaceChildren(); this.host.classList.remove('live-score'); }
}
