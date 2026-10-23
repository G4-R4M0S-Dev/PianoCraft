import test from 'node:test';import assert from 'node:assert/strict';
import {PulseMetronome} from '../src/music/metronome.js';
test('free-play pulse uses audio timestamps, compound meter and downbeat accents',()=>{
  const clicks=[],beats=[],audio={context:{currentTime:0},click:(accent,time)=>clicks.push({accent,time}),stopClicks(){}};
  const timers={setInterval:()=>1,clearInterval(){}};const metro=new PulseMetronome({audio,timers,onBeat:beat=>beats.push(beat)});
  metro.start({bpm:120,numerator:6,denominator:8});
  for(let i=1;i<=70;i++){audio.context.currentTime=i*.025;metro.tick();}
  assert.equal(clicks[1].time-clicks[0].time,.25);assert.equal(clicks[6].accent,true);assert.equal(beats[6].beat,1);metro.stop();assert.equal(metro.running,false);
});
test('late ticks skip old pulses, and stop cancels future scheduled clicks',()=>{
  const calls=[],audio={context:{currentTime:0},click:(accent,time)=>calls.push(time),stopClicks:()=>calls.push('stop')};
  const timers={setInterval:()=>1,clearInterval(){}};const metro=new PulseMetronome({audio,timers});metro.start();const initial=calls.filter(Number.isFinite).length;audio.context.currentTime=10;metro.tick();
  assert.ok(calls.filter(Number.isFinite).slice(initial).every(t=>t>=10));metro.stop();assert.equal(calls.at(-1),'stop');
});

test('a one-second startup stall cannot remove beat two from the audio timeline',()=>{
  const clicks=[],audio={context:{currentTime:0},click:(accent,time)=>clicks.push({accent,time}),stopClicks(){}};
  const timers={setInterval:()=>1,clearInterval(){}};const metro=new PulseMetronome({audio,timers});
  metro.start({bpm:120,numerator:3,denominator:4});
  assert.deepEqual(clicks.map(click=>click.time),[.03,.53,1.03]);
  audio.context.currentTime=1.01;metro.tick();
  assert.deepEqual(clicks.slice(0,5).map(click=>Math.round(click.time*100)),[3,53,103,153,203]);
  assert.deepEqual(clicks.slice(0,5).map(click=>click.accent),[true,false,false,true,false]);
  metro.stop();
});

test('slow meters keep the scheduling horizon bounded and changing tempo cancels old clicks',()=>{
  let stopped=0;const clicks=[],audio={context:{currentTime:0},click:(accent,time)=>clicks.push(time),stopClicks(){stopped++;}};
  const timers={setInterval:()=>1,clearInterval(){}};const metro=new PulseMetronome({audio,timers});
  metro.start({bpm:30,numerator:4,denominator:4});assert.equal(metro.lookahead,2);assert.equal(clicks.length,1);
  metro.start({bpm:120,numerator:3,denominator:4});assert.equal(stopped,2);assert.equal(metro.lookahead,1.5);
  metro.stop();assert.equal(stopped,3);
});
