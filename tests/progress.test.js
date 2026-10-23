import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAttempt, normalizeErrorEvents, summarizeProgress, songProgress } from '../src/music/progress.js';
import { PracticeSession } from '../src/music/practice.js';

const song = { id: 'one', title: 'Música A', duration: 32, tempo: 120, notes: Array.from({ length: 32 }, (_, i) => ({ id: `n${i}`, midi: 60 + i % 12, time: i })), timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }] };
const row = (id, extra = {}) => ({ id, songId: song.id, title: song.title, profile: 'Ana', date: `2026-10-22T10:${String(Number(id.replace(/\D/g, '')) || 0).padStart(2, '0')}:00Z`, seconds: 30, mode: 'rhythm', hands: 'both', hits: 30, errors: 0, missed: 2, accuracy: 94, completed: true, fullArrangement: true, transpose: 0, speed: 1, start: 0, end: 32, expectedNotes: 32, ...extra });
const options = { profile: 'Ana' };

test('groups loop attempts into one real session and keeps per-song/profile totals', () => {
  const rows = Array.from({ length: 5 }, (_, i) => row(`r${i}`, { practiceSessionId: 'visit-one' }));
  rows.push(row('r6', { practiceSessionId: 'visit-two' }), row('r7', { profile: 'Bia' }), row('r8', { songId: 'other' }));
  const summary = songProgress(song, rows, options);
  assert.equal(summary.attempts, 6); assert.equal(summary.sessions, 2); assert.equal(summary.seconds, 180);
  assert.equal(summary.sessionHistory.find(item => item.id === 'visit-one').attempts, 5);
  assert.equal(summary.estimatedSessions, 0);
  assert.equal(summary.lastPracticeAt, new Date(rows[5].date).toISOString());
});

test('legacy attempts use a documented 30-minute gap instead of counting every repeat', () => {
  const rows = [row('r0', { date: '2026-10-20T10:00:00Z' }), row('r1', { date: '2026-10-20T10:10:00Z' }), row('r2', { date: '2026-10-20T10:41:00Z' })];
  const summary = songProgress(song, rows, options);
  assert.equal(summary.sessions, 2); assert.equal(summary.estimatedSessions, 2); assert.equal(summary.attempts, 3);
});

test('duplicate imported attempts count once, IDs and ambiguous titles do not mix songs', () => {
  const duplicate = row('r0', { attemptId: 'attempt-one' });
  const second = { ...song, id: 'two' };
  const summary = summarizeProgress([song, second], [duplicate, duplicate, row('r1', { songId: undefined }), row('r2', { songId: 'two' })], options);
  assert.equal(summary.songs[0].attempts, 1); assert.equal(summary.songs[1].attempts, 1); assert.equal(summary.totals.songs, 2);
});

test('perfect guided fragments do not claim song mastery or assessment score', () => {
  const summary = songProgress(song, [row('r0', { mode: 'melody', hits: 2, missed: 0, accuracy: 100, end: 2 })], options);
  assert.equal(summary.score, null); assert.equal(summary.masteryLabel, 'Sem avaliação');
  assert.equal(summary.accuracy, 100); assert.equal(summary.studiedCoverage, 2 / 32);
});

test('full assessment scores require coverage, original tempo and independent sessions', () => {
  const perfect = { hits: 32, missed: 0, errors: 0, accuracy: 100 };
  const fragment = songProgress(song, [row('r0', { ...perfect, end: 4, hits: 4 })], options);
  assert.equal(fragment.coverage, .125); assert.ok(fragment.score < 15); assert.equal(fragment.masteryLabel, 'Trechos em avaliação');
  const repeated = songProgress(song, [0, 1, 2].map(i => row(`r${i}`, { ...perfect, practiceSessionId: `day-${i}` })), options);
  assert.equal(repeated.coverage, 1); assert.equal(repeated.score, 100); assert.equal(repeated.masteryLabel, 'Consistente');
  assert.equal(songProgress(song, [row('r0', { ...perfect, speed: .5 })], options).score, null);
  assert.equal(songProgress(song, [row('r0', { ...perfect, hands: 'right' })], options).score, null);
  assert.equal(songProgress(song, [row('r0', { ...perfect, fullArrangement: false })], options).score, null);
  assert.equal(songProgress(song, [row('r0', { ...perfect, transpose: 12 })], options).score, null);
  assert.equal(songProgress(song, [row('r0', { ...perfect, speed: undefined })], options).score, null, 'old rows without tempo cannot prove assessment');
});

test('new regressions lower the score instead of keeping the lifetime best precision', () => {
  const past = [0, 1, 2].map(i => row(`r${i}`, { hits: 32, missed: 0, accuracy: 100, practiceSessionId: `past-${i}` }));
  const recent = [3, 4, 5].map(i => row(`r${i}`, { hits: 16, missed: 16, accuracy: 50, practiceSessionId: `recent-${i}` }));
  assert.equal(songProgress(song, past, options).score, 100);
  assert.equal(songProgress(song, [...past, ...recent], options).score, 50);
});

test('accuracy is weighted by actual evidence, not an average of tiny and full attempts', () => {
  const summary = songProgress(song, [row('r0', { hits: 1, missed: 0, accuracy: 100 }), row('r1', { hits: 1, missed: 8, accuracy: 11 })], options);
  assert.equal(summary.accuracy, 20);
});

test('trend compares sessions in the same mode, hands and tempo band', () => {
  const rows = Array.from({ length: 6 }, (_, i) => row(`r${i}`, { practiceSessionId: `s-${i}`, hits: i < 3 ? 16 : 24, missed: i < 3 ? 16 : 8 }));
  assert.equal(songProgress(song, rows, options).trend, 25);
  rows.push(row('r7', { mode: 'melody', hands: 'right', accuracy: 100, hits: 4, missed: 0, practiceSessionId: 'different' }));
  assert.equal(songProgress(song, rows, options).trend, null);
});

test('hotspots preserve locations and reasons, distinguish repetition from cross-session recurrence', () => {
  const event = { time: 10.25, reason: 'wrong-note', type: 'pitch', midi: 61, expectedPitches: [60], noteIds: ['n10'], count: 3 };
  const rows = [row('r0', { practiceSessionId: 's1', errorEvents: [event] }), row('r1', { practiceSessionId: 's1', errorEvents: [event] })];
  let summary = songProgress(song, rows, options), spot = summary.hotspots[0];
  assert.equal(spot.start, 8); assert.equal(spot.end, 12); assert.equal(spot.errors, 6); assert.equal(spot.attempts, 2); assert.equal(spot.sessions, 1); assert.equal(spot.recurrence, 'within-session');
  rows.push(row('r2', { practiceSessionId: 's2', errorEvents: [event] }));
  summary = songProgress(song, rows, options); spot = summary.hotspots[0];
  assert.equal(spot.sessions, 2); assert.equal(spot.recurrence, 'across-sessions'); assert.deepEqual(spot.expectedPitches, [60]);
});

test('hotspots use the last five sessions so resolved old errors do not dominate indefinitely', () => {
  const rows = [row('r0', { practiceSessionId: 'old', errorEvents: [{ time: 4, reason: 'wrong-note', count: 20 }] }), ...Array.from({ length: 5 }, (_, i) => row(`r${i + 1}`, { practiceSessionId: `new-${i}` }))];
  assert.equal(songProgress(song, rows, options).hotspots.length, 0);
});

test('unfinished attempts count time and precision but do not grant intended-range coverage', () => {
  const summary = songProgress(song, [row('r0', { completed: false, position: 4 })], options);
  assert.equal(summary.seconds, 30); assert.equal(summary.score, null); assert.equal(summary.coverage, 0); assert.equal(summary.studiedCoverage, 0);
});

test('normalization bounds imported error detail and preserves optional study identifiers', () => {
  const normalized = normalizeAttempt(row('r1', { practiceSessionId: 'visit', attemptId: 'attempt', phraseStart: 1, phraseEnd: 2, analysisKey: 'analysis', exerciseId: 'exercise', errorEvents: [{ time: -1, reason: 'wrong-note' }, { time: 1, reason: 'wrong-note', expectedPitches: [60, 200], count: 2, midi: 61 }] }));
  assert.equal(normalized.exerciseId, 'exercise'); assert.equal(normalized.practiceSessionId, 'visit'); assert.equal(normalized.errorEvents.length, 1); assert.deepEqual(normalized.errorEvents[0].expectedPitches, [60]);
  assert.equal(normalizeErrorEvents(Array.from({ length: 300 }, () => ({ time: 1, reason: 'onset-missed' }))).length, 128);
  assert.equal(normalizeAttempt({ ...row('r0'), date: 'bad' }), null);
});

test('PracticeSession detail records each penalty once without changing authoritative counters', () => {
  const notes = [{ id: 'a', midi: 60, time: 1, duration: 1, track: 0 }, { id: 'b', midi: 64, time: 2, duration: 1, track: 0 }];
  const practice = new PracticeSession(notes, { mode: 'rhythm' });
  practice.input(61, 1, 0, 1000, 'wrong'); practice.release(61, 1, 0, 1010, 'wrong');
  practice.input(60, 1, 0, 1050, 'right'); practice.release(60, 1, 0, 1060, 'right'); practice.advance(3, 3000); practice.advance(4, 4000);
  assert.equal(practice.errors, 2); assert.equal(practice.missed.size, 1);
  assert.deepEqual(practice.errorEvents.map(event => event.reason), ['wrong-note', 'released-too-early', 'onset-missed']);
  assert.equal(practice.errorEvents.reduce((sum, event) => sum + event.count, 0), practice.errors + practice.missed.size);
  assert.equal(practice.errorEvents[0].time, 1); assert.deepEqual(practice.errorEvents[0].expectedPitches, [60]);
});

test('chord failures are localized once and repeated errors at the same attack aggregate', () => {
  const practice = new PracticeSession([{ id: 'a', midi: 60, time: 1, track: 0 }, { id: 'b', midi: 64, time: 1, track: 0 }], { mode: 'melody' });
  practice.input(60, 1, 0, 1000, 'a'); practice.advance(1, 1200); practice.advance(1, 1400);
  assert.equal(practice.errors, 1); assert.equal(practice.errorEvents[0].reason, 'chord-timeout'); assert.deepEqual(practice.errorEvents[0].noteIds, ['a', 'b']);
  practice.input(61, 1, 0, 1500, 'wrong'); practice.release(61, 1, 0, 1510, 'wrong'); practice.input(61, 1, 0, 1600, 'wrong');
  assert.equal(practice.errorEvents.length, 2); assert.equal(practice.errorEvents[1].count, 2);
});

test('detail cap reports dropped events without losing error totals', () => {
  const notes = Array.from({ length: 150 }, (_, i) => ({ id: `note-${i}`, time: i, midi: 60, track: 0 }));
  const practice = new PracticeSession(notes, { mode: 'rhythm' }); practice.advance(151, 151000);
  assert.equal(practice.missed.size, 150); assert.equal(practice.errorEvents.length, 128); assert.equal(practice.errorEventsDropped, 22);
});
