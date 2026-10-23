import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiDevices } from '../src/music/devices.js';

class Port extends EventTarget {
  constructor(id, open = null) {
    super(); Object.assign(this, { id, name: id, manufacturer: 'CASIO', version: '1.0', state: 'connected', connection: 'closed', openAction: open, opens: 0, closes: 0, sent: [], handlers: new Set() });
  }
  addEventListener(type, handler, options) { if (type === 'midimessage') this.handlers.add(handler); super.addEventListener(type, handler, options); }
  removeEventListener(type, handler, options) { if (type === 'midimessage') this.handlers.delete(handler); super.removeEventListener(type, handler, options); }
  async open() { this.opens++; if (this.openAction) await this.openAction(); this.connection = 'open'; return this; }
  async close() { this.closes++; this.connection = 'closed'; return this; }
  send(bytes) { this.sent.push(bytes); }
  receive(bytes, receivedTime = 123.45) { const event = new Event('midimessage'); Object.assign(event, { data: new Uint8Array(bytes), receivedTime }); this.dispatchEvent(event); }
}

async function withAccess(inputs, outputs, run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const access = new EventTarget(); access.inputs = new Map(inputs.map(port => [port.id, port])); access.outputs = new Map(outputs.map(port => [port.id, port]));
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { requestMIDIAccess: async () => access } });
  const midi = new MidiDevices();
  try { await run(midi, access); }
  finally { await midi.disconnect(); if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator; }
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('enumeration and an unresolved open never claim a working keyboard; messages keep hardware timestamps', async () => {
  let complete;
  const keyboard = new Port('CASIO USB-MIDI', () => new Promise(resolve => { complete = resolve; }));
  await withAccess([keyboard], [], async midi => {
    const notes = [], sustain = [], messages = []; midi.onNote = note => notes.push(note); midi.onSustain = value => sustain.push(value); midi.onMessage = value => messages.push(value);
    const connecting = midi.connect();
    await flush();
    assert.equal(midi.accessReady, true);
    assert.equal(midi.connected, false);
    assert.equal(midi.inputStatus, 'opening');
    assert.equal(midi.inputs[0].status, 'opening');
    assert.equal(midi.inputs[0].manufacturer, 'CASIO');
    assert.equal(keyboard.handlers.size, 0, 'no implicit opening by a premature message listener');
    keyboard.receive([0x90, 60, 127]); assert.equal(notes.length, 0);
    complete(); await connecting;
    assert.equal(midi.connected, true); assert.equal(midi.inputStatus, 'open');
    keyboard.receive([0x90, 60, 127], 1000.25);
    keyboard.receive([0xb0, 64, 127], 1001.5);
    assert.equal(notes[0].receivedTime, 1000.25); assert.equal(sustain[0].receivedTime, 1001.5); assert.equal(messages[0].receivedTime, 1001.5);
  });
  assert.equal(keyboard.handlers.size, 0); assert.equal(keyboard.connection, 'closed');
});

test('rejected port.open reports an error, attaches no listener and retries without duplicate notes', async () => {
  let busy = true;
  const keyboard = new Port('CASIO USB-MIDI', () => { if (busy) throw Object.assign(new Error('Device in use'), { name: 'InvalidAccessError' }); });
  const output = new Port('CASIO output', () => { throw new Error('Output in use'); });
  await withAccess([keyboard], [output], async midi => {
    const states = []; midi.onChange = state => states.push(state);
    await assert.rejects(midi.connect(), { name: 'InvalidAccessError', deviceId: keyboard.id });
    assert.equal(midi.accessReady, true); assert.equal(midi.connected, false); assert.equal(midi.inputStatus, 'error');
    assert.equal(keyboard.handlers.size, 0); assert.match(midi.inputs[0].error.message, /Device in use/);
    assert.ok(states.every(state => !state.connected), 'permission plus enumeration is insufficient to report connected');
    busy = false; await midi.retry();
    assert.equal(midi.connected, true); assert.equal(keyboard.handlers.size, 1); assert.equal(keyboard.opens, 2);
    const notes = []; midi.onNote = note => notes.push(note); keyboard.receive([0x90, 60, 100]); assert.equal(notes.length, 1);
    await assert.rejects(midi.setOutput(output.id), /Output in use/);
    assert.equal(midi.outputStatus, 'error'); assert.equal(midi.sendNoteOn(60), false); assert.deepEqual(output.sent, []);
    assert.equal(midi.connected, true, 'an output failure must not hide a working input');
  });
});

test('all-input selection tolerates one busy input and retries it without stealing held notes', async () => {
  let busy = true;
  const first = new Port('first'), second = new Port('second', () => { if (busy) throw new Error('Busy'); });
  await withAccess([first, second], [], async midi => {
    await midi.setInput('all'); await midi.connect();
    assert.equal(midi.connected, true); assert.equal(midi.inputId, 'all');
    assert.deepEqual(midi.inputs.map(port => port.status), ['open', 'error']);
    const notes = []; midi.onNote = note => notes.push(note); first.receive([0x90, 60, 100]);
    busy = false; await midi.retry(); second.receive([0x90, 62, 100]);
    assert.equal(first.opens, 1); assert.equal(second.opens, 2); assert.equal(first.handlers.size, 1); assert.equal(second.handlers.size, 1);
    assert.deepEqual(notes.map(note => note.deviceId), ['first', 'second']); assert.ok(notes.every(note => note.on));
  });
});

test('changing selection during pending open cannot resurrect a detached listener', async () => {
  let complete;
  const first = new Port('first', () => new Promise(resolve => { complete = resolve; })), second = new Port('second');
  await withAccess([first, second], [], async midi => {
    const connecting = midi.connect(); await flush();
    const changing = midi.setInput(second.id); await flush(); complete();
    await Promise.all([connecting, changing]);
    assert.equal(midi.inputId, 'second'); assert.equal(midi.connected, true);
    assert.equal(first.handlers.size, 0); assert.equal(first.connection, 'closed'); assert.equal(second.handlers.size, 1);
    const notes = []; midi.onNote = note => notes.push(note); first.receive([0x90, 60, 100]); second.receive([0x90, 62, 100]);
    assert.equal(notes.length, 1); assert.equal(notes[0].deviceId, 'second');
  });
});

test('hotplug restores a selected port and detaches its replaced object with the same id', async () => {
  const first = new Port('CASIO');
  await withAccess([first], [], async (midi, access) => {
    await midi.connect(); await midi.setInput(first.id);
    first.receive([0x90, 60, 100]); first.state = 'disconnected';
    await midi._refresh(); assert.equal(midi.connected, false); assert.equal(midi.inputStatus, 'unavailable'); assert.equal(first.handlers.size, 0);
    const replacement = new Port(first.id); access.inputs.set(first.id, replacement);
    await midi._refresh();
    assert.equal(midi.connected, true); assert.equal(replacement.handlers.size, 1); assert.equal(midi.inputId, first.id);
  });
});

test('output is unavailable for sends until opening resolves and disabling awaits closing', async () => {
  let complete;
  const output = new Port('out', () => new Promise(resolve => { complete = resolve; }));
  await withAccess([], [output], async midi => {
    await midi.connect(); assert.equal(midi.connected, false); assert.equal(midi.inputStatus, 'unavailable');
    const opening = midi.setOutput('out'); await flush();
    assert.equal(midi.outputStatus, 'opening'); assert.equal(midi.sendNoteOn(60), false);
    complete(); await opening;
    assert.equal(midi.outputStatus, 'open'); assert.equal(midi.sendNoteOn(60), true);
    await midi.setOutput('none'); assert.equal(output.connection, 'closed'); assert.equal(midi.outputStatus, 'disabled');
  });
});

test('a missing saved keyboard never silently opens another input and returns after hotplug', async () => {
  const other=new Port('other');
  await withAccess([other],[],async(midi,access)=>{
    await midi.setInput('saved-CASIO');await midi.connect();
    assert.equal(midi.inputId,'saved-CASIO');assert.equal(midi.connected,false);assert.equal(midi.inputStatus,'unavailable');assert.equal(other.opens,0);
    const restored=new Port('saved-CASIO');access.inputs.set(restored.id,restored);await midi._refresh();
    assert.equal(midi.inputId,'saved-CASIO');assert.equal(midi.connected,true);assert.equal(restored.opens,1);assert.equal(other.opens,0);
  });
});

test('SysEx upgrade preserves input and output by name and adds no orphan listeners', async () => {
  const input=new Port('old-in'),output=new Port('old-out');
  await withAccess([input],[output],async(midi,previous)=>{
    await midi.connect();await midi.setOutput(output.id);
    const nextInput=new Port('new-in'),nextOutput=new Port('new-out');nextInput.name=input.name;nextOutput.name=output.name;
    const upgraded=new EventTarget();Object.assign(upgraded,{sysexEnabled:true,inputs:new Map([[nextInput.id,nextInput]]),outputs:new Map([[nextOutput.id,nextOutput]])});
    const requested=[];navigator.requestMIDIAccess=async options=>{requested.push(options);return upgraded;};
    await Promise.all([midi.enableSysex(),midi.enableSysex()]);
    assert.deepEqual(requested,[{sysex:true}]);assert.equal(midi.sysexEnabled,true);assert.equal(midi.connected,true);
    assert.equal(midi.inputId,nextInput.id);assert.equal(midi.outputId,nextOutput.id);assert.equal(midi.outputStatus,'open');
    assert.equal(input.handlers.size,0);assert.equal(input.connection,'closed');assert.equal(output.connection,'closed');assert.equal(nextInput.handlers.size,1);
    const notes=[];midi.onNote=note=>notes.push(note);input.receive([0x90,60,100]);nextInput.receive([0x90,62,100]);assert.equal(notes.length,1);
    previous.dispatchEvent(new Event('statechange'));await flush();assert.equal(nextInput.opens,1);
  });
});

test('refused SysEx permission preserves a working input and its held notes',async()=>{
  const input=new Port('CASIO');
  await withAccess([input],[],async midi=>{
    await midi.connect();const notes=[];midi.onNote=note=>notes.push(note);input.receive([0x90,60,100]);
    navigator.requestMIDIAccess=async()=>{throw Object.assign(new Error('Denied'),{name:'NotAllowedError'});};
    await assert.rejects(midi.enableSysex(),{name:'NotAllowedError'});
    assert.equal(midi.connected,true);assert.equal(midi.sysexEnabled,false);assert.equal(input.handlers.size,1);assert.equal(input.connection,'open');assert.equal(notes.length,1);
  });
});
