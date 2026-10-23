import { normalizeSong, noteName } from './midi.js';
import { handOf } from './practice.js';

const DIVISIONS = 32;
const GRID = 8; // MIDI-derived notation is quantized to sixteenth notes only.
const MAX_SCORE_NOTES = 12_000;
const MAX_MEASURES = 1000;
const durations = [
  [128, 'whole', false], [96, 'half', true], [64, 'half', false], [48, 'quarter', true],
  [32, 'quarter', false], [24, 'eighth', true], [16, 'eighth', false], [12, '16th', true],
  [8, '16th', false], [6, '32nd', true], [4, '32nd', false], [3, '64th', true],
  [2, '64th', false], [1, '128th', false],
];
const escapeXml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function createBeatMap(input) {
  const source = input.tempos?.length ? input.tempos : [{ time: 0, bpm: input.tempo || 120 }];
  const tempos = source.map(event => ({ ...event, beat: 0 }));
  if (tempos[0].time > 0) tempos.unshift({ time: 0, bpm: input.tempo || 120, beat: 0 });
  for (let index = 1; index < tempos.length; index++) tempos[index].beat = tempos[index - 1].beat + (tempos[index].time - tempos[index - 1].time) * tempos[index - 1].bpm / 60;
  function secondsToBeats(time) {
    let low = 0, high = tempos.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (tempos[middle].time <= time) low = middle;
      else high = middle - 1;
    }
    return tempos[low].beat + (time - tempos[low].time) * tempos[low].bpm / 60;
  }
  function beatsToSeconds(beat) {
    let low = 0, high = tempos.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (tempos[middle].beat <= beat) low = middle;
      else high = middle - 1;
    }
    return tempos[low].time + (beat - tempos[low].beat) * 60 / tempos[low].bpm;
  }
  return { tempos, secondsToBeats, beatsToSeconds };
}

function pitchXml(midi) {
  const pitches = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
  const [step, alter] = pitches[midi % 12];
  return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${Math.floor(midi / 12) - 1}</octave></pitch>`;
}

function splitDuration(length) {
  const result = [];
  while (length > 0) {
    const duration = durations.find(([ticks]) => ticks <= length);
    result.push(duration);
    length -= duration[0];
  }
  return result;
}

function restXml(length, voice, staff, wholeMeasure = false) {
  if (!length) return '';
  if (wholeMeasure) return `<note><rest measure="yes"/><duration>${length}</duration><voice>${voice}</voice><staff>${staff}</staff></note>`;
  return splitDuration(length).map(([duration, type, dotted]) => `<note><rest/><duration>${duration}</duration><voice>${voice}</voice><type>${type}</type>${dotted ? '<dot/>' : ''}<staff>${staff}</staff></note>`).join('');
}

function groupXml(group, start, end, voice, staff) {
  let position = start;
  let result = '';
  for (const [duration, type, dotted] of splitDuration(end - start)) {
    const tieStop = position > group.start;
    const tieStart = position + duration < group.end;
    result += group.notes.map((note, index) => {
      const finger = !tieStop && note.finger ? `<technical><fingering>${note.finger}</fingering></technical>` : '';
      const tied = `${tieStop ? '<tied type="stop"/>' : ''}${tieStart ? '<tied type="start"/>' : ''}`;
      return `<note>${index ? '<chord/>' : ''}${pitchXml(note.midi)}<duration>${duration}</duration>${tieStop ? '<tie type="stop"/>' : ''}${tieStart ? '<tie type="start"/>' : ''}<voice>${voice}</voice><type>${type}</type>${dotted ? '<dot/>' : ''}<staff>${staff}</staff>${tied || finger ? `<notations>${tied}${finger}</notations>` : ''}</note>`;
    }).join('');
    position += duration;
  }
  return result;
}

/** Reconstruct conventional grand-staff notation from performance notes.
 * MIDI cannot uniquely describe written rhythm, spelling or independent voices.
 * This transcription is deliberately labelled as a quantized interpretation.
 */
export function songToMusicXml(input, { transpose = 0, configs = input.configs || {} } = {}) {
  const song = normalizeSong(input);
  if (song.notes.length > MAX_SCORE_NOTES) throw new Error(`A partitura automática aceita até ${MAX_SCORE_NOTES.toLocaleString('pt-BR')} notas. Divida esta música em trechos.`);
  const map = createBeatMap(song);
  const warnings = ['Partitura MIDI interpretada em semicolcheias; o áudio original não é quantizado.'];
  const sourceByHand = [[], []];
  let outsideRange = 0;
  for (const note of song.notes) {
    const midi = note.midi + Math.round(transpose);
    if (midi < 0 || midi > 127) { outsideRange++; continue; }
    const hand = handOf(note, configs) === 'left' ? 1 : 0;
    sourceByHand[hand].push({ ...note, midi, beat: map.secondsToBeats(note.time), endBeat: map.secondsToBeats(note.time + (note.keyDuration ?? note.duration)) });
  }
  if (outsideRange) warnings.push(`${outsideRange} nota(s) fora da extensão MIDI após a transposição não foram desenhadas.`);
  const voices = [];
  let maximumEnd = Math.max(GRID, Math.round(map.secondsToBeats(song.duration) * DIVISIONS / GRID) * GRID);
  for (let hand = 0; hand < 2; hand++) {
    const source = sourceByHand[hand].sort((a, b) => a.beat - b.beat || a.midi - b.midi);
    const onsets = [...new Set(source.map(note => note.beat))];
    const nextOnset = new Map(onsets.map((beat, index) => [beat, onsets[index + 1]]));
    const groups = new Map();
    for (const note of source) {
      const next = nextOnset.get(note.beat);
      // MIDI gate lengths often stop slightly early; do not invent tiny rests
      // for articulation gaps below one fifth of a quarter note.
      let endBeat = note.endBeat;
      if (next && next > endBeat && next - endBeat < .2 && endBeat - note.beat >= (next - note.beat) * .5) endBeat = next;
      const start = Math.max(0, Math.round(note.beat * DIVISIONS / GRID) * GRID);
      const end = Math.max(start + GRID, Math.round(endBeat * DIVISIONS / GRID) * GRID);
      maximumEnd = Math.max(maximumEnd, end);
      const key = `${start}:${end}`;
      if (!groups.has(key)) groups.set(key, { start, end, notes: [] });
      if (!groups.get(key).notes.some(previous => previous.midi === note.midi)) groups.get(key).notes.push(note);
    }
    const handVoices = [];
    for (const group of [...groups.values()].sort((a, b) => a.start - b.start || b.end - a.end)) {
      let voice = handVoices.find(candidate => candidate.end <= group.start);
      if (!voice) {
        if (handVoices.length >= 8) throw new Error('A partitura automática encontrou mais de oito vozes simultâneas em uma mão. Use o MusicXML original para esta peça.');
        voice = { id: (hand + 1) * 10 + handVoices.length, staff: hand + 1, groups: [], end: 0 };
        handVoices.push(voice);
      }
      voice.groups.push(group); voice.end = group.end;
    }
    if (!handVoices.length) handVoices.push({ id: (hand + 1) * 10, staff: hand + 1, groups: [], end: 0 });
    voices.push(...handVoices);
  }
  const signatures = song.timeSignatures.map(signature => ({ ...signature, tick: Math.round(map.secondsToBeats(signature.time) * DIVISIONS) }));
  const tempos = map.tempos.map(tempo => ({ ...tempo, tick: Math.round(tempo.beat * DIVISIONS) }));
  const measures = [];
  let position = 0, signatureIndex = 0;
  while (position < maximumEnd) {
    if (measures.length >= MAX_MEASURES) throw new Error(`A partitura automática aceita até ${MAX_MEASURES} compassos. Use um trecho menor.`);
    while (signatureIndex + 1 < signatures.length && signatures[signatureIndex + 1].tick <= position) signatureIndex++;
    const signature = signatures[signatureIndex];
    const normalEnd = position + signature.numerator * 4 / signature.denominator * DIVISIONS;
    const end = Math.min(normalEnd, signatures[signatureIndex + 1]?.tick ?? Infinity);
    if (end <= position) throw new Error('Fórmula de compasso inválida para gerar partitura.');
    measures.push({ start: position, end, signature, implicit: end < normalEnd });
    position = end;
  }
  let previousSignature;
  const body = measures.map((measure, index) => {
    const signature = measure.signature;
    const changed = previousSignature !== signature;
    previousSignature = signature;
    const attributes = index === 0 || changed ? `<attributes>${index === 0 ? `<divisions>${DIVISIONS}</divisions><key><fifths>0</fifths></key>` : ''}${changed ? `<time><beats>${signature.numerator}</beats><beat-type>${signature.denominator}</beat-type></time>` : ''}${index === 0 ? '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>' : ''}</attributes>` : '';
    const directions = tempos.filter(tempo => tempo.tick >= measure.start && tempo.tick < measure.end).map(tempo => `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Number(tempo.bpm.toFixed(3))}</per-minute></metronome></direction-type><offset>${tempo.tick - measure.start}</offset><staff>1</staff><sound tempo="${Number(tempo.bpm.toFixed(3))}"/></direction>`).join('');
    const voiceXml = voices.map((voice, voiceIndex) => {
      const groups = voice.groups.filter(group => group.start < measure.end && group.end > measure.start);
      let time = measure.start;
      let content = voiceIndex ? `<backup><duration>${measure.end - measure.start}</duration></backup>` : '';
      if (!groups.length) return content + restXml(measure.end - measure.start, voice.id, voice.staff, true);
      for (const group of groups) {
        const start = Math.max(group.start, measure.start), end = Math.min(group.end, measure.end);
        content += restXml(start - time, voice.id, voice.staff);
        content += groupXml(group, start, end, voice.id, voice.staff);
        time = end;
      }
      content += restXml(measure.end - time, voice.id, voice.staff);
      return content;
    }).join('');
    return `<measure number="${index + 1}"${measure.implicit ? ' implicit="yes"' : ''}>${attributes}${directions}${voiceXml}${index === measures.length - 1 ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>' : ''}</measure>`;
  }).join('');
  return {
    xml: `<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0"><work><work-title>${escapeXml(song.title)}</work-title></work><identification><creator type="composer">PianoCraft · interpretação MIDI</creator></identification><part-list><score-part id="P1"><part-name>Piano</part-name><part-abbreviation>Pno.</part-abbreviation><score-instrument id="I1"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="P1">${body}</part></score-partwise>`,
    warnings, measureCount: measures.length, source: 'midi',
  };
}

let libraryPromise;
function loadLibrary(document) {
  if (globalThis.opensheetmusicdisplay?.OpenSheetMusicDisplay) return Promise.resolve(globalThis.opensheetmusicdisplay);
  if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('../vendor/opensheetmusicdisplay.min.js', import.meta.url).href;
    script.onload = () => globalThis.opensheetmusicdisplay?.OpenSheetMusicDisplay ? resolve(globalThis.opensheetmusicdisplay) : reject(new Error('O módulo de partitura não foi inicializado.'));
    script.onerror = () => { libraryPromise = null; script.remove(); reject(new Error('Motor de partitura ausente. Execute node scripts/prepare-notation.mjs e reabra o aplicativo.')); };
    document.head.append(script);
  });
  return libraryPromise;
}

function validOriginalXml(text, document) {
  if (typeof text !== 'string' || text.length > 20 * 1024 * 1024 || /<!ENTITY\b/i.test(text)) throw new Error('MusicXML original inválido para a partitura.');
  // A standard external PUBLIC/SYSTEM declaration is descriptive only. Remove
  // it before DOM parsing, so neither the browser nor OSMD can request its DTD.
  // Anything with an internal subset or an unknown declaration stays rejected.
  const externalDoctype = /<!DOCTYPE\s+score-partwise\s+(?:PUBLIC\s+(?:"[^"]*"|'[^']*')\s+(?:"[^"]*"|'[^']*')|SYSTEM\s+(?:"[^"]*"|'[^']*'))\s*>/gi;
  if ((text.match(externalDoctype) || []).length > 1) throw new Error('MusicXML original inválido para a partitura.');
  const sanitized = text.replace(externalDoctype, '');
  if (/<!DOCTYPE\b/i.test(sanitized)) throw new Error('MusicXML original inválido: DTD interna não é permitida.');
  const xml = new document.defaultView.DOMParser().parseFromString(sanitized, 'application/xml');
  if (xml.querySelector('parsererror') || xml.documentElement.localName !== 'score-partwise') throw new Error('A partitura original precisa ser MusicXML score-partwise válido.');
  // MusicXML images/links must not request arbitrary files or network content.
  for (const element of [...xml.getElementsByTagName('*')]) if (['image', 'link', 'bookmark'].includes(element.localName)) element.remove();
  // Some exporters put only <sound tempo="…"/> in a direction. The playback
  // reader accepts it, but OSMD requires a direction-type and otherwise drops
  // the whole measure. Supply the equivalent conventional metronome mark.
  for (const direction of [...xml.getElementsByTagName('*')].filter(element => element.localName === 'direction')) {
    if ([...direction.children].some(element => element.localName === 'direction-type')) continue;
    const sound = [...direction.children].find(element => element.localName === 'sound');
    const bpm = Number(sound?.getAttribute('tempo'));
    const make = (name, value) => {
      const element = xml.createElementNS(direction.namespaceURI, name);
      if (value !== undefined) element.textContent = value;
      return element;
    };
    const type = make('direction-type');
    if (Number.isFinite(bpm) && bpm > 0) {
      const metronome = make('metronome');
      metronome.append(make('beat-unit', 'quarter'), make('per-minute', String(bpm))); type.append(metronome);
    } else {
      const words = make('words', ' '); words.setAttribute('print-object', 'no'); type.append(words);
    }
    direction.prepend(type);
  }
  const serialized = new document.defaultView.XMLSerializer().serializeToString(xml);
  // OSMD treats short strings without an XML declaration as a URL. MusicXML
  // permits omitting the declaration; always identify this validated local XML
  // as content so a valid short score cannot accidentally trigger a request.
  return /^\s*<\?xml\b/.test(serialized) ? serialized : `<?xml version="1.0" encoding="utf-8"?>\n${serialized}`;
}

const controllers = new WeakMap();
const pendingRenders = new WeakMap();

/** Render offline SVG notation. The returned controller owns its cursor and DOM. */
export async function renderScore(container, input, { transpose = 0, configs = input.configs || {}, zoom = 1 } = {}) {
  if (!container?.ownerDocument) throw new TypeError('A partitura precisa de um elemento HTML.');
  const request = {};
  pendingRenders.set(container, request);
  const song = normalizeSong(input);
  // normalizeSong assigns canonical numeric IDs. The application may already
  // have IDs from an earlier normalization, so retain the caller's identity for
  // performance feedback even when its notes were supplied out of time order.
  const feedbackNotes = song.notes.map(note => ({ ...note, feedbackId: input.notes[note.id]?.id ?? note.id }));
  const map = createBeatMap(song);
  const original = !!song.sourceXml && !song.notationEdited;
  const generated = original ? { xml: validOriginalXml(song.sourceXml, container.ownerDocument), source: 'musicxml', warnings: [], measureCount: null } : songToMusicXml(song, { configs });
  const library = await loadLibrary(container.ownerDocument);
  if (pendingRenders.get(container) !== request) throw Object.assign(new Error('Partitura substituída por outra solicitação.'), { name: 'AbortError' });
  controllers.get(container)?.dispose();
  const host = container.ownerDocument.createElement('div');
  host.className = 'notation-score'; host.style.cssText = 'position:relative;background:#fffdf6;color:#252820;min-width:400px;padding:4px 8px;';
  host.setAttribute('aria-label', `Partitura de ${song.title}`);
  container.replaceChildren(host);
  const osmd = new library.OpenSheetMusicDisplay(host, {
    backend: 'svg', autoResize: false, drawTitle: false, drawComposer: false, drawCredits: false,
    drawFingerings: true, drawMeasureNumbers: true, drawPartNames: false, autoBeam: true,
    followCursor: false, pageBackgroundColor: '#fffdf6', newSystemFromXML: false, newPageFromXML: false,
    cursorsOptions: [{ type: 0, color: '#6aaa80', alpha: .32, follow: false }],
  });
  osmd.setLogLevel('error');
  osmd.zoom = clamp(Number(zoom) || 1, .5, 2);
  try {
    await osmd.load(generated.xml, song.title);
    const readErrors = Object.values(osmd.Sheet.Errors || {}).flat().filter(error => typeof error === 'string' && error);
    if (readErrors.length) throw new Error(`O motor de partitura não conseguiu interpretar ${readErrors.length} elemento(s) deste MusicXML. A reprodução continua disponível; exporte uma versão compatível da partitura.`);
    if (pendingRenders.get(container) !== request) { osmd.clear(); host.remove(); throw Object.assign(new Error('Partitura substituída por outra solicitação.'), { name: 'AbortError' }); }
    // Audio uses the expanded timeline, while cursor seeks use source measures.
    for (const repetition of osmd.Sheet.Repetitions || []) repetition.UserNumberOfRepetitions = 1;
    osmd.Sheet.MusicPartManager.reInit();
    if (Math.round(transpose)) {
      osmd.TransposeCalculator = new library.TransposeCalculator();
      osmd.Sheet.Transpose = Math.round(transpose);
      osmd.updateGraphic();
    }
    osmd.render();
  } catch (error) { osmd.clear(); host.remove(); throw error; }
  const positions = [...new Set(osmd.Sheet.SourceMeasures.flatMap(measure => measure.VerticalSourceStaffEntryContainers.map(entry => entry.getAbsoluteTimestamp().RealValue * 4)))].sort((a, b) => a - b);
  let disposed = false, currentIndex = -1, cursorTime = 0;
  const readingPosition = container.ownerDocument.createElement('div');
  readingPosition.className = 'pc-reading-position';
  readingPosition.setAttribute('aria-label', 'Posição na partitura e notas do tempo atual');
  readingPosition.textContent = 'Compasso 1';
  const writtenMeasures = osmd.Sheet.SourceMeasures.map((measure, index) => ({
    index,
    beat: measure.AbsoluteTimestamp?.RealValue * 4 || 0,
    numerator: measure.ActiveTimeSignature?.Numerator || 4,
    denominator: measure.ActiveTimeSignature?.Denominator || 4,
  }));
  let hitTargets = [], noteTargets = [], targetsByNoteId = new Map();
  let readingPitches = new Map(), readingKey = '';
  const inputFeedback = new Map();
  const paintedTargets = new Map();
  const feedbackTimers = new Map();
  const minimumFlashMs = 350;
  let cycle = 0;
  const playbackMeasures = (song.measureTimeline || []).map((measure, index, list) => {
    if (index && measure.sourceBeat < list[index - 1].sourceBeat - 1e-7) cycle++;
    return { ...measure, cycle };
  });
  function refreshHitTargets() {
    if (!readingPosition.isConnected) host.prepend(readingPosition);
    clearPaintedTargets();
    const seen = new Set();
    hitTargets = []; noteTargets = []; targetsByNoteId = new Map(); readingPitches = new Map(); readingKey = '';
    for (const measures of osmd.GraphicSheet.MeasureList) for (const measure of measures) {
      if (!measure) continue;
      for (const entry of measure.staffEntries) for (const voice of entry.graphicalVoiceEntries) for (const note of voice.notes) {
        const heads = note.getNoteheadSVGs?.() || [];
        // OSMD returns every head in a VexFlow chord for each GraphicalNote.
        // Its VexFlow index is the only reliable way to color one chord tone.
        const headIndex = note.vfnoteIndex ?? note.vfnote?.[1] ?? 0;
        const elements = heads.length ? [heads[headIndex]] : [note.getSVGGElement?.()];
        for (const element of elements) {
          if (!element || seen.has(element)) continue;
          seen.add(element);
          const sourceBeat = entry.getAbsoluteTimestamp().RealValue * 4;
          const target = { element, sourceBeat, measure: measure.parentSourceMeasure.measureListIndex };
          hitTargets.push(target);
          if (note.sourceNote.isRest() || !note.sourceNote.Pitch) continue;
          // OSMD 2.x numbers C4 as halfTone 48; standard MIDI numbers C4 as
          // 60. halfTone already includes the score's current transposition.
          target.midi = note.sourceNote.halfTone + 12;
          const tieStart = note.sourceNote.NoteTie?.StartNote;
          target.onsetBeat = tieStart ? tieStart.getAbsoluteTimestamp().RealValue * 4 : sourceBeat;
          element.dataset.pcMidi = target.midi;
          element.dataset.pcSourceBeat = sourceBeat;
          element.setAttribute('aria-label', `${noteName(target.midi, true)}, compasso ${target.measure + 1}`);
          if (!element.querySelector('title')) {
            const title = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = `${noteName(target.midi, true)} · compasso ${target.measure + 1}`;
            element.append(title);
          }
          noteTargets.push(target);
        }
      }
    }
    const byPitchAndOnset = new Map();
    const indexKey = (midi, beat) => `${midi}:${Math.round(beat * 1e5)}`;
    for (const target of noteTargets) {
      const key = indexKey(target.midi, target.onsetBeat);
      if (!byPitchAndOnset.has(key)) byPitchAndOnset.set(key, []);
      byPitchAndOnset.get(key).push(target);
      const beatKey = Math.round(target.sourceBeat * 1e6);
      if (!readingPitches.has(beatKey)) readingPitches.set(beatKey, new Set());
      readingPitches.get(beatKey).add(target.midi);
    }
    for (const note of feedbackNotes) {
      const rawBeat = sourceBeatAt(note.time);
      const beat = original ? rawBeat : Math.round(rawBeat * DIVISIONS / GRID) * GRID / DIVISIONS;
      const targets = byPitchAndOnset.get(indexKey(note.midi + Math.round(transpose), beat));
      if (targets?.length) targetsByNoteId.set(note.feedbackId, targets);
    }
    repaintFeedback();
  }
  function sourceBeatAt(time) {
    const beat = map.secondsToBeats(time);
    if (!original || !song.measureTimeline?.length) return beat;
    let low = 0, high = song.measureTimeline.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (song.measureTimeline[middle].time <= time) low = middle;
      else high = middle - 1;
    }
    const measure = song.measureTimeline[low];
    return measure.sourceBeat + beat - measure.beat;
  }
  function updateReadingPosition(beat) {
    let low = 0, high = writtenMeasures.length - 1;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (writtenMeasures[middle].beat <= beat + 1e-7) low = middle; else high = middle - 1; }
    const measure = writtenMeasures[low];
    if (!measure) return;
    const writtenBeat = Math.max(0, (beat - measure.beat) / (4 / measure.denominator));
    const current = Math.min(measure.numerator, Math.floor(writtenBeat + 1e-7) + 1);
    const key = `${low}:${current}:${currentIndex}`; if (key === readingKey) return; readingKey = key;
    const pitches = [...(readingPitches.get(Math.round(positions[currentIndex] * 1e6)) || [])].sort((a, b) => a - b);
    readingPosition.textContent = `Compasso ${measure.index + 1} · tempo ${current}/${measure.numerator}${pitches.length ? ` · ${pitches.slice(0, 8).map(midi => noteName(midi, true)).join(' · ')}` : ' · pausa'}`;
    readingPosition.dataset.measure = String(measure.index + 1);
    readingPosition.dataset.beat = String(current);
    readingPosition.title = readingPosition.textContent;
  }
  function clearPaintedTargets() {
    for (const [target, paint] of paintedTargets) {
      paint.halo?.remove();
      for (const [element, style] of paint.styles) {
        if (style === null) element.removeAttribute('style');
        else element.setAttribute('style', style);
      }
      target.element.removeAttribute('data-pc-played');
    }
    paintedTargets.clear();
  }
  function paintTarget(target) {
    if (paintedTargets.has(target) || !target.element.isConnected) return;
    const element = target.element;
    const shapes = [...element.querySelectorAll('path,ellipse,circle,rect,polygon')];
    if (!shapes.length && element.matches('path,ellipse,circle,rect,polygon')) shapes.push(element);
    const styles = shapes.map(shape => [shape, shape.getAttribute('style')]);
    // Geometry is read once per note-on or engraving, never in the frame loop.
    // The halo lives inside the head's SVG group, so SVG zoom needs no pixel
    // offsets and no extra page layout or scrolling is triggered by a key.
    let halo = null;
    if (element.tagName.toLowerCase() === 'g') {
      const box = element.getBBox();
      halo = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      halo.setAttribute('cx', box.x + box.width / 2);
      halo.setAttribute('cy', box.y + box.height / 2);
      halo.setAttribute('rx', Math.max(6, box.width * .8));
      halo.setAttribute('ry', Math.max(5, box.height * 1.05));
      halo.setAttribute('fill', '#53dc96');
      halo.setAttribute('fill-opacity', '.42');
      halo.setAttribute('stroke', 'none');
      halo.setAttribute('pointer-events', 'none');
      halo.setAttribute('data-pc-note-halo', '');
      element.prepend(halo);
    }
    for (const shape of shapes) {
      shape.style.setProperty('fill', '#087b43', 'important');
      shape.style.setProperty('stroke', '#087b43', 'important');
      shape.style.setProperty('stroke-width', '.35', 'important');
    }
    element.dataset.pcPlayed = 'true';
    paintedTargets.set(target, { halo, styles });
  }
  function matchingFeedbackTargets(feedback) {
    const explicitIds = Array.isArray(feedback.noteIds);
    let notes;
    if (explicitIds) {
      const ids = new Set(feedback.noteIds);
      notes = feedbackNotes.filter(note => ids.has(note.feedbackId) && note.midi + Math.round(transpose) === feedback.midi);
    } else {
      // Infer only an attack near the supplied playback position. Never search
      // the entire score for the next occurrence of a pressed (wrong) pitch.
      const nearby = feedbackNotes.filter(note => note.midi + Math.round(transpose) === feedback.midi && Math.abs(note.time - feedback.time) <= .25);
      const nearest = nearby.sort((a, b) => Math.abs(a.time - feedback.time) - Math.abs(b.time - feedback.time) || a.time - b.time)[0];
      notes = nearest ? nearby.filter(note => Math.abs(note.time - nearest.time) < 1e-5) : [];
    }
    return [...new Set(notes.flatMap(note => targetsByNoteId.get(note.feedbackId) || []))];
  }
  function repaintFeedback() {
    const desired = new Set([...inputFeedback.values()].flatMap(matchingFeedbackTargets));
    for (const [target, paint] of paintedTargets) {
      if (desired.has(target)) continue;
      paint.halo?.remove();
      for (const [element, style] of paint.styles) {
        if (style === null) element.removeAttribute('style');
        else element.setAttribute('style', style);
      }
      target.element.removeAttribute('data-pc-played');
      paintedTargets.delete(target);
    }
    for (const target of desired) paintTarget(target);
  }
  function removeFeedback(key) {
    const timer = feedbackTimers.get(key);
    if (timer !== undefined) container.ownerDocument.defaultView.clearTimeout(timer);
    feedbackTimers.delete(key);
    inputFeedback.delete(key);
    repaintFeedback();
  }
  refreshHitTargets();
  const controller = {
    osmd, source: generated.source, xml: generated.xml, warnings: generated.warnings,
    get measureCount() { return osmd.Sheet.SourceMeasures.length; },
    get cursorBeat() { return Number(host.dataset.cursorBeat || 0); },
    get readingPosition() { return readingPosition.textContent; },
    /** midi is the audible (transposed) pitch. Explicit [] means no match. */
    inputOn({ midi, time = cursorTime, key = String(midi), noteIds } = {}) {
      if (disposed || !Number.isInteger(midi) || midi < 0 || midi > 127 || !Number.isFinite(time)) return 0;
      const identity = String(key);
      const timer = feedbackTimers.get(identity);
      if (timer !== undefined) container.ownerDocument.defaultView.clearTimeout(timer);
      feedbackTimers.delete(identity);
      inputFeedback.set(identity, { midi, time, key: identity, noteIds, startedAt: container.ownerDocument.defaultView.performance.now() });
      repaintFeedback();
      return matchingFeedbackTargets(inputFeedback.get(identity)).length;
    },
    inputOff(key) {
      if (disposed) return;
      const identity = String(key), feedback = inputFeedback.get(identity);
      if (!feedback) return;
      const remaining = minimumFlashMs - (container.ownerDocument.defaultView.performance.now() - feedback.startedAt);
      if (remaining <= 0) removeFeedback(identity);
      else {
        const old = feedbackTimers.get(identity);
        if (old !== undefined) container.ownerDocument.defaultView.clearTimeout(old);
        feedbackTimers.set(identity, container.ownerDocument.defaultView.setTimeout(() => removeFeedback(identity), remaining));
      }
    },
    clearInputFeedback() {
      for (const timer of feedbackTimers.values()) container.ownerDocument.defaultView.clearTimeout(timer);
      feedbackTimers.clear(); inputFeedback.clear(); clearPaintedTargets();
    },
    timeAtPoint(clientX, clientY) {
      if (disposed || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
      const viewport = container.getBoundingClientRect();
      if (clientX < viewport.left || clientX > viewport.right || clientY < viewport.top || clientY > viewport.bottom) return null;
      let nearest = null, distance = Infinity;
      // SVG rectangles come from OSMD's own GraphicalNote objects. They already
      // include zoom, page layout, scrolling and CSS transforms; no musical
      // time is inferred from a guessed pixel-to-measure scale.
      for (const target of hitTargets) {
        const box = target.element.getBoundingClientRect();
        if (!box.width && !box.height) continue;
        const dx = Math.max(box.left - clientX, 0, clientX - box.right);
        const dy = Math.max(box.top - clientY, 0, clientY - box.bottom);
        const squared = dx * dx + dy * dy;
        if (squared < distance) { distance = squared; nearest = target; }
      }
      if (!nearest || distance > (64 * osmd.zoom) ** 2) return null;
      let beat = nearest.sourceBeat;
      if (original && playbackMeasures.length) {
        const active = [...playbackMeasures].reverse().find(measure => measure.time <= cursorTime + 1e-7) || playbackMeasures[0];
        const occurrences = playbackMeasures.filter(measure => measure.measure === nearest.measure);
        const currentCycle = occurrences.filter(measure => measure.cycle === active.cycle);
        const candidates = currentCycle.length ? currentCycle : occurrences;
        const chosen = candidates.map(measure => ({ beat: measure.beat + nearest.sourceBeat - measure.sourceBeat })).sort((a, b) => Math.abs(map.beatsToSeconds(a.beat) - cursorTime) - Math.abs(map.beatsToSeconds(b.beat) - cursorTime))[0];
        if (chosen) beat = chosen.beat;
      }
      return clamp(map.beatsToSeconds(beat), 0, song.duration);
    },
    setCursor(time) {
      if (disposed || !positions.length) return;
      cursorTime = Math.max(0, Number(time) || 0);
      const beat = sourceBeatAt(cursorTime);
      let low = 0, high = positions.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (positions[middle] <= beat + 1e-7) low = middle;
        else high = middle - 1;
      }
      if (low === currentIndex) { updateReadingPosition(beat); return; }
      currentIndex = low;
      const cursor = osmd.cursor;
      cursor.iterator = osmd.Sheet.MusicPartManager.getIterator(new library.Fraction(Math.round(positions[low] * 1e6), 4e6));
      cursor.show(); cursor.update();
      host.dataset.cursorBeat = positions[low];
      updateReadingPosition(beat);
      const rectangle = cursor.cursorElement.getBoundingClientRect(), viewport = container.getBoundingClientRect();
      if (container.scrollHeight > container.clientHeight && (rectangle.top < viewport.top || rectangle.bottom > viewport.bottom)) container.scrollTop += rectangle.top - viewport.top - 30;
    },
    setZoom(value) {
      if (disposed) return;
      osmd.zoom = clamp(Number(value) || 1, .5, 2); osmd.render(); refreshHitTargets(); currentIndex = -1; controller.setCursor(cursorTime);
    },
    resize() { if (!disposed) { osmd.render(); refreshHitTargets(); currentIndex = -1; controller.setCursor(cursorTime); } },
    dispose() {
      if (disposed) return;
      controller.clearInputFeedback();
      disposed = true; osmd.cursor?.Dispose(); osmd.clear(); host.remove();
      if (controllers.get(container) === controller) controllers.delete(container);
    },
  };
  controllers.set(container, controller);
  controller.setCursor(0);
  return controller;
}
