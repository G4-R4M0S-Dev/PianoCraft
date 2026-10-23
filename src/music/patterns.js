/** Local, revisable melodic-structure analysis. All public times are seconds.
 * A pattern is evidence from pitches AND musical rhythm, never a claim about
 * a composer's intentions or an automatically inferred harmonic section. */
const VERSION = 2;
const METHOD = 'melodic-structure-v1';
const EPS = 1e-6;
const MAX_ATTACKS = 24000;
const MAX_PHRASES = 512;
const MAX_MATCHES = 2200;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const finite = n => typeof n === 'number' && Number.isFinite(n);
const text = (value, fallback = '', max = 500) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
const rounded = n => Math.round(n * 1e6) / 1e6;
function median(values) { if (!values.length) return 0; const ordered = [...values].sort((a, b) => a - b); return ordered[Math.floor(ordered.length / 2)]; }
function upper(array, value, key = n => n) { let lo = 0, hi = array.length; while (lo < hi) { const mid = (lo + hi) >>> 1; if (key(array[mid]) <= value) lo = mid + 1; else hi = mid; } return lo; }
function hash(value) {
  // Two independent 32-bit accumulators: deterministic in browsers and Node.
  let a = 2166136261, b = 2246822519;
  for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 3266489917); }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
function fingerprintSong(song, duration, tracks) {
  let a = 2166136261, b = 2246822519;
  const update = value => { for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 3266489917); } };
  update(`${METHOD}|${duration}|${song.tempo}|${JSON.stringify(song.tempos ?? [])}|${JSON.stringify(song.timeSignatures ?? [])}|${tracks.join(',')}|`);
  for (const n of song.notes ?? []) update(`${n.midi},${rounded(n.time)},${rounded(n.duration)},${rounded(n.keyDuration ?? n.duration)},${n.track ?? 0},${n.channel ?? 0};`);
  return `structure-${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

/** MIDI identity and editorial identity are separate: changing a family label
 * or a cut invalidates its study plan without pretending the MIDI changed. */
export function patternRevisionKey(input) {
  return `revision-${hash(JSON.stringify([input.contentKey, input.method, input.melodyTracks, (input.phrases ?? []).map(p => [p.id, rounded(p.start), rounded(p.end), p.patternId, p.patternLabel, p.referencePhraseId, p.variant]), (input.patterns ?? []).map(p => [p.id, p.label, p.representativePhraseId])]))}`;
}

/** Tempo-map integration preserves quarter-note distances across accelerandi,
 * and the denominator matters: a 6/8 measure contains three quarter beats. */
export function createPatternClock(song, duration = song?.duration ?? 0) {
  const entries = (song?.tempos ?? []).filter(t => finite(t.time) && t.time >= 0 && finite(t.bpm) && t.bpm > 0).map(t => ({ time: t.time, bpm: t.bpm })).sort((a, b) => a.time - b.time);
  if (!entries.length || entries[0].time > 0) entries.unshift({ time: 0, bpm: finite(song?.tempo) && song.tempo > 0 ? song.tempo : 120 });
  const tempos = [];
  for (const entry of entries) { if (tempos.at(-1)?.time === entry.time) tempos[tempos.length - 1] = entry; else tempos.push(entry); }
  tempos[0].beat = 0;
  for (let i = 1; i < tempos.length; i++) tempos[i].beat = tempos[i - 1].beat + (tempos[i].time - tempos[i - 1].time) * tempos[i - 1].bpm / 60;
  const toBeat = time => { const s = tempos[Math.max(0, upper(tempos, time, t => t.time) - 1)]; return s.beat + (time - s.time) * s.bpm / 60; };
  const toTime = beat => { const s = tempos[Math.max(0, upper(tempos, beat, t => t.beat) - 1)]; return s.time + (beat - s.beat) * 60 / s.bpm; };
  const signatures = (song?.timeSignatures ?? []).filter(s => finite(s.time) && s.time >= 0 && s.time < duration && finite(s.numerator) && s.numerator > 0 && finite(s.denominator) && s.denominator > 0).sort((a, b) => a.time - b.time);
  if (!signatures.length || signatures[0].time > 0) signatures.unshift({ time: 0, numerator: 4, denominator: 4 });
  const sections = [];
  for (let i = 0; i < signatures.length; i++) {
    const s = signatures[i], beat = toBeat(s.time), endBeat = toBeat(Math.min(duration, signatures[i + 1]?.time ?? duration));
    if (endBeat <= beat) continue;
    const prior = sections.at(-1), bar = prior ? prior.bar + (beat - prior.beat) / prior.beatsPerBar : 0;
    sections.push({ time: s.time, beat, endBeat, beatsPerBar: s.numerator * 4 / s.denominator, bar, numerator: s.numerator, denominator: s.denominator });
  }
  // A repeated time-signature meta event is not a musical section change.
  for (let i = sections.length - 1; i > 0; i--) if (sections[i].numerator === sections[i - 1].numerator && sections[i].denominator === sections[i - 1].denominator) {
    sections[i - 1].endBeat = sections[i].endBeat; sections.splice(i, 1);
  }
  if (!sections.length) sections.push({ time: 0, beat: 0, endBeat: toBeat(duration), beatsPerBar: 4, bar: 0, numerator: 4, denominator: 4 });
  const sectionAt = beat => sections[Math.max(0, upper(sections, beat, s => s.beat) - 1)];
  const toBar = time => { const beat = toBeat(time), s = sectionAt(beat); return s.bar + (beat - s.beat) / s.beatsPerBar; };
  return { toBeat, toTime, toBar, sectionAt, sections, totalBars: toBar(duration) };
}

function extractMelody(song, requestedTracks, clock) {
  const byTrack = new Map();
  for (const n of song.notes ?? []) {
    if (!finite(n.time) || !finite(n.midi) || !finite(n.duration) || n.time < 0 || n.duration < 0 || n.midi < 0 || n.midi > 127 || n.channel === 9) continue;
    const id = Number.isInteger(n.track) ? n.track : 0;
    if (!byTrack.has(id)) byTrack.set(id, []);
    byTrack.get(id).push(n);
  }
  let tracks = Array.isArray(requestedTracks) ? [...new Set(requestedTracks.filter(id => byTrack.has(id)))] : [];
  const selected = tracks.length > 0;
  if (!selected && byTrack.size) {
    const maximumNotes = Math.max(...[...byTrack.values()].map(notes => notes.length));
    const minimumActiveNotes = Math.min(12, Math.max(4, maximumNotes * 0.04));
    let best = -Infinity, winner;
    for (const [id, notes] of byTrack) {
      if (byTrack.size > 1 && maximumNotes >= 12 && notes.length < minimumActiveNotes) continue;
      const attacks = new Set(notes.map(n => Math.round(n.time * 100))).size;
      const mean = notes.reduce((sum, n) => sum + n.midi, 0) / notes.length;
      const coverage = Math.min(1, notes.length / 16), mono = attacks / notes.length;
      const score = mean + mono * 14 + Math.log2(notes.length + 1) * 2 + coverage * 12;
      if (score > best) { best = score; winner = id; }
    }
    tracks = [winner];
  }
  const notes = tracks.flatMap(id => byTrack.get(id) ?? []).sort((a, b) => a.time - b.time || b.midi - a.midi);
  const skyline = [];
  for (const n of notes) {
    const previous = skyline.at(-1);
    if (previous && Math.abs(n.time - previous.time) <= 0.012) { if (n.midi > previous.midi) skyline[skyline.length - 1] = n; }
    else skyline.push(n);
  }
  const totalAttacks = skyline.length;
  const attacks = skyline.slice(0, MAX_ATTACKS).map(n => ({ time: n.time, beat: clock.toBeat(n.time), endBeat: clock.toBeat(n.time + (finite(n.keyDuration) ? n.keyDuration : n.duration)), pitch: n.midi }));
  return { attacks, tracks, selected, totalAttacks, trackCount: byTrack.size, polyphonic: notes.length > skyline.length * 1.12 };
}

function naturalBoundaries(attacks, clock, song, duration) {
  const ends = attacks.map(n => n.endBeat), ioi = attacks.slice(1).map((n, i) => n.beat - attacks[i].beat).filter(n => n > EPS);
  const usualIOI = median(ioi), restThreshold = Math.max(0.55, usualIOI * 1.15);
  const anchors = new Map();
  const add = (index, score, reason, extra = {}) => {
    if (index < 0 || index > attacks.length) return;
    const old = anchors.get(index);
    if (!old || old.score < score) anchors.set(index, { index, time: index === attacks.length ? duration : attacks[index].time, beat: index === attacks.length ? clock.toBeat(duration) : attacks[index].beat, score, reason, ...extra });
  };
  add(0, 9, 'Início da música.', { strong: true });
  add(attacks.length, 9, 'Fim da música.', { strong: true });
  for (let i = 1; i < attacks.length; i++) {
    const n = attacks[i], prior = attacks[i - 1], rest = n.beat - ends[i - 1];
    if (rest >= restThreshold) add(i, 1.7 + Math.min(3.5, rest / 2), `Pausa de ${Math.round(rest * 10) / 10} pulsos na melodia; novo ataque após a pausa.`, { strong: true, rest });
    const s = clock.sectionAt(n.beat), phase = (n.beat - s.beat) % s.beatsPerBar;
    if (phase <= 0.13 || s.beatsPerBar - phase <= 0.13) {
      const cadence = prior.endBeat - prior.beat >= Math.max(1, usualIOI * 1.7) && prior.endBeat <= n.beat + 0.13;
      add(i, cadence ? 1.8 : 0.3, cadence ? 'Nota longa concluída junto de um início de compasso.' : 'Início de compasso; limite de apoio, com pouca evidência melódica.', { strong: false, bar: true });
    }
  }
  for (const marker of song.markers ?? []) {
    if (!finite(marker.time) || marker.time <= EPS || marker.time >= duration - EPS) continue;
    let index = Math.max(1, upper(attacks, marker.time - EPS, n => n.time));
    if (index < attacks.length && Math.abs(attacks[index].time - marker.time) < 2) add(index, 8, `Marcador MIDI: ${text(marker.text, 'seção', 120)}.`, { strong: true, marker: text(marker.text, '', 100) });
  }
  for (const s of clock.sections.slice(1)) {
    const index = upper(attacks, s.time - EPS, n => n.time);
    if (index > 0 && index < attacks.length) add(index, 7, 'Mudança de compasso.', { strong: true });
  }
  return { anchors, usualIOI, restThreshold, add };
}

function seedKey(attacks, index, size = 6) {
  const first = attacks[index], pieces = [];
  for (let k = 0; k < size; k++) {
    const n = attacks[index + k];
    if (!n) return null;
    pieces.push(`${n.pitch - first.pitch}:${Math.round((n.beat - first.beat) * 12)}`);
  }
  const distinct = new Set(attacks.slice(index, index + size).map(n => n.pitch));
  // A single repeated pitch has too little melodic information to establish a
  // family; neither repeated tonics nor equal rhythm can identify a melody.
  if (distinct.size < 3) return null;
  return pieces.join('/');
}

function discoverRecurrences(attacks, boundaries) {
  const { anchors, add } = boundaries, seeds = new Map(), matches = [];
  const minimumPhraseNotes = attacks.length > 256 ? 12 : 6;
  const minimumPhraseBeats = attacks.at(-1)?.beat > 128 ? 6 : 2;
  for (let i = 0; i + 5 < attacks.length; i++) {
    const key = seedKey(attacks, i); if (!key) continue;
    if (!seeds.has(key)) seeds.set(key, []);
    // First occurrences and a bounded sample of later ones retain useful
    // evidence without quadratic explosion on mechanical ostinatos.
    const list = seeds.get(key); if (list.length < 32) list.push(i);
  }
  let comparisons = 0;
  for (const indices of seeds.values()) {
    if (indices.length < 2) continue;
    for (let a = 0; a < Math.min(indices.length - 1, 5); a++) {
      for (let b = a + 1; b < indices.length; b++) {
        if (++comparisons > MAX_MATCHES) return addRecurrenceBoundaries(matches, comparisons, true, attacks, add);
        const i = indices[a], j = indices[b], offset = attacks[j].pitch - attacks[i].pitch;
        if (j - i < 6 || attacks[j].beat - attacks[i].beat < 2) continue;
        const previousContinues = i > 0 && j > 0 && attacks[j - 1].pitch - attacks[i - 1].pitch === offset && Math.abs((attacks[j].beat - attacks[j - 1].beat) - (attacks[i].beat - attacks[i - 1].beat)) < 0.13;
        if (previousContinues && !anchors.get(i)?.strong && !anchors.get(j)?.strong) continue;
        let len = 6, bad = 0, consecutiveBad = 0;
        const limit = Math.min(j - i, attacks.length - j, 128);
        for (; len < limit; len++) {
          const x = attacks[i + len], y = attacks[j + len];
          if (x.beat - attacks[i].beat > 64 || y.beat - attacks[j].beat > 64) break;
          const pitchBad = Math.abs((y.pitch - x.pitch) - offset) > 2;
          const rhythmBad = Math.abs((y.beat - attacks[j].beat) - (x.beat - attacks[i].beat)) > 0.16;
          if (pitchBad || rhythmBad) { bad++; consecutiveBad++; } else consecutiveBad = 0;
          if (consecutiveBad >= 3 || bad > Math.max(1, Math.floor((len + 1) * 0.16))) { len -= consecutiveBad - 1; break; }
        }
        if (len < 6) continue;
        // Prefer a shared musical endpoint near the last matched attack. This
        // avoids cutting through an upbeat because a repeated seed ended there.
        let endpoint = len;
        for (let k = len; k >= Math.max(6, len - Math.max(3, Math.floor(len * 0.18))); k--) {
          if (anchors.has(i + k) && anchors.has(j + k)) { endpoint = k; break; }
        }
        const span = attacks[i + endpoint]?.beat ?? attacks.at(-1).endBeat;
        if (endpoint < minimumPhraseNotes || span - attacks[i].beat < minimumPhraseBeats) continue;
        matches.push({ first: i, second: j, length: endpoint, transpose: offset });
      }
    }
  }
  return addRecurrenceBoundaries(matches, comparisons, false, attacks, add);
}

function addRecurrenceBoundaries(matches, comparisons, bounded, attacks, add) {
  // Repeated four-note cells inside a longer returning phrase are useful as
  // exercises, but must not fragment the entire arrangement into those cells.
  // Keep the largest explanatory spans, suppressing contained submotifs.
  const covered = [], selected = [];
  const ordered = [...matches].sort((a, b) => b.length - a.length || a.first - b.first);
  for (const match of ordered) {
    const firstContained = covered.some(c => c.start <= match.first && c.end >= match.first + match.length);
    const secondContained = covered.some(c => c.start <= match.second && c.end >= match.second + match.length);
    if (firstContained && secondContained) continue;
    const spans = [{ start: match.first, end: match.first + match.length }, { start: match.second, end: match.second + match.length }];
    // A phrase cannot simultaneously begin at two overlapping pickup notes.
    // Keep the longest returning structures coherent at ALL their occurrences,
    // instead of letting independent cut rewards misalign the same family.
    const conflicts = spans.some(span => covered.some(c => span.start < c.end && span.end > c.start && (span.start !== c.start || span.end !== c.end)));
    if (conflicts) continue;
    selected.push(match);
    covered.push({ start: match.first, end: match.first + match.length }, { start: match.second, end: match.second + match.length });
    const evidence = `Retorno de ${match.length} ataques com desenho de alturas e ritmo semelhantes${match.transpose ? `, deslocado ${match.transpose > 0 ? '+' : ''}${match.transpose} semitons` : ''}.`;
    add(match.first, 3.6, evidence, { recurrence: true }); add(match.second, 3.6, evidence, { recurrence: true });
    add(match.first + match.length, 3.6, 'Fim de um desenho melódico recorrente.', { recurrence: true });
    add(match.second + match.length, 3.6, 'Fim do retorno de um desenho melódico.', { recurrence: true });
  }
  return { matches: selected, comparisons, bounded };
}

function segment(attacks, boundaries, clock, duration) {
  if (!attacks.length) return [];
  const spans = (boundaries.matches ?? []).flatMap(m => [{ start: m.first, end: m.first + m.length }, { start: m.second, end: m.second + m.length }]);
  const repeatedSpans = new Set(spans.map(m => `${m.start}:${m.end}`));
  const required = new Set(spans.flatMap(m => [m.start, m.end]));
  let points = [...boundaries.anchors.values()].filter(p => !spans.some(s => p.index > s.start && p.index < s.end)).sort((a, b) => a.index - b.index);
  if (points.length > 2200) {
    const selected = new Set(points.filter(p => p.strong || p.recurrence).sort((a, b) => b.score - a.score).slice(0, 1800).map(p => p.index));
    const step = Math.ceil(points.length / 350);
    points.forEach((p, i) => { if (i % step === 0 || i === points.length - 1) selected.add(p.index); });
    points = points.filter(p => selected.has(p.index));
  }
  const costs = new Float64Array(points.length).fill(Infinity), previous = new Int32Array(points.length).fill(-1);
  costs[0] = 0;
  let lastRequired = 0;
  for (let i = 1; i < points.length; i++) {
    for (let j = i - 1; j >= 0 && i - j <= 180; j--) {
      if (j < lastRequired) break;
      const length = points[i].beat - points[j].beat, noteCount = points[i].index - points[j].index;
      if (length <= EPS || noteCount <= 0) continue;
      // No requested count. Evidence earns a boundary; length only supplies a
      // transparent fallback when a long passage has no convincing cadence.
      let cost = costs[j] + 4.1 - points[i].score;
      if (repeatedSpans.has(`${points[j].index}:${points[i].index}`)) cost -= 4;
      if (length < 2) cost += (2 - length) * 3;
      if (noteCount < 8) cost += (8 - noteCount) * 0.9;
      if (length > 48) cost += ((length - 48) / 16) ** 2;
      if (length > 96) cost += (length - 96) * 0.5;
      if (cost < costs[i]) { costs[i] = cost; previous[i] = j; }
      if (length > 160 && j < i - 2) break;
    }
    if (required.has(points[i].index)) lastRequired = i;
  }
  const path = [], used = new Set();
  for (let i = points.length - 1; i >= 0 && !used.has(i); i = previous[i]) { path.push(points[i]); used.add(i); if (i === 0) break; }
  if (path.at(-1)?.index !== 0) path.push(points[0]);
  path.reverse();
  const cuts = path.slice(0, MAX_PHRASES); if (cuts.at(-1)?.index !== attacks.length) cuts.push(points.at(-1));
  return cuts.slice(0, -1).map((cut, i) => ({ start: i === 0 ? 0 : cut.time, end: cuts[i + 1].index === attacks.length ? duration : cuts[i + 1].time, confidence: clamp(0.42 + Math.min(cut.score, cuts[i + 1].score) * 0.07, 0.3, 0.93), reason: cuts[i + 1].reason, name: cut.marker || `Frase ${i + 1}` }));
}

function sequenceFor(attacks, phrase) {
  const start = upper(attacks, phrase.start - EPS, n => n.time), end = upper(attacks, phrase.end - EPS, n => n.time);
  return attacks.slice(start, end);
}

function describeSequence(notes, clock, phrase) {
  const pitches = notes.map(n => n.pitch), intervals = notes.slice(1).map((n, i) => n.pitch - notes[i].pitch);
  const rhythm = notes.map((n, i) => rounded(i < notes.length - 1 ? notes[i + 1].beat - n.beat : Math.max(0, n.endBeat - n.beat)));
  const repeatedNotes = intervals.filter(n => n === 0).length, steps = intervals.filter(n => Math.abs(n) > 0 && Math.abs(n) <= 2).length, leaps = intervals.filter(n => Math.abs(n) >= 5).length;
  const up = intervals.filter(n => n > 0).length, down = intervals.filter(n => n < 0).length;
  const contour = !intervals.length ? 'nota isolada' : !up && !down ? 'notas repetidas' : up > down * 2 ? 'predominantemente ascendente' : down > up * 2 ? 'predominantemente descendente' : 'sobe e desce';
  return { noteCount: notes.length, range: pitches.length ? [Math.min(...pitches), Math.max(...pitches)] : [0, 0], firstPitch: pitches[0] ?? null, meanPitch: pitches.length ? rounded(pitches.reduce((a, b) => a + b, 0) / pitches.length) : 0, intervals: intervals.slice(0, 128), contour, rhythm: rhythm.slice(0, 128), repeatedNotes, steps, leaps, distinctPitches: new Set(pitches).size, beats: rounded(clock.toBeat(phrase.end) - clock.toBeat(phrase.start)), startBar: rounded(clock.toBar(phrase.start)), endBar: rounded(clock.toBar(phrase.end)) };
}

function rhythmAt(sequence, index) { return Math.max(1 / 48, index < sequence.length - 1 ? sequence[index + 1].beat - sequence[index].beat : sequence[index].endBeat - sequence[index].beat); }

function compareSequences(reference, candidate) {
  if (reference.length < 4 || candidate.length < 4 || Math.min(reference.length, candidate.length) / Math.max(reference.length, candidate.length) < 0.68) return null;
  if (new Set(reference.map(n => n.pitch)).size < 3 || new Set(candidate.map(n => n.pitch)).size < 3) return null;
  const sample = seq => seq.length <= 96 ? seq : Array.from({ length: 96 }, (_, i) => seq[Math.round(i * (seq.length - 1) / 95)]);
  const a = sample(reference), b = sample(candidate), offsets = new Set([b[0].pitch - a[0].pitch]);
  if (a.length === b.length) offsets.add(median(a.slice(0, 12).map((n, i) => b[i].pitch - n.pitch)));
  let best;
  for (const offset of offsets) {
    const width = b.length + 1, costs = new Float64Array((a.length + 1) * width), back = new Uint8Array(costs.length);
    for (let i = 1; i <= a.length; i++) { costs[i * width] = i * 0.82; back[i * width] = 1; }
    for (let j = 1; j <= b.length; j++) { costs[j] = j * 0.82; back[j] = 2; }
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      const pitchDistance = Math.abs((b[j - 1].pitch - a[i - 1].pitch) - offset);
      const pitchCost = Math.min(1.5, pitchDistance / 3);
      const ratio = rhythmAt(b, j - 1) / rhythmAt(a, i - 1), rhythmCost = Math.min(1.5, Math.abs(Math.log2(ratio)));
      const same = costs[(i - 1) * width + j - 1] + pitchCost * 0.8 + rhythmCost * 0.45;
      const remove = costs[(i - 1) * width + j] + 0.82, add = costs[i * width + j - 1] + 0.82;
      const index = i * width + j;
      if (same <= remove && same <= add) { costs[index] = same; back[index] = 0; }
      else if (remove <= add) { costs[index] = remove; back[index] = 1; }
      else { costs[index] = add; back[index] = 2; }
    }
    let i = a.length, j = b.length, exactPitch = 0, closePitch = 0, pitchChanges = 0, rhythmChanges = 0, addedNotes = 0, removedNotes = 0, aligned = 0;
    while (i || j) {
      const direction = back[i * width + j];
      if (direction === 1 || !j) { removedNotes++; i--; }
      else if (direction === 2 || !i) { addedNotes++; j--; }
      else {
        const distance = Math.abs((b[j - 1].pitch - a[i - 1].pitch) - offset);
        if (distance === 0) exactPitch++; else pitchChanges++;
        if (distance <= 2) closePitch++;
        if (Math.abs(Math.log2(rhythmAt(b, j - 1) / rhythmAt(a, i - 1))) > 0.19) rhythmChanges++;
        aligned++; i--; j--;
      }
    }
    const similarity = clamp(1 - costs[a.length * width + b.length] / Math.max(a.length, b.length), 0, 1);
    if (similarity < 0.79 || aligned < 4 || exactPitch / aligned < 0.58 || closePitch / aligned < 0.78 || (addedNotes + removedNotes) / Math.max(a.length, b.length) > 0.24) continue;
    const comparison = { pitchChanges, rhythmChanges, addedNotes, removedNotes, registerShift: offset };
    const variant = pitchChanges === 0 && rhythmChanges === 0 && addedNotes === 0 && removedNotes === 0 && reference.length === candidate.length ? offset === 0 ? 'exact' : 'transposed' : 'variation';
    const differences = [];
    if (offset) differences.push(`registro deslocado ${offset > 0 ? '+' : ''}${offset} semitons`);
    if (pitchChanges) differences.push(`${pitchChanges} altura(s) alterada(s)`);
    if (rhythmChanges) differences.push(`${rhythmChanges} duração(ões)/intervalo(s) rítmico(s) diferente(s)`);
    if (addedNotes) differences.push(`${addedNotes} ataque(s) acrescentado(s)`);
    if (removedNotes) differences.push(`${removedNotes} ataque(s) omitido(s)`);
    comparison.summary = differences.length ? differences.join('; ') + '.' : 'Mesma sequência de alturas e ritmo musical.';
    if (!best || similarity > best.similarity) best = { similarity: rounded(similarity), transpose: offset, variant, comparison };
  }
  return best ?? null;
}

function familyLabel(index) { let n = index + 1, label = ''; while (n > 0) { n--; label = String.fromCharCode(65 + n % 26) + label; n = Math.floor(n / 26); } return label; }

function classify(phrases, attacks, clock, contentKey) {
  const sequences = phrases.map(p => sequenceFor(attacks, p)), patterns = [], comparisons = { count: 0, bounded: false };
  for (let i = 0; i < phrases.length; i++) {
    const phrase = phrases[i], notes = sequences[i];
    phrase.features = describeSequence(notes, clock, phrase);
    phrase.id = text(phrase.id, `phrase-${hash(`${contentKey}:${rounded(phrase.start)}:${rounded(phrase.end)}`)}`, 80);
    let winning = null;
    for (const pattern of patterns) {
      if (++comparisons.count > 30000) { comparisons.bounded = true; break; }
      const result = compareSequences(sequences[pattern._index], notes);
      if (result && (!winning || result.similarity > winning.result.similarity)) winning = { pattern, result };
    }
    if (winning) {
      const { pattern, result } = winning;
      Object.assign(phrase, result, { patternId: pattern.id, referencePhraseId: pattern.representativePhraseId });
      const isVariant = result.variant === 'variation' || result.variant === 'transposed';
      const signature = `${result.variant}:${result.transpose}:${result.comparison.pitchChanges}:${result.comparison.rhythmChanges}:${result.comparison.addedNotes}:${result.comparison.removedNotes}`;
      if (isVariant && !pattern._variants.includes(signature)) pattern._variants.push(signature);
      phrase.patternLabel = pattern.label + (isVariant ? '′'.repeat(Math.min(3, pattern._variants.indexOf(signature) + 1)) : '');
      pattern.occurrences.push(phrase.id); pattern.confidence = Math.min(pattern.confidence, result.similarity);
    } else {
      const signature = notes.map((n, k) => `${n.pitch - (notes[0]?.pitch ?? 0)}:${Math.round((n.beat - (notes[0]?.beat ?? 0)) * 12)}`).join('/');
      let id = `pattern-${hash(signature || phrase.id)}`;
      if (patterns.some(p => p.id === id)) id += `-${i}`;
      const pattern = { id, label: familyLabel(patterns.length), representativePhraseId: phrase.id, occurrences: [phrase.id], confidence: 1, features: phrase.features, _index: i, _variants: [] };
      patterns.push(pattern);
      Object.assign(phrase, { patternId: id, patternLabel: pattern.label, variant: 'original', referencePhraseId: phrase.id, similarity: 1, transpose: 0, comparison: { pitchChanges: 0, rhythmChanges: 0, addedNotes: 0, removedNotes: 0, registerShift: 0, summary: 'Primeira apresentação deste desenho melódico.' } });
    }
    phrase.name = /^Frase\s+\d+$/.test(phrase.name ?? '') ? `${phrase.patternLabel} · Frase ${i + 1}` : phrase.name;
  }
  for (const pattern of patterns) {
    const count = pattern.occurrences.length;
    const { noteCount, contour, leaps, repeatedNotes } = pattern.features;
    pattern.description = `${noteCount} ataques; ${contour}${leaps ? `; ${leaps} salto(s) de pelo menos cinco semitons` : ''}${repeatedNotes ? `; ${repeatedNotes} repetição(ões) de nota` : ''}. ${count > 1 ? `Aparece em ${count} trechos; compare os retornos com a primeira ocorrência.` : 'Sem retorno suficientemente semelhante nesta análise.'}`;
    if (count === 1) { const phrase = phrases[pattern._index]; phrase.variant = 'unique'; phrase.comparison.summary = 'Trecho sem repetição melódica confirmada nesta análise.'; }
    delete pattern._index; delete pattern._variants;
  }
  return { patterns, comparisons };
}

/** Analyze variable-length phrases, then find exact returns, transpositions,
 * ornamentation and small changes. Passing phrases preserves reviewed cuts. */
export function analyzePatterns(song, options = {}) {
  const duration = finite(song?.duration) && song.duration > 0 ? song.duration : (song?.notes ?? []).reduce((end, n) => finite(n?.time) && finite(n?.duration) && n.time >= 0 && n.duration >= 0 ? Math.max(end, n.time + n.duration) : end, 0);
  const clock = createPatternClock(song ?? {}, Math.max(0, duration));
  const melody = extractMelody(song ?? {}, options.tracks, clock), warnings = [];
  const contentKey = fingerprintSong(song ?? {}, duration, melody.tracks);
  if (!duration || !melody.attacks.length) return { version: VERSION, method: METHOD, contentKey, reviewed: false, phrases: [], patterns: [], form: [], melodyTracks: melody.tracks, warnings: ['Não foi encontrada uma linha melódica analisável. Escolha uma pista com notas; percussão não forma uma melodia.'], analysis: { melodySource: melody.selected ? 'selected' : 'automatic', totalBars: clock.totalBars, actualCount: 0, analyzedNotes: 0, totalNotes: melody.totalAttacks } };
  const boundaries = naturalBoundaries(melody.attacks, clock, song, duration), recurrence = discoverRecurrences(melody.attacks, boundaries);
  boundaries.matches = recurrence.matches;
  let phrases;
  if (Array.isArray(options.phrases) && options.phrases.length) {
    phrases = options.phrases.slice(0, MAX_PHRASES).filter(p => finite(p?.start) && finite(p?.end) && p.start >= 0 && p.start < duration && p.end > p.start).map((p, i) => ({ id: text(p.id, '', 80), name: text(p.name, `Frase ${i + 1}`, 100), start: p.start, end: Math.min(duration, p.end), confidence: finite(p.confidence) ? clamp(p.confidence, 0, 1) : 0.7, reason: text(p.reason, 'Limite revisado manualmente.') })).sort((a, b) => a.start - b.start);
    phrases = phrases.filter((p, i) => !i || p.start - phrases[i - 1].start > EPS);
    if (phrases.length) { phrases[0].start = 0; for (let i = 0; i < phrases.length; i++) phrases[i].end = phrases[i + 1]?.start ?? duration; }
  }
  if (!phrases?.length) phrases = segment(melody.attacks, boundaries, clock, duration);
  const { patterns, comparisons } = classify(phrases, melody.attacks, clock, contentKey);
  const physicalNotes = (song.notes ?? []).filter(n => finite(n.time) && finite(n.duration) && n.time >= 0 && n.duration >= 0).map(n => ({ time: n.time, end: n.time + (finite(n.keyDuration) ? n.keyDuration : n.duration) })).sort((a, b) => a.time - b.time);
  let pointer = 0, heldUntil = -Infinity, crossing = 0;
  for (const p of phrases.slice(0, -1)) {
    while (pointer < physicalNotes.length && physicalNotes[pointer].time < p.end - EPS) heldUntil = Math.max(heldUntil, physicalNotes[pointer++].end);
    if (heldUntil > p.end + EPS) { p.crossingNotes = true; p.confidence = Math.min(p.confidence, 0.6); p.reason += ' Há notas ainda pressionadas neste limite.'; crossing++; }
  }
  const repeated = patterns.filter(p => p.occurrences.length > 1);
  warnings.push('Análise local de alturas, intervalos, ritmo, pausas e retornos. Os grupos e limites são sugestões para revisão; não identificam seções harmônicas ou intenções do compositor.');
  if (!melody.selected && melody.trackCount > 1) warnings.push(`Melodia inferida na pista ${melody.tracks.map(id => id + 1).join(', ')}. Se a linha escolhida for acompanhamento, selecione a pista correta e analise novamente.`);
  if (melody.polyphonic) warnings.push('A pista contém acordes: foi usada a nota mais aguda de cada ataque. Uma voz interna ou melodia sustentada pode exigir outra pista ou revisão manual.');
  if (!repeated.length) warnings.push('Não foi confirmada uma família melódica recorrente. Trechos únicos continuam disponíveis para estudo; ritmo igual sozinho não comprova repetição.');
  if (phrases.some(p => p.reason.includes('pouca evidência'))) warnings.push('Alguns limites usam início de compasso como apoio por falta de uma pausa ou retorno claro. Revise especialmente esses limites.');
  if (crossing) warnings.push(`${crossing} limite(s) atravessam notas ainda pressionadas. Revise-os ou use uma preparação ao começar nesses pontos; a cauda de pedal não é contada como tecla pressionada.`);
  if (melody.totalAttacks > MAX_ATTACKS) warnings.push(`Limite de análise: os primeiros ${MAX_ATTACKS} ataques foram comparados; a parte restante precisa de revisão. O MIDI original permanece completo.`);
  if (recurrence.bounded || comparisons.bounded) warnings.push('A quantidade de comparações foi limitada para manter a resposta rápida. Podem existir outros retornos que não foram agrupados.');
  const analysis = { melodySource: melody.selected ? 'selected' : 'automatic', totalBars: rounded(clock.totalBars), actualCount: phrases.length, analyzedNotes: melody.attacks.length, totalNotes: melody.totalAttacks, recurringPatterns: repeated.length, recurrenceCandidates: recurrence.matches.length, reviewedBoundaries: !!options.phrases?.length };
  if (options.debug) analysis.recurrenceSpans = recurrence.matches.map(m => ({ first: melody.attacks[m.first]?.time ?? duration, firstEnd: melody.attacks[m.first + m.length]?.time ?? duration, second: melody.attacks[m.second]?.time ?? duration, secondEnd: melody.attacks[m.second + m.length]?.time ?? duration, notes: m.length, transpose: m.transpose }));
  const result = { version: VERSION, method: METHOD, contentKey, reviewed: false, phrases, patterns, form: phrases.map(p => ({ phraseId: p.id, patternId: p.patternId, label: p.patternLabel, start: p.start, end: p.end })), melodyTracks: melody.tracks, warnings, analysis };
  return { ...result, revisionKey: patternRevisionKey(result) };
}

const safeNumber = (value, fallback = 0, low = -1e9, high = 1e9) => finite(value) ? clamp(value, low, high) : fallback;
function safeFeatures(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result = {};
  for (const key of ['noteCount', 'repeatedNotes', 'steps', 'leaps', 'distinctPitches', 'beats', 'startBar', 'endBar']) if (finite(input[key])) result[key] = safeNumber(input[key], 0, 0);
  for (const key of ['firstPitch', 'meanPitch']) if (finite(input[key])) result[key] = safeNumber(input[key], 0, 0, 127);
  if (Array.isArray(input.range)) result.range = input.range.slice(0, 2).filter(finite).map(n => clamp(n, 0, 127));
  for (const key of ['intervals', 'rhythm']) if (Array.isArray(input[key])) result[key] = input[key].slice(0, 128).filter(finite).map(n => safeNumber(n, 0, key === 'rhythm' ? 0 : -127, key === 'rhythm' ? 1e9 : 127));
  result.contour = text(input.contour, '', 100);
  return result;
}
function safeComparison(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { summary: '' };
  const result = { summary: text(input.summary, '', 600) };
  for (const key of ['pitchChanges', 'rhythmChanges', 'addedNotes', 'removedNotes']) result[key] = safeNumber(input[key], 0, 0, 1000000);
  result.registerShift = safeNumber(input.registerShift, 0, -127, 127);
  return result;
}

/** The only v2 structure metadata accepted from projects/backups. This never
 * trusts occurrence arrays or form references: both are rebuilt from phrases. */
export function normalizePatternAnalysis(input, duration) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !finite(duration) || duration <= 0 || !Array.isArray(input.phrases)) return null;
  let phrases = input.phrases.slice(0, MAX_PHRASES).filter(p => p && finite(p.start) && finite(p.end) && p.start >= 0 && p.start < duration && p.end > p.start).map((p, i) => ({ id: text(p.id, `phrase-${i + 1}`, 80), name: text(p.name, `Frase ${i + 1}`, 100), start: clamp(p.start, 0, duration), end: clamp(p.end, 0, duration), confidence: safeNumber(p.confidence, 0.5, 0, 1), reason: text(p.reason, 'Limite revisado manualmente.', 600), patternId: text(p.patternId, `pattern-manual-${i + 1}`, 80), patternLabel: text(p.patternLabel, '', 30), variant: ['original', 'exact', 'transposed', 'variation', 'unique'].includes(p.variant) ? p.variant : 'unique', referencePhraseId: text(p.referencePhraseId, '', 80), similarity: safeNumber(p.similarity, 0, 0, 1), transpose: safeNumber(p.transpose, 0, -127, 127), features: safeFeatures(p.features), comparison: safeComparison(p.comparison), ...(p.manualReview === true ? { manualReview: true } : {}), ...(p.crossingNotes === true ? { crossingNotes: true } : {}) })).sort((a, b) => a.start - b.start);
  const ids = new Set();
  phrases = phrases.filter((p, i) => !i || p.start - phrases[i - 1].start > EPS);
  for (const p of phrases) { const base = p.id; let suffix = 2; while (ids.has(p.id)) p.id = `${base.slice(0, 70)}-${suffix++}`; ids.add(p.id); }
  if (!phrases.length) return null;
  phrases[0].start = 0;
  for (let i = 0; i < phrases.length; i++) phrases[i].end = phrases[i + 1]?.start ?? duration;
  const metadata = new Map();
  for (const p of (Array.isArray(input.patterns) ? input.patterns : []).slice(0, MAX_PHRASES)) if (p && typeof p === 'object' && text(p.id)) metadata.set(text(p.id, '', 80), p);
  const groups = new Map();
  for (const p of phrases) { if (!groups.has(p.patternId)) groups.set(p.patternId, []); groups.get(p.patternId).push(p); }
  const patterns = [];
  for (const [id, members] of groups) {
    const saved = metadata.get(id) ?? {}, label = text(saved.label, familyLabel(patterns.length), 24);
    const representativePhraseId = members.some(p => p.id === saved.representativePhraseId) ? saved.representativePhraseId : members[0].id;
    const pattern = { id, label, representativePhraseId, occurrences: members.map(p => p.id), confidence: safeNumber(saved.confidence, 0.5, 0, 1), description: text(saved.description, 'Grupo revisável de desenhos melódicos.', 1000), features: safeFeatures(saved.features), ...(saved.manualReview === true ? { manualReview: true } : {}) };
    patterns.push(pattern);
    for (const p of members) { if (!p.patternLabel) p.patternLabel = label; if (!members.some(m => m.id === p.referencePhraseId)) p.referencePhraseId = representativePhraseId; }
  }
  const analysis = {};
  if (input.analysis && typeof input.analysis === 'object') {
    analysis.melodySource = input.analysis.melodySource === 'selected' ? 'selected' : 'automatic';
    for (const key of ['totalBars', 'actualCount', 'analyzedNotes', 'totalNotes', 'recurringPatterns', 'recurrenceCandidates']) if (finite(input.analysis[key])) analysis[key] = safeNumber(input.analysis[key], 0, 0, 100000000);
    analysis.reviewedBoundaries = input.analysis.reviewedBoundaries === true;
  }
  analysis.actualCount = phrases.length;
  analysis.recurringPatterns = patterns.filter(p => p.occurrences.length > 1).length;
  const result = { version: VERSION, method: text(input.method, METHOD, 80), contentKey: text(input.contentKey, `structure-${hash(JSON.stringify(phrases.map(p => [p.id, p.start, p.end, p.patternId])))}`, 100), reviewed: input.reviewed === true, phrases, patterns, form: phrases.map(p => ({ phraseId: p.id, patternId: p.patternId, label: p.patternLabel, start: p.start, end: p.end })), melodyTracks: [...new Set((Array.isArray(input.melodyTracks) ? input.melodyTracks : []).filter(n => Number.isInteger(n) && n >= 0 && n <= 65534))].slice(0, 256), warnings: (Array.isArray(input.warnings) ? input.warnings : []).filter(n => typeof n === 'string').slice(0, 24).map(n => n.slice(0, 1000)), analysis };
  return { ...result, revisionKey: patternRevisionKey(result) };
}
