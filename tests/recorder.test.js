import test from 'node:test';
import assert from 'node:assert/strict';
import { Recorder } from '../src/music/recorder.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);
function setup(maxTracks) {
  let now = 10_000;
  return { recorder: new Recorder(maxTracks ? { maxTracks } : {}), clock: () => now, at: milliseconds => { now = milliseconds; } };
}

test('recorder captures a take from zero and closes keys still held at stop', () => {
  const { recorder, clock, at } = setup();
  assert.equal(recorder.recording, false);
  assert.equal(recorder.noteOn(60, 0.8), false);
  assert.deepEqual(recorder.start({ clock, program: 5 }), { track: 0, channel: 0, program: 5 });
  recorder.noteOn(60, 0.75);
  at(10_500); recorder.noteOff(60);
  recorder.noteOn(64, 0.5);
  at(11_000); const song = recorder.stop();
  assert.equal(recorder.recording, false);
  assert.deepEqual(song.notes.map(note => [note.midi, note.time, note.duration, note.keyDuration]), [[60, 0, 0.5, 0.5], [64, 0.5, 0.5, 0.5]]);
  assert.equal(song.tracks[0].program, 5);
  assert.deepEqual(song.programChanges, [{ time: 0, track: 0, channel: 0, program: 5 }]);
  assert.deepEqual(recorder.stop(), song);
});

test('recorder snapshots are isolated and do not stop or mutate the active take', () => {
  const { recorder, clock, at } = setup();
  recorder.start({ clock }); recorder.noteOn(60, 0.8);
  at(10_500); const snapshot = recorder.song;
  assert.equal(recorder.recording, true);
  close(snapshot.notes[0].duration, 0.5);
  snapshot.notes[0].midi = 127;
  at(10_200); close(recorder.song.notes[0].duration, 0.5);
  at(11_000); const song = recorder.stop();
  assert.equal(song.notes[0].midi, 60);
  close(song.notes[0].duration, 1);
});

test('recorder retains physical key duration while sustain extends sound', () => {
  const { recorder, clock, at } = setup();
  recorder.start({ clock }); recorder.noteOn(60, 0.8);
  at(10_100); recorder.event({ type: 'cc', controller: 64, value: 127 });
  at(10_400); recorder.noteOff(60);
  at(10_600); recorder.noteOn(60, 0.7);
  at(10_800); recorder.noteOff(60);
  at(11_000); recorder.event({ type: 'cc', controller: 64, value: 0 });
  const song = recorder.stop();
  close(song.notes[0].duration, 1); close(song.notes[0].keyDuration, 0.4);
  close(song.notes[1].duration, 0.4); close(song.notes[1].keyDuration, 0.2);
  assert.deepEqual(song.events.filter(event => event.type === 'cc').map(event => event.value), [127, 0]);
});

test('recorder safely releases sustain in snapshots and at stop', () => {
  const { recorder, clock, at } = setup();
  recorder.start({ clock }); recorder.noteOn(60, 0.8);
  recorder.event({ type: 'cc', controller: 64, value: 127 });
  at(10_500); recorder.noteOff(60);
  at(10_750); const snapshot = recorder.song;
  assert.deepEqual(snapshot.events.at(-1), { type: 'cc', time: 0.75, track: 0, channel: 0, controller: 64, value: 0 });
  at(11_000); const song = recorder.stop();
  close(song.notes[0].duration, 1); close(song.notes[0].keyDuration, 0.5);
  assert.equal(song.events.filter(event => event.type === 'cc' && event.value === 0).length, 1);
  assert.equal(song.events.at(-1).time, 1);
});

test('recorder starts overdubs at zero with independent instrument channels', () => {
  const { recorder, clock, at } = setup();
  recorder.start({ clock, program: 0 }); recorder.noteOn(60, 0.8, 0);
  at(11_000); const first = recorder.stop();
  at(50_000); const take = recorder.start({ clock, program: 40 });
  assert.equal(take.channel, 1);
  recorder.noteOn(67, 0.8, 0);
  at(50_500); const result = recorder.stop();
  const old = result.notes.find(note => note.track === 0);
  assert.deepEqual(old, first.notes[0]);
  assert.deepEqual(result.notes.map(note => [note.time, note.track, note.channel]), [[0, 0, 0], [0, 1, 1]]);
  assert.deepEqual(result.tracks.map(track => track.program), [0, 40]);
  assert.equal(result.duration, 1);
});

test('recorder stores controller, bend, pressure and program messages per mapped channel', () => {
  const { recorder, clock, at } = setup();
  recorder.start({ clock, program: 8 });
  recorder.noteOn(60, 0.8, 3);
  recorder.noteOn(64, 0.7, 5);
  at(10_250);
  recorder.event({ type: 'cc', channel: 5, controller: 1, value: 100 });
  recorder.event({ type: 'pitchBend', channel: 5, value: 10000 });
  recorder.event({ type: 'aftertouch', channel: 3, value: 70 });
  recorder.event({ type: 'polyAftertouch', channel: 3, midi: 60, value: 90 });
  recorder.event({ type: 'program', channel: 5, value: 41 });
  at(10_500); const song = recorder.stop();
  assert.deepEqual(song.notes.map(note => note.channel), [0, 1]);
  assert.deepEqual(song.events.filter(event => event.type !== 'program').map(event => [event.type, event.channel]), [['cc', 1], ['pitchBend', 1], ['aftertouch', 0], ['polyAftertouch', 0]]);
  assert.deepEqual(song.programChanges.map(event => [event.time, event.channel, event.program]), [[0, 0, 8], [0, 1, 8], [0.25, 1, 41]]);
});

test('recorder enforces six tracks, permits replacing one and frees deleted slots', () => {
  const { recorder, clock, at } = setup();
  for (let index = 0; index < 6; index++) {
    recorder.start({ clock, program: index }); recorder.noteOn(60 + index, 0.8);
    at(11_000 + index * 1000); recorder.stop();
  }
  assert.equal(recorder.song.tracks.length, 6);
  assert.deepEqual(recorder.song.tracks.map(track => track.channel), [0, 1, 2, 3, 4, 5]);
  assert.throws(() => recorder.start({ clock }), /6 pistas/);
  const prior = recorder.song;
  recorder.start({ clock, track: 2, program: 20 }); recorder.noteOn(80, 0.9);
  at(17_000); const replaced = recorder.stop();
  assert.equal(replaced.tracks.length, 6);
  assert.deepEqual(replaced.notes.filter(note => note.track === 2).map(note => note.midi), [80]);
  assert.deepEqual(replaced.notes.filter(note => note.track !== 2).map(({ id, ...note }) => note), prior.notes.filter(note => note.track !== 2).map(({ id, ...note }) => note));
  assert.equal(recorder.deleteTrack(2), true);
  assert.equal(recorder.deleteTrack(2), false);
  const next = recorder.start({ clock });
  assert.equal(next.track, 2);
  assert.equal(next.channel, 2);
});

test('re-recording replaces its old length while keeping other tracks intact', () => {
  const { recorder, clock, at } = setup();
  recorder.start({ clock }); recorder.noteOn(60, 0.8); at(20_000); recorder.stop();
  recorder.start({ clock }); recorder.noteOn(64, 0.8); at(21_000); recorder.stop();
  recorder.start({ clock, track: 0 }); recorder.noteOn(72, 0.8); at(21_500);
  const song = recorder.stop();
  close(song.duration, 1);
  assert.deepEqual(song.notes.map(note => note.midi), [64, 72]);
});

test('recorder restores JSON including sustain and MIDI events and rejects invalid state', () => {
  const { recorder, clock, at } = setup();
  recorder.start({ clock }); recorder.noteOn(60, 0.8);
  recorder.event({ type: 'cc', controller: 64, value: 127 });
  at(10_500); recorder.noteOff(60); at(11_000); const song = recorder.stop();
  const restored = new Recorder();
  assert.deepEqual(restored.restore(JSON.stringify(song)), song);
  const invalid = structuredClone(song); invalid.notes[0].keyDuration = 2;
  assert.throws(() => restored.restore(invalid), /Duração física/);
  invalid.notes[0].keyDuration = 0.5; invalid.events[0].channel = 16;
  assert.throws(() => restored.restore(invalid), /Canal/);
  assert.deepEqual(restored.song, song);
  restored.deleteTrack(0);
  assert.deepEqual(restored.song.tracks, []);
  assert.deepEqual(restored.song.notes, []);
});

test('recorder handles repeated same-pitch messages, velocity-zero and MIDI reset', () => {
  const { recorder, clock, at } = setup();
  recorder.start({ clock });
  recorder.noteOn(60, 0.8); at(10_100); recorder.noteOn(60, 0.7);
  at(10_200); recorder.noteOn(60, 0);
  at(10_300); recorder.event({ type: 'cc', controller: 64, value: 127 });
  at(10_400); recorder.event({ type: 'cc', controller: 123, value: 0 });
  at(10_500); recorder.event({ type: 'cc', controller: 121, value: 0 });
  const song = recorder.stop();
  close(song.notes[0].duration, 0.2);
  close(song.notes[1].duration, 0.4);
  close(song.notes[1].keyDuration, 0.3);
});

test('recorder validates API parameters and reset abandons only the current session', () => {
  assert.throws(() => new Recorder({ maxTracks: 7 }), /Limite/);
  const { recorder, clock } = setup();
  assert.throws(() => recorder.start({ track: -1, clock }), /Pista/);
  assert.throws(() => recorder.start({ clock: () => NaN }), /relógio/);
  recorder.start({ clock });
  assert.throws(() => recorder.start({ clock }), /andamento/);
  assert.throws(() => recorder.noteOn(128, 0.8), /Nota MIDI/);
  assert.throws(() => recorder.noteOn(60, 2), /Velocidade/);
  assert.throws(() => recorder.event({ type: 'pitchBend', value: 16384 }), /Pitch bend/);
  assert.throws(() => recorder.deleteTrack(0), /Pare/);
  assert.throws(() => recorder.restore(recorder.song), /Pare/);
  assert.equal(recorder.event({ type: 'clock' }), false);
  recorder.reset();
  assert.equal(recorder.recording, false);
  assert.equal(recorder.song.tracks.length, 0);
});
