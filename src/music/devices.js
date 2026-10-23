const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const channelNumber = value => clamp(Math.round(Number(value) || 0), 0, 15);
const noteNumber = value => clamp(Math.round(Number(value) || 0), 0, 127);
const velocityNumber = value => clamp(Math.round(Number(value) <= 1 ? Number(value) * 127 : Number(value)), 0, 127);

/** Web MIDI input/output without SysEx. External output is opt-in. */
export class MidiDevices {
  constructor() {
    this.onNote = () => {};
    this.onSustain = () => {};
    // Expression/program messages, using the song.events schema (without time/track).
    this.onMessage = () => {};
    this.onChange = () => {};
    this.onError = () => {};
    this.connected = false;
    this.accessReady = false;
    this.inputStatus = 'idle';
    this.outputStatus = 'disabled';
    this.error = null;
    this.inputId = null;
    this.outputId = null;
    this._access = null;
    this._input = null;
    this._output = null;
    this._preferredInput = null;
    this._preferredOutput = null;
    this._inputDisabled = false;
    this._allInputs = false;
    this._inputBindings = new Map();
    this._inputStates = new Map();
    this._activeOutputNotes = new Set();
    this._connecting = null;
    this._upgrading = null;
    this._generation = 0;
    this._portDiagnostics = new Map();
    this._closingPorts = new Map();
    this._outputBinding = null;
    this._stateHandler = () => { this._refresh().catch(() => {}); };
  }

  get inputs() {
    return this._ports('input');
  }

  get outputs() {
    return this._ports('output');
  }

  get access() { return this._access; }
  get sysexEnabled() { return this._access?.sysexEnabled === true; }

  _ports(type) {
    const ports = type === 'input' ? this._access?.inputs : this._access?.outputs;
    return ports ? [...ports.values()].filter(port => port.state !== 'disconnected').map(port => ({
      id: port.id, name: port.name || port.manufacturer || (type === 'input' ? 'Entrada MIDI' : 'Saída MIDI'),
      manufacturer: port.manufacturer || '', version: port.version || '', type,
      state: port.state, connection: port.connection || 'closed',
      ...this._portDiagnostics.get(`${type}:${port.id}`),
    })).map(port => ({ ...port, status: port.status || 'enumerated', error: port.error || null })) : [];
  }

  get inputDiagnostics() { return this.inputs.filter(port => this._allInputs || port.id === this.inputId); }
  get outputDiagnostics() { return this.outputs.filter(port => port.id === this.outputId); }

  _diagnose(port, type, status, error = null) {
    this._portDiagnostics.set(`${type}:${port.id}`, { status, error });
    this._updateStatus();
    this._notify();
  }

  _updateStatus() {
    const bindings = [...this._inputBindings.values()];
    this.connected = bindings.some(binding => binding.status === 'open' && binding.port.state !== 'disconnected' && (!binding.port.connection || binding.port.connection === 'open'));
    this.inputStatus = this._inputDisabled ? 'disabled' : !this.accessReady ? (this._connecting ? 'opening' : this.error ? 'error' : 'idle')
      : bindings.some(binding => binding.status === 'opening') ? 'opening'
      : this.connected ? 'open' : bindings.some(binding => binding.status === 'error') ? 'error' : 'unavailable';
    this.outputStatus = this._outputBinding?.status || (this._preferredOutput ? 'unavailable' : 'disabled');
    if (this.outputStatus === 'open' && (this._output?.state === 'disconnected' || (this._output?.connection && this._output.connection !== 'open'))) this.outputStatus = 'unavailable';
  }

  async connect() {
    if (this._connecting) return this._connecting;
    this.error = null;
    this.inputStatus = 'opening';
    this._notify();
    this._connecting = this._connect();
    try { return await this._connecting; }
    finally { this._connecting = null; this._updateStatus(); this._notify(); }
  }

  async _connect() {
    if (this._access) {
      await this._refresh({ retry: true });
      return this;
    }
    const generation = this._generation;
    const request = globalThis.navigator?.requestMIDIAccess;
    if (!request) {
      const error = new Error('MIDI não está disponível neste ambiente. O teclado do computador e o áudio interno continuam disponíveis.');
      error.name = 'NotSupportedError';
      this._reportError(error);
      throw error;
    }
    try {
      const access = await request.call(globalThis.navigator, { sysex: false });
      if (generation !== this._generation) throw Object.assign(new Error('Conexão MIDI cancelada.'), { name: 'AbortError' });
      this._access = access;
      this._access.addEventListener('statechange', this._stateHandler);
      this.accessReady = true;
      this.error = null;
      await this._refresh();
      return this;
    } catch (cause) {
      if (cause.deviceId || cause.name === 'AbortError') throw cause;
      const denied = cause.name === 'NotAllowedError' || cause.name === 'SecurityError';
      const error = new Error(denied ? 'O acesso MIDI foi negado. Autorize dispositivos MIDI nas permissões do aplicativo.' : `Não foi possível acessar dispositivos MIDI: ${cause.message || cause}`);
      error.name = cause.name || 'MidiError';
      error.cause = cause;
      this._reportError(error);
      throw error;
    }
  }

  _notify() {
    this.onChange({ inputs: this.inputs, outputs: this.outputs, inputId: this.inputId, outputId: this.outputId,
      connected: this.connected, accessReady: this.accessReady, inputStatus: this.inputStatus, outputStatus: this.outputStatus,
      inputDiagnostics: this.inputDiagnostics, outputDiagnostics: this.outputDiagnostics, error: this.error });
  }

  _reportError(error) {
    this.error = error;
    this.onError(error);
    this._notify();
  }

  _portError(cause, port, type) {
    const error = new Error(`Não foi possível abrir ${type === 'input' ? 'a entrada' : 'a saída'} MIDI “${port.name || port.id}”: ${cause.message || cause}. Feche outros programas que estejam usando o teclado e tente novamente.`);
    Object.assign(error, { name: cause.name || 'MidiError', cause, deviceId: port.id, direction: type });
    this._reportError(error);
    return error;
  }

  async _close(port) {
    try { await port?.close?.(); }
    catch { /* A removed device may no longer be closable. */ }
  }

  _inputState(deviceId) {
    const key = deviceId ?? '';
    if (!this._inputStates.has(key)) this._inputStates.set(key, { notes: new Map(), sustain: new Set(), bends: new Set() });
    return this._inputStates.get(key);
  }

  _releaseInput(deviceId) {
    const state = this._inputStates.get(deviceId ?? '');
    if (!state) return;
    const source = { ...(deviceId == null ? {} : { deviceId }), synthetic: true, reason: 'device-detached' };
    for (const { midi, channel } of state.notes.values()) this.onNote({ midi, velocity: 0, on: false, channel, ...source });
    for (const channel of state.sustain) {
      this.onSustain({ value: false, channel, ...source });
      this.onMessage({ type: 'cc', controller: 64, value: 0, channel, ...source });
    }
    for (const channel of state.bends) this.onMessage({ type: 'pitchBend', value: 8192, channel, ...source });
    this._inputStates.delete(deviceId ?? '');
  }

  _detachInput(id) {
    const binding = this._inputBindings.get(id);
    if (!binding) return Promise.resolve();
    binding.disposed = true;
    binding.port.removeEventListener('midimessage', binding.handler);
    this._inputBindings.delete(id);
    this._releaseInput(id);
    this._portDiagnostics.delete(`input:${id}`);
    const closing = Promise.resolve(binding.opening).catch(() => {}).then(() => this._close(binding.port));
    this._closingPorts.set(`input:${id}`, closing);
    closing.finally(() => { if (this._closingPorts.get(`input:${id}`) === closing) this._closingPorts.delete(`input:${id}`); });
    this._updateStatus();
    return closing;
  }

  _attachInput(port, retry = false) {
    const previous = this._inputBindings.get(port.id);
    const unexpectedlyClosed = previous?.status === 'open' && port.connection && port.connection !== 'open';
    if (previous && previous.port === port && !unexpectedlyClosed && !(retry && previous.status === 'error')) return previous.opening;
    if (previous) this._detachInput(port.id);
    const closing = this._closingPorts.get(`input:${port.id}`);
    const binding = { port, status: 'opening', disposed: false, handler: null, opening: null };
    binding.handler = event => {
      if (binding.disposed || binding.status !== 'open' || port.state === 'disconnected' || (port.connection && port.connection !== 'open')) return;
      const diagnostic = this._portDiagnostics.get(`input:${port.id}`);
      if (diagnostic) { diagnostic.receivedMessages = (diagnostic.receivedMessages || 0) + 1; diagnostic.lastMessageAt = Date.now(); }
      this._receive(event.data, port.id, event.receivedTime ?? event.timeStamp);
    };
    this._inputBindings.set(port.id, binding);
    this._diagnose(port, 'input', 'opening');
    // Attach the listener only after explicit open succeeds; attaching first implicitly
    // opens a Web MIDI port and hid rejected/exclusive device access in older builds.
    binding.opening = (async () => {
      try {
        if (closing) await closing;
        if (binding.disposed) return;
        await port.open();
        if (binding.disposed) return;
        if (port.state === 'disconnected' || (port.connection && port.connection !== 'open')) throw new Error('O dispositivo não ficou disponível após a abertura.');
        binding.status = 'open';
        port.addEventListener('midimessage', binding.handler);
        this.error = null;
        this._diagnose(port, 'input', 'open');
      } catch (cause) {
        if (binding.disposed) return;
        binding.status = 'error';
        port.removeEventListener('midimessage', binding.handler);
        const error = this._portError(cause, port, 'input');
        this._diagnose(port, 'input', 'error', error);
        throw error;
      }
    })();
    return binding.opening;
  }

  _selectInput(port, retry = false) {
    const closings = [];
    for (const id of this._inputBindings.keys()) if (id !== port?.id) closings.push(this._detachInput(id));
    this._input = port || null;
    this.inputId = port?.id || (!this._inputDisabled && this._preferredInput) || null;
    this._updateStatus();
    const opening = port ? this._attachInput(port, retry) : Promise.resolve();
    return Promise.all([...closings, opening]);
  }

  async _syncAllInputs(retry = false) {
    const ports = [...this._access.inputs.values()].filter(port => port.state !== 'disconnected');
    const ids = new Set(ports.map(port => port.id));
    const closings = [];
    for (const id of this._inputBindings.keys()) if (!ids.has(id)) closings.push(this._detachInput(id));
    this._input = null;
    this.inputId = 'all';
    const results = await Promise.allSettled([...closings, ...ports.map(port => this._attachInput(port, retry))]);
    this._updateStatus();
    if (!this.connected) {
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    }
  }

  async setInput(id) {
    if (id === 'all') {
      this._allInputs = true;
      this._inputDisabled = false;
      this._preferredInput = null;
      if (this._access) await this._syncAllInputs(true);
      else { this._input = null; this.inputId = 'all'; }
      this._notify();
      return this.inputId;
    }
    const disabled = id == null || id === '' || id === 'none';
    const selected = disabled ? null : this._access?.inputs.get(id);
    const port = selected?.state === 'disconnected' ? null : selected;
    this._inputDisabled = disabled;
    this._allInputs = false;
    this._preferredInput = disabled ? null : id;
    await this._selectInput(port, true);
    this._notify();
    return this.inputId;
  }

  async _selectOutput(port, retry = false) {
    const unexpectedlyClosed = this._outputBinding?.status === 'open' && port?.connection && port.connection !== 'open';
    if (this._output === port && !unexpectedlyClosed && !(retry && this._outputBinding?.status === 'error')) {
      this.outputId = port?.id || this._preferredOutput || null;
      this._updateStatus();
      return this._outputBinding?.opening;
    }
    this.allNotesOff();
    const old = this._outputBinding;
    if (old) old.disposed = true;
    if (old) this._portDiagnostics.delete(`output:${old.port.id}`);
    const closing = old ? Promise.resolve(old.opening).catch(() => {}).then(() => this._close(old.port)) : Promise.resolve();
    this._output = port || null;
    this.outputId = port?.id || this._preferredOutput || null;
    this._outputBinding = null;
    if (!port) { this._updateStatus(); await closing; return; }
    const binding = { port, status: 'opening', disposed: false, opening: null };
    this._outputBinding = binding;
    this._diagnose(port, 'output', 'opening');
    binding.opening = (async () => {
      try {
        await closing;
        if (binding.disposed) return;
        await port.open();
        if (binding.disposed) return;
        if (port.state === 'disconnected' || (port.connection && port.connection !== 'open')) throw new Error('O dispositivo não ficou disponível após a abertura.');
        binding.status = 'open';
        this.error = null;
        this._diagnose(port, 'output', 'open');
      } catch (cause) {
        if (binding.disposed) return;
        binding.status = 'error';
        const error = this._portError(cause, port, 'output');
        this._diagnose(port, 'output', 'error', error);
        throw error;
      }
    })();
    return binding.opening;
  }

  async setOutput(id) {
    const disabled = id == null || id === '' || id === 'none';
    const selected = disabled ? null : this._access?.outputs.get(id);
    const port = selected?.state === 'disconnected' ? null : selected;
    this._preferredOutput = disabled ? null : id;
    await this._selectOutput(port, true);
    this._notify();
    return this.outputId;
  }

  async _refresh({ retry = false } = {}) {
    if (!this._access) return;
    let inputOpening;
    if (this._allInputs) inputOpening = this._syncAllInputs(retry);
    else {
      if (this._input && (this._input.state === 'disconnected' || this._access.inputs.get(this._input.id) !== this._input)) this._selectInput(null);
      const preferred = this._access.inputs.get(this._preferredInput);
      if (!this._inputDisabled && preferred && preferred.state !== 'disconnected' && preferred !== this._input) inputOpening = this._selectInput(preferred, retry);
      if (!this._input && !this._inputDisabled) {
        const port = this._preferredInput ? (preferred?.state !== 'disconnected' ? preferred : null) : [...this._access.inputs.values()].find(item => item.state !== 'disconnected');
        inputOpening = this._selectInput(port, retry);
      } else if (this._input) inputOpening = this._attachInput(this._input, retry);
    }
    let outputOpening;
    if (this._output?.state === 'disconnected') outputOpening = this._selectOutput(null);
    if (!this._output && this._preferredOutput) {
      const port = this._access.outputs.get(this._preferredOutput);
      if (port && port.state !== 'disconnected') outputOpening = this._selectOutput(port, retry);
    } else if (retry && this._output) outputOpening = this._selectOutput(this._output, true);
    this._updateStatus();
    this._notify();
    const results = await Promise.allSettled([inputOpening, outputOpening]);
    this._updateStatus();
    this._notify();
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }

  retry() { return this.connect(); }

  /** Request SysEx only for a user-selected hardware protocol that requires it. */
  async enableSysex() {
    if(this.sysexEnabled)return this;
    if(this._upgrading)return this._upgrading;
    this._upgrading=(async()=>{
      if(this._connecting)await this._connecting;
      if(this.sysexEnabled)return this;
      const generation=this._generation;
      const previous=this._access;
      const inputId=this.inputId,outputId=this.outputId;
      const inputName=previous?.inputs.get(inputId)?.name,outputName=previous?.outputs.get(outputId)?.name;
      const request=globalThis.navigator?.requestMIDIAccess;
      if(!request)throw new Error('SysEx MIDI não está disponível neste ambiente.');
      // Keep working MIDI input untouched if the extra permission is refused.
      const upgraded=await request.call(globalThis.navigator,{sysex:true});
      if(generation!==this._generation)throw Object.assign(new Error('Conexão MIDI cancelada.'),{name:'AbortError'});
      if(!upgraded.sysexEnabled)throw new Error('O aplicativo não recebeu permissão para o protocolo SysEx das luzes.');
      previous?.removeEventListener('statechange',this._stateHandler);
      this.allNotesOff();
      const closings=[...this._inputBindings.keys()].map(id=>this._detachInput(id));
      closings.push(this._selectOutput(null));
      await Promise.allSettled(closings);
      if(generation!==this._generation)throw Object.assign(new Error('Conexão MIDI cancelada.'),{name:'AbortError'});
      this._access=upgraded;this.accessReady=true;this._input=null;
      if(!this._allInputs&&!this._inputDisabled&&inputId)this._preferredInput=upgraded.inputs.get(inputId)?.id||[...upgraded.inputs.values()].find(port=>port.name===inputName)?.id||inputId;
      if(outputId)this._preferredOutput=upgraded.outputs.get(outputId)?.id||[...upgraded.outputs.values()].find(port=>port.name===outputName)?.id||outputId;
      this._portDiagnostics.clear();
      upgraded.addEventListener('statechange',this._stateHandler);
      await this._refresh({retry:true});
      return this;
    })();
    try{return await this._upgrading;}finally{this._upgrading=null;}
  }

  _receive(data, deviceId = null, receivedTime = null) {
    if (!data || data.length < 2) return;
    const command = data[0] & 0xf0;
    const channel = data[0] & 0x0f;
    const state = this._inputState(deviceId);
    const source = { ...(deviceId == null ? {} : { deviceId }), ...(Number.isFinite(receivedTime) ? { receivedTime } : {}) };
    if (command === 0xb0 && data.length >= 3) this.onMessage({ type: 'cc', controller: data[1] & 127, value: data[2] & 127, channel, ...source });
    else if (command === 0xe0 && data.length >= 3) {
      const value = (data[1] & 127) | (data[2] & 127) << 7;
      if (value === 8192) state.bends.delete(channel);
      else state.bends.add(channel);
      this.onMessage({ type: 'pitchBend', value, channel, ...source });
    } else if (command === 0xd0) this.onMessage({ type: 'aftertouch', value: data[1] & 127, channel, ...source });
    else if (command === 0xa0 && data.length >= 3) this.onMessage({ type: 'polyAftertouch', midi: data[1] & 127, value: data[2] & 127, channel, ...source });
    else if (command === 0xc0) this.onMessage({ type: 'program', value: data[1] & 127, channel, ...source });
    if ((command === 0x80 || command === 0x90) && data.length >= 3) {
      const note = { midi: data[1] & 0x7f, velocity: (data[2] & 0x7f) / 127, on: command === 0x90 && data[2] > 0, channel, ...source };
      const key = `${channel}:${note.midi}`;
      if (note.on) state.notes.set(key, note);
      else state.notes.delete(key);
      this.onNote(note);
    } else if (command === 0xb0 && data.length >= 3 && data[1] === 64) {
      const value = data[2] >= 64;
      if (value) state.sustain.add(channel);
      else state.sustain.delete(channel);
      this.onSustain({ value, channel, ...source });
    } else if (command === 0xb0 && data.length >= 3 && (data[1] === 120 || data[1] === 123)) {
      for (const [key, note] of state.notes) {
        if (note.channel !== channel) continue;
        state.notes.delete(key);
        this.onNote({ midi: note.midi, velocity: 0, on: false, channel, ...source });
      }
      if (state.sustain.delete(channel)) this.onSustain({ value: false, channel, ...source });
    } else if (command === 0xb0 && data.length >= 3 && data[1] === 121) {
      if (state.sustain.delete(channel)) this.onSustain({ value: false, channel, ...source });
      state.bends.delete(channel);
    }
  }

  _send(data) {
    if (!this._output || this._output.state === 'disconnected' || (this._outputBinding && this._outputBinding.status !== 'open')) return false;
    try { this._output.send(data); return true; }
    catch (error) { this._reportError(error); return false; }
  }

  sendNoteOn(midi, velocity = 0.8, channel = 0) {
    if (!Number.isFinite(Number(midi)) || !Number.isFinite(Number(velocity))) return false;
    const note = noteNumber(midi);
    const chan = channelNumber(channel);
    const vel = velocityNumber(velocity);
    if (!vel) return this.sendNoteOff(note, chan);
    const sent = this._send([0x90 | chan, note, vel]);
    if (sent) this._activeOutputNotes.add(`${chan}:${note}`);
    return sent;
  }

  sendNoteOff(midi, channel = 0) {
    if (!Number.isFinite(Number(midi))) return false;
    const note = noteNumber(midi);
    const chan = channelNumber(channel);
    this._activeOutputNotes.delete(`${chan}:${note}`);
    return this._send([0x80 | chan, note, 0]);
  }

  sendProgram(program, channel = 0) {
    if (!Number.isFinite(Number(program))) return false;
    return this._send([0xc0 | channelNumber(channel), noteNumber(program)]);
  }

  sendSustain(enabled, channel = 0) {
    return this.sendControl(64, enabled ? 127 : 0, channel);
  }

  sendControl(controller, value, channel = 0) {
    if (!Number.isFinite(Number(controller)) || !Number.isFinite(Number(value))) return false;
    return this._send([0xb0 | channelNumber(channel), noteNumber(controller), noteNumber(value)]);
  }

  sendPitchBend(value, channel = 0) {
    if (!Number.isFinite(Number(value))) return false;
    const bend = clamp(Math.round(Number(value)), 0, 16383);
    return this._send([0xe0 | channelNumber(channel), bend & 127, bend >> 7]);
  }

  sendAftertouch(value, channel = 0) {
    if (!Number.isFinite(Number(value))) return false;
    return this._send([0xd0 | channelNumber(channel), noteNumber(value)]);
  }

  sendPolyAftertouch(midi, value, channel = 0) {
    if (!Number.isFinite(Number(midi)) || !Number.isFinite(Number(value))) return false;
    return this._send([0xa0 | channelNumber(channel), noteNumber(midi), noteNumber(value)]);
  }

  allNotesOff() {
    for (const key of this._activeOutputNotes) {
      const [channel, note] = key.split(':').map(Number);
      this._send([0x80 | channel, note, 0]);
    }
    this._activeOutputNotes.clear();
    if (!this._output || this._output.state === 'disconnected') return;
    for (let channel = 0; channel < 16; channel++) {
      this._send([0xb0 | channel, 64, 0]);
      this._send([0xb0 | channel, 123, 0]);
      this._send([0xb0 | channel, 120, 0]);
      this._send([0xe0 | channel, 0, 64]);
    }
  }

  async disconnect() {
    this._generation++;
    this.allNotesOff();
    if (this._access) this._access.removeEventListener('statechange', this._stateHandler);
    this._allInputs = false;
    const closings = [...this._inputBindings.keys()].map(id => this._detachInput(id));
    this._input = null;
    this.inputId = null;
    this._releaseInput(null);
    closings.push(this._selectOutput(null));
    this._output = null;
    this.outputId = null;
    this._access = null;
    this.accessReady = false;
    this.connected = false;
    this._portDiagnostics.clear();
    this._updateStatus();
    this._notify();
    await Promise.allSettled(closings);
  }

  dispose() { return this.disconnect(); }
}

export default MidiDevices;
