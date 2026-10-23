import test from 'node:test';
import assert from 'node:assert/strict';
import { achievementContentKey, summarizeAchievements, evaluateAchievementAttempt } from '../src/music/achievements.js';
import { handOf } from '../src/music/practice.js';
import { buildLearningJourney, normalizeJourneyState, createJourneyTask, evaluateJourneyAttempt, learningProgress } from '../src/music/learning-journey.js';

const profile = 'Ana';
function fixture() {
  return { id: 'piece', title: 'Padrões de estudo', tempo: 120, duration: 16,
    notes: Array.from({ length: 16 }, (_, time) => ({ id: `n${time}`, time, midi: time % 2 ? 48 + time % 4 : 64 + time % 4, duration: .5, track: 0 })),
    phrasing: { version: 2, reviewed: true, contentKey: 'structure-one', phrases: [
      { id: 'a1', name: 'Introdução', start: 0, end: 8, patternId: 'a', patternLabel: 'A', variant: 'original' },
      { id: 'a2', name: 'Retorno', start: 8, end: 16, patternId: 'a', patternLabel: 'A', variant: 'exact' },
    ], patterns: [{ id: 'a', label: 'A', representativePhraseId: 'a1' }] } };
}
function initial(song = fixture(), extra = {}) { return normalizeJourneyState(null, song, { profile, ...extra }); }
function withTask(song, options = {}, state = initial(song)) { return normalizeJourneyState({ ...state, task: createJourneyTask(song, { ...state.task, ...options, profile }), streak: 0 }, song, { profile }); }
function attempt(song, state, extra = {}) {
  const task = state.task, count = song.notes.filter(note => note.time >= task.start && note.time < task.end && (task.hands === 'both' || handOf(note, song.configs) === task.hands)).length;
  return { id: 'attempt-1', attemptId: 'attempt-1', journeyTaskId: task.id, songId: song.id, profile,
    songContentKey: achievementContentKey(song), scopeComplete: true, completed: true, mode: task.mode, hands: task.hands,
    speed: task.speed, transpose: 0, start: task.start, end: task.end, seconds: (task.end - task.start) / task.speed,
    hits: count, missed: 0, errors: 0, expectedNotes: count, accuracy: 100, date: '2026-10-22T12:00:00Z', ...extra };
}
function success(song, state, id = '1') { return evaluateJourneyAttempt(song, state, attempt(song, state, { id, attemptId: id }), { profile }); }
function reachGoal(song, state) { let result; for (let i = 0; i < 3; i++) { result = success(song, state, `goal-${i}`); state = result.state; } return result; }

test('a first mission explains a real pattern, chosen hand, reduced tempo and measurable goal', () => {
  const song = fixture(), before = JSON.stringify(song), journey = buildLearningJourney(song, { profile });
  assert.equal(journey.task.start, 0); assert.equal(journey.task.end, 8);
  assert.equal(journey.task.hands, 'right'); assert.equal(journey.task.mode, 'melody'); assert.equal(journey.task.speed, .6);
  assert.equal(journey.task.repeatCount, 3); assert.equal(journey.task.targetAccuracy, 90); assert.equal(journey.task.targetStreak, 3);
  assert.equal(journey.task.occurrences.length, 2); assert.match(journey.task.reason, /reaparece em 2 frases/);
  assert.match(journey.task.instruction, /3 execuções consecutivas/); assert.match(journey.nextActionLabel, /Começar/);
  assert.equal(journey.suggestedStructure, false); assert.equal(journey.resumable, false); assert.equal(journey.progress.value, 0);
  assert.equal(JSON.stringify(song), before);
});

test('opening a song without a saved analysis produces a revisable suggestion without blocking practice', () => {
  const song = fixture(); delete song.phrasing;
  const journey = buildLearningJourney(song, { profile });
  assert.ok(journey.task); assert.equal(journey.suggestedStructure, true); assert.equal(journey.task.suggestedStructure, true);
  assert.ok(journey.task.end - journey.task.start <= 20); assert.equal(song.phrasing, undefined);
  assert.deepEqual(buildLearningJourney(song, { profile }), journey);
});

test('long musical phrases become small bar-aligned exercises without changing reviewed cuts', () => {
  const song = fixture(); song.duration = 240;
  song.notes = Array.from({ length: 240 }, (_, time) => ({ id: `n${time}`, time, midi: 64 + time % 4, duration: .5 }));
  song.phrasing.phrases = [{ id: 'long', name: 'Frase longa', start: 0, end: 240, patternId: 'a' }];
  const journey = buildLearningJourney(song, { profile });
  assert.equal(journey.task.end, 8); assert.match(journey.task.title, /parte 1/);
  assert.equal(song.phrasing.phrases[0].end, 240);
});

test('a long silent opening does not create a four-minute mission or an empty exercise', () => {
  const song = { id: 'late', duration: 240, tempo: 120, notes: [{ midi: 64, time: 180, duration: .5 }] };
  const journey = buildLearningJourney(song, { profile });
  assert.ok(journey.task.start >= 176); assert.ok(journey.task.end <= 200); assert.equal(journey.task.noteCount, 1);
});

test('empty and malformed arrangements have an honest unavailable progress and no mission', () => {
  for (const song of [{}, { id: 'empty', duration: 10, notes: [] }, { id: 'invalid', duration: -3, notes: [{ time: 0, midi: 64 }] }]) {
    const journey = buildLearningJourney(song, { profile }); assert.equal(journey.task, null); assert.equal(journey.progress.value, null);
  }
});

test('starting and pausing preserve the exact exercise, hand, range, tempo and partial position', () => {
  const song = fixture(), state = withTask(song, { start: 8, end: 16, phraseId: 'a2', mode: 'rhythm', hands: 'left', speed: .8 });
  Object.assign(state, { started: true, startedAt: '2026-10-22T12:00:00Z', updatedAt: '2026-10-22T12:01:00Z', position: 11 });
  const restored = buildLearningJourney(song, { profile, state: JSON.parse(JSON.stringify(state)) });
  assert.equal(restored.resumable, true); assert.equal(restored.task.id, state.task.id); assert.equal(restored.task.speed, .8);
  assert.equal(restored.task.hands, 'left'); assert.equal(restored.task.start, 8); assert.equal(restored.state.position, 11);
  assert.equal(Date.parse(restored.state.startedAt), Date.parse(state.startedAt)); assert.match(restored.nextActionLabel, /Continuar/);
});

test('other profiles, songs, note edits and hand reassignment invalidate the stored cursor', () => {
  const song = fixture(), state = withTask(song, { start: 8, end: 16 }); state.started = true; state.streak = 2;
  for (const piece of [{ ...song, id: 'other' }, { ...song, notes: song.notes.map((note, i) => i ? note : { ...note, midi: 65 }) }, { ...song, configs: { 0: { hand: 'left' } } }]) {
    const restored = buildLearningJourney(piece, { profile, state }); assert.equal(restored.streak, 0); assert.equal(restored.resumable, false); assert.equal(restored.state.lastAttemptId, '');
  }
  assert.equal(buildLearningJourney(song, { profile: 'Bia', state }).resumable, false);
  assert.equal(buildLearningJourney({ ...song, title: 'Novo nome' }, { profile, state }).resumable, true);
});

test('first and second successes keep the chosen mission; the third suggests a ten-point tempo step', () => {
  const song = fixture(); let state = initial(song);
  for (let i = 1; i <= 3; i++) {
    const result = success(song, state, `success-${i}`);
    assert.equal(result.streak, i); assert.equal(result.goalMet, i === 3);
    if (i < 3) { assert.equal(result.state.task.speed, .6); assert.equal(result.state.streak, i); }
    else { assert.equal(result.nextTask.speed, .7); assert.equal(result.state.task.speed, .7); assert.equal(result.state.streak, 0); assert.equal(result.task.speed, .6); assert.match(result.actionLabel, /70%/); }
    state = result.state;
  }
});

test('one failed complete attempt resets consecutive successes even when a claimed accuracy is inflated', () => {
  const song = fixture(), first = success(song, initial(song));
  const failed = evaluateJourneyAttempt(song, first.state, attempt(song, first.state, { attemptId: 'failed', errors: 1, accuracy: 100 }), { profile });
  assert.equal(failed.qualified, true); assert.equal(failed.streak, 0); assert.equal(failed.goalMet, false); assert.equal(failed.state.lastAccuracy, 80);
  assert.equal(success(song, failed.state, 'after-fail').streak, 1);
});

test('poor performance offers a slower review without automatically changing the selected task', () => {
  const song = fixture(), state = initial(song);
  const result = evaluateJourneyAttempt(song, state, attempt(song, state, { errors: 4 }), { profile });
  assert.equal(result.state.task.speed, .6); assert.equal(result.nextTask.speed, .5); assert.equal(result.streak, 0);
  assert.match(result.actionLabel, /50%/); assert.match(result.summary, /só muda quando/);
  const lower = withTask(song, { speed: .4 });
  assert.equal(evaluateJourneyAttempt(song, lower, attempt(song, lower, { errors: 4 }), { profile }).nextTask.speed, .4);
});

test('recital failures recommend rhythm review rather than claiming a recital at a slower tempo', () => {
  const song = fixture(), state = withTask(song, { mode: 'recital', hands: 'both' });
  const result = evaluateJourneyAttempt(song, state, attempt(song, state, { errors: 8 }), { profile });
  assert.equal(result.state.task.mode, 'recital'); assert.equal(result.nextTask.mode, 'rhythm'); assert.equal(result.nextTask.speed, .9);
});

test('finishing one hand at full tempo moves to the other actual hand, then both hands', () => {
  const song = fixture();
  const right = reachGoal(song, withTask(song, { hands: 'right', speed: 1 }));
  assert.equal(right.nextTask.hands, 'left'); assert.equal(right.nextTask.speed, .6); assert.equal(right.nextTask.start, 0);
  const left = reachGoal(song, withTask(song, { hands: 'left', speed: 1 }));
  assert.equal(left.nextTask.hands, 'both'); assert.equal(left.nextTask.speed, .6);
  const both = reachGoal(song, withTask(song, { hands: 'both', speed: 1 }));
  assert.equal(both.nextTask.start, 8); assert.equal(both.nextTask.phraseId, 'a2'); assert.match(both.actionLabel, /reaparição/);
  assert.match(both.nextTask.title, /retorno/);
});

test('one-handed arrangements skip empty hand exercises and keep only available paths', () => {
  const song = fixture(); song.configs = { 0: { hand: 'left' } };
  const state = initial(song); assert.equal(state.task.hands, 'left');
  assert.equal(createJourneyTask(song, { hands: 'right' }), null);
  const result = reachGoal(song, withTask(song, { hands: 'left', speed: 1 }));
  assert.equal(result.nextTask.start, 8); assert.equal(result.nextTask.hands, 'left');
});

test('melody moves to rhythm, then recital; only actual completion advances the route', () => {
  const song = fixture();
  const melody = reachGoal(song, withTask(song, { start: 8, end: 16, phraseId: 'a2', mode: 'melody', hands: 'both', speed: 1 }));
  assert.equal(melody.nextTask.mode, 'rhythm'); assert.equal(melody.nextTask.start, 0); assert.equal(melody.nextTask.speed, .9);
  const rhythm = reachGoal(song, withTask(song, { start: 8, end: 16, phraseId: 'a2', mode: 'rhythm', hands: 'both', speed: 1 }));
  assert.equal(rhythm.nextTask.mode, 'recital'); assert.equal(rhythm.nextTask.speed, 1);
  const recital = reachGoal(song, withTask(song, { start: 8, end: 16, phraseId: 'a2', mode: 'recital', hands: 'both', speed: 1 }));
  assert.equal(recital.state.completed, true); assert.match(recital.summary, /Ciclo de estudo/);
  assert.equal(buildLearningJourney(song, { profile, state: recital.state }).progress.value, 0);
});

test('partial, preview, stale and changed-configuration attempts never change a streak', () => {
  const song = fixture(), state = success(song, initial(song)).state;
  const invalids = [{ completed: false }, { scopeComplete: false }, { scopeComplete: undefined }, { mode: 'listen' }, { mode: 'rhythm' },
    { hands: 'both' }, { speed: .7 }, { transpose: 12 }, { transpose: undefined }, { start: .1 }, { end: 7.9 },
    { songId: 'other' }, { profile: 'Bia' }, { songContentKey: 'stale' }, { songContentKey: undefined }, { journeyTaskId: 'other-task' },
    { seconds: .01 }, { hits: 1 }, { expectedNotes: 100 }, { errors: -1 }, { missed: .1 }, { attemptId: '', id: '' }];
  for (const extra of invalids) {
    const result = evaluateJourneyAttempt(song, state, attempt(song, state, { attemptId: 'invalid', ...extra }), { profile });
    assert.equal(result.qualified, false, JSON.stringify(extra)); assert.equal(result.changed, false); assert.equal(result.state.streak, 1); assert.deepEqual(result.state, state);
  }
});

test('duplicates are idempotent before and after restoring state and changing a task', () => {
  const song = fixture(), original = initial(song), row = attempt(song, original);
  const first = evaluateJourneyAttempt(song, original, row, { profile });
  const restored = JSON.parse(JSON.stringify(first.state));
  const duplicate = evaluateJourneyAttempt(song, restored, row, { profile });
  assert.equal(duplicate.changed, false); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.state.streak, 1);
  const goal = reachGoal(song, original), stale = evaluateJourneyAttempt(song, goal.state, row, { profile });
  assert.equal(stale.changed, false); assert.equal(stale.state.task.speed, .7); assert.equal(stale.state.streak, 0);
});

test('a stale state cannot evaluate a current attempt even if the notes happen to match its default mission', () => {
  const song = fixture(), state = initial(song), row = attempt(song, state);
  for (const changed of [{ ...state, contentKey: 'old' }, { ...state, profile: 'Bia' }, { ...state, songId: 'other' }, null]) {
    const result = evaluateJourneyAttempt(song, changed, row, { profile });
    assert.equal(result.qualified, false); assert.equal(result.changed, false); assert.equal(result.state.streak, 0);
  }
});

test('all missed notes are a legitimate failed completion and reset the sequence', () => {
  const song = fixture(), state = success(song, initial(song)).state;
  const result = evaluateJourneyAttempt(song, state, attempt(song, state, { attemptId: 'miss-all', hits: 0, missed: 4 }), { profile });
  assert.equal(result.qualified, true); assert.equal(result.streak, 0); assert.equal(result.state.lastAccuracy, 0);
});

test('a different selected task resets a stored streak without erasing deduplication or past goals', () => {
  const song = fixture(), state = success(song, initial(song)).state;
  const selected = normalizeJourneyState({ ...state, task: createJourneyTask(song, { ...state.task, hands: 'left' }), streak: 2 }, song, { profile });
  // Callers explicitly reset a streak when selecting a task; a copied old id is rejected.
  const forged = normalizeJourneyState({ ...state, task: { ...state.task, hands: 'left' }, streak: 2 }, song, { profile });
  assert.equal(forged.streak, 0); assert.equal(selected.task.hands, 'left'); assert.deepEqual(selected.seenAttemptIds, state.seenAttemptIds);
});

test('the primary percentage includes guided points immediately and never grants points from the cursor', () => {
  const song = fixture(), state = withTask(song, { hands: 'both', start: 0, end: 16 });
  const evaluated = evaluateAchievementAttempt(song, null, attempt(song, state), { profile });
  assert.equal(evaluated.summary.totalPoints, 100); assert.equal(evaluated.summary.maxPoints, 900);
  const journey = buildLearningJourney(song, { profile, achievements: evaluated.summary, state });
  assert.equal(journey.progress.value, 11); assert.equal(journey.progress.label, 'Progresso de estudo'); assert.match(journey.progress.detail, /avaliação técnica recente/);
  const cursorOnly = reachGoal(song, initial(song));
  assert.equal(buildLearningJourney(song, { profile, state: cursorOnly.state }).progress.value, 0);
});

test('foreign achievement summaries cannot appear as progress on the current profile or arrangement', () => {
  const song = fixture(), summary = summarizeAchievements(song, [], { profile });
  assert.equal(learningProgress(song, { profile, achievements: { ...summary, totalPoints: 900, profile: 'Bia' } }).value, 0);
  assert.equal(learningProgress(song, { profile, achievements: { ...summary, totalPoints: 900, contentKey: 'old' } }).value, 0);
});

test('manual path selection retains a chosen practice range and comfortable speed', () => {
  const song = fixture(), previous = createJourneyTask(song, { start: 8, end: 16, phraseId: 'a2', speed: .7 });
  const rhythm = createJourneyTask(song, { ...previous, mode: 'rhythm', hands: 'both' });
  assert.equal(rhythm.start, 8); assert.equal(rhythm.end, 16); assert.equal(rhythm.speed, .7); assert.equal(rhythm.mode, 'rhythm');
  assert.equal(createJourneyTask(song, { ...previous, mode: 'recital', speed: .5 }).speed, 1);
  assert.equal(createJourneyTask(song, { mode: 'rhythm' }).speed, .9);
});

test('all returned state and task data survive a plain JSON backup without executable values', () => {
  const song = fixture(), journey = buildLearningJourney(song, { profile });
  const restored = JSON.parse(JSON.stringify(journey)); assert.deepEqual(restored, journey);
  assert.deepEqual(normalizeJourneyState(restored.state, song, { profile }), journey.state);
  assert.ok(journey.task.id.length < 180); assert.equal(journey.task.guided, true);
});

test('a new route prioritizes a real recurring error location and the implicated hand', () => {
  const song = fixture(), state = withTask(song, { hands: 'left', start: 8, end: 16, phraseId: 'a2' });
  const history = [1, 2].map(i => attempt(song, state, { id: `error-${i}`, attemptId: `error-${i}`, practiceSessionId: `session-${i}`,
    completed: false, errorEvents: [{ time: 9, reason: 'wrong-note', count: 1, expectedPitches: [49] }] }));
  const journey = buildLearningJourney(song, { profile, history });
  assert.equal(journey.task.start, 8); assert.equal(journey.task.end, 16); assert.equal(journey.task.hands, 'left');
  assert.equal(journey.task.mode, 'melody'); assert.equal(journey.task.speed, .6); assert.match(journey.task.reason, /2 sessão/);
  assert.match(journey.task.title, /Revisar/); assert.equal(journey.streak, 0); assert.equal(journey.resumable, false);
  assert.equal(journey.progress.value, 0); // error events do not grant points
});

test('a saved active cursor prevails over a new error recommendation', () => {
  const song = fixture(), state = initial(song); state.started = true;
  const other = withTask(song, { start: 8, end: 16, phraseId: 'a2' });
  const history = [attempt(song, other, { errorEvents: [{ time: 10, reason: 'wrong-note' }] })];
  const journey = buildLearningJourney(song, { profile, history, state });
  assert.equal(journey.task.id, state.task.id); assert.equal(journey.task.start, 0); assert.equal(journey.resumable, true);
});

test('legacy, foreign and fabricated out-of-range error locations do not redirect a mission', () => {
  const song = fixture(), state = withTask(song, { start: 8, end: 16, phraseId: 'a2' });
  const row = attempt(song, state, { errorEvents: [{ time: 9, reason: 'wrong-note' }] });
  for (const extra of [{ songContentKey: undefined }, { songContentKey: 'old' }, { profile: 'Bia' }, { songId: 'other' }, { date: 'invalid' },
    { errorEvents: [{ time: 900, reason: 'wrong-note' }] }, { errorEvents: [{ time: 9, reason: 'unknown' }] }]) {
    assert.equal(buildLearningJourney(song, { profile, history: [{ ...row, ...extra }] }).task.start, 0, JSON.stringify(extra));
  }
});

test('error recurrence across sessions takes priority over many repeats of one dense failed attempt', () => {
  const song = fixture(), state = initial(song);
  const history = [attempt(song, state, { attemptId: 'dense', practiceSessionId: 'one', errorEvents: [{ time: 2, reason: 'wrong-note', count: 100 }] }),
    ...[1, 2].map(i => attempt(song, state, { attemptId: `spread-${i}`, practiceSessionId: `spread-${i}`, errorEvents: [{ time: 10, reason: 'wrong-note', count: 1, expectedPitches: [66] }] }))];
  assert.equal(buildLearningJourney(song, { profile, history }).task.start, 8);
});
