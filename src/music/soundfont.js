const VENDOR_MODULE = new URL('../vendor/spessasynth.js', import.meta.url);
const WORKLET_MODULE = new URL('../vendor/spessasynth_processor.min.js', import.meta.url);
const registeredWorklets = new WeakMap();
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const channelNumber = value => clamp(Math.round(Number(value) || 0), 0, 15);
const programNumber = value => clamp(Math.round(Number(value) || 0), 0, 127);

function validateBank(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 12) throw new Error('Selecione um banco SoundFont SF2 ou SF3 válido.');
  if (buffer.byteLength > 256 * 1024 * 1024) throw new Error('O banco SoundFont excede o limite de 256 MB.');
  const header = new TextDecoder('ascii').decode(new Uint8Array(buffer, 0, 12));
  if (header.slice(0, 4) !== 'RIFF' || header.slice(8, 12) !== 'sfbk') throw new Error('O arquivo não é um banco SoundFont SF2/SF3.');
}

/**
 * Offline SF2/SF3 sample synthesis, powered by locally bundled SpessaSynth.
 * Supply an authorized SoundFont ArrayBuffer; no bank or decoder is downloaded.
 * `context` may be shared with AudioEngine so its metronome keeps the same clock.
 */
export class SoundFontEngine {
  constructor({ context = null, volume = 0.75, maxVoices = 128 } = {}) {
    this.context = context;
    this.volume = clamp(Number(volume) || 0, 0, 1);
    this.maxVoices = clamp(Math.round(Number(maxVoices)) || 128, 16, 256);
    this.ready = false;
    this.presets = [];
    this.onError = () => {};
    this._ownsContext = !context;
    this._synth = null;
    this._gain = null;
    this._programs = new Map();
    this._loading = null;
    this._cancelLoading = null;
    this._disposed = false;
    this._token = 0;
  }

  async init(arrayBuffer) {
    if (this._loading) throw new Error('Aguarde o carregamento do banco SoundFont atual.');
    if (arrayBuffer === undefined && this.ready) {
      if (this.context.state === 'suspended' || this.context.state === 'interrupted') await this.context.resume();
      return this;
    }
    validateBank(arrayBuffer);
    if (this._disposed) throw new Error('Este mecanismo de áudio já foi encerrado.');
    this._loading = this._load(arrayBuffer);
    try { await this._loading; return this; }
    finally { this._loading = null; }
  }

  async _load(arrayBuffer) {
    this._destroySynth();
    try {
      if (!this.context || this.context.state === 'closed') {
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Context) throw new Error('Este ambiente não oferece suporte a Web Audio.');
        this.context = new Context({ latencyHint: 'interactive' });
        this._ownsContext = true;
      }
      if (!this.context.audioWorklet) throw new Error('AudioWorklet não está disponível neste ambiente.');
      // Resume before awaiting bank parsing: suspended worklets cannot initialize.
      if (this.context.state === 'suspended' || this.context.state === 'interrupted') await this.context.resume();
      const { WorkletSynthesizer } = await import(VENDOR_MODULE.href);
      if (this._disposed) throw new Error('Carregamento SoundFont cancelado.');
      if (!registeredWorklets.has(this.context)) {
        const registration = this.context.audioWorklet.addModule(WORKLET_MODULE.href);
        registeredWorklets.set(this.context, registration);
        registration.catch(() => registeredWorklets.delete(this.context));
      }
      await registeredWorklets.get(this.context);
      if (this._disposed) throw new Error('Carregamento SoundFont cancelado.');

      const synth = new WorkletSynthesizer(this.context, { eventsEnabled: true });
      this._synth = synth;
      synth.setLogLevel(false, true, false);
      this._gain = this.context.createGain();
      this._gain.gain.value = this.volume;
      this._gain.connect(this.context.destination);
      synth.connect(this._gain);

      let timer;
      let rejectLoad;
      const failures = new Promise((_, reject) => { rejectLoad = reject; });
      this._cancelLoading = () => rejectLoad(new Error('Carregamento SoundFont cancelado.'));
      const failBank = error => rejectLoad(new Error(`Não foi possível ler o SoundFont: ${error?.message || error || 'arquivo inválido'}`));
      const failProcessor = () => {
        const error = new Error('O processador de áudio SoundFont parou. Recarregue o banco ou selecione o sintetizador interno.');
        this.ready = false;
        rejectLoad(error);
        this.onError(error);
      };
      synth.eventHandler.addEvent('soundBankError', 'pianocraft-bank-error', failBank);
      synth.worklet.addEventListener('processorerror', failProcessor);
      this._processorError = failProcessor;
      timer = setTimeout(() => rejectLoad(new Error('O banco SoundFont demorou demais para carregar. Experimente um banco menor.')), 60000);
      try {
        await Promise.race([synth.isReady, failures]);
        // SpessaSynth transfers ownership of this buffer to the audio thread.
        // Keep the caller's copy intact for persistence or another engine.
        await Promise.race([synth.soundBankManager.addSoundBank(arrayBuffer.slice(0), 'pianocraft-main'), failures]);
        if (this._disposed) throw new Error('Carregamento SoundFont cancelado.');
        synth.setSystemParameter('voiceCap', this.maxVoices);
        this.presets = synth.presetList.map(preset => ({ ...preset }));
        this.ready = true;
      } finally {
        clearTimeout(timer);
        this._cancelLoading = null;
        synth.eventHandler.removeEvent('soundBankError', 'pianocraft-bank-error');
      }
    } catch (cause) {
      this._destroySynth();
      if (this._ownsContext && this.context && this.context.state !== 'closed') await this.context.close();
      if (this._ownsContext) this.context = null;
      throw new Error(`Falha ao carregar SoundFont. ${cause.message || cause}`, { cause });
    }
  }

  noteOn(midi, velocity = 0.8, channel = 0, program = 0) {
    midi = Math.round(Number(midi));
    velocity = Number(velocity);
    if (!this.ready || !Number.isFinite(midi) || midi < 0 || midi > 127 || !Number.isFinite(velocity)) return null;
    const chan = channelNumber(channel);
    const vel = clamp(Math.round(velocity <= 1 ? velocity * 127 : velocity), 0, 127);
    if (!vel) { this.noteOff(midi, chan); return null; }
    const selectedProgram = programNumber(program);
    if (this._programs.get(chan) !== selectedProgram) {
      this._synth.programChange(chan, selectedProgram);
      this._programs.set(chan, selectedProgram);
    }
    this._synth.noteOn(chan, midi, vel);
    return ++this._token;
  }

  noteOff(midi, channel = 0) {
    midi = Math.round(Number(midi));
    if (!this.ready || !Number.isFinite(midi) || midi < 0 || midi > 127) return;
    this._synth.noteOff(channelNumber(channel), midi);
  }

  setSustain(enabled, channel = 0) {
    if (this.ready) this._synth.controllerChange(channelNumber(channel), 64, enabled ? 127 : 0);
  }

  controlChange(controller, value, channel = 0) {
    if (!this.ready || !Number.isFinite(Number(controller)) || !Number.isFinite(Number(value))) return;
    this._synth.controllerChange(channelNumber(channel), programNumber(controller), programNumber(value));
  }

  pitchBend(value, channel = 0) {
    if (!this.ready || !Number.isFinite(Number(value))) return;
    this._synth.pitchWheel(channelNumber(channel), clamp(Math.round(Number(value)), 0, 16383));
  }

  aftertouch(value, channel = 0) {
    if (this.ready && Number.isFinite(Number(value))) this._synth.channelPressure(channelNumber(channel), programNumber(value));
  }

  polyAftertouch(midi, value, channel = 0) {
    if (this.ready && Number.isFinite(Number(midi)) && Number.isFinite(Number(value))) this._synth.polyPressure(channelNumber(channel), programNumber(midi), programNumber(value));
  }

  programChange(program, channel = 0) {
    if (!this.ready || !Number.isFinite(Number(program))) return;
    const chan = channelNumber(channel), selected = programNumber(program);
    this._synth.programChange(chan, selected);
    this._programs.set(chan, selected);
  }

  setVolume(volume) {
    if (!Number.isFinite(Number(volume))) return;
    this.volume = clamp(Number(volume), 0, 1);
    if (this._gain && this.context.state !== 'closed') this._gain.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.015);
  }

  allNotesOff() {
    if (!this._synth) return;
    for (let channel = 0; channel < 16; channel++) this._synth.controllerChange(channel, 64, 0);
    this._synth.stopAll(true);
  }

  _destroySynth() {
    this.ready = false;
    this.presets = [];
    this._programs.clear();
    if (this._synth) {
      this.allNotesOff();
      if (this._processorError) this._synth.worklet.removeEventListener('processorerror', this._processorError);
      this._synth.destroy();
      this._synth = null;
    }
    this._gain?.disconnect();
    this._gain = null;
    this._processorError = null;
  }

  async dispose() {
    this._disposed = true;
    this._cancelLoading?.();
    if (this._loading) await this._loading.catch(() => {});
    this._destroySynth();
    if (this._ownsContext && this.context && this.context.state !== 'closed') await this.context.close();
    this.context = null;
  }
}

export default SoundFontEngine;
