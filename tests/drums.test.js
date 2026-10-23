import test from 'node:test';
import assert from 'node:assert/strict';
import { DrumMachine, patterns } from '../src/music/drums.js';

class Parameter {
  constructor() { this.value = 0; this.events = []; }
  setValueAtTime(value, time) { this.events.push({ kind: 'set', value, time }); }
  linearRampToValueAtTime(value, time) { this.events.push({ kind: 'linear', value, time }); }
  exponentialRampToValueAtTime(value, time) { this.events.push({ kind: 'exponential', value, time }); }
  setTargetAtTime(value, time) { this.events.push({ kind: 'target', value, time }); }
  cancelScheduledValues() {}
}
class AudioNode {
  constructor(kind) { this.kind = kind; this.gain = new Parameter(); this.frequency = new Parameter(); this.stops = []; }
  connect(node) { this.destination = node; }
  disconnect() { this.disconnected = true; }
  start(time) { this.started = time; }
  stop(time) { this.stops.push(time); }
}
class Context {
  constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = {}; this.nodes = []; }
  node(kind) { const node = new AudioNode(kind); this.nodes.push(node); return node; }
  createGain() { return this.node('gain'); }
  createOscillator() { return this.node('oscillator'); }
  createBufferSource() { return this.node('noise'); }
  createBiquadFilter() { return this.node('filter'); }
  createBuffer(channels, size) { const data = new Float32Array(size); return { getChannelData: () => data }; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
  get sources() { return this.nodes.filter(node => node.started !== undefined); }
}
class Timers {
  constructor(context) { this.context = context; this.now = 0; this.next = 1; this.tasks = new Map(); }
  setInterval(callback, period) { const id = this.next++; this.tasks.set(id, { callback, period, time: this.now + period }); return id; }
  clearInterval(id) { this.tasks.delete(id); }
  tick(milliseconds) {
    const until = this.now + milliseconds;
    for (;;) {
      let entry;
      for (const candidate of this.tasks) if (candidate[1].time <= until && (!entry || candidate[1].time < entry[1].time)) entry = candidate;
      if (!entry) break;
      const [, task] = entry;
      this.now = task.time; this.context.currentTime = this.now / 1000;
      task.time += task.period;
      task.callback();
    }
    this.now = until; this.context.currentTime = until / 1000;
  }
  stall(milliseconds) {
    this.now += milliseconds; this.context.currentTime = this.now / 1000;
    for (const task of [...this.tasks.values()]) { task.time = this.now + task.period; task.callback(); }
  }
}
function setup(onBeat) {
  const context = new Context();
  const timers = new Timers(context);
  return { context, timers, drums: new DrumMachine({ context, timers, onBeat }) };
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} ≠ ${b}`);

test('drum audio uses ahead-of-time AudioContext timestamps independent of display callbacks', async () => {
  const beats = [];
  const { drums, context, timers } = setup(event => beats.push(event));
  await drums.start({ bpm: 120, pattern: 'metronome' });
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].started, 0.03);
  assert.equal(beats.length, 0);
  timers.tick(2000);
  assert.deepEqual(beats.map(event => event.beat), [0, 1, 2, 3]);
  for (let index = 1; index < beats.length; index++) close(beats[index].time - beats[index - 1].time, 0.5);
  assert.ok(context.sources.every(source => source.stops[0] > source.started));
  drums.dispose();
});

test('tempo changes cancel pending old beats and keep fractional musical phase', async () => {
  const { drums, context, timers } = setup();
  await drums.start({ bpm: 120, pattern: 'metronome' });
  timers.tick(400);
  const pending = context.sources.find(source => Math.abs(source.started - 0.53) < 1e-7);
  assert.ok(pending);
  drums.setTempo(60);
  assert.equal(pending.disconnected, true);
  close(pending.stops.at(-1), 0.4);
  timers.tick(300);
  const next = context.sources.find(source => Math.abs(source.started - 0.66) < 1e-7);
  assert.ok(next);
  drums.dispose();
});

test('a long scheduler stall skips missed beats without a burst of late percussion', async () => {
  const { drums, context, timers } = setup();
  await drums.start({ pattern: 'rock' });
  const prior = context.sources.length;
  timers.stall(5000);
  const newlyScheduled = context.sources.slice(prior);
  assert.ok(newlyScheduled.length > 0 && newlyScheduled.length < 10);
  assert.ok(newlyScheduled.every(source => source.started >= 5));
  assert.ok(drums.status.voices <= 64);
  drums.dispose();
});

test('waltz has three beats per bar and audible percussion differs from metronome', async () => {
  const beats = [];
  const { drums, context, timers } = setup(event => beats.push(event));
  await drums.start({ pattern: 'waltz' });
  timers.tick(2000);
  assert.deepEqual(beats.map(event => [event.beat, event.bar]), [[0, 0], [1, 0], [2, 0], [0, 1]]);
  assert.ok(context.sources.some(source => source.kind === 'noise'));
  assert.equal(patterns.find(pattern => pattern.id === 'waltz').meter, '3/4');
  drums.dispose();
});

test('stop and repeated restarts cancel all timers and pending sources', async () => {
  const { drums, context, timers } = setup();
  for (let index = 0; index < 20; index++) {
    await drums.start({ bpm: 200, pattern: 'pop' });
    assert.equal(timers.tasks.size, 1);
    timers.tick(35);
    drums.stop();
    assert.equal(timers.tasks.size, 0);
    assert.equal(drums.status.voices, 0);
  }
  assert.ok(context.sources.every(source => source.disconnected));
  const count = context.sources.length;
  timers.tick(2000);
  assert.equal(context.sources.length, count);
  drums.dispose();
  assert.equal(context.state, 'running');
  assert.equal(drums.status.state, 'disposed');
  await assert.rejects(drums.start(), /descartada/);
});

test('voice resources remain bounded during sustained fast playback and mute is exact', async () => {
  const { drums, context, timers } = setup(() => { throw new Error('display failure'); });
  await drums.start({ bpm: 400, pattern: 'rock' });
  timers.tick(30_000);
  assert.ok(drums.status.voices <= 64);
  assert.ok(context.sources.filter(source => !source.disconnected).length <= 128);
  drums.setVolume(0);
  assert.equal(drums.volume, 0);
  assert.equal(drums._master.gain.events.at(-1).value, 0);
  assert.equal(drums.running, true);
  drums.dispose();
});

test('suspended initialization respects stop before the audio context resumes', async () => {
  const { drums, context, timers } = setup();
  context.state = 'suspended';
  let resume;
  context.resume = () => new Promise(resolve => { resume = () => { context.state = 'running'; resolve(); }; });
  const pending = drums.start();
  drums.stop();
  resume();
  await pending;
  assert.equal(drums.running, false);
  assert.equal(timers.tasks.size, 0);
  drums.dispose();
});

test('drums reject invalid settings and stop when the shared audio context closes', async () => {
  assert.throws(() => new DrumMachine(), /AudioContext/);
  const { drums, context, timers } = setup();
  await assert.rejects(drums.start({ bpm: 0 }), /BPM/);
  await assert.rejects(drums.start({ pattern: 'missing' }), /Padrão/);
  assert.throws(() => drums.setVolume(2), /volume/);
  await drums.start();
  context.state = 'closed'; timers.tick(25);
  assert.equal(drums.status.state, 'error');
  assert.equal(timers.tasks.size, 0);
  assert.equal(drums.status.voices, 0);
  drums.dispose();
});
