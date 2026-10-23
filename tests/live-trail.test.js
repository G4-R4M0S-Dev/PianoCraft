import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveNoteTrail} from '../src/music/live-trail.js';

test('free-piano trajectory starts at the keys, grows while held and detaches on release',()=>{
  const trail=new LiveNoteTrail();trail.noteOn('midi:a:0:60',60,.7,0,1000);
  let [n]=trail.visible(1500);assert.equal(n.ageStart,.5);assert.equal(n.ageEnd,0);assert.equal(n.held,true);
  trail.noteOff('midi:a:0:60',1800);[n]=trail.visible(2300);assert.equal(n.ageStart,1.3);assert.equal(n.ageEnd,.5);assert.equal(n.held,false);
  assert.ok(Math.abs((n.ageStart-n.ageEnd)-.8)<1e-9);
});
test('same pitch on independent devices has separate key releases; repeated strikes remain visible',()=>{
  const trail=new LiveNoteTrail();trail.noteOn('pc:60',60,1,0,0);trail.noteOn('midi:60',60,1,0,10);trail.noteOn('pc:60',60,1,0,20);
  assert.equal(trail.notes.length,2);trail.noteOff('pc:60',100);trail.noteOn('pc:60',60,1,0,120);
  assert.equal(trail.visible(200).filter(n=>n.held).length,2);assert.equal(trail.visible(200).length,3);
});
test('history expires while idle, but a long held key remains visible until it is released',()=>{
  const trail=new LiveNoteTrail({windowSeconds:4});trail.noteOn('a',60,1,0,0);trail.noteOn('b',64,1,0,0);trail.noteOff('b',100);
  assert.deepEqual(trail.visible(5000,4).map(n=>n.midi),[60]);trail.releaseAll(5100);assert.equal(trail.visible(9200,4).length,0);
});
test('rapid live playing has bounded history and clearing does not depend on recording state',()=>{
  const trail=new LiveNoteTrail({maxNotes:128});for(let i=0;i<5000;i++){trail.noteOn('key',60,1,0,i);trail.noteOff('key',i+.5);}
  assert.ok(trail.notes.length<=128);trail.clear();assert.equal(trail.visible(6000).length,0);assert.equal(trail.held.size,0);
});
