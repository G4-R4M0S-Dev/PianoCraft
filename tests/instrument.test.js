import test from 'node:test';
import assert from 'node:assert/strict';
import {MidiDevices} from '../src/music/devices.js';
import {GuideLights} from '../src/music/guide-lights.js';
import {InstrumentControls} from '../src/instrument.js';

class Port extends EventTarget{
  constructor(id,open=null){super();Object.assign(this,{id,name:id,state:'connected',connection:'closed',openAction:open,opens:0,closes:0,sent:[]});}
  async open(){this.opens++;if(this.openAction)await this.openAction();this.connection='open';return this;}
  async close(){this.closes++;this.connection='closed';return this;}
  send(bytes){this.sent.push([...bytes]);}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(inputs,outputs,settings,run){
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator'),access=new EventTarget();
  Object.assign(access,{inputs:new Map(inputs.map(port=>[port.id,port])),outputs:new Map(outputs.map(port=>[port.id,port]))});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{requestMIDIAccess:async()=>access}});
  const midi=new MidiDevices(),controls=Object.create(InstrumentControls.prototype);
  Object.assign(controls,{midi,settings:{guideEnabled:false,...settings},saveSettings:()=>{},beforeChange:()=>{},refresh:()=>{},renderGuideStatus:()=>{},showError(error){this.error=error.message;},connectionBusy:null,restoringRouting:false,guideBusy:null,guideKey:null,_guidePort:null,_guideFailedKey:null,disposed:false,guideError:''});
  controls.guides=new GuideLights({onError:error=>controls.showGuideError(error)});
  try{await run(controls,midi,access);}finally{await controls.dispose();await midi.disconnect();if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
}

test('saved computer mode never briefly opens attached hardware',async()=>{
  const keyboard=new Port('CASIO USB-MIDI');
  await setup([keyboard],[],{midiInputId:''},async(controls,midi)=>{
    await controls.connect();assert.equal(midi.inputStatus,'disabled');assert.equal(keyboard.opens,0);
  });
});
test('initial device choice opens the physical CASIO instead of the enumerated virtual input',async()=>{
  const virtual=new Port('Virtual MIDI'),physical=new Port('CASIO USB-MIDI');
  await setup([virtual,physical],[],{},async(controls,midi)=>{
    await controls.connect();assert.equal(midi.inputId,physical.id);assert.equal(virtual.opens,0);assert.equal(physical.opens,1);
  });
});
test('an absent saved input remains selected and reconnects under a different session id by name',async()=>{
  const other=new Port('Other keyboard');
  await setup([other],[],{midiInputId:'old-CASIO',midiInputName:'CASIO USB-MIDI'},async(controls,midi,access)=>{
    await controls.connect();assert.equal(midi.connected,false);assert.equal(other.opens,0);assert.equal(controls.settings.midiInputId,'old-CASIO');
    const physical=new Port('new-CASIO');physical.name='CASIO USB-MIDI';access.inputs.set(physical.id,physical);
    await midi._refresh();await controls.restoreAvailableRouting();
    assert.equal(midi.inputId,physical.id);assert.equal(midi.connected,true);assert.equal(controls.settings.midiInputId,physical.id);assert.equal(other.opens,0);
  });
});
test('disabling a guide-only output releases active lights then closes the port',async()=>{
  const output=new Port('guide');
  await setup([], [output],{guideEnabled:false,guideOutputId:output.id,guideProfile:'casio-navigate'},async(controls,midi)=>{
    await midi.connect();controls.settings.guideEnabled=true;await controls.syncGuides();controls.guides.update([60]);
    controls.settings.guideEnabled=false;await controls.syncGuides();
    assert.equal(controls.guides.connected,false);assert.equal(output.connection,'closed');assert.deepEqual(output.sent.slice(-1),[[0x83,60,0]]);
  });
});
test('disabling guides preserves an audio output sharing the same MIDI port',async()=>{
  const output=new Port('shared');
  await setup([], [output],{guideOutputId:output.id,guideProfile:'casio-navigate'},async(controls,midi)=>{
    await midi.connect();await midi.setOutput(output.id);controls.settings.guideEnabled=true;await controls.syncGuides();controls.guides.update([60]);
    const closes=output.closes;controls.settings.guideEnabled=false;await controls.syncGuides();
    assert.equal(output.closes,closes);assert.equal(output.connection,'open');assert.equal(midi.sendNoteOn(67),true);
  });
});
test('disposing while a guide port is opening closes it when opening completes',async()=>{
  let complete;const output=new Port('guide',()=>new Promise(resolve=>{complete=resolve;}));
  await setup([], [output],{guideOutputId:output.id,guideProfile:'casio-navigate'},async(controls,midi)=>{
    await midi.connect();controls.settings.guideEnabled=true;const configuring=controls.syncGuides();await flush();
    const disposing=controls.dispose();complete();await Promise.all([configuring,disposing]);
    assert.equal(output.connection,'closed');assert.equal(controls.guides.connected,false);assert.deepEqual(output.sent,[]);
  });
});
test('a failed guide output leaves the piano input working and retries only on request',async()=>{
  const input=new Port('CASIO'),output=new Port('guide',()=>{throw new Error('Output busy');});
  await setup([input],[output],{guideOutputId:output.id,guideProfile:'casio-navigate'},async(controls,midi)=>{
    await controls.connect();controls.settings.guideEnabled=true;await controls.syncGuides();
    assert.equal(midi.connected,true);assert.match(controls.guideError,/Output busy/);assert.equal(controls.error,'');
    await controls.syncGuides();assert.equal(output.opens,1);
    output.openAction=null;await controls.syncGuides(true);assert.equal(output.opens,2);assert.equal(controls.guides.connected,true);assert.equal(midi.connected,true);
  });
});
test('a write failure during guidance releases ownership of a guide-only port',async()=>{
  const output=new Port('guide');
  await setup([], [output],{guideOutputId:output.id,guideProfile:'casio-navigate'},async(controls,midi)=>{
    await midi.connect();controls.settings.guideEnabled=true;await controls.syncGuides();
    output.send=()=>{throw new Error('Cable failure');};controls.guides.update([60]);await flush();
    assert.equal(controls.guides.connected,false);assert.equal(output.connection,'closed');assert.match(controls.guideError,/Cable failure/);
  });
});
