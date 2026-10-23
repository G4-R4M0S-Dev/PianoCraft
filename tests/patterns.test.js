import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePatterns, createPatternClock, normalizePatternAnalysis, patternRevisionKey } from '../src/music/patterns.js';

const A = [60, 62, 64, 67, 65, 64, 62, 60];
const B = [67, 67, 69, 72, 71, 69, 67, 66, 69, 67];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

function fixture(parts, { numerator = 4, denominator = 4, tempo = 120, changes = [], gap = 1, pickup = 0, accompaniment = false } = {}) {
  const tempos = [{ beat: 0, bpm: tempo }, ...changes].sort((a, b) => a.beat - b.beat);
  tempos[0].time = 0;
  for (let i = 1; i < tempos.length; i++) tempos[i].time = tempos[i - 1].time + (tempos[i].beat - tempos[i - 1].beat) * 60 / tempos[i - 1].bpm;
  const seconds = beat => { const t = tempos.findLast(t => t.beat <= beat); return t.time + (beat - t.beat) * 60 / t.bpm; };
  let beat = pickup;
  const notes = [], phrases = [];
  for (const [i, part] of parts.entries()) {
    const start = beat, pitches = Array.isArray(part) ? part : part.pitches, rhythm = part.rhythm;
    for (let k = 0; k < pitches.length; k++) {
      const length = rhythm?.[k] ?? 0.5, duration = seconds(beat + length * 0.88) - seconds(beat);
      notes.push({ id: `n-${notes.length}`, time: seconds(beat), duration, keyDuration: duration, midi: pitches[k], track: 1, channel: 0 });
      beat += length;
    }
    beat += gap;
    phrases.push({ id: `review-${i}`, name: `Frase ${i + 1}`, start: i ? seconds(start) : 0, end: seconds(beat) });
  }
  if (accompaniment) notes.push({ time: 0, duration: seconds(beat), keyDuration: seconds(beat), midi: 36, track: 0, channel: 1 });
  return { song: { id: 'fixture', duration: seconds(beat), tempo, tempos: tempos.map(({ time, bpm }) => ({ time, bpm })), timeSignatures: [{ time: 0, numerator, denominator }], notes }, phrases };
}

function partition(result, duration) {
  assert.ok(result.phrases.length);
  near(result.phrases[0].start, 0); near(result.phrases.at(-1).end, duration);
  assert.equal(new Set(result.phrases.map(p => p.id)).size, result.phrases.length);
  for (let i = 0; i < result.phrases.length; i++) {
    const p = result.phrases[i];
    assert.ok(p.end > p.start); assert.ok(p.confidence >= 0 && p.confidence <= 1);
    if (i) near(p.start, result.phrases[i - 1].end);
    const family = result.patterns.find(f => f.id === p.patternId);
    assert.ok(family?.occurrences.includes(p.id));
    assert.ok(family.occurrences.includes(p.referencePhraseId));
  }
}

test('automatic structure discovers unequal A/B lengths, register returns and a changed ending', () => {
  const { song, phrases } = fixture([A, B, A.map(n => n + 12), B.map((n, i) => i === 9 ? n + 2 : n)]);
  const before = JSON.stringify(song), result = analyzePatterns(song);
  partition(result, song.duration);
  assert.equal(result.phrases.length, 4);
  assert.equal(result.patterns.length, 2);
  assert.deepEqual(result.phrases.map(p => [p.start, p.end]), phrases.map(p => [p.start, p.end]));
  assert.equal(result.phrases[2].patternId, result.phrases[0].patternId);
  assert.equal(result.phrases[2].variant, 'transposed'); assert.equal(result.phrases[2].transpose, 12);
  assert.equal(result.phrases[3].patternId, result.phrases[1].patternId);
  assert.equal(result.phrases[3].variant, 'variation'); assert.equal(result.phrases[3].comparison.pitchChanges, 1);
  assert.match(result.phrases[3].comparison.summary, /altura/);
  assert.notEqual(result.phrases[0].end - result.phrases[0].start, result.phrases[1].end - result.phrases[1].start);
  assert.equal(JSON.stringify(song), before, 'analysis never modifies the MIDI');
});

test('each arrangement determines its own phrase count, never eleven or a fixed number of bars', () => {
  const short = fixture([A, A]);
  const longer = fixture([A, B, A.map(n => n + 7), B, A]);
  const one = analyzePatterns(short.song), two = analyzePatterns(longer.song);
  partition(one, short.song.duration); partition(two, longer.song.duration);
  assert.equal(one.phrases.length, 2); assert.equal(two.phrases.length, 5);
  assert.equal(two.analysis.requestedCount, undefined);
  longer.song.phrasing = { targetCount: 11, phrases: [{ start: 0, end: longer.song.duration, name: 'Antigo' }] };
  assert.deepEqual(analyzePatterns(longer.song).phrases, two.phrases, 'old equal-count metadata never drives a new analysis');
});

test('a repeated rhythm with unrelated pitches does not become a melodic family', () => {
  const unrelated = [72, 60, 76, 63, 79, 61, 74, 66];
  const { song, phrases } = fixture([A, unrelated]);
  const result = analyzePatterns(song, { phrases });
  assert.equal(result.patterns.length, 2);
  assert.ok(result.phrases.every(p => p.variant === 'unique'));
  assert.ok(result.warnings.some(w => w.includes('Não foi confirmada')));
});

test('same-pitch ostinatos and isolated notes are not claimed as recognized melodies', () => {
  const { song, phrases } = fixture([Array(8).fill(60), Array(8).fill(72), [60], [60]]);
  const result = analyzePatterns(song, { phrases });
  assert.equal(result.patterns.length, 4);
  assert.ok(result.phrases.every(p => p.variant === 'unique'));
  assert.equal(result.phrases[0].features.contour, 'notas repetidas');
});

test('tempo changes preserve pattern rhythm in beats rather than elapsed seconds', () => {
  const { song, phrases } = fixture([A, A], { changes: [{ beat: 5, bpm: 60 }] });
  const result = analyzePatterns(song);
  partition(result, song.duration);
  assert.equal(result.patterns.length, 1); assert.equal(result.phrases[1].variant, 'exact');
  assert.notEqual(phrases[0].end - phrases[0].start, phrases[1].end - phrases[1].start);
  assert.deepEqual(result.phrases[0].features.rhythm, result.phrases[1].features.rhythm);
});

test('3/4, 6/8, changed meter and repeated meter events have correct musical distances', () => {
  for (const [numerator, denominator] of [[3, 4], [6, 8]]) {
    const { song } = fixture([A, A], { numerator, denominator });
    const clock = createPatternClock(song);
    near(clock.totalBars, 10 / 3);
    const result = analyzePatterns(song);
    assert.equal(result.patterns.length, 1); partition(result, song.duration);
  }
  const { song } = fixture([A, B, A]);
  song.timeSignatures.push({ time: 2.5, numerator: 4, denominator: 4 });
  assert.equal(createPatternClock(song).sections.length, 1, 'duplicate MIDI signature is not a section boundary');
  song.timeSignatures.push({ time: 5, numerator: 3, denominator: 4 });
  const clock = createPatternClock(song);
  assert.equal(clock.sections.length, 2); near(clock.toBar(5), 2.5);
});

test('offbeat pickups remain with their next phrase, without snapping its first note away', () => {
  const { song, phrases } = fixture([A, A.map(n => n + 5)], { pickup: 0.5, gap: 0.75 });
  const result = analyzePatterns(song);
  partition(result, song.duration);
  near(result.phrases[1].start, phrases[1].start);
  assert.equal(result.phrases[1].features.noteCount, A.length);
  assert.equal(result.phrases[1].features.firstPitch, 65);
});

test('sustained bass cannot mask rests in the melodic track; explicit track overrides inference', () => {
  const { song } = fixture([A, B, A], { accompaniment: true });
  song.notes.push(...song.notes.filter(n => n.track === 1).map(n => ({ ...n, midi: n.midi - 24, track: 2, channel: 2 })));
  assert.deepEqual(analyzePatterns(song).melodyTracks, [1]);
  assert.ok(analyzePatterns(song).warnings.some(w => w.includes('atravessam')));
  const selected = analyzePatterns(song, { tracks: [2] });
  assert.deepEqual(selected.melodyTracks, [2]); assert.equal(selected.analysis.melodySource, 'selected');
  assert.equal(selected.phrases[0].features.firstPitch, 36);
  assert.deepEqual(analyzePatterns(song, { tracks: [999] }).melodyTracks, [1]);
});

test('polyphonic skyline is disclosed, and sustain tails do not erase physical melody rests', () => {
  const { song } = fixture([A, A]);
  song.notes.push(...song.notes.map(n => ({ ...n, midi: n.midi - 12 })));
  song.notes = song.notes.map(n => ({ ...n, duration: 4 }));
  const result = analyzePatterns(song);
  assert.ok(result.warnings.some(w => w.includes('mais aguda')));
  assert.equal(result.patterns.length, 1); assert.equal(result.phrases[0].features.firstPitch, 60);
});

test('a sparse high ornament track cannot displace a complete lower melody', () => {
  const { song } = fixture([A, B, A]);
  song.notes.push({ time: 0, duration: 0.1, midi: 110, track: 7, channel: 7 });
  assert.deepEqual(analyzePatterns(song).melodyTracks, [1]);
  assert.deepEqual(analyzePatterns(song, { tracks: [7] }).melodyTracks, [7], 'explicit selection remains possible');
});

test('reviewed boundaries can be reclassified without losing their IDs, names or cuts', () => {
  const { song, phrases } = fixture([A, B, A]);
  phrases[0].name = 'Tema escolhido';
  const result = analyzePatterns(song, { phrases });
  assert.deepEqual(result.phrases.map(p => p.id), phrases.map(p => p.id));
  assert.deepEqual(result.phrases.map(p => [p.start, p.end]), phrases.map(p => [p.start, p.end]));
  assert.equal(result.phrases[0].name, 'Tema escolhido');
  assert.equal(result.phrases[2].patternId, result.phrases[0].patternId);
  assert.equal(result.analysis.reviewedBoundaries, true);
});

test('small ornaments and changed rhythm are compared as variations with explicit differences', () => {
  const ornamented = [...A.slice(0, 4), 66, ...A.slice(4)];
  const { song, phrases } = fixture([A, { pitches: ornamented, rhythm: [0.5, 0.5, 0.5, 0.25, 0.25, 0.5, 0.5, 0.5, 0.5] }]);
  const result = analyzePatterns(song, { phrases });
  assert.equal(result.patterns.length, 1);
  assert.equal(result.phrases[1].variant, 'variation');
  assert.ok(result.phrases[1].comparison.addedNotes >= 1);
  assert.match(result.phrases[1].comparison.summary, /acrescentado/);
});

test('stable content IDs and editorial revision IDs invalidate only their intended state', () => {
  const { song } = fixture([A, B, A]);
  const a = analyzePatterns(song), b = analyzePatterns(JSON.parse(JSON.stringify(song)));
  assert.equal(a.contentKey, b.contentKey); assert.equal(a.revisionKey, b.revisionKey);
  assert.deepEqual(a.phrases.map(p => p.id), b.phrases.map(p => p.id));
  const normalized = normalizePatternAnalysis(a, song.duration);
  assert.equal(normalized.revisionKey, a.revisionKey);
  normalized.patterns[0].label = 'Tema';
  const revised = normalizePatternAnalysis(normalized, song.duration);
  assert.equal(revised.contentKey, a.contentKey); assert.notEqual(revised.revisionKey, a.revisionKey);
  assert.equal(revised.revisionKey, patternRevisionKey(revised));
  song.notes.at(-1).midi++;
  assert.notEqual(analyzePatterns(song).contentKey, a.contentKey);
});

test('project normalization strips foreign data and rebuilds all family/form references', () => {
  const { song } = fixture([A, B, A]);
  const result = analyzePatterns(song);
  result.patterns[0].occurrences = ['not-real'];
  result.patterns[0].representativePhraseId = 'not-real';
  result.patterns[0].manualReview = true;
  result.patterns[0].evil = { script: 'no' };
  result.phrases[0].referencePhraseId = 'not-real';
  result.phrases[0].manualReview = true;
  result.phrases[0].features.unknown = 'no';
  result.phrases[0].comparison.summary = 'Grupo ajustado na revisão.';
  result.form = [{ phraseId: '__proto__' }];
  const restored = normalizePatternAnalysis(result, song.duration);
  partition(restored, song.duration);
  assert.equal(restored.patterns[0].evil, undefined); assert.equal(restored.phrases[0].features.unknown, undefined);
  assert.equal(restored.phrases[0].manualReview, true); assert.equal(restored.patterns[0].manualReview, true);
  assert.equal(restored.phrases[0].comparison.summary, 'Grupo ajustado na revisão.');
  assert.equal(restored.form.length, restored.phrases.length);
  assert.equal(normalizePatternAnalysis({}, song.duration), null);
});

test('empty and percussion-only inputs state that a melody is unavailable', () => {
  assert.deepEqual(analyzePatterns({ notes: [], duration: 0 }).phrases, []);
  const { song } = fixture([A]); song.notes.forEach(n => { n.channel = 9; });
  const result = analyzePatterns(song);
  assert.deepEqual(result.patterns, []); assert.deepEqual(result.melodyTracks, []);
  assert.ok(result.warnings.some(w => w.includes('percussão')));
});

test('a long mechanical MIDI has bounded comparisons and no unsupported promise of completeness', () => {
  const { song } = fixture(Array.from({ length: 450 }, () => A), { gap: 0 });
  const started = performance.now(), result = analyzePatterns(song);
  partition(result, song.duration);
  assert.ok(result.phrases.length <= 512); assert.ok(result.analysis.recurrenceCandidates <= 2200);
  assert.ok(performance.now() - started < 10000, 'bounded analysis should finish within ten seconds');
});
