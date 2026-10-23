import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi, encodeMidi, normalizeSong, createDemoSongs, noteName } from '../src/music/midi.js';

const bytes16 = value => [value >> 8 & 255, value & 255];
const bytes32 = value => [value >>> 24 & 255, value >>> 16 & 255, value >>> 8 & 255, value & 255];
function vlq(value) {
  const bytes = [value & 127];
  while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128);
  return bytes;
}
const event = (delta, ...data) => [...vlq(delta), ...data];
const eot = (delta = 0) => event(delta, 0xff, 0x2f, 0);
const tempo = (delta, micros) => event(delta, 0xff, 0x51, 3, ...bytes32(micros).slice(1));
const track = events => [77, 84, 114, 107, ...bytes32(events.flat().length), ...events.flat()];
function file(tracks, { format = tracks.length > 1 ? 1 : 0, ppq = 480 } = {}) {
  return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, ...bytes16(format), ...bytes16(tracks.length), ...bytes16(ppq), ...tracks.flatMap(track)]);
}
const near = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} não corresponde a ${expected}`);

test('SMF 0: reads notes, PPQ, note name, velocity and default meter', () => {
  const midi = file([[event(0, 0x90, 60, 100), event(480, 0x80, 60, 0), eot(480)]]);
  const song = parseMidi(midi.buffer, 'Teste');
  assert.equal(song.title, 'Teste');
  assert.equal(song.ppq, 480);
  assert.equal(song.notes.length, 1);
  assert.equal(song.notes[0].midi, 60);
  assert.equal(song.notes[0].track, 0);
  near(song.notes[0].velocity, 100 / 127);
  near(song.notes[0].duration, 0.5);
  near(song.duration, 1);
  assert.deepEqual(song.tempos, [{ time: 0, bpm: 120 }]);
  assert.deepEqual(song.timeSignatures, [{ time: 0, numerator: 4, denominator: 4 }]);
  assert.equal(parseMidi(midi).id, song.id);
});

test('running status and velocity zero note-off are interpreted', () => {
  const song = parseMidi(file([[event(0, 0x90, 60, 127), event(240, 64, 80), event(240, 60, 0), event(240, 64, 0), eot()]]));
  assert.equal(song.notes.length, 2);
  near(song.notes[0].duration, 0.5);
  near(song.notes[1].time, 0.25);
  near(song.notes[1].duration, 0.5);
});

test('tempo from a conductor track affects notes in other tracks, across changes', () => {
  const song = parseMidi(file([
    [tempo(0, 500000), tempo(480, 1000000), eot(960)],
    [event(0, 0x90, 60, 100), event(960, 0x80, 60, 0), eot(480)],
  ]));
  near(song.notes[0].duration, 1.5);
  near(song.duration, 2.5);
  assert.deepEqual(song.tempos, [{ time: 0, bpm: 120 }, { time: 0.5, bpm: 60 }]);
  assert.equal(song.notes[0].track, 1);
});

test('same-tick tempo events use the last event and support a late first tempo', () => {
  const song = parseMidi(file([[tempo(480, 1000000), tempo(0, 250000), event(0, 0x90, 65, 100), event(480, 0x80, 65, 0), eot()]]));
  assert.deepEqual(song.tempos, [{ time: 0, bpm: 120 }, { time: 0.5, bpm: 240 }]);
  near(song.notes[0].duration, 0.25);
});

test('track names, channels, programs and time signatures are retained', () => {
  const name = [...new TextEncoder().encode('Mão esquerda')];
  const song = parseMidi(file([[event(0, 0xff, 3, name.length, ...name), event(0, 0xff, 0x58, 4, 3, 3, 24, 8), event(0, 0xc2, 40), event(0, 0x92, 48, 80), event(480, 0xc2, 4), event(0, 0x82, 48, 0), eot()]]));
  assert.deepEqual(song.tracks[0], { id: 0, name: 'Mão esquerda', channel: 2, program: 40 });
  assert.deepEqual(song.timeSignatures, [{ time: 0, numerator: 3, denominator: 8 }]);
  assert.deepEqual(song.programChanges, [{ time: 0, track: 0, channel: 2, program: 40 }, { time: 0.5, track: 0, channel: 2, program: 4 }]);
});

test('sustain holds released notes and repeated pitches until pedal release', () => {
  const song = parseMidi(file([[event(0, 0x90, 60, 100), event(120, 0xb0, 64, 127), event(120, 0x80, 60, 0), event(240, 0x90, 60, 90), event(120, 0x80, 60, 0), event(120, 0xb0, 64, 0), eot()]]));
  assert.equal(song.notes.length, 2);
  near(song.notes[0].duration, 0.75);
  near(song.notes[1].time, 0.5);
  near(song.notes[1].duration, 0.25);
});

test('sustain is independent for each MIDI channel', () => {
  const song = parseMidi(file([[event(0, 0xb0, 64, 127), event(0, 0x90, 60, 100), event(0, 0x91, 64, 100), event(240, 0x80, 60, 0), event(0, 0x81, 64, 0), event(480, 0xb0, 64, 0), eot()]]));
  near(song.notes.find(note => note.channel === 0).duration, 0.75);
  near(song.notes.find(note => note.channel === 1).duration, 0.25);
});

test('unreleased notes and pedals are ended at file duration', () => {
  const song = parseMidi(file([[event(0, 0xb0, 64, 127), event(0, 0x90, 60, 100), event(240, 0x80, 60, 0), event(0, 0x90, 64, 100), eot(720)]]));
  near(song.notes[0].duration, 1);
  near(song.notes[1].duration, 0.75);
});

test('overlapping note-ons of the same pitch pair with note-offs in order', () => {
  const song = parseMidi(file([[event(0, 0x90, 60, 100), event(120, 0x90, 60, 90), event(120, 0x80, 60, 0), event(240, 0x80, 60, 0), eot()]]));
  near(song.notes[0].duration, 0.25);
  near(song.notes[1].duration, 0.375);
});

test('all sound off stops sustained and held notes immediately', () => {
  const song = parseMidi(file([[event(0, 0xb0, 64, 127), event(0, 0x90, 60, 100), event(120, 0x80, 60, 0), event(0, 0x90, 64, 100), event(120, 0xb0, 120, 0), eot(480)]]));
  near(song.notes[0].duration, 0.25);
  near(song.notes[1].duration, 0.125);
});

test('sustain in a conductor track controls notes on the same channel in another track', () => {
  const song = parseMidi(file([
    [event(0, 0xb0, 64, 127), event(960, 0xb0, 64, 0), eot()],
    [event(0, 0x90, 60, 100), event(240, 0x80, 60, 0), eot(720)],
  ]));
  near(song.notes[0].duration, 1);
});

test('reset controllers releases sustain without stopping notes still held', () => {
  const song = parseMidi(file([[event(0, 0xb0, 64, 127), event(0, 0x90, 60, 100), event(120, 0x80, 60, 0), event(0, 0x90, 64, 100), event(120, 0xb0, 121, 0), event(240, 0x80, 64, 0), eot()]]));
  near(song.notes[0].duration, 0.25);
  near(song.notes[1].duration, 0.375);
});

test('sysex and unknown meta events can be skipped', () => {
  const song = parseMidi(file([[event(0, 0xf0, 3, 1, 2, 0xf7), event(0, 0xff, 1, 3, 97, 98, 99), event(0, 0x90, 60, 100), event(480, 0x80, 60, 0), eot()]]));
  assert.equal(song.notes.length, 1);
});

test('invalid headers, format 2, invalid SMPTE and truncated events fail explicitly', () => {
  const valid = file([[event(0, 0x90, 60, 100), event(480, 0x80, 60, 0), eot()]]);
  assert.throws(() => parseMidi(new Uint8Array([1, 2, 3])), /truncado/);
  assert.throws(() => parseMidi(new Uint8Array(20)), /MThd/);
  assert.throws(() => parseMidi(file([[eot()]], { format: 2 })), /SMF 0 e 1/);
  assert.throws(() => parseMidi(file([[eot()]], { ppq: 0xe628 })), /SMPTE/);
  assert.throws(() => parseMidi(file([[eot()]], { ppq: 0 })), /PPQ/);
  assert.throws(() => parseMidi(valid.subarray(0, valid.length - 1)), /truncado/);
  assert.throws(() => parseMidi(file([[event(0, 0x90, 60)]])), /truncado/);
  assert.throws(() => parseMidi(file([[event(0, 60, 100), eot()]])), /running status/);
  assert.throws(() => parseMidi(file([[event(0, 0xff, 0x51, 3, 0, 0, 0), eot()]])), /andamento igual a zero/);
});

test('four-byte VLQ limit and invalid channel data are validated', () => {
  assert.throws(() => parseMidi(file([[[0x81, 0x81, 0x81, 0x81, 0, 0xff, 0x2f, 0]]])), /VLQ/);
  assert.throws(() => parseMidi(file([[event(0, 0x90, 60, 255), eot()]])), /dados/);
});

test('encode and parse preserve note timing, velocity, tracks and tempo changes', () => {
  const input = normalizeSong({
    id: 'roundtrip', title: 'Round trip', ppq: 960, tempo: 120,
    tempos: [{ time: 0, bpm: 120 }, { time: 1, bpm: 75 }, { time: 3.4, bpm: 150 }],
    timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }, { time: 3.4, numerator: 6, denominator: 8 }],
    tracks: [{ id: 0, name: 'Direita', channel: 0, program: 0 }, { id: 1, name: 'Esquerda', channel: 1, program: 4 }],
    notes: [
      { midi: 60, time: 0.125, duration: 1.875, velocity: 0.8, track: 0, channel: 0 },
      { midi: 48, time: 0.5, duration: 3.1, velocity: 0.5, track: 1, channel: 1 },
      { midi: 67, time: 3.6, duration: 0.8, velocity: 1, track: 0, channel: 0 },
    ], duration: 5,
  });
  const song = parseMidi(encodeMidi(input));
  assert.equal(song.ppq, input.ppq);
  assert.equal(song.notes.length, input.notes.length);
  assert.deepEqual(song.tracks, input.tracks);
  song.notes.forEach((note, i) => {
    assert.equal(note.midi, input.notes[i].midi);
    assert.equal(note.track, input.notes[i].track);
    assert.equal(note.channel, input.notes[i].channel);
    near(note.time, input.notes[i].time, 0.002);
    near(note.duration, input.notes[i].duration, 0.002);
    near(note.velocity, input.notes[i].velocity, 1 / 127);
  });
  near(song.duration, 5, 0.002);
  assert.deepEqual(song.tempos, input.tempos);
  assert.deepEqual(song.timeSignatures, input.timeSignatures);
});

test('program changes survive export at their actual musical times', () => {
  const input = { notes: [{ midi: 60, time: 0, duration: 2, track: 0 }], tracks: [{ id: 0, program: 4 }], programChanges: [{ time: 1, track: 0, channel: 0, program: 40 }] };
  const song = parseMidi(encodeMidi(input));
  assert.deepEqual(song.programChanges.find(event => event.time === 1), { time: 1, track: 0, channel: 0, program: 40 });
});

test('nonconsecutive track ids remain stable through MIDI export', () => {
  const song = parseMidi(encodeMidi({ notes: [{ midi: 60, time: 0, duration: 1, track: 2, channel: 3 }], tracks: [{ id: 2, name: 'Terceira', program: 40, channel: 3 }] }));
  assert.equal(song.notes[0].track, 2);
  assert.equal(song.notes[0].channel, 3);
  assert.equal(song.tracks[2].name, 'Terceira');
  assert.equal(song.tracks[2].program, 40);
});

test('large MIDI export does not exceed JavaScript argument limits', () => {
  const notes = Array.from({ length: 20000 }, (_, id) => ({ midi: 60 + id % 12, time: id * 0.01, duration: 0.008, track: 0 }));
  const decoded = parseMidi(encodeMidi({ notes }));
  assert.equal(decoded.notes.length, notes.length);
  near(decoded.notes.at(-1).time, notes.at(-1).time, 0.002);
});

test('three original demos are playable and all round-trip through MIDI', () => {
  const songs = createDemoSongs();
  assert.equal(songs.length, 3);
  assert.equal(new Set(songs.map(song => song.id)).size, 3);
  for (const song of songs) {
    assert.ok(song.notes.length >= 15);
    assert.ok(song.duration > 5);
    const encoded = encodeMidi(song);
    const decoded = parseMidi(encoded);
    assert.equal(decoded.notes.length, song.notes.length);
    near(decoded.duration, song.duration, 0.003);
    decoded.notes.forEach((note, i) => near(note.time, song.notes[i].time, 0.003));
  }
  assert.equal(songs[2].tracks.length, 2);
});

test('normalization rejects malformed JSON notes and timing maps', () => {
  assert.throws(() => normalizeSong({}), /lista de notas/);
  assert.throws(() => normalizeSong({ notes: [{ midi: 128, time: 0, duration: 1 }] }), /Nota 1/);
  assert.throws(() => normalizeSong({ notes: [{ midi: 60, time: -1, duration: 1 }] }), /Nota 1/);
  assert.throws(() => normalizeSong({ notes: [{ midi: 60, time: 0, duration: NaN }] }), /Nota 1/);
  assert.throws(() => normalizeSong({ notes: [], tempos: [{ time: 0, bpm: 0 }] }), /andamento/);
  assert.throws(() => normalizeSong({ notes: [], timeSignatures: [{ time: 0, numerator: 4, denominator: 3 }] }), /compasso/);
  const song = normalizeSong({ title: 'JSON', notes: [{ midi: 60, time: 0, duration: 1 }] });
  assert.equal(song.notes[0].channel, 0);
  assert.equal(song.notes[0].velocity, 0.8);
  assert.equal(song.tracks.length, 1);
  assert.equal(song.duration, 1);
});

test('note names cover standard MIDI bounds and solfège', () => {
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(61), 'C♯4');
  assert.equal(noteName(69, true), 'Lá4');
  assert.equal(noteName(0), 'C-1');
  assert.equal(noteName(127), 'G9');
});

test('normalization retains editable hands, fingering, favorite and independent configs', () => {
  const input = { notes: [{ midi: 60, time: 0, duration: 1, hand: 'left', finger: 3 }], favorite: true, configs: { 0: { hand: 'left', role: 'learn', program: 40, color: '#fedcba' } } };
  const song = normalizeSong(input);
  assert.equal(song.notes[0].hand, 'left');
  assert.equal(song.notes[0].finger, 3);
  assert.equal(song.favorite, true);
  assert.deepEqual(song.configs, input.configs);
  const reopened = normalizeSong(JSON.parse(JSON.stringify(song)));
  assert.equal(reopened.notes[0].hand, 'left');
  assert.equal(reopened.notes[0].finger, 3);
  assert.equal(reopened.favorite, true);
  assert.deepEqual(reopened.configs, input.configs);
  song.configs[0].role = 'mute';
  assert.equal(input.configs[0].role, 'learn');
  const invalid = normalizeSong({ notes: [{ midi: 60, time: 0, duration: 1, hand: 'invalid', finger: 9 }] });
  assert.equal(invalid.notes[0].hand, undefined);
  assert.equal(invalid.notes[0].finger, undefined);
});
