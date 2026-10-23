const FLOOR = 0.0001;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const midiVelocity = value => clamp(Number(value) > 1 ? Number(value) / 127 : Number(value), 0, 1);

function instrumentFor(program) {
  const family = Math.floor(clamp(Math.round(Number(program) || 0), 0, 127) / 8);
  if (family === 0) return { wave: 'piano', attack: 0.004, decay: 5.5, sustain: 0.007, release: 0.22, bright: 7200, detune: 0.7 };
  if (family === 1) return { wave: 'bell', attack: 0.003, decay: 3.2, sustain: 0.002, release: 0.3, bright: 10000, detune: 0 };
  if (family === 2) return { wave: 'organ', attack: 0.012, decay: 0.08, sustain: 0.8, release: 0.11, bright: 9000, detune: 0 };
  if (family === 3) return { wave: 'triangle', attack: 0.003, decay: 2.1, sustain: 0.015, release: 0.16, bright: 4800, detune: 0 };
  if (family === 4) return { wave: 'triangle', attack: 0.006, decay: 2, sustain: 0.09, release: 0.12, bright: 1800, detune: 0 };
  if (family === 5 || family === 6) return { wave: 'sawtooth', attack: 0.12, decay: 0.8, sustain: 0.62, release: 0.45, bright: 3300, detune: 5 };
  if (family === 7) return { wave: 'sawtooth', attack: 0.045, decay: 0.5, sustain: 0.55, release: 0.16, bright: 4000, detune: 1.5 };
  if (family === 8) return { wave: 'triangle', attack: 0.03, decay: 0.35, sustain: 0.65, release: 0.13, bright: 4900, detune: 1 };
  if (family === 9) return { wave: 'sine', attack: 0.045, decay: 0.4, sustain: 0.65, release: 0.17, bright: 4500, detune: 1.2 };
  if (family === 10) return { wave: 'sawtooth', attack: 0.012, decay: 0.3, sustain: 0.5, release: 0.18, bright: 6000, detune: 4 };
  if (family === 11 || family === 12) return { wave: 'triangle', attack: 0.35, decay: 1, sustain: 0.55, release: 0.8, bright: 3200, detune: 7 };
  if (family === 13) return { wave: 'piano', attack: 0.003, decay: 1.8, sustain: 0.01, release: 0.18, bright: 5400, detune: 2 };
  return { wave: 'bell', attack: 0.002, decay: 0.65, sustain: 0.001, release: 0.1, bright: 9000, detune: 0 };
}

/** A self-contained synthesizer. Call init() from a user gesture before playing. */
export class AudioEngine {
  constructor({ maxVoices = 64, volume = 0.75 } = {}) {
    this.context = null;
    this.maxVoices = clamp(Math.round(maxVoices) || 64, 1, 256);
    this.volume = clamp(Number(volume) || 0, 0, 1);
    this.voices = new Map();
    this._sustain = new Set();
    this._clicks = new Set();
    this._waves = new Map();
    this._channels = new Map();
    this._nextId = 1;
    this._initializing = null;
  }

  async init() {
    if (this._initializing) { await this._initializing; return this; }
    this._initializing = this._initialize();
    try { await this._initializing; return this; }
    finally { this._initializing = null; }
  }

  async _initialize() {
    if (!this.context || this.context.state === 'closed') {
      for (const voice of [...this.voices.values()]) this._cleanup(voice);
      this._waves.clear();
      this._channels.clear();
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new Error('Este ambiente não oferece suporte a áudio Web Audio.');
      this.context = new Context({ latencyHint: 'interactive' });
      this._master = this.context.createGain();
      this._master.gain.value = this.volume * 0.7;
      this._compressor = this.context.createDynamicsCompressor();
      this._compressor.threshold.value = -16;
      this._compressor.knee.value = 18;
      this._compressor.ratio.value = 5;
      this._compressor.attack.value = 0.003;
      this._compressor.release.value = 0.2;
      this._master.connect(this._compressor);
      this._compressor.connect(this.context.destination);
    }
    if (this.context.state === 'suspended' || this.context.state === 'interrupted') await this.context.resume();
  }

  _wave(name) {
    if (this._waves.has(name)) return this._waves.get(name);
    const partials = name === 'piano'
      ? [0, 1, 0.44, 0.2, 0.12, 0.065, 0.04, 0.025, 0.013]
      : name === 'organ'
        ? [0, 1, 0.32, 0.3, 0.12, 0.08, 0.04]
        : [0, 1, 0.08, 0.35, 0.025, 0.13, 0.015, 0.06];
    const wave = this.context.createPeriodicWave(new Float32Array(partials.length), new Float32Array(partials));
    this._waves.set(name, wave);
    return wave;
  }

  _channel(channel) {
    if (this._channels.has(channel)) return this._channels.get(channel);
    const gain = this.context.createGain();
    const pan = this.context.createStereoPanner?.();
    if (pan) { gain.connect(pan); pan.connect(this._master); }
    else gain.connect(this._master);
    const state = { gain, pan, volume: 127, expression: 127, pressure: 0, bend: 8192, bendRange: 2, rpnMSB: 127, rpnLSB: 127 };
    this._channels.set(channel, state);
    return state;
  }

  _bendCents(state) {
    return ((state.bend - 8192) / (state.bend >= 8192 ? 8191 : 8192)) * state.bendRange * 100;
  }

  _channelGain(state) {
    state.gain.gain.setTargetAtTime((state.volume / 127) * (state.expression / 127) * (1 + state.pressure / 127 * 0.15), this.context.currentTime, 0.015);
  }

  noteOn(midi, velocity = 0.8, channel = 0, program = 0) {
    midi = Math.round(Number(midi));
    channel = clamp(Math.round(Number(channel) || 0), 0, 15);
    velocity = midiVelocity(velocity);
    if (!Number.isFinite(midi) || midi < 0 || midi > 127 || !Number.isFinite(velocity)) return null;
    if (velocity <= 0) { this.noteOff(midi, channel); return null; }
    const ctx = this.context;
    if (!ctx || ctx.state === 'closed') return null;
    if (this.voices.size >= this.maxVoices) {
      const oldest = [...this.voices.values()].find(voice => !voice.keyDown) || this.voices.values().next().value;
      this._release(oldest, 0.008, true);
      this.voices.delete(oldest.id);
    }

    const time = ctx.currentTime;
    const instrument = instrumentFor(program);
    const channelState = this._channel(channel);
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.35;
    const bright = Math.min(ctx.sampleRate * 0.43, Math.max(frequency * 2, instrument.bright * (0.35 + velocity * 0.65)));
    filter.frequency.setValueAtTime(bright, time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(100, bright * 0.48), time + Math.min(2, instrument.decay));
    filter.connect(gain);
    gain.connect(channelState.gain);

    const peak = 0.18 * velocity ** 1.45;
    const decay = instrument.decay * clamp(1.4 - (midi - 36) / 100, 0.55, 1.6);
    const sustain = Math.max(FLOOR, peak * instrument.sustain);
    gain.gain.setValueAtTime(FLOOR, time);
    gain.gain.linearRampToValueAtTime(peak, time + instrument.attack);
    gain.gain.exponentialRampToValueAtTime(sustain, time + instrument.attack + decay);

    const oscillators = [];
    for (let index = 0; index < 2; index++) {
      const oscillator = ctx.createOscillator();
      const mix = ctx.createGain();
      if (['piano', 'organ', 'bell'].includes(instrument.wave)) oscillator.setPeriodicWave(this._wave(instrument.wave));
      else oscillator.type = instrument.wave;
      oscillator.frequency.value = frequency;
      const baseDetune = index ? instrument.detune : -instrument.detune;
      oscillator.detune.value = baseDetune + this._bendCents(channelState);
      mix.gain.value = index ? 0.27 : 0.73;
      oscillator.connect(mix);
      mix.connect(filter);
      oscillators.push({ oscillator, mix, baseDetune });
    }
    const voice = {
      id: this._nextId++, midi, channel, gain, filter, oscillators, peak, sustain,
      start: time, attack: instrument.attack, decay, release: instrument.release,
      keyDown: true, released: false, cleaned: false,
    };
    this.voices.set(voice.id, voice);
    oscillators[0].oscillator.onended = () => this._cleanup(voice);
    for (const { oscillator } of oscillators) {
      oscillator.start(time);
      // Percussive voices eventually become silent even when a MIDI file omits note-off.
      if (instrument.sustain < 0.1) oscillator.stop(time + instrument.attack + decay + 9);
    }
    return voice.id;
  }

  noteOff(midi, channel = 0) {
    midi = Math.round(Number(midi));
    channel = clamp(Math.round(Number(channel) || 0), 0, 15);
    const voice = [...this.voices.values()].find(item => item.midi === midi && item.channel === channel && item.keyDown);
    if (!voice) return;
    voice.keyDown = false;
    if (!this._sustain.has(channel)) this._release(voice);
  }

  _levelAt(voice, time) {
    const elapsed = Math.max(0, time - voice.start);
    if (elapsed <= voice.attack) return FLOOR + (voice.peak - FLOOR) * elapsed / voice.attack;
    const progress = clamp((elapsed - voice.attack) / voice.decay, 0, 1);
    return voice.peak * (voice.sustain / voice.peak) ** progress;
  }

  _release(voice, duration = voice?.release, force = false) {
    if (!voice || (voice.released && !force) || voice.cleaned || !this.context) return;
    voice.released = true;
    voice.keyDown = false;
    const time = this.context.currentTime;
    const parameter = voice.gain.gain;
    if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(time);
    else {
      parameter.cancelScheduledValues(time);
      parameter.setValueAtTime(Math.max(FLOOR, this._levelAt(voice, time)), time);
    }
    parameter.exponentialRampToValueAtTime(FLOOR, time + duration);
    for (const { oscillator } of voice.oscillators) {
      try { oscillator.stop(time + duration + 0.015); } catch { /* Already stopped. */ }
    }
  }

  _cleanup(voice) {
    if (voice.cleaned) return;
    voice.cleaned = true;
    this.voices.delete(voice.id);
    for (const { oscillator, mix } of voice.oscillators) {
      oscillator.onended = null;
      try { oscillator.stop(); } catch { /* Already stopped. */ }
      oscillator.disconnect();
      mix.disconnect();
    }
    voice.filter.disconnect();
    voice.gain.disconnect();
  }

  setSustain(enabled, channel = 0) {
    channel = clamp(Math.round(Number(channel) || 0), 0, 15);
    if (enabled) this._sustain.add(channel);
    else {
      this._sustain.delete(channel);
      for (const voice of this.voices.values()) if (voice.channel === channel && !voice.keyDown) this._release(voice);
    }
  }

  setVolume(volume) {
    if (!Number.isFinite(Number(volume))) return;
    this.volume = clamp(Number(volume), 0, 1);
    if (this.context && this.context.state !== 'closed') this._master.gain.setTargetAtTime(this.volume * 0.7, this.context.currentTime, 0.015);
  }

  pitchBend(value, channel = 0) {
    if (!this.context || this.context.state === 'closed' || !Number.isFinite(Number(value))) return;
    channel = clamp(Math.round(Number(channel) || 0), 0, 15);
    const state = this._channel(channel);
    state.bend = clamp(Math.round(Number(value)), 0, 16383);
    const cents = this._bendCents(state);
    for (const voice of this.voices.values()) {
      if (voice.channel !== channel) continue;
      for (const { oscillator, baseDetune } of voice.oscillators) oscillator.detune.setTargetAtTime(baseDetune + cents, this.context.currentTime, 0.008);
    }
  }

  controlChange(controller, value, channel = 0) {
    if (!this.context || this.context.state === 'closed' || !Number.isFinite(Number(controller)) || !Number.isFinite(Number(value))) return;
    channel = clamp(Math.round(Number(channel) || 0), 0, 15);
    controller = clamp(Math.round(Number(controller)), 0, 127);
    value = clamp(Math.round(Number(value)), 0, 127);
    const state = this._channel(channel);
    if (controller === 64) this.setSustain(value >= 64, channel);
    else if (controller === 7 || controller === 11) {
      state[controller === 7 ? 'volume' : 'expression'] = value;
      this._channelGain(state);
    } else if (controller === 10) state.pan?.pan.setTargetAtTime((value - 64) / (value >= 64 ? 63 : 64), this.context.currentTime, 0.015);
    else if (controller === 101) state.rpnMSB = value;
    else if (controller === 100) state.rpnLSB = value;
    else if (controller === 6 && state.rpnMSB === 0 && state.rpnLSB === 0) {
      state.bendRange = value;
      this.pitchBend(state.bend, channel);
    } else if (controller === 121) {
      state.expression = 127;
      state.pressure = 0;
      this._channelGain(state);
      this.setSustain(false, channel);
      this.pitchBend(8192, channel);
    } else if (controller === 120 || controller === 123) {
      for (const voice of this.voices.values()) {
        if (voice.channel !== channel) continue;
        voice.keyDown = false;
        if (controller === 120 || !this._sustain.has(channel)) this._release(voice, controller === 120 ? 0.008 : voice.release, controller === 120);
      }
    }
  }

  aftertouch(value, channel = 0) {
    if (!this.context || this.context.state === 'closed' || !Number.isFinite(Number(value))) return;
    const state = this._channel(clamp(Math.round(Number(channel) || 0), 0, 15));
    state.pressure = clamp(Math.round(Number(value)), 0, 127);
    this._channelGain(state);
  }

  polyAftertouch(midi, value, channel = 0) {
    if (!this.context || this.context.state === 'closed' || !Number.isFinite(Number(value))) return;
    for (const voice of this.voices.values()) if (voice.midi === Number(midi) && voice.channel === Number(channel)) voice.filter.Q.setTargetAtTime(0.35 + clamp(Number(value), 0, 127) / 127 * 1.4, this.context.currentTime, 0.02);
  }

  allNotesOff() {
    this._sustain.clear();
    for (const voice of this.voices.values()) this._release(voice, 0.025, true);
  }

  click(accent = false, when) {
    if (!this.context || this.context.state === 'closed') return;
    const time = Number.isFinite(when)?Math.max(this.context.currentTime,when):this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(accent ? 1760 : 1174, time);
    oscillator.frequency.exponentialRampToValueAtTime(accent ? 1100 : 760, time + 0.025);
    gain.gain.setValueAtTime(accent ? 0.22 : 0.14, time);
    gain.gain.exponentialRampToValueAtTime(FLOOR, time + 0.055);
    oscillator.connect(gain);
    gain.connect(this._master);
    const click = { oscillator, gain };
    this._clicks.add(click);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      this._clicks.delete(click);
    };
    oscillator.start(time);
    oscillator.stop(time + 0.065);
  }

  /** Short local feedback; never starts/resumes audio or sends MIDI messages. */
  completionChime() {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this._master) return false;
    const start = ctx.currentTime;
    for (const [index, frequency] of [659.25, 830.61, 987.77].entries()) {
      const time = start + index * 0.065;
      const oscillator = ctx.createOscillator(), gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, time);
      gain.gain.setValueAtTime(FLOOR, time);
      gain.gain.linearRampToValueAtTime(0.035, time + 0.006);
      gain.gain.exponentialRampToValueAtTime(FLOOR, time + 0.11);
      oscillator.connect(gain); gain.connect(this._master);
      const click = { oscillator, gain };
      this._clicks.add(click);
      oscillator.onended = () => {
        oscillator.disconnect(); gain.disconnect(); this._clicks.delete(click);
      };
      oscillator.start(time); oscillator.stop(time + 0.12);
    }
    return true;
  }

  stopClicks() {
    for(const click of this._clicks){click.oscillator.onended=null;try{click.oscillator.stop();}catch{}click.oscillator.disconnect();click.gain.disconnect();}
    this._clicks.clear();
  }

  async dispose() {
    if (this._initializing) await this._initializing.catch(() => {});
    for (const voice of [...this.voices.values()]) this._cleanup(voice);
    for (const { oscillator, gain } of this._clicks) {
      oscillator.onended = null;
      try { oscillator.stop(); } catch { /* Already stopped. */ }
      oscillator.disconnect();
      gain.disconnect();
    }
    this._clicks.clear();
    this._sustain.clear();
    this._waves.clear();
    for (const state of this._channels.values()) { state.gain.disconnect(); state.pan?.disconnect(); }
    this._channels.clear();
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') await context.close();
  }
}

export default AudioEngine;
