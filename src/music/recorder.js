import { normalizeSong } from './midi.js';

const MAX_SECONDS = 86_400;
const MAX_EVENTS = 1_000_000;
let serial = 0;
const defaultClock = () => globalThis.performance?.now() ?? Date.now();
const copy = value => structuredClone(value);
function integer(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${label} fora do intervalo ${minimum}–${maximum}.`);
  return value;
}
function unit(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} precisa estar entre 0 e 1.`);
  return value;
}
function emptySong() {
  return { id: `recording-${Date.now().toString(36)}-${++serial}`, title: 'Gravação PianoCraft', notes: [], tracks: [], duration: 0, tempo: 120, tempos: [{ time: 0, bpm: 120 }], timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }], ppq: 480, events: [], programChanges: [] };
}
function validateEvent(event) {
  if (!event || typeof event !== 'object') throw new Error('Evento MIDI inválido.');
  const type = event.type;
  const common = {
    type,
    time: event.time,
    track: integer(event.track, 0, 65534, 'Pista do evento'),
    channel: integer(event.channel, 0, 15, 'Canal do evento'),
  };
  if (!Number.isFinite(common.time) || common.time < 0 || common.time > MAX_SECONDS) throw new Error('Tempo do evento MIDI inválido.');
  if (type === 'cc') return { ...common, controller: integer(event.controller, 0, 127, 'Controlador'), value: integer(event.value, 0, 127, 'Valor do controlador') };
  if (type === 'pitchBend') return { ...common, value: integer(event.value, 0, 16383, 'Pitch bend') };
  if (type === 'aftertouch') return { ...common, value: integer(event.value, 0, 127, 'Aftertouch') };
  if (type === 'polyAftertouch') return { ...common, midi: integer(event.midi, 0, 127, 'Nota do aftertouch'), value: integer(event.value, 0, 127, 'Aftertouch polifônico') };
  if (type === 'program') return { ...common, value: integer(event.value ?? event.program, 0, 127, 'Instrumento') };
  throw new Error(`Tipo de evento MIDI não suportado: ${String(type)}.`);
}

/**
 * Original six-track MIDI recorder. Clock values use milliseconds; song times
 * use seconds. Every take starts at time zero for overdubbing earlier tracks.
 * `song` is an isolated, JSON-safe snapshot, including a safely closed view of
 * a take in progress. Reading it never stops or mutates the ongoing recording.
 */
export class Recorder {
  constructor({ maxTracks = 6 } = {}) {
    this.maxTracks = integer(maxTracks, 1, 6, 'Limite de pistas');
    this._song = emptySong();
    this._take = null;
  }

  get recording() { return this._take !== null; }
  get song() { return this._take ? this._snapshot(this._elapsed()) : copy(this._song); }
  channelFor(inputChannel = 0) {integer(inputChannel,0,15,'Canal MIDI');return this._take?this._channel(inputChannel):inputChannel;}

  /** Returns {track, channel, program}; use channel for the live overdub voice. */
  start({ track, program = 0, clock = defaultClock } = {}) {
    if (this.recording) throw new Error('Já existe uma gravação em andamento.');
    integer(program, 0, 127, 'Instrumento');
    if (typeof clock !== 'function') throw new TypeError('O relógio da gravação precisa ser uma função.');
    const origin = clock();
    if (!Number.isFinite(origin)) throw new Error('O relógio da gravação retornou um tempo inválido.');
    if (track !== undefined) integer(track, 0, 65534, 'Pista');
    const existing = track === undefined ? null : this._song.tracks.find(item => item.id === track);
    if (!existing && this._song.tracks.length >= this.maxTracks) throw new Error(`O limite de ${this.maxTracks} pistas já foi atingido.`);
    let id = track;
    if (id === undefined) {
      id = 0;
      while (this._song.tracks.some(item => item.id === id)) id++;
    }
    const usedChannels = new Set();
    for (const item of this._song.tracks) if (item.id !== id && item.channel !== null) usedChannels.add(item.channel);
    for (const note of this._song.notes) if (note.track !== id) usedChannels.add(note.channel);
    for (const event of this._song.events) if (event.track !== id) usedChannels.add(event.channel);
    for (const event of this._song.programChanges) if (event.track !== id) usedChannels.add(event.channel);
    let channel = existing?.channel;
    if (!Number.isInteger(channel) || channel === 9 || usedChannels.has(channel)) channel = this._availableChannel(usedChannels);
    usedChannels.add(channel);
    this._take = {
      track: { id, name: existing?.name || `Tomada ${id + 1}`, channel, program },
      clock, origin, elapsed: 0, notes: [], events: [{ type: 'program', time: 0, track: id, channel, value: program }],
      usedChannels, inputChannels: new Map(), active: new Map(), sustained: new Map(), pedals: new Map(),
    };
    return { track: id, channel, program };
  }

  noteOn(midi, velocity = 0.8, channel = 0) {
    if (!this._take) return false;
    integer(midi, 0, 127, 'Nota MIDI');
    unit(velocity, 'Velocidade');
    integer(channel, 0, 15, 'Canal MIDI');
    if (velocity === 0) return this.noteOff(midi, channel);
    const time = this._elapsed();
    const output = this._channel(channel);
    const take = this._take;
    if (take.notes.length >= MAX_EVENTS) throw new Error('A gravação excedeu o limite de notas.');
    const note = { midi, velocity, channel: output, track: take.track.id, time, status: 'held', duration: 0, keyDuration: 0 };
    take.notes.push(note);
    const key = `${output}:${midi}`;
    if (!take.active.has(key)) take.active.set(key, []);
    take.active.get(key).push(note);
    return { track: take.track.id, channel: output };
  }

  noteOff(midi, channel = 0) {
    if (!this._take) return false;
    integer(midi, 0, 127, 'Nota MIDI');
    integer(channel, 0, 15, 'Canal MIDI');
    const output = this._take.inputChannels.get(channel);
    if (output === undefined) return false;
    const key = `${output}:${midi}`;
    const queue = this._take.active.get(key);
    if (!queue?.length) return false;
    const time = this._elapsed();
    this._release(queue.shift(), time, false);
    if (!queue.length) this._take.active.delete(key);
    return true;
  }

  /** Device messages use cc/pitchBend/aftertouch/polyAftertouch/program. */
  event(input) {
    if (!this._take) return false;
    if (!input || typeof input !== 'object') throw new TypeError('Evento MIDI precisa ser um objeto.');
    if (input.type === 'noteOn' || input.type === 'noteon') return this.noteOn(input.midi, input.velocity, input.channel ?? 0);
    if (input.type === 'noteOff' || input.type === 'noteoff') return this.noteOff(input.midi, input.channel ?? 0);
    if (!['cc', 'pitchBend', 'aftertouch', 'polyAftertouch', 'program'].includes(input.type)) return false;
    const sourceChannel = integer(input.channel ?? 0, 0, 15, 'Canal MIDI');
    // Validate the payload before it can allocate a channel or change state.
    const event = validateEvent({ ...input, track: this._take.track.id, channel: sourceChannel, time: this._elapsed() });
    event.channel = this._channel(sourceChannel);
    if (this._take.events.length >= MAX_EVENTS) throw new Error('A gravação excedeu o limite de eventos.');
    this._take.events.push(event);
    if (event.type === 'cc') {
      if (event.controller === 64) {
        this._take.pedals.set(event.channel, event.value >= 64);
        if (event.value < 64) this._releasePedal(event.channel, event.time);
      } else if (event.controller === 121) {
        this._take.pedals.set(event.channel, false);
        this._releasePedal(event.channel, event.time);
      } else if (event.controller === 120 || event.controller === 123) {
        for (const [key, notes] of this._take.active) {
          if (notes[0]?.channel !== event.channel) continue;
          for (const note of notes) this._release(note, event.time, event.controller === 120);
          this._take.active.delete(key);
        }
        if (event.controller === 120) this._releasePedal(event.channel, event.time);
      }
    }
    return true;
  }

  stop() {
    if (!this._take) return this.song;
    const completed = this._snapshot(this._elapsed());
    this._song = completed;
    this._take = null;
    return this.song;
  }

  deleteTrack(id) {
    if (this.recording) throw new Error('Pare a gravação antes de excluir uma pista.');
    integer(id, 0, 65534, 'Pista');
    if (!this._song.tracks.some(track => track.id === id)) return false;
    const candidate = { ...this._song, tracks: this._song.tracks.filter(track => track.id !== id), notes: this._song.notes.filter(note => note.track !== id), events: this._song.events.filter(event => event.track !== id), programChanges: this._song.programChanges.filter(event => event.track !== id), duration: 0 };
    this._song = this._validate(candidate);
    return true;
  }

  reset() {
    this._take = null;
    this._song = emptySong();
    return this.song;
  }

  restore(song) {
    if (this.recording) throw new Error('Pare a gravação antes de restaurar outra sessão.');
    const input = typeof song === 'string' ? JSON.parse(song) : song;
    const validated = this._validate(input);
    if (validated.tracks.length > this.maxTracks) throw new Error(`A sessão excede o limite de ${this.maxTracks} pistas.`);
    this._song = validated;
    return this.song;
  }

  _availableChannel(used) {
    for (let channel = 0; channel < 16; channel++) if (channel !== 9 && !used.has(channel)) return channel;
    throw new Error('Não há canais MIDI livres para preservar os instrumentos das pistas.');
  }

  _elapsed() {
    const current = this._take.clock();
    if (!Number.isFinite(current)) throw new Error('O relógio da gravação retornou um tempo inválido.');
    this._take.elapsed = Math.min(MAX_SECONDS, Math.max(this._take.elapsed, (current - this._take.origin) / 1000, 0));
    return this._take.elapsed;
  }

  _channel(source) {
    const take = this._take;
    if (!take.inputChannels.has(source)) {
      const channel = take.inputChannels.size ? this._availableChannel(take.usedChannels) : take.track.channel;
      take.inputChannels.set(source, channel);
      take.usedChannels.add(channel);
      if (channel !== take.track.channel) take.events.push({ type: 'program', time: 0, track: take.track.id, channel, value: take.track.program });
    }
    return take.inputChannels.get(source);
  }

  _release(note, time, immediate) {
    note.keyDuration = Math.max(0, time - note.time);
    note.duration = note.keyDuration;
    if (this._take.pedals.get(note.channel) && !immediate) {
      note.status = 'sustained';
      if (!this._take.sustained.has(note.channel)) this._take.sustained.set(note.channel, []);
      this._take.sustained.get(note.channel).push(note);
    } else note.status = 'done';
  }

  _releasePedal(channel, time) {
    for (const note of this._take.sustained.get(channel) || []) {
      note.duration = Math.max(note.keyDuration, time - note.time);
      note.status = 'done';
    }
    this._take.sustained.delete(channel);
  }

  _snapshot(time) {
    const take = this._take;
    const notes = take.notes.map(({ status, ...note }) => ({ ...note, duration: status === 'done' ? note.duration : Math.max(0, time - note.time), keyDuration: status === 'held' ? Math.max(0, time - note.time) : note.keyDuration }));
    const events = take.events.map(event => ({ ...event }));
    // A persisted snapshot/export must not leave sustain held indefinitely.
    for (const [channel, enabled] of take.pedals) if (enabled) events.push({ type: 'cc', time, track: take.track.id, channel, controller: 64, value: 0 });
    const track = take.track.id;
    const replacing = this._song.tracks.some(item => item.id === track);
    let previousDuration = replacing ? 0 : this._song.duration;
    if (replacing) {
      for (const note of this._song.notes) if (note.track !== track) previousDuration = Math.max(previousDuration, note.time + note.duration);
      for (const event of this._song.events) if (event.track !== track) previousDuration = Math.max(previousDuration, event.time);
      for (const event of this._song.programChanges) if (event.track !== track) previousDuration = Math.max(previousDuration, event.time);
    }
    return this._validate({
      ...this._song,
      notes: [...this._song.notes.filter(note => note.track !== track), ...notes],
      tracks: [...this._song.tracks.filter(item => item.id !== track), take.track],
      events: [...this._song.events.filter(event => event.track !== track), ...events],
      programChanges: [...this._song.programChanges.filter(event => event.track !== track), ...events.filter(event => event.type === 'program').map(event => ({ time: event.time, track, channel: event.channel, program: event.value }))],
      duration: Math.max(previousDuration, time),
    });
  }

  _validate(input) {
    const result = normalizeSong(input);
    if (input.events !== undefined && !Array.isArray(input.events)) throw new Error('A sessão precisa ter uma lista de eventos MIDI.');
    if ((input.events?.length || 0) > MAX_EVENTS) throw new Error('A sessão excede o limite de eventos MIDI.');
    const tracks = new Set(result.tracks.map(track => track.id));
    result.events = (input.events || []).map(validateEvent).sort((a, b) => a.time - b.time);
    for (const event of result.events) if (!tracks.has(event.track)) throw new Error('Evento MIDI referencia uma pista inexistente.');
    result.notes = result.notes.map(note => {
      const original = input.notes[note.id];
      const keyDuration = original?.keyDuration ?? note.duration;
      if (!Number.isFinite(keyDuration) || keyDuration < 0 || keyDuration > note.duration) throw new Error('Duração física da nota é inválida.');
      return { ...note, keyDuration };
    });
    if (!input.tracks?.length && !result.notes.length && !result.events.length && !result.programChanges.length) result.tracks = [];
    result.duration = result.events.reduce((duration, event) => Math.max(duration, event.time), result.duration);
    return result;
  }
}
