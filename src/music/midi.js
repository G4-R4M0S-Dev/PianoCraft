/** Standard MIDI File support. All public note times are expressed in seconds. */
import { normalizePhrasing } from './phrases.js';
const DEFAULT_TEMPO = 120;
const MAX_NOTES = 1_000_000;
const MAX_SECONDS = 60 * 60 * 24;
const MIN_BPM = 60000000 / 0xffffff;
const MAX_BPM = 60000000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

function fail(message) { throw new Error(`MIDI inválido: ${message}`); }
function number(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function integer(value, min, max, fallback) { return clamp(Math.round(number(value, fallback)), min, max); }
function copyMetadata(value, depth = 0) {
  if (depth > 8) throw new Error('Configuração da música excessivamente aninhada.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 4096);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.slice(0, 1000).map(item => copyMetadata(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key)).slice(0, 1000).map(([key, item]) => [key, copyMetadata(item, depth + 1)]));
  return null;
}
function uid(bytes) {
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return `midi-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

class Reader {
  constructor(bytes) { this.bytes = bytes; this.pos = 0; }
  get remaining() { return this.bytes.length - this.pos; }
  ensure(size) { if (this.remaining < size) fail('arquivo truncado.'); }
  byte() { this.ensure(1); return this.bytes[this.pos++]; }
  u16() { return (this.byte() << 8) | this.byte(); }
  u32() { return (this.byte() * 0x1000000) + (this.byte() << 16) + (this.byte() << 8) + this.byte(); }
  take(size) { this.ensure(size); const result = this.bytes.subarray(this.pos, this.pos + size); this.pos += size; return result; }
  tag() { return String.fromCharCode(...this.take(4)); }
  vlq() {
    let value = 0;
    for (let index = 0; index < 4; index++) {
      const byte = this.byte();
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    fail('quantidade de tempo VLQ excede quatro bytes.');
  }
  data() { const value = this.byte(); if (value > 127) fail('byte de dados fora do intervalo.'); return value; }
}

/** Parse SMF format 0/1 with PPQ/SMPTE timing, running status and sustain. */
export function parseMidi(input, title = 'Música') {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!bytes) throw new TypeError('O arquivo MIDI precisa ser Uint8Array ou ArrayBuffer.');
  const file = new Reader(bytes);
  if (file.tag() !== 'MThd') fail('cabeçalho MThd ausente.');
  const headerLength = file.u32();
  if (headerLength < 6) fail('cabeçalho muito curto.');
  file.ensure(headerLength);
  const format = file.u16();
  const trackCount = file.u16();
  const division = file.u16();
  if (format !== 0 && format !== 1) fail('apenas os formatos SMF 0 e 1 são suportados.');
  if (!trackCount || (format === 0 && trackCount !== 1)) fail('quantidade de pistas incompatível com o formato.');
  let smpteTicksPerSecond = null;
  if (division & 0x8000) {
    const frameCode = (division >> 8) - 256;
    const ticksPerFrame = division & 255;
    if (![-24, -25, -29, -30].includes(frameCode) || !ticksPerFrame) fail('divisão SMPTE inválida: use -24, -25, -29 ou -30 e ticks por quadro maior que zero.');
    const framesPerSecond = frameCode === -29 ? 30000 / 1001 : -frameCode;
    smpteTicksPerSecond = framesPerSecond * ticksPerFrame;
  } else if (!division) fail('a divisão PPQ deve ser maior que zero.');
  file.take(headerLength - 6);
  const tracks = [];
  const events = [];
  let order = 0;
  let endTick = 0;
  for (let trackId = 0; trackId < trackCount; trackId++) {
    // Ancillary chunks are legal in SMF; skip them without interpreting data.
    let tag = file.tag();
    let length = file.u32();
    while (tag !== 'MTrk') {
      file.take(length);
      tag = file.tag();
      length = file.u32();
    }
    const track = new Reader(file.take(length));
    const info = { id: trackId, name: `Pista ${trackId + 1}`, channel: null, program: 0 };
    tracks.push(info);
    let tick = 0;
    let running = 0;
    let hasProgram = false;
    while (track.remaining) {
      tick += track.vlq();
      if (!Number.isSafeInteger(tick)) fail('duração em pulsos excessiva.');
      endTick = Math.max(endTick, tick);
      let status = track.byte();
      if (status < 0x80) {
        if (!running) fail('running status sem evento de canal anterior.');
        track.pos--;
        status = running;
      } else if (status < 0xf0) running = status;
      else running = 0;
      const eventOrder = order++;
      if (status === 0xff) {
        const kind = track.byte();
        const data = track.take(track.vlq());
        if (kind === 0x03) info.name = decoder.decode(data).replace(/\0/g, '').trim() || info.name;
        if (kind === 0x06) events.push({ type: 'marker', tick, text: decoder.decode(data).replace(/\0/g, ''), order: eventOrder });
        if (kind === 0x51) {
          if (data.length !== 3) fail('evento de andamento inválido.');
          const micros = data[0] * 65536 + data[1] * 256 + data[2];
          if (!micros) fail('andamento igual a zero.');
          events.push({ type: 'tempo', tick, micros, order: eventOrder });
        }
        if (kind === 0x58) {
          if (data.length !== 4 || !data[0] || data[1] > 7) fail('fórmula de compasso inválida.');
          events.push({ type: 'signature', tick, numerator: data[0], denominator: 2 ** data[1], order: eventOrder });
        }
        if (kind === 0x2f) {
          if (data.length) fail('evento de fim da pista inválido.');
          break;
        }
      } else if (status === 0xf0 || status === 0xf7) {
        track.take(track.vlq());
      } else if (status >= 0x80 && status <= 0xef) {
        const type = status >> 4;
        const channel = status & 15;
        const a = track.data();
        const b = type === 0xc || type === 0xd ? 0 : track.data();
        if (info.channel === null) info.channel = channel;
        if (type === 0xc && !hasProgram) { info.program = a; hasProgram = true; }
        if (type === 0xc) events.push({ type: 'program', tick, channel, track: trackId, program: a, order: eventOrder });
        if (type === 0x8 || type === 0x9) events.push({ type: type === 0x8 || b === 0 ? 'off' : 'on', tick, midi: a, velocity: b / 127, channel, track: trackId, order: eventOrder });
        if (type === 0xb) events.push({ type: 'cc', tick, controller: a, value: b, channel, track: trackId, order: eventOrder });
        if (type === 0xe) events.push({ type: 'pitchBend', tick, value: a | b << 7, channel, track: trackId, order: eventOrder });
        if (type === 0xd) events.push({ type: 'aftertouch', tick, value: a, channel, track: trackId, order: eventOrder });
        if (type === 0xa) events.push({ type: 'polyAftertouch', tick, midi: a, value: b, channel, track: trackId, order: eventOrder });
      } else fail(`status 0x${status.toString(16)} não suportado em SMF.`);
    }
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const tempoTicks = [{ tick: 0, micros: 500000 }];
  const signatureTicks = [{ tick: 0, numerator: 4, denominator: 4 }];
  for (const event of events) {
    const list = event.type === 'tempo' ? tempoTicks : event.type === 'signature' ? signatureTicks : null;
    if (list) {
      if (list.at(-1).tick === event.tick) list[list.length - 1] = event;
      else list.push(event);
    }
  }
  let seconds = 0;
  for (let i = 0; i < tempoTicks.length; i++) {
    if (smpteTicksPerSecond) seconds = tempoTicks[i].tick / smpteTicksPerSecond;
    else if (i) seconds += (tempoTicks[i].tick - tempoTicks[i - 1].tick) * tempoTicks[i - 1].micros / division / 1e6;
    tempoTicks[i].time = seconds;
  }
  function tickToSeconds(tick) {
    if (smpteTicksPerSecond) return tick / smpteTicksPerSecond;
    let low = 0;
    let high = tempoTicks.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (tempoTicks[middle].tick <= tick) low = middle;
      else high = middle - 1;
    }
    const tempo = tempoTicks[low];
    return tempo.time + (tick - tempo.tick) * tempo.micros / division / 1e6;
  }
  const active = new Map();
  const sustained = Array.from({ length: 16 }, () => []);
  const pedal = Array(16).fill(false);
  const notes = [];
  function finish(note, tick) { note.keyOffTick ??= tick; note.endTick = Math.max(note.tick, tick); notes.push(note); }
  function releasePedal(channel, tick) {
    for (const note of sustained[channel]) finish(note, tick);
    sustained[channel] = [];
  }
  function releaseChannel(channel, tick, immediate) {
    for (const [key, queue] of active) {
      if (queue[0]?.channel !== channel) continue;
      for (const note of queue) {
        note.keyOffTick ??= tick;
        if (pedal[channel] && !immediate) sustained[channel].push(note);
        else finish(note, tick);
      }
      active.delete(key);
    }
    if (immediate) releasePedal(channel, tick);
  }
  for (const event of events) {
    const key = `${event.track}:${event.channel}:${event.midi}`;
    if (event.type === 'on') {
      const queue = active.get(key) || [];
      queue.push(event);
      active.set(key, queue);
      if (notes.length + order > MAX_NOTES * 10) fail('arquivo excede o limite de eventos.');
    } else if (event.type === 'off') {
      const queue = active.get(key);
      if (!queue?.length) continue;
      const note = queue.shift();
      note.keyOffTick = event.tick;
      if (!queue.length) active.delete(key);
      if (pedal[event.channel]) sustained[event.channel].push(note);
      else finish(note, event.tick);
    } else if (event.type === 'cc') {
      if (event.controller === 64) {
        const down = event.value >= 64;
        if (pedal[event.channel] && !down) releasePedal(event.channel, event.tick);
        pedal[event.channel] = down;
      } else if (event.controller === 120) releaseChannel(event.channel, event.tick, true);
      else if (event.controller === 123) releaseChannel(event.channel, event.tick, false);
      else if (event.controller === 121) { pedal[event.channel] = false; releasePedal(event.channel, event.tick); }
    }
  }
  for (let channel = 0; channel < 16; channel++) releaseChannel(channel, endTick, true);
  notes.sort((a, b) => a.tick - b.tick || a.order - b.order);
  if (notes.length > MAX_NOTES) fail('arquivo excede o limite de notas.');
  const duration = tickToSeconds(endTick);
  if (!Number.isFinite(duration) || duration > MAX_SECONDS) fail('duração maior que 24 horas.');
  return {
    id: uid(bytes), title: String(title || 'Música'),
    // duration includes pedal ringing for display; keyDuration is the real key release.
    // Replay/export keyDuration alongside CC64 events so sustain is applied once.
    notes: notes.map((note, id) => ({ id, midi: note.midi, time: tickToSeconds(note.tick), duration: tickToSeconds(note.endTick) - tickToSeconds(note.tick), keyDuration: tickToSeconds(note.keyOffTick) - tickToSeconds(note.tick), velocity: note.velocity, track: note.track, channel: note.channel })),
    tracks, duration,
    tempo: 60000000 / tempoTicks[0].micros,
    tempos: tempoTicks.map(event => ({ time: event.time, bpm: 60000000 / event.micros })),
    timeSignatures: signatureTicks.map(event => ({ time: tickToSeconds(event.tick), numerator: event.numerator, denominator: event.denominator })),
    markers: events.filter(event => event.type === 'marker').map(event => ({ time: tickToSeconds(event.tick), text: event.text })),
    programChanges: events.filter(event => event.type === 'program').map(event => ({ time: tickToSeconds(event.tick), track: event.track, channel: event.channel, program: event.program })),
    events: events.filter(event => ['cc', 'pitchBend', 'aftertouch', 'polyAftertouch', 'program'].includes(event.type)).map(event => ({
      time: tickToSeconds(event.tick), track: event.track, channel: event.channel, type: event.type,
      value: event.type === 'program' ? event.program : event.value,
      ...(event.type === 'cc' ? { controller: event.controller } : {}),
      ...(event.type === 'polyAftertouch' ? { midi: event.midi } : {}),
    })),
    // The editable/export model uses seconds and a musical PPQ clock. SMPTE
    // imports are reconstructed as PPQ 480 on export, retaining absolute time.
    ppq: smpteTicksPerSecond ? 480 : division,
  };
}

/** Validate persisted/custom song data without retaining arbitrary extra fields. */
export function normalizeSong(input, title) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.notes)) throw new Error('A música precisa conter uma lista de notas.');
  if (input.notes.length > MAX_NOTES) throw new Error('A música excede o limite de notas.');
  const trackMap = new Map();
  for (const track of Array.isArray(input.tracks) ? input.tracks : []) {
    const id = integer(track.id, 0, 65534, 0);
    trackMap.set(id, { id, name: String(track.name || `Pista ${id + 1}`).slice(0, 256), channel: track.channel == null ? null : integer(track.channel, 0, 15, 0), program: integer(track.program, 0, 127, 0) });
  }
  const notes = input.notes.map((note, id) => {
    if (!note || !Number.isFinite(note.midi) || !Number.isFinite(note.time) || !Number.isFinite(note.duration) || note.midi < 0 || note.midi > 127 || note.time < 0 || note.duration < 0 || note.time + note.duration > MAX_SECONDS) throw new Error(`Nota ${id + 1} inválida: confira altura, início e duração.`);
    const track = integer(note.track, 0, 65534, 0);
    const channel = integer(note.channel, 0, 15, trackMap.get(track)?.channel ?? 0);
    if (!trackMap.has(track)) trackMap.set(track, { id: track, name: `Pista ${track + 1}`, channel, program: 0 });
    const metadata = {};
    if (note.keyDuration != null) {
      if (!Number.isFinite(note.keyDuration) || note.keyDuration < 0) throw new Error(`Nota ${id + 1} contém duração de tecla inválida.`);
      metadata.keyDuration = Math.min(note.keyDuration, note.duration);
    }
    if (note.hand === 'left' || note.hand === 'right') metadata.hand = note.hand;
    if (Number.isInteger(note.finger) && note.finger >= 1 && note.finger <= 5) metadata.finger = note.finger;
    return { id, midi: Math.round(note.midi), time: note.time, duration: note.duration, velocity: clamp(number(note.velocity, 0.8), 0, 1), track, channel, ...metadata };
  }).sort((a, b) => a.time - b.time || a.id - b.id);
  if (!trackMap.size) trackMap.set(0, { id: 0, name: 'Piano', channel: 0, program: 0 });
  const tempo = clamp(number(input.tempo, DEFAULT_TEMPO), MIN_BPM, MAX_BPM);
  const tempos = (Array.isArray(input.tempos) ? input.tempos : []).map(event => {
    if (!event || !Number.isFinite(event.time) || event.time < 0 || event.time > MAX_SECONDS || !Number.isFinite(event.bpm) || event.bpm < MIN_BPM || event.bpm > MAX_BPM) throw new Error('Mapa de andamento inválido.');
    return { time: event.time, bpm: event.bpm };
  }).sort((a, b) => a.time - b.time);
  if (!tempos.length || tempos[0].time > 0) tempos.unshift({ time: 0, bpm: tempo });
  for (let i = tempos.length - 1; i > 0; i--) if (tempos[i].time === tempos[i - 1].time) tempos.splice(i - 1, 1);
  const timeSignatures = (Array.isArray(input.timeSignatures) ? input.timeSignatures : []).map(event => {
    if (!event || !Number.isFinite(event.time) || event.time < 0 || event.time > MAX_SECONDS || !Number.isInteger(event.numerator) || event.numerator < 1 || event.numerator > 255 || ![1, 2, 4, 8, 16, 32, 64, 128].includes(event.denominator)) throw new Error('Fórmula de compasso inválida.');
    return { time: event.time, numerator: event.numerator, denominator: event.denominator };
  }).sort((a, b) => a.time - b.time);
  if (!timeSignatures.length || timeSignatures[0].time > 0) timeSignatures.unshift({ time: 0, numerator: 4, denominator: 4 });
  const programChanges = (Array.isArray(input.programChanges) ? input.programChanges : []).map(event => {
    if (!event || !Number.isFinite(event.time) || event.time < 0 || event.time > MAX_SECONDS || !Number.isInteger(event.program) || event.program < 0 || event.program > 127) throw new Error('Mudança de instrumento inválida.');
    const track = integer(event.track, 0, 65534, 0);
    const channel = integer(event.channel, 0, 15, trackMap.get(track)?.channel ?? 0);
    if (!trackMap.has(track)) trackMap.set(track, { id: track, name: `Pista ${track + 1}`, channel, program: 0 });
    return { time: event.time, track, channel, program: event.program };
  }).sort((a, b) => a.time - b.time);
  if (Array.isArray(input.events) && input.events.length > MAX_NOTES * 8) throw new Error('A música excede o limite de eventos MIDI.');
  const events = (Array.isArray(input.events) ? input.events : []).map(event => {
    if (!event || !['cc', 'pitchBend', 'aftertouch', 'polyAftertouch', 'program'].includes(event.type) || !Number.isFinite(event.time) || event.time < 0 || event.time > MAX_SECONDS) throw new Error('Evento de expressão MIDI inválido.');
    const value = event.type === 'program' ? event.value ?? event.program : event.value;
    if (!Number.isInteger(value) || value < 0 || value > (event.type === 'pitchBend' ? 16383 : 127)) throw new Error('Valor de expressão MIDI inválido.');
    if (event.type === 'cc' && (!Number.isInteger(event.controller) || event.controller < 0 || event.controller > 127)) throw new Error('Controlador MIDI inválido.');
    if (event.type === 'polyAftertouch' && (!Number.isInteger(event.midi) || event.midi < 0 || event.midi > 127)) throw new Error('Nota de pressão polifônica inválida.');
    const track = integer(event.track, 0, 65534, 0);
    const channel = integer(event.channel, 0, 15, trackMap.get(track)?.channel ?? 0);
    if (!trackMap.has(track)) trackMap.set(track, { id: track, name: `Pista ${track + 1}`, channel, program: 0 });
    return { time: event.time, track, channel, type: event.type, value, ...(event.type === 'cc' ? { controller: event.controller } : {}), ...(event.type === 'polyAftertouch' ? { midi: event.midi } : {}) };
  }).sort((a, b) => a.time - b.time);
  if (Array.isArray(input.markers) && input.markers.length > MAX_NOTES) throw new Error('A música excede o limite de marcadores.');
  const markers = (Array.isArray(input.markers) ? input.markers : []).map(marker => {
    if (!marker || !Number.isFinite(marker.time) || marker.time < 0 || marker.time > MAX_SECONDS || typeof marker.text !== 'string') throw new Error('Marcador MIDI inválido.');
    return { time: marker.time, text: marker.text.slice(0, 4096) };
  }).sort((a, b) => a.time - b.time);
  const duration = notes.reduce((duration, note) => Math.max(duration, note.time + note.duration), Math.max(0, number(input.duration, 0), tempos.at(-1).time, timeSignatures.at(-1).time, programChanges.at(-1)?.time ?? 0, events.at(-1)?.time ?? 0, markers.at(-1)?.time ?? 0));
  if (duration > MAX_SECONDS) throw new Error('A música excede a duração máxima de 24 horas.');
  const metadata = {};
  const phrasing = normalizePhrasing(input.phrasing, duration);
  if (phrasing) metadata.phrasing = phrasing;
  if (typeof input.favorite === 'boolean') metadata.favorite = input.favorite;
  if (input.configs && typeof input.configs === 'object' && !Array.isArray(input.configs)) metadata.configs = copyMetadata(input.configs);
  if (typeof input.sourceXml === 'string' && input.sourceXml.length <= 20 * 1024 * 1024) metadata.sourceXml = input.sourceXml;
  if (input.notationEdited === true) metadata.notationEdited = true;
  if (Array.isArray(input.measureTimeline)) metadata.measureTimeline = input.measureTimeline.map(entry => {
    if (!entry || !Number.isInteger(entry.measure) || entry.measure < 0 || ![entry.time, entry.beat, entry.sourceBeat].every(value => Number.isFinite(value) && value >= 0)) throw new Error('Mapa de compassos da partitura inválido.');
    return { measure: entry.measure, time: entry.time, beat: entry.beat, sourceBeat: entry.sourceBeat };
  }).sort((a, b) => a.time - b.time);
  return { id: String(input.id || `song-${Date.now()}`), title: String(title || input.title || 'Música').slice(0, 256), notes, tracks: [...trackMap.values()].sort((a, b) => a.id - b.id), duration, tempo: tempos[0].bpm, tempos, timeSignatures, markers, programChanges, events, ppq: integer(input.ppq, 1, 32767, 480), ...metadata };
}

function vlq(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x0fffffff) throw new Error('Intervalo MIDI excede o limite de quatro bytes.');
  const result = [value & 127];
  while ((value = Math.floor(value / 128))) result.unshift((value & 127) | 128);
  return result;
}
function u16(value) { return [(value >> 8) & 255, value & 255]; }
function u32(value) { return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]; }
function meta(type, data) { return [0xff, type, ...vlq(data.length), ...data]; }

/** Encode a song as SMF 1 (SMF 0 for one track), retaining absolute musical time. */
export function encodeMidi(input) {
  const song = normalizeSong(input);
  if (song.tracks.length > 65535) throw new Error('Quantidade excessiva de pistas MIDI.');
  const ppq = song.ppq;
  const tempos = song.tempos.map(event => ({ ...event, micros: clamp(Math.round(60000000 / event.bpm), 1, 0xffffff), tick: 0 }));
  for (let i = 1; i < tempos.length; i++) tempos[i].tick = tempos[i - 1].tick + (tempos[i].time - tempos[i - 1].time) * ppq * 1e6 / tempos[i - 1].micros;
  function secondsToTicks(time) {
    let low = 0;
    let high = tempos.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (tempos[mid].time <= time) low = mid;
      else high = mid - 1;
    }
    return Math.round(tempos[low].tick + (time - tempos[low].time) * ppq * 1e6 / tempos[low].micros);
  }
  let order = 0;
  const inputTracks = new Map(song.tracks.map(track => [track.id, track]));
  const eventTracks = Array.from({ length: song.tracks.at(-1).id + 1 }, (_, id) => ({ ...(inputTracks.get(id) || { id, name: `Pista ${id + 1}`, channel: null, program: 0 }), events: [], channels: new Set() }));
  const byId = new Map(eventTracks.map(track => [track.id, track]));
  for (const note of song.notes) byId.get(note.track).channels.add(note.channel);
  for (const event of song.events) byId.get(event.track).channels.add(event.channel);
  const add = (track, tick, priority, data) => track.events.push({ tick, priority, data, order: order++ });
  const conductor = eventTracks[0];
  for (const tempo of tempos) add(conductor, secondsToTicks(tempo.time), 0, meta(0x51, [(tempo.micros >> 16) & 255, (tempo.micros >> 8) & 255, tempo.micros & 255]));
  for (const signature of song.timeSignatures) add(conductor, secondsToTicks(signature.time), 0, meta(0x58, [signature.numerator, Math.log2(signature.denominator), 24, 8]));
  for (const marker of song.markers) add(conductor, secondsToTicks(marker.time), 0, meta(0x06, [...encoder.encode(marker.text)]));
  for (const track of eventTracks) {
    add(track, 0, -2, meta(0x03, [...encoder.encode(track.name)]));
    const channels = track.channels;
    if (!channels.size) channels.add(track.channel ?? 0);
    for (const channel of channels) {
      const explicit = song.events.some(event => event.type === 'program' && event.time === 0 && event.track === track.id && event.channel === channel) || song.programChanges.some(event => event.time === 0 && event.track === track.id && event.channel === channel);
      if (!explicit) add(track, 0, -1, [0xc0 | channel, track.program]);
    }
  }
  const programs = new Set();
  const addProgram = (time, track, channel, program) => {
    const tick = secondsToTicks(time);
    const key = `${tick}:${track}:${channel}:${program}`;
    if (!programs.has(key)) add(byId.get(track), tick, 0, [0xc0 | channel, program]);
    programs.add(key);
  };
  for (const event of song.events) {
    const track = byId.get(event.track), tick = secondsToTicks(event.time), channel = event.channel;
    if (event.type === 'program') addProgram(event.time, event.track, channel, event.value);
    else if (event.type === 'cc') add(track, tick, 0, [0xb0 | channel, event.controller, event.value]);
    else if (event.type === 'pitchBend') add(track, tick, 0, [0xe0 | channel, event.value & 127, event.value >> 7]);
    else if (event.type === 'aftertouch') add(track, tick, 0, [0xd0 | channel, event.value]);
    else if (event.type === 'polyAftertouch') add(track, tick, 0, [0xa0 | channel, event.midi, event.value]);
  }
  for (const change of song.programChanges) addProgram(change.time, change.track, change.channel, change.program);
  for (const note of song.notes) {
    const track = byId.get(note.track);
    const tick = secondsToTicks(note.time);
    const endTick = Math.max(tick + 1, secondsToTicks(note.time + (note.keyDuration ?? note.duration)));
    add(track, tick, 2, [0x90 | note.channel, note.midi, Math.max(1, Math.round(note.velocity * 127))]);
    add(track, endTick, 1, [0x80 | note.channel, note.midi, 0]);
  }
  const chunks = [];
  for (const track of eventTracks) {
    track.events.sort((a, b) => a.tick - b.tick || a.priority - b.priority || a.order - b.order);
    const data = [];
    let previousTick = 0;
    for (const event of track.events) {
      data.push(...vlq(event.tick - previousTick), ...event.data);
      previousTick = event.tick;
    }
    data.push(...vlq(Math.max(previousTick, secondsToTicks(song.duration)) - previousTick), 0xff, 0x2f, 0);
    const chunk = new Uint8Array(8 + data.length);
    chunk.set([77, 84, 114, 107, ...u32(data.length)]);
    chunk.set(data, 8);
    chunks.push(chunk);
  }
  const header = [77, 84, 104, 100, 0, 0, 0, 6, ...u16(eventTracks.length > 1 ? 1 : 0), ...u16(eventTracks.length), ...u16(ppq)];
  const result = new Uint8Array(header.length + chunks.reduce((size, chunk) => size + chunk.length, 0));
  result.set(header);
  let offset = header.length;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export function noteName(midi, solfege = false) {
  const value = integer(midi, 0, 127, 60);
  const names = solfege ? ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'] : ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return `${names[value % 12]}${Math.floor(value / 12) - 1}`;
}

/** Original, self-contained exercises. No commercial song or application assets. */
export function createDemoSongs() {
  const make = (id, title, bpm, notes, tracks) => normalizeSong({ id, title, notes, tracks, tempo: bpm, ppq: 480 });
  const note = (midi, time, duration, track = 0, velocity = 0.8) => ({ midi, time, duration, velocity, track, channel: track, hand: track === 1 ? 'left' : 'right' });
  const scale = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60];
  const chordProgression = [[48, 60, 64, 67], [53, 60, 65, 69], [55, 59, 62, 67], [48, 60, 64, 67]];
  const chords = [];
  for (let bar = 0; bar < chordProgression.length; bar++) {
    const pitches = chordProgression[bar];
    chords.push(note(pitches[0], bar * 3, 2.8, 1, 0.66));
    pitches.slice(1).forEach((pitch, i) => chords.push(note(pitch, bar * 3 + i * 0.5, 0.44)));
    pitches.slice(1).forEach(pitch => chords.push(note(pitch, bar * 3 + 1.5, 1.3)));
  }
  const melody = [64, 67, 72, 71, 69, 65, 69, 67, 67, 62, 65, 71, 72, 67, 64, 60];
  const study = melody.map((pitch, i) => note(pitch, i * 0.5, i === melody.length - 1 ? 1.75 : 0.43));
  [48, 53, 55, 48].forEach((bass, bar) => {
    [bass, bass + 7, bass + 12, bass + 7].forEach((pitch, beat) => study.push(note(pitch, bar * 2 + beat * 0.5, bar === 3 && beat === 3 ? 1.75 : 0.46, 1, 0.62)));
  });
  const right = { id: 0, name: 'Mão direita', channel: 0, program: 0 };
  const left = { id: 1, name: 'Mão esquerda', channel: 1, program: 0 };
  return [
    make('demo-c-major', 'Primeiros passos · Dó maior', 100, scale.map((pitch, i) => note(pitch, i * 0.6, 0.5)), [right]),
    make('demo-chords', 'Acordes e arpejos', 120, chords, [right, left]),
    make('demo-two-hands', 'Pequeno estudo para duas mãos', 120, study, [right, left]),
  ];
}
