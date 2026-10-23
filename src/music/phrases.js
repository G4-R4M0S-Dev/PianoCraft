import { analyzePatterns, normalizePatternAnalysis } from './patterns.js';
/** Revisable musical phrase suggestions. Times in this module are always seconds. */
const EPSILON = 1e-7;
const MAX_PHRASES = 512;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const finite = n => typeof n === 'number' && Number.isFinite(n);
const cleanText = (value, fallback, max = 240) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;

/** Restore a safe, contiguous partition without changing any music events. */
export function normalizePhrases(input, duration) {
  if (!finite(duration) || duration <= 0 || !Array.isArray(input) || !input.length) return [];
  const entries = input.slice(0, MAX_PHRASES).filter(p => p && finite(p.start) && finite(p.end) && p.start >= 0 && p.end > p.start && p.start < duration)
    .map((p, i) => ({ id: cleanText(p.id, `phrase-${i + 1}`, 80), name: cleanText(p.name, `Frase ${i + 1}`, 100), start: clamp(p.start, 0, duration), end: clamp(p.end, 0, duration), confidence: finite(p.confidence) ? clamp(p.confidence, 0, 1) : 0.5, reason: cleanText(p.reason, 'Divisão revisada manualmente.') }))
    .sort((a, b) => a.start - b.start);
  const result = [], ids = new Set();
  for (const entry of entries) {
    if (result.length && entry.start - result.at(-1).start <= EPSILON) continue;
    let id = entry.id, suffix = 2;
    while (ids.has(id)) id = `${entry.id.slice(0, 70)}-${suffix++}`;
    ids.add(id);
    result.push({ ...entry, id });
  }
  if (result.length) {
    result[0].start = 0;
    for (let i = 0; i < result.length; i++) result[i].end = result[i + 1]?.start ?? duration;
  }
  return result;
}

/** The only phrase metadata accepted in project JSON/backups. */
export function normalizePhrasing(input, duration) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if(input.version===2||Array.isArray(input.patterns))return normalizePatternAnalysis(input,duration);
  const phrases = normalizePhrases(input.phrases, duration);
  if (!phrases.length) return null;
  const result = { version: 1, phrases, reviewed: input.reviewed === true };
  if (finite(input.targetBars)) result.targetBars = clamp(Math.round(input.targetBars), 1, 64);
  if (finite(input.targetCount)) result.targetCount = clamp(Math.round(input.targetCount), 1, 256);
  if (Array.isArray(input.tracks)) result.tracks = [...new Set(input.tracks.filter(id => Number.isInteger(id) && id >= 0 && id <= 65534))].slice(0, 256);
  return result;
}

function phraseIndex(phrases, idOrIndex) {
  const index = typeof idOrIndex === 'number' ? idOrIndex : phrases.findIndex(p => p.id === idOrIndex);
  if (!Number.isInteger(index) || index < 0 || index >= phrases.length) throw new Error('Selecione uma frase válida.');
  return index;
}
function editable(input, duration) {
  const phrases = normalizePhrases(input, duration);
  if (!phrases.length) throw new Error('Não há frases para editar.');
  return phrases;
}

/** Move the END of phrase i and the START of phrase i+1. */
export function movePhraseBoundary(input, idOrIndex, time, duration) {
  const phrases = editable(input, duration), i = phraseIndex(phrases, idOrIndex);
  if (i === phrases.length - 1) throw new Error('O final da última frase é o final da música.');
  if (!finite(time) || time <= phrases[i].start + EPSILON || time >= phrases[i + 1].end - EPSILON) throw new Error('O limite deve ficar entre o início desta frase e o fim da seguinte.');
  phrases[i].end = phrases[i + 1].start = time;
  phrases[i].reason = phrases[i + 1].reason = 'Limite ajustado manualmente.';
  return phrases;
}

export function splitPhrase(input, idOrIndex, time, duration) {
  const phrases = editable(input, duration), i = phraseIndex(phrases, idOrIndex), phrase = phrases[i];
  if (phrases.length >= MAX_PHRASES) throw new Error('Limite de 512 frases atingido.');
  if (!finite(time) || time <= phrase.start + EPSILON || time >= phrase.end - EPSILON) throw new Error('Posicione o corte dentro da frase selecionada.');
  const ids = new Set(phrases.map(p => p.id)); let id = `${phrase.id.slice(0, 66)}-part`, suffix = 2;
  while (ids.has(id)) id = `${phrase.id.slice(0, 64)}-part-${suffix++}`;
  phrases.splice(i, 1, { ...phrase, end: time, reason: 'Frase dividida manualmente.' }, { ...phrase, id, name: `${phrase.name.slice(0, 88)} — parte 2`, start: time, reason: 'Frase dividida manualmente.' });
  return phrases;
}

export function mergePhrases(input, idOrIndex, duration) {
  const phrases = editable(input, duration), i = phraseIndex(phrases, idOrIndex);
  if (i === phrases.length - 1) throw new Error('Selecione uma frase que tenha uma seguinte para unir.');
  phrases.splice(i, 2, { ...phrases[i], end: phrases[i + 1].end, reason: 'Frases unidas manualmente.', confidence: Math.min(phrases[i].confidence, phrases[i + 1].confidence) });
  return phrases;
}

export function getPhraseAtTime(phrases, time) {
  if (!finite(time) || !Array.isArray(phrases)) return null;
  return phrases.find((p, i) => time >= p.start - EPSILON && (time < p.end - EPSILON || i === phrases.length - 1 && time <= p.end + EPSILON)) ?? null;
}

function upperIndex(array, value, key = n => n) {
  let low = 0, high = array.length;
  while (low < high) { const middle = (low + high) >>> 1; if (key(array[middle]) <= value) low = middle + 1; else high = middle; }
  return low;
}

/** Quarter-note beats retain musical distances across tempo changes. */
function musicalClock(song, duration) {
  const entries = (song.tempos ?? []).filter(t => finite(t.time) && t.time >= 0 && finite(t.bpm) && t.bpm > 0).map(t => ({ time: t.time, bpm: t.bpm })).sort((a, b) => a.time - b.time);
  if (!entries.length || entries[0].time > 0) entries.unshift({ time: 0, bpm: finite(song.tempo) && song.tempo > 0 ? song.tempo : 120 });
  const tempos = [];
  for (const entry of entries) { if (tempos.at(-1)?.time === entry.time) tempos[tempos.length - 1] = entry; else tempos.push(entry); }
  tempos[0].beat = 0;
  for (let i = 1; i < tempos.length; i++) tempos[i].beat = tempos[i - 1].beat + (tempos[i].time - tempos[i - 1].time) * tempos[i - 1].bpm / 60;
  const toBeat = time => { const e = tempos[Math.max(0, upperIndex(tempos, time, t => t.time) - 1)]; return e.beat + (time - e.time) * e.bpm / 60; };
  const toTime = beat => { const e = tempos[Math.max(0, upperIndex(tempos, beat, t => t.beat) - 1)]; return e.time + (beat - e.beat) * 60 / e.bpm; };
  const signatures = (song.timeSignatures ?? []).filter(s => finite(s.time) && s.time >= 0 && s.time < duration && finite(s.numerator) && s.numerator > 0 && finite(s.denominator) && s.denominator > 0).sort((a, b) => a.time - b.time);
  if (!signatures.length || signatures[0].time > 0) signatures.unshift({ time: 0, numerator: 4, denominator: 4 });
  const sections = [];
  for (let i = 0; i < signatures.length; i++) {
    const signature = signatures[i], beat = toBeat(signature.time), endBeat = toBeat(Math.min(duration, signatures[i + 1]?.time ?? duration));
    if (endBeat <= beat) continue;
    const beatsPerBar = signature.numerator * 4 / signature.denominator;
    const prior = sections.at(-1), bar = prior ? prior.bar + (beat - prior.beat) / prior.beatsPerBar : 0;
    sections.push({ time: signature.time, beat, endBeat, beatsPerBar, bar });
  }
  if (!sections.length) sections.push({ time: 0, beat: 0, endBeat: toBeat(duration), beatsPerBar: 4, bar: 0 });
  const toBar = time => { const beat = toBeat(time), s = sections[Math.max(0, upperIndex(sections, beat, s => s.beat) - 1)]; return s.bar + (beat - s.beat) / s.beatsPerBar; };
  const barToTime = bar => { const s = sections[Math.max(0, upperIndex(sections, bar, s => s.bar) - 1)]; return toTime(s.beat + (bar - s.bar) * s.beatsPerBar); };
  return { toBeat, toTime, toBar, barToTime, sections, totalBars: toBar(duration) };
}

function melodicNotes(song, tracks) {
  const playable = (song.notes ?? []).filter(n => finite(n.time) && finite(n.midi) && finite(n.duration) && n.time >= 0 && n.duration >= 0 && n.channel !== 9);
  const byTrack = new Map();
  for (const note of playable) { const list = byTrack.get(note.track ?? 0) ?? []; list.push(note); byTrack.set(note.track ?? 0, list); }
  let selected = Array.isArray(tracks) && tracks.length ? [...new Set(tracks.filter(id => byTrack.has(id)))] : [];
  if (!selected.length && byTrack.size) {
    // Prefer a high-register, active, relatively monophonic part. This is an
    // inference only; an explicit track choice is retained in project metadata.
    let winner, best = -Infinity;
    for (const [id, notes] of byTrack) {
      const attacks = new Set(notes.map(n => Math.round(n.time * 100))).size;
      const score = notes.reduce((sum, n) => sum + n.midi, 0) / notes.length + 10 * attacks / notes.length + Math.min(10, Math.log2(notes.length + 1));
      if (score > best) { best = score; winner = id; }
    }
    selected = [winner];
  }
  const notes = selected.flatMap(id => byTrack.get(id) ?? []).sort((a, b) => a.time - b.time || b.midi - a.midi);
  // For a polyphonic part, consider its upper voice at each attack. A held bass
  // note or its sustain tail cannot erase a pause in a separate melody track.
  const skyline = [];
  for (const note of notes) {
    const last = skyline.at(-1);
    if (last && Math.abs(last.time - note.time) <= 0.012) { if (note.midi > last.midi) skyline[skyline.length - 1] = note; }
    else skyline.push(note);
  }
  return { notes: skyline, tracks: selected };
}

function melodyFeatures(notes, clock) {
  const groups = notes.map(n => ({ time: n.time, beat: clock.toBeat(n.time), end: clock.toBeat(n.time + (finite(n.keyDuration) ? n.keyDuration : n.duration)), pitch: n.midi }));
  let end = -Infinity;
  for (const group of groups) { end = Math.max(end, group.end); group.prefixEnd = end; }
  const motifs = new Map();
  for (let i = 0; i < groups.length - 3; i++) {
    const first = groups[i], window = groups.slice(i, i + 4);
    const key = window.map((n, j) => `${n.pitch - first.pitch}:${Math.round((n.beat - first.beat) * 4)}`).join('|');
    first.motif = key; motifs.set(key, (motifs.get(key) ?? 0) + 1);
  }
  return { groups, motifs };
}

/** Suggest cut points; this is a musical heuristic for human review, not an
 * assertion of harmonic or semantic phrase understanding. */
export function suggestPhrases(song, options = {}) {
  if(options.strategy==='patterns'||(options.targetBars===undefined&&options.targetMeasures===undefined&&options.targetCount===undefined&&options.count===undefined))return analyzePatterns(song,options);
  const notes = Array.isArray(song?.notes) ? song.notes : [];
  const duration = finite(song?.duration) ? Math.max(0, song.duration) : notes.reduce((end, n) => Math.max(end, (n.time ?? 0) + (n.duration ?? 0)), 0);
  const targetBars = clamp(Math.round(Number(options.targetBars ?? options.targetMeasures) || 4), 1, 64);
  const rawCount = Number(options.targetCount ?? options.count);
  const requestedCount = Number.isFinite(rawCount) && rawCount > 0 ? clamp(Math.round(rawCount), 1, 256) : null;
  const emptyAnalysis = { melodyTracks: [], totalBars: 0, targetBars, requestedCount, actualCount: 0 };
  if (!duration || !notes.length) return { phrases: [], warnings: ['Não há notas com duração para sugerir frases.'], analysis: emptyAnalysis };
  const clock = musicalClock(song, duration), melody = melodicNotes(song, options.tracks), features = melodyFeatures(melody.notes, clock);
  const totalBars = clock.totalBars, count = Math.min(requestedCount ?? Math.max(1, Math.ceil(totalBars / targetBars - EPSILON)), 256, Math.max(1, Math.floor(duration / 0.001)));
  const idealLength = totalBars / count;
  const candidates = new Map();
  function add(time, reason, bonus = 0, marker = '') {
    if (!finite(time) || time < EPSILON || time >= duration - EPSILON) return;
    const key = Math.round(time * 1e6), old = candidates.get(key);
    if (!old && candidates.size < 50000) candidates.set(key, { time, bar: clock.toBar(time), beat: clock.toBeat(time), bonus, reason, marker });
    else if (old && bonus > old.bonus) Object.assign(old, { bonus, reason, marker: marker || old.marker });
  }
  // Meter changes reset the measure grid. Extremely long/unusually fast files
  // are sampled to bound memory, while requested target cuts remain available.
  const step = Math.max(1, Math.ceil(totalBars / 12000));
  for (const section of clock.sections) {
    add(section.time, 'Mudança de compasso.', 1.7);
    const sectionBars = (section.endBeat - section.beat) / section.beatsPerBar;
    for (let bar = step; bar < sectionBars - EPSILON; bar += step) add(clock.toTime(section.beat + bar * section.beatsPerBar), 'Início de compasso.', 0.4);
    if (section.endBeat < clock.toBeat(duration) - EPSILON) add(clock.toTime(section.endBeat), 'Mudança de compasso.', 1.7);
  }
  for (const marker of song.markers ?? []) if (finite(marker.time)) add(marker.time, `Marcador: ${cleanText(marker.text, 'seção', 120)}`, 3.5, cleanText(marker.text, '', 100));
  const { groups, motifs } = features;
  // Gap boundaries include the next attack, so an off-beat pickup is not
  // blindly snapped to the nearest measure and lost from its new phrase.
  for (let i = 1; i < groups.length; i++) {
    const rest = groups[i].beat - groups[i - 1].prefixEnd;
    if (rest >= 0.3) add(groups[i].time, 'Pausa na linha melódica.', 0.7);
  }
  // Musical rather than wall-clock spacing is also the safe fallback for an
  // exact requested count, including long notes without natural rests.
  for (let i = 1; i < count; i++) add(clock.barToTime(totalBars * i / count), 'Divisão por extensão musical; revise este limite.', 0);
  const sorted = [...candidates.values()].sort((a, b) => a.time - b.time);
  for (const candidate of sorted) {
    const nextIndex = upperIndex(groups, candidate.beat - EPSILON, n => n.beat), before = groups[nextIndex - 1], after = groups[nextIndex];
    const rest = before && after && before.prefixEnd <= candidate.beat + EPSILON ? after.beat - before.prefixEnd : 0;
    let merit = candidate.bonus;
    if (rest >= 0.3) { merit += Math.min(2.5, rest * 1.5); if (candidate.bonus < 1.7) candidate.reason = 'Pausa na linha melódica, próxima de um novo ataque.'; }
    if (after?.motif && motifs.get(after.motif) > 1 && after.beat - candidate.beat <= 0.5) { merit += 0.8; if (rest < 0.3 && candidate.bonus < 1.7) candidate.reason = 'Retorno de um desenho melódico.'; }
    if (before && before.end - before.beat >= 1 && before.end <= candidate.beat + 0.125) merit += 0.25;
    if (before?.prefixEnd > candidate.beat + 0.125) merit -= 1.15;
    candidate.merit = merit;
  }
  // Layered dynamic programming balances phrase lengths against actual musical
  // evidence. Each layer retains bounded alternatives around its ideal place.
  let states = [{ candidate: { time: 0, bar: 0, merit: 0 }, cost: 0, path: [] }];
  for (let layer = 1; layer < count; layer++) {
    const ideal = totalBars * layer / count, radius = Math.max(idealLength * 1.25, 0.5);
    let pool = sorted.filter(c => Math.abs(c.bar - ideal) <= radius && c.time >= layer * 0.001 && duration - c.time >= (count - layer) * 0.001);
    pool = pool.map(c => ({ c, rank: Math.abs(c.bar - ideal) / Math.max(idealLength, EPSILON) - c.merit * 0.22 })).sort((a, b) => a.rank - b.rank).slice(0, 72).map(p => p.c).sort((a, b) => a.time - b.time);
    const nextStates = [];
    for (const candidate of pool) {
      let best;
      for (const state of states) {
        const length = candidate.bar - state.candidate.bar;
        if (candidate.time <= state.candidate.time + EPSILON || length <= EPSILON) continue;
        const ratio = length / Math.max(idealLength, EPSILON), cost = state.cost + 4 * (ratio - 1) ** 2 + (ratio < 0.3 ? 5 : 0) - candidate.merit;
        if (!best || cost < best.cost) best = { candidate, cost, path: [...state.path, candidate] };
      }
      if (best) nextStates.push(best);
    }
    if (!nextStates.length) break;
    states = nextStates;
  }
  let best;
  for (const state of states) {
    const ratio = (totalBars - state.candidate.bar) / Math.max(idealLength, EPSILON), cost = state.cost + 4 * (ratio - 1) ** 2 + (ratio < 0.3 ? 5 : 0);
    if (!best || cost < best.cost) best = { ...state, cost };
  }
  // In a very dense file the bounded candidate beam can run out of ordered
  // alternatives. Retain the explicit count with transparent musical spacing.
  const path = best?.path?.length === count - 1 ? best.path : Array.from({ length: count - 1 }, (_, i) => ({ time: clock.barToTime(totalBars * (i + 1) / count), reason: 'Divisão por extensão musical; revise este limite.', merit: 0 }));
  const cuts = [{ time: 0, marker: (song.markers ?? []).find(m => Math.abs(m.time) <= EPSILON)?.text ?? '' }, ...path, { time: duration, reason: 'Fim da música.', merit: 1 }];
  const phrases = cuts.slice(0, -1).map((cut, i) => ({ id: `phrase-${i + 1}`, name: cleanText(cut.marker, `Frase ${String(i + 1).padStart(2, '0')}`, 100), start: cut.time, end: cuts[i + 1].time, confidence: clamp(0.38 + (cuts[i + 1].merit ?? 0) * 0.1, 0.2, 0.92), reason: cuts[i + 1].reason ?? 'Agrupamento por compassos; revise este limite.' }));
  const warnings = ['Sugestões por compassos, pausas, padrões e marcadores; revise os limites antes de treinar.'];
  if (!melody.tracks.length) warnings.push('Não foi encontrada uma pista melódica; os limites usam o mapa de compassos e marcadores.');
  const physicalNotes = notes.filter(n => finite(n.time) && finite(n.duration)).map(n => ({ time: n.time, end: n.time + (finite(n.keyDuration) ? n.keyDuration : n.duration) })).sort((a, b) => a.time - b.time);
  let noteIndex = 0, heldUntil = -Infinity;
  const crossing = [];
  for (const [i, cut] of cuts.slice(1, -1).entries()) {
    while (noteIndex < physicalNotes.length && physicalNotes[noteIndex].time < cut.time - EPSILON) heldUntil = Math.max(heldUntil, physicalNotes[noteIndex++].end);
    if (heldUntil > cut.time + EPSILON) {
      crossing.push(cut);
      phrases[i].reason += ' Há notas ainda pressionadas neste limite.';
      phrases[i].confidence = Math.min(phrases[i].confidence, 0.55);
    }
  }
  if (crossing.length) warnings.push(`${crossing.length} limite(s) atravessam uma nota ainda pressionada. Revise-os ou inclua uma preparação antes de praticar.`);
  if (requestedCount && phrases.length !== requestedCount) warnings.push(`A duração permite ${phrases.length} frase(s) com limites distintos, em vez de ${requestedCount}.`);
  return { phrases, warnings, analysis: { melodyTracks: melody.tracks, totalBars, targetBars, requestedCount, actualCount: phrases.length } };
}
