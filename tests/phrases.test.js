import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestPhrases, normalizePhrases, normalizePhrasing, splitPhrase, mergePhrases, movePhraseBoundary, getPhraseAtTime } from '../src/music/phrases.js';
import { normalizeSong, encodeMidi, parseMidi } from '../src/music/midi.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
function musicalSong({ bars = 16, numerator = 4, denominator = 4, tempo = 120, changes = [], markers = [] } = {}) {
  const tempos = [{ beat: 0, bpm: tempo }, ...changes].sort((a, b) => a.beat - b.beat);
  tempos[0].time = 0;
  for (let i = 1; i < tempos.length; i++) tempos[i].time = tempos[i - 1].time + (tempos[i].beat - tempos[i - 1].beat) * 60 / tempos[i - 1].bpm;
  const seconds = beat => {
    let current = tempos[0]; for (const entry of tempos) if (entry.beat <= beat) current = entry;
    return current.time + (beat - current.beat) * 60 / current.bpm;
  };
  const beats = bars * numerator * 4 / denominator;
  const notes = [];
  for (let beat = 0; beat < beats; beat += 0.5) notes.push({ time: seconds(beat), duration: seconds(beat + 0.35) - seconds(beat), keyDuration: seconds(beat + 0.35) - seconds(beat), midi: [72, 74, 76, 79][Math.floor(beat * 2) % 4], velocity: 0.8, track: 1, channel: 0 });
  return normalizeSong({ id: 'test', title: 'Frases', duration: seconds(beats), tempo, tempos: tempos.map(({ time, bpm }) => ({ time, bpm })), timeSignatures: [{ time: 0, numerator, denominator }], notes, markers: markers.map(({ beat, text }) => ({ time: seconds(beat), text })) });
}
function assertPartition(phrases, duration, count) {
  if (count != null) assert.equal(phrases.length, count);
  assert.equal(phrases[0].start, 0); near(phrases.at(-1).end, duration);
  assert.equal(new Set(phrases.map(p => p.id)).size, phrases.length);
  for (let i = 0; i < phrases.length; i++) {
    const p = phrases[i]; assert.ok(p.start < p.end); assert.ok(p.confidence >= 0 && p.confidence <= 1);
    if (i) near(p.start, phrases[i - 1].end);
  }
}

test('suggestions use 3/4 measures rather than fixed seconds or four quarter notes', () => {
  const song = musicalSong({ bars: 24, numerator: 3 });
  const result = suggestPhrases(song, { targetBars: 4 });
  assertPartition(result.phrases, song.duration, 6);
  near(result.analysis.totalBars, 24);
  assert.deepEqual(result.phrases.map(p => p.end), [6, 12, 18, 24, 30, 36]);
});

test('tempo changes preserve musical phrase lengths while seconds change', () => {
  const song = musicalSong({ bars: 16, changes: [{ beat: 32, bpm: 60 }] });
  const result = suggestPhrases(song, { targetBars: 4 });
  assertPartition(result.phrases, 48, 4);
  assert.deepEqual(result.phrases.map(p => p.end), [8, 16, 32, 48]);
});

test('6/8 lengths use denominator and signature changes reset the bar grid', () => {
  const six = musicalSong({ bars: 12, numerator: 6, denominator: 8 });
  const result = suggestPhrases(six, { targetBars: 4 });
  assert.deepEqual(result.phrases.map(p => p.end), [6, 12, 18]);
  const mixed = musicalSong({ bars: 8 });
  mixed.timeSignatures.push({ time: 8, numerator: 3, denominator: 4 });
  const changed = suggestPhrases(mixed, { targetCount: 2 });
  near(changed.analysis.totalBars, 4 + 16 / 3);
  assertPartition(changed.phrases, 16, 2);
  assert.ok(changed.phrases[0].reason.includes('compasso'));
});

test('section markers influence cuts and name the phrase that starts there', () => {
  const song = musicalSong({ bars: 16, markers: [{ beat: 0, text: 'Introdução' }, { beat: 28, text: 'Refrão' }] });
  const result = suggestPhrases(song, { targetCount: 2 });
  assertPartition(result.phrases, song.duration, 2);
  near(result.phrases[0].end, 14);
  assert.equal(result.phrases[0].name, 'Introdução'); assert.equal(result.phrases[1].name, 'Refrão');
  assert.match(result.phrases[0].reason, /Marcador/);
});

test('a sustained accompaniment does not hide a pause in the inferred melody', () => {
  const song = musicalSong({ bars: 8 });
  song.notes = song.notes.filter(n => n.time < 7 || n.time >= 9);
  song.notes.push({ time: 0, duration: 16, keyDuration: 16, midi: 36, velocity: 0.7, track: 0, channel: 1 });
  const result = suggestPhrases(song, { targetCount: 2 });
  assert.deepEqual(result.analysis.melodyTracks, [1]);
  assert.ok(result.phrases[0].end >= 7 && result.phrases[0].end <= 9);
  assert.match(result.phrases[0].reason, /Pausa/);
  assert.ok(result.warnings.some(w => w.includes('atravessam')));
});

test('sustain tail is distinct from a physically held melodic note', () => {
  const song = musicalSong({ bars: 8 });
  song.notes = song.notes.filter(n => n.time < 7 || n.time >= 9).map(n => ({ ...n, duration: Math.min(16 - n.time, 10) }));
  const result = suggestPhrases(song, { targetCount: 2 });
  assert.match(result.phrases[0].reason, /Pausa/);
  assert.equal(result.warnings.filter(w => w.includes('atravessam')).length, 0);
});

test('an explicit melodic track choice is respected and records its inference source', () => {
  const song = musicalSong({ bars: 8 });
  song.notes.push(...song.notes.map(n => ({ ...n, midi: n.midi - 24, track: 0, channel: 1 })));
  assert.deepEqual(suggestPhrases(song, { tracks: [0], targetCount: 2 }).analysis.melodyTracks, [0]);
  assert.deepEqual(suggestPhrases(song, { tracks: [999], targetCount: 2 }).analysis.melodyTracks, [1]);
});

test('a user can request eleven phrases without splitting or losing MIDI notes', () => {
  const song = musicalSong({ bars: 44 });
  const before = JSON.stringify(song);
  const result = suggestPhrases(song, { targetCount: 11 });
  assertPartition(result.phrases, song.duration, 11);
  assert.equal(JSON.stringify(song), before);
  for (const note of song.notes) assert.equal(result.phrases.filter(p => note.time >= p.start && note.time < p.end).length, 1);
  assert.equal(result.analysis.requestedCount, 11);
});

test('short songs and long notes still get safe suggestions with honest warnings', () => {
  const song = normalizeSong({ duration: 1, notes: [{ time: 0, duration: 1, midi: 60 }] });
  const one = suggestPhrases(song); assertPartition(one.phrases, 1, 1);
  const eleven = suggestPhrases(song, { targetCount: 11 }); assertPartition(eleven.phrases, 1, 11);
  assert.ok(eleven.warnings.some(w => w.includes('atravessam')));
  const tiny = suggestPhrases({ ...song, duration: 0.001, notes: [{ time: 0, duration: 0.001, midi: 60 }] }, { targetCount: 11 });
  assertPartition(tiny.phrases, 0.001, 1); assert.ok(tiny.warnings.some(w => w.includes('em vez de 11')));
});

test('empty songs, zero duration and percussion-only input are handled', () => {
  assert.deepEqual(suggestPhrases({ duration: 0, notes: [] }).phrases, []);
  assert.deepEqual(suggestPhrases({ duration: 20, notes: [] }).phrases, []);
  const drums = musicalSong({ bars: 8 }); drums.notes = drums.notes.map(n => ({ ...n, channel: 9 }));
  const result = suggestPhrases(drums);
  assert.deepEqual(result.phrases, []); assert.deepEqual(result.melodyTracks, []);
  assert.ok(result.warnings.some(w=>w.includes('melódica')));
});

test('normalization restores contiguous bounded intervals and sanitizes metadata', () => {
  const phrases = normalizePhrases([{ id: 'same', name: ' Intro ', start: 2, end: 4, confidence: 3 }, { id: 'same', name: '', start: 8, end: 50 }, { start: NaN, end: 9 }, { start: 18, end: 19 }], 10);
  assertPartition(phrases, 10, 2); assert.equal(phrases[0].name, 'Intro'); assert.equal(phrases[0].end, 8); assert.equal(phrases[0].confidence, 1);
  assert.equal(phrases[1].id, 'same-2');
  const metadata = normalizePhrasing({ phrases, reviewed: true, targetCount: 99999, targetBars: -99, tracks: [1, 1, -1, '3', 2], unexpected: 'discard' }, 10);
  assert.equal(metadata.version, 1); assert.equal(metadata.targetCount, 256); assert.equal(metadata.targetBars, 1); assert.deepEqual(metadata.tracks, [1, 2]); assert.equal(metadata.unexpected, undefined);
  assert.equal(normalizePhrasing({}, 10), null);
});

test('manual cut, move and merge are immutable and reject destructive limits', () => {
  const phrases = suggestPhrases(musicalSong({ bars: 8 }), { targetCount: 2 }).phrases;
  const original = JSON.stringify(phrases), duration = 16;
  const split = splitPhrase(phrases, phrases[0].id, 3, duration);
  assertPartition(split, duration, 3); near(split[0].end, 3); assert.equal(split[1].name, `${phrases[0].name} — parte 2`);
  const moved = movePhraseBoundary(split, 0, 2, duration); near(moved[0].end, 2); near(moved[1].start, 2);
  const merged = mergePhrases(moved, moved[0].id, duration); assertPartition(merged, duration, 2); near(merged[0].end, phrases[0].end);
  assert.equal(JSON.stringify(phrases), original);
  assert.throws(() => splitPhrase(phrases, 0, 0, duration), /dentro/);
  assert.throws(() => movePhraseBoundary(phrases, 0, 16, duration), /limite/);
  assert.throws(() => movePhraseBoundary(phrases, 1, 12, duration), /última/);
  assert.throws(() => mergePhrases(phrases, 1, duration), /seguinte/);
  assert.throws(() => splitPhrase(phrases, 'missing', 3, duration), /válida/);
});

test('boundary lookup belongs to next phrase, with a final endpoint exception', () => {
  const phrases = normalizePhrases([{ start: 0, end: 4 }, { start: 4, end: 8 }], 8);
  assert.equal(getPhraseAtTime(phrases, 3.99).id, phrases[0].id);
  assert.equal(getPhraseAtTime(phrases, 4).id, phrases[1].id);
  assert.equal(getPhraseAtTime(phrases, 8).id, phrases[1].id);
  assert.equal(getPhraseAtTime(phrases, 8.1), null);
});

test('reviewed phrases survive project JSON normalization without altering events', () => {
  const song = musicalSong({ bars: 8 });
  song.events = [{ time: 1, type: 'cc', controller: 64, value: 127, track: 1, channel: 0 }, { time: 4, type: 'cc', controller: 64, value: 0, track: 1, channel: 0 }];
  song.phrasing = { version: 1, phrases: suggestPhrases(song, { targetCount: 11 }).phrases, reviewed: true, targetCount: 11, tracks: [1] };
  const restored = normalizeSong(JSON.parse(JSON.stringify(song)));
  assert.deepEqual(restored.phrasing, song.phrasing); assert.deepEqual(restored.notes, song.notes); assert.deepEqual(restored.events, song.events);
  const beforeMidi = parseMidi(encodeMidi({ ...song, phrasing: undefined }));
  const afterMidi = parseMidi(encodeMidi(restored));
  assert.deepEqual(afterMidi.notes, beforeMidi.notes); assert.deepEqual(afterMidi.events, beforeMidi.events);
  assert.equal(afterMidi.phrasing, undefined, 'SMF export does not pretend to retain application-specific phrases');
});
