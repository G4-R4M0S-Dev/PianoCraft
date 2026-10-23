import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStudyPlan, createStudyPlan, normalizeStudyProgress, startingPointChallenge } from '../src/music/study-plan.js';

function fixture() {
  const notes = [];
  for (let i = 0; i < 4; i++) for (let n = 0; n < 8; n++) notes.push({ midi: 60 + n % 4 + (i === 2 && n === 7 ? 1 : 0), time: i * 8 + n, duration: .7, track: 1, channel: 0 });
  const song = { id: 'song-one', title: 'Arranjo de teste', duration: 32, notes };
  const phrases = [
    { id: 'a1', start: 0, end: 8, patternId: 'a', patternLabel: 'A', variant: 'original' },
    { id: 'b1', start: 8, end: 16, patternId: 'b', patternLabel: 'B', variant: 'unique' },
    { id: 'a2', start: 16, end: 24, patternId: 'a', patternLabel: "A'", variant: 'variation', comparison: { summary: 'Última nota sobe um semitom.' } },
    { id: 'a3', start: 24, end: 32, patternId: 'a', patternLabel: 'A', variant: 'exact' },
  ];
  return { song, analysis: { contentKey: 'content-one', phrases, melodyTracks: [1], patterns: [{ id: 'a', label: 'A', representativePhraseId: 'a1', occurrences: ['a1', 'a2', 'a3'] }, { id: 'b', label: 'B', representativePhraseId: 'b1', occurrences: ['b1'] }] } };
}
function attempt(overrides = {}) {
  return { id: 'attempt-one', songId: 'song-one', profile: 'Ana', analysisKey: 'content-one', date: '2026-10-22T12:00:00Z', mode: 'rhythm', hands: 'both', fullArrangement: true, transpose: 0, speed: .9, seconds: 9, hits: 8, expectedNotes: 8, accuracy: 100, completed: true, phraseId: 'a1', phraseStart: 0, phraseEnd: 8, ...overrides };
}
const consistent = () => [1, 2, 3].map(i => attempt({ id: `attempt-${i}`, date: `2026-10-22T12:0${i}:00Z` }));

test('no history means no mastered minute or measured pattern; suggestions use real content', () => {
  const { song, analysis } = fixture(), plan = buildStudyPlan(song, analysis, { profile: 'Ana' });
  assert.equal(createStudyPlan, buildStudyPlan);
  assert.equal(plan.sessions.length, 7);
  assert.equal(plan.objective.patternId, 'a');
  assert.equal(plan.objective.phraseId, 'a1');
  assert.ok(plan.patternsProgress.every(p => p.status === 'não avaliado' && p.attempts === 0));
  assert.ok(plan.exercises.every(e => e.start >= 0 && e.end > e.start && e.end <= song.duration));
  assert.equal(plan.sessions.every(s => s.completed === false), true);
  assert.equal(plan.exercises.every(e => e.completed === false), true);
  assert.match(plan.exercises.find(e => e.type === 'contour').instruction, /8 ataques/);
  assert.match(plan.summary, /2 padrão\(ões\) em 4 trecho/);
});

test('three qualified base attempts prioritize its small variation with an exact comparison range', () => {
  const { song, analysis } = fixture(), plan = buildStudyPlan(song, analysis, { profile: 'Ana', history: consistent() });
  assert.equal(plan.objective.phraseId, 'a2');
  assert.match(plan.objective.title, /variação/);
  const comparison = plan.exercises.find(e => e.type === 'compare');
  assert.equal(comparison.start, 16); assert.equal(comparison.end, 24);
  assert.deepEqual(comparison.compareWith, { start: 0, end: 8, phraseId: 'a1' });
  assert.match(comparison.instruction, /Última nota sobe um semitom/);
  assert.equal(plan.patternsProgress[0].status, 'em estudo');
  assert.equal(plan.patternsProgress[0].baseQualifiedAttempts, 3);
});

test('a chosen pattern gets its own plan while invalid choices fall back without changing evidence or checklists', () => {
  const { song, analysis } = fixture();
  const automatic = buildStudyPlan(song, analysis, { profile: 'Ana' });
  const progress = { ...automatic.progress, completedExercises: [automatic.exercises[0].id], completedSessions: [automatic.sessions[0].id] };
  const chosen = buildStudyPlan(song, analysis, { profile: 'Ana', progress, targetPatternId: 'b' });
  assert.equal(chosen.targetPatternId, 'b');
  assert.equal(chosen.recommendedPatternId, 'a');
  assert.equal(chosen.objective.patternId, 'b');
  assert.equal(chosen.objective.start, 8); assert.equal(chosen.objective.end, 16);
  assert.deepEqual(chosen.patternsProgress, automatic.patternsProgress);
  assert.deepEqual(chosen.progress, progress);
  const restored = buildStudyPlan(song, analysis, { profile: 'Ana', progress: chosen.progress, targetPatternId: 'a' });
  assert.equal(restored.exercises[0].completed, true);
  assert.equal(restored.sessions[0].completed, true);
  assert.equal(buildStudyPlan(song, analysis, { targetPatternId: 'missing' }).objective.patternId, 'a');
});

test('unknown tempo, melody mode, slow performance and separate hands never establish consistency', () => {
  const { song, analysis } = fixture();
  for (const overrides of [{ speed: undefined }, { mode: 'melody' }, { speed: .89 }, { hands: 'right' }, { completed: false }, { accuracy: 89 }, { hits: 1 }, { seconds: 1 }, { analysisKey: undefined }, { fullArrangement: undefined }, { fullArrangement: false }, { transpose: undefined }, { transpose: 12 }]) {
    const history = consistent().map(row => ({ ...row, ...overrides }));
    const plan = buildStudyPlan(song, analysis, { profile: 'Ana', history });
    assert.equal(plan.patternsProgress[0].qualifiedAttempts, 0, JSON.stringify(overrides));
    assert.equal(plan.objective.phraseId, 'a1');
  }
});

test('other profiles, songs, stale analyses and invalid records cannot inflate progress', () => {
  const { song, analysis } = fixture();
  const history = [...consistent().map(row => ({ ...row, profile: 'Bia' })), ...consistent().map(row => ({ ...row, songId: 'other' })), ...consistent().map(row => ({ ...row, analysisKey: 'previous-content' })), attempt({ date: 'invalid' }), attempt({ seconds: -1 }), attempt({ hits: 0 })];
  const plan = buildStudyPlan(song, analysis, { profile: 'Ana', history });
  assert.equal(plan.patternsProgress[0].attempts, 0);
  assert.equal(plan.objective.phraseId, 'a1');
});

test('duplicated import ids and old successes cannot manufacture current consistency', () => {
  const { song, analysis } = fixture();
  const duplicate = buildStudyPlan(song, analysis, { profile: 'Ana', history: [attempt(), attempt(), attempt()] });
  assert.equal(duplicate.patternsProgress[0].qualifiedAttempts, 1);
  const history = [...consistent(), ...[4, 5, 6].map(i => attempt({ id: `attempt-${i}`, accuracy: 50, date: `2026-10-22T12:0${i}:00Z` }))];
  const staleSuccesses = buildStudyPlan(song, analysis, { profile: 'Ana', history });
  assert.equal(staleSuccesses.patternsProgress[0].qualifiedAttempts, 2);
  assert.equal(staleSuccesses.objective.phraseId, 'a1');
});

test('whole-song scores and partial phrase loops are not evidence of one phrase', () => {
  const { song, analysis } = fixture();
  const history = [attempt({ phraseId: undefined, phraseStart: 0, phraseEnd: 32 }), attempt({ phraseStart: 0, phraseEnd: 4 }), attempt({ phraseId: 'a3' })];
  const plan = buildStudyPlan(song, analysis, { profile: 'Ana', history });
  assert.equal(plan.patternsProgress[0].attempts, 0);
});

test('checklists persist for the exact profile, song and analysis and never change measured progress', () => {
  const { song, analysis } = fixture();
  const initial = buildStudyPlan(song, analysis, { profile: 'Ana' });
  const progress = { ...initial.progress, completedSessions: [initial.sessions[0].id], completedExercises: [initial.exercises[0].id] };
  const restored = buildStudyPlan(song, analysis, { profile: 'Ana', progress });
  assert.equal(restored.sessions[0].completed, true);
  assert.equal(restored.exercises[0].completed, true);
  assert.equal(restored.patternsProgress[0].status, 'não avaliado');
  for (const context of [{ profile: 'Bia', songId: song.id, analysisKey: analysis.contentKey }, { profile: 'Ana', songId: 'other', analysisKey: analysis.contentKey }, { profile: 'Ana', songId: song.id, analysisKey: 'changed-content' }]) {
    assert.equal(normalizeStudyProgress(progress, context).completedSessions.length, 0);
    assert.equal(normalizeStudyProgress(progress, context).completedExercises.length, 0);
  }
});

test('progress normalization bounds and filters malformed imported self-reports', () => {
  const context = { songId: 's', profile: 'Ana', analysisKey: 'a', validSessionIds: ['s1'], validExerciseIds: ['e1'] };
  const normalized = normalizeStudyProgress({ version: 1, songId: 's', profile: 'Ana', analysisKey: 'a', completedSessions: ['s1', 's1', 'no', 123, null], completedExercises: ['e1', 'no'] }, context);
  assert.deepEqual(normalized.completedSessions, ['s1']); assert.deepEqual(normalized.completedExercises, ['e1']);
  assert.equal(normalizeStudyProgress(null, context).completedSessions.length, 0);
});

test('starting points are reproducible, distributed across actual phrases and never before a valid range', () => {
  const { song, analysis } = fixture(), plan = buildStudyPlan(song, analysis, { profile: 'Ana' });
  const points = plan.exercises.find(e => e.type === 'starting-points').points;
  assert.equal(points.length, 4);
  assert.deepEqual([...points.map(p => p.start)].sort((a, b) => a - b), [0, 8, 16, 24]);
  assert.deepEqual(points, buildStudyPlan(song, analysis, { profile: 'Ana' }).startingPoints);
  assert.deepEqual(startingPointChallenge(analysis.phrases, 'seed'), startingPointChallenge(analysis.phrases, 'seed'));
  assert.ok(points.every(p => analysis.phrases.some(f => f.start === p.start && f.end === p.end && f.id === p.phraseId)));
  assert.ok(points.every(p => analysis.phrases.some(f => f.id === p.phraseId && f.patternId === p.patternId)));
});

test('same music creates stable exercise ids; changing content invalidates the checklist', () => {
  const { song, analysis } = fixture(), first = buildStudyPlan(song, analysis, { profile: 'Ana' });
  assert.deepEqual(first.exercises.map(e => e.id), buildStudyPlan({ ...song, title: 'Nome editado' }, analysis, { profile: 'Ana' }).exercises.map(e => e.id));
  const changed = buildStudyPlan(song, { ...analysis, contentKey: 'new-content' }, { profile: 'Ana', progress: { ...first.progress, completedExercises: [first.exercises[0].id] } });
  assert.ok(changed.exercises.every(e => !e.completed));
});

test('reviewing grouping uses revision identity and invalidates former task and attempt evidence', () => {
  const { song, analysis } = fixture();
  const first = buildStudyPlan(song, { ...analysis, revisionKey: 'revision-one' }, { profile: 'Ana' });
  assert.equal(first.analysisKey, 'revision-one');
  const plan = buildStudyPlan(song, { ...analysis, revisionKey: 'revision-two' }, { profile: 'Ana', history: consistent().map(row => ({ ...row, analysisKey: 'revision-one' })), progress: { ...first.progress, completedSessions: [first.sessions[0].id] } });
  assert.equal(plan.patternsProgress[0].attempts, 0);
  assert.ok(plan.sessions.every(s => !s.completed));
});

test('a long arrangement samples starts from its whole length, including first and final phrases', () => {
  const song = { id: 'long', duration: 240, notes: [] };
  const analysis = { contentKey: 'long-notes', phrases: Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, patternId: 'a', start: i * 4, end: (i + 1) * 4 })) };
  const plan = buildStudyPlan(song, analysis);
  assert.equal(plan.startingPoints.length, 12);
  assert.ok(plan.startingPoints.some(p => p.start === 0));
  assert.ok(plan.startingPoints.some(p => p.start === 236));
  assert.ok(plan.startingPoints.some(p => p.start >= 116 && p.start <= 132));
});

test('single phrase, empty analysis, malformed ranges and adjustable session length are handled', () => {
  const { song, analysis } = fixture();
  const one = buildStudyPlan(song, { ...analysis, phrases: [analysis.phrases[0]], patterns: [analysis.patterns[0]] }, { sessionMinutes: 7 });
  assert.ok(one.sessions.every(s => s.minutes === 7));
  assert.ok(one.exercises.every(e => e.start >= 0 && e.end <= 8));
  assert.equal(buildStudyPlan(song, { ...analysis, phrases: [] }).sessions.length, 0);
  assert.equal(buildStudyPlan(null, null).exercises.length, 0);
  assert.equal(buildStudyPlan({ duration: 10, notes: {} }, { phrases: {}, patterns: 'invalid' }).exercises.length, 0);
  const invalid = buildStudyPlan(song, { ...analysis, phrases: [{ start: -1, end: 4 }, { start: 2, end: NaN }] });
  assert.equal(invalid.exercises.length, 0);
  assert.equal(buildStudyPlan(song, analysis, { sessionMinutes: 10000 }).sessionMinutes, 90);
});
