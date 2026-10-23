import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi, encodeMidi, normalizeSong } from '../src/music/midi.js';

function vlq(value) { const bytes = [value & 127]; while ((value = Math.floor(value / 128))) bytes.unshift(value & 127 | 128); return bytes; }
const event = (delta, ...bytes) => [...vlq(delta), ...bytes];
const u16 = value => [value >> 8 & 255, value & 255];
const u32 = value => [value >>> 24 & 255, value >>> 16 & 255, value >>> 8 & 255, value & 255];
const eot = (delta = 0) => event(delta, 0xff, 0x2f, 0);
const tempo = (delta, micros) => event(delta, 0xff, 0x51, 3, ...u32(micros).slice(1));
const division = (frameCode, resolution) => ((frameCode + 256) << 8) | resolution;
function file(tracks, timing) {
  const chunks = tracks.flatMap(events => { const data = events.flat(); return [77, 84, 114, 107, ...u32(data.length), ...data]; });
  return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, tracks.length === 1 ? 0 : 1, ...u16(tracks.length), ...u16(timing), ...chunks]);
}
const near = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} vs ${expected}`);

test('SMPTE -24/-25/-30 clocks ignore tempo changes while preserving metadata timestamps', () => {
  for (const frameCode of [-24, -25, -30]) {
    const second = -frameCode * 40;
    const source = file([
      [tempo(0, 500000), tempo(second / 2, 1000000), event(0, 0xff, 0x58, 4, 3, 2, 24, 8), event(second / 2, 0xff, 0x06, 1, 65), eot(second)],
      [event(0, 0x90, 60, 100), event(second, 0x80, 60, 0), event(second / 2, 0xb0, 1, 50), eot(second / 2)],
    ], division(frameCode, 40));
    const song = parseMidi(source);
    assert.equal(song.ppq, 480);
    near(song.notes[0].duration, 1);
    near(song.notes[0].keyDuration, 1);
    near(song.duration, 2);
    assert.deepEqual(song.tempos, [{ time: 0, bpm: 120 }, { time: 0.5, bpm: 60 }]);
    near(song.timeSignatures[1].time, 0.5);
    assert.deepEqual(song.markers, [{ time: 1, text: 'A' }]);
    near(song.events.find(item => item.type === 'cc').time, 1.5);
    const exported = encodeMidi(normalizeSong(song));
    assert.deepEqual(Array.from(exported.slice(12, 14)), [1, 224]);
    const roundtrip = parseMidi(exported);
    near(roundtrip.notes[0].duration, 1, 0.002);
    near(roundtrip.duration, 2, 0.002);
    assert.deepEqual(roundtrip.tempos, song.tempos);
    assert.deepEqual(roundtrip.markers, song.markers);
  }
});

test('SMPTE -29 drop frame uses exactly 30000/1001 fps for notes, pedal, events and markers', () => {
  const source = file([
    [tempo(0, 500000), tempo(1500, 1000000), event(1500, 0xff, 0x06, 4, 68, 114, 111, 112), eot(27000)],
    [event(0, 0x90, 60, 100), event(1000, 0xb0, 64, 127), event(500, 0x80, 60, 0), event(500, 0xe0, 127, 127), event(1000, 0xb0, 64, 0), eot(27000)],
  ], division(-29, 100));
  const song = parseMidi(source);
  near(song.notes[0].keyDuration, 0.5005);
  near(song.notes[0].duration, 1.001);
  near(song.tempos[1].time, 0.5005);
  near(song.events.find(item => item.type === 'pitchBend').time, 2000 * 1001 / 3000000);
  near(song.markers[0].time, 1.001);
  near(song.duration, 10.01);
  const roundtrip = parseMidi(encodeMidi(song));
  near(roundtrip.notes[0].keyDuration, song.notes[0].keyDuration, 0.002);
  near(roundtrip.notes[0].duration, song.notes[0].duration, 0.002);
  near(roundtrip.duration, song.duration, 0.002);
});

test('SMPTE rejects unsupported frame codes or zero ticks per frame, and accepts low/high resolutions', () => {
  for (const timing of [division(-26, 40), division(-28, 40), division(-24, 0), division(-29, 0), 0x8001]) assert.throws(() => parseMidi(file([[eot()]], timing)), /SMPTE inválida/);
  for (const resolution of [1, 255]) {
    const song = parseMidi(file([[event(0, 0x90, 60, 100), event(25 * resolution, 0x80, 60, 0), eot()]], division(-25, resolution)));
    near(song.notes[0].duration, 1);
  }
});
