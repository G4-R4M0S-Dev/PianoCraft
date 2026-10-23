import test from 'node:test';
import assert from 'node:assert/strict';
import { PracticeSession, handOf } from '../src/music/practice.js';

const note = (id, midi, time = 1, extra = {}) => ({ id, midi, time, track: 0, ...extra });
const chord = () => [note(1, 60), note(2, 64), note(3, 67)];
const press = (session, midi, ms, time = 1, source) => session.input(midi, time, 0, ms, source);
const lift = (session, midi, ms, time = 1, source, options) => session.release(midi, time, 0, ms, source, options);

test('melody commits a complete physically held chord atomically within 120 ms', () => {
  const s = new PracticeSession([...chord(), note(4, 48, 2)], { mode: 'melody' });
  assert.equal(s.gate(3), 1);
  assert.equal(press(s, 60, 1000), null);
  assert.equal(s.lastResult.status, 'pending');
  assert.deepEqual(s.lastResult.pendingPitches, [64, 67]);
  assert.equal(s.hits.size, 0);
  assert.equal(s.gate(3), 1);
  press(s, 64, 1040);
  assert.equal(s.hits.size, 0);
  assert.equal(press(s, 67, 1080).id, 3);
  assert.equal(s.lastResult.status, 'accepted');
  assert.deepEqual(s.lastResult.notes.map(n => n.id), [1, 2, 3]);
  assert.equal(s.lastResult.spreadMs, 80);
  assert.equal(s.gate(3), 2);
  assert.equal(s.hits.size, 3);
  assert.equal(s.errors, 0);
  assert.equal(s.accuracy, 100);
});

test('notes separated by 500 ms never count as a chord while melody time is frozen', () => {
  const s = new PracticeSession(chord(), { mode: 'melody' });
  press(s, 60, 0); press(s, 64, 500); press(s, 67, 1000);
  assert.equal(s.hits.size, 0);
  assert.equal(s.errors, 2);
  assert.equal(s.gate(10), 1);
  assert.equal(s.complete, false);
  assert.equal(s.accuracy, 0);
});

test('advance expires an attempt using real time even with a frozen musical clock', () => {
  const s = new PracticeSession(chord(), { mode: 'melody' });
  press(s, 60, 1000);
  s.advance(1, 1121);
  assert.equal(s.lastResult.reason, 'chord-timeout');
  assert.equal(s.attempt, null);
  assert.equal(s.errors, 1);
  s.advance(1, 2000);
  assert.equal(s.errors, 1, 'a failed attempt is penalized only once');
  press(s, 64, 2000); press(s, 67, 2040);
  assert.equal(s.hits.size, 0, 'the old C is still down but belongs to an expired attempt');
});

test('queued MIDI timestamps preserve the original spread after the scheduler has advanced', () => {
  for (const times of [[1000, 1500, 2000], [2000, 1000, 1500]]) {
    const s = new PracticeSession(chord(), { mode: 'melody' });
    s.advance(1, 2000);
    for (const [index, midi] of [60, 64, 67].entries()) press(s, midi, times[index]);
    assert.equal(s.hits.size, 0, `separated timestamps ${times} must not collapse to processing time`);
    assert.equal(s.wallTimeMs, 2000, 'the hold clock must remain monotonic');
  }
  for (const times of [[1000, 1040, 1080], [1040, 1000, 1080]]) {
    const s = new PracticeSession(chord(), { mode: 'melody' });
    s.advance(1, 2000);
    for (const [index, midi] of [60, 64, 67].entries()) press(s, midi, times[index]);
    assert.equal(s.hits.size, 3, `a genuine queued 80 ms chord ${times} stays valid`);
    assert.equal(s.lastResult.spreadMs, 80);
    assert.equal(s.errors, 0);
    assert.equal(s.wallTimeMs, 2000);
  }
});

test('a failed chord requires a new attack for every key and supports a clean retry', () => {
  const s = new PracticeSession(chord(), { mode: 'melody' });
  press(s, 60, 0); press(s, 64, 500); press(s, 67, 540);
  assert.equal(press(s, 60, 560), null);
  assert.equal(s.lastResult.status, 'duplicate');
  assert.equal(s.hits.size, 0);
  for (const midi of [60, 64, 67]) lift(s, midi, 600);
  press(s, 60, 700); press(s, 64, 740); press(s, 67, 780);
  assert.equal(s.hits.size, 3);
  assert.equal(s.complete, true);
});

test('releasing a key before completing the chord invalidates the attempt even with sustain', () => {
  const s = new PracticeSession(chord(), { mode: 'melody' });
  press(s, 60, 0);
  assert.equal(lift(s, 60, 20, 1, undefined, { sustain: true }).reason, 'released-before-chord');
  press(s, 64, 40); press(s, 67, 80);
  assert.equal(s.hits.size, 0);
  assert.equal(s.errors, 1);
  // C has a new physical attack; E and G were attacked after the failed attempt.
  press(s, 60, 100);
  assert.equal(s.hits.size, 3);
});

test('the chord window is configurable and includes its exact boundary', () => {
  for (const [spread, accepted] of [[60, true], [60.1, false]]) {
    const s = new PracticeSession(chord(), { mode: 'melody', chordWindowMs: 60 });
    press(s, 60, 0); press(s, 64, 20); press(s, 67, spread);
    assert.equal(s.hits.size, accepted ? 3 : 0);
  }
});

test('successive onsets cannot be anticipated to complete the current chord', () => {
  for (const mode of ['melody', 'rhythm', 'recital']) {
    const s = new PracticeSession([note(1, 60), note(2, 64), note(3, 67, 1.05)], { mode });
    press(s, 60, 0);
    assert.equal(press(s, 67, 20), null);
    assert.equal(s.lastResult.reason, 'wrong-note');
    assert.equal(s.hits.size, 0);
    press(s, 64, 40);
    assert.deepEqual([...s.hits], [1, 2]);
    assert.equal(s.next().id, 3);
    assert.equal(press(s, 67, 50, 1.05), null, 'the future key was already held and needs a reattack');
    lift(s, 67, 60, 1.05);
    assert.equal(press(s, 67, 70, 1.05).id, 3);
    assert.equal(s.complete, true);
  }
});

test('nearby distinct onsets stay separate while float noise in a single onset is tolerated', () => {
  const s = new PracticeSession([note(1, 60), note(2, 64, 1 + 1e-10), note(3, 67, 1.0005)], { mode: 'melody' });
  press(s, 60, 0); press(s, 64, 30);
  assert.deepEqual([...s.hits], [1, 2]);
  assert.equal(s.next().id, 3);
});

test('a repeated pitch needs a new physical attack, not another note-on while held', () => {
  const s = new PracticeSession([note(1, 60), note(2, 60, 1.1)], { mode: 'melody' });
  assert.equal(press(s, 60, 0).id, 1);
  assert.equal(press(s, 60, 100, 1.1), null);
  assert.equal(s.hits.size, 1);
  assert.equal(s.errors, 0);
  lift(s, 60, 120, 1.1);
  assert.equal(press(s, 60, 140, 1.1).id, 2);
});

test('one physical key satisfies simultaneous unisons, only when the whole chord completes', () => {
  for (const mode of ['melody', 'rhythm']) {
    const s = new PracticeSession([note(1, 60), note(2, 60, 1, { track: 1 }), note(3, 64), note(4, 60, 1.1)], { mode });
    press(s, 60, 0);
    assert.equal(s.hits.size, 0);
    press(s, 64, 40);
    assert.deepEqual([...s.hits], [1, 2, 3]);
    assert.equal(s.next().id, 4);
    lift(s, 60, 80);
    press(s, 60, 100, 1.1);
    assert.equal(s.complete, true);
  }
});

test('rhythm and recital require both onset tolerance and the real chord window', () => {
  for (const mode of ['rhythm', 'recital']) {
    const early = new PracticeSession(chord(), { mode });
    assert.equal(press(early, 60, 0, .749), null);
    assert.equal(early.lastResult.reason, 'outside-onset-window');
    assert.equal(early.errors, 1);
    const inside = new PracticeSession(chord(), { mode });
    press(inside, 60, 0, .8); press(inside, 64, 40, .84); press(inside, 67, 80, .88);
    assert.equal(inside.hits.size, 3);
    const slow = new PracticeSession(chord(), { mode });
    press(slow, 60, 0, 1); press(slow, 64, 100, 1.05); press(slow, 67, 160, 1.1);
    assert.equal(slow.hits.size, 0, 'music time alone cannot hide a slow rolled chord');
    const late = new PracticeSession(chord(), { mode });
    press(late, 60, 0, 1.251);
    assert.equal(late.missed.size, 3);
    assert.equal(late.hits.size, 0);
  }
});

test('rhythm marks every note of an incomplete chord missed once, without partial credit', () => {
  const s = new PracticeSession([...chord(), note(4, 48, 2)], { mode: 'rhythm' });
  press(s, 60, 0);
  s.advance(1.26, 100); s.advance(1.3, 110);
  assert.equal(s.hits.size, 0);
  assert.deepEqual([...s.missed], [1, 2, 3]);
  assert.equal(s.lastResult.status, 'missed');
  assert.equal(s.lastResult.reason, 'onset-missed');
  assert.equal(s.errors, 0);
  assert.equal(s.next().id, 4);
  s.advance(4, 200); s.advance(4, 300);
  assert.equal(s.missed.size, 4);
});

test('custom onset tolerance is applied to misses and early input consistently', () => {
  const s = new PracticeSession([note(1, 60)], { mode: 'rhythm', onsetTolerance: .08 });
  press(s, 60, 0, .91);
  assert.equal(s.errors, 1);
  s.advance(1.08, 100);
  assert.equal(s.missed.size, 0);
  s.advance(1.081, 101);
  assert.equal(s.missed.size, 1);
});

test('practice preserves hand overrides, role filtering, seek range and transposition', () => {
  const configs = { 0: { role: 'learn', hand: 'right' }, 1: { role: 'auto', hand: 'left' } };
  const notes = [note(1, 60), note(2, 64), note(3, 48, 2, { track: 1 }), note(4, 67, 3)];
  const s = new PracticeSession(notes, { mode: 'melody', hands: 'right', configs, start: 1.5, end: 4 });
  assert.equal(s.notes.length, 1);
  assert.equal(s.input(69, 3, 2, 0).id, 4);
  assert.equal(handOf({ ...notes[0], hand: 'left' }, configs), 'left');
  assert.equal(handOf(note(5, 48)), 'left');
});

test('gating sorts custom notes without mutating the song or crossing a seek boundary', () => {
  const unsorted = [note(1, 67, 3), note(2, 60, 1), note(3, 64, 2)];
  const s = new PracticeSession(unsorted, { mode: 'melody' });
  assert.equal(s.gate(4), 1);
  assert.equal(unsorted[0].time, 3);
  const sought = new PracticeSession(unsorted, { mode: 'melody', start: 1.0005 });
  assert.equal(sought.gate(1.01), 1.01);
  assert.equal(sought.next().id, 3);
});

test('duration is checked centrally using real hold time when melody transport is frozen', () => {
  const s = new PracticeSession([note(1, 60, 1, { keyDuration: 1, duration: 4 }), note(2, 64, 1.1)], { mode: 'melody' });
  press(s, 60, 1000);
  assert.equal(s.gate(10), 1.1);
  const result = lift(s, 60, 1500, 1.1);
  assert.equal(result.reason, 'duration-complete');
  assert.equal(s.errors, 0);
  assert.equal(s.hits.size, 1);
  const tooShort = new PracticeSession([note(1, 60, 1, { keyDuration: 1 })], { mode: 'melody' });
  press(tooShort, 60, 0);
  assert.equal(lift(tooShort, 60, 100).reason, 'released-too-early');
  assert.equal(tooShort.errors, 1);
  assert.equal(tooShort.durationErrors, 1);
  lift(tooShort, 60, 200);
  assert.equal(tooShort.errors, 1, 'duplicate note-off cannot penalize twice');
});

test('duration uses the longest physical unison and reports its representative', () => {
  const s = new PracticeSession([
    note(1, 60, 0, { duration: 4, keyDuration: .5 }),
    note(2, 60, 0, { duration: 2, keyDuration: 1.5, track: 1 }),
  ], { mode: 'melody' });
  assert.equal(press(s, 60, 0, 0).id, 2);
  assert.equal(s.hits.size, 2);
  lift(s, 60, 500, 0);
  assert.equal(s.errors, 1);
});

test('queued note-offs evaluate original physical hold duration without clock collapse', () => {
  for (const [releaseAt, errors] of [[1800, 0], [1100, 1]]) {
    const s = new PracticeSession([note(1, 60, 1, { keyDuration: 1 })], { mode: 'melody' });
    s.advance(1, 2000);
    press(s, 60, 1000);
    lift(s, 60, releaseAt);
    assert.equal(s.errors, errors);
    assert.equal(s.wallTimeMs, 2000);
  }
});

test('queued duration integrates original event timestamps across playback speed changes', () => {
  const s = new PracticeSession([note(1, 60, 1, { keyDuration: 1 })], { mode: 'melody' });
  s.setSpeed(.5, 1500);
  s.advance(1, 2500);
  press(s, 60, 1000);
  const result = lift(s, 60, 2000);
  assert.equal(result.heldSeconds, .75, '500 ms at 1x and 500 ms at .5x');
  assert.equal(s.errors, 0);

  const short = new PracticeSession([note(1, 60, 1, { keyDuration: 1 })], { mode: 'melody' });
  press(short, 60, 1000);
  short.setSpeed(.5, 1100);
  assert.ok(Math.abs(lift(short, 60, 1500).heldSeconds - .3) < 1e-9);
  assert.equal(short.errors, 1, 'the initial 1x speed must not be applied to the entire hold');
});

test('sustain does not excuse physical key duration, or synthesize chord simultaneity', () => {
  const physical = new PracticeSession([note(1, 60, 1, { keyDuration: 1, duration: 4 })], { mode: 'melody' });
  press(physical, 60, 0);
  lift(physical, 60, 50, 1, undefined, { sustain: true });
  assert.equal(physical.errors, 1);
  const acoustic = new PracticeSession([note(1, 60, 1, { duration: 1 })], { mode: 'melody' });
  press(acoustic, 60, 0);
  lift(acoustic, 60, 50, 1, undefined, { sustain: true });
  assert.equal(acoustic.errors, 0, 'without keyDuration, pedal carries a pending acoustic duration');
  assert.equal(acoustic.lastResult.durationPending, true);
  acoustic.setSustain('channel:0', false, 60);
  assert.equal(acoustic.errors, 1, 'releasing the pedal too soon must finish duration evaluation');
});

test('fallback duration requires the pedal to stay down for the remaining expected hold', () => {
  for (const [pedalUpMs, errors] of [[1100, 1], [2100, 0]]) {
    const s = new PracticeSession([note(1, 60, 1, { duration: 2 })], { mode: 'melody' });
    s.setSustain('channel:0', true, 990);
    press(s, 60, 1000);
    const release = lift(s, 60, 1050, 1, undefined, { sustain: true, pedalKey: 'channel:0' });
    assert.equal(release.durationPending, true);
    assert.equal(s.errors, 0);
    const result = s.setSustain('channel:0', false, pedalUpMs);
    assert.equal(s.errors, errors);
    assert.equal(result.durationErrorsAdded, errors);
    assert.equal(s.pendingPedals.size, 0);
    s.setSustain('channel:0', false, pedalUpMs + 10);
    assert.equal(s.errors, errors, 'repeated pedal-up does not charge again');
  }
});

test('pedal duration obligations are isolated by channel and preserve original timestamps', () => {
  const s = new PracticeSession([note(1, 60, 1, { duration: 2 }), note(2, 64, 1, { duration: 2 })], { mode: 'melody' });
  s.advance(1, 4000);
  s.setSustain('channel:0', true, 990); s.setSustain('channel:1', true, 990);
  press(s, 60, 1000); press(s, 64, 1040);
  lift(s, 60, 1050, 1, undefined, { sustain: true, pedalKey: 'channel:0' });
  lift(s, 64, 1090, 1, undefined, { sustain: true, pedalKey: 'channel:1' });
  s.setSustain('channel:0', false, 1100);
  assert.equal(s.errors, 1);
  assert.equal(s.pendingPedals.has('channel:1'), true);
  s.setSustain('channel:1', false, 2200);
  assert.equal(s.errors, 1, 'the other channel had enough acoustic duration');
  assert.equal(s.wallTimeMs, 4000, 'queued pedal timestamps do not rewind the processing clock');
});

test('pending pedal duration integrates speed changes and is cancelled by pause cleanup', () => {
  const s = new PracticeSession([note(1, 60, 1, { duration: 2 })], { mode: 'melody' });
  press(s, 60, 1000);
  lift(s, 60, 1050, 1, undefined, { sustain: true });
  s.setSpeed(.5, 1500);
  s.setSustain('channel:0', false, 2200); // .5 + .35 = .85, below 1.08
  assert.equal(s.errors, 1);
  const clean = new PracticeSession([note(1, 60, 1, { duration: 2 })], { mode: 'melody' });
  press(clean, 60, 1000);
  lift(clean, 60, 1050, 1, undefined, { sustain: true });
  clean.clearInput('pause');
  clean.setSustain('channel:0', false, 1100);
  assert.equal(clean.errors, 0);
  assert.equal(clean.pendingPedals.size, 0);
});

test('physical key duration is penalized immediately and a mixed unison is not charged twice', () => {
  const s = new PracticeSession([note(1, 60, 1, { keyDuration: 1, duration: 2 }), note(2, 60, 1, { duration: 2 })], { mode: 'melody' });
  press(s, 60, 1000);
  lift(s, 60, 1050, 1, undefined, { sustain: true });
  assert.equal(s.errors, 1);
  const result = s.setSustain('channel:0', false, 1100);
  assert.equal(s.errors, 1);
  assert.equal(s.durationErrors, 1);
  assert.equal(result.reason, 'released-too-early');
  assert.equal(result.durationErrorsAdded, 0);
});

test('hold duration follows playback speed, including changes while a key is down', () => {
  const s = new PracticeSession([note(1, 60, 1, { keyDuration: 1 })], { mode: 'melody', speed: .5 });
  press(s, 60, 0);
  s.setSpeed(1, 400); // .2 song seconds held
  lift(s, 60, 700); // +.3 = .5 seconds, over .48 threshold
  assert.equal(s.errors, 0);
  const tooShort = new PracticeSession([note(1, 60, 1, { keyDuration: 1 })], { mode: 'melody', speed: .5 });
  press(tooShort, 60, 0); lift(tooShort, 60, 500);
  assert.equal(tooShort.errors, 1);
});

test('pause cleanup cancels attempts and duration obligations without false errors', () => {
  const s = new PracticeSession(chord(), { mode: 'melody' });
  press(s, 60, 0); s.clearInput('pause');
  assert.equal(s.held.size, 0);
  assert.equal(s.errors, 0);
  lift(s, 60, 1000);
  press(s, 60, 1100); press(s, 64, 1140); press(s, 67, 1180);
  assert.equal(s.hits.size, 3);
  const held = new PracticeSession([note(1, 60, 1, { keyDuration: 2 })], { mode: 'melody' });
  press(held, 60, 0); held.clearInput('seek'); lift(held, 60, 20);
  assert.equal(held.errors, 0);
});

test('PC and physical keyboards retain source identity for attacks and releases', () => {
  const s = new PracticeSession(chord(), { mode: 'melody' });
  press(s, 60, 0, 1, 'midi:device-A:0:60');
  lift(s, 60, 10, 1, 'computer:60'); // unrelated note-off
  assert.equal(s.attempt !== null, true);
  press(s, 64, 40, 1, 'computer:64');
  press(s, 67, 80, 1, 'midi:device-B:0:67');
  assert.equal(s.hits.size, 3);
  lift(s, 60, 90, 1, 'computer:60');
  assert.equal(s.held.has('midi:device-A:0:60'), true);
});

test('simultaneous duplicate sources do not fabricate a repeated pitch or release each other', () => {
  const s = new PracticeSession([note(1, 60), note(2, 64), note(3, 60, 1.1)], { mode: 'melody' });
  press(s, 60, 0, 1, 'physical:60');
  press(s, 60, 10, 1, 'computer:60');
  lift(s, 60, 20, 1, 'physical:60');
  press(s, 64, 40, 1, 'computer:64');
  assert.equal(s.hits.size, 2, 'the computer C remains physically down');
  press(s, 60, 100, 1.1, 'computer:60');
  assert.equal(s.hits.size, 2);
  lift(s, 60, 110, 1.1, 'computer:60');
  press(s, 60, 120, 1.1, 'computer:60');
  assert.equal(s.hits.size, 3);
});

test('listen mode does not score inputs and an empty session is complete', () => {
  const s = new PracticeSession(chord(), { mode: 'listen' });
  press(s, 99, 0); lift(s, 99, 10); s.advance(100, 1000);
  assert.equal(s.errors, 0);
  assert.equal(s.accuracy, null);
  assert.equal(s.complete, true);
  assert.equal(s.gate(2), 2);
});
