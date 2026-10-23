import test from 'node:test';
import assert from 'node:assert/strict';
import { GuideLights, GUIDE_LIGHT_PROFILES } from '../src/music/guide-lights.js';

function port(id = 'casio') {
  const handlers = new Set();
  return {
    id, state: 'connected', sent: [], opened: 0, closed: 0,
    open() { this.opened++; }, close() { this.closed++; },
    send(bytes) { this.sent.push([...bytes]); },
    addEventListener(type, handler) { if (type === 'statechange') handlers.add(handler); },
    removeEventListener(type, handler) { if (type === 'statechange') handlers.delete(handler); },
    unplug() { this.state = 'disconnected'; for (const handler of [...handlers]) handler(); },
  };
}

function timer() {
  let nextId = 1;
  const callbacks = new Map(), cancelled = [];
  return {
    callbacks, cancelled,
    setTimer(callback, duration) { const id = nextId++; callbacks.set(id, { callback, duration }); return id; },
    clearTimer(id) { cancelled.push(id); callbacks.delete(id); },
  };
}

test('guides remain disabled until an explicit output selection and never own a shared MIDI port', () => {
  const guide = new GuideLights();
  assert.equal(guide.connected, false);
  assert.equal(guide.update([60]), false);
  const output = port(), audioOutput = port('synth');
  assert.equal(guide.connect(output), true);
  assert.deepEqual(output.sent, []);
  guide.update([60]);
  guide.disconnect();
  assert.deepEqual(output.sent, [[0x93, 60, 1], [0x83, 60, 0]]);
  assert.equal(output.opened, 0);
  assert.equal(output.closed, 0);
  assert.deepEqual(audioOutput.sent, []);
  assert.equal(guide.connected, false);
});

test('CASIO Navigate emits exact channel-4 bytes, merges unisons and sends only changed keys', () => {
  const output = port(), changes = [];
  const guide = new GuideLights({ onChange: status => changes.push(status) });
  guide.connect(output, 'casio-navigate');
  guide.update([60, 64, 60]);
  guide.update([64, 60]);
  guide.update([64, 67]);
  guide.update([]);
  assert.deepEqual(output.sent, [[0x93, 60, 1], [0x93, 64, 1], [0x83, 60, 0], [0x93, 67, 1], [0x83, 64, 0], [0x83, 67, 0]]);
  assert.deepEqual(guide.activeNotes, []);
  // The unchanged animation frame did not notify the UI or touch the MIDI bus.
  assert.equal(changes.filter(status => status.activeNotes.length === 2).length, 2);
});

test('MIDI channels are one-based with validated velocity and note offset, never wrapped', () => {
  const output = port();
  const guide = new GuideLights();
  guide.connect(output, { profile: 'midi-note', channel: 16, velocity: 2, noteOffset: 12 });
  guide.update([0, 60, 115, 116, 127, -1, 128, NaN, 60.5, '60']);
  guide.allOff();
  assert.deepEqual(output.sent, [[0x9f, 12, 2], [0x9f, 72, 2], [0x9f, 127, 2], [0x8f, 12, 0], [0x8f, 72, 0], [0x8f, 127, 0]]);
  guide.connect(output, 'midi-note', 1, { noteOffset: -12 });
  guide.update([0, 11, 12, 127]);
  assert.deepEqual(output.sent.slice(-2), [[0x90, 0, 1], [0x90, 115, 1]]);
  assert.throws(() => guide.connect(output, 'midi-note', 0), /Canal/);
  assert.throws(() => guide.connect(output, 'midi-note', 17), /Canal/);
  assert.throws(() => guide.connect(output, 'midi-note', 3.5), /Canal/);
  assert.throws(() => guide.connect(output, 'midi-note', 1, { velocity: 0 }), /Velocidade/);
  assert.throws(() => guide.connect(output, 'midi-note', 1, { noteOffset: 128 }), /Deslocamento/);
  assert.throws(() => guide.connect(output, 'undocumented-sysex'), /Perfil/);
  assert.equal(guide.connected, true); // Invalid edits do not drop the working route.
  assert.deepEqual(GUIDE_LIGHT_PROFILES['midi-note'].channel, 1);
});

test('pausing/seeking cleanup is idempotent and changing the route releases the original channel first', () => {
  const first = port(), second = port('second');
  const guide = new GuideLights();
  guide.connect(first, 'casio-navigate', 3);
  guide.update([48, 55]);
  guide.allOff();
  guide.allOff();
  guide.update([60]);
  guide.connect(second, 'midi-note', 16);
  guide.update([72]);
  guide.dispose();
  assert.deepEqual(first.sent, [[0x92, 48, 1], [0x92, 55, 1], [0x82, 48, 0], [0x82, 55, 0], [0x92, 60, 1], [0x82, 60, 0]]);
  assert.deepEqual(second.sent, [[0x9f, 72, 1], [0x8f, 72, 0]]);
});

test('hardware test stops automatically and pause/disconnect cannot leave a delayed callback affecting another song', () => {
  const output = port(), clock = timer();
  const guide = new GuideLights(clock);
  guide.connect(output);
  assert.equal(guide.test([60, 64], 800), true);
  assert.equal(guide.testing, true);
  const oldCallback = clock.callbacks.get(1).callback;
  assert.equal(clock.callbacks.get(1).duration, 800);
  guide.allOff();
  guide.update([67]);
  oldCallback(); // Even an already queued callback belongs to the old test.
  assert.deepEqual(guide.activeNotes, [67]);
  assert.deepEqual(clock.cancelled, [1]);
  guide.test([72], 400);
  clock.callbacks.get(2).callback();
  assert.deepEqual(guide.activeNotes, []);
  assert.equal(guide.testing, false);
  assert.deepEqual(output.sent, [[0x93, 60, 1], [0x93, 64, 1], [0x83, 60, 0], [0x83, 64, 0], [0x93, 67, 1], [0x83, 67, 0], [0x93, 72, 1], [0x83, 72, 0]]);
  assert.throws(() => guide.test([60], 10001), /Duração/);
});

test('a failed send clears every attempted guide note, reports once and disables further writes', () => {
  const output = port(), errors = [];
  const guide = new GuideLights({ onError: error => errors.push(error.message) });
  const original = output.send.bind(output);
  output.send = bytes => { original(bytes); if (bytes[0] === 0x93 && bytes[1] === 64) throw new Error('driver lost'); };
  guide.connect(output);
  assert.equal(guide.update([60, 64, 67]), false);
  assert.deepEqual(output.sent, [[0x93, 60, 1], [0x93, 64, 1], [0x83, 60, 0], [0x83, 64, 0]]);
  assert.deepEqual(guide.activeNotes, []);
  assert.equal(guide.connected, false);
  assert.equal(guide.status.error, 'driver lost');
  assert.equal(guide.update([67]), false);
  assert.deepEqual(errors, ['driver lost']);
});

test('a real port removal clears state and reselecting the same id flushes outstanding old-channel releases', () => {
  const first = port(), errors = [];
  const guide = new GuideLights({ onError: error => errors.push(error.message) });
  guide.connect(first, 'casio-navigate', 4);
  guide.update([60, 64]);
  first.unplug();
  assert.equal(guide.connected, false);
  assert.deepEqual(guide.activeNotes, []);
  assert.equal(errors.length, 1);
  const reconnected = port();
  guide.connect(reconnected, 'casio-navigate', 3);
  guide.update([67]);
  assert.deepEqual(reconnected.sent, [[0x83, 60, 0], [0x83, 64, 0], [0x92, 67, 1]]);
  assert.equal(guide.error, null);
});

test('plain native send transports are supported and a false result is treated as a failed write', () => {
  const sent = [], errors = [];
  let failed = false;
  const guide = new GuideLights({ onError: error => errors.push(error.message) });
  guide.connect(bytes => { sent.push(bytes); return !failed; }, 'midi-note', 2);
  guide.update([60]);
  failed = true;
  assert.equal(guide.update([64]), false);
  assert.equal(guide.connected, false);
  assert.equal(errors.length, 1);
  assert.deepEqual(sent[0], [0x91, 60, 1]);
  assert.ok(sent.slice(1).every(bytes => bytes[0] === 0x81));
});

test('LK-S250 proprietary profile emits recovered SysEx bytes and 180 ms keepalives without sounding notes', () => {
  const output = port(), clock = timer();
  const guide = new GuideLights(clock);
  assert.equal(GUIDE_LIGHT_PROFILES['casio-lks250'].requiresSysex, true);
  guide.connect(output, 'casio-lks250', 16, { velocity: 100 });
  const wake = [0xf0, 0x44, 0x7e, 0x7e, 0x7f, 0x00, 0x03, 0xf7];
  guide.update([20, 21, 60, 108, 109]);
  guide.update([21, 60, 108]);
  assert.equal(clock.callbacks.get(1).duration, 180);
  assert.deepEqual(output.sent, [wake,
    [0xf0, 0x44, 0x7e, 0x7e, 0x7f, 0x02, 0x00, 21, 1, 0xf7],
    [0xf0, 0x44, 0x7e, 0x7e, 0x7f, 0x02, 0x00, 60, 1, 0xf7],
    [0xf0, 0x44, 0x7e, 0x7e, 0x7f, 0x02, 0x00, 108, 1, 0xf7],
  ]);
  clock.callbacks.get(1).callback();
  assert.deepEqual(output.sent.at(-1), wake);
  assert.equal(clock.callbacks.get(2).duration, 180);
  const stale = clock.callbacks.get(2).callback;
  guide.allOff();
  const count = output.sent.length;
  stale();
  assert.equal(output.sent.length, count);
  assert.deepEqual(output.sent.slice(-3), [
    [0xf0, 0x44, 0x7e, 0x7e, 0x7f, 0x02, 0x00, 21, 0, 0xf7],
    [0xf0, 0x44, 0x7e, 0x7e, 0x7f, 0x02, 0x00, 60, 0, 0xf7],
    [0xf0, 0x44, 0x7e, 0x7e, 0x7f, 0x02, 0x00, 108, 0, 0xf7],
  ]);
  guide.update([64]);
  assert.deepEqual(output.sent.slice(-2), [wake, [0xf0, 0x44, 0x7e, 0x7e, 0x7f, 0x02, 0x00, 64, 1, 0xf7]]);
  guide.disconnect();
  assert.ok(output.sent.every(bytes => bytes[0] === 0xf0 && bytes.at(-1) === 0xf7));
});

test('LK-S250 SysEx denial disables the guide, and failing a keepalive releases its lights', () => {
  const denied = port(), errors = [], clock = timer();
  denied.send = () => { throw new Error('SysEx permission denied'); };
  const guide = new GuideLights({ ...clock, onError: error => errors.push(error.message) });
  assert.equal(guide.connect(denied, 'casio-lks250'), false);
  assert.equal(guide.connected, false);
  assert.deepEqual(errors, ['SysEx permission denied']);
  const output = port();
  guide.connect(output, 'casio-lks250');
  guide.update([60]);
  output.send = bytes => { output.sent.push(bytes); if (bytes[5] === 0) throw new Error('wake failed'); };
  clock.callbacks.get(1).callback();
  assert.equal(guide.connected, false);
  assert.deepEqual(guide.activeNotes, []);
  assert.deepEqual(output.sent.at(-1), [0xf0, 0x44, 0x7e, 0x7e, 0x7f, 0x02, 0x00, 60, 0, 0xf7]);
});
