/**
 * Independent MusicXML score-partwise reader. Public times are seconds.
 * The XML DOMParser is supplied by the browser; no scripts or external data run.
 * Reference: https://www.w3.org/2021/06/musicxml40/
 */
const MAX_XML_LENGTH = 20 * 1024 * 1024;
const MAX_NOTES = 200_000;
const MAX_SECONDS = 86_400;
const EPSILON = 1e-7;
const PITCHES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const BEAT_UNITS = { maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625, '128th': 0.03125 };

function fail(message) { throw new Error(`MusicXML inválido: ${message}`); }
function children(element, name) { return [...element.children].filter(child => child.localName === name); }
function child(element, name) { return children(element, name)[0] || null; }
function descendants(element, name) { return [...element.getElementsByTagNameNS('*', name)]; }
function content(element, name, fallback = '') { return child(element, name)?.textContent.trim() || fallback; }
function numeric(value, label, { fallback, min = -Infinity, max = Infinity, integer = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    fail(`${label} ausente.`);
  }
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) fail(`${label} fora do intervalo suportado.`);
  return result;
}
function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return `musicxml-${(value >>> 0).toString(16).padStart(8, '0')}`;
}
function uniqueChanges(events, defaults) {
  const sorted = [defaults, ...events].sort((a, b) => a.beat - b.beat || a.part - b.part || a.order - b.order);
  const result = [];
  for (const event of sorted) {
    if (result.length && Math.abs(result.at(-1).beat - event.beat) < EPSILON) result[result.length - 1] = event;
    else result.push(event);
  }
  return result;
}

/**
 * Parses uncompressed score-partwise MusicXML, including multiple staves/voices,
 * chord notes, rests, tempo changes, ties, transposition and finger numbers.
 * Simple non-nested forward/backward repeats are played twice. Unsupported
 * navigation, ornaments and grace notes produce explicit playback warnings.
 */
export function parseMusicXml(text, title) {
  if (typeof text !== 'string') throw new TypeError('MusicXML precisa ser texto XML não comprimido.');
  if (text.startsWith('PK')) throw new Error('MusicXML comprimido (.mxl) ainda não é suportado. Exporte como MusicXML não comprimido (.musicxml ou .xml).');
  if (text.length > MAX_XML_LENGTH) fail('arquivo maior que o limite de 20 MB.');
  if (/<!ENTITY\s/i.test(text)) fail('declarações de entidades não são permitidas.');
  if (typeof DOMParser !== 'function') throw new Error('A leitura de MusicXML requer o DOMParser do navegador.');
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.documentElement?.localName === 'parsererror' || descendants(document, 'parsererror').length) fail('o documento XML está malformado.');
  const root = document.documentElement;
  if (root?.localName === 'score-timewise') throw new Error('MusicXML score-timewise ainda não é suportado. Exporte no formato score-partwise.');
  if (root?.localName !== 'score-partwise') fail('raiz score-partwise ausente.');
  const partElements = children(root, 'part');
  if (!partElements.length || partElements.length > 256) fail('a partitura deve conter de 1 a 256 partes.');

  const warnings = new Set();
  const hasEndings = descendants(root, 'ending').length > 0;
  const hasJumps = descendants(root, 'sound').some(element => ['dacapo', 'dalsegno', 'tocoda', 'fine'].some(name => element.hasAttribute(name)));
  if (hasEndings || hasJumps) warnings.add('Casas e saltos não são expandidos: a sequência escrita é tocada uma vez.');
  if (descendants(root, 'pedal').length) warnings.add('As marcações de pedal MusicXML ainda não são interpretadas.');
  if (descendants(root, 'ornaments').length) warnings.add('Ornamentos MusicXML não acrescentam notas à reprodução.');
  const partList = child(root, 'part-list');
  const definitions = new Map((partList ? children(partList, 'score-part') : []).map(element => [element.getAttribute('id'), element]));
  const tracks = [];
  const rawNotes = [];
  const tempoEvents = [];
  const signatureEvents = [];
  const measures = [];
  const repeatStarts = new Set();
  const repeatEnds = new Set();
  let unsupportedRepeat = false;
  let eventOrder = 0;

  for (let partIndex = 0; partIndex < partElements.length; partIndex++) {
    const part = partElements[partIndex];
    const definition = definitions.get(part.getAttribute('id'));
    const name = definition ? content(definition, 'part-name', `Parte ${partIndex + 1}`) : `Parte ${partIndex + 1}`;
    const instruments = new Map();
    if (definition) for (const midi of children(definition, 'midi-instrument')) {
      instruments.set(midi.getAttribute('id'), {
        channel: numeric(content(midi, 'midi-channel'), 'canal MIDI', { fallback: partIndex % 16 + 1, min: 1, max: 16, integer: true }) - 1,
        program: numeric(content(midi, 'midi-program'), 'programa MIDI', { fallback: 1, min: 1, max: 128, integer: true }) - 1,
        unpitched: numeric(content(midi, 'midi-unpitched'), 'nota de percussão MIDI', { fallback: 61, min: 1, max: 128, integer: true }) - 1,
      });
    }
    const defaultInstrument = instruments.values().next().value || { channel: partIndex % 16, program: 0, unpitched: 60 };
    const staffTracks = new Map();
    function trackFor(staff) {
      if (!staffTracks.has(staff)) {
        const track = { id: tracks.length, name: `${name} · pauta ${staff}`, channel: defaultInstrument.channel, program: defaultInstrument.program };
        staffTracks.set(staff, track);
        tracks.push(track);
      }
      return staffTracks.get(staff);
    }
    let divisions = 1;
    let staffCount = 1;
    let signature = { numerator: 4, denominator: 4 };
    const transposes = new Map();
    let defaultTranspose = 0;
    const partMeasures = children(part, 'measure');
    if (!partMeasures.length) fail(`a parte ${name} não contém compassos.`);
    for (let measureIndex = 0; measureIndex < partMeasures.length; measureIndex++) {
      const measure = partMeasures[measureIndex];
      let cursor = 0;
      let extent = 0;
      let chordStart = null;
      let chordVoice = null;
      const globalMeasure = measures[measureIndex] ||= { extent: 0, nominal: 0, implicit: false };
      if (measure.getAttribute('implicit') === 'yes') globalMeasure.implicit = true;
      for (const barline of children(measure, 'barline')) for (const repeat of children(barline, 'repeat')) {
        const direction = repeat.getAttribute('direction');
        const location = barline.getAttribute('location') || (direction === 'forward' ? 'left' : 'right');
        if (!['forward', 'backward'].includes(direction) || !['left', 'right'].includes(location) || (repeat.hasAttribute('times') && repeat.getAttribute('times') !== '2')) { unsupportedRepeat = true; continue; }
        const boundary = measureIndex + (direction === 'forward' ? (location === 'right' ? 1 : 0) : (location === 'left' ? -1 : 0));
        if (boundary < 0) unsupportedRepeat = true;
        else (direction === 'forward' ? repeatStarts : repeatEnds).add(boundary);
      }
      function durationOf(element, allowZero = false) {
        return numeric(content(element, 'duration'), 'duração', { min: allowZero ? 0 : Number.MIN_VALUE, max: 1e9 }) / divisions;
      }
      function addTempo(element, defaultOffset = 0) {
        const offset = numeric(content(element, 'offset'), 'deslocamento', { fallback: defaultOffset * divisions }) / divisions;
        const tempo = numeric(element.getAttribute('tempo'), 'andamento', { fallback: 0, min: 0, max: 100_000 });
        if (tempo > 0) tempoEvents.push({ measure: measureIndex, beat: Math.max(0, cursor + offset), bpm: tempo, part: partIndex, order: eventOrder++ });
      }

      for (const element of measure.children) {
        if (element.localName === 'attributes') {
          if (child(element, 'divisions')) divisions = numeric(content(element, 'divisions'), 'divisões', { min: Number.MIN_VALUE, max: 1e9 });
          const staves = numeric(content(element, 'staves'), 'número de pautas', { fallback: staffCount, min: 1, max: 64, integer: true });
          staffCount = staves;
          for (let staff = 1; staff <= staves; staff++) trackFor(staff);
          const time = children(element, 'time').find(time => !time.hasAttribute('number')) || child(element, 'time');
          if (time && !child(time, 'senza-misura')) {
            const beats = children(time, 'beats');
            const types = children(time, 'beat-type');
            if (beats.length !== 1 || types.length !== 1) fail('compasso composto por denominadores diferentes ainda não é suportado.');
            const numerator = beats[0].textContent.trim().split('+').reduce((total, value) => total + numeric(value.trim(), 'numerador do compasso', { min: 1, max: 128, integer: true }), 0);
            const denominator = numeric(types[0].textContent.trim(), 'denominador do compasso', { min: 1, max: 128, integer: true });
            if ((denominator & (denominator - 1)) !== 0 || numerator > 255) fail('fórmula de compasso não suportada.');
            signature = { numerator, denominator };
            signatureEvents.push({ measure: measureIndex, beat: cursor, ...signature, part: partIndex, order: eventOrder++ });
          }
          for (const transpose of children(element, 'transpose')) {
            const semitones = numeric(content(transpose, 'chromatic'), 'transposição cromática', { fallback: 0, min: -128, max: 128, integer: true }) + 12 * numeric(content(transpose, 'octave-change'), 'transposição de oitava', { fallback: 0, min: -10, max: 10, integer: true });
            if (transpose.hasAttribute('number')) transposes.set(numeric(transpose.getAttribute('number'), 'pauta transposta', { min: 1, max: 64, integer: true }), semitones);
            else defaultTranspose = semitones;
          }
        } else if (element.localName === 'backup' || element.localName === 'forward') {
          cursor += durationOf(element) * (element.localName === 'backup' ? -1 : 1);
          if (cursor < -EPSILON) fail(`backup ultrapassa o início do compasso ${measureIndex + 1}.`);
          cursor = Math.max(0, cursor);
          extent = Math.max(extent, cursor);
          chordStart = null;
        } else if (element.localName === 'direction') {
          const offset = numeric(content(element, 'offset'), 'deslocamento da direção', { fallback: 0 }) / divisions;
          const sounds = children(element, 'sound');
          for (const sound of sounds) addTempo(sound, offset);
          if (!sounds.some(sound => sound.hasAttribute('tempo'))) {
            const metronome = descendants(element, 'metronome')[0];
            if (metronome && child(metronome, 'per-minute')) {
              const unit = BEAT_UNITS[content(metronome, 'beat-unit', 'quarter')];
              if (!unit) fail('unidade de metrônomo não suportada.');
              const dots = children(metronome, 'beat-unit-dot').length;
              const bpm = numeric(content(metronome, 'per-minute'), 'andamento do metrônomo', { min: Number.MIN_VALUE, max: 100_000 }) * unit * (2 - 2 ** -dots);
              tempoEvents.push({ measure: measureIndex, beat: Math.max(0, cursor + offset), bpm, part: partIndex, order: eventOrder++ });
            }
          }
        } else if (element.localName === 'sound') {
          addTempo(element);
        } else if (element.localName === 'note') {
          if (child(element, 'grace')) { warnings.add('Notas de adorno (grace notes) são omitidas na reprodução.'); continue; }
          const duration = durationOf(element);
          const chord = !!child(element, 'chord');
          const voice = content(element, 'voice', chord ? chordVoice || '1' : '1');
          if (chord && (chordStart === null || voice !== chordVoice)) fail(`nota de acorde sem nota anterior correspondente no compasso ${measureIndex + 1}.`);
          const onset = chord ? chordStart : cursor;
          if (!chord) { chordStart = onset; chordVoice = voice; cursor += duration; }
          extent = Math.max(extent, onset + duration, cursor);
          const staff = numeric(content(element, 'staff'), 'pauta', { fallback: 1, min: 1, max: 64, integer: true });
          const track = trackFor(staff);
          if (child(element, 'rest')) { chordStart = null; continue; }
          if (child(element, 'cue')) { warnings.add('Notas de indicação (cue notes) não produzem som.'); continue; }
          const instrument = instruments.get(child(element, 'instrument')?.getAttribute('id')) || defaultInstrument;
          let midi;
          const pitch = child(element, 'pitch');
          if (pitch) {
            const step = content(pitch, 'step');
            if (!(step in PITCHES)) fail('nome de altura musical desconhecido.');
            const octave = numeric(content(pitch, 'octave'), 'oitava', { min: -1, max: 9, integer: true });
            const alter = numeric(content(pitch, 'alter'), 'alteração', { fallback: 0, min: -12, max: 12 });
            if (!Number.isInteger(alter)) fail('alterações microtonais ainda não são suportadas.');
            midi = (octave + 1) * 12 + PITCHES[step] + alter + (transposes.get(staff) ?? defaultTranspose);
          } else if (child(element, 'unpitched')) {
            midi = instrument.unpitched;
          } else fail('nota sem altura, percussão ou pausa.');
          if (!Number.isInteger(midi) || midi < 0 || midi > 127) fail('altura fora do intervalo MIDI 0–127.');
          const fingerText = descendants(element, 'fingering')[0]?.textContent.trim();
          const finger = /^[1-5]$/.test(fingerText || '') ? Number(fingerText) : undefined;
          const ties = new Set(children(element, 'tie').map(tie => tie.getAttribute('type')));
          const velocity = element.hasAttribute('dynamics') ? Math.max(0.01, Math.min(1, numeric(element.getAttribute('dynamics'), 'dinâmica', { min: 0, max: 1000 }) * 90 / 12700)) : 0.8;
          const hand = staffCount === 2 && staff <= 2 ? (staff === 1 ? 'right' : 'left') : undefined;
          rawNotes.push({ measure: measureIndex, beat: onset, beats: duration, midi, velocity, track: track.id, channel: instrument.channel, voice, tieStart: ties.has('start'), tieStop: ties.has('stop'), ...(finger ? { finger } : {}), ...(hand ? { hand } : {}) });
          if (rawNotes.length > MAX_NOTES) fail('quantidade de notas excede 200.000.');
        }
      }
      globalMeasure.extent = Math.max(globalMeasure.extent, extent);
      globalMeasure.nominal = Math.max(globalMeasure.nominal, signature.numerator * 4 / signature.denominator);
    }
  }

  // Align all parts at common measure boundaries. Explicit pickup measures retain
  // their actual length; ordinary underfull measures are padded to their meter.
  let sourceBeats = 0;
  for (const measure of measures) {
    measure.start = sourceBeats;
    measure.length = measure.implicit && measure.extent > 0 ? measure.extent : Math.max(measure.extent, measure.nominal);
    sourceBeats += measure.length;
    if (sourceBeats > 1e7) fail('partitura excessivamente longa.');
  }
  // Only disjoint, non-nested two-pass repeats are expanded. If the notation
  // requires endings, jumps or another repeat count, leave the written order
  // intact and report that limitation instead of choosing an ambiguous route.
  const blocks = [];
  let pendingStart = null;
  let previousEnd = -1;
  for (let index = 0; index < measures.length; index++) {
    if (repeatStarts.has(index)) {
      if (pendingStart !== null) unsupportedRepeat = true;
      pendingStart = index;
    }
    if (repeatEnds.has(index)) {
      const start = pendingStart ?? 0;
      if (start <= previousEnd) unsupportedRepeat = true;
      blocks.push({ start, end: index });
      previousEnd = index;
      pendingStart = null;
    }
  }
  if (pendingStart !== null || [...repeatStarts].some(index => index >= measures.length)) unsupportedRepeat = true;
  if (unsupportedRepeat) warnings.add('Repetições aninhadas, incompletas ou com quantidade diferente de duas execuções não são expandidas; a sequência escrita é tocada uma vez.');
  const sequence = [];
  const repeatedBlocks = new Map(!hasEndings && !hasJumps && !unsupportedRepeat ? blocks.map(block => [block.end, block]) : []);
  for (let index = 0; index < measures.length; index++) {
    sequence.push(index);
    const block = repeatedBlocks.get(index);
    if (block) for (let repeatedIndex = block.start; repeatedIndex <= block.end; repeatedIndex++) sequence.push(repeatedIndex);
  }
  const sourceAbsolute = event => ({ ...event, beat: measures[event.measure].start + event.beat });
  const sourceTempos = uniqueChanges(tempoEvents.map(sourceAbsolute), { beat: 0, bpm: 120, part: -1, order: -1 });
  const sourceSignatures = uniqueChanges(signatureEvents.map(sourceAbsolute), { beat: 0, numerator: 4, denominator: 4, part: -1, order: -1 });
  const byMeasure = list => {
    const result = new Map();
    for (const event of list) { if (!result.has(event.measure)) result.set(event.measure, []); result.get(event.measure).push(event); }
    return result;
  };
  const notesByMeasure = byMeasure(rawNotes);
  const temposByMeasure = byMeasure(tempoEvents);
  const signaturesByMeasure = byMeasure(signatureEvents);
  const playbackNotes = [];
  const playbackTempos = [];
  const playbackSignatures = [];
  const measureTimeline = [];
  let totalBeats = 0;
  let segment = 0;
  function stateAt(events, beat) {
    let low = 0;
    let high = events.length - 1;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (events[middle].beat <= beat) low = middle; else high = middle - 1; }
    return events[low];
  }
  for (let index = 0; index < sequence.length; index++) {
    const measureIndex = sequence[index];
    const measure = measures[measureIndex];
    measureTimeline.push({ measure: measureIndex, beat: totalBeats, sourceBeat: measure.start });
    if (index && measureIndex !== sequence[index - 1] + 1) {
      segment++;
      playbackTempos.push({ ...stateAt(sourceTempos, measure.start), beat: totalBeats, part: -1, order: -1 });
      playbackSignatures.push({ ...stateAt(sourceSignatures, measure.start), beat: totalBeats, part: -1, order: -1 });
    }
    for (const event of notesByMeasure.get(measureIndex) || []) playbackNotes.push({ ...event, beat: totalBeats + event.beat, segment });
    for (const event of temposByMeasure.get(measureIndex) || []) playbackTempos.push({ ...event, beat: totalBeats + event.beat });
    for (const event of signaturesByMeasure.get(measureIndex) || []) playbackSignatures.push({ ...event, beat: totalBeats + event.beat });
    totalBeats += measure.length;
    if (playbackNotes.length > MAX_NOTES) fail('a expansão das repetições excede 200.000 notas.');
  }
  const tempoMap = uniqueChanges(playbackTempos, { beat: 0, bpm: 120, part: -1, order: -1 });
  const signatureMap = uniqueChanges(playbackSignatures, { beat: 0, numerator: 4, denominator: 4, part: -1, order: -1 });
  let elapsed = 0;
  for (let index = 0; index < tempoMap.length; index++) {
    if (index) elapsed += (tempoMap[index].beat - tempoMap[index - 1].beat) * 60 / tempoMap[index - 1].bpm;
    tempoMap[index].time = elapsed;
  }
  function secondsAt(beat) {
    let low = 0;
    let high = tempoMap.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (tempoMap[middle].beat <= beat) low = middle;
      else high = middle - 1;
    }
    const tempo = tempoMap[low];
    return tempo.time + (beat - tempo.beat) * 60 / tempo.bpm;
  }
  const mergedNotes = [];
  const activeTies = new Map();
  for (const note of playbackNotes.sort((a, b) => a.beat - b.beat || a.track - b.track || a.midi - b.midi)) {
    const key = `${note.segment}:${note.track}:${note.voice}:${note.midi}`;
    const tied = activeTies.get(key);
    if (note.tieStop && tied && Math.abs(tied.beat + tied.beats - note.beat) < EPSILON) {
      tied.beats += note.beats;
      if (!note.tieStart) activeTies.delete(key);
    } else {
      if (note.tieStop) warnings.add('Uma ligação de duração sem início compatível foi tocada como nota separada.');
      mergedNotes.push(note);
      if (note.tieStart) activeTies.set(key, note);
      else activeTies.delete(key);
    }
  }
  const notes = mergedNotes.map((note, id) => ({
    id, midi: note.midi, time: secondsAt(note.beat), duration: secondsAt(note.beat + note.beats) - secondsAt(note.beat),
    velocity: note.velocity, track: note.track, channel: note.channel, ...(note.finger ? { finger: note.finger } : {}), ...(note.hand ? { hand: note.hand } : {}),
  }));
  if (activeTies.size) warnings.add('Uma ligação de duração sem término foi encerrada no fim da nota escrita.');
  const duration = tempoMap.reduce((maximum, event) => Math.max(maximum, event.time), secondsAt(totalBeats));
  if (!Number.isFinite(duration) || duration > MAX_SECONDS) fail('duração maior que o limite de 24 horas.');
  const work = child(root, 'work');
  return {
    id: hash(text), title: String(title || (work && content(work, 'work-title')) || content(root, 'movement-title') || 'Partitura MusicXML').slice(0, 256),
    notes, tracks, duration, tempo: tempoMap[0].bpm, tempos: tempoMap.map(({ time, bpm }) => ({ time, bpm })),
    timeSignatures: signatureMap.map(({ beat, numerator, denominator }) => ({ time: secondsAt(beat), numerator, denominator })),
    ppq: 480, warnings: [...warnings], sourceXml: text,
    measureTimeline: measureTimeline.map(({ measure, beat, sourceBeat }) => ({ measure, time: secondsAt(beat), beat, sourceBeat })),
  };
}
