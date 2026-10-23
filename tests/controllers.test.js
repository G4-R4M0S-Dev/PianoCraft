import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi, encodeMidi, normalizeSong } from '../src/music/midi.js';
import { MidiDevices } from '../src/music/devices.js';
import { Recorder } from '../src/music/recorder.js';

function vlq(value) { const result = [value & 127]; while ((value = Math.floor(value / 128))) result.unshift(value & 127 | 128); return result; }
const event = (delta, ...bytes) => [...vlq(delta), ...bytes];
function file(events) {
  const data = events.flat();
  return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, data.length >>> 24 & 255, data.length >>> 16 & 255, data.length >>> 8 & 255, data.length & 255, ...data]);
}

test('MIDI round-trip preserves all expression events and real key release under sustain', () => {
  const source = file([
    event(0, 0xc2, 4), event(0, 0xb2, 7, 99), event(0, 0x92, 60, 100),
    event(120, 0xb2, 64, 127), event(120, 0x82, 60, 0),
    event(120, 0xe2, 127, 127), event(0, 0xd2, 88), event(0, 0xa2, 60, 70),
    event(120, 0xb2, 64, 0), event(120, 0xb2, 11, 37), event(0, 0xc2, 40),
    event(120, 0xe2, 0, 64), event(0, 0x92, 64, 110), event(240, 0x82, 64, 0),
    event(0, 0xff, 0x2f, 0),
  ]);
  const first = parseMidi(source);
  assert.equal(first.notes[0].duration, 0.5);
  assert.equal(first.notes[0].keyDuration, 0.25);
  assert.equal(first.events.find(item => item.type === 'pitchBend').value, 16383);
  const second = parseMidi(encodeMidi(first));
  assert.deepEqual(second.events, first.events);
  assert.deepEqual(second.notes.map(({ time, duration, keyDuration }) => ({ time, duration, keyDuration })), first.notes.map(({ time, duration, keyDuration }) => ({ time, duration, keyDuration })));
  assert.equal(second.programChanges.length, first.programChanges.length);
});

test('JSON normalization retains expression-only tracks, event duration and validates controller ranges', () => {
  const normalized = normalizeSong({ notes: [], events: [{ time: 3, type: 'cc', track: 3, channel: 7, controller: 1, value: 127 }] });
  assert.equal(normalized.duration, 3);
  assert.ok(normalized.tracks.some(track => track.id === 3));
  const reopened = normalizeSong(JSON.parse(JSON.stringify(normalized)));
  assert.deepEqual(reopened.events, normalized.events);
  assert.deepEqual(parseMidi(encodeMidi(reopened)).events.filter(item => item.type !== 'program'), reopened.events);
  assert.throws(() => normalizeSong({ notes: [], events: [{ time: 0, type: 'cc', controller: 128, value: 0 }] }), /Controlador/);
  assert.throws(() => normalizeSong({ notes: [], events: [{ time: 0, type: 'pitchBend', value: 16384 }] }), /Valor/);
  assert.throws(() => normalizeSong({ notes: [], events: [{ time: 0, type: 'polyAftertouch', value: 1, midi: 128 }] }), /pressão/);
  assert.throws(() => normalizeSong({ notes: [], events: [{ time: -1, type: 'aftertouch', value: 1 }] }), /Evento/);
});

test('MIDI devices decode and send complete controller, bend, pressure and program messages', () => {
  const midi = new MidiDevices();
  const received = [], sent = [];
  midi.onMessage = message => received.push(message);
  midi._output = { state: 'connected', send: bytes => sent.push(bytes) };
  for (const message of [[0xb5, 1, 99], [0xb5, 64, 127], [0xe5, 0, 64], [0xe5, 127, 127], [0xd5, 45], [0xa5, 67, 88], [0xc5, 40]]) midi._receive(message);
  assert.deepEqual(received, [
    { type: 'cc', controller: 1, value: 99, channel: 5 },
    { type: 'cc', controller: 64, value: 127, channel: 5 },
    { type: 'pitchBend', value: 8192, channel: 5 },
    { type: 'pitchBend', value: 16383, channel: 5 },
    { type: 'aftertouch', value: 45, channel: 5 },
    { type: 'polyAftertouch', midi: 67, value: 88, channel: 5 },
    { type: 'program', value: 40, channel: 5 },
  ]);
  midi.sendControl(1, 99, 5);
  midi.sendPitchBend(8192, 5);
  midi.sendPitchBend(16383, 5);
  midi.sendAftertouch(45, 5);
  midi.sendPolyAftertouch(67, 88, 5);
  assert.deepEqual(sent, [[0xb5, 1, 99], [0xe5, 0, 64], [0xe5, 127, 127], [0xd5, 45], [0xa5, 67, 88]]);
  assert.equal(midi.sendPitchBend(NaN), false);
  assert.equal(midi.sendControl(1, NaN), false);
});

test('MIDI marker meta 0x06 survives UTF-8 round-trip across tempo changes and extends duration', () => {
  const song = normalizeSong({ notes: [{ midi: 60, time: 0, duration: 0.5 }], tempos: [{ time: 0, bpm: 120 }, { time: 1, bpm: 60 }], markers: [{ time: 0, text: 'Introdução' }, { time: 2.5, text: 'Refrão · mão esquerda' }, { time: 4, text: '' }] });
  assert.equal(song.duration, 4);
  const parsed = parseMidi(encodeMidi(song));
  assert.deepEqual(parsed.markers, song.markers);
  assert.deepEqual(normalizeSong(JSON.parse(JSON.stringify(parsed))).markers, song.markers);
  assert.equal(parsed.duration, 4);
  assert.throws(() => normalizeSong({ notes: [], markers: [{ time: -1, text: 'A' }] }), /Marcador/);
  assert.throws(() => normalizeSong({ notes: [], markers: [{ time: 0, text: 7 }] }), /Marcador/);
});

test('recorder output round-trips sustain, raw key duration and expression through real MIDI encoding', () => {
  let now = 10000;
  const recorder = new Recorder();
  recorder.start({ clock: () => now, program: 4 });
  recorder.noteOn(60, 0.8);
  now = 10100; recorder.event({ type: 'cc', controller: 64, value: 127 });
  now = 10250; recorder.noteOff(60);
  now = 10300; recorder.event({ type: 'pitchBend', value: 12000 });
  now = 10500; recorder.event({ type: 'program', value: 40 });
  now = 10750;
  const recorded = recorder.stop();
  const parsed = parseMidi(encodeMidi(recorded));
  assert.equal(parsed.notes[0].keyDuration, 0.25);
  assert.equal(parsed.notes[0].duration, 0.75);
  assert.deepEqual(parsed.events, recorded.events);
  assert.deepEqual(parsed.programChanges, recorded.programChanges);
});
