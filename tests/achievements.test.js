import test from 'node:test';
import assert from 'node:assert/strict';
import { achievementContentKey, summarizeAchievements, evaluateAchievementAttempt, normalizeAchievementLedger, compareAchievements, mergeAchievementLedgers } from '../src/music/achievements.js';

const song = { id: 'piece', title: 'Exemplo', duration: 8, phrasing: { contentKey: 'structure-one' },
  notes: Array.from({ length: 8 }, (_, i) => ({ id: `note-${i}`, time: i, duration: .5, midi: i % 2 ? 64 : 48, track: 0 })) };
const options = { profile: 'Ana' };
const row = (extra = {}, piece = song) => ({ id: 'attempt-1', songId: piece.id, profile: 'Ana', date: '2026-10-22T12:00:00Z', mode: 'melody', hands: 'both',
  songContentKey: achievementContentKey(piece), scopeComplete: true, completed: true, transpose: 0, speed: 1,
  start: 0, end: 8, seconds: 8, hits: 8, missed: 0, errors: 0, expectedNotes: 8, accuracy: 100, ...extra });
const track = (summary, id = 'melody:both') => summary.tracks.find(item => item.id === id);
const evaluate = (attempt = row(), ledger = null, piece = song) => evaluateAchievementAttempt(piece, ledger, attempt, options);

test('guided completion earns only its own hand and mode path, not mastery in other modes', () => {
  const { summary, gains } = evaluate(row({ speed: .5, seconds: 16 }));
  assert.equal(track(summary).score, 100); assert.equal(track(summary).coverage, 1); assert.equal(track(summary).completed, true);
  assert.equal(track(summary, 'rhythm:both').score, null); assert.equal(track(summary, 'melody:right').score, null);
  assert.equal(summary.totalPoints, 100); assert.equal(summary.maxPoints, 900); assert.equal(gains.points, 100);
  assert.match(track(summary).description, /não avaliam a execução no tempo/);
});

test('same or worse repetitions award no points or milestones, including after reload', () => {
  const first = evaluate(row({ errors: 2 }));
  assert.equal(first.gains.points, 80);
  const restored = normalizeAchievementLedger(JSON.parse(JSON.stringify(first.ledger)), song, options);
  const repeated = evaluate(row({ id: 'attempt-2', errors: 2 }), restored);
  assert.equal(repeated.changed, false); assert.equal(repeated.gains.points, 0); assert.equal(repeated.gains.newMilestones.length, 0);
  const worse = evaluate(row({ id: 'attempt-3', errors: 8 }), repeated.ledger);
  assert.equal(worse.gains.points, 0); assert.equal(track(worse.summary).score, 80);
});

test('coverage and points follow actual note counts rather than silent duration', () => {
  const uneven = { ...song, duration: 100, notes: song.notes.map((note, i) => ({ ...note, time: i === 7 ? 99 : i })) };
  const first = evaluate(row({ end: 7, hits: 7, expectedNotes: 7, seconds: 7 }, uneven), null, uneven);
  assert.equal(track(first.summary).coveredNotes, 7); assert.equal(track(first.summary).coverage, 7 / 8);
  assert.equal(track(first.summary).score, 88);
  const last = evaluate(row({ start: 99, end: 100, hits: 1, expectedNotes: 1, seconds: 1 }, uneven), first.ledger, uneven);
  assert.equal(track(last.summary).score, 100); assert.equal(last.gains.points, 12);
});

test('overlapping fragments keep the better precision without counting notes twice', () => {
  const half = evaluate(row({ end: 4, hits: 4, expectedNotes: 4, errors: 4, seconds: 4 }));
  assert.equal(track(half.summary).score, 25);
  const overlap = evaluate(row({ start: 2, end: 6, hits: 4, expectedNotes: 4, seconds: 4 }), half.ledger);
  assert.equal(track(overlap.summary).coverage, .75); assert.equal(track(overlap.summary).score, 63);
  assert.deepEqual(overlap.ledger.paths.find(path => path.id === 'melody:both').evidence,
    [{ start: 0, end: 2, quality: 5000 }, { start: 2, end: 6, quality: 10000 }]);
});

test('specific hand paths require exactly the notes assigned to that hand', () => {
  const result = evaluate(row({ hands: 'right', hits: 4, expectedNotes: 4 }));
  assert.equal(track(result.summary, 'melody:right').score, 100); assert.equal(track(result.summary).score, null);
  assert.equal(evaluate(row({ hands: 'right' })).gains.qualified, false);
  const reassigned = { ...song, configs: { 0: { hand: 'right' } } };
  assert.equal(achievementContentKey(reassigned) === achievementContentKey(song), false);
  const allRight = summarizeAchievements(reassigned, [], options);
  assert.equal(track(allRight, 'rhythm:left').eligible, false); assert.equal(allRight.maxPoints, 600);
});

test('rhythm requires at least 90 percent and recital exactly original tempo', () => {
  assert.equal(evaluate(row({ mode: 'rhythm', speed: .89, seconds: 10 })).gains.qualified, false);
  assert.equal(evaluate(row({ mode: 'rhythm', speed: .9, seconds: 10 })).gains.qualified, true);
  assert.equal(evaluate(row({ mode: 'recital', speed: .99 })).gains.qualified, false);
  assert.equal(evaluate(row({ mode: 'recital', speed: 1 })).gains.qualified, true);
  assert.equal(evaluate(row({ mode: 'melody', speed: .25, seconds: 32 })).gains.qualified, true);
});

test('incomplete attempts, missing arrangement scope, transposition and implausible durations do not award', () => {
  for (const extra of [{ completed: false }, { scopeComplete: false }, { scopeComplete: undefined }, { transpose: 12 }, { transpose: undefined }, { seconds: .1 }, { hits: 0, missed: 8 }, { hits: 7 }, { expectedNotes: 7 }]) {
    const result = evaluate(row(extra));
    assert.equal(result.gains.qualified, false, JSON.stringify(extra)); assert.equal(result.gains.points, 0); assert.equal(result.changed, false);
  }
});

test('rows and stored ledgers are isolated by exact profile, song and content version', () => {
  const first = evaluate();
  for (const extra of [{ profile: 'Bia' }, { songId: 'other' }, { songContentKey: 'old' }, { songContentKey: undefined }]) assert.equal(evaluate(row(extra), first.ledger).gains.qualified, false);
  assert.equal(track(summarizeAchievements(song, [], { profile: 'Bia', ledger: first.ledger })).score, null);
  const altered = { ...song, notes: song.notes.map((note, i) => i ? note : { ...note, midi: 49 }) };
  assert.notEqual(achievementContentKey(altered), achievementContentKey(song));
  assert.equal(track(summarizeAchievements(altered, [row()], { ...options, ledger: first.ledger })).score, null);
});

test('content fingerprint survives note IDs and input order but changes note duration or hand assignment', () => {
  const shuffled = { ...song, notes: [...song.notes].reverse().map(note => ({ ...note, id: `changed-${note.id}` })) };
  assert.equal(achievementContentKey(shuffled), achievementContentKey(song));
  assert.notEqual(achievementContentKey({ ...song, notes: song.notes.map(note => ({ ...note, duration: 1 })) }), achievementContentKey(song));
  assert.notEqual(achievementContentKey({ ...song, notes: song.notes.map(note => ({ ...note, hand: 'left' })) }), achievementContentKey(song));
  const layered = { ...song, notes: [{ time: 0, midi: 60, duration: 1 }, { time: 0, midi: 60, duration: 2, hand: 'right' }] };
  assert.equal(achievementContentKey(layered), achievementContentKey({ ...layered, notes: [...layered.notes].reverse() }));
});

test('simultaneous notes at a boundary belong only to the following range', () => {
  const chordSong = { ...song, duration: 2, notes: [{ time: 0, midi: 60 }, { time: 1, midi: 60 }, { time: 1, midi: 64 }, { time: 1, midi: 67 }] };
  const before = evaluate(row({ end: 1, seconds: 1, hits: 1, expectedNotes: 1 }, chordSong), null, chordSong);
  assert.equal(track(before.summary).coveredNotes, 1);
  const after = evaluate(row({ start: 1, end: 2, seconds: 1, hits: 3, expectedNotes: 3 }, chordSong), before.ledger, chordSong);
  assert.equal(track(after.summary).coveredNotes, 4); assert.equal(track(after.summary).score, 100);
});

test('precision is derived from authoritative counters instead of imported accuracy', () => {
  const result = evaluate(row({ accuracy: 100, hits: 4, missed: 4 }));
  assert.equal(track(result.summary).score, 50); assert.equal(track(result.summary).bestAccuracy, 50);
});

test('legacy history can seed only with matching arrangement analysis and known original settings', () => {
  const legacy = row({ songContentKey: undefined, scopeComplete: undefined, fullArrangement: true, analysisKey: 'structure-one' });
  const summary = summarizeAchievements(song, [legacy, legacy], options);
  assert.equal(track(summary).score, 100);
  assert.equal(evaluate(legacy).gains.qualified, false, 'loading legacy evidence is not a new awarded attempt');
  assert.equal(evaluate(row(), summary.ledger).gains.points, 0);
  for (const extra of [{ analysisKey: 'old' }, { analysisKey: undefined }, { fullArrangement: false }, { scopeComplete: false }, { speed: undefined }]) {
    assert.equal(track(summarizeAchievements(song, [{ ...legacy, ...extra }], options)).score, null);
  }
});

test('malformed or unrelated ledger intervals are rejected or normalized without out-of-range credit', () => {
  const result = evaluate();
  const copy = JSON.parse(JSON.stringify(result.ledger)), path = copy.paths.find(item => item.id === 'melody:both');
  path.evidence = [{ start: -1, end: 8, quality: 10000 }, { start: 0, end: 9, quality: 10000 }, { start: 0, end: 8, quality: 10001 }, { start: 0, end: 2, quality: 5000 }, { start: 1, end: 3, quality: 10000 }];
  path.bestAccuracy = 9999;
  const summary = summarizeAchievements(song, [], { ...options, ledger: copy });
  assert.equal(track(summary).coveredNotes, 3); assert.equal(track(summary).score, 31); assert.equal(track(summary).bestAccuracy, 100);
  assert.equal(track(summarizeAchievements(song, [], { ...options, ledger: { ...copy, version: 2 } })).score, null);
});

test('milestones are stable, scoped and never reawarded after persistence or history pruning', () => {
  const first = evaluate(); assert.ok(first.gains.newMilestones.some(item => item.id === 'melody:both:complete'));
  const restored = summarizeAchievements(song, [], { ...options, ledger: JSON.parse(JSON.stringify(first.ledger)) });
  assert.deepEqual(restored.milestones, first.summary.milestones);
  const gains = compareAchievements(first.summary, restored, row());
  assert.equal(gains.points, 0); assert.deepEqual(gains.newMilestones, []);
  const other = summarizeAchievements(song, [], { profile: 'Bia' });
  assert.equal(compareAchievements(other, restored, row()).points, 0); assert.deepEqual(compareAchievements(other, restored, row()).newMilestones, []);
});

test('a perfect tiny fragment cannot complete a song-length path', () => {
  const result = evaluate(row({ start: 3, end: 4, hits: 1, expectedNotes: 1, seconds: 1 }));
  assert.equal(track(result.summary).score, 13); assert.equal(track(result.summary).completed, false);
  assert.equal(result.gains.newMilestones.length, 0);
});

test('backup merge preserves disjoint and overlapping best evidence without adding duplicate points', () => {
  const first = evaluate(row({ end: 5, hits: 5, expectedNotes: 5, errors: 5, seconds: 5 }));
  const second = evaluate(row({ start: 3, end: 8, hits: 5, expectedNotes: 5, seconds: 5 }));
  const unrelated = evaluateAchievementAttempt(song, null, row({ profile: 'Bia' }), { profile: 'Bia' }).ledger;
  const merged = mergeAchievementLedgers(song, [first.ledger, second.ledger, second.ledger, unrelated], options);
  const summary = summarizeAchievements(song, [], { ...options, ledger: merged });
  assert.equal(track(summary).coverage, 1); assert.equal(track(summary).score, 81);
  assert.deepEqual(merged.paths.find(path => path.id === 'melody:both').evidence,
    [{ start: 0, end: 3, quality: 5000 }, { start: 3, end: 8, quality: 10000 }]);
  assert.deepEqual(mergeAchievementLedgers(song, [merged, first.ledger, second.ledger], options), merged);
  assert.equal(evaluate(row({ start: 3, end: 8, hits: 5, expectedNotes: 5, seconds: 5 }), merged).gains.points, 0);
});
