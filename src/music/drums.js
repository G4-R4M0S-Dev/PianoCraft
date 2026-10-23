/** Original synthesized percussion: no third-party recordings or sound banks. */
const FLOOR = 0.0001;
const LOOK_AHEAD = 0.2;
const INTERVAL_MS = 25;
const START_DELAY = 0.03;
const MAX_VOICES = 64;
const EPSILON = 1e-7;
export const patterns = Object.freeze([
  Object.freeze({ id: 'metronome', name: 'Metrônomo', meter: '4/4' }),
  Object.freeze({ id: 'pop', name: 'Pop', meter: '4/4' }),
  Object.freeze({ id: 'rock', name: 'Rock', meter: '4/4' }),
  Object.freeze({ id: 'waltz', name: 'Valsa', meter: '3/4' }),
]);
export const DRUM_PATTERNS = patterns;
function tempo(value) {
  if (!Number.isFinite(value) || value < 10 || value > 400) throw new Error('O andamento da bateria precisa estar entre 10 e 400 BPM.');
  return value;
}
function volume(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('O volume da bateria precisa estar entre 0 e 1.');
  return value;
}

/**
 * Web Audio clock drives a 200 ms scheduling window, serviced every 25 ms.
 * A long event-loop stall skips missed beats instead of playing them in a burst.
 * onBeat({time,beat,bar,accent,pattern}) reports beats after their audio timestamp;
 * callback/UI timing may lag if the application is in the background.
 * The supplied AudioContext is shared and is never closed by this class.
 */
export class DrumMachine {
  constructor({ context, onBeat = null, timers = globalThis } = {}) {
    if (!context || typeof context.createGain !== 'function' || typeof context.createBuffer !== 'function') throw new TypeError('DrumMachine precisa de um AudioContext inicializado.');
    this.context = context;
    this.onBeat = onBeat;
    this.bpm = 120;
    this.pattern = 'pop';
    this.volume = 0.25;
    this._timers = timers;
    this._running = false;
    this._disposed = false;
    this._timer = null;
    this._voices = new Set();
    this._beatQueue = [];
    this._beat = 0;
    this._bar = 0;
    this._epoch = 0;
    this._error = null;
    this._master = context.createGain();
    this._master.gain.value = 0;
    this._master.connect(context.destination);
    this._noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.35), context.sampleRate);
    const data = this._noise.getChannelData(0);
    let state = 0x50a17c3f;
    for (let index = 0; index < data.length; index++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      data[index] = (state >>> 0) / 0x80000000 - 1;
    }
  }

  get running() { return this._running; }
  get status() {
    return { state: this._disposed ? 'disposed' : this._error ? 'error' : this._running ? (this.context.state === 'suspended' ? 'suspended' : 'playing') : 'stopped', running: this._running, bpm: this.bpm, pattern: this.pattern, volume: this.volume, beat: this._beat, bar: this._bar, voices: this._voices.size, error: this._error };
  }

  async start({ bpm = 120, pattern = 'pop', volume: level = 0.25 } = {}) {
    if (this._disposed) throw new Error('A bateria já foi descartada.');
    tempo(bpm); volume(level);
    if (!patterns.some(item => item.id === pattern)) throw new Error('Padrão de bateria desconhecido.');
    if (this.context.state === 'closed') throw new Error('O AudioContext da bateria está fechado.');
    this.stop();
    this._error = null;
    this.bpm = bpm;
    this.pattern = pattern;
    this.volume = level;
    const epoch = this._epoch;
    if (this.context.state === 'suspended' || this.context.state === 'interrupted') {
      try { await this.context.resume(); }
      catch (error) { this._error = error.message || 'Não foi possível iniciar o áudio.'; throw error; }
      if (this._disposed || epoch !== this._epoch) return this.status;
    }
    this._anchorTime = this.context.currentTime + START_DELAY;
    this._anchorStep = 0;
    this._nextStep = 0;
    this._beat = 0;
    this._bar = 0;
    this._running = true;
    this.setVolume(level);
    this._tick();
    this._timer = this._timers.setInterval(() => this._tick(), INTERVAL_MS);
    this._timer?.unref?.();
    return this.status;
  }

  stop() {
    this._epoch++;
    this._running = false;
    if (this._timer !== null) this._timers.clearInterval(this._timer);
    this._timer = null;
    this._beatQueue = [];
    for (const voice of [...this._voices]) this._cleanup(voice, true);
    if (this._master && this.context) {
      this._master.gain.cancelScheduledValues(this.context.currentTime);
      this._master.gain.setValueAtTime(0, this.context.currentTime);
    }
    return this.status;
  }

  setTempo(value) {
    tempo(value);
    if (this._disposed) throw new Error('A bateria já foi descartada.');
    if (this._running) {
      const now = this.context.currentTime;
      const position = this._position(now);
      // Retain the current musical phase while cancelling future sources that
      // had been scheduled at the old tempo. Currently sounding tails may end.
      for (const voice of [...this._voices]) if (voice.start > now + EPSILON) this._cleanup(voice, true);
      this._beatQueue = this._beatQueue.filter(event => event.time <= now);
      if (now >= this._anchorTime) { this._anchorTime = now; this._anchorStep = position; }
      this._nextStep = Math.max(0, Math.ceil(position + EPSILON));
    }
    this.bpm = value;
    if (this._running) this._tick();
    return this.bpm;
  }

  setVolume(value) {
    volume(value);
    if (this._disposed) throw new Error('A bateria já foi descartada.');
    this.volume = value;
    if (this._running) this._master.gain.setTargetAtTime(value * 0.7, this.context.currentTime, 0.015);
    return this.volume;
  }

  dispose() {
    if (this._disposed) return;
    this.stop();
    this._master.disconnect();
    this._master = null;
    this._noise = null;
    this.onBeat = null;
    this._disposed = true;
  }

  _position(time) { return this._anchorStep + (time - this._anchorTime) / (30 / this.bpm); }
  _time(step) { return this._anchorTime + (step - this._anchorStep) * (30 / this.bpm); }

  _tick() {
    if (!this._running || this._disposed) return;
    if (this.context.state === 'closed') { this.stop(); this._error = 'O dispositivo de áudio foi fechado.'; return; }
    if (this.context.state === 'suspended' || this.context.state === 'interrupted') return;
    const now = this.context.currentTime;
    for (const voice of [...this._voices]) if (voice.end < now) this._cleanup(voice, false);
    while (this._beatQueue.length && this._beatQueue[0].time <= now) {
      const event = this._beatQueue.shift();
      this._beat = event.beat;
      this._bar = event.bar;
      if (typeof this.onBeat === 'function' && now - event.time < 0.15) {
        try { this.onBeat({ ...event }); } catch { /* A display callback cannot interrupt the audio clock. */ }
      }
    }
    if (this._time(this._nextStep) < now - 0.01) this._nextStep = Math.max(this._nextStep, Math.ceil(this._position(now) + EPSILON));
    const beats = this.pattern === 'waltz' ? 3 : 4;
    let iterations = 0;
    while (this._time(this._nextStep) < now + LOOK_AHEAD && iterations++ < 64) {
      const step = this._nextStep++;
      const within = step % (beats * 2);
      const when = Math.max(now + 0.002, this._time(step));
      const accent = within === 0;
      if (within % 2 === 0) this._beatQueue.push({ time: when, beat: within / 2, bar: Math.floor(step / (beats * 2)), accent, pattern: this.pattern });
      if (this.pattern === 'metronome') {
        if (within % 2 === 0) this._click(when, accent);
      } else {
        this._hat(when, within % 2 === 0 ? 1 : 0.65);
        if (this.pattern === 'waltz') {
          if (within === 0) this._kick(when);
          if (within === 2 || within === 4) this._snare(when, 0.45);
        } else {
          if (within === 0 || within === 4 || (this.pattern === 'rock' && within === 3)) this._kick(when);
          if (within === 2 || within === 6) this._snare(when, 1);
        }
      }
    }
  }

  _envelope(gain, time, amplitude, decay) {
    gain.gain.setValueAtTime(FLOOR, time);
    gain.gain.linearRampToValueAtTime(amplitude, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(FLOOR, time + decay);
  }

  _voice(nodes, sources, start, end) {
    while (this._voices.size >= MAX_VOICES) this._cleanup(this._voices.values().next().value, true);
    const voice = { nodes, sources, start, end, ended: 0 };
    this._voices.add(voice);
    for (const source of sources) {
      source.onended = () => { if (++voice.ended >= sources.length) this._cleanup(voice, false); };
      source.start(start);
      source.stop(end);
    }
  }

  _cleanup(voice, stop) {
    if (!voice || !this._voices.delete(voice)) return;
    for (const source of voice.sources) {
      source.onended = null;
      if (stop) try { source.stop(this.context.currentTime); } catch { /* It may already have ended. */ }
    }
    for (const node of voice.nodes) try { node.disconnect(); } catch { /* Idempotent shutdown. */ }
  }

  _kick(time) {
    const oscillator = this.context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(145, time);
    oscillator.frequency.exponentialRampToValueAtTime(48, time + 0.18);
    const gain = this.context.createGain();
    this._envelope(gain, time, 0.75, 0.28);
    oscillator.connect(gain); gain.connect(this._master);
    this._voice([oscillator, gain], [oscillator], time, time + 0.3);
  }

  _snare(time, strength) {
    const noise = this.context.createBufferSource(); noise.buffer = this._noise;
    const filter = this.context.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 1100;
    const noiseGain = this.context.createGain(); this._envelope(noiseGain, time, 0.35 * strength, 0.16);
    noise.connect(filter); filter.connect(noiseGain); noiseGain.connect(this._master);
    const body = this.context.createOscillator(); body.type = 'triangle'; body.frequency.value = 175;
    const bodyGain = this.context.createGain(); this._envelope(bodyGain, time, 0.16 * strength, 0.08);
    body.connect(bodyGain); bodyGain.connect(this._master);
    this._voice([noise, filter, noiseGain, body, bodyGain], [noise, body], time, time + 0.18);
  }

  _hat(time, strength) {
    const noise = this.context.createBufferSource(); noise.buffer = this._noise;
    const filter = this.context.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = Math.min(8000, this.context.sampleRate * 0.4);
    const gain = this.context.createGain(); this._envelope(gain, time, 0.1 * strength, 0.05);
    noise.connect(filter); filter.connect(gain); gain.connect(this._master);
    this._voice([noise, filter, gain], [noise], time, time + 0.07);
  }

  _click(time, accent) {
    const oscillator = this.context.createOscillator(); oscillator.type = 'sine'; oscillator.frequency.value = accent ? 1500 : 950;
    const gain = this.context.createGain(); this._envelope(gain, time, accent ? 0.24 : 0.16, 0.035);
    oscillator.connect(gain); gain.connect(this._master);
    this._voice([oscillator, gain], [oscillator], time, time + 0.045);
  }
}
