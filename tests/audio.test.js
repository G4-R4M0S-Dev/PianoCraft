import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../src/music/audio.js';
import { MidiDevices } from '../src/music/devices.js';

class Parameter {
  constructor() { this.value = 0; this.events = []; }
  setValueAtTime(value, time) { this.events.push(['set', value, time]); }
  linearRampToValueAtTime(value, time) { this.events.push(['linear', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.events.push(['exponential', value, time]); }
  setTargetAtTime(value, time) { this.events.push(['target', value, time]); }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
  cancelAndHoldAtTime(time) { this.events.push(['hold', time]); }
}
class AudioNode {
  constructor() {
    for (const key of ['gain', 'frequency', 'detune', 'Q', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[key] = new Parameter();
  }
  connect() {}
  disconnect() { this.disconnected = true; }
  setPeriodicWave(wave) { this.wave = wave; }
  start(time) { this.startedAt = time; }
  stop(time) { this.stoppedAt = time; }
}
class Context {
  constructor() { this.currentTime = 0; this.sampleRate = 48000; this.state = 'suspended'; this.destination = {}; }
  createGain() { return new AudioNode(); }
  createDynamicsCompressor() { return new AudioNode(); }
  createBiquadFilter() { return new AudioNode(); }
  createOscillator() { return new AudioNode(); }
  createPeriodicWave(real, imaginary) { return { real, imaginary }; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}

test('audio isolates pedal by channel, pairs repeated notes and releases sustained notes', async () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  try {
    const audio = new AudioEngine();
    const [first, second] = await Promise.all([audio.init(), audio.init()]);
    assert.equal(first, audio);
    assert.equal(second, audio);
    audio.setSustain(true, 0);
    const a = audio.noteOn(60, 0.8, 0);
    const b = audio.noteOn(60, 0.9, 0);
    const c = audio.noteOn(60, 0.8, 1);
    audio.noteOff(60, 0);
    assert.equal(audio.voices.get(a).keyDown, false);
    assert.equal(audio.voices.get(a).released, false);
    assert.equal(audio.voices.get(b).keyDown, true);
    audio.noteOff(60, 1);
    assert.equal(audio.voices.get(c).released, true);
    audio.setSustain(false, 0);
    assert.equal(audio.voices.get(a).released, true);
    assert.equal(audio.voices.get(b).released, false);
    audio.allNotesOff();
    assert.equal(audio.voices.get(b).released, true);
    await audio.dispose();
    assert.equal(audio.voices.size, 0);
    assert.equal(audio.context, null);
  } finally { globalThis.AudioContext = previous; }
});

test('audio limits active voices, validates notes and supports muted volume', async () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  try {
    const audio = new AudioEngine({ maxVoices: 2 });
    assert.equal(audio.noteOn(60), null);
    await audio.init();
    assert.equal(audio.noteOn(-1), null);
    assert.equal(audio.noteOn(NaN), null);
    assert.equal(audio.noteOn(60, NaN), null);
    const first = audio.noteOn(60);
    audio.noteOn(62);
    audio.noteOn(64);
    assert.equal(audio.voices.size, 2);
    assert.equal(audio.voices.has(first), false);
    audio.setVolume(0);
    assert.equal(audio.volume, 0);
    assert.equal(audio._master.gain.events.at(-1)[1], 0);
    await audio.dispose();
  } finally { globalThis.AudioContext = previous; }
});

test('audio applies pitch bend to existing and new voices on the selected channel', async () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  try {
    const audio = new AudioEngine();
    await audio.init();
    const first = audio.noteOn(60, 1, 2);
    const other = audio.noteOn(60, 1, 3);
    audio.pitchBend(16383, 2);
    assert.equal(audio.voices.get(first).oscillators[0].oscillator.detune.events.at(-1)[1], 199.3);
    assert.equal(audio.voices.get(other).oscillators[0].oscillator.detune.events.length, 0);
    const following = audio.noteOn(64, 1, 2);
    assert.equal(audio.voices.get(following).oscillators[0].oscillator.detune.value, 199.3);
    audio.controlChange(7, 64, 2);
    assert.equal(audio._channels.get(2).gain.gain.events.at(-1)[1], 64 / 127);
    audio.controlChange(121, 0, 2);
    assert.equal(audio.voices.get(first).oscillators[0].oscillator.detune.events.at(-1)[1], -0.7);
    await audio.dispose();
  } finally { globalThis.AudioContext = previous; }
});

test('completion chime is soft, ascending, brief and cancellable without resuming audio', async () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  try {
    const audio = new AudioEngine();
    assert.equal(audio.completionChime(), false);
    await audio.init();
    audio.context.currentTime = 12;
    audio.context.resume = () => { throw new Error('Feedback must not resume audio'); };
    audio.context.state = 'suspended';
    assert.equal(audio.completionChime(), false); assert.equal(audio._clicks.size, 0);
    audio.context.state = 'running';
    assert.equal(audio.completionChime(), true);
    const clicks = [...audio._clicks];
    assert.equal(clicks.length, 3); assert.equal(audio.voices.size, 0);
    assert.deepEqual(clicks.map(item => item.oscillator.frequency.events[0][1]), [659.25, 830.61, 987.77]);
    assert.equal(clicks[0].oscillator.startedAt, 12);
    assert.ok(Math.abs(clicks[2].oscillator.stoppedAt - 12.25) < 1e-8);
    for (const { gain } of clicks) assert.equal(Math.max(...gain.gain.events.map(event => event[1])), .035);
    clicks[0].oscillator.onended();
    assert.equal(audio._clicks.size, 2); assert.equal(clicks[0].gain.disconnected, true);
    audio.stopClicks();
    assert.equal(audio._clicks.size, 0);
    assert.equal(clicks[2].oscillator.onended, null); assert.equal(clicks[2].gain.disconnected, true);
    audio.completionChime();
    const pending = [...audio._clicks];
    await audio.dispose();
    assert.equal(audio._clicks.size, 0); assert.ok(pending.every(item => item.oscillator.disconnected && item.gain.disconnected));
    assert.equal(audio.completionChime(), false);
  } finally { globalThis.AudioContext = previous; }
});

class Port extends EventTarget {
  constructor(id) { super(); this.id = id; this.name = id; this.state = 'connected'; this.connection = 'closed'; this.sent = []; }
  async open() { this.connection = 'open'; }
  async close() { this.connection = 'closed'; }
  send(data) { this.sent.push(data); }
  receive(data) { const event = new Event('midimessage'); event.data = new Uint8Array(data); this.dispatchEvent(event); }
}

test('MIDI normalizes messages, opts into output and releases notes on unplug', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const input = new Port('keyboard');
  const output = new Port('piano');
  const access = new EventTarget();
  access.inputs = new Map([[input.id, input]]);
  access.outputs = new Map([[output.id, output]]);
  let requested;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { requestMIDIAccess: async options => { requested = options; return access; } } });
  try {
    const midi = new MidiDevices();
    const notes = [], pedals = [];
    midi.onNote = note => notes.push(note);
    midi.onSustain = pedal => pedals.push(pedal);
    await midi.connect();
    assert.deepEqual(requested, { sysex: false });
    assert.equal(midi.inputId, 'keyboard');
    assert.equal(midi.outputId, null);
    input.receive([0x92, 60, 127]);
    input.receive([0x92, 60, 0]);
    assert.deepEqual(notes[0], { midi: 60, velocity: 1, on: true, channel: 2, deviceId: 'keyboard', receivedTime: notes[0].receivedTime });
    assert.ok(Number.isFinite(notes[0].receivedTime));
    assert.equal(notes[1].on, false);
    input.receive([0x91, 64, 80]);
    input.receive([0xb1, 64, 127]);
    input.state = 'disconnected';
    access.dispatchEvent(new Event('statechange'));
    assert.equal(midi.inputId, null);
    assert.deepEqual(notes.at(-1), { midi: 64, velocity: 0, on: false, channel: 1, deviceId: 'keyboard', synthetic: true, reason: 'device-detached' });
    assert.deepEqual(pedals.at(-1), { value: false, channel: 1, deviceId: 'keyboard', synthetic: true, reason: 'device-detached' });
    await midi.setOutput('piano');
    midi.sendProgram(10, 3);
    midi.sendNoteOn(60, 0.5, 3);
    midi.sendNoteOff(60, 3);
    assert.deepEqual(output.sent.slice(0, 3), [[0xc3, 10], [0x93, 60, 64], [0x83, 60, 0]]);
    midi.sendNoteOn(62, 100, 0);
    midi.allNotesOff();
    assert.ok(output.sent.some(message => message[0] === 0x80 && message[1] === 62));
    assert.ok(output.sent.some(message => message[0] === 0xbf && message[1] === 123));
    await midi.disconnect();
    assert.equal(midi.connected, false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});

test('all MIDI inputs keep device identities, hotplug and release only the removed device', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const first = new Port('first'), second = new Port('second'), third = new Port('third');
  const access = new EventTarget();
  access.inputs = new Map([[first.id, first], [second.id, second]]);
  access.outputs = new Map();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { requestMIDIAccess: async () => access } });
  try {
    const deferred = new MidiDevices();
    assert.equal(await deferred.setInput('all'), 'all');
    assert.equal(deferred.connected, false);
    await deferred.disconnect();
    const midi = new MidiDevices();
    const notes = [], pedals = [], messages = [];
    midi.onNote = note => notes.push(note);
    midi.onSustain = pedal => pedals.push(pedal);
    midi.onMessage = message => messages.push(message);
    await midi.connect();
    second.receive([0x90, 62, 100]);
    assert.equal(notes.length, 0, 'single input selection must remain unchanged');
    await midi.setInput('all');
    assert.equal(midi.inputId, 'all');
    first.receive([0x90, 60, 100]);
    second.receive([0x90, 60, 110]);
    first.receive([0xb0, 64, 127]);
    second.receive([0xb0, 64, 127]);
    assert.deepEqual(notes.map(note => note.deviceId), ['first', 'second']);
    first.state = 'disconnected';
    access.dispatchEvent(new Event('statechange'));
    assert.deepEqual(notes.at(-1), { midi: 60, velocity: 0, on: false, channel: 0, deviceId: 'first', synthetic: true, reason: 'device-detached' });
    assert.equal(notes.filter(note => !note.on && note.deviceId === 'second').length, 0);
    assert.deepEqual(pedals.at(-1), { value: false, channel: 0, deviceId: 'first', synthetic: true, reason: 'device-detached' });
    assert.ok(messages.some(message => message.type === 'cc' && message.value === 0 && message.deviceId === 'first'));
    const count = notes.length;
    first.receive([0x90, 72, 100]);
    assert.equal(notes.length, count, 'removed device listener must be detached');
    access.inputs.set(third.id, third);
    access.dispatchEvent(new Event('statechange'));
    await midi._refresh();
    third.receive([0x90, 64, 100]);
    assert.equal(notes.at(-1).deviceId, 'third');
    await midi.setInput('second');
    assert.equal(midi.inputId, 'second');
    assert.deepEqual(notes.at(-1), { midi: 64, velocity: 0, on: false, channel: 0, deviceId: 'third', synthetic: true, reason: 'device-detached' });
    assert.equal(notes.filter(note => !note.on && note.deviceId === 'second').length, 0, 'keeping one selected device must keep its held notes');
    second.receive([0x80, 60, 0]);
    assert.equal(notes.at(-1).deviceId, 'second');
    await midi.disconnect();
    assert.equal(midi.inputId, null);
    assert.equal(midi._inputBindings.size, 0);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});
