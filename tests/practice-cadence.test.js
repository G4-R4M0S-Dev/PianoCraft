import test from 'node:test';
import assert from 'node:assert/strict';
import {PracticeCadence} from '../src/music/practice-cadence.js';

test('preparation respects 3/4, performance speed and a distinct rest before repeating',()=>{
  const cadence=new PracticeCadence(),schedule=cadence.start({now:1000,bpm:120,speed:.5,numerator:3,denominator:4,bars:1,restSeconds:1});
  assert.equal(schedule.duration,4);assert.deepEqual(schedule.clicks.map(c=>c.offset),[1,2,3]);
  assert.equal(cadence.advance(1500).phase,'rest');assert.equal(cadence.advance(2000).beat,1);assert.equal(cadence.advance(3999).beat,2);
  assert.equal(cadence.advance(4000).beat,3);assert.equal(cadence.advance(5000).done,true);
});
test('6/8 counts eighth-note pulses and two bars accent their first pulse',()=>{
  const cadence=new PracticeCadence(),schedule=cadence.start({now:0,bpm:120,numerator:6,denominator:8,bars:2});
  assert.equal(schedule.duration,3);assert.equal(schedule.clicks.length,12);assert.deepEqual(schedule.clicks.filter(c=>c.accent).map(c=>c.offset),[0,1.5]);
  assert.equal(cadence.advance(1750).beat,2);assert.equal(cadence.advance(1750).bar,2);
});
test('cancel, disabled preparation and late callbacks cannot replay old counts',()=>{
  const cadence=new PracticeCadence();cadence.start({now:0});cadence.cancel();assert.equal(cadence.advance(800).active,false);
  assert.equal(cadence.start({now:0,bars:0,restSeconds:0}).duration,0);assert.equal(cadence.active,false);
  cadence.start({now:0});assert.equal(cadence.advance(10000).done,true);assert.equal(cadence.advance(10001).active,false);
});
