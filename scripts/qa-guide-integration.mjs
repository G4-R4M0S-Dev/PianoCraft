import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

await mkdir('test-results',{recursive:true});
const fixture={id:'guide-qa',title:'QA · Guia LK-S250',tempo:120,duration:3,tracks:[{id:0,channel:0,name:'Piano'}],notes:[
  ...[48,60,64,67].map((midi,id)=>({id,midi,time:0,keyDuration:.8,duration:.8,track:0,channel:0})),
  {id:4,midi:72,time:1.5,keyDuration:.8,duration:.8,track:0,channel:0},
]};
const file=new URL('../test-results/qa-guide.json',import.meta.url);await writeFile(file,JSON.stringify(fixture));
const env={...process.env,PIANOCRAFT_TEST:'1'};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['.','--smoke'],env});
try{
  const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.waitForSelector('.song-card');
  await page.addInitScript(()=>{
    localStorage.setItem('pc-settings',JSON.stringify({guideEnabled:true,guideProfile:'casio-lks250',guideOutputId:'casio-out',midiInputId:'casio-in'}));
    window.qaGuideMessages=[];window.qaMidiRequests=[];
    Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async({sysex=false}={})=>{
      window.qaMidiRequests.push({sysex});
      const access=new EventTarget();access.sysexEnabled=sysex;
      class Port extends EventTarget{
        constructor(id,type){super();Object.assign(this,{id,type,name:'CASIO USB-MIDI',manufacturer:'CASIO',state:'connected',connection:'closed'});}
        async open(){this.connection='open';return this;}
        async close(){this.connection='closed';return this;}
        send(bytes){if(this.connection!=='open')throw new Error('Closed output');if(bytes[0]===240&&!sysex)throw new Error('SysEx denied');window.qaGuideMessages.push([...bytes]);}
      }
      access.inputs=new Map([['casio-in',new Port('casio-in','input')]]);
      access.outputs=new Map([['casio-out',new Port('casio-out','output')]]);
      window.qaMidiAccess=access;return access;
    }});
  });
  await page.reload();await page.waitForSelector('.song-card');
  await page.waitForFunction(()=>document.querySelector('#guide-status').textContent.includes('aberta'),null,{timeout:15000});
  await page.locator('#file-input').setInputFiles(fileURLToPath(file));
  await page.locator('.song-card').filter({hasText:fixture.title}).locator('.open-song').click();
  await page.locator('#mode').selectOption('melody');await page.locator('#hands').selectOption('right');
  await page.locator('#play').click();await page.waitForTimeout(200);
  const lights=()=>page.evaluate(()=>{
    const active=new Set();for(const b of window.qaGuideMessages)if(b.length===10&&b[0]===240&&b[5]===2){if(b[8])active.add(b[7]);else active.delete(b[7]);}
    return [...active].sort((a,b)=>a-b);
  });
  const result={initial:await lights()};assert.deepEqual(result.initial,[60,64,67]);
  await page.evaluate(()=>{
    const port=qaMidiAccess.inputs.get('casio-in'),base=performance.now();
    const send=(pitch,receivedTime)=>{const event=new Event('midimessage');Object.assign(event,{data:new Uint8Array([0x90,pitch,100]),receivedTime});port.dispatchEvent(event);};
    send(60,base);window.dispatchEvent(new Event('blur'));send(64,base+40);send(67,base+80);
  });
  assert.equal(await page.locator('#hits').textContent(),'3');result.physicalChordSurvivesFocusLoss=true;
  await page.locator('#play').click();assert.deepEqual(await lights(),[]);
  result.pauseClears=true;
  await page.locator('#restart').click();
  await page.locator('#transpose').selectOption('2');await page.locator('#play').click();await page.waitForTimeout(120);
  result.transposed=await lights();assert.deepEqual(result.transposed,[62,66,69]);
  await page.locator('#timeline').fill('500');await page.waitForTimeout(100);
  assert.ok(!(await lights()).some(n=>[62,66,69].includes(n)));result.seekClearsOldChord=true;
  await page.locator('#play').click();
  await page.locator('#instrument-settings').click();await page.locator('#guide-test').click();
  await page.waitForTimeout(50);assert.deepEqual(await lights(),[60,64,67]);
  await page.waitForTimeout(900);assert.deepEqual(await lights(),[]);result.testAutoOff=true;
  await page.locator('#guide-enabled').uncheck();await page.waitForTimeout(80);
  assert.equal(await page.evaluate(()=>qaMidiAccess.outputs.get('casio-out').connection),'closed');result.disableClosesGuidePort=true;
  result.requestedSysex=await page.evaluate(()=>qaMidiRequests.some(r=>r.sysex));assert.equal(result.requestedSysex,true);
  result.noteAudioMessages=await page.evaluate(()=>qaGuideMessages.filter(b=>[0x80,0x90].includes(b[0]&0xf0)).length);assert.equal(result.noteAudioMessages,0);
  await page.locator('#settings button[value=close]').click();await page.locator('#mode').selectOption('recital');await page.locator('#play').click();
  await page.evaluate(()=>{const port=qaMidiAccess.inputs.get('casio-in');port.state='disconnected';port.connection='closed';qaMidiAccess.dispatchEvent(new Event('statechange'));});
  await page.waitForFunction(()=>document.querySelector('#play-state').textContent==='Pausado');
  const misses=await page.locator('#missed').textContent();await page.waitForTimeout(500);assert.equal(await page.locator('#missed').textContent(),misses);result.inputRemovalPausesWithoutExtraMisses=true;
  result.pageErrors=errors;assert.deepEqual(errors,[]);
  await writeFile('test-results/qa-guide-integration.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await app.close();}
