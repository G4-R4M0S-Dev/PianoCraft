const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

/** Wall-clock preparation. Song time and evaluation remain frozen until done. */
export class PracticeCadence {
  constructor(){this.cancel();}
  start({now=performance.now(),bpm=120,speed=1,numerator=4,denominator=4,bars=1,restSeconds=0}={}){
    this.cancel();
    const beats=clamp(Math.round(numerator)||4,1,32),unit=[1,2,4,8,16,32].includes(denominator)?denominator:4;
    const barCount=clamp(Math.round(bars)||0,0,2),rest=clamp(Number(restSeconds)||0,0,10);
    const pulseSeconds=60/clamp(Number(bpm)||120,10,600)*4/unit/clamp(Number(speed)||1,.1,3);
    this.startAt=finite(now)?now:0;this.countAt=this.startAt+rest*1000;this.endAt=this.countAt+beats*barCount*pulseSeconds*1000;
    this.beats=beats;this.totalBeats=beats*barCount;this.pulseMs=pulseSeconds*1000;this.active=this.endAt>this.startAt;
    return {duration:(this.endAt-this.startAt)/1000,clicks:Array.from({length:this.totalBeats},(_,i)=>({offset:rest+i*pulseSeconds,accent:i%beats===0,beat:i%beats+1}))};
  }
  advance(now){
    if(!this.active)return {active:false,done:true};
    if(now>=this.endAt){this.active=false;return {active:false,done:true};}
    if(now<this.countAt)return {active:true,done:false,phase:'rest',remaining:(this.countAt-now)/1000,beat:0,total:this.beats};
    const index=Math.max(0,Math.floor((now-this.countAt)/this.pulseMs));
    return {active:true,done:false,phase:'count',beat:index%this.beats+1,bar:Math.floor(index/this.beats)+1,total:this.beats,remaining:(this.endAt-now)/1000};
  }
  cancel(){this.active=false;this.startAt=this.countAt=this.endAt=0;}
}
