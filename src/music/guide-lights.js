// Navigate uses documented MIDI notes; LK-S250 uses a separately recovered
// guide-only SysEx format. See docs/guide-lights.md for provenance and settings.
export const GUIDE_LIGHT_PROFILES = Object.freeze({
  // Recovered from the installed Synthesia profile -4; exact evidence and wire
  // constants are recorded in docs/evidence/guide-lights-static.json.
  'casio-lks250': Object.freeze({ id: 'casio-lks250', label: 'CASIO LK-S250', channel: 4,
    velocity: 1, noteOffset: 0, requiresSysex: true, minNote: 21, maxNote: 108, keepaliveMs: 180 }),
  'casio-navigate': Object.freeze({ id: 'casio-navigate', label: 'CASIO LK · Navigate', channel: 4, velocity: 1, noteOffset: 0 }),
  'midi-note': Object.freeze({ id: 'midi-note', label: 'Notas MIDI · canal configurável', channel: 1, velocity: 1, noteOffset: 0 }),
});

function integer(value, min, max, label) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max) throw new RangeError(`${label}: use um inteiro de ${min} a ${max}.`);
  return result;
}

/** A guide-only route. It never chooses a device or borrows the audio output. */
export class GuideLights {
  constructor({ onError = () => {}, onChange = () => {},
    setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = id => clearTimeout(id) } = {}) {
    this.onError = onError;
    this.onChange = onChange;
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._output = null;
    this._active = new Set();
    this._pendingOff = new Map();
    this._testTimer = null;
    this._testGeneration = 0;
    this._wakeTimer = null;
    this._wakeGeneration = 0;
    this._awake = false;
    this.profile = null;
    this.channel = 4; // Public MIDI channels are numbered 1..16.
    this.noteOffset = 0;
    this.velocity = 1;
    this.error = null;
    this._stateHandler = () => {
      if (this._output?.state === 'disconnected') this._disable(new Error('O dispositivo das luzes foi desconectado.'));
    };
  }

  get connected() { return Boolean(this._output && this._output.state !== 'disconnected'); }
  get outputId() { return this._output?.id ?? null; }
  get testing() { return this._testTimer !== null; }
  get activeNotes() { return [...this._active].sort((a, b) => a - b); }
  get status() {
    return { connected: this.connected, outputId: this.outputId, profile: this.profile, channel: this.channel,
      noteOffset: this.noteOffset, velocity: this.velocity, activeNotes: this.activeNotes, error: this.error?.message ?? null };
  }

  /** Accept a Web MIDI output, a native send(bytes) adapter, or a send function. */
  connect(output, profile = 'casio-navigate', channel, options = {}) {
    if (!output) { this.disconnect(); return false; }
    if (typeof profile === 'object' && profile !== null) {
      options = profile;
      channel = options.channel;
      profile = options.profile ?? 'casio-navigate';
    }
    const preset = GUIDE_LIGHT_PROFILES[profile];
    if (!preset) throw new RangeError('Perfil de iluminação desconhecido.');
    if (typeof output !== 'function' && typeof output.send !== 'function') throw new TypeError('Escolha uma saída MIDI para as luzes.');
    const settings = {
      channel: integer(channel ?? preset.channel, 1, 16, 'Canal das luzes'),
      velocity: integer(options.velocity ?? preset.velocity, 1, 127, 'Velocidade das luzes'),
      noteOffset: integer(options.noteOffset ?? preset.noteOffset, -127, 127, 'Deslocamento das luzes'),
    };
    this.disconnect();
    Object.assign(this, settings, { profile, error: null });
    this._output = output;
    output.addEventListener?.('statechange', this._stateHandler);
    if (preset.requiresSysex) {
      if (!this._send(this._wakeMessage())) return false;
      this._awake = true;
    }
    // Notes that could not be released during an unplug are released first when
    // the same port is explicitly selected again, even if its channel changed.
    const identity = this._identity(output);
    const pending = this._pendingOff.get(identity);
    if (pending) {
      for (const message of pending.values()) {
        try { this._write(message); pending.delete(message.join(':')); }
        catch (error) { this._disable(error); return false; }
      }
      this._pendingOff.delete(identity);
    }
    if (output.state === 'disconnected') { this._disable(new Error('A saída MIDI das luzes não está disponível.')); return false; }
    this._notify();
    return true;
  }

  /** Replace the lit keys; repeated animation frames emit no duplicate MIDI. */
  update(expectedMidiNotes = []) {
    this._cancelTest();
    if (!this._output) return false;
    if (this._output.state === 'disconnected') { this._stateHandler(); return false; }
    const desired = new Set();
    for (const note of expectedMidiNotes) {
      if (!Number.isInteger(note) || note < 0 || note > 127) continue;
      const shifted = note + this.noteOffset;
      const preset = GUIDE_LIGHT_PROFILES[this.profile];
      if (shifted >= (preset.minNote ?? 0) && shifted <= (preset.maxNote ?? 127)) desired.add(shifted);
    }
    if (desired.size && GUIDE_LIGHT_PROFILES[this.profile].requiresSysex && !this._awake) {
      if (!this._send(this._wakeMessage())) return false;
      this._awake = true;
    }
    let changed = false;
    for (const midi of this._active) {
      if (desired.has(midi)) continue;
      if (!this._send(this._lightMessage(midi, false))) return false;
      this._active.delete(midi);
      changed = true;
    }
    for (const midi of desired) {
      if (this._active.has(midi)) continue;
      // Register before writing so a transport that throws after delivery still
      // receives a best-effort Note Off for the attempted Note On.
      this._active.add(midi);
      if (!this._send(this._lightMessage(midi, true))) return false;
      changed = true;
    }
    if (this._active.size) this._scheduleWake();
    else this._stopWake();
    if (changed) this._notify();
    return true;
  }

  /** Call on pause, seek, song/mode/hand changes, stop and window shutdown. */
  allOff() {
    this._cancelTest();
    this._stopWake();
    if (!this._active.size) return true;
    let failure = null;
    for (const midi of this._active) {
      try { this._write(this._lightMessage(midi, false)); this._active.delete(midi); }
      catch (error) { failure ??= error; }
    }
    if (failure) { this._disable(failure); return false; }
    this._notify();
    return true;
  }

  /** A bounded hardware test; transitions cancel its timer and release its keys. */
  test(notes = [60, 64, 67], durationMs = 800) {
    const duration = integer(durationMs, 1, 10000, 'Duração do teste');
    this.allOff();
    if (!this.update(notes)) return false;
    const generation = this._testGeneration;
    this._testTimer = this._setTimer(() => {
      if (generation !== this._testGeneration) return;
      this._testTimer = null; this.allOff();
    }, duration);
    return true;
  }

  disconnect() {
    const released = this.allOff();
    this._detach();
    this._output = null;
    this._active.clear();
    this._notify();
    return released;
  }

  dispose() { return this.disconnect(); }

  _cancelTest() {
    this._testGeneration++;
    if (this._testTimer !== null) this._clearTimer(this._testTimer);
    this._testTimer = null;
  }

  _wakeMessage() { return [0xf0, 0x44, 0x7e, 0x7e, 0x7f, 0x00, 0x03, 0xf7]; }
  _lightMessage(midi, on) {
    return this.profile === 'casio-lks250'
      ? [0xf0, 0x44, 0x7e, 0x7e, 0x7f, 0x02, 0x00, midi, on ? 1 : 0, 0xf7]
      : [(on ? 0x90 : 0x80) | (this.channel - 1), midi, on ? this.velocity : 0];
  }

  _scheduleWake() {
    const preset = GUIDE_LIGHT_PROFILES[this.profile];
    if (!preset?.requiresSysex || this._wakeTimer !== null) return;
    const generation = this._wakeGeneration;
    this._wakeTimer = this._setTimer(() => {
      if (generation !== this._wakeGeneration) return;
      this._wakeTimer = null;
      if (this._active.size && this._send(this._wakeMessage())) this._scheduleWake();
    }, preset.keepaliveMs);
  }

  _stopWake() {
    this._awake = false;
    this._wakeGeneration++;
    if (this._wakeTimer !== null) this._clearTimer(this._wakeTimer);
    this._wakeTimer = null;
  }

  _identity(output) { return output?.id ? `port:${output.id}` : output; }
  _detach() { this._output?.removeEventListener?.('statechange', this._stateHandler); }
  _notify() { try { this.onChange(this.status); } catch { /* UI callbacks cannot prevent cleanup. */ } }

  _write(bytes) {
    if (!this._output || this._output.state === 'disconnected') throw new Error('A saída MIDI das luzes não está disponível.');
    const sent = typeof this._output === 'function' ? this._output(bytes) : this._output.send(bytes);
    if (sent === false) throw new Error('Falha ao enviar a mensagem MIDI das luzes.');
  }

  _send(bytes) {
    try { this._write(bytes); return true; }
    catch (error) { this._disable(error); return false; }
  }

  _disable(error) {
    this._cancelTest();
    this._stopWake();
    const identity = this._identity(this._output);
    for (const midi of this._active) {
      const message = this._lightMessage(midi, false);
      try { this._write(message); }
      catch {
        if (!this._pendingOff.has(identity)) this._pendingOff.set(identity, new Map());
        this._pendingOff.get(identity).set(message.join(':'), message);
      }
    }
    this._active.clear();
    this._detach();
    this._output = null;
    this.error = error;
    try { this.onError(error); } catch { /* A UI callback cannot prevent cleanup. */ }
    this._notify();
  }
}

export default GuideLights;
